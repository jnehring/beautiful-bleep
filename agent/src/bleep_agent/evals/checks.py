# SPDX-License-Identifier: MIT
"""Deterministic checks (the headline score). Each takes the run's context and the check's arguments -> (ok, detail)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

from ..catalog import Catalog, compatible
from ..panels import validate_panel
from ..patch import Patch, jack_type
from ..sim import simulate


@dataclass
class Ctx:
    case: Any
    before: Patch  # the patch the agent was given
    after: Patch  # after applying every changeset
    text: str
    catalog: Catalog
    tools: list[tuple[str, bool]] = field(default_factory=list)  # (tool, retried)
    changesets: list[dict[str, Any]] = field(default_factory=list)
    live: list[str] = field(default_factory=list)

    def ref(self, patch: Patch, r: str) -> dict[str, Any] | None:
        """A node by id, 'type:<t>' (first of that type) or 'role:<r>'."""
        if r.startswith("type:"):
            ns = patch.of_type(r[5:])
            return ns[0] if ns else None
        if r.startswith("role:"):
            ns = patch.with_role(self.catalog, r[5:])
            return ns[0] if ns else None
        return patch.node(r)


CHECKS: dict[str, Callable[[Ctx, dict[str, Any]], tuple[bool, str]]] = {}


def check(name: str):
    def deco(fn):
        CHECKS[name] = fn
        return fn
    return deco


def _doc_url(doc_id: str) -> str:
    return f"/modules/{doc_id[7:]}/" if doc_id.startswith("module:") else f"/docs/{doc_id}/"


@check("audible")
def _audible(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    want = a.get("value", True)
    got = simulate(c.after, c.catalog).audible
    return got == want, f"audible={got}"


@check("fixes_fault")
def _fixes(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    was = simulate(c.before, c.catalog).audible
    now = simulate(c.after, c.catalog).audible
    return (not was) and now, f"before audible={was}, after audible={now}"


@check("valid_patch")
def _valid(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    p = c.after
    ids = {n["id"] for n in p.nodes}
    if len(ids) != len(p.nodes):
        return False, "duplicate module ids"
    for cab in p.cables:
        fn, tn = p.node(cab["from"]["node"]), p.node(cab["to"]["node"])
        if fn is None or tn is None:
            return False, f"cable {cab['id']} touches a missing module"
        ft, _ = jack_type(c.catalog, fn, cab["from"]["jack"], "from")
        tt, _ = jack_type(c.catalog, tn, cab["to"]["jack"], "to")
        if ft is None or tt is None or not compatible(ft, tt)[0]:
            return False, f"cable {cab['id']} {cab['from']} -> {cab['to']} is invalid"
    return True, "ok"


@check("unrelated_changes")
def _unrelated(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    allow = set(a.get("allow", []))
    n = sum(1 for old in c.before.nodes if old["id"] not in allow and (c.after.node(old["id"]) is None or
            {k: v for k, v in c.after.node(old["id"]).items() if k not in ("x", "y")} != {k: v for k, v in old.items() if k not in ("x", "y")}))
    return n <= a.get("max", 0), f"{n} existing modules changed or removed"


@check("module_added")
def _added(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    before = sum(1 for n in c.before.nodes if n["type"] == a["type"])
    after = sum(1 for n in c.after.nodes if n["type"] == a["type"])
    return after - before >= a.get("count", 1), f"{a['type']}: {before} -> {after}"


@check("fx_before_output")
def _fx(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    """Walking back from each Audio Out input, the requested effect types appear in the requested order (first = upstream)."""
    want: list[str] = a["types"]
    outs = c.after.of_type("audio-out")
    if not outs:
        return False, "no audio out"
    for out in outs:
        for jack in ("l", "r"):
            chain: list[str] = []
            node = out["id"]
            seen = {node}
            cabs = c.after.cables_to(node, jack)
            while cabs:
                src = cabs[0]["from"]["node"]
                if src in seen:
                    break
                seen.add(src)
                chain.append(c.after.node(src)["type"])
                # follow the same channel upstream: the source's first audio input cable of the same side
                nxt = [k for k in c.after.cables_to(src) if k["to"]["jack"].lower().endswith(("l", "1l")) == (jack == "l")]
                cabs = nxt[:1] or c.after.cables_to(src)[:1]
            order = list(reversed(chain))
            pos = -1
            for t in want:
                try:
                    pos = order.index(t, pos + 1)
                except ValueError:
                    return False, f"{out['id']}.{jack}: chain {order} lacks {want} in order"
    return True, "ok"


def _node_jack(c: Ctx, r: str) -> tuple[str | None, str]:
    node, _, jack = r.rpartition(".")
    n = c.ref(c.after, node)
    return (n["id"] if n else None), jack


@check("cable")
def _cable(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    fn, fj = _node_jack(c, a["from"])
    tn, tj = _node_jack(c, a["to"])
    ok = any(k["from"] == {"node": fn, "jack": fj} and k["to"] == {"node": tn, "jack": tj} for k in c.after.cables)
    if not ok and (a.get("exists", True)) and (node := c.after.node(fn)) is not None:
        # "role:lfo.out" means the LFO's signal: its sine, triangle or saw jack is as good as the one called out (same signal type)
        want, _ = jack_type(c.catalog, node, fj, "from")
        ok = want is not None and any(k["from"]["node"] == fn and k["to"] == {"node": tn, "jack": tj}
                                      and jack_type(c.catalog, node, k["from"]["jack"], "from")[0] == want for k in c.after.cables)
    return ok == a.get("exists", True), f"{a['from']} -> {a['to']} exists={ok}"


@check("param_range")
def _param(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    n = c.ref(c.after, a["node"])
    if n is None:
        return False, f"no {a['node']}"
    t = c.catalog.get(n["type"])
    p = t.param(a["param"]) if t else None
    if p is None:
        return False, f"{n['type']} has no {a['param']}"
    v = p.from_normalised(n.get("params", {}).get(p.id, p.default))
    return a.get("min", -1e18) <= v <= a.get("max", 1e18), f"{a['node']}.{a['param']} = {p.text(n.get('params', {}).get(p.id, p.default))}"


@check("has_path")
def _has_path(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    """Modules matching the given types/roles exist and are connected in that order (not necessarily adjacent)."""
    want: list[str] = a["chain"]

    def matches(n: dict[str, Any], r: str) -> bool:
        if r.startswith("role:"):
            t = c.catalog.get(n["type"])
            return bool(t and r[5:] in t.roles)
        return n["type"] == r.removeprefix("type:")

    starts = [n for n in c.after.nodes if matches(n, want[0])]
    for s in starts:
        frontier = {s["id"]}
        ok = True
        for r in want[1:]:
            reach = c.after.reachable(frontier, forward=True) - frontier
            nxt = {nid for nid in reach if matches(c.after.node(nid), r)}
            if not nxt:
                ok = False
                break
            frontier = nxt
        if ok:
            return True, "chain found"
    return False, f"no connected chain {want}"


@check("no_state_change")
def _nochange(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    return c.before.to_dict() == c.after.to_dict() and not c.changesets, f"{len(c.changesets)} changesets"


@check("text_contains")
def _text(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    t = c.text.lower()
    if "all" in a:
        miss = [x for x in a["all"] if x.lower() not in t]
        return not miss, f"missing {miss}" if miss else "all present"
    hit = [x for x in a.get("any", []) if x.lower() in t]
    return bool(hit), f"found {hit}" if hit else f"none of {a.get('any')}"


@check("cites")
def _cites(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    docs = a.get("docs") or c.case.gold.get("docs", [])
    urls = [_doc_url(d) for d in docs]
    hit = [u for u in urls if u.lower() in c.text.lower()]
    return bool(hit), f"cited {hit}" if hit else f"none of {urls} cited"


@check("says_unknown")
def _unknown(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    text = c.text.replace("\u2019", "'").replace("\u2018", "'")  # models write typographic apostrophes: "don’t describe"
    ok = bool(re.search(r"not (documented|covered|mentioned|described|say)|(does not|doesn't|do not|don't) (say|mention|cover|describe|document|have)|no (information|documentation|mention)|(cannot|can't|couldn't|could not|did not|didn't) find|isn't (documented|covered)|unclear from", text, re.I))
    return ok == a.get("value", True), f"admits_gap={ok}"


@check("tool_used")
def _tool(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    names = {t for t, _ in c.tools} | set(c.live)
    return (a["name"] in names) == a.get("value", True), f"tools: {sorted(names)}"


@check("panel_valid")
def _panel_valid(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    panels = c.after.data.get("panels") or []
    if len(panels) < a.get("min_panels", 1):
        return False, f"{len(panels)} panels"
    errs = [e for p in panels for e in validate_panel(p, c.after, c.catalog)]
    return not errs, "; ".join(errs[:3]) or "valid"


@check("panel_covers")
def _panel_covers(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    wired = {w["param"] for p in c.after.data.get("panels", []) for ctl in p["controls"] for w in ctl.get("wire", []) if "param" in w}
    miss = [x for x in a.get("params", []) if x not in wired]
    n = len(wired)
    return not miss and n >= a.get("min_controls", 0), f"{n} wired, missing {miss}"


@check("pattern")
def _pattern(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    n = c.ref(c.after, a.get("node", "type:step-sequencer"))
    if n is None:
        return False, "no step sequencer"
    steps = (n.get("data") or {}).get("steps") or []
    t = c.catalog.get(n["type"])
    lp = t.param("length")
    length = int(round(lp.from_normalised(n.get("params", {}).get("length", lp.default)))) if lp else len(steps)
    active = steps[:length]
    gated = [s for s in active if s.get("g")]
    problems = []
    lo, hi = a.get("length", [1, 32])
    if not lo <= length <= hi:
        problems.append(f"length {length} not in {lo}..{hi}")
    if "gated" in a and not a["gated"][0] <= len(gated) <= a["gated"][1]:
        problems.append(f"{len(gated)} gated steps not in {a['gated']}")
    acc = sum(1 for s in gated if s.get("v", 100) >= 110)
    if acc < a.get("accents", 0):
        problems.append(f"{acc} accents < {a['accents']}")
    ties = sum(1 for s in active if s.get("g") == 2)
    if ties < a.get("ties", 0):
        problems.append(f"{ties} ties < {a['ties']}")
    if gated and "range_semitones" in a:
        span = max(s["p"] for s in gated) - min(s["p"] for s in gated)
        lo2, hi2 = a["range_semitones"]
        if not lo2 <= span <= hi2:
            problems.append(f"pitch span {span} not in {a['range_semitones']}")
    if a.get("pitch_classes") and gated:
        bad = [s["p"] for s in gated if s["p"] % 12 not in a["pitch_classes"]]
        if len(bad) > a.get("pitch_tolerance", 0):
            problems.append(f"{len(bad)} pitches outside the key")
    if a.get("motif") and length >= 8:
        half = length // 2
        same = sum(1 for i in range(half) if (active[i].get("g"), active[i].get("p")) == (active[i + half].get("g"), active[i + half].get("p")))
        if same < half * 0.4:
            problems.append("no repeating motif")
    return not problems, "; ".join(problems) or f"length {length}, {len(gated)} gated, {acc} accents, {ties} ties"


@check("has_output_cable")
def _has_out(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    n = c.ref(c.after, a["node"])
    return bool(n and c.after.cables_from(n["id"])), f"{a['node']} -> {len(c.after.cables_from(n['id'])) if n else 0} cables out"


@check("param_changed")
def _param_changed(c: Ctx, a: dict[str, Any]) -> tuple[bool, str]:
    o, n = c.ref(c.before, a["node"]), c.ref(c.after, a["node"])
    if not o or not n:
        return False, "module missing"
    t = c.catalog.get(n["type"])
    p = t.param(a["param"])
    v0 = o.get("params", {}).get(p.id, p.default)
    v1 = n.get("params", {}).get(p.id, p.default)
    up = a.get("direction", "up") == "up"
    return (v1 > v0 + 1e-6) if up else (v1 < v0 - 1e-6), f"{p.text(v0)} -> {p.text(v1)}"


def run_checks(ctx: Ctx, specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for spec in specs:
        kind = spec["kind"]
        fn = CHECKS.get(kind)
        if fn is None:
            out.append({"kind": kind, "ok": False, "detail": "unknown check"})
            continue
        try:
            ok, detail = fn(ctx, {k: v for k, v in spec.items() if k != "kind"})
        except Exception as e:  # noqa: BLE001
            ok, detail = False, f"check failed: {type(e).__name__}: {e}"
        out.append({"kind": kind, "ok": bool(ok), "detail": detail})
    return out
