// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-render.js — drawing the board: nodes, stacks of panel modules, jacks, cables, the selection and the cable popover.
//
// P.BoardRender.create(s)   s: the board and page helpers it needs (see the destructuring below); `board`, `types`, `trace`, `hoverCable`, `selCable` are getters
// (`hoverCable` and `selCable` have setters).
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardRender = {
    create(s) {
            const { $, SVGNS, applyCam, cableDragging, cablesEl, cam, canvas, cellPanels, centreOn, clearCableSel, edit,
              el, enterCell, expanded, gesture, goToNode, hasPanel, hideMeter, hidePopovers, inputsOf, isBoundary,
              isCableSel, isCellLike, isGhost, isPort, isShown, jackName, kShownOutputs, knobMenuItems, leaveTo,
              level, liveSource, modParams, nodeById, nodesAt, nodesEl, onNodePointerDown, outType, outputsOf, panelById,
              panelList, paramValue, portInfo, removeCable, scopes, sel, selMore, setPowerButton, showCableMenu,
              showCellHelp, showMenu, showMeter, showNodeMenu, shownName, startCableDrag, startRename,
              startSourceDrag, toCanvas, toWorld, typeOf, views } = s;
      function render() {
        renderCrumbs();
        $("cell-close").hidden = s.path.length === 0;
        renderNodes();
        for (const [id, v] of views) {  // a rename changes the titles of open views
          const n = nodeById(id), t = v.win.querySelector(".v-title");
          if (n && t && n.name !== t.textContent) t.textContent = n.name;
          if (n && v.power) setPowerButton(v.power, n);
        }
        applyCam();  // before the cables: their positions are measured on screen
        renderCables();
        P.BleepAppMenu.refresh();
        const empty = $("empty");
        if (!s.board) {
          empty.hidden = false;
          empty.textContent = "No board in this set. Add Bleep Board to any track in Live.";
        } else if (!nodesAt(level()).length) {
          empty.hidden = false;
          empty.textContent = "Double-click or press Tab to add a module.";
        } else {
          empty.hidden = true;
        }
      }

      function renderCrumbs() {
        const c = $("crumbs");
        c.innerHTML = "";
        if (!s.path.length) return;  // at the top level there is nothing to show: the board is the only place
        const crumb = (label, depth) => {
          const here = depth === s.path.length;
          const a = el(here ? "span" : "a", here ? "here" : "", label);
          if (!here) a.addEventListener("click", () => leaveTo(depth));
          c.appendChild(a);
        };
        crumb("Board", 0);
        s.path.forEach((id, i) => {
          c.appendChild(el("span", "sep", "›"));
          const n = nodeById(id);
          crumb(n ? n.name : "?", i + 1);
        });
      }

      function signalColour(t) { return `var(--sig-${t || "control"})`; }

      function renderNodes() {
        nodesEl.innerHTML = "";
        scopes.clear();
        if (!s.board) return;
        const groups = new Map();
        for (const n of nodesAt(level())) {
          const q = ownerOf(n.id);
          if (!q) { nodesEl.appendChild(nodeElement(n)); continue; }
          const k = groupKey(q, level());
          if (!groups.has(k)) groups.set(k, { q, nodes: [] });
          groups.get(k).nodes.push(n);
        }
        for (const [k, g] of groups) renderGroup(k, g);
      }

      // The modules a panel's controls were made with (panel.modules) sit in one stack per panel and level, folded to
      // its header until opened; panel.groups[level] says where the stack is. Their own x and y are not used.
      const groupOpen = new Set();   // "panelId|level" of the stacks that are open
      const kGroupHead = 30, kGroupGap = 8;
      const ownerOf = (nodeId) => panelList().find((q) => (q.modules || []).includes(nodeId)) || null;
      const groupKey = (q, lvl) => q.id + "|" + lvl;
      // panel.groups is keyed by level: a cell's id, or "@board" for the top level (a JSON key can't be empty).
      const levelKey = (lvl) => lvl || "@board";
      const groupAt = (q, lvl) => (q.groups && q.groups[levelKey(lvl)]) || { x: 40, y: 40 };

      function renderGroup(key, g) {
        const open = groupOpen.has(key), at = groupAt(g.q, level());
        const h = el("div", "pgroup" + (open ? " open" : ""));
        h.dataset.key = key;
        h.dataset.members = " " + g.nodes.map((n) => n.id).join(" ") + " ";
        h.style.left = at.x + "px";
        h.style.top = at.y + "px";
        h.append(el("span", "pg-arrow", open ? "▾" : "▸"), el("span", "pg-title", "▦ " + g.q.name),
                 el("small", "", `${g.nodes.length} module${g.nodes.length === 1 ? "" : "s"}`));
        h.title = `Modules made for the controls of the panel “${g.q.name}”. Click to ${open ? "fold" : "open"}, drag to move.`;
        nodesEl.appendChild(h);
        if (open) {
          let y = at.y + kGroupHead + kGroupGap;
          for (const n of g.nodes) {
            const e = nodeElement(n);
            e.classList.add("grouped");
            e.style.left = at.x + "px";
            e.style.top = y + "px";
            nodesEl.appendChild(e);
            y += e.offsetHeight + kGroupGap;
          }
        }
        h.addEventListener("pointerdown", (ev) => onGroupPointerDown(ev, h, key, g));
      }

      function onGroupPointerDown(ev, h, key, g) {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        canvas.focus();
        hidePopovers();
        const start = { x: ev.clientX, y: ev.clientY }, c = cam(), lvl = level(), at0 = groupAt(g.q, lvl);
        const ids = new Set(g.nodes.map((n) => n.id));
        const members = [...nodesEl.querySelectorAll(".node.grouped")].filter((e) => ids.has(e.dataset.id))
          .map((e) => ({ e, x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
        let moved = false, dx = 0, dy = 0;
        const move = (m) => {
          dx = Math.round((m.clientX - start.x) / c.z);
          dy = Math.round((m.clientY - start.y) / c.z);
          if (!moved && Math.hypot(dx, dy) < 3) return;
          moved = true;
          h.style.left = at0.x + dx + "px";
          h.style.top = at0.y + dy + "px";
          for (const o of members) { o.e.style.left = o.x + dx + "px"; o.e.style.top = o.y + dy + "px"; }
          renderCables();
          positionCablePop();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (moved) {
            edit("move panel modules", (b) => {
              const q = panelById(g.q.id, b);
              if (!q) return false;
              (q.groups || (q.groups = {}))[levelKey(lvl)] = { x: at0.x + dx, y: at0.y + dy };
            });
          } else {
            groupOpen.has(key) ? groupOpen.delete(key) : groupOpen.add(key);
            renderNodes();
            renderCables();
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      /// Opens the stack a module is in and selects it (from the panel editor).
      function revealPanelModule(id) {
        const q = ownerOf(id), n = nodeById(id);
        if (!n) return;
        if (!q) return goToNode(id);   // a control made with panel-wiring: its module is in the Panel cell
    
        const lvl = n.parent || "";
        if (level() !== lvl && lvl && !s.path.length) enterCell(lvl);
        if (level() !== lvl) return;
        groupOpen.add(groupKey(q, lvl));
        renderNodes();
        sel.clear();
        sel.add(id);
        renderSelection();
        renderCables();
        centreOn(groupAt(q, lvl));
      }

      function jackRow(n, jack, name, type, dir, extraClass) {
        const row = el("div", `jack ${dir}${extraClass ? " " + extraClass : ""}`);
        row.dataset.node = n.id;
        row.dataset.jack = jack;
        row.dataset.type = type;
        row.style.setProperty("--c", signalColour(type));
        const dot = el("span", "dot");
        if (dir === "in") row.append(dot, el("span", "jl", name));
        else {
          const sc = el("canvas", "scope");
          row.append(el("span", "jl", name), sc, dot);
          if (type !== "notes" && type !== "patchbay") scopes.set(n.id + "|" + jack, { canvas: sc, hist: new Float32Array(40), head: 0 });
        }
        return row;
      }

      function nodeElement(n) {
        const t = typeOf(n);
        const e = el("div", "node");
        e.dataset.id = n.id;
        if (isPort(n)) e.classList.add("port");
        if (isCellLike(n)) e.classList.add("cell");
        if (n.type === "voice-cell") e.classList.add("voice");
        if (isBoundary(n)) e.classList.add("boundary");
        if (isGhost(n)) e.classList.add("ghost");
        if (n.muted) e.classList.add("muted");
        if (n.bypassed) e.classList.add("bypassed");
        if (sel.has(n.id)) e.classList.add("selected");
        if (s.trace && !s.trace.has(n.id)) e.classList.add("dim");
        e.style.left = n.x + "px";
        e.style.top = n.y + "px";
        e.style.setProperty("--accent", n.colour || t.colour || "#4fd1c5");

        const head = el("div", "n-head");
        head.appendChild(el("span", "n-title", n.name));
        let sub = t.name;
        if (isPort(n)) sub = isGhost(n) ? (portInfo(n) ? "inactive" : "not in set") : n.track || t.name;
        if (n.type === "cell") sub = "Cell";
        if (n.type === "voice-cell") sub = "×" + paramValue(n, "voices");
        if (isBoundary(n)) sub = "";
        const missingModule = !s.types[n.type] && !isCellLike(n) && !isBoundary(n) && !isPort(n);
        if (missingModule) { e.classList.add("missing"); sub = "not installed"; }
        if (n.name === sub) sub = t.name;
        if (sub) head.appendChild(el("span", "n-sub", sub));
        if (hasPanel(n)) {
          const pb = el("button", "n-panel", "▦");
          pb.title = "Open the front panel";
          pb.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          pb.addEventListener("dblclick", (ev) => ev.stopPropagation());
          pb.addEventListener("click", (ev) => { ev.stopPropagation(); cellPanels(ev, n); });
          head.appendChild(pb);
        }
        if (isCellLike(n) && n.help && n.help.text) {
          const hb = el("button", "n-help" + (hasPanel(n) ? "" : " first"), "?");
          hb.title = "Help for this cell";
          hb.setAttribute("aria-label", "Help for " + n.name);
          hb.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          hb.addEventListener("dblclick", (ev) => ev.stopPropagation());
          hb.addEventListener("click", (ev) => { ev.stopPropagation(); showCellHelp(n, hb); });
          head.appendChild(hb);
        }
        e.appendChild(head);
        if (missingModule) {  // the module of this node is not on this machine: the node waits, with its settings, and its cables are kept
          const note = el("div", "n-missing", n.type);
          e.appendChild(note);
          if (P.BleepLibraryView) {
            const b = el("button", "n-install", "Install");
            b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
            b.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              b.disabled = true;
              b.textContent = "Installing…";
              const ok = await P.BleepLibraryView.installType(n.type);
              if (!ok) { b.disabled = false; b.textContent = "Install"; note.textContent = n.type + ": " + (P.BleepLibraryView.lastMessage() || "not found in the library"); }
            });
            e.appendChild(b);
          }
        }
        if (n.type === "voice-cell") {
          // One dot per voice, lit while it plays (spec §9.3); a warning if the voice makes no sound.
          const dots = el("div", "n-voices");
          const count = paramValue(n, "voices");
          for (let k = 0; k < count; k++) dots.appendChild(el("span", "vdot"));
          const vout = s.board.nodes.find((m) => m.parent === n.id && m.type === "voice-out");
          if (!vout || !s.board.cables.some((c) => c.to.node === vout.id && c.to.jack === "l"))
            dots.appendChild(el("span", "n-warn", "no sound"));
          e.appendChild(dots);
        }

        const body = el("div", "n-body");
        const ins = el("div", "n-ins"), outs = el("div", "n-outs");
        for (const j of inputsOf(n)) {
          const connected = s.board.cables.some((c) => c.to.node === n.id && c.to.jack === j.id);
          const shown = isShown(n, j);
          if (!shown && !connected) continue;  // hidden in this mode; its cables are kept (dimmed)
          const row = jackRow(n, j.id, shownName(n, j), j.type, "in",
            (connected ? "connected" : "") + (shown ? "" : " unused"));
          if (j.normal && !connected) {
            const src = inputsOf(n).find((k) => k.id === j.normal);
            row.title = `Unpatched: follows ${src ? shownName(n, src) : j.normal}`;
          }
          ins.appendChild(row);
        }
        for (const p of modParams(n))
          if (s.board.cables.some((c) => c.to.node === n.id && c.to.jack === p.id))
            ins.appendChild(jackRow(n, p.id, p.name, "control", "in", "param connected"));
        if (n.type === "cell-out") {
          const add = jackRow(n, "+", "new output", "control", "in", "add");
          ins.appendChild(add);
        }
        // Long output lists (MIDI In, Macros) show the first few and the patched ones.
        const all = outputsOf(n).filter((j) => isShown(n, j) || s.board.cables.some((c) => c.from.node === n.id && c.from.jack === j.id));
        const shown = all.length <= kShownOutputs + 1 || expanded.has(n.id) ? all
          : all.filter((j, i) => i < kShownOutputs || s.board.cables.some((c) => c.from.node === n.id && c.from.jack === j.id));
        for (const j of shown) outs.appendChild(jackRow(n, j.id, shownName(n, j), j.type, "out", isShown(n, j) ? "" : "unused"));
        if (all.length > kShownOutputs + 1) {
          const more = el("div", "jack out more", expanded.has(n.id) ? "show less" : `+ ${all.length - shown.length} more`);
          more.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            expanded.has(n.id) ? expanded.delete(n.id) : expanded.add(n.id);
            renderNodes();
            renderCables();
          });
          outs.appendChild(more);
        }
        if (n.type === "cell-in" || n.type === "voice-in") outs.appendChild(jackRow(n, "+", "new input", "control", "out", "add"));
        body.append(ins, outs);
        e.appendChild(body);

        e.addEventListener("pointerdown", (ev) => onNodePointerDown(ev, n));
        e.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          if (ev.target.closest(".n-title")) return startRename(n, e);
          if (isCellLike(n)) enterCell(n.id);
        });
        e.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // On a knob row of the node: add it to a panel.
          const row = ev.target.closest(".jack.param");
          if (row) {
            const items = knobMenuItems(n.id, row.dataset.jack);
            if (items.length) return showMenu(ev, items);
          }
          if (!sel.has(n.id)) { sel.clear(); sel.add(n.id); renderSelection(); }
          showNodeMenu(n, ev);
        });
        return e;
      }

      function renderSelection() {
        for (const e of nodesEl.children) e.classList.toggle("selected", sel.has(e.dataset.id));
      }

      /// Centre of a jack's dot, in world coordinates.
      function jackPos(nodeId, jack, dir) {
        const row = nodesEl.querySelector(`.jack.${dir}[data-node="${nodeId}"][data-jack="${CSS.escape(jack)}"]`);
        if (!row) {   // in a folded stack: the cable ends at its header
          const h = nodesEl.querySelector(`.pgroup[data-members*=" ${nodeId} "]`);
          if (!h) return null;
          const r = h.getBoundingClientRect();
          return toWorld(dir === "out" ? r.right : r.left, r.top + r.height / 2);
        }
        const d = row.querySelector(".dot").getBoundingClientRect();
        return toWorld(d.left + d.width / 2, d.top + d.height / 2);
      }

      function cablePath(a, b) {
        const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
        return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
      }

      // Signal pulse: a faint light travelling along each cable whose source
      // output moves, brighter the more it moves (state.activity).
      const pulses = new Map();   // cable id → {path, node, jack}
      const pulseLevel = new Map();  // "node|jack" → smoothed 0..1

      const cableHighlight = "#ffffff";   // hovered and selected cables

      // Draws a highlighted copy of the cable at the end of the SVG: on top of all other cables, and it
      // never moves the element under the pointer (which would end the hover).
      function setHoverCable(id, path) {
        s.hoverCable = id;
        cablesEl.querySelectorAll(".cable.hover").forEach((e) => e.remove());
        if (!id || !path) return hideMeter();
        const cable = s.board && s.board.cables.find((k) => k.id === id);
        if (cable) showMeter(cable); else hideMeter();
        const o = path.cloneNode(false);
        o.classList.remove("ghost", "dim", "selected");
        o.classList.add("hover");
        o.style.setProperty("--c", cableHighlight);
        cablesEl.append(o);
      }

      function renderCables() {
        cablesEl.innerHTML = "";
        pulses.clear();
        if (!s.board) return;
        const here = new Set(nodesAt(level()).map((n) => n.id));
        // The selected cable is drawn last, so it lies on top of the others.
        const ordered = [...s.board.cables.filter((c) => !isCableSel(c.id)), ...s.board.cables.filter((c) => isCableSel(c.id))];
        if (s.hoverCable && !s.board.cables.some((c) => c.id === s.hoverCable)) s.hoverCable = null;
        let hoverPath = null;
        for (const c of ordered) {
          if (!here.has(c.from.node) || !here.has(c.to.node)) continue;
          const a = jackPos(c.from.node, c.from.jack, "out"), b = jackPos(c.to.node, c.to.jack, "in");
          if (!a || !b) continue;
          const src = nodeById(c.from.node), dst = nodeById(c.to.node);
          const type = outType(src, c.from.jack) || "control";
          const d = cablePath(a, b);
          const p = document.createElementNS(SVGNS, "path");
          p.setAttribute("d", d);
          p.setAttribute("class", `cable ${type}`);
          p.style.setProperty("--c", signalColour(type));
          if (isGhost(src) || isGhost(dst)) p.classList.add("ghost");
          if (s.trace && !(s.trace.has(src.id) && s.trace.has(dst.id))) p.classList.add("dim");
          if (isCableSel(c.id)) { p.classList.add("selected"); p.style.setProperty("--c", cableHighlight); }
          const hit = document.createElementNS(SVGNS, "path");
          hit.setAttribute("d", d);
          hit.setAttribute("class", "cable-hit");
          hit.dataset.id = c.id;
          const title = document.createElementNS(SVGNS, "title");
          title.textContent = `${src.name} › ${jackName(src, c.from.jack, true)}  →  ${dst.name} › ${jackName(dst, c.to.jack, false)}  (${Math.round(c.amount * 100)}%)`;
          hit.appendChild(title);
          hit.addEventListener("pointerenter", () => { if (!cableDragging()) setHoverCable(c.id, p); });
          hit.addEventListener("pointerleave", () => setHoverCable(null));
          hit.addEventListener("pointermove", (ev) => { hit.style.cursor = cableEndAt(ev, a, b) ? "grab" : ""; });
          const selectCable = (ev) => {
            sel.clear();
            if ((ev.shiftKey || ev.ctrlKey || ev.metaKey) && s.selCable) {   // shift-, ctrl- or ⌘-click adds the cable to the selection, or takes it out
              if (c.id === s.selCable) { s.selCable = selMore.size ? [...selMore][0] : null; selMore.delete(s.selCable); }
              else selMore.has(c.id) ? selMore.delete(c.id) : selMore.add(c.id);
            } else {
              clearCableSel();
              s.selCable = c.id;
            }
            renderSelection();
            renderCables();
            if (s.selCable && !selMore.size) showCablePop(s.board.cables.find((k) => k.id === s.selCable));
            else $("cable-pop").hidden = true;
          };
          hit.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            if (ev.button !== 0) return;   // the right button is the cable menu
            const end = ev.shiftKey || ev.ctrlKey || ev.metaKey ? null : cableEndAt(ev, a, b);
            if (!end) return selectCable(ev);
            // Near one end of the cable: dragging picks that end up (the input end onto another output, the output end onto
            // another input); a click without moving selects the cable as usual.
            const x0 = ev.clientX, y0 = ev.clientY;
            const stop = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
            const mv = (e) => {
              if (Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return;
              stop();
              if (end === "from") startSourceDrag(e, c);
              else startCableDrag(e, c.from.node, c.from.jack, c);
            };
            const up = () => { stop(); selectCable(ev); };
            window.addEventListener("pointermove", mv);
            window.addEventListener("pointerup", up);
          });
          hit.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.ctrlKey && ev.button === 0) return;   // ctrl-click on a Mac: a selection click, not the menu
            if (!isCableSel(c.id)) { sel.clear(); clearCableSel(); s.selCable = c.id; renderSelection(); renderCables(); }
            showCableMenu(ev);
          });
          cablesEl.append(p);
          if (!p.classList.contains("ghost") && !p.classList.contains("dim")) {
            const glow = document.createElementNS(SVGNS, "path");
            glow.setAttribute("d", d);
            glow.setAttribute("class", "cable-pulse");
            glow.style.setProperty("--c", signalColour(type));
            const ls = liveSource(c.from.node, c.from.jack), pkey = ls.node + "|" + ls.jack;   // a cell has no state: read the module behind it
            glow.style.setProperty("--act", pulseLevel.get(pkey) || 0);
            cablesEl.append(glow);
            pulses.set(c.id, { path: glow, key: pkey });
          }
          cablesEl.append(hit);
          if (c.id === s.hoverCable) hoverPath = p;
        }
        if (hoverPath) setHoverCable(s.hoverCable, hoverPath);
        else if (!cableDragging()) hideMeter();
        if (!s.selCable) $("cable-pop").hidden = true;
      }

      const kGrabRadius = 16;   // px: how close to a cable's end a drag picks that end up
      /// Which end of the cable (from → "from", to → "to") the pointer is near, if any.
      function cableEndAt(ev, a, b) {
        const w = toWorld(ev.clientX, ev.clientY), z = cam().z;
        if (Math.hypot(w.x - a.x, w.y - a.y) * z <= kGrabRadius) return "from";
        if (Math.hypot(w.x - b.x, w.y - b.y) * z <= kGrabRadius) return "to";
        return null;
      }

      // ------------------------------------------------------------ cable popover
      function showCablePop(c) {
        const pop = $("cable-pop");
        pop.innerHTML = "";
        const src = nodeById(c.from.node), dst = nodeById(c.to.node);
        pop.appendChild(el("span", "", `${jackName(src, c.from.jack, true)} → ${jackName(dst, c.to.jack, false)}`));
        const r = el("input");
        r.type = "range"; r.min = -1; r.max = 1; r.step = 0.01; r.value = c.amount;
        const v = el("span", "v", Math.round(c.amount * 100) + "%");
        r.addEventListener("pointerdown", () => gesture());
        r.addEventListener("input", () => {
          const a = parseFloat(r.value);
          v.textContent = Math.round(a * 100) + "%";
          const cc = s.board.cables.find((x) => x.id === c.id);
          if (cc) cc.amount = a;
          native("setAmount", c.id, a);
        });
        const del = el("button", "", "Delete");
        del.addEventListener("click", () => removeCable(c.id));
        pop.append(r, v, del);
        pop.hidden = false;
        pop.dataset.cable = c.id;
        positionCablePop();
      }
      function positionCablePop() {
        const pop = $("cable-pop");
        if (pop.hidden || !s.board) return;
        const c = s.board.cables.find((x) => x.id === pop.dataset.cable);
        if (!c) { pop.hidden = true; return; }
        const a = jackPos(c.from.node, c.from.jack, "out"), b = jackPos(c.to.node, c.to.jack, "in");
        if (!a || !b) { pop.hidden = true; return; }
        const m = toCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
        pop.style.left = m.x - pop.offsetWidth / 2 + "px";
        pop.style.top = m.y + 14 + "px";
      }

      return {
        render, signalColour, renderNodes, groupOpen, ownerOf, groupKey, levelKey, revealPanelModule,
        jackRow, renderSelection, jackPos, cablePath, pulses, pulseLevel, setHoverCable, renderCables,
        showCablePop, positionCablePop,
      };
    },
  };
})();
