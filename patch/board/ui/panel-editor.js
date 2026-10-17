// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// panel-editor.js — the panel editor (doc/specs/panels.md §3): the panel with its
// controls draggable, a palette and properties (Interface view), and the
// outline of the cell with the wires of each control (Wiring view).
//
//   const ed = BleepPanelEditor.mount(body, ctx)
//     ctx.doc()            the panel being edited (the board's copy)
//     ctx.panels()         every panel of the board (what a Panel control may load)
//     ctx.mutate(label, fn)  fn(panel, panels, makeModule) edits a copy; it is committed as one undo step.
//                          makeModule(type, name) adds a Dial, Button or Keyboard module to the board and returns its id.
//     ctx.scope()          [{id, name, type, depth, params: [def], outputs: [{id, name}], view}]: the modules a control may show
//     ctx.module(id)       a board node by id, or undefined
//     ctx.cables()         the board's cables [{from: {node, jack}, to: {node, jack}}]
//     ctx.jackName(node, id)  the name of a jack or knob of a board node
//     ctx.parts(nodeId)    [{id, name, kind}] the parts of a module's view a Module view control can show alone (BleepView.partsOf)
//     ctx.reveal(id)       goes to a module on the board (its stack, or the Panel cell) and selects it
//     ctx.edit(label, fn(b))  edits the whole board document in one undo step
//     ctx.removeControl(panelId, controlId)  removes a control made by panel-wiring, with its module and channel
//     ctx.host()           the host BleepPanels.create wants
//     ctx.menu(ev, items)  shows the board's context menu at the pointer: items are {label, key?, disabled?, run | items} or "-"
//   ed.rebuild()           the document changed: draw again
//   ed.destroy()
(function () {
  "use strict";
  const U = BleepPanels.U;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const PALETTE = [
    ["dial", "Dial", [4, 4]], ["slider", "Fader", [2, 8]], ["wheel", "Wheel", [3, 8]], ["button", "Button", [4, 3]], ["select", "Select", [6, 3]], ["keys", "Keys", [42, 7]], ["xy", "XY pad", [12, 10]],
    ["meter", "Meter", [2, 8]], ["label", "Label", [14, 2]], ["section", "Section", [16, 10]],
    ["view", "Module view", [24, 14]], ["panel", "Load panel", [20, 12]],
  ];
  // What the Add list offers: elements that do not drive anything. A control that does (a dial, a toggle, Keys, a meter) is
  // made by right-clicking its controller module on the board: "Add to panel" (panel-wiring.js).
  const FREE = ["label", "section", "view", "panel"];
  // What the Add list shows: only the ones that need no module. Module views are added from the module on the board.
  const ADD = ["label", "section"];
  const LIVE = ["view", "panel"];   // live UI elements: resized only in proportion
  const GRID = 2;   // "Snap to grid" rounds positions to multiples of this many units
  let clipboard = null;   // controls copied in any panel editor
  /// The board module a control is made with: its wire's (or meter source's) node.
  const nodeOf = (c) => {
    if (c.type === "meter") return c.source && c.source.out && [].concat(c.source.out)[0] ? [].concat(c.source.out)[0].split(".")[0] : null;
    const w = (c.wire || [])[0];
    return w ? (w.press || w.keyboard || (w.param && w.param.split(".")[0])) || null : null;
  };
  const CONTROL_MODULES = new Set(["dial", "wheel", "xy-pad", "button", "keyboard", "level-meter"]);
  const sizeOf = (type) => (PALETTE.find((p) => p[0] === type) || [0, 0, [4, 4]])[2];

  const rectOf = (c) => ({ x: c.at[0], y: c.at[1], w: c.size[0], h: c.size[1] });
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /// Grows the panel to cover its controls (never shrinks).
  function fitPanel(p) {
    for (const c of p.controls) {
      p.cols = Math.max(p.cols, c.at[0] + c.size[0] + 1);
      const tt = (p.tabs || []).find((q) => q.id === c.tab);
      const need = c.at[1] + c.size[1] + 1;
      if (tt) tt.rows = Math.max(tt.rows || 0, need);
      p.rows = Math.max(p.rows, need);
    }
  }
  // New controls are laid out like text: left to right under the panel's title label, on slots 5 units apart (a dial and a gap),
  // and onto the next row once a row is full. A slot that has a control under it is skipped.
  const FLOW = { x0: 1, step: 5, width: 36, gap: 1 };
  /// The row under the standard title label of the panel (the label on top of every tab), or 0 when it has none.
  function flowTop(p, tab) {
    const t = p.controls.filter((c) => c.type === "label" && c.style === "title" && (!c.tab || c.tab === tab)).sort((a, b) => a.at[1] - b.at[1])[0];
    return t ? t.at[1] + t.size[1] + FLOW.gap : 0;
  }
  /// The first free slot for a control of `size` on `tab` (sections don't count); below everything if it is too wide for a row.
  function freeSpotIn(p, size, tab) {
    const solid = p.controls.filter((c) => c.type !== "section" && (!c.tab || c.tab === tab)).map(rectOf).map((r) => ({ ...r, w: r.w + FLOW.gap, h: r.h + FLOW.gap }));
    const right = Math.min(p.cols - 1, FLOW.x0 + FLOW.width), top = flowTop(p, tab);
    for (let y = top; y < 400; y++)
      for (let x = FLOW.x0; x + size[0] <= right; x += FLOW.step)
        if (!solid.some((r) => overlap({ x, y, w: size[0] + FLOW.gap, h: size[1] + FLOW.gap }, r))) return [x, y];
    return [FLOW.x0, Math.max(top, ...solid.map((r) => r.y + r.h))];
  }
  /// Names a panel; the title label every new panel starts with (it shows the name) follows.
  function renamePanel(q, name) {
    const old = q.name;
    q.name = name;
    for (const c of q.controls) if (c.type === "label" && c.style === "title" && c.text === old) c.text = name;
  }
  const nextIdIn = (p) => { let n = 1; while (p.controls.some((c) => c.id === "c" + n)) n++; return "c" + n; };
  /// Puts a new control on the panel (used by the editor and by "Add to panel"); returns it.
  function placeControl(p, type, extra, tab) {
    const size = extra.size || sizeOf(type);
    const c = { id: nextIdIn(p), type, at: freeSpotIn(p, size, tab), ...extra, size };
    if (tab) c.tab = tab;
    p.controls.push(c);
    fitPanel(p);
    return c;
  }

  function mount(body, ctx) {
    let selected = null;         // the lead control id (the one the inspector shows)
    const multi = new Set();     // every selected control id (includes the lead)
    const setSel = (ids, lead) => { multi.clear(); for (const i of ids) multi.add(i); selected = lead !== undefined ? lead : ids[ids.length - 1] || null; };
    let tab = null;
    let live = null;             // the BleepPanels instance

    const root = el("div", "pe");
    root.tabIndex = 0;
    const main = el("div", "pe-main");
    // One left column: the settings of the selection on top, then what can be added and the list of controls.
    const aside = el("div", "pe-side"), insp = el("div", "pe-insp"), side = el("div", "pe-lib"), centre = el("div", "pe-centre");
    aside.append(insp, side);
    main.append(aside, centre);
    root.append(main);
    body.append(root);

    const doc = () => ctx.doc();
    const control = (id) => (doc().controls || []).find((c) => c.id === id);
    const tabOf = (c) => c.tab || null;
    const onTab = (c) => !c.tab || c.tab === tab;
    const rect = (c) => ({ x: c.at[0], y: c.at[1], w: c.size[0], h: c.size[1] });
    const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const scopeNode = (id) => ctx.scope().find((n) => n.id === id);
    const fit = fitPanel;
    const freeSpot = (p, size) => freeSpotIn(p, size, tab);
    const nextId = nextIdIn;
    /// The id of the board module a control was made with (not a knob wired directly, as on older panels).
    /// What a control drives, as "Module › param" strings: its own knob wire, or where its board module's output is cabled.
    const drives = (c) => {
      const name = (id, jack) => { const n = ctx.module(id); return n ? `${n.name} › ${ctx.jackName(n, jack)}` : null; };
      if (c.target) { const t = ctx.module(c.target.node); return t ? [`${t.name} › ${c.target.param || c.target.jack}`] : []; }
      const w = (c.wire || [])[0], mid = moduleOf(c);
      if (w && w.param && !mid) { const [id, ...rest] = w.param.split("."); const s = name(id, rest.join(".")); return s ? [s] : []; }
      if (!mid) return [];
      const out = ctx.cables().filter((k) => k.from.node === mid).map((k) => name(k.to.node, k.to.jack));
      return [...new Set(out.filter(Boolean))];
    };
    const moduleOf = (c) => { const id = nodeOf(c), n = id && ctx.module(id); return n && CONTROL_MODULES.has(n.type) ? id : null; };

    function addControl(type, extra = {}) {
      let id;
      ctx.mutate("add " + type, (p) => {
        const more = { ...extra };
        if (type === "label") more.text = more.text || "Label";
        if (type === "section") { more.text = more.text || "Section"; more.colour = more.colour || "#8b92a3"; }
        id = placeControl(p, type, more, tab).id;
      });
      setSel([id]);
      return id;
    }

    // ----------------------------------------------------------------- centre
    function drawCentre() {
      centre.innerHTML = "";
      const p = doc();
      live = BleepPanels.create(ctx.panels(), p.id, ctx.host(), { edit: true, tab, onTab: (t) => { tab = t; setSel([...multi].filter((i) => control(i) && onTab(control(i)))); drawOverlay(); drawSide(); drawInsp(); } });
      const tabs = p.tabs || [];
      if (tabs.length && !tabs.some((t) => t.id === tab)) tab = tabs[0].id;
      if (!tabs.length) tab = null;
      live.setTab(tab);
      centre.append(live.root);
      drawOverlay();
    }

    function drawOverlay() {
      const stage = live && live.stage;
      if (!stage) return;
      stage.querySelectorAll(".pe-hit").forEach((e) => e.remove());
      const p = doc();
      for (const c of p.controls) {
        if (!onTab(c)) continue;
        const h = el("div", "pe-hit" + (multi.has(c.id) ? " sel" : "") + (c.type === "section" ? " bg" : ""));
        place(h, c);
        h.dataset.id = c.id;
        const grip = el("b", "pe-grip");
        h.append(grip);
        // A section is only grabbed by its title strip, so a rectangle can be drawn (and controls picked) inside it.
        const grab = c.type === "section" ? h.appendChild(el("div", "pe-sec-head")) : h;
        grab.addEventListener("pointerdown", (ev) => startMove(ev, c, h));
        grip.addEventListener("pointerdown", (ev) => startResize(ev, c, h));
        h.addEventListener("contextmenu", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          root.focus({ preventScroll: true });
          if (!multi.has(c.id)) select(c.id);
          menu(ev, true);
        });
        stage.append(h);
      }
    }
    const place = (h, c) => {
      h.style.left = c.at[0] * U + "px"; h.style.top = c.at[1] * U + "px";
      h.style.width = c.size[0] * U + "px"; h.style.height = c.size[1] * U + "px";
    };
    function label(ref) {
      const [key, pid] = BleepPanels.split(ref);
      const n = scopeNode(key);
      if (!n) return ref + " (missing)";
      const d = (n.params || []).find((q) => q.id === pid) || (n.outputs || []).find((q) => q.id === pid);
      return `${n.name} › ${d ? d.name : pid}`;
    }

    function select(ids, lead) {
      setSel([].concat(ids), lead);
      stage().querySelectorAll(".pe-hit").forEach((h) => h.classList.toggle("sel", multi.has(h.dataset.id)));
      drawSide();
      drawInsp();
    }
    const stage = () => live.stage;

    function startMove(ev, c, h) {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      root.focus({ preventScroll: true });
      if (ev.shiftKey) {   // shift-click adds to or removes from the selection
        const ids = new Set(multi);
        if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id);
        select([...ids], ids.has(c.id) ? c.id : [...ids].pop() || null);
        return;
      }
      const was = multi.has(c.id) && multi.size > 1;   // dragging one of several moves them all
      if (!was) select(c.id);
      else selected = c.id;
      const p = doc();
      // A section carries the controls standing on it.
      const moving = new Map();
      for (const id of was ? multi : [c.id]) {
        const m = control(id);
        if (!m) continue;
        moving.set(id, m);
        if (m.type === "section") for (const q of p.controls) if (q.id !== id && onTab(q) && q.type !== "section" && inside(rect(q), rect(m))) moving.set(q.id, q);
      }
      const start = { x: ev.clientX, y: ev.clientY };
      const orig = [...moving.values()].map((q) => ({ q, at: [...q.at] }));
      let dx = 0, dy = 0, moved = false;
      h.setPointerCapture(ev.pointerId);
      const move = (m) => {
        dx = Math.round((m.clientX - start.x) / U); dy = Math.round((m.clientY - start.y) / U);
        for (const o of orig) {
          const nx = clamp(o.at[0] + dx, 0, p.cols - o.q.size[0]), ny = Math.max(0, o.at[1] + dy);
          const ghost = { ...o.q, at: [nx, ny] };
          const hh = stage().querySelector(`.pe-hit[data-id="${o.q.id}"]`);
          if (hh) place(hh, ghost);
          const ee = live.elements.get(o.q.id);
          if (ee) { ee.style.left = nx * U + "px"; ee.style.top = ny * U + "px"; }
        }
        moved = dx !== 0 || dy !== 0;
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        if (!moved) { if (was) select(c.id); return; }   // a plain click on one of several keeps only that one
        ctx.mutate("move " + (was ? multi.size + " controls" : c.label || c.type), (pp) => {
          for (const o of orig) {
            const t = pp.controls.find((q) => q.id === o.q.id);
            if (t) t.at = [clamp(o.at[0] + dx, 0, pp.cols - t.size[0]), Math.max(0, o.at[1] + dy)];
          }
          fit(pp);
        });
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
    }
    const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

    function startResize(ev, c, h) {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      select(c.id);
      const start = { x: ev.clientX, y: ev.clientY };
      let w = c.size[0], hh = c.size[1];
      const grip = ev.currentTarget;
      grip.setPointerCapture(ev.pointerId);
      const ratio = c.size[0] / c.size[1], locked = LIVE.includes(c.type);
      const move = (m) => {
        w = Math.max(2, c.size[0] + Math.round((m.clientX - start.x) / U));
        hh = Math.max(2, c.size[1] + Math.round((m.clientY - start.y) / U));
        if (locked) {   // a live element keeps its proportions: the larger pull of the two decides
          const k = Math.max(w / c.size[0], hh / c.size[1]);
          w = Math.max(2, Math.round(c.size[0] * k)); hh = Math.max(2, Math.round(w / ratio));
        }
        place(h, { at: c.at, size: [w, hh] });
        const ee = live.elements.get(c.id);
        if (ee) { ee.style.width = w * U + "px"; ee.style.height = hh * U + "px"; }
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        if (w === c.size[0] && hh === c.size[1]) return;
        ctx.mutate("resize " + (c.label || c.type), (pp) => {
          const t = pp.controls.find((q) => q.id === c.id);
          if (t) t.size = [w, hh];
          fit(pp);
        });
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    }

    // -------------------------------------------------------------- side
    function drawSide() {
      side.innerHTML = "";
      side.append(el("h4", "", "Add"));
      for (const [type, name] of PALETTE.filter(([t]) => ADD.includes(t))) {
        const b = el("button", "pe-pal", name);
        b.addEventListener("click", () => addControl(type, defaults(type)));
        side.append(b);
      }
      side.append(el("p", "pe-note", "Dials, wheels, buttons, Keys, meters and module views: right-click the module on the board and choose “Add to panel”."));
      // Every control of the panel, with what it drives.
      side.append(el("h4", "", "Controls"));
      const list = el("div", "pe-list");
      for (const c of doc().controls) {
        if (FREE.includes(c.type)) continue;   // labels, sections, module views and loaded panels are not controls of anything
        const d = drives(c);
        const row = el("div", "pe-knob" + (multi.has(c.id) ? " wired" : ""), c.label || c.type);
        row.dataset.id = c.id;
        row.append(el("small", "", d.length ? d.join(", ") : c.type));
        row.addEventListener("click", (ev) => {
          if (ev.shiftKey) { const ids = new Set(multi); if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id); setSel([...ids], ids.has(c.id) ? c.id : undefined); }
          else setSel([c.id]);
          if (c.tab && c.tab !== tab && live) { tab = c.tab; live.setTab(tab); }
          drawOverlay(); drawSide(); drawInsp();
          reveal(c.id);
        });
        list.append(row);
      }
      if (!list.children.length) list.append(el("div", "pe-empty", "None yet"));
      side.append(list);
    }
    /// Scrolls the centre so a control sits in the middle of the view.
    function reveal(id) {
      const h = live && live.stage.querySelector(`.pe-hit[data-id="${id}"]`);
      if (!h) return;
      const a = h.getBoundingClientRect(), b = centre.getBoundingClientRect();
      centre.scrollTo({ left: centre.scrollLeft + (a.left + a.width / 2) - (b.left + b.width / 2), top: centre.scrollTop + (a.top + a.height / 2) - (b.top + b.height / 2), behavior: "smooth" });
    }
    function defaults(type) {
      if (type === "view") { const n = ctx.scope().find((q) => q.view); return n ? { node: n.id, size: [24, 14] } : {}; }
      if (type === "panel") {
        const q = ctx.panels().find((x) => x.id !== doc().id);
        if (!q) return {};
        const n = q.for && ctx.scope().find((m) => m.type === q.for.module);
        return { panel: q.id, size: [q.cols, q.rows], ...(n ? { node: n.id } : {}) };
      }
      return {};
    }

    // -------------------------------------------------------------- inspector
    function field(parent, name, input) {
      const row = el("label", "pe-field");
      row.append(el("span", "", name), input);
      parent.append(row);
      return input;
    }
    const text = (value, apply, placeholder) => {
      const i = el("input", "");
      i.value = value ?? "";
      if (placeholder) i.placeholder = placeholder;
      i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
      i.addEventListener("change", () => apply(i.value));
      return i;
    };
    const num = (value, apply, min = 0, max = 999) => {
      const i = el("input", "");
      i.type = "number"; i.min = min; i.max = max; i.value = value;
      i.addEventListener("keydown", (e) => e.stopPropagation());
      i.addEventListener("change", () => apply(clamp(Math.round(Number(i.value) || 0), min, max)));
      return i;
    };
    // Typing in a title shows at once in the panel; it is kept when the field is left (or the selection changes).
    let titleInput = null;   // the inspector's title field: typing with a label, a section or the panel selected goes here
    let pending = null;      // saves a title that was typed and not yet kept
    const flush = () => { const f = pending; pending = null; if (f) f(); };
    const titleField = (value, keep, show) => {
      const i = text(value, (v) => { pending = null; keep(v); });
      i.addEventListener("input", () => { pending = () => keep(i.value); show(i.value); });
      titleInput = i;
      return i;
    };
    const showText = (id, v) => {
      const e = live && live.elements.get(id), c = control(id);
      if (!e || !c) return;
      if (c.type === "section") { const s = e.querySelector("span"); if (s) s.textContent = v; } else e.textContent = v;
    };
    const keepText = (id, v) => ctx.mutate("title", (p) => { const t = p.controls.find((q) => q.id === id); if (t) t.text = v; });
    const change = (name, fn) => ctx.mutate(name, (p) => { const t = p.controls.find((q) => q.id === selected); if (t) fn(t, p); });

    function drawInsp() {
      flush();
      titleInput = null;
      insp.innerHTML = "";
      if (multi.size > 1) return multiSettings();
      const c = control(selected);
      if (!c) return panelSettings();
      insp.append(el("h4", "", c.type[0].toUpperCase() + c.type.slice(1)));
      if (c.type === "label") {
        field(insp, "Title", titleField(c.text, (v) => keepText(c.id, v), (v) => showText(c.id, v)));
        const s = el("select", "");
        for (const [v, n] of [["", "Title"], ["caption", "Caption"]]) s.append(new Option(n, v));
        s.value = c.style === "caption" ? "caption" : "";
        s.addEventListener("change", () => change("style", (t) => { if (s.value) t.style = s.value; else delete t.style; }));
        field(insp, "Style", s);
      }
      if (c.type === "section") {
        field(insp, "Title", titleField(c.text, (v) => keepText(c.id, v), (v) => showText(c.id, v)));
        const col = el("input", ""); col.type = "color"; col.value = c.colour || "#8b92a3";
        col.addEventListener("change", () => change("colour", (t) => (t.colour = col.value)));
        field(insp, "Colour", col);
      }
      if (["dial", "slider", "button", "wheel", "select", "xy", "meter"].includes(c.type)) field(insp, "Label", text(c.label, (v) => change("label", (t) => (t.label = v))));
      if (!FREE.includes(c.type) && !c.target) {
        const d = drives(c);
        insp.append(el("p", "pe-note", d.length ? `Drives ${d.join(", ")}.` : "Drives nothing yet."));
      }
      if (c.target) {   // made by an older version: a module in the Panel cell, wired to what it controls
        const t = ctx.module(c.target.node), m = c.module && ctx.module(c.module);
        insp.append(el("p", "pe-note", t ? `Controls ${t.name} › ${c.target.param || c.target.jack}, through ${m ? m.name : "a module that is gone"} in the Panel cell.` : "What it controls is gone."));
        const sb = el("button", "pe-pal", "Show its module on the board");
        sb.addEventListener("click", () => ctx.reveal(c.module));
        insp.append(sb);
        const rb = el("button", "pe-pal", "Remove the control and its module");
        rb.addEventListener("click", () => remove());
        insp.append(rb);
      } else {
        const mid = moduleOf(c);
        if (mid) {
          const m = ctx.module(mid);
          insp.append(el("p", "pe-note", m ? `Board module: ${m.name}. Cable its output on the board.` : "Its board module is gone."));
          if (m) {
            const sb = el("button", "pe-pal", "Show on the board");
            sb.addEventListener("click", () => ctx.reveal(mid));
            insp.append(sb);
          }
        }
      }
      if (c.type === "select" && Array.isArray(c.options) && !c.target) {
        const o = text(c.options.join(", "), (v) => {
          const list = v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 24);
          if (list.length < 2) return drawInsp();
          ctx.mutate("options", (p, all, make) => {
            const t = p.controls.find((q) => q.id === selected);
            if (!t) return;
            t.options = list;
            const m = moduleOf(t);
            if (m) make.set(m, "steps", list.length / 24);
          });
        });
        field(insp, "Options (comma separated)", o);
      }
      if (c.type === "view") {
        const s = el("select", "");
        for (const n of ctx.scope().filter((q) => q.view)) s.append(new Option(n.name, n.id));
        s.value = c.node || "";
        s.addEventListener("change", () => change("module", (t) => { t.node = s.value; delete t.part; }));
        field(insp, "Module", s);
        const parts = ctx.parts ? ctx.parts(c.node) : [];
        if (parts.length) {
          const ps = el("select", "");
          ps.append(new Option("The whole view", ""));
          for (const q of parts) ps.append(new Option(q.name, q.id));
          ps.value = c.part || "";
          ps.addEventListener("change", () => change("part", (t) => {
            const q = parts.find((x) => x.id === ps.value);
            if (q) t.part = q.id; else delete t.part;
            if (!t.label || t.label === ctx.module(t.node).name || t.label.startsWith(ctx.module(t.node).name + " · "))
              t.label = q ? `${ctx.module(t.node).name} · ${q.name}` : ctx.module(t.node).name;
          }));
          field(insp, "Part", ps);
        }
      }
      if (c.type === "panel") {
        const s = el("select", "");
        for (const q of ctx.panels().filter((q) => q.id !== doc().id)) s.append(new Option(q.name, q.id));
        s.value = c.panel || "";
        s.addEventListener("change", () => change("panel", (t, p) => {
          const q = ctx.panels().find((x) => x.id === s.value);
          t.panel = s.value;
          if (q) { t.size = [q.cols, q.rows]; if (!q.for) delete t.node; }
          fit(p);
        }));
        field(insp, "Panel", s);
        const q = ctx.panels().find((x) => x.id === c.panel);
        if (q) {
          const eb = el("button", "pe-pal", "Edit this panel…");
          eb.addEventListener("click", () => ctx.editPanel(q.id));
          insp.append(eb);
        }
        if (q && q.for) {
          const ns = el("select", "");
          for (const n of ctx.scope().filter((m) => m.type === q.for.module)) ns.append(new Option(n.name, n.id));
          ns.value = c.node || "";
          ns.addEventListener("change", () => change("module", (t) => (t.node = ns.value)));
          field(insp, `For (${q.for.module})`, ns);
        }
      }
      const row = el("div", "pe-xy");
      const cell = (name, input) => { const d = el("div"); field(d, name, input); row.append(d.firstChild); };
      cell("X", num(c.at[0], (v) => change("move", (t, p) => { t.at[0] = v; fit(p); })));
      cell("Y", num(c.at[1], (v) => change("move", (t, p) => { t.at[1] = v; fit(p); })));
      const live = LIVE.includes(c.type);
      cell("W", num(c.size[0], (v) => change("resize", (t, p) => { const r = t.size[0] / t.size[1]; t.size[0] = Math.max(1, v); if (live) t.size[1] = Math.max(1, Math.round(t.size[0] / r)); fit(p); }), 1));
      cell("H", num(c.size[1], (v) => change("resize", (t, p) => { const r = t.size[0] / t.size[1]; t.size[1] = Math.max(1, v); if (live) t.size[0] = Math.max(1, Math.round(t.size[1] * r)); fit(p); }), 1));
      insp.append(row);
      const tabs = doc().tabs || [];
      if (tabs.length) {
        const s = el("select", "");
        s.append(new Option("All tabs", ""));
        for (const t of tabs) s.append(new Option(t.name, t.id));
        s.value = c.tab || "";
        s.addEventListener("change", () => change("tab", (t) => { if (s.value) t.tab = s.value; else delete t.tab; }));
        field(insp, "Shown on", s);
      }
      const acts = el("div", "pe-acts");
      const dup = el("button", "", "Duplicate");
      dup.addEventListener("click", duplicate);
      if (c.target || moduleOf(c)) dup.hidden = true;   // a control with a module is made again on the board
      const del = el("button", "", "Delete");
      del.addEventListener("click", remove);
      acts.append(dup, del);
      insp.append(acts);
    }

    /// Evenly spaces the selected controls along one axis: the outermost two stay, the gaps between all are made equal.
    function align(axis) {
      const axes = axis === "xy" ? [0, 1] : [axis === "x" ? 0 : 1];
      ctx.mutate("space " + multi.size + " controls", (p) => {
        for (const i of axes) {
          const cs = p.controls.filter((c) => multi.has(c.id)).sort((a, b) => a.at[i] - b.at[i]);
          if (cs.length < 3) continue;
          const first = cs[0].at[i], last = cs[cs.length - 1];
          const span = last.at[i] + last.size[i] - first;
          const gap = Math.max(0, (span - cs.reduce((n, c) => n + c.size[i], 0)) / (cs.length - 1));   // never overlap; the panel grows if the row needs more room
          let pos = first;
          for (const c of cs) { c.at[i] = Math.max(0, Math.round(pos)); pos += c.size[i] + gap; }
        }
        fit(p);
      });
    }
    const picked = () => doc().controls.filter((c) => multi.has(c.id));
    /// Rounds the position of the selection to the grid.
    function snap() {
      ctx.mutate("snap to grid", (p) => {
        for (const c of p.controls) if (multi.has(c.id)) c.at = [clamp(Math.round(c.at[0] / GRID) * GRID, 0, Math.max(0, p.cols - c.size[0])), Math.max(0, Math.round(c.at[1] / GRID) * GRID)];
        fit(p);
      });
    }
    /// Lines the selection up on one row ("h": the same height) or one column ("v"), through the middle of the group.
    function lineUp(dir) {
      const i = dir === "h" ? 1 : 0;
      ctx.mutate(dir === "h" ? "align horizontally" : "align vertically", (p) => {
        const cs = p.controls.filter((c) => multi.has(c.id));
        if (cs.length < 2) return;
        const mid = cs.reduce((n, c) => n + c.at[i] + c.size[i] / 2, 0) / cs.length;
        for (const c of cs) c.at[i] = Math.max(0, Math.round(mid - c.size[i] / 2));
        fit(p);
      });
    }
    /// Frames the selection in a new titled section, which then carries the controls along when it is moved.
    function group() {
      let id;
      ctx.mutate("group " + multi.size + " controls", (p) => {
        const cs = p.controls.filter((c) => multi.has(c.id));
        if (!cs.length) return false;
        const x0 = Math.max(0, Math.min(...cs.map((c) => c.at[0])) - 1), y0 = Math.max(0, Math.min(...cs.map((c) => c.at[1])) - 2);   // room for the title strip
        const x1 = Math.max(...cs.map((c) => c.at[0] + c.size[0])) + 1, y1 = Math.max(...cs.map((c) => c.at[1] + c.size[1])) + 1;
        const sec = { id: nextId(p), type: "section", at: [x0, y0], size: [x1 - x0, y1 - y0], text: "Group", colour: "#8b92a3" };
        if (tab) sec.tab = tab;
        id = sec.id;
        p.controls.unshift(sec);   // behind the controls it frames
        fit(p);
      });
      if (id) setSel([id]);
    }
    /// What can be copied: not a control made with a module of the board (that is made again on the board).
    const copyable = () => picked().filter((c) => !c.target && !moduleOf(c));
    function copy() {
      const cs = copyable();
      if (cs.length) clipboard = JSON.parse(JSON.stringify(cs));
    }
    /// Puts the copies on the panel: at `at` (grid units) when the pointer was on empty space, else on the next free slot.
    function paste(at) {
      if (!clipboard) return;
      const ids = [];
      ctx.mutate("paste", (p) => {
        const x0 = Math.min(...clipboard.map((c) => c.at[0])), y0 = Math.min(...clipboard.map((c) => c.at[1]));
        const size = [Math.max(...clipboard.map((c) => c.at[0] + c.size[0])) - x0, Math.max(...clipboard.map((c) => c.at[1] + c.size[1])) - y0];
        const spot = at ? [clamp(at[0], 0, Math.max(0, p.cols - size[0])), Math.max(0, at[1])] : freeSpot(p, size);
        for (const src of clipboard) {
          const copy = JSON.parse(JSON.stringify(src));
          copy.id = nextId(p);
          copy.at = [spot[0] + src.at[0] - x0, spot[1] + src.at[1] - y0];
          if (tab) copy.tab = tab; else delete copy.tab;
          p.controls.push(copy);
          ids.push(copy.id);
        }
        fit(p);
      });
      select(ids);
    }
    /// The right-click menu: over a control (`onControl`) or over empty space, where it also knows where to paste.
    function menu(ev, onControl) {
      const sr = live.stage.getBoundingClientRect();
      const at = onControl ? null : [Math.round((ev.clientX - sr.left) / U), Math.round((ev.clientY - sr.top) / U)];
      const items = [];
      if (multi.size) {
        items.push({ label: "Align", items: [
          { label: "Snap to grid", run: snap },
          { label: "Align horizontally", disabled: multi.size < 2, run: () => lineUp("h") },
          { label: "Align vertically", disabled: multi.size < 2, run: () => lineUp("v") },
        ] }, { label: "Spacing", items: [
          { label: "Same horizontal spacing", disabled: multi.size < 3, run: () => align("x") },
          { label: "Same vertical spacing", disabled: multi.size < 3, run: () => align("y") },
          { label: "Same horizontal and vertical", disabled: multi.size < 3, run: () => align("xy") },
        ] }, { label: "Group", key: "⌘G", run: group }, "-");
        items.push({ label: "Copy", key: "⌘C", disabled: !copyable().length, run: copy });
      }
      items.push({ label: "Paste", key: "⌘V", disabled: !clipboard, run: () => paste(at) });
      if (multi.size) items.push("-", { label: "Delete", key: "⌫", run: remove });
      ctx.menu(ev, items);
    }
    function multiSettings() {
      insp.append(el("h4", "", multi.size + " controls"));
      insp.append(el("p", "pe-note", "Spacing makes the gaps between the selected controls equal, between the outermost ones (three or more)."));
      const acts = el("div", "pe-acts");
      for (const [axis, name, tip] of [["x", "Space ↔", "Same horizontal spacing"], ["y", "Space ↕", "Same vertical spacing"], ["xy", "Space both", "Same horizontal and vertical spacing"]]) {
        const b = el("button", "", name);
        b.title = tip;
        b.disabled = multi.size < 3;
        b.addEventListener("click", () => align(axis));
        acts.append(b);
      }
      insp.append(acts);
      const del = el("button", "pe-pal", "Delete all");
      del.addEventListener("click", remove);
      insp.append(del);
    }

    function panelSettings() {
      const p = doc();
      insp.append(el("h4", "", "Panel"));
      const show = (v) => { for (const c of p.controls) if (c.type === "label" && c.style === "title" && c.text === p.name) showText(c.id, v || p.name); };
      field(insp, "Title", titleField(p.name, (v) => ctx.mutate("rename panel", (q) => renamePanel(q, v || q.name)), show));
      if (!p.for) {
        const s = el("select", "");
        for (const [v, n] of [["", "Off"], ["window", "In a window"], ["full", "Full screen"]]) s.append(new Option(n, v));
        s.value = p.open || "";
        s.addEventListener("change", () => ctx.mutate("show on load", (q, all) => {
          for (const o of all) if (o !== q) delete o.open;   // one panel starts with the board
          if (s.value) q.open = s.value; else delete q.open;
        }));
        field(insp, "Show on load", s);
      }
      insp.append(el("h4", "", "Tabs"));
      for (const t of p.tabs || []) {
        const row = el("div", "pe-tabrow");
        row.append(text(t.name, (v) => ctx.mutate("rename tab", (q) => (q.tabs.find((x) => x.id === t.id).name = v || t.name))));
        const rm = el("button", "", "×");
        rm.title = "Delete the tab and its controls";
        rm.addEventListener("click", () => ctx.mutate("delete tab", (q) => {
          q.tabs = q.tabs.filter((x) => x.id !== t.id);
          q.controls = q.controls.filter((c) => c.tab !== t.id);
          if (!q.tabs.length) delete q.tabs;
        }));
        row.append(rm);
        insp.append(row);
      }
      const add = el("button", "pe-pal", "+ Tab");
      add.addEventListener("click", () => ctx.mutate("add tab", (q) => {
        let n = 1; const ids = new Set((q.tabs || []).map((x) => x.id));
        while (ids.has("tab" + n)) n++;
        // The first tab takes the controls that so far belonged to none.
        if (!q.tabs) { q.tabs = [{ id: "tab1", name: "Main", rows: q.rows }]; q.controls.forEach((c) => { if (!c.tab && c.type !== "label") c.tab = "tab1"; }); n = 2; }
        q.tabs.push({ id: "tab" + n, name: "Tab " + n, rows: 20 });
        tab = "tab" + n;
      }));
      insp.append(add);
      insp.append(el("h4", "", "Size"));
      const row = el("div", "pe-xy");
      const cell = (name, input) => { const d = el("div"); field(d, name, input); row.append(d.firstChild); };
      cell("Columns", num(p.cols, (v) => ctx.mutate("panel size", (q) => { q.cols = Math.max(v, ...q.controls.map((c) => c.at[0] + c.size[0])); }), 8));
      cell("Rows", num((p.tabs || []).find((t) => t.id === tab)?.rows || p.rows, (v) => ctx.mutate("panel size", (q) => {
        const t = (q.tabs || []).find((x) => x.id === tab);
        const rows = Math.max(v, ...q.controls.filter((c) => !c.tab || c.tab === tab).map((c) => c.at[1] + c.size[1]));
        if (t) t.rows = rows;
        q.rows = Math.max(rows, ...(q.tabs || []).map((x) => x.rows || 0));
      }), 4));
      insp.append(row);
    }

    // ------------------------------------------------------------ keyboard
    function duplicate() {
      const c = control(selected);
      if (!c || c.target || moduleOf(c)) return;   // a control with a module is made again on the board, not copied
      let id;
      ctx.mutate("duplicate", (p) => {
        const copy = JSON.parse(JSON.stringify(c));
        copy.id = id = nextId(p);
        copy.at = freeSpot(p, c.size);
        p.controls.push(copy);
        fit(p);
      });
      setSel([id]);
    }
    function remove() {
      if (!selected) return;
      const ids = new Set(multi);
      setSel([]);
      const owned = [...ids].map(control).filter((c) => c && c.target && c.module);
      ctx.mutate("delete " + (ids.size > 1 ? ids.size + " controls" : "control"), (p) => {
        p.controls = p.controls.filter((q) => !ids.has(q.id) || (q.target && q.module));
      });
      for (const c of owned) ctx.removeControl(doc().id, c.id);   // its module, its channel and what they left go with it
    }
    root.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      const c = control(selected);
      if (e.key === "Escape") { setSel([]); drawOverlay(); drawSide(); drawInsp(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); remove(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "c") { e.preventDefault(); e.stopPropagation(); copy(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "g" && multi.size) { e.preventDefault(); e.stopPropagation(); group(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "v") { e.preventDefault(); e.stopPropagation(); paste(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); e.stopPropagation(); duplicate(); }
      else if (c && e.key.startsWith("Arrow")) {
        e.preventDefault(); e.stopPropagation();
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        ctx.mutate("move", (p) => {
          for (const t of p.controls) if (multi.has(t.id)) t.at = [clamp(t.at[0] + d[0], 0, p.cols - t.size[0]), Math.max(0, t.at[1] + d[1])];
          fit(p);
        });
      }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && titleInput && multi.size <= 1 && (!c || c.type === "label" || c.type === "section")) {
        // Typing with a label, a section or the panel selected sets its title: the letter lands in the title field, replacing the old one.
        titleInput.focus();
        titleInput.select();
      }
      if (!(e.metaKey || e.ctrlKey)) e.stopPropagation();   // the board's one-letter shortcuts stay out of the editor
    });
    centre.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (e.target.closest(".pe-hit") || !live) return;
      root.focus({ preventScroll: true });
      if (live.stage.contains(e.target)) { setSel([]); drawOverlay(); drawSide(); drawInsp(); menu(e, false); }
    });
    // Empty space: a click clears the selection, a drag draws a rectangle that selects what it touches (shift adds).
    centre.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".pe-hit") || !live || !live.stage.contains(e.target)) {
        if (e.button === 0 && !e.target.closest(".pe-hit") && !(live && live.stage.contains(e.target))) { setSel([]); drawOverlay(); drawSide(); drawInsp(); }
        return;
      }
      root.focus({ preventScroll: true });
      const st = live.stage, sr = () => st.getBoundingClientRect();
      const x0 = e.clientX - sr().left, y0 = e.clientY - sr().top;
      const base = e.shiftKey ? new Set(multi) : new Set();
      const box = el("div", "pe-marquee");
      let dragging = false;
      const move = (m) => {
        const x1 = m.clientX - sr().left, y1 = m.clientY - sr().top;
        if (!dragging && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 4) return;
        if (!dragging) { dragging = true; st.append(box); }
        const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
        const ids = new Set(base);
        for (const c of doc().controls) {
          if (!onTab(c)) continue;
          const q = { x: c.at[0] * U, y: c.at[1] * U, w: c.size[0] * U, h: c.size[1] * U };
          if (c.type === "section" ? inside(q, r) : hits(q, r)) ids.add(c.id);
        }
        setSel([...ids]);
        st.querySelectorAll(".pe-hit").forEach((h) => h.classList.toggle("sel", multi.has(h.dataset.id)));
      };
      const up = () => {
        centre.removeEventListener("pointermove", move);
        centre.removeEventListener("pointerup", up);
        centre.releasePointerCapture && centre.hasPointerCapture(e.pointerId) && centre.releasePointerCapture(e.pointerId);
        box.remove();
        if (!dragging && !e.shiftKey) setSel([]);
        drawOverlay(); drawSide(); drawInsp();
      };
      centre.setPointerCapture(e.pointerId);
      centre.addEventListener("pointermove", move);
      centre.addEventListener("pointerup", up);
    });

    function build() {
      drawCentre();
      drawSide();
      drawInsp();
    }
    build();
    return {
      rebuild() {
        setSel([...multi].filter((i) => control(i)), control(selected) ? selected : undefined);
        build();
      },
      update: (s) => { if (live) live.update(s); },
      refresh: () => { if (live) live.refresh(); },
      nodeIds: () => (live ? live.nodeIds() : []),
      destroy() { root.remove(); },
    };
  }

  window.BleepPanelEditor = { mount, placeControl, sizeOf, renamePanel };
})();
