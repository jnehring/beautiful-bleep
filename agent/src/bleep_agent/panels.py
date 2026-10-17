# SPDX-License-Identifier: MIT
"""Panels (doc/specs/panels.md): validation and a deterministic tidy layout.

A panel is {id, name, cols, rows, open?, controls:[...]}; controls sit on a grid (one unit = 20 px).
The model chooses WHAT goes on a panel (sections of knobs per module); `build_panel` decides WHERE.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from .catalog import Catalog
from .patch import Patch

CONTROL_TYPES = {"dial", "slider", "select", "button", "label", "section", "meter", "view"}
WIRED = {"dial", "slider", "select", "button"}
MAX_COLS, MAX_ROWS = 120, 120

SECTION_COLOURS = ["#2dd4bf", "#fbbf24", "#f0abfc", "#7dd3fc", "#a3e635", "#fda4af", "#c4b5fd", "#fdba74"]


def validate_panel(panel: dict[str, Any], patch: Patch, cat: Catalog) -> list[str]:
    """Problems with a panel, as messages the model can act on (empty = fine)."""
    errs: list[str] = []
    for k in ("id", "name", "cols", "rows", "controls"):
        if k not in panel:
            errs.append(f"panel needs '{k}'")
    if errs:
        return errs
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", str(panel["id"])):
        errs.append("panel id must be lowercase letters, digits and dashes")
    cols, rows = panel["cols"], panel["rows"]
    if not (isinstance(cols, int) and isinstance(rows, int) and 4 <= cols <= MAX_COLS and 4 <= rows <= MAX_ROWS):
        errs.append(f"cols and rows must be integers between 4 and {MAX_COLS}")
        return errs
    seen: set[str] = set()
    boxes: list[tuple[str, int, int, int, int, str]] = []
    for i, c in enumerate(panel["controls"]):
        t = c.get("type")
        where = f"control {i} ({t})"
        if t not in CONTROL_TYPES:
            errs.append(f"{where}: unknown type; use one of {sorted(CONTROL_TYPES)}")
            continue
        cid = c.get("id")
        if not cid or cid in seen:
            errs.append(f"{where}: needs a unique id")
        seen.add(cid)
        at, size = c.get("at"), c.get("size")
        if not (isinstance(at, list) and isinstance(size, list) and len(at) == 2 and len(size) == 2
                and all(isinstance(v, int) for v in at + size)):
            errs.append(f"{where}: 'at' and 'size' must be [x, y] integer pairs")
            continue
        if at[0] < 0 or at[1] < 0 or size[0] < 1 or size[1] < 1 or at[0] + size[0] > cols or at[1] + size[1] > rows:
            errs.append(f"{where}: outside the {cols}x{rows} grid (at {at}, size {size})")
        boxes.append((cid or str(i), at[0], at[1], size[0], size[1], t))
        if t in WIRED:
            wires = c.get("wire")
            if not wires:
                errs.append(f"{where}: needs a 'wire' list, e.g. [{{\"param\": \"filter.cutoff\"}}]")
            for w in wires or []:
                target = w.get("param")
                if target is None:
                    continue  # other wire kinds (cell targets, ...) are not checked
                nid, _, pid = str(target).partition(".")
                n = patch.node(nid)
                if n is None:
                    errs.append(f"{where}: wire target '{target}': no module '{nid}'")
                else:
                    ty = cat.get(n["type"])
                    if ty is None or ty.param(pid) is None:
                        errs.append(f"{where}: wire target '{target}': {n['type']} has no knob '{pid}'")
        if t == "view" and patch.node(c.get("node", "")) is None:
            errs.append(f"{where}: view of unknown module '{c.get('node')}'")
        if t == "meter":
            src = (c.get("source") or {}).get("out")
            for ref in src or []:
                nid, _, jid = str(ref).partition(".")
                if patch.node(nid) is None:
                    errs.append(f"{where}: meter source '{ref}': no module '{nid}'")
    # overlaps (sections and labels may contain others)
    solid = [b for b in boxes if b[5] not in ("section",)]
    for i, a in enumerate(solid):
        for b in solid[i + 1:]:
            if a[1] < b[1] + b[3] and b[1] < a[1] + a[3] and a[2] < b[2] + b[4] and b[2] < a[2] + a[4]:
                errs.append(f"controls {a[0]} and {b[0]} overlap")
    return errs[:20]


class PanelSection(BaseModel):
    title: str
    node: str = Field(description="Module id whose knobs go in this section.")
    params: list[str] = Field(default_factory=list, description="Knob ids, in order. Empty = the module's first 8 knobs.")
    colour: str | None = None
    labels: dict[str, str] = Field(default_factory=dict, description="Optional label overrides by knob id.")


class PanelPlan(BaseModel):
    id: str
    name: str
    sections: list[PanelSection]
    meter: bool = Field(True, description="Add an output meter fed by the Audio Out module.")
    columns: int = Field(53, description="Panel width in grid units (20 px each).")


def build_panel(plan: PanelPlan, patch: Patch, cat: Catalog) -> dict[str, Any]:
    """Lay the sections out in rows, left to right, wrapping at `columns`. Deterministic."""
    cols = max(24, min(plan.columns, MAX_COLS))
    controls: list[dict[str, Any]] = []
    n = 0

    def nid() -> str:
        nonlocal n
        n += 1
        return f"c{n}"

    controls.append({"id": nid(), "type": "label", "at": [1, 0], "size": [cols - 2, 2], "text": plan.name, "style": "title"})
    limit = cols - (6 if plan.meter else 1)
    x, y, row_h = 1, 3, 0
    for si, sec in enumerate(plan.sections):
        node = patch.require_node(sec.node)
        t = cat.get(node["type"])
        if t is None:
            raise ValueError(f"unknown type of {sec.node}")
        pids = sec.params or [p.id for p in t.params if p.kind == "float" and p.modulatable][:8]
        items: list[tuple[str, str, int, int]] = []  # (param, type, w, h)
        for pid in pids:
            p = t.param(pid)
            if p is None:
                raise ValueError(f"{node['type']} has no knob '{pid}'; knobs: {[q.id for q in t.params]}")
            if p.kind == "float":
                items.append((pid, "dial", 4, 4))
            elif p.kind == "bool":
                items.append((pid, "button", 4, 3))
            else:
                items.append((pid, "select", 6, 3))
        per_row = 6
        # rows of controls inside the section
        rows_: list[list[tuple[str, str, int, int]]] = []
        cur: list[tuple[str, str, int, int]] = []
        used = 0
        for it in items:
            if cur and (used + it[2] > per_row * 4 or len(cur) >= per_row):
                rows_.append(cur)
                cur, used = [], 0
            cur.append(it)
            used += it[2]
        if cur:
            rows_.append(cur)
        inner_w = max((sum(i[2] for i in r) for r in rows_), default=4)
        w = inner_w + 2
        h = 2 + sum(max(i[3] for i in r) for r in rows_) + 2
        if x + w > limit and x > 1:
            x, y, row_h = 1, y + row_h + 1, 0
        colour = sec.colour or SECTION_COLOURS[si % len(SECTION_COLOURS)]
        controls.append({"type": "section", "at": [x, y], "size": [w, h], "text": sec.title, "colour": colour, "id": nid()})
        cy = y + 2
        for r in rows_:
            cx = x + 1
            for pid, ctype, cw, ch in r:
                p = t.param(pid)
                controls.append({"type": ctype, "wire": [{"param": f"{sec.node}.{pid}"}], "label": sec.labels.get(pid, p.name),
                                 "at": [cx, cy], "size": [cw, ch], "id": nid()})
                cx += cw
            cy += max(i[3] for i in r)
        x += w + 1
        row_h = max(row_h, h)
    total_rows = y + row_h + 1
    if plan.meter:
        outs = patch.of_type("audio-out")
        if outs:
            srcs = [f"{c['from']['node']}.{c['from']['jack']}" for c in patch.cables_to(outs[0]["id"]) if c["to"]["jack"] in ("l", "r")]
            if srcs:
                # meters sit to the right of the last row of sections; extend the grid by a column strip
                controls.append({"id": nid(), "type": "meter", "label": "Out", "source": {"out": srcs[:2]},
                                 "at": [cols - 4, 3], "size": [2, 8]})
    panel = {"id": plan.id, "name": plan.name, "cols": cols, "rows": max(total_rows, 12), "controls": controls, "open": "window"}
    return panel
