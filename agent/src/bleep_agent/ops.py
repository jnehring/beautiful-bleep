# SPDX-License-Identifier: MIT
"""Agent-facing operations and their compilation to primitive client operations (doc/specs/agent.md §3).

`apply_ops(patch, catalog, ops)` is transactional: either every op is valid and the returned Changeset carries the
primitive ops (the patch is changed), or an OpError names the failing op and nothing changes.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from .catalog import Catalog, ModuleType, compatible
from .patch import PORT_TYPES, Patch, PatchError, jack_type


class OpError(ValueError):
    def __init__(self, index: int, message: str):
        super().__init__(f"op {index}: {message}")
        self.index = index
        self.message = message


# ---- agent-facing ops -------------------------------------------------------------------------------------------


class AddModule(BaseModel):
    op: Literal["add_module"] = "add_module"
    type: str = Field(description="Module type id from the catalog, e.g. 'chorus'.")
    name: str | None = Field(None, description="Display name; defaults to the module's own name.")
    ref: str | None = Field(None, description="Local handle (e.g. 'fx1') that later ops in this call may use as '$fx1'.")
    params: dict[str, Any] = Field(default_factory=dict, description="Knob values in real units (Hz, seconds, 0..1 percent...) or choice names.")
    near: str | None = Field(None, description="Node id to place the new module next to.")
    parent: str = Field("", description="Cell id to put it in; empty = top level.")


class RemoveModule(BaseModel):
    op: Literal["remove_module"] = "remove_module"
    node: str


class Connect(BaseModel):
    op: Literal["connect"] = "connect"
    from_node: str
    from_jack: str = Field(description="An output jack id of from_node.")
    to_node: str
    to_jack: str = Field(description="An input jack id of to_node, or a knob id to modulate it.")
    amount: float | None = Field(None, description="-1..1; default 1 for jacks, 0.5 for knob modulation.")


class Disconnect(BaseModel):
    op: Literal["disconnect"] = "disconnect"
    cable: str | None = None
    from_node: str | None = None
    from_jack: str | None = None
    to_node: str | None = None
    to_jack: str | None = None


class SetParam(BaseModel):
    op: Literal["set_param"] = "set_param"
    node: str
    param: str
    value: Any = Field(description="Number in real units, choice name, or boolean.")


class SetCableAmount(BaseModel):
    op: Literal["set_cable_amount"] = "set_cable_amount"
    cable: str
    amount: float


class InsertOnCable(BaseModel):
    op: Literal["insert_on_cable"] = "insert_on_cable"
    cable: str | None = None
    from_node: str | None = None
    from_jack: str | None = None
    to_node: str | None = None
    to_jack: str | None = None
    type: str
    name: str | None = None
    ref: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    in_jack: str | None = Field(None, description="Input jack of the new module (default: first compatible).")
    out_jack: str | None = Field(None, description="Output jack of the new module (default: first compatible).")


class RenameModule(BaseModel):
    op: Literal["rename_module"] = "rename_module"
    node: str
    name: str


class MoveModule(BaseModel):
    op: Literal["move_module"] = "move_module"
    node: str
    x: int
    y: int


class SetNodeData(BaseModel):
    op: Literal["set_node_data"] = "set_node_data"
    node: str
    data: dict[str, Any]


class SetTempo(BaseModel):
    op: Literal["set_tempo"] = "set_tempo"
    bpm: float


Op = Annotated[
    Union[AddModule, RemoveModule, Connect, Disconnect, SetParam, SetCableAmount, InsertOnCable, RenameModule,
          MoveModule, SetNodeData, SetTempo],
    Field(discriminator="op"),
]


class Changeset(BaseModel):
    id: str
    summary: str
    ops: list[dict[str, Any]]
    lines: list[str]
    destructive: bool = False
    notes: list[str] = []

    def compact(self) -> dict[str, Any]:
        return {"id": self.id, "summary": self.summary, "lines": self.lines, "notes": self.notes}


# ---- applying ----------------------------------------------------------------------------------------------------


class _Ctx:
    def __init__(self, patch: Patch, cat: Catalog):
        self.p, self.cat = patch, cat
        self.refs: dict[str, str] = {}
        self.prims: list[dict[str, Any]] = []
        self.lines: list[str] = []
        self.notes: list[str] = []
        self.destructive = False
        self.new_nodes: set[str] = set()
        self.new_cables: set[str] = set()

    def nid(self, x: str) -> str:
        if x.startswith("$"):
            if x[1:] not in self.refs:
                raise PatchError(f"unknown reference '{x}'; refs defined so far: {list(self.refs)}")
            return self.refs[x[1:]]
        return x

    def type_of(self, n: dict[str, Any]) -> ModuleType:
        t = self.cat.get(n["type"])
        if t is None:
            raise PatchError(f"module '{n['id']}' has unknown type '{n['type']}'")
        return t

    def label(self, nid: str) -> str:
        n = self.p.node(nid)
        return f"{n.get('name') or n['type']} ({nid})" if n else nid


def _make_node(ctx: _Ctx, type_: str, name: str | None, params: dict[str, Any], near: str | None, parent: str,
               ref: str | None, xy: tuple[int, int] | None = None) -> dict[str, Any]:
    t = ctx.cat.get(type_)
    if t is None:
        similar = [m.type for m in ctx.cat.search(type_, limit=5)]
        raise PatchError(f"unknown module type '{type_}'." + (f" Similar: {similar}" if similar else " Use list_module_types."))
    if not t.creatable or type_ in PORT_TYPES:
        raise PatchError(f"'{type_}' is a port or cell boundary and cannot be added by the assistant")
    nid = ctx.p.new_id(type_, ctx.new_nodes)
    x, y = xy if xy else ctx.p.free_position(ctx.nid(near) if near else None, parent)
    node: dict[str, Any] = {"id": nid, "type": type_, "name": name or t.name, "x": x, "y": y, "parent": parent, "params": {}}
    for pid, val in params.items():
        p = t.param(pid)
        if p is None:
            raise PatchError(f"{type_} has no knob '{pid}'. Knobs: {[q.id for q in t.params]}")
        norm, note = p.parse(val)
        node["params"][pid] = norm
        if note:
            ctx.notes.append(note)
    if ref:
        if ref in ctx.refs:
            raise PatchError(f"reference '{ref}' is already used")
        ctx.refs[ref] = nid
    ctx.p.nodes.append(node)
    ctx.p._reindex()
    ctx.new_nodes.add(nid)
    ctx.prims.append({"op": "add_node", "node": dict(node, params=dict(node["params"]))})
    ctx.lines.append(f"+ {node['name']} ({type_}) as {nid}")
    return node


def _make_cable(ctx: _Ctx, fn: str, fj: str, tn: str, tj: str, amount: float | None) -> dict[str, Any]:
    a, b = ctx.p.require_node(fn), ctx.p.require_node(tn)
    ft, _ = jack_type(ctx.cat, a, fj, "from")
    if ft is None:
        outs = [j["id"] for j in a["outputs"]] if a.get("outputs") else [j.id for j in ctx.type_of(a).outputs]
        raise PatchError(f"{a['id']} ({a['type']}) has no output '{fj}'. Outputs: {outs}")
    tt, kind = jack_type(ctx.cat, b, tj, "to")
    if tt is None:
        t = ctx.type_of(b)
        ins = [j["id"] for j in b["inputs"]] if b.get("inputs") else [j.id for j in t.inputs]
        raise PatchError(f"{b['id']} ({b['type']}) has no input or knob '{tj}'. Inputs: {ins}; "
                         f"knobs that accept cables: {[p.id for p in t.params if p.modulatable or p.cableable]}")
    if a.get("parent", "") != b.get("parent", ""):
        raise PatchError("cables cannot cross a cell border; connect through the cell's own jacks")
    ok, why = compatible(ft, tt)
    if not ok:
        raise PatchError(f"cannot connect {fn}.{fj} ({ft}) to {tn}.{tj} ({tt}): {why}")
    for c in ctx.p.cables:
        if c["from"] == {"node": fn, "jack": fj} and c["to"] == {"node": tn, "jack": tj}:
            raise PatchError(f"{fn}.{fj} is already connected to {tn}.{tj} (cable {c['id']})")
    amt = amount if amount is not None else (0.5 if kind == "param" else 1.0)
    cid = ctx.p.new_cable_id(ctx.new_cables)
    cable = {"id": cid, "from": {"node": fn, "jack": fj}, "to": {"node": tn, "jack": tj}, "amount": max(-1.0, min(1.0, amt))}
    ctx.p.cables.append(cable)
    ctx.p._reindex()
    ctx.new_cables.add(cid)
    ctx.prims.append({"op": "add_cable", "cable": cable})
    ctx.lines.append(f"+ cable {fn}.{fj} -> {tn}.{tj}" + (f" (amount {amt:g})" if amt != 1 else ""))
    return cable


def _drop_cable(ctx: _Ctx, c: dict[str, Any]) -> None:
    ctx.p.data["cables"] = [x for x in ctx.p.cables if x["id"] != c["id"]]
    ctx.p._reindex()
    ctx.prims.append({"op": "remove_cable", "id": c["id"]})
    ctx.lines.append(f"- cable {c['from']['node']}.{c['from']['jack']} -> {c['to']['node']}.{c['to']['jack']}")


def _find_cable(ctx: _Ctx, o: Any, pair_ok: bool = False) -> dict[str, Any]:
    if o.cable:
        c = ctx.p.cable(o.cable)
        if c is None:
            raise PatchError(f"no cable '{o.cable}'. Cables: {[x['id'] for x in ctx.p.cables][:30]}")
        return c
    if not (o.from_node and o.to_node):
        raise PatchError("give a cable id, or from_node/from_jack/to_node/to_jack")
    fn, tn = ctx.nid(o.from_node), ctx.nid(o.to_node)
    cs = [c for c in ctx.p.cables_from(fn, o.from_jack) if c["to"]["node"] == tn and (o.to_jack is None or c["to"]["jack"] == o.to_jack)]
    if not cs:
        raise PatchError(f"no cable from {fn}{'.' + o.from_jack if o.from_jack else ''} to {tn}{'.' + o.to_jack if o.to_jack else ''}")
    if len(cs) > 1 and not (o.from_jack and o.to_jack):
        if pair_ok and len(cs) == 2 and _stereo_partner(ctx, cs[0]) is not None:
            return min(cs, key=lambda c: c["from"]["jack"].lower())  # a stereo pair: the left cable stands for both
        raise PatchError(f"{len(cs)} cables match ({[c['id'] for c in cs]}); name the jacks or the cable id")
    return cs[0]


_TWIN = [(re.compile(r"l$"), "r"), (re.compile(r"r$"), "l"), (re.compile(r"^l"), "r"), (re.compile(r"^r"), "l")]


def _twin(jack: str) -> str | None:
    j = jack.lower()
    for rx, rep in _TWIN:
        if rx.search(j) and len(j) > 0:
            cand = rx.sub(rep, j, count=1)
            if cand != j:
                return cand
    return None


def _stereo_partner(ctx: _Ctx, c: dict[str, Any]) -> dict[str, Any] | None:
    fj, tj = _twin(c["from"]["jack"]), _twin(c["to"]["jack"])
    if not fj or not tj:
        return None
    for d in ctx.p.cables:
        if d["id"] != c["id"] and d["from"] == {"node": c["from"]["node"], "jack": fj} and d["to"] == {"node": c["to"]["node"], "jack": tj}:
            return d
    return None


def _audio_jacks(jacks: list, kind: str) -> list[str]:
    return [j.id for j in jacks if j.type == kind]


def _insert(ctx: _Ctx, o: InsertOnCable) -> None:
    c = _find_cable(ctx, o, pair_ok=True)
    ftype, _ = jack_type(ctx.cat, ctx.p.require_node(c["from"]["node"]), c["from"]["jack"], "from")
    t = ctx.cat.get(o.type)
    if t is None:
        raise PatchError(f"unknown module type '{o.type}'. Use list_module_types.")
    a, b = ctx.p.require_node(c["from"]["node"]), ctx.p.require_node(c["to"]["node"])
    partner = _stereo_partner(ctx, c) if ftype == "audio" else None
    ins = [j for j in t.inputs if j.type == ftype] or [j for j in t.inputs if compatible(ftype or "audio", j.type)[0]]
    outs = [j for j in t.outputs if j.type == ftype] or [j for j in t.outputs if compatible(j.type, ftype or "audio")[0]]
    if o.in_jack:
        in_ids = [o.in_jack]
    else:
        in_ids = [j.id for j in ins]
    out_ids = [o.out_jack] if o.out_jack else [j.id for j in outs]
    if not in_ids or not out_ids:
        raise PatchError(f"{o.type} has no input/output that fits a {ftype} cable. Inputs: {[j.id for j in t.inputs]}; outputs: {[j.id for j in t.outputs]}")
    # the first cable of a pair is the left (or only) one
    if partner is not None and _twin(c["from"]["jack"]) and c["from"]["jack"].lower() > (partner["from"]["jack"].lower()):
        c, partner = partner, c  # make c the left cable ('l' < 'r')
    if partner is not None and (len(in_ids) < 2 or len(out_ids) < 2 or o.in_jack or o.out_jack):
        partner = None
        ctx.notes.append(f"{o.type} is mono here: only {c['from']['node']}.{c['from']['jack']} was routed through it")
    node = _make_node(ctx, o.type, o.name, o.params, a["id"], a.get("parent", ""), o.ref)
    nid = node["id"]
    pairs = [(c, in_ids[0], out_ids[0])]
    if partner is not None:
        pairs.append((partner, in_ids[1], out_ids[1]))
    for cab, ij, oj in pairs:
        amt = cab.get("amount", 1)
        _drop_cable(ctx, cab)
        _make_cable(ctx, cab["from"]["node"], cab["from"]["jack"], nid, ij, amt)
        _make_cable(ctx, nid, oj, cab["to"]["node"], cab["to"]["jack"], 1.0)


def _seq_check(data: dict[str, Any]) -> None:
    steps = data.get("steps")
    if steps is None:
        return
    if not isinstance(steps, list) or not 1 <= len(steps) <= 32:
        raise PatchError("steps must be a list of 1..32 steps (the sequencer keeps 32; its 'length' knob says how many play)")
    for i, s in enumerate(steps):
        if (not isinstance(s, dict) or s.get("g", 0) not in (0, 1, 2) or not isinstance(s.get("p", 0), int)
                or not 1 <= int(s.get("v", 100)) <= 127):
            raise PatchError(f"step {i}: need {{'g': 0 off|1 on|2 tie, 'p': integer semitones from root, 'v': 1..127}}, got {s}")


def _apply_one(ctx: _Ctx, o: Any) -> None:
    p = ctx.p
    if isinstance(o, AddModule):
        _make_node(ctx, o.type, o.name, o.params, o.near, o.parent, o.ref)
    elif isinstance(o, RemoveModule):
        n = p.require_node(ctx.nid(o.node))
        if n["type"] in PORT_TYPES:
            raise PatchError(f"{n['id']} is a port (audio/MIDI connection); the assistant does not remove ports")
        for c in list(p.cables_of(n["id"])):
            _drop_cable(ctx, c)
        p.data["nodes"] = [x for x in p.nodes if x["id"] != n["id"]]
        p._reindex()
        ctx.prims.append({"op": "remove_node", "id": n["id"]})
        ctx.lines.append(f"- {n.get('name') or n['type']} ({n['id']})")
        ctx.destructive = True
    elif isinstance(o, Connect):
        _make_cable(ctx, ctx.nid(o.from_node), o.from_jack, ctx.nid(o.to_node), o.to_jack, o.amount)
    elif isinstance(o, Disconnect):
        _drop_cable(ctx, _find_cable(ctx, o))
    elif isinstance(o, SetParam):
        n = p.require_node(ctx.nid(o.node))
        t = ctx.type_of(n)
        pr = t.param(o.param)
        if pr is None:
            raise PatchError(f"{n['id']} ({n['type']}) has no knob '{o.param}'. Knobs: {[q.id for q in t.params]}")
        norm, note = pr.parse(o.value)
        n.setdefault("params", {})[pr.id] = norm
        ctx.prims.append({"op": "set_param", "node": n["id"], "param": pr.id, "value": norm})
        ctx.lines.append(f"~ {n['id']}.{pr.id} = {pr.text(norm)}")
        if note:
            ctx.notes.append(note)
    elif isinstance(o, SetCableAmount):
        c = p.cable(o.cable)
        if c is None:
            raise PatchError(f"no cable '{o.cable}'")
        c["amount"] = max(-1.0, min(1.0, o.amount))
        ctx.prims.append({"op": "set_cable_amount", "id": c["id"], "amount": c["amount"]})
        ctx.lines.append(f"~ cable {c['id']} amount {c['amount']:g}")
    elif isinstance(o, InsertOnCable):
        _insert(ctx, o)
    elif isinstance(o, RenameModule):
        n = p.require_node(ctx.nid(o.node))
        n["name"] = o.name
        ctx.prims.append({"op": "rename_node", "id": n["id"], "name": o.name})
        ctx.lines.append(f"~ rename {n['id']} to \"{o.name}\"")
    elif isinstance(o, MoveModule):
        n = p.require_node(ctx.nid(o.node))
        n["x"], n["y"] = o.x, o.y
        ctx.prims.append({"op": "move_node", "id": n["id"], "x": o.x, "y": o.y})
    elif isinstance(o, SetNodeData):
        n = p.require_node(ctx.nid(o.node))
        if n["type"] == "step-sequencer":
            _seq_check(o.data)
        n["data"] = o.data
        ctx.prims.append({"op": "set_data", "node": n["id"], "data": o.data})
        ctx.lines.append(f"~ {n['id']} data ({len(o.data.get('steps', [])) or 'custom'} steps)" if "steps" in o.data else f"~ {n['id']} data")
    elif isinstance(o, SetTempo):
        if not 20 <= o.bpm <= 400:
            raise PatchError("tempo must be 20..400 bpm")
        p.data["tempo"] = o.bpm
        ctx.prims.append({"op": "set_tempo", "bpm": o.bpm})
        ctx.lines.append(f"~ tempo {o.bpm:g} bpm")
    else:  # pragma: no cover
        raise PatchError(f"unknown op {o!r}")


def _cid(prims: list[dict[str, Any]]) -> str:
    """A changeset id from its content: the same edit gets the same id, so a replayed conversation (evaluation cache) repeats exactly."""
    return hashlib.sha1(json.dumps(prims, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:8]


def apply_ops(patch: Patch, cat: Catalog, ops: list[Any], summary: str = "") -> Changeset:
    """Validate and apply `ops` to `patch` (changed in place only if all succeed)."""
    work = patch.copy()
    ctx = _Ctx(work, cat)
    for i, o in enumerate(ops):
        try:
            _apply_one(ctx, o)
        except OpError:
            raise
        except ValueError as e:  # PatchError, and Param.parse's messages for a bad knob value
            raise OpError(i, str(e)) from None
    patch.data = work.data
    patch._reindex()
    if not ctx.prims:
        raise OpError(0, "no operations given")
    cs = Changeset(id=_cid(ctx.prims), summary=summary or _auto_summary(ctx.lines), ops=ctx.prims, lines=ctx.lines,
                   destructive=ctx.destructive, notes=ctx.notes)
    return cs


def _auto_summary(lines: list[str]) -> str:
    add = sum(1 for l in lines if l.startswith("+ ") and not l.startswith("+ cable"))
    cab = sum(1 for l in lines if l.startswith("+ cable"))
    rem = sum(1 for l in lines if l.startswith("- "))
    chg = sum(1 for l in lines if l.startswith("~"))
    bits = [f"{n} {w}" for n, w in ((add, "added"), (cab, "cables"), (rem, "removed"), (chg, "changed")) if n]
    return ", ".join(bits) or "changes"


# ---- primitives on a patch (the client's job; used by tests and the simulated client) --------------------------


def apply_primitives(patch: Patch, prims: list[dict[str, Any]]) -> None:
    for o in prims:
        k = o["op"]
        if k == "add_node":
            patch.nodes.append(o["node"])
        elif k == "remove_node":
            patch.data["nodes"] = [n for n in patch.nodes if n["id"] != o["id"]]
        elif k == "add_cable":
            patch.cables.append(o["cable"])
        elif k == "remove_cable":
            patch.data["cables"] = [c for c in patch.cables if c["id"] != o["id"]]
        elif k == "set_param":
            patch.node(o["node"]).setdefault("params", {})[o["param"]] = o["value"]
        elif k == "set_cable_amount":
            patch.cable(o["id"])["amount"] = o["amount"]
        elif k == "set_data":
            patch.node(o["node"])["data"] = o["data"]
        elif k == "rename_node":
            patch.node(o["id"])["name"] = o["name"]
        elif k == "move_node":
            n = patch.node(o["id"])
            n["x"], n["y"] = o["x"], o["y"]
        elif k == "set_tempo":
            patch.data["tempo"] = o["bpm"]
        elif k == "set_panel":
            panels = patch.data.setdefault("panels", [])
            panels[:] = [p for p in panels if p.get("id") != o["panel"].get("id")] + [o["panel"]]
        elif k == "remove_panel":
            patch.data["panels"] = [p for p in patch.data.get("panels", []) if p.get("id") != o["id"]]
        else:
            raise ValueError(f"unknown primitive {k}")
        patch._reindex()


def make_changeset(prims: list[dict[str, Any]], lines: list[str], summary: str, destructive: bool = False,
                   notes: list[str] | None = None) -> Changeset:
    """A changeset for primitives that were not produced by apply_ops (panels)."""
    return Changeset(id=_cid(prims), summary=summary, ops=prims, lines=lines, destructive=destructive, notes=notes or [])
