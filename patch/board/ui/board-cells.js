// SPDX-License-Identifier: MIT
// board-cells.js — building cells out of the selection and taking them apart again (spec §8.1, §8.3.3).
//
// P.BoardCells.create(s)   s: the board and page helpers it needs (see the destructuring below); `types` is a getter.
//   returns { canEnterVoice, canGroupVoice, moveIntoCell, group, removeFromCell, ungroup }
(function () {
  "use strict";
  const { priv: P } = window.BleepSeal;

  P.BoardCells = {
    create(s) {
      const { NODE_W, clone, descendants, edit, insideVoiceCell, isBoundary, isCellLike, isPort, jackName, level, nodeById, outType, sel, selectedNodes, uid } = s;
      /// True when `nodes` may live inside a Voice Cell: no ports, no Voice Cells, nothing inside them that isn't allowed.
      const canEnterVoice = (nodes) => nodes.every((n) => !isPort(n) && n.type !== "voice-cell" &&
        !(isCellLike(n) && descendants(n.id).some((d) => d.type === "voice-cell" || isPort(d))));
      const canGroupVoice = () => {
        const picked = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
        return picked.length > 0 && !insideVoiceCell(level()) && canEnterVoice(picked);
      };

      /// Moves the nodes `inside` into the cell `cellId` (all in `b`, all currently on one level) and ports the
      /// cables that cross the border: each becomes a cell input or output (one per source), reusing a cell
      /// input that already carries the same source. `keep` leaves the positions alone (a brand-new cell).
      function moveIntoCell(b, inside, cellId, keep) {
        const cell = nodeById(cellId, b);
        const vout = cell.type === "voice-cell" ? b.nodes.find((n) => n.parent === cellId && n.type === "voice-out") : null;
        const cin = b.nodes.find((n) => n.parent === cellId && n.type === "cell-in") ||
                    b.nodes.find((n) => n.parent === cellId && n.type === "voice-in");   // a Voice Cell's shared inputs leave over Voice In
        const cout = b.nodes.find((n) => n.parent === cellId && n.type === "cell-out");
        const kids = b.nodes.filter((n) => inside.has(n.id));
        if (!keep) {  // right of what is already in the cell, keeping the selection's own layout
          const old = b.nodes.filter((n) => n.parent === cellId && !isBoundary(n));
          const ox = old.length ? Math.max(...old.map((n) => n.x)) + NODE_W + 60 : 320;
          const oy = old.length ? Math.min(...old.map((n) => n.y)) : 120;
          const kx = Math.min(...kids.map((n) => n.x)), ky = Math.min(...kids.map((n) => n.y));
          for (const n of kids) { n.x = ox + n.x - kx; n.y = oy + n.y - ky; }
          const edge = Math.max(...kids.map((n) => n.x)) + NODE_W + 60;   // the cell's outputs make room
          for (const n of b.nodes) if (n.parent === cellId && (n.type === "cell-out" || n.type === "voice-out") && n.x < edge) n.x = edge;
        }
        for (const n of kids) n.parent = cellId;
        cell.inputs = cell.inputs || [];
        cell.outputs = cell.outputs || [];
        const inputs = new Map(), outputs = new Map();
        const next = [];
        const cins = new Set(b.nodes.filter((n) => n.parent === cellId && (n.type === "cell-in" || n.type === "voice-in")).map((n) => n.id));
        const couts = new Set(b.nodes.filter((n) => n.parent === cellId && n.type === "cell-out").map((n) => n.id));
        const touched = new Set();  // cell jacks whose cables were joined through
        const joined = new Set();   // inner cables from a cell input / into a cell output that the moved nodes now replace
        for (const c of b.cables) {
          const fi = inside.has(c.from.node), ti = inside.has(c.to.node);
          if (fi === ti) { next.push(c); continue; }
          if (c.from.node === cellId || c.to.node === cellId) {
            // Between the cell and its new content: the content now sits behind the jack, so join straight through it:
            // module → cell input → inner target becomes module → inner target (and the same for outputs).
            if (ti && c.to.node !== cellId) {  // the cell's output jack feeds a node that moved inside
              for (const o of b.cables) if (!inside.has(o.from.node) && couts.has(o.to.node) && o.to.jack === c.from.jack) {
                next.push({ id: uid("k"), from: clone(o.from), to: clone(c.to), amount: o.amount * c.amount });
                joined.add(o.id);
                touched.add(c.from.jack);
              }
            } else if (fi && c.from.node !== cellId) {  // a node that moved inside feeds the cell's input jack
              for (const o of b.cables) if (cins.has(o.from.node) && o.from.jack === c.to.jack && !inside.has(o.to.node)) {
                next.push({ id: uid("k"), from: clone(c.from), to: clone(o.to), amount: c.amount * o.amount });
                joined.add(o.id);
                touched.add(c.to.jack);
              }
            }
            continue;
          }
          const key = c.from.node + "|" + c.from.jack;
          const src = nodeById(c.from.node, b);
          if (ti) {  // entering
            if (!cin) continue;
            if (!inputs.has(key)) {
              const same = b.cables.find((o) => o.to.node === cellId && o.from.node === c.from.node && o.from.jack === c.from.jack);
              if (same) inputs.set(key, same.to.jack);
              else {
                const jack = { id: uid("i"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
                cell.inputs.push(jack);
                inputs.set(key, jack.id);
                next.push({ id: uid("k"), from: clone(c.from), to: { node: cellId, jack: jack.id }, amount: 1 });
              }
            }
            next.push({ id: c.id, from: { node: cin.id, jack: inputs.get(key) }, to: clone(c.to), amount: c.amount });
          } else if (vout && outType(src, c.from.jack) === "audio") {  // a Voice Cell's audio leaves over Voice Out, not a Cell Out
            const ch = /(^|[^a-z])(r|right)$/i.test(c.from.jack) || /(^|[^a-z])(r|right)$/i.test(jackName(src, c.from.jack, true)) ? "r" : "l";
            if (!outputs.has(key)) {
              outputs.set(key, ch);
              next.push({ id: uid("k"), from: clone(c.from), to: { node: vout.id, jack: ch }, amount: 1 });
            }
            next.push({ id: c.id, from: { node: cellId, jack: outputs.get(key) }, to: clone(c.to), amount: c.amount });
          } else {  // leaving
            if (!cout) continue;
            if (!outputs.has(key)) {
              const jack = { id: uid("o"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
              cell.outputs.push(jack);
              outputs.set(key, jack.id);
              next.push({ id: uid("k"), from: clone(c.from), to: { node: cout.id, jack: jack.id }, amount: 1 });
            }
            next.push({ id: c.id, from: { node: cellId, jack: outputs.get(key) }, to: clone(c.to), amount: c.amount });
          }
        }
        b.cables = next.filter((c) => !joined.has(c.id));
        // A cell jack nothing uses any more (the moved nodes took over its cables) goes away.
        cell.inputs = cell.inputs.filter((j) => !touched.has(j.id) || b.cables.some((c) => (c.to.node === cellId && c.to.jack === j.id) || (cins.has(c.from.node) && c.from.jack === j.id)));
        cell.outputs = cell.outputs.filter((j) => !touched.has(j.id) || b.cables.some((c) => (c.from.node === cellId && c.from.jack === j.id) || (couts.has(c.to.node) && c.to.jack === j.id)));
      }

      /// Add → right-click → Create cell (⌘G, spec §8.1) or Create voice cell (`kind` "voice", spec §8.3.3): the
      /// selection moves into a new cell; cables that cross the new border become cell jacks.
      function group(kind) {
        const voice = kind === "voice";
        const picked = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
        if (!picked.length) return;
        if (insideVoiceCell(level()) && picked.some((n) => n.type === "voice-cell")) return;
        if (voice && !canGroupVoice()) return;
        edit(voice ? "create voice cell" : "group", (b) => {
          const inside = new Set(picked.map((n) => n.id));
          const lvl = level();
          const xs = picked.map((n) => n.x), ys = picked.map((n) => n.y);
          const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs);
          const cellId = uid(voice ? "vc" : "c");
          const params = voice ? Object.fromEntries(s.types["voice-cell"].params.map((p) => [p.id, p.default])) : {};
          const bnd = (id, type, name, x, y) => ({ id, type, name, x, y, parent: cellId, params: {} });
          b.nodes.push({ id: cellId, type: voice ? "voice-cell" : "cell", name: voice ? "Voice Cell" : "Cell", x: x0, y: y0, parent: lvl,
                         params, inputs: [], outputs: [] },
            bnd(uid("co"), "cell-out", "Cell Out", x1 + 260, voice ? y0 + 260 : y0));
          if (!voice) b.nodes.push(bnd(uid("ci"), "cell-in", "Cell In", x0 - 260, y0));
          if (voice) b.nodes.push(bnd(uid("vi"), "voice-in", "Voice In", x0 - 260, y0), bnd(uid("vo"), "voice-out", "Voice Out", x1 + 260, y0));
          moveIntoCell(b, inside, cellId, true);
          sel.clear();
          sel.add(cellId);
        });
      }

      /// Right-click → Remove from cell: the selected nodes inside the current cell move to the board level next
      /// to the cell. Cables through the border are rerouted over new cell jacks, or joined where they passed
      /// through a jack (as in ungroup). Cables to Voice In / Voice Out can't be kept.
      function removeFromCell() {
        const cellId = level();
        const picked = selectedNodes().filter((n) => n.parent === cellId && !isPort(n) && !isBoundary(n));
        if (!cellId || !picked.length) return;
        edit("remove from cell", (b) => {
          const cell = nodeById(cellId, b);
          if (!cell) return false;
          const out = new Set(picked.map((n) => n.id));
          const kx = Math.min(...picked.map((n) => n.x)), ky = Math.min(...picked.map((n) => n.y));
          for (const n of b.nodes) if (out.has(n.id)) {
            n.parent = cell.parent || "";
            n.x = cell.x + NODE_W + 80 + n.x - kx;
            n.y = cell.y + n.y - ky;
          }
          const cins = b.nodes.filter((n) => n.parent === cellId && (n.type === "cell-in" || n.type === "voice-in"));
          const couts = b.nodes.filter((n) => n.parent === cellId && n.type === "cell-out");
          const cinIds = new Set(cins.map((n) => n.id)), coutIds = new Set(couts.map((n) => n.id));
          cell.inputs = cell.inputs || [];
          cell.outputs = cell.outputs || [];
          const inputs = new Map(), outputs = new Map();
          const next = [];
          for (const c of b.cables) {
            const fo = out.has(c.from.node), to = out.has(c.to.node);
            if (fo === to) { next.push(c); continue; }
            const key = c.from.node + "|" + c.from.jack;
            const src = nodeById(c.from.node, b);
            if (to) {  // from the cell's inside to a moved node
              if (cinIds.has(c.from.node)) {  // it came in over a cell input: join the outer cables
                for (const o of b.cables.filter((o) => o.to.node === cellId && o.to.jack === c.from.jack))
                  next.push({ id: uid("k"), from: clone(o.from), to: clone(c.to), amount: o.amount * c.amount });
              } else if (!isBoundary(src) && couts[0]) {  // leaves the cell over a new cell output
                if (!outputs.has(key)) {
                  const jack = { id: uid("o"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
                  cell.outputs.push(jack);
                  outputs.set(key, jack.id);
                  next.push({ id: uid("k"), from: clone(c.from), to: { node: couts[0].id, jack: jack.id }, amount: 1 });
                }
                next.push({ id: c.id, from: { node: cellId, jack: outputs.get(key) }, to: clone(c.to), amount: c.amount });
              }
            } else {  // from a moved node to the cell's inside
              if (coutIds.has(c.to.node)) {  // it left over a cell output: join the outer cables
                for (const o of b.cables.filter((o) => o.from.node === cellId && o.from.jack === c.to.jack))
                  next.push({ id: uid("k"), from: clone(c.from), to: clone(o.to), amount: c.amount * o.amount });
              } else if (!isBoundary(nodeById(c.to.node, b)) && cins[0]) {  // enters the cell over a new cell input
                if (!inputs.has(key)) {
                  const jack = { id: uid("i"), name: jackName(src, c.from.jack, true), type: outType(src, c.from.jack) || "control" };
                  cell.inputs.push(jack);
                  inputs.set(key, jack.id);
                  next.push({ id: uid("k"), from: clone(c.from), to: { node: cellId, jack: jack.id }, amount: 1 });
                }
                next.push({ id: c.id, from: { node: cins[0].id, jack: inputs.get(key) }, to: clone(c.to), amount: c.amount });
              }
            }
          }
          b.cables = next;
          sel.clear();
        });
      }

      /// ⌘⇧G, right-click → Unbuild cell: the cell's contents move out into the patch; cables through its jacks are joined.
      /// A Voice Cell is unbuilt too: Voice In's per-voice signals and Voice Out's Active are lost, its shared inputs and audio join through.
      function ungroup(cellId) {
        edit("unbuild cell", (b) => {
          const cell = nodeById(cellId, b);
          if (!cell || !isCellLike(cell)) return false;
          const cins = b.nodes.filter((n) => n.parent === cellId && (n.type === "cell-in" || n.type === "voice-in"));
          const couts = b.nodes.filter((n) => n.parent === cellId && (n.type === "cell-out" || n.type === "voice-out"));
          const cinIds = new Set(cins.map((n) => n.id)), coutIds = new Set(couts.map((n) => n.id));
          const kids = b.nodes.filter((n) => n.parent === cellId && !isBoundary(n));
          const kx = Math.min(...kids.map((k) => k.x), Infinity), ky = Math.min(...kids.map((k) => k.y), Infinity);
          for (const k of kids) {
            k.parent = cell.parent || "";
            if (isFinite(kx)) { k.x = cell.x + (k.x - kx); k.y = cell.y + (k.y - ky); }
          }
          const boundary = new Set([cellId, ...cinIds, ...coutIds]);
          const next = b.cables.filter((c) => !boundary.has(c.from.node) && !boundary.has(c.to.node));
          for (const outer of b.cables.filter((c) => c.to.node === cellId))
            for (const inner of b.cables.filter((c) => cinIds.has(c.from.node) && c.from.jack === outer.to.jack))
              next.push({ id: uid("k"), from: clone(outer.from), to: clone(inner.to), amount: outer.amount * inner.amount });
          for (const inner of b.cables.filter((c) => coutIds.has(c.to.node)))
            for (const outer of b.cables.filter((c) => c.from.node === cellId && c.from.jack === inner.to.jack))
              next.push({ id: uid("k"), from: clone(inner.from), to: clone(outer.to), amount: outer.amount * inner.amount });
          b.cables = next;
          b.nodes = b.nodes.filter((n) => !boundary.has(n.id));
          sel.clear();
          kids.forEach((k) => sel.add(k.id));
        });
      }

      return {
        canEnterVoice, canGroupVoice, moveIntoCell, group, removeFromCell, ungroup,
      };
    },
  };
})();
