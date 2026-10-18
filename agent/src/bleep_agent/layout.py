# SPDX-License-Identifier: MIT
"""Where the modules a changeset adds go on the board: signal flow from left to right, voices as rows under each other, mixers right of the voices
they mix, nothing on top of anything else. The model never gives coordinates (it names a cable or a neighbour), so this is done in code, on the grid the
library's own presets sit on: columns COL apart, rows ROW apart, a module NODE_W wide.

`layout_new_nodes(patch, catalog, new_order, pinned)` moves the new modules in `patch` and returns the existing modules it had to push right to make room
for them ({id: (x, y)}); modules the user did not touch otherwise stay where they are."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .catalog import Catalog
from .patch import Patch

COL, ROW = 300, 220      # grid of the presets: 98 % of their cables run left to right, columns 300 apart, rows 220 apart
NODE_W, BOX_H = 184, 180  # a module is 184 wide (board.css --node-w); a row of 220 holds one module with some air
MARGIN = 40              # left/top edge of the board
SHARED = {"note_source", "sequencer", "clock", "controller"}  # roles of modules that feed several voices (keyboard, sequencer...)
CONTROL = {"envelope", "lfo"}  # roles of modules that shape a voice from the side


def _is_mixer(t: str) -> bool:
    return t.endswith("mixer")


def layout_new_nodes(p: Patch, cat: Catalog, new_order: list[str], pinned: set[str] | None = None) -> dict[str, tuple[int, int]]:
    pinned = pinned or set()
    moved: dict[str, tuple[int, int]] = {}
    for parent in dict.fromkeys(p.node(i).get("parent", "") for i in new_order if p.node(i)):
        ids = [i for i in new_order if p.node(i) and p.node(i).get("parent", "") == parent and i not in pinned]
        if ids:
            moved.update(_layout_group(p, cat, parent, ids))
    return moved


def _layout_group(p: Patch, cat: Catalog, parent: str, new: list[str]) -> dict[str, tuple[int, int]]:
    nodes = {n["id"]: n for n in p.nodes if n.get("parent", "") == parent}
    newset = set(new)
    ups: dict[str, list[str]] = defaultdict(list)   # node -> modules that feed it
    downs: dict[str, list[str]] = defaultdict(list)
    for c in p.cables:
        a, b = c["from"]["node"], c["to"]["node"]
        if a in nodes and b in nodes and a != b:
            if a not in ups[b]:
                ups[b].append(a)
            if b not in downs[a]:
                downs[a].append(b)
    connected = [i for i in new if ups[i] or downs[i]]
    loose = [i for i in new if i not in connected]  # added without a cable: they stay where they were put, only made clear of the others

    def roles(i: str) -> set[str]:
        t = cat.get(nodes[i]["type"])
        return set(t.roles) if t else set()

    # ---- flow order of the new modules (feeders first); a cycle falls back to creation order
    order: list[str] = []
    todo = list(connected)
    while todo:
        ready = [i for i in todo if not any(u in todo and u != i for u in ups[i])]
        if not ready:
            ready = [todo[0]]
        for i in ready:
            order.append(i)
            todo.remove(i)

    def cells_free(x: int, y: int, taken: dict[str, tuple[int, int]], skip: set[str] = frozenset()) -> bool:  # type: ignore[assignment]
        return not any(i not in skip and abs(px - x) < NODE_W + 16 and abs(py - y) < BOX_H + 20 for i, (px, py) in taken.items())

    existing: dict[str, tuple[int, int]] = {i: (int(n.get("x", 0)), int(n.get("y", 0))) for i, n in nodes.items() if i not in newset}
    moved: dict[str, tuple[int, int]] = {}

    def solve() -> dict[str, tuple[int, int]]:
        def column(i: str, placed: dict[str, tuple[int, int]]) -> int | None:
            feeders = [placed[u][0] for u in ups[i] if u in placed]
            return max(feeders) + COL if feeders else None

        def anchor_y(i: str, placed: dict[str, tuple[int, int]]) -> int | None:
            # the row of the signal path: an envelope or LFO feeding the module hangs under its voice and does not pull the module off the main row
            main = [u for u in ups[i] if u in placed and not roles(u) & CONTROL]
            ys = [placed[u][1] for u in main] or [placed[u][1] for u in ups[i] if u in placed] or [placed[d][1] for d in downs[i] if d in placed]
            return None if not ys else (ys[0] if len(ys) == 1 else int(round(sum(ys) / len(ys) / 20)) * 20)

        def free_row(x: int, y: int, taken: dict[str, tuple[int, int]]) -> int:
            for k in range(0, 40):
                for sgn in ((1,) if k == 0 else (1, -1)):
                    yy = y + sgn * k * ROW
                    if yy >= 0 and cells_free(x, yy, taken):
                        return yy
            return y

        placed = dict(existing)
        # ---- 1. shared sources (keyboard, sequencer ...) of the new modules, then 2. each voice as a block, 3. the rest (mixers, effects after them)
        stage1 = [i for i in order if not ups[i] and roles(i) & SHARED and len([d for d in downs[i]]) > 0]
        after_mixer: set[str] = set()  # everything downstream of a new mixer is laid out after the voices, in the last stage
        queue = [i for i in order if _is_mixer(nodes[i]["type"])]
        while queue:
            i = queue.pop()
            if i in after_mixer:
                continue
            after_mixer.add(i)
            queue.extend(d for d in downs[i] if d in newset)
        voices_ids = [i for i in order if i not in stage1 and i not in after_mixer]
        # voices: connected groups of new modules that do not go through a mixer or a shared source
        parent_of: dict[str, str] = {i: i for i in voices_ids}

        def find(i: str) -> str:
            while parent_of[i] != i:
                parent_of[i] = parent_of[parent_of[i]]
                i = parent_of[i]
            return i
        for i in voices_ids:
            for u in ups[i]:
                if u in parent_of:
                    parent_of[find(i)] = find(u)
        groups: dict[str, list[str]] = defaultdict(list)
        for i in voices_ids:
            groups[find(i)].append(i)

        def put(i: str, x: int, y: int) -> None:
            placed[i] = (x, y)

        for i in stage1:  # left edge, in the row of whatever it feeds (or the first free one)
            feeds = [placed[d][1] for d in downs[i] if d in placed]
            x = MARGIN
            put(i, x, free_row(x, feeds[0] if feeds else MARGIN, placed))
        # a voice that is not fed by anything known yet starts after the modules already on the board
        for members in sorted(groups.values(), key=lambda g: new.index(g[0])):
            mem = [i for i in order if i in members]
            xs: dict[str, int] = {}
            for i in mem:
                x = column(i, {**placed, **{m: (xs[m], 0) for m in xs}})
                down_anchor = [placed[d][0] for d in downs[i] if d in placed and d not in newset]
                xs[i] = x if x is not None else (max(MARGIN, min(down_anchor) - COL) if down_anchor else MARGIN)
            rel: dict[str, int] = {}
            for i in mem:  # rows inside the block: inherit the feeder's row, a module that would sit on another one goes a row down
                inherited = [rel[u] for u in ups[i] if u in rel]
                r = min(inherited) if inherited else 0  # the main chain keeps row 0, helpers (envelopes) hang under it
                while any(rel[m] == r and xs[m] == xs[i] for m in rel):
                    r += 1
                rel[i] = r
            feeders = [placed[u] for i in mem for u in ups[i] if u in placed and u not in members]
            downs_known = [placed[d] for i in mem for d in downs[i] if d in placed and d not in members]
            y0 = (feeders or downs_known or [(0, MARGIN)])[0][1]
            base = y0
            for k in range(0, 40):
                ok = False
                for sgn in ((1,) if k == 0 else (1, -1)):
                    yy = y0 + sgn * k * ROW
                    if yy >= 0 and all(cells_free(xs[i], yy + rel[i] * ROW, placed) for i in mem):
                        base, ok = yy, True
                        break
                if ok:
                    break
            for i in mem:
                put(i, xs[i], base + rel[i] * ROW)
        for i in order:  # what is left: mixers and what follows them: right of everything that feeds them, at the height of their feeders
            if i in placed:
                continue
            x = column(i, placed)
            if x is None:
                down_anchor = [placed[d][0] for d in downs[i] if d in placed and d not in newset]
                x = max(MARGIN, min(down_anchor) - COL) if down_anchor else MARGIN
            y = anchor_y(i, placed)
            put(i, x, free_row(x, MARGIN if y is None else y, placed))
        for i in loose:  # unconnected: keep the spot, clear of the others
            x, y = int(nodes[i].get("x", 0)), int(nodes[i].get("y", 0))
            others = {k: v for k, v in placed.items() if k != i}
            put(i, x, y if cells_free(x, y, others) else free_row(x, y, others))

        return placed

    # ---- make room: a new module must not sit right of (or above) a module it feeds: push those, and everything right of them, to the right,
    # then place again, so that the new modules find the room they made
    feeders_of_new: set[str] = set()  # existing modules upstream of the new ones never move: pushing them would only move the target again
    stack = [u for i in connected for u in ups[i] if u not in newset]
    while stack:
        u = stack.pop()
        if u not in feeders_of_new:
            feeders_of_new.add(u)
            stack.extend(x for x in ups[u] if x not in newset)
    for _ in range(6):
        placed = solve()
        need, edge = 0, None
        for i in connected:
            for d in downs[i]:
                if d not in newset and placed[i][0] + COL > existing[d][0] and (edge is None or existing[d][0] < edge):
                    edge = existing[d][0]
        if edge is None:
            break
        for i in connected:
            for d in downs[i]:
                if d not in newset and existing[d][0] >= edge:
                    need = max(need, placed[i][0] + COL - existing[d][0])
        for j in list(existing):
            if existing[j][0] >= edge and j not in feeders_of_new:
                existing[j] = (existing[j][0] + need, existing[j][1])
                moved[j] = existing[j]
    for i in new:
        nodes[i]["x"], nodes[i]["y"] = placed[i]
    for j, (x, y) in moved.items():
        nodes[j]["x"], nodes[j]["y"] = x, y
    return moved
