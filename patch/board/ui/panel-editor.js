// SPDX-License-Identifier: MIT
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
//     ctx.reveal(id)       opens a module's stack on the board and selects it
//     ctx.host()           the host BleepPanels.create wants
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
  // A Dial, Fader, Button or Keys control is made together with a module on the board, which is wired there with cables.
  const MODULE = {
    dial: ["dial", "Dial", (id) => [{ param: id + ".value" }]],
    slider: ["dial", "Fader", (id) => [{ param: id + ".value" }]],
    wheel: ["wheel", "Wheel", (id) => [{ param: id + ".value" }], { spring: true }],
    select: ["dial", "Select", (id) => [{ param: id + ".value" }], { options: ["A", "B", "C"] }],
    xy: ["xy-pad", "XY Pad", (id) => [{ param: id + ".x", axis: "x" }, { param: id + ".y", axis: "y" }]],
    button: ["button", "Button", (id) => [{ press: id }]],
    keys: ["keyboard", "Keyboard", (id) => [{ keyboard: id }]],
  };
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
  /// The first free place for a control of `size` on `tab` (sections don't count); below everything if it is too wide.
  function freeSpotIn(p, size, tab) {
    const solid = p.controls.filter((c) => c.type !== "section" && (!c.tab || c.tab === tab)).map(rectOf);
    for (let y = 0; y < 400; y++)
      for (let x = 0; x + size[0] <= p.cols - 1; x++)
        if (!solid.some((r) => overlap({ x, y, w: size[0], h: size[1] }, r))) return [x, y];
    return [0, Math.max(0, ...solid.map((r) => r.y + r.h))];
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
    let selected = null;         // control id
    let tab = null;
    let addQuery = "";           // the Add list's search
    let live = null;             // the BleepPanels instance

    const root = el("div", "pe");
    root.tabIndex = 0;
    const bar = el("div", "pe-bar");
    const main = el("div", "pe-main");
    const side = el("div", "pe-side"), centre = el("div", "pe-centre"), insp = el("div", "pe-insp");
    main.append(side, centre, insp);
    root.append(bar, main);
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
    const moduleOf = (c) => { const id = nodeOf(c), n = id && ctx.module(id); return n && CONTROL_MODULES.has(n.type) ? id : null; };

    /// Makes the board module a control of `type` is made with, and points `target` (the control) at it.
    function attach(type, make, target) {
      if (type === "meter") {
        const m = make("level-meter", "Meter");
        if (m) target.source = { out: [m + ".l", m + ".r"] };
        return;
      }
      const spec = MODULE[type];
      const m = spec && make(spec[0], spec[1]);
      if (!m) return;
      target.wire = spec[2](m);
      for (const [k, v] of Object.entries(spec[3] || {})) if (target[k] === undefined) target[k] = JSON.parse(JSON.stringify(v));
      if (type === "select") make.set(m, "steps", target.options.length / 24);
    }
    function addControl(type, extra = {}) {
      let id;
      ctx.mutate("add " + type, (p, all, makeModule) => {
        const more = { ...extra };
        if (type === "label") more.text = more.text || "Label";
        if (type === "section") { more.text = more.text || "Section"; more.colour = more.colour || "#8b92a3"; }
        attach(type, makeModule, more);
        if (!more.label && (MODULE[type] || type === "meter") && type !== "keys") more.label = type === "meter" ? "Meter" : MODULE[type][1];
        id = placeControl(p, type, more, tab).id;
      });
      selected = id;
      return id;
    }

    // ------------------------------------------------------------------ bar
    function drawBar() {
      bar.innerHTML = "";
      bar.append(el("span", "pe-hint", "Drag to move, corner to resize · Delete removes · ⌘D duplicates · Dials, buttons and keys are modules on the board: cable them there"));
    }

    // ----------------------------------------------------------------- centre
    function drawCentre() {
      centre.innerHTML = "";
      const p = doc();
      live = BleepPanels.create(ctx.panels(), p.id, ctx.host(), { edit: true, tab, onTab: (t) => { tab = t; selected = control(selected) && onTab(control(selected)) ? selected : null; drawOverlay(); drawSide(); drawInsp(); } });
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
        const h = el("div", "pe-hit" + (c.id === selected ? " sel" : "") + (c.type === "section" ? " bg" : ""));
        place(h, c);
        h.dataset.id = c.id;
        const grip = el("b", "pe-grip");
        h.append(grip);
        h.addEventListener("pointerdown", (ev) => startMove(ev, c, h));
        grip.addEventListener("pointerdown", (ev) => startResize(ev, c, h));
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

    function select(id) {
      selected = id;
      stage().querySelectorAll(".pe-hit").forEach((h) => h.classList.toggle("sel", h.dataset.id === id));
      drawSide();
      drawInsp();
    }
    const stage = () => live.stage;

    function startMove(ev, c, h) {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      root.focus();
      select(c.id);
      const p = doc();
      // A section carries the controls standing on it.
      const group = c.type === "section" ? p.controls.filter((q) => q.id !== c.id && onTab(q) && q.type !== "section" && inside(rect(q), rect(c))) : [];
      const start = { x: ev.clientX, y: ev.clientY };
      const orig = [c, ...group].map((q) => ({ q, at: [...q.at] }));
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
        if (!moved) return;
        ctx.mutate("move " + (c.label || c.type), (pp) => {
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
      const move = (m) => {
        w = Math.max(2, c.size[0] + Math.round((m.clientX - start.x) / U));
        hh = Math.max(2, c.size[1] + Math.round((m.clientY - start.y) / U));
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
      const find = el("input", "pe-search");
      find.placeholder = "Search elements";
      find.value = addQuery;
      const pal = el("div", "pe-palette");
      const drawPalette = () => {
        pal.innerHTML = "";
        const rows = PALETTE.filter(([type, name]) => (!addQuery || name.toLowerCase().includes(addQuery)))
          .sort((a, b) => a[1].localeCompare(b[1]));
        for (const [type, name] of rows) {
          const b = el("button", "pe-pal", name);
          b.addEventListener("click", () => addControl(type, defaults(type)));
          pal.append(b);
        }
        if (!rows.length) pal.append(el("div", "pe-empty", "Nothing here"));
      };
      find.addEventListener("input", () => { addQuery = find.value.trim().toLowerCase(); drawPalette(); });
      find.addEventListener("keydown", (e) => e.stopPropagation());
      side.append(find, pal);
      drawPalette();
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
    const change = (name, fn) => ctx.mutate(name, (p) => { const t = p.controls.find((q) => q.id === selected); if (t) fn(t, p); });

    function drawInsp() {
      insp.innerHTML = "";
      const c = control(selected);
      if (!c) return panelSettings();
      insp.append(el("h4", "", c.type[0].toUpperCase() + c.type.slice(1)));
      if (c.type === "label") {
        field(insp, "Text", text(c.text, (v) => change("text", (t) => (t.text = v))));
        const s = el("select", "");
        for (const [v, n] of [["", "Title"], ["caption", "Caption"]]) s.append(new Option(n, v));
        s.value = c.style === "caption" ? "caption" : "";
        s.addEventListener("change", () => change("style", (t) => { if (s.value) t.style = s.value; else delete t.style; }));
        field(insp, "Style", s);
      }
      if (c.type === "section") {
        field(insp, "Title", text(c.text, (v) => change("title", (t) => (t.text = v))));
        const col = el("input", ""); col.type = "color"; col.value = c.colour || "#8b92a3";
        col.addEventListener("change", () => change("colour", (t) => (t.colour = col.value)));
        field(insp, "Colour", col);
      }
      if (["dial", "slider", "button", "wheel", "select", "xy", "meter"].includes(c.type)) field(insp, "Label", text(c.label, (v) => change("label", (t) => (t.label = v))));
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
      if (c.type === "select" && Array.isArray(c.options)) {
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
        s.addEventListener("change", () => change("module", (t) => (t.node = s.value)));
        field(insp, "Module", s);
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
      cell("W", num(c.size[0], (v) => change("resize", (t, p) => { t.size[0] = Math.max(1, v); fit(p); }), 1));
      cell("H", num(c.size[1], (v) => change("resize", (t, p) => { t.size[1] = Math.max(1, v); fit(p); }), 1));
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
      const del = el("button", "", "Delete");
      del.addEventListener("click", remove);
      acts.append(dup, del);
      insp.append(acts);
    }

    function panelSettings() {
      const p = doc();
      insp.append(el("h4", "", "Panel"));
      field(insp, "Name", text(p.name, (v) => ctx.mutate("rename panel", (q) => (q.name = v || q.name))));
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
      if (!c) return;
      let id;
      ctx.mutate("duplicate", (p, all, makeModule) => {
        const copy = JSON.parse(JSON.stringify(c));
        if (moduleOf(c)) attach(c.type, makeModule, copy);   // a copy has a module of its own
        copy.id = id = nextId(p);
        copy.at = freeSpot(p, c.size);
        p.controls.push(copy);
        fit(p);
      });
      selected = id;
    }
    function remove() {
      if (!selected) return;
      const id = selected;
      selected = null;
      ctx.mutate("delete control", (p) => { p.controls = p.controls.filter((c) => c.id !== id); });
    }
    root.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      const c = control(selected);
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); remove(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); e.stopPropagation(); duplicate(); }
      else if (c && e.key.startsWith("Arrow")) {
        e.preventDefault(); e.stopPropagation();
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        change("move", (t, p) => { t.at = [clamp(t.at[0] + d[0], 0, p.cols - t.size[0]), Math.max(0, t.at[1] + d[1])]; fit(p); });
      }
      if (!(e.metaKey || e.ctrlKey)) e.stopPropagation();   // the board's one-letter shortcuts stay out of the editor
    });
    centre.addEventListener("pointerdown", (e) => {   // empty space: nothing selected
      if (!e.target.closest(".pe-hit")) { selected = null; drawOverlay(); drawSide(); drawInsp(); }
    });

    function build() {
      drawBar();
      drawCentre();
      drawSide();
      drawInsp();
    }
    build();
    return {
      rebuild() {
        if (selected && !control(selected)) selected = null;
        build();
      },
      update: (s) => { if (live) live.update(s); },
      destroy() { root.remove(); },
    };
  }

  window.BleepPanelEditor = { mount, placeControl, sizeOf };
})();
