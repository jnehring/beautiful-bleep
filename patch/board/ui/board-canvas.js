// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-canvas.js — moving nodes, and the canvas: pointer tracking, panning, zooming, selecting with a band and navigating by key.
//
// P.BoardCanvas.create(s)   s: the board and page helpers it needs (see the destructuring below); `board`, `pointer`, `pointerInside`, `selCable`, `spaceDown` are getters
// (`pointer`, `pointerInside` and `selCable` have setters).
(function () {
  "use strict";
  const { priv: P } = window.BleepSeal;

  P.BoardCanvas = {
    create(s) {
      const { $, NODE_W, addAt, addMenu, applyCam, cablesEl, cablesInto, cam, canEnterVoice, canvas, clearCableSel,
              clone, closeUnpinnedViews, commit, edit, fit, hidePopovers, inputsOf, insideVoiceCell, isBoundary,
              isCellLike, isPort, isShown, isStructural, level, moveIntoCell, nodeById, nodesAt, nodesEl, openSearch,
              outType, outputsOf, ownerOf, paste, positionCablePop, renderCables, renderSelection, sel, selMore,
              selectAll, selectedCableIds, showCablePop, showMenu, startCableDrag, startSourceDrag, toWorld,
              toggleView, uid } = s;

      /// Dropping an unconnected module with audio in and out onto an audio cable puts it into the cable.
      /// A mono module takes the cable under it; a stereo one takes the pair of cables running between the same two modules.
      /// Returns { ins, outs } (the module's audio jacks), or null when the module may not be inserted.
      function inserterJacks(m) {
        if (isPort(m) || isBoundary(m) || isCellLike(m) || isStructural(m)) return null;
        if (s.board.cables.some((c) => c.from.node === m.id || c.to.node === m.id)) return null;
        const audio = (list) => list.filter((j) => j.type === "audio" && isShown(m, j));
        const ins = audio(inputsOf(m)), outs = audio(outputsOf(m));
        return ins.length && outs.length ? { ins, outs } : null;
      }
      /// The audio cables under the module's box (the one nearest its centre, with its stereo partner), or null.
      function cablesUnder(m, h, jacks) {
        const cx = m.x + NODE_W / 2, cy = m.y + h / 2;
        let best = null, bestD = Infinity;
        for (const hit of cablesEl.querySelectorAll(".cable-hit")) {
          const c = s.board.cables.find((k) => k.id === hit.dataset.id);
          const src = c && nodeById(c.from.node);
          if (!src || outType(src, c.from.jack) !== "audio") continue;
          const len = hit.getTotalLength();
          for (let d = 0; d <= len + 6; d += 6) {
            const p = hit.getPointAtLength(Math.min(d, len));
            if (p.x < m.x || p.x > m.x + NODE_W || p.y < m.y || p.y > m.y + h) continue;
            const dist = Math.hypot(p.x - cx, p.y - cy);
            if (dist < bestD) { best = c; bestD = dist; }
          }
        }
        if (!best) return null;
        const src = nodeById(best.from.node);
        const order = (k) => outputsOf(src).findIndex((o) => o.id === k.from.jack);
        const pair = s.board.cables
          .filter((k) => k.from.node === best.from.node && k.to.node === best.to.node && outType(src, k.from.jack) === "audio")
          .sort((a, b) => order(a) - order(b));
        const n = Math.min(pair.length, jacks.ins.length, jacks.outs.length);
        return n >= pair.length ? pair : [best];
      }
      /// Replaces `cables` by cable → module → cable, jack by jack in order. The second leg keeps the cable's amount.
      function insertInto(b, cables, id, jacks) {
        const gone = new Set(cables.map((c) => c.id));
        const legs = [];
        cables.forEach((c, i) => {
          legs.push({ id: uid("k"), from: clone(c.from), to: { node: id, jack: jacks.ins[i].id }, amount: 1 },
                    { id: uid("k"), from: { node: id, jack: jacks.outs[i].id }, to: clone(c.to), amount: c.amount });
        });
        b.cables = b.cables.filter((c) => !gone.has(c.id)).concat(legs);
      }
      function onNodePointerDown(ev, n) {
        if (ev.button !== 0) return;
        const dot = ev.target.closest(".dot");
        if (dot) {
          ev.stopPropagation();
          const row = dot.closest(".jack");
          if (ev.altKey && row.classList.contains("out")) {
            // Alt-drag: pick up the last cable out of this jack by its output end and move it to another output.
            const outOf = s.board.cables.filter((c) => c.from.node === n.id && c.from.jack === row.dataset.jack);
            if (outOf.length) return startSourceDrag(ev, outOf[outOf.length - 1]);
          }
          if (row.classList.contains("out") && (row.dataset.jack !== "+" || n.type === "cell-in" || n.type === "voice-in")) return startCableDrag(ev, n.id, row.dataset.jack);
          if (row.classList.contains("in")) {
            // Pick up the last cable into this jack and move its end (spec §9.5).
            const into = cablesInto(n.id, row.dataset.jack);
            if (into.length) {
              const c = into[into.length - 1];
              return startCableDrag(ev, c.from.node, c.from.jack, c);
            }
          }
          return;
        }
        if (ev.target.closest("input")) return;
        ev.stopPropagation();
        canvas.focus();
        hidePopovers();
        clearCableSel();
        if (ev.shiftKey) {
          sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id);
        } else if (!sel.has(n.id)) {
          sel.clear();
          sel.add(n.id);
        }
        renderSelection();
        renderCables();

        const start = { x: ev.clientX, y: ev.clientY };
        const c = cam();
        const moving = [...sel].map((id) => nodeById(id)).filter((m) => m && !ownerOf(m.id));   // a panel's modules sit in their stack
        const origin = moving.map((m) => ({ id: m.id, x: m.x, y: m.y }));
        let moved = false;
        // Dropping on a cell moves what is dragged into it (the cell under the pointer, if it may take them).
        const movers = moving.filter((m) => !isPort(m) && !isBoundary(m));
        let dropCell = null;
        const setDropCell = (id) => {
          if (id === dropCell) return;
          if (dropCell) { const o = nodesEl.querySelector(`[data-id="${dropCell}"]`); if (o) o.classList.remove("drop-target"); }
          dropCell = id;
          if (id) { const o = nodesEl.querySelector(`[data-id="${id}"]`); if (o) o.classList.add("drop-target"); }
        };
        const cellUnder = (e) => {
          if (!movers.length) return null;
          for (const hit of document.elementsFromPoint(e.clientX, e.clientY)) {
            const ne = hit.closest && hit.closest(".node.cell");
            const t = ne && nodeById(ne.dataset.id);
            if (!t || !isCellLike(t) || movers.some((m) => m.id === t.id)) continue;
            if ((t.type === "voice-cell" || insideVoiceCell(t.id)) && !canEnterVoice(movers)) return null;
            return t.id;
          }
          return null;
        };
        // A lone unconnected module over an audio cable: the cable lights up, and dropping puts the module into it.
        const single = moving.length === 1 && movers.length === 1 ? moving[0] : null;
        const jacks = single && inserterJacks(single);
        let insert = null;
        const setInsert = (cables) => {
          insert = cables;
          const ids = new Set((cables || []).map((k) => k.id));
          for (const p of cablesEl.querySelectorAll(".cable")) p.classList.toggle("insert-target", ids.has(p.dataset.id));
          const ne = single && nodesEl.querySelector(`[data-id="${single.id}"]`);
          if (ne) ne.classList.toggle("insert-ready", !!cables);
        };
        const move = (e) => {
          const dx = (e.clientX - start.x) / c.z, dy = (e.clientY - start.y) / c.z;
          if (!moved && Math.hypot(dx, dy) < 3) return;
          moved = true;
          setDropCell(cellUnder(e));
          origin.forEach((o) => {
            const m = nodeById(o.id);
            m.x = Math.round(o.x + dx);
            m.y = Math.round(o.y + dy);
            const ne = nodesEl.querySelector(`[data-id="${o.id}"]`);
            if (ne) { ne.style.left = m.x + "px"; ne.style.top = m.y + "px"; }
          });
          renderCables();
          if (jacks) {
            const ne = nodesEl.querySelector(`[data-id="${single.id}"]`);
            setInsert(dropCell ? null : cablesUnder(single, ne ? ne.offsetHeight : 60, jacks));
          }
          positionCablePop();
        };
        const up = (e) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          const target = moved ? cellUnder(e) : null;
          const into = target ? null : insert;
          setDropCell(null);
          setInsert(null);
          if (target) {
            edit("move into cell", (b) => { moveIntoCell(b, new Set(movers.map((m) => m.id)), target, false); sel.clear(); });
          } else if (into) {
            edit("insert into cable", (b) => insertInto(b, into, single.id, jacks));   // the position was updated in place while dragging
          } else if (moved) {
            commit(clone(s.board), "move");  // positions were updated in place while dragging
          } else if (!ev.shiftKey && !isStructural(n)) {
            toggleView(n.id);
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      // -------------------------------------------------------------- the canvas
      canvas.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest(".popover") || ev.target.closest(".vwin")) return;
        canvas.focus();
        hidePopovers();
        if (ev.button === 0) closeUnpinnedViews();  // a click elsewhere closes views that are not pinned
        if (ev.button === 1 || (ev.button === 0 && (s.spaceDown || ev.altKey))) return startPan(ev);
        if (ev.button !== 0) return;
        const keepCables = ev.shiftKey ? selectedCableIds() : [];
        clearCableSel();
        if (!ev.shiftKey) sel.clear();
        renderSelection();
        renderCables();
        startBand(ev, keepCables);
      });
      canvas.addEventListener("dblclick", (ev) => {
        if (ev.target.closest(".node") || ev.target.closest(".vwin") || ev.target.closest(".popover")) return;
        const r = canvas.getBoundingClientRect();
        openSearch(ev.clientX - r.left, ev.clientY - r.top);
      });
      canvas.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest(".node") || ev.target.closest(".vwin")) return;
        ev.preventDefault();
        if (ev.ctrlKey && ev.button === 0) return;   // ctrl-drag on a Mac (a cable band): not the menu
        const r = canvas.getBoundingClientRect();
        const at = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        showMenu(ev, [
          { label: "Add", items: addMenu(at) },
          { label: "Search…", key: "Tab", run: () => openSearch(at.x, at.y) },
          "-",
          { label: "Paste", key: "⌘V", run: () => paste(at) },
          { label: "Select all", key: "⌘A", run: selectAll },
          { label: "Fit to window", key: "F", run: fit },
        ]);
      });
      canvas.addEventListener("wheel", (ev) => {
        if (ev.target.closest(".vwin") || ev.target.closest(".popover")) return;
        ev.preventDefault();
        const c = cam();
        if (ev.ctrlKey || ev.metaKey) {
          const r = canvas.getBoundingClientRect();
          const mx = ev.clientX - r.left, my = ev.clientY - r.top;
          const z = Math.min(2, Math.max(0.2, c.z * Math.exp(-ev.deltaY * 0.01)));
          c.x = mx - (mx - c.x) * (z / c.z);
          c.y = my - (my - c.y) * (z / c.z);
          c.z = z;
        } else {
          c.x -= ev.deltaX;
          c.y -= ev.deltaY;
        }
        applyCam();
      }, { passive: false });
      $("navbar").addEventListener("pointerdown", (ev) => ev.stopPropagation());
      $("navbar").addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
      function navStep(what) {
        const c = cam(), r = canvas.getBoundingClientRect(), step = 120;
        if (what === "zoom-in" || what === "zoom-out") {
          const z = Math.min(2, Math.max(0.2, c.z * (what === "zoom-in" ? 1.25 : 0.8)));
          c.x = r.width / 2 - (r.width / 2 - c.x) * (z / c.z);
          c.y = r.height / 2 - (r.height / 2 - c.y) * (z / c.z);
          c.z = z;
        } else {
          if (what === "left") c.x += step;
          if (what === "right") c.x -= step;
          if (what === "up") c.y += step;
          if (what === "down") c.y -= step;
        }
        applyCam();
      }
      $("navbar").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-nav]");
        if (b) navStep(b.dataset.nav);
      });
      const trackPointer = (ev) => {
        const r = canvas.getBoundingClientRect();
        s.pointer = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        s.pointerInside = true;
      };
      canvas.addEventListener("pointermove", trackPointer);
      canvas.addEventListener("pointerdown", trackPointer, true);
      canvas.addEventListener("pointerleave", () => { s.pointerInside = false; });
      canvas.addEventListener("dragover", (ev) => ev.preventDefault());
      canvas.addEventListener("drop", (ev) => {
        ev.preventDefault();
        let what = null;
        try { what = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { return; }
        const w = toWorld(ev.clientX, ev.clientY);
        addAt(what, w.x - NODE_W / 2, w.y - 20);
      });

      function startPan(ev) {
        const c = cam(), start = { x: ev.clientX, y: ev.clientY, cx: c.x, cy: c.y };
        canvas.style.cursor = "grabbing";
        const move = (e) => { c.x = start.cx + e.clientX - start.x; c.y = start.cy + e.clientY - start.y; applyCam(); };
        const up = () => {
          canvas.style.cursor = "";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      /// The cables drawn through the world rectangle (a, b): any point along the cable inside it counts.
      function cablesInRect(a, b) {
        const ids = [];
        for (const h of cablesEl.querySelectorAll(".cable-hit")) {
          const len = h.getTotalLength();
          for (let d = 0; d <= len + 8; d += 8) {
            const p = h.getPointAtLength(Math.min(d, len));
            if (p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y) { ids.push(h.dataset.id); break; }
          }
        }
        return ids;
      }
      /// A band over cables and no node selects the cables; hold ctrl/⌘ to pick cables even over nodes.
      function startBand(ev, keepCables = []) {
        const r = canvas.getBoundingClientRect();
        const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
        const band = $("band");
        const before = new Set(sel);
        const cableMode = ev.ctrlKey || ev.metaKey;
        let picked = keepCables.join();
        const move = (e) => {
          const x = e.clientX - r.left, y = e.clientY - r.top;
          Object.assign(band.style, { left: Math.min(sx, x) + "px", top: Math.min(sy, y) + "px",
            width: Math.abs(x - sx) + "px", height: Math.abs(y - sy) + "px" });
          band.hidden = false;
          const a = toWorld(Math.min(sx, x) + r.left, Math.min(sy, y) + r.top);
          const b = toWorld(Math.max(sx, x) + r.left, Math.max(sy, y) + r.top);
          sel.clear();
          before.forEach((id) => sel.add(id));
          for (const n of nodesAt(level())) {
            if (ownerOf(n.id)) continue;
            const ne = nodesEl.querySelector(`[data-id="${n.id}"]`);
            const h = ne ? ne.offsetHeight : 60;
            if (!cableMode && n.x < b.x && n.x + NODE_W > a.x && n.y < b.y && n.y + h > a.y) sel.add(n.id);
          }
          // Nodes first: cables only when the band holds none (or ctrl/⌘ is down), so a band never mixes the two.
          const ids = sel.size > before.size || (before.size && !cableMode) ? [] : cablesInRect(a, b);
          const all = [...new Set([...keepCables, ...ids])];
          if (all.join() !== picked) {
            picked = all.join();
            clearCableSel();
            all.forEach((id, i) => (i ? selMore.add(id) : (s.selCable = id)));
            renderCables();
          }
          renderSelection();
        };
        const up = () => {
          if (s.selCable && !selMore.size) showCablePop(s.board.cables.find((k) => k.id === s.selCable));
          band.hidden = true;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      return {
        onNodePointerDown, navStep,
      };
    },
  };
})();
