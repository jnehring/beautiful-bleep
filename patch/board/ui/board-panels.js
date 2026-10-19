// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-panels.js — front panels: the panels of a board and of its cells, their menus, building and opening them (doc/specs/panels.md).
//
// P.BoardPanels.create(s)   s: the board and page helpers it needs (see the destructuring below); `board`, `types`, `path`, `trace`,
// `pluginMode` are getters (`path` and `trace` have setters).
//   returns the panel helpers listed at the end of this file
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardPanels = {
    create(s) {
      const { $, addControlModule, canvas, centreOn, clone, closeUnpinnedViews, closeView, descendants, edit, el, front, gesture, hidePopovers, inType, inputsOf, isBoundary, isCellLike, isPort, isStructural, makeApi, nodeById, nodesAt, notice, outputsOf, pathTo, pinTitle, placeWin, render, revealPanelModule, sel, selectedNodes, showMenu, typeOf, uid, views, watch } = s;
      // Panels live in the board document (board.panels, doc/specs/panels.md): a cell's
      // panel names nodes inside the cell, a board panel any node; a module panel
      // ("for") is loaded by other panels and names its module "this".
      const panelList = () => (s.board && s.board.panels) || [];
      const panelById = (id, b = s.board) => ((b && b.panels) || []).find((q) => q.id === id);
      const panelsOfCell = (cellId) => panelList().filter((q) => q.cell === cellId);
      const boardPanels = () => panelList().filter((q) => !q.cell && !q.for);
      const hasPanel = (n) => isCellLike(n) && panelsOfCell(n.id).length > 0;
      const panelOpen = (id) => views.has("panel:" + id);
      function togglePanel(id) {
        if (panelOpen(id)) closeView("panel:" + id);
        else openPanel(id);
      }
      /// `list` and every panel they load, directly or not.
      function panelsWithLoaded(list) {
        const out = new Set(list);
        for (const q of out) for (const c of q.controls) {
          const sub = c.type === "panel" && panelById(c.panel);
          if (sub) out.add(sub);
        }
        return [...out];
      }
      /// Panels of cells that are gone, and module panels nobody loads, go with the edit.
      function prunePanels(b) {
        if (!b.panels) return;
        const ids = new Set(b.nodes.map((n) => n.id));
        let list = b.panels.filter((q) => !q.cell || ids.has(q.cell));
        for (let again = true; again;) {
          const loaded = new Set(list.flatMap((q) => q.controls.filter((c) => c.type === "panel").map((c) => c.panel)));
          const next = list.filter((q) => !q.for || loaded.has(q.id));
          again = next.length !== list.length;
          list = next;
        }
        if (list.length) b.panels = list; else delete b.panels;
      }

      /// ▦ on a cell: its panel, or a list when it has several.
      function cellPanels(ev, cell) {
        const mine = panelsOfCell(cell.id);
        if (mine.length === 1) return togglePanel(mine[0].id);
        showMenu(ev, mine.map((q) => ({ label: q.name, run: () => togglePanel(q.id) })));
      }
      /// The toolbar's Panels list.
      function panelsMenu(ev) {
        const items = [];
        const mine = boardPanels();
        for (const q of mine) items.push({ label: q.name, key: q.open ? "on load" : "", run: () => togglePanel(q.id) });
        const cellPanelItems = panelList().filter((q) => q.cell && nodeById(q.cell))
          .map((q) => ({ label: `${nodeById(q.cell).name}: ${q.name}`, run: () => togglePanel(q.id) }));
        if (cellPanelItems.length) items.push({ label: "Cell panels", items: cellPanelItems });
        if (items.length) items.push("-");
        items.push({ label: "New board panel", run: () => newPanel("") });
        const sel1 = selectedNodes().filter(isCellLike);
        if (sel1.length === 1) {
          items.push({ label: `New panel for “${sel1[0].name}”`, run: () => newPanel(sel1[0].id) });
          items.push({ label: `Build panel from “${sel1[0].name}”`, run: () => buildPanel(sel1[0].id) });
        }
        showMenu(ev, items);
      }
      // ---- panel controls that are modules (panel-wiring.js) ------------------------------------------------------------
      /// What `panel-wiring.js` needs: the types, new ids, and where a new control goes on its panel.
      const wiringEnv = () => ({ types: s.types, typeOf, uid, hasView: (n) => !isStructural(n), knobControl: BleepPanelBuild.knobControl, place: (q, type, extra) => BleepPanelEditor.placeControl(q, type, extra, q.tabs && q.tabs[0] ? q.tabs[0].id : null) });
      /// The panels a control can go on (those that already have it are left out), then "New panel".
      /// `have`: [{panel, control}] the controls it has; `add(where)`: makes one on a panel id or "new".
      const panelTitle = (q) => { const c = q.cell && nodeById(q.cell); return c && c.name !== q.name ? `${c.name}: ${q.name}` : q.name; };
      function panelChoices(have, add) {
        const onIt = new Set(have.map((h) => h.panel.id));
        const free = BleepPanelWiring.panelsFor(s.board).filter((q) => !onIt.has(q.id));
        return [...free.map((q) => ({ label: panelTitle(q), run: () => add(q.id) })), ...(free.length ? ["-"] : []), { label: "New panel", run: () => add("new") }];
      }
      /// "Show on panel" and "Remove from panel" for what a node already has on panels: [{panel, control, what}].
      function panelExtras(have) {
        const items = [];
        const show = (q) => () => { if (!panelOpen(q.id)) togglePanel(q.id); };
        const panels = [...new Map(have.map((h) => [h.panel.id, h.panel])).values()];
        if (panels.length === 1) items.push({ label: `Show on panel “${panels[0].name}”`, run: show(panels[0]) });
        else if (panels.length) items.push({ label: "Show on panel", items: panels.map((q) => ({ label: panelTitle(q), run: show(q) })) });
        const drop = (h) => () => removePanelControl(h.panel.id, h.control.id);
        const name = (h) => (h.what ? `${h.what} · ` : "") + panelTitle(h.panel);
        if (have.length === 1) items.push({ label: `Remove from panel “${have[0].panel.name}”${have[0].what ? ` (${have[0].what})` : ""}`, run: drop(have[0]) });
        else if (have.length) items.push({ label: "Remove from panel", items: have.map((h) => ({ label: name(h), run: drop(h) })) });
        return items;
      }
      /// "Add to panel ▸" for a knob, and, for what is already on panels, show and remove.
      function panelMenuItems(n, have, add) {
        return [{ label: "Add to panel", items: panelChoices(have, add) }, ...panelExtras(have)];
      }
      /// Right-click a module (on the board, or in its view): "Add to panel ▸" its control (a controller module: Dial, Button, Keyboard …),
      /// the whole module view, or one of its parts. `focus`: the part under the pointer in a view (it is offered first), null: the view's
      /// background, undefined: the board.
      function panelMenuFor(n, focus) {
        if (!window.BleepPanelWiring) return [];
        const env = wiringEnv();
        const asControl = BleepPanelWiring.canAddModule(s.board, n), asView = BleepPanelWiring.canAddView(s.board, env, n);
        if (!asControl && !asView) return [];
        const haveControl = asControl ? BleepPanelWiring.moduleControls(s.board, n).map((h) => ({ ...h, what: "control" })) : [];
        const haveView = asView ? BleepPanelWiring.viewControls(s.board, n).map((h) => ({ ...h, what: h.part ? (partList(n).find((p) => p.id === h.part) || { name: "part" }).name : "whole view" })) : [];
        const control = () => ({ label: "As control", items: panelChoices(haveControl, (where) => addToPanel(n.id, where, (b, m) => BleepPanelWiring.addModule(b, env, m, where))) });
        const view = (part) => ({
          label: part ? (part.kind === "controls" ? `Knobs: ${part.name}` : part.name) : "Whole module view",
          items: panelChoices(haveView.filter((h) => h.part === (part ? part.id : null)), (where) => addToPanel(n.id, where, (b, m) => BleepPanelWiring.addView(b, env, m, part, where))),
        });
        const parts = asView ? partList(n) : [];
        let items;
        const focused = parts.find((p) => p.id === focus);
        if (focused) items = [{ ...view(focused), label: `Add “${focused.name}” to panel` }, { ...view(null), label: "Add whole module view to panel" }];
        else {
          const sub = [];
          if (asControl) sub.push(control());
          if (asView) sub.push(view(null), ...(parts.length ? ["-", ...parts.map(view)] : []));
          items = [{ label: "Add to panel", items: sub }];
        }
        return [...items, ...panelExtras([...haveControl, ...haveView])];
      }
      /// The parts of a module's view a panel can show alone.
      const partList = (n) => (window.BleepView && BleepView.partsOf ? BleepView.partsOf(typeOf(n)) : []);
      /// A module on the board: its control, its view or a part of it.
      const controllerMenuItems = (n) => panelMenuFor(n);
      /// A knob (or setting) of a module: a control wired straight to it.
      function knobMenuItems(nodeId, paramId) {
        const n = nodeById(nodeId);
        if (!n || !window.BleepPanelWiring || BleepPanelWiring.belongsToPanel(s.board, n) || !(typeOf(n) || {}).params.some((p) => p.id === paramId)) return [];
        return panelMenuItems(n, BleepPanelWiring.knobControls(s.board, n, paramId), (where) => addToPanel(nodeId, where, (b, m) => BleepPanelWiring.addKnob(b, wiringEnv(), m, paramId, where)));
      }
      function addToPanel(nodeId, where, make) {
        let made = null;
        const done = edit("add to panel", (b) => {
          const n = nodeById(nodeId, b);
          made = n ? make(b, n) : { error: "the module is gone" };
          if (made.error) return false;
        });
        Promise.resolve(done).then(() => {
          if (!made || made.error) return notice(`Could not add it to the panel: ${made ? made.error : "nothing happened"}.`);
          notice(`Added “${made.control.label}” to the panel “${made.panel.name}”.`);
          if (where === "new" && !s.pluginMode) openPanel(made.panel.id, { edit: true });
        });
      }
      function removePanelControl(panelId, controlId) {
        edit("remove panel control", (b) => { if (!BleepPanelWiring.remove(b, panelId, controlId)) return false; });
      }
      /// Goes to a node: into the cells around it, selected and in the middle.
      function goToNode(id) {
        const n = nodeById(id);
        if (!n) return;
        s.path = pathTo(id);
        sel.clear();
        sel.add(id);
        s.trace = null;
        closeUnpinnedViews();
        render();
        centreOn(n);
      }
      /// A first panel for a cell, built from what is inside it.
      async function buildPanel(cellId) {
        const cell = nodeById(cellId);
        if (!cell) return;
        const order = descendants(cellId).filter((m) => !isBoundary(m) || m.type === "voice-out" || m.type === "cell-out")
          .sort((a, b) => a.x - b.x || a.y - b.y);
        const doc = BleepPanelBuild.build(cell, { nodes: order, types: s.types, typeOf, inputsOf, cables: s.board.cables });
        doc.id = uid("p");
        await edit("build panel", (b) => { (b.panels || (b.panels = [])).push(doc); });
        if (!s.pluginMode) openPanel(doc.id);
      }
      async function newPanel(cellId, quiet) {
        const cell = cellId && nodeById(cellId);
        const id = uid("p");
        const name = cell ? cell.name : "Panel";
        await edit("new panel", (b) => {
          (b.panels || (b.panels = [])).push({
            id, name, ...(cell ? { cell: cellId } : {}), cols: 40, rows: 24,
            controls: [{ id: "c1", type: "label", at: [1, 0], size: [24, 2], text: name, style: "title" }],
          });
        });
        if (!quiet) openPanel(id, { edit: true });
        return id;
      }
      /// The panel that opens with the board (panel.open: "window" or "full").
      function openStartPanel() {
        const q = panelList().find((x) => x.open);
        if (q && !panelOpen(q.id)) openPanel(q.id, { full: q.open === "full" });
      }

      /// What the nodes a panel names look like to it. A module panel's own module is "this".
      function panelHost(doc, embeddedViews) {
        const standIn = doc.for && { id: "this", name: (s.types[doc.for.module] || {}).name || doc.for.module, type: doc.for.module, params: {} };
        const lookup = (id) => (id === "this" ? standIn : nodeById(id));
        return {
          node: (key, bound) => (key === "this" ? bound || standIn || null : nodeById(key)),
          param: (id, pid) => {
            const m = lookup(id);
            const def = m && typeOf(m).params.find((q) => q.id === pid);
            return def ? { node: m, def } : null;
          },
          value: (id, pid) => {
            const m = lookup(id), def = typeOf(m).params.find((q) => q.id === pid);
            return (m.params && m.params[pid]) ?? def.default;
          },
          set: (id, pid, v) => makeApi(id).setParam(pid, v),
          begin: gesture,
          // A panel control wired to a cell's jack or notes drives a hidden source the engine makes (id "~panel:control:wire").
          jackType: (panel, jack) => { const c = panel.cell && nodeById(panel.cell); const j = c && inputsOf(c).find((q) => q.id === jack); return j ? j.type : null; },
          nodeJackType: (id, jack) => { const m = nodeById(id); return m ? inType(m, jack) : null; },
          command: (id, cmd, v) => native("command", id, cmd, v),
          source: (sid, v) => native("setParam", sid, "value", v),
          press: (sid, down) => native("perform", sid, down ? "press" : "release", []),
          // A Button module in Toggle mode: its new state is saved in its data, as its own view does, then pressed and released.
          toggle: (id) => {
            const m = nodeById(id);
            if (!m) return;
            const next = !(m.data && m.data.on);
            m.data = { on: next };
            const api = makeApi(id);
            api.setData(m.data);
            api.perform("press", next ? 1 : 0);
            api.perform("release");
          },
          note: (sid, action, args) => native("perform", sid, action, args),
          save: (pid, cid, x) => edit("panel control", (b) => {
            const q = (b.panels || []).find((r) => r.id === pid), c = q && q.controls.find((r) => r.id === cid);
            if (!c) return false;
            c.value = x;
          }),
          view: (id) => {
            const m = nodeById(id);
            if (!m || isStructural(m)) return null;
            if (!m.params) m.params = {};
            const bv = BleepView.create(typeOf(m), clone(m), makeApi(id));
            embeddedViews.push({ id, bv });
            return bv;
          },
          refreshView: (id, bv) => { const m = nodeById(id); if (m) bv.refresh(m); },
        };
      }
      /// What the editor may wire: the nodes of the panel's cell (or the whole board), in tree order.
      function panelScope(doc) {
        if (doc.for) {
          const t = s.types[doc.for.module] || { name: doc.for.module, params: [], outputs: [] };
          return [{ id: "this", name: t.name, type: t.type, depth: 0, params: t.params, outputs: t.outputs, inputs: t.inputs || [], buttons: t.buttons || [], view: true }];
        }
        const out = [];
        const walk = (parent, depth) => {
          for (const n of nodesAt(parent)) {
            if (isBoundary(n) || isPort(n)) continue;
            const t = typeOf(n);
            if (t.params.length || t.outputs.length || n.type === "voice-cell") out.push({ id: n.id, name: n.name, type: t.type, depth, params: t.params, outputs: outputsOf(n), inputs: inputsOf(n).filter((j) => j.type !== "audio" && j.type !== "notes"), buttons: t.buttons || [], view: !isStructural(n) });
            if (isCellLike(n)) walk(n.id, depth + 1);
          }
        };
        if (doc.cell) {
          const root = nodeById(doc.cell);
          if (!root) return [];
          if (typeOf(root).params.length) out.push({ id: root.id, name: root.name, type: root.type, depth: 0, params: typeOf(root).params, outputs: outputsOf(root), view: false });
          walk(doc.cell, 1);
        } else walk("", 0);
        return out;
      }

      /// The panel as drawn: what moving a control (its saved "value") does not change.
      const layoutOf = (doc) => JSON.stringify(doc, (k, v) => (k === "value" ? undefined : v));

      /// A panel in a floating window: played, or (✎) edited. ⤢ fills the canvas.
      function openPanel(panelId, opts = {}) {
        const doc0 = panelById(panelId);
        if (!doc0) return;
        const key = "panel:" + panelId;
        if (views.has(key)) { front(views.get(key).win); if (opts.edit) views.get(key).setEdit(true); return; }
        const state = { edit: !!opts.edit || !!doc0.for, full: !!opts.full, tab: null, json: "" };
        let play = null, editor = null, embeddedViews = [];
        const win = el("div", "vwin pwin");
        win.dataset.node = key;
        const head = el("div", "v-head");
        const tools = el("span", "pwin-tools");
        const editBtn = el("button", "", "✎");
        editBtn.title = "Edit the panel";
        const fullBtn = el("button", "", "⤢");
        fullBtn.title = "Fill the canvas";
        const pin = el("button", "pin on", "📌");
        pin.title = pinTitle(true);
        const close = el("button", "", "×");
        close.title = "Close (Esc)";
        const title = el("span", "v-title", doc0.name);
        // In edit mode a click on the title renames the panel.
        title.addEventListener("click", () => {
          if (!state.edit || title.querySelector("input")) return;
          const input = el("input", "n-rename");
          input.value = panelById(panelId).name;
          input.maxLength = 63;
          title.textContent = "";
          title.append(input);
          input.focus();
          input.select();
          let done = false;
          const finish = (save) => {
            if (done) return;
            done = true;
            const name = input.value.trim();
            title.textContent = panelById(panelId).name;
            if (save && name && name !== panelById(panelId).name)
              edit("rename panel", (b) => { const q = (b.panels || []).find((x) => x.id === panelId); if (!q) return false; BleepPanelEditor.renamePanel(q, name); });
          };
          input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
          input.addEventListener("blur", () => finish(true));
          input.addEventListener("pointerdown", (e) => e.stopPropagation());
        });
        const sub = el("span", "v-sub", doc0.cell && nodeById(doc0.cell) ? nodeById(doc0.cell).name : doc0.for ? "Module panel" : "");
        sub.hidden = !sub.textContent;
        tools.append(editBtn, fullBtn);
        head.append(title, sub, el("span", "spacer"), tools, pin, close);
        const body = el("div", "v-body");
        win.append(head, body);
        $("views").appendChild(win);
        // In edit mode the window is resized from its lower right corner (width and height); the size is kept while editing.
        const grip = el("div", "v-grip");
        grip.title = "Drag to resize";
        win.appendChild(grip);
        grip.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          grip.setPointerCapture(e.pointerId);
          const sx = e.clientX, sy = e.clientY, w0 = win.offsetWidth, h0 = body.offsetHeight;
          const maxW = canvas.clientWidth - win.offsetLeft - 8;
          const move = (m) => {
            state.w = Math.max(640, Math.min(maxW, w0 + m.clientX - sx));
            state.h = Math.max(380, h0 + m.clientY - sy);
            win.style.width = state.w + "px";
            win.style.setProperty("--pe-h", state.h + "px");
          };
          const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
          grip.addEventListener("pointermove", move);
          grip.addEventListener("pointerup", up);
        });

        const fit = () => {
          if (!play) return;
          const r = play.root;
          r.style.transform = "";
          if (state.full) {
            const s = Math.min(body.clientWidth / r.offsetWidth, body.clientHeight / r.offsetHeight, 3);
            r.style.transform = `scale(${Math.max(0.2, s)})`;
          }
        };
        const draw = () => {
          const doc = panelById(panelId);
          if (!doc) return;
          title.textContent = doc.name;
          if (play) { play.destroy(); play = null; }
          if (editor) { editor.destroy(); editor = null; }
          embeddedViews = [];
          body.innerHTML = "";
          state.json = layoutOf(doc);
          win.classList.toggle("editing", state.edit);
          if (state.edit) {
            win.style.width = state.w ? state.w + "px" : "";
            // Unless resized by hand, the editor fills the canvas below its title bar (not the whole browser window).
            win.style.setProperty("--pe-h", (state.h || Math.max(380, canvas.clientHeight - head.offsetHeight - 24)) + "px");
            win.style.top = Math.max(8, Math.min(win.offsetTop, canvas.clientHeight - win.offsetHeight - 8)) + "px";
            if (win.offsetLeft + win.offsetWidth > canvas.clientWidth) win.style.left = Math.max(8, canvas.clientWidth - win.offsetWidth - 8) + "px";   // not cut off at the right edge
          } else win.style.removeProperty("--pe-h");
          title.title = state.edit ? "Click to rename the panel" : "";
          win.classList.toggle("full", state.full && !state.edit);
          editBtn.classList.toggle("on", state.edit);
          fullBtn.classList.toggle("on", state.full);
          fullBtn.hidden = !!doc.for;
          if (state.edit) {
            editor = BleepPanelEditor.mount(body, {
              doc: () => panelById(panelId) || doc,
              panels: () => panelList(),
              mutate: (label, fn) => edit(label, (b) => {
                const q = (b.panels || []).find((x) => x.id === panelId);
                if (!q) return false;
                {
                  const make = (type, name) => addControlModule(b, q, type, name);
                  make.set = (id, pid, v) => { const n = nodeById(id, b); if (n) n.params[pid] = v; };   // v: normalised
                  fn(q, b.panels, make);
                }
              }),
              scope: () => panelScope(panelById(panelId) || doc),
              module: (id) => nodeById(id),
              cables: () => (s.board && s.board.cables) || [],
              jackName: (n, id) => {
                const j = inputsOf(n).find((q) => q.id === id) || typeOf(n).params.find((q) => q.id === id);
                return j ? j.name || id : id;
              },
              parts: (id) => { const n = nodeById(id); return n && !isStructural(n) ? partList(n) : []; },
              edit: (label, fn) => edit(label, fn),
              removeControl: (panelId, controlId) => removePanelControl(panelId, controlId),
              reveal: revealPanelModule,
              host: () => panelHost(panelById(panelId) || doc, embeddedViews),
              menu: (ev, items) => showMenu(ev, items),
              editPanel: (id) => openPanel(id, { edit: true }),
            });
          } else {
            const host = panelHost(doc, embeddedViews);
            play = BleepPanels.create(panelList(), panelId, host, { tab: state.tab, onTab: (t) => { state.tab = t; fit(); } });
            body.append(play.root);
            if (!state.full) win.style.width = Math.min(play.root.offsetWidth + 2, canvas.clientWidth - 16) + "px";
            fit();
          }
          watch();
        };
        const entry = {
          win, pinned: true, panelId,
          setEdit: (on) => { state.edit = on; state.full = state.full && !on; draw(); },
          nodes: () => (state.edit ? (editor ? editor.nodeIds() : []) : play ? play.nodeIds() : []),
          destroy: () => { if (play) play.destroy(); },
          bv: {
            update: (s) => { if (play) play.update(s); if (editor) editor.update(s); },
            refresh: (doc) => {
              if (layoutOf(doc) !== state.json) { if (editor) { state.json = layoutOf(doc); title.textContent = doc.name; embeddedViews = []; editor.rebuild(); } else draw(); return; }
              if (play || editor) {
                for (const e of embeddedViews) { const m = nodeById(e.id); if (m) e.bv.refresh(m); }
                if (play) play.refresh();
                if (editor) editor.refresh();
              }
            },
          },
        };
        views.set(key, entry);
        const r = canvas.getBoundingClientRect();
        win.style.left = "8px";
        win.style.top = "56px";
        draw();
        if (!state.full) {
          win.style.left = Math.max(8, (r.width - win.offsetWidth) / 2) + "px";
        }
        front(win);
        win.addEventListener("pointerdown", () => { hidePopovers(); front(win); });
        editBtn.addEventListener("click", () => entry.setEdit(!state.edit));
        fullBtn.addEventListener("click", () => {
          state.full = !state.full;
          if (state.full) state.edit = false;
          draw();
        });
        window.addEventListener("resize", fit);
        pin.addEventListener("click", () => { entry.pinned = !entry.pinned; pin.classList.toggle("on", entry.pinned); pin.title = pinTitle(entry.pinned); });
        close.addEventListener("click", () => closeView(key));
        head.addEventListener("pointerdown", (e) => {
          if (e.target.closest("button") || state.full) return;
          const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
          const move = (m) => placeWin(win, m.clientX - sx, m.clientY - sy);
          const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
      }

      return {
        panelList, panelById, panelsOfCell, hasPanel, panelOpen, togglePanel, panelsWithLoaded, prunePanels,
        cellPanels, panelsMenu, panelMenuFor, knobMenuItems, goToNode, buildPanel, newPanel, openStartPanel,
        openPanel, controllerMenuItems,
      };
    },
  };
})();
