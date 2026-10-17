# SPDX-License-Identifier: MIT
"""The patch: the board document (doc/specs/agent.md §2.1) with graph queries and a compact text form for prompts."""
from __future__ import annotations

import copy
import re
from collections import deque
from typing import Any, Iterable

from .catalog import Catalog, ModuleType

# Port nodes that exist once per board and are not made by the agent.
PORT_TYPES = {"audio-out", "audio-in", "midi-in", "midi-out", "instrument", "audio-insert", "audio-bridge",
              "audio-return", "link", "macros"}


class PatchError(ValueError):
    """A problem the model can fix; the message is shown to it."""


class Patch:
    def __init__(self, data: dict[str, Any] | None = None):
        d = copy.deepcopy(data) if data else {}
        d.setdefault("format", 1)
        d.setdefault("nodes", [])
        d.setdefault("cables", [])
        self.data = d
        self._reindex()

    # ---- basics ----------------------------------------------------------------------------------------

    def _reindex(self) -> None:
        self._nodes = {n["id"]: n for n in self.data["nodes"]}
        self._cables = {c["id"]: c for c in self.data["cables"]}

    def copy(self) -> "Patch":
        return Patch(self.data)

    def to_dict(self) -> dict[str, Any]:
        return copy.deepcopy(self.data)

    @property
    def nodes(self) -> list[dict[str, Any]]:
        return self.data["nodes"]

    @property
    def cables(self) -> list[dict[str, Any]]:
        return self.data["cables"]

    @property
    def tempo(self) -> float | None:
        return self.data.get("tempo")

    def node(self, nid: str) -> dict[str, Any] | None:
        return self._nodes.get(nid)

    def cable(self, cid: str) -> dict[str, Any] | None:
        return self._cables.get(cid)

    def require_node(self, nid: str) -> dict[str, Any]:
        n = self._nodes.get(nid)
        if n is None:
            near = [k for k in self._nodes if nid.lower() in k.lower() or k.lower() in nid.lower()]
            hint = f" Did you mean {near[:3]}?" if near else f" Known ids: {list(self._nodes)[:30]}."
            raise PatchError(f"no module with id '{nid}'.{hint}")
        return n

    def find(self, text: str) -> list[dict[str, Any]]:
        """Nodes whose id, name or type matches `text` (case-insensitive)."""
        t = text.lower()
        return [n for n in self.nodes if t == n["id"].lower() or t in n.get("name", "").lower() or t == n["type"].lower()]

    def of_type(self, *types: str) -> list[dict[str, Any]]:
        return [n for n in self.nodes if n["type"] in types]

    def with_role(self, cat: Catalog, role: str) -> list[dict[str, Any]]:
        out = []
        for n in self.nodes:
            t = cat.get(n["type"])
            if t and role in t.roles:
                out.append(n)
        return out

    # ---- cables ----------------------------------------------------------------------------------------

    def cables_from(self, nid: str, jack: str | None = None) -> list[dict[str, Any]]:
        return [c for c in self.cables if c["from"]["node"] == nid and (jack is None or c["from"]["jack"] == jack)]

    def cables_to(self, nid: str, jack: str | None = None) -> list[dict[str, Any]]:
        return [c for c in self.cables if c["to"]["node"] == nid and (jack is None or c["to"]["jack"] == jack)]

    def cables_of(self, nid: str) -> list[dict[str, Any]]:
        return [c for c in self.cables if c["from"]["node"] == nid or c["to"]["node"] == nid]

    def successors(self, nid: str) -> list[str]:
        return sorted({c["to"]["node"] for c in self.cables_from(nid)})

    def predecessors(self, nid: str) -> list[str]:
        return sorted({c["from"]["node"] for c in self.cables_to(nid)})

    def reachable(self, start: Iterable[str], forward: bool = True) -> set[str]:
        seen = set(start)
        q = deque(seen)
        while q:
            n = q.popleft()
            for m in (self.successors(n) if forward else self.predecessors(n)):
                if m not in seen:
                    seen.add(m)
                    q.append(m)
        return seen

    def paths(self, src: str, dst: str, limit: int = 5, max_len: int = 12) -> list[list[dict[str, Any]]]:
        """Up to `limit` simple cable paths from node src to node dst (each a list of cables)."""
        found: list[list[dict[str, Any]]] = []

        def walk(n: str, path: list[dict[str, Any]], seen: set[str]) -> None:
            if len(found) >= limit or len(path) >= max_len:
                return
            for c in self.cables_from(n):
                m = c["to"]["node"]
                if m in seen:
                    continue
                if m == dst:
                    found.append(path + [c])
                    if len(found) >= limit:
                        return
                else:
                    walk(m, path + [c], seen | {m})

        walk(src, [], {src})
        return found

    # ---- ids and layout ----------------------------------------------------------------------------------

    def new_id(self, type_: str, taken: Iterable[str] = ()) -> str:
        base = re.sub(r"[^a-z0-9]", "", type_.lower())[:6] or "node"
        used = set(self._nodes) | set(taken)
        if base not in used:
            return base
        i = 2
        while f"{base}{i}" in used:
            i += 1
        return f"{base}{i}"

    def new_cable_id(self, taken: Iterable[str] = ()) -> str:
        used = set(self._cables) | set(taken)
        i = len(used) + 1
        while f"k{i}" in used:
            i += 1
        return f"k{i}"

    def free_position(self, near: str | None = None, parent: str = "") -> tuple[int, int]:
        """A spot for a new module: right of `near` (or of the right-most module) in the same row, clear of others."""
        top = [n for n in self.nodes if n.get("parent", "") == parent]
        if near and (nn := self.node(near)):
            x, y = int(nn.get("x", 0)) + 300, int(nn.get("y", 0))
        elif top:
            right = max(top, key=lambda n: n.get("x", 0))
            x, y = int(right.get("x", 0)) + 300, int(right.get("y", 0))
        else:
            x, y = 40, 40
        while any(abs(n.get("x", 0) - x) < 240 and abs(n.get("y", 0) - y) < 200 for n in top):
            y += 220
        return x, y

    # ---- text form -----------------------------------------------------------------------------------------

    def describe_node(self, n: dict[str, Any], cat: Catalog, params: str = "changed") -> str:
        t = cat.get(n["type"])
        head = f"{n['id']} [{n['type']}] \"{n.get('name', '')}\""
        if n.get("parent"):
            head += f" (in cell {n['parent']})"
        if n.get("muted"):
            head += " MUTED"
        bits: list[str] = []
        if t and params != "none":
            for p in t.params:
                if p.id not in n.get("params", {}) and params == "changed":
                    continue
                v = n.get("params", {}).get(p.id, p.default)
                if params == "changed" and abs(v - p.default) < 1e-6:
                    continue
                bits.append(f"{p.id}={p.text(v)}")
        if n.get("data"):
            bits.append("data=" + _data_hint(n["data"]))
        if n.get("inputs") or n.get("outputs"):  # a cell: the jacks you connect to from outside
            bits.append("cell jacks in: " + (", ".join(f"{j['id']}({j.get('type', 'control')})" for j in n.get("inputs", [])) or "none")
                        + "; out: " + (", ".join(f"{j['id']}({j.get('type', 'audio')})" for j in n.get("outputs", [])) or "none"))
        return head + (": " + ", ".join(bits) if bits else "")

    def cable_text(self, c: dict[str, Any], cat: Catalog) -> str:
        to = self.node(c["to"]["node"])
        t = cat.get(to["type"]) if to else None
        is_param = bool(t and t.param(c["to"]["jack"]) and not t.input(c["to"]["jack"]))
        amt = c.get("amount", 1)
        suffix = f" x{amt:g}" if amt != 1 else ""
        mod = " (modulates knob)" if is_param else ""
        return f"{c['id']}: {c['from']['node']}.{c['from']['jack']} -> {c['to']['node']}.{c['to']['jack']}{suffix}{mod}"

    def summary(self, cat: Catalog, params: str = "changed", selection: Iterable[str] = ()) -> str:
        sel = set(selection)
        lines = [f"Patch: {len(self.nodes)} modules, {len(self.cables)} cables"
                 + (f", tempo {self.tempo:g} bpm" if self.tempo else "")]
        if sel:
            lines.append("Selected: " + ", ".join(sorted(sel)))
        lines.append("Modules:")
        for n in self.nodes:
            lines.append("  " + self.describe_node(n, cat, params) + ("  <selected>" if n["id"] in sel else ""))
        lines.append("Cables:" if self.cables else "Cables: none")
        for c in self.cables:
            lines.append("  " + self.cable_text(c, cat))
        panels = self.data.get("panels") or []
        if panels:
            lines.append("Panels: " + ", ".join(f"{p.get('id', '?')} ({len(p.get('controls', []))} controls)" for p in panels))
        return "\n".join(lines)


def _data_hint(data: Any) -> str:
    if isinstance(data, dict):
        if isinstance(data.get("steps"), list):
            return f"{len(data['steps'])} steps"
        return "{" + ",".join(list(data)[:6]) + "}"
    return type(data).__name__


def jack_type(cat: Catalog, node: dict[str, Any], jack: str, side: str) -> tuple[str | None, str]:
    """Signal type of node.jack. For `side`='to' a param id counts as a control input (modulation).
    Returns (type or None, kind) with kind in {'jack','param',''}."""
    own = node.get("outputs" if side == "from" else "inputs")
    if own:  # cells (and voice cells) carry their own jacks in the board document
        for j in own:
            if j.get("id") == jack:
                return j.get("type", "control"), "jack"
    t: ModuleType | None = cat.get(node["type"])
    if t is None:
        return None, ""
    if side == "from":
        j = t.output(jack)
        return (j.type, "jack") if j else (None, "")
    j = t.input(jack)
    if j:
        return j.type, "jack"
    p = t.param(jack)
    if p and (p.modulatable or p.cableable):
        return "control", "param"
    return None, ""
