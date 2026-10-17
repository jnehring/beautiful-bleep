// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-cabledrag.js — patching by hand (spec §9.4, §9.5): dragging a cable from an output jack, or picking up an existing
// cable by either end, dropping it on a jack, a knob in a module view or a module, and the module views that open under it.
//
//   P.BoardCableDrag.create(env)   env: the board and page helpers it needs (see the destructuring below); `board` is a getter.
//     returns { startCableDrag(ev, nodeId, jack, movingCable), startSourceDrag(ev, cable), connect(b, from, to, amount), isDragging() }
(function () {
  "use strict";
  const { priv: P } = window.BleepSeal;

  P.BoardCableDrag = {
    create(env) {
      const { $, el, uid, canvas, cablesEl, nodesEl, SVGNS, views, nodeById, typeOf, inputsOf, outputsOf, outType, jackName, compatible,
              isStructural, modParams, signalColour, setHoverCable, jackPos, cablePath, toWorld, jackRow, edit, render, showMenu,
              openView, closeView, front } = env;
      let drag = null;  // {from: {node, jack}, type, moving: cable|null, path}

      function startCableDrag(ev, nodeId, jack, movingCable) {
        ev.preventDefault();
        setHoverCable(null);
        const n = nodeById(nodeId);
        const type = outType(n, jack) || "control";
        const tmp = document.createElementNS(SVGNS, "path");
        tmp.setAttribute("class", `cable temp ${type}`);
        tmp.style.setProperty("--c", signalColour(type));
        cablesEl.appendChild(tmp);
        drag = { from: { node: nodeId, jack }, type, moving: movingCable || null, tmp };
        if (movingCable) hideCableEls(movingCable.id);
        markTargets(true);
        const a = jackPos(nodeId, jack, "out");
        const move = (e) => {
          const over = document.elementFromPoint(e.clientX, e.clientY);
          // The port a drop would reach: a knob in a view or an input jack that accepts this cable.
          const port = over && (over.closest(".bv-target.drop-ok") || over.closest(".jack.in.drop-ok"));
          for (const t of document.querySelectorAll(".drop-hover")) if (t !== port) t.classList.remove("drop-hover");
          let b = toWorld(e.clientX, e.clientY);
          if (port) {
            port.classList.add("drop-hover");
            // The cable end snaps onto the port.
            const r = (port.querySelector(".dot") || port).getBoundingClientRect();
            b = toWorld(r.left + r.width / 2, r.top + r.height / 2);
          }
          tmp.setAttribute("d", cablePath(a, b));
          springOpen(over);
        };
        const up = (e) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          tmp.remove();
          const d = drag;
          drag = null;
          dropCable(d, e);
          endSpring(e);
          markTargets(false);  // after the drop: it may land on a view's input strip
        };
        move(ev);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      /// Hides the drawn cable (path, pulse and hit area) that is being moved.
      function hideCableEls(id) {
        const hit = cablesEl.querySelector(`.cable-hit[data-id="${id}"]`);
        for (let e = hit && hit.previousElementSibling; e && (e.classList.contains("cable-pulse") || e.classList.contains("cable") && !e.classList.contains("hover")); e = e.previousElementSibling) {
          e.style.display = "none";
          if (e.classList.contains("cable")) break;
        }
      }

      function markTargets(on) {
        const reverse = on && drag.reverse;   // an output end is in hand: output jacks are the targets
        if (!reverse) for (const [id, v] of views) viewInputs(id, v, on);
        for (const row of document.querySelectorAll("#nodes .jack, #views .jack")) {
          row.classList.remove("drop-ok", "drop-no");
          if (!on) { row.classList.remove("drop-hover"); continue; }
          if (row.classList.contains("in") === reverse) continue;
          if (!reverse && row.dataset.jack === "+") { row.classList.add("drop-ok"); continue; }
          const n = nodeById(row.dataset.node);
          const ok = reverse ? n && row.dataset.jack !== "+" && compatible(row.dataset.type, drag.destType) && n.id !== drag.to.node
                             : n && compatible(drag.type, row.dataset.type) && n.id !== drag.from.node;
          row.classList.add(ok ? "drop-ok" : "drop-no");
        }
        for (const k of document.querySelectorAll(".bv-target")) {
          k.classList.toggle("drop-ok", on && !reverse && drag.type !== "notes");
          if (!on) k.classList.remove("drop-hover");
        }
      }

      /// The output end of an existing cable in hand: drop it on another output jack (or a module, to pick one of its outputs).
      function startSourceDrag(ev, cable) {
        ev.preventDefault();
        setHoverCable(null);
        const dst = nodeById(cable.to.node);
        const dj = dst && inputsOf(dst).find((j) => j.id === cable.to.jack);
        const type = outType(nodeById(cable.from.node), cable.from.jack) || "control";
        const tmp = document.createElementNS(SVGNS, "path");
        tmp.setAttribute("class", `cable temp ${type}`);
        tmp.style.setProperty("--c", signalColour(type));
        cablesEl.appendChild(tmp);
        drag = { reverse: true, from: cable.from, to: cable.to, type, destType: dj ? dj.type : "control", moving: cable, tmp };
        hideCableEls(cable.id);
        markTargets(true);
        const fixed = jackPos(cable.to.node, cable.to.jack, "in");
        const move = (e) => {
          const over = document.elementFromPoint(e.clientX, e.clientY);
          const port = over && over.closest(".jack.out.drop-ok");
          for (const t of document.querySelectorAll(".drop-hover")) if (t !== port) t.classList.remove("drop-hover");
          let a = toWorld(e.clientX, e.clientY);
          if (port) {
            port.classList.add("drop-hover");
            const r = (port.querySelector(".dot") || port).getBoundingClientRect();
            a = toWorld(r.left + r.width / 2, r.top + r.height / 2);
          }
          tmp.setAttribute("d", cablePath(a, fixed));
        };
        const up = (e) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          tmp.remove();
          const d = drag;
          drag = null;
          dropSource(d, e);
          markTargets(false);
        };
        move(ev);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      function dropSource(d, e) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const old = d.moving;
        const rewire = (n, jack) => {
          if (n.id === old.from.node && jack === old.from.jack) return render();   // back where it was
          edit("reconnect", (b) => {
            b.cables = b.cables.filter((c) => c.id !== old.id);
            connect(b, { node: n.id, jack }, d.to, old.amount);
          });
        };
        const row = target && target.closest(".jack.out");
        if (row) {
          const n = nodeById(row.dataset.node);
          if (!n || row.dataset.jack === "+" || n.id === d.to.node || !compatible(row.dataset.type, d.destType)) return render();
          return rewire(n, row.dataset.jack);
        }
        const nodeEl = target && target.closest(".node");
        if (nodeEl && nodeEl.dataset.id !== d.to.node) {
          const n = nodeById(nodeEl.dataset.id);
          const items = outputsOf(n).filter((j) => compatible(j.type, d.destType));
          if (!items.length) return render();
          return showMenu(e, items.map((j) => ({ label: j.name, key: j.type, run: () => rewire(n, j.id) })));
        }
        // Empty canvas: a dropped cable end is deleted, as with the input end.
        if (target && canvas.contains(target) && !target.closest(".vwin")) return edit("disconnect", (b) => { b.cables = b.cables.filter((c) => c.id !== old.id); });
        render();
      }

      // While a cable is in hand, open views show the module's input jacks in a
      // strip on their left, so the cable can end there too. The window grows to
      // the left, keeping its controls where they were.
      function viewInputs(id, v, on) {
        const old = v.win.querySelector(".v-ins");
        if (old) {
          v.win.style.left = v.win.offsetLeft + (v.shift || 0) + "px";
          v.win.style.width = v.ownWidth;
          v.win.classList.remove("wiring");
          old.remove();
        }
        const n = nodeById(id);
        const jacks = on && n ? inputsOf(n) : [];
        if (!jacks.length) return;
        const strip = el("div", "v-ins");
        for (const j of jacks) {
          const connected = env.board.cables.some((c) => c.to.node === id && c.to.jack === j.id);
          strip.appendChild(jackRow(n, j.id, j.name, j.type, "in", connected ? "connected" : ""));
        }
        v.ownWidth = v.win.style.width;
        const w = v.win.offsetWidth;
        v.win.classList.add("wiring");
        v.win.insertBefore(strip, v.win.querySelector(".v-body"));
        v.win.style.width = w + strip.offsetWidth + "px";
        // Grow to the left, but never over the module itself: its ports must stay free.
        const left0 = v.win.offsetLeft;
        let left = Math.max(8, left0 - strip.offsetWidth);
        const ne = nodesEl.querySelector(`[data-id="${id}"]`);
        if (ne) {
          const nodeRight = ne.getBoundingClientRect().right - canvas.getBoundingClientRect().left;
          if (left0 >= nodeRight) left = Math.max(left, nodeRight + 8);
        }
        v.shift = left0 - left;
        v.win.style.left = left + "px";
      }

      // While a cable is in hand, resting on a module opens its view, so the
      // cable can go straight onto a knob (spec §9.5). Views opened this way close
      // again unless the cable ends in them or on their node.
      const kSpringDelay = 250;  // ms
      let spring = { timer: 0, node: null, opened: new Set() };

      function springOpen(over) {
        if (!drag || drag.type === "notes") return;
        if (over && over.closest(".vwin")) { clearTimeout(spring.timer); spring.node = null; return; }
        const ne = over && over.closest(".node");
        const n = ne && nodeById(ne.dataset.id);
        const id = n && n.id !== drag.from.node && !isStructural(n) && modParams(n).length ? n.id : null;
        if (id === spring.node) return;
        clearTimeout(spring.timer);
        spring.node = id;
        if (!id) return;
        spring.timer = setTimeout(() => {
          if (!drag || spring.node !== id) return;
          // Only one view opened by the cable at a time.
          for (const o of spring.opened) if (o !== id) closeView(o);
          spring.opened = new Set([...spring.opened].filter((o) => o === id));
          if (views.has(id)) front(views.get(id).win);
          else { openView(id); spring.opened.add(id); }
          markTargets(true);  // the new view's knobs
        }, kSpringDelay);
      }

      function endSpring(e) {
        clearTimeout(spring.timer);
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const win = target && target.closest(".vwin");
        const ne = target && target.closest(".node");
        const keep = win ? win.dataset.node : ne ? ne.dataset.id : null;
        for (const id of spring.opened) if (id !== keep) closeView(id);
        spring = { timer: 0, node: null, opened: new Set() };
      }

      function connect(b, from, to, amount) {
        if (b.cables.some((c) => c.from.node === from.node && c.from.jack === from.jack &&
                                 c.to.node === to.node && c.to.jack === to.jack)) return;
        b.cables.push({ id: uid("k"), from, to, amount });
        // A panel-element module (Dial, Button …) that still has its default name takes the title of what it now drives.
        const src = nodeById(from.node, b), dst = nodeById(to.node, b);
        if (src && dst && src !== dst && typeOf(src).category.startsWith("Controllers/") &&
            new RegExp("^" + typeOf(src).name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\d+)?$").test(src.name)) {
          const name = jackName(dst, to.jack, false);
          if (name && name !== to.jack) src.name = name;
        }
      }

      function dropCable(d, e) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const without = (b) => { if (d.moving) b.cables = b.cables.filter((c) => c.id !== d.moving.id); };
        const amount = d.moving ? d.moving.amount : 1;

        // A cable from the "+" of a Cell In: its end becomes a new cell input, named after the jack or knob it lands on.
        if (d.from.jack === "+") {
          const knobEl = target && target.closest(".bv-target");
          const rowEl = target && target.closest(".jack.in");
          const dest = knobEl ? { node: knobEl.closest(".vwin").dataset.node, jack: knobEl.dataset.param, type: "control" }
                     : rowEl && rowEl.dataset.jack !== "+" ? { node: rowEl.dataset.node, jack: rowEl.dataset.jack, type: rowEl.dataset.type } : null;
          if (!dest || dest.node === d.from.node || !compatible("control", dest.type)) return;
          return edit("new cell input", (b) => {
            const cell = nodeById(nodeById(d.from.node, b).parent, b);
            const dn = nodeById(dest.node, b);
            const id = uid("i");
            cell.inputs = cell.inputs || [];
            cell.inputs.push({ id, name: jackName(dn, dest.jack, false), type: dest.type });
            connect(b, { node: d.from.node, jack: id }, { node: dest.node, jack: dest.jack }, 1);
          });
        }

        // A knob in a module view (spec §9.5).
        const knob = target && target.closest(".bv-target");
        if (knob && d.type !== "notes") {
          const nodeId = knob.closest(".vwin").dataset.node;
          return edit("connect", (b) => { without(b); connect(b, d.from, { node: nodeId, jack: knob.dataset.param }, amount); });
        }
        // An input jack, or the "+" of a Cell Out (a new cell output).
        const row = target && target.closest(".jack.in");
        if (row) {
          const n = nodeById(row.dataset.node);
          if (row.dataset.jack === "+" && n.type === "cell-out") {
            return edit("new cell output", (b) => {
              without(b);
              const cell = nodeById(n.parent, b);
              const src = nodeById(d.from.node, b);
              const id = uid("o");
              cell.outputs = cell.outputs || [];
              cell.outputs.push({ id, name: src.type === "patchbay-in" ? src.name : jackName(src, d.from.jack, true), type: d.type });
              connect(b, d.from, { node: n.id, jack: id }, 1);
            });
          }
          if (!compatible(d.type, row.dataset.type) || n.id === d.from.node && !d.moving) return d.moving ? render() : null;
          return edit("connect", (b) => { without(b); connect(b, d.from, { node: n.id, jack: row.dataset.jack }, amount); });
        }
        // A node: pick one of its knobs.
        const nodeEl = target && target.closest(".node");
        if (nodeEl && nodeEl.dataset.id !== d.from.node) {
          const n = nodeById(nodeEl.dataset.id);
          if (d.moving) edit("disconnect", without);
          return showParamPicker(n, d, e);
        }
        // Empty canvas: a dropped cable end is deleted; a new cable opens the search.
        if (d.moving) return edit("disconnect", without);
        if (target && (target === canvas || canvas.contains(target)) && !target.closest(".vwin")) {
          const r = canvas.getBoundingClientRect();
          env.openSearch(e.clientX - r.left, e.clientY - r.top, { from: d.from, type: d.type });
        }
      }

      function showParamPicker(n, d, e) {
        const items = [];
        for (const j of inputsOf(n))
          if (compatible(d.type, j.type)) items.push({ label: j.name, sub: j.type, jack: j.id });
        if (d.type !== "notes")
          for (const p of modParams(n)) items.push({ label: p.name, sub: "knob", jack: p.id });
        if (!items.length) return;
        showMenu(e, items.map((it) => ({
          label: it.label, key: it.sub,
          run: () => edit("connect", (b) => connect(b, d.from, { node: n.id, jack: it.jack }, 1)),
        })));
      }

      return { startCableDrag, startSourceDrag, connect, isDragging: () => !!drag };
    },
  };
})();
