// SPDX-License-Identifier: MIT
// panel-editor.js — the panel editor (specs/panels.md §3): the panel with its
// controls draggable, a palette and properties (Interface view), and the
// outline of the cell with the wires of each control (Wiring view).
//
//   const ed = BleepPanelEditor.mount(body, ctx)
//     ctx.doc()            the panel being edited (the board's copy)
//     ctx.panels()         every panel of the board (what a Panel control may load)
//     ctx.mutate(label, fn)  fn(panel, panels) edits a copy; it is committed as one undo step
//     ctx.scope()          [{id, name, type, depth, params: [def], outputs: [{id, name}], view}]: what can be wired
//     ctx.host()           the host BleepPanels.create wants
//     ctx.learn(cb|null)   cb(nodeId, paramId) on the next knob moved in a module view
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
    ["dial", "Dial", [4, 4]], ["slider", "Fader", [2, 8]], ["wheel", "Wheel", [3, 8]], ["button", "Button", [4, 3]], ["select", "Select", [6, 3]], ["keys", "Keys", [42, 7]],
    ["meter", "Meter", [2, 8]], ["label", "Label", [14, 2]], ["section", "Section", [16, 10]],
    ["view", "Module view", [24, 14]], ["panel", "Load panel", [20, 12]],
  ];
  const WIRED = new Set(["dial", "slider", "wheel", "button", "select", "keys"]);
  const sizeOf = (type) => (PALETTE.find((p) => p[0] === type) || [0, 0, [4, 4]])[2];

  function mount(body, ctx) {
    let view = "interface";      // interface | wiring
    let selected = null;         // control id
    let tab = null;
    let query = "";
    const open = new Set();      // outline nodes expanded
    let learning = false;
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
    const jacks = () => (ctx.jacks ? ctx.jacks() : []);
    const jackName = (id) => { const j = jacks().find((q) => q.id === id); return j ? j.name : id; };
    /// A wire as text: "Filter › Cutoff", "Cell › Bend", "Cell notes".
    const wireLabel = (w) => (w.param ? label(w.param) : w.cell ? `Cell › ${jackName(w.cell)}` : w.notes ? "Cell notes" : "?");

    /// Grows the panel to cover its controls (never shrinks).
    function fit(p) {
      const t = (p.tabs || []).find((q) => q.id === tab);
      for (const c of p.controls) {
        p.cols = Math.max(p.cols, c.at[0] + c.size[0] + 1);
        const tt = (p.tabs || []).find((q) => q.id === c.tab);
        const need = c.at[1] + c.size[1] + 1;
        if (tt) tt.rows = Math.max(tt.rows || 0, need);
        p.rows = Math.max(p.rows, need);
      }
      void t;
    }
    function freeSpot(p, size) {
      const solid = p.controls.filter((c) => c.type !== "section" && (!c.tab || c.tab === tab)).map(rect);
      for (let y = 0; y < 400; y++)
        for (let x = 0; x + size[0] <= p.cols - 1; x++)
          if (!solid.some((r) => hits({ x, y, w: size[0], h: size[1] }, r))) return [x, y];
      return [0, Math.max(0, ...solid.map((r) => r.y + r.h))];   // too wide for the panel: below everything
    }
    const nextId = (p) => { let n = 1; while (p.controls.some((c) => c.id === "c" + n)) n++; return "c" + n; };

    function addControl(type, extra = {}) {
      let id;
      ctx.mutate("add " + type, (p) => {
        const size = extra.size || sizeOf(type);
        const c = { id: (id = nextId(p)), type, at: freeSpot(p, size), size, ...extra };
        delete c.size;
        c.size = size;
        if (tab) c.tab = tab;
        if (type === "label") c.text = c.text || "Label";
        if (type === "section") { c.text = c.text || "Section"; c.colour = c.colour || "#8b92a3"; }
        p.controls.push(c);
        fit(p);
      });
      selected = id;
      return id;
    }

    // ------------------------------------------------------------------ bar
    function drawBar() {
      bar.innerHTML = "";
      const seg = el("div", "pe-seg");
      for (const [v, name] of [["interface", "Interface"], ["wiring", "Wiring"]]) {
        const b = el("button", view === v ? "on" : "", name);
        b.addEventListener("click", () => { view = v; stopLearn(); build(); });
        seg.append(b);
      }
      bar.append(seg);
      const hint = el("span", "pe-hint", view === "interface"
        ? "Drag to move, corner to resize · Delete removes · ⌘D duplicates"
        : "Pick a control, then click a knob in the list. Double-click a knob to add a control for it.");
      bar.append(hint);
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
        if (view === "wiring" && WIRED.has(c.type)) {
          const ws = c.wire || [];
          const lead = ws[0] && wireLabel(ws[0]);
          h.append(el("span", "pe-chip" + (ws.length ? "" : " none"), ws.length ? (lead + (ws.length > 1 ? ` +${ws.length - 1}` : "")) : "unwired"));
        }
        if (view === "wiring" && c.type === "meter") h.append(el("span", "pe-chip" + (c.source ? "" : " none"), c.source ? [].concat(c.source.out).map(label).join(", ") : "no source"));
        if (view === "wiring" && (c.type === "view" || c.type === "panel")) h.append(el("span", "pe-chip" + (c.node || c.type === "panel" && !ctx.panels().find((q) => q.id === c.panel)?.for ? "" : " none"), c.node ? nodeName(c.node) : c.type === "view" ? "no module" : (c.panel ? "" : "no panel")));
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
    const nodeName = (key) => { const n = scopeNode(key); return n ? n.name : "missing"; };
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
      if (view === "interface") {
        side.append(el("h4", "", "Add"));
        for (const [type, name] of PALETTE) {
          const b = el("button", "pe-pal", name);
          b.addEventListener("click", () => addControl(type, defaults(type)));
          side.append(b);
        }
        return;
      }
      const search = el("input", "pe-search");
      search.placeholder = "Search knobs";
      search.value = query;
      search.addEventListener("input", () => { query = search.value.toLowerCase(); drawList(list); });
      search.addEventListener("keydown", (e) => e.stopPropagation());
      const list = el("div", "pe-list");
      side.append(search, list);
      drawList(list);
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

    function drawList(list) {
      list.innerHTML = "";
      const c = control(selected);
      const wantOutputs = c && c.type === "meter";
      const js = jacks().filter((j) => !query || j.name.toLowerCase().includes(query));
      if (js.length && !wantOutputs && !(c && (c.type === "view" || c.type === "panel"))) {
        list.append(el("div", "pe-node pe-group", "Cell inputs"));
        for (const j of js) {
          const row = el("div", "pe-knob", j.name);
          row.style.paddingLeft = "18px";
          if (c && (c.wire || []).some((w) => (j.id === "notes" ? w.notes : w.cell === j.id))) row.classList.add("wired");
          row.title = "Click: wire the selected control to this input · double-click: new control";
          row.append(el("small", "", j.type));
          row.addEventListener("click", () => wireJack(j));
          row.addEventListener("dblclick", () => newForJack(j));
          list.append(row);
        }
      }
      for (const n of ctx.scope()) {
        const rows = (wantOutputs ? n.outputs.map((o) => ({ ...o, out: true })) : n.params.map((q) => ({ ...q })))
          .filter((r) => !query || r.name.toLowerCase().includes(query) || n.name.toLowerCase().includes(query));
        if (!rows.length) continue;
        const head = el("div", "pe-node", n.name);
        head.style.paddingLeft = 6 + n.depth * 10 + "px";
        head.append(el("small", "", n.type));
        head.addEventListener("click", () => {
          if (c && c.type === "view" && n.view) setNode(c, n.id);
          else if (c && c.type === "panel") setNode(c, n.id);
          else if (open.has(n.id)) open.delete(n.id); else open.add(n.id);
          drawList(list);
        });
        list.append(head);
        if (!open.has(n.id) && !query) continue;
        for (const r of rows) {
          const row = el("div", "pe-knob", r.name);
          row.style.paddingLeft = 18 + n.depth * 10 + "px";
          const ref = `${n.id}.${r.id}`;
          if (c && (c.wire || []).some((w) => w.param === ref)) row.classList.add("wired");
          row.title = wantOutputs ? "Click: show this output on the meter" : "Click: wire the selected control to this knob · double-click: new control";
          row.addEventListener("click", () => wireTo(ref, r, !!r.out));
          row.addEventListener("dblclick", () => { if (!r.out) newFor(ref, r); });
          list.append(row);
        }
      }
      if (!list.children.length) list.append(el("div", "pe-empty", "Nothing here"));
    }

    function wireTo(ref, def, isOutput) {
      const c = control(selected);
      if (!c) return;
      if (isOutput && c.type === "meter") {
        ctx.mutate("meter source", (p) => {
          const t = p.controls.find((q) => q.id === c.id);
          const cur = t.source ? [].concat(t.source.out) : [];
          t.source = { out: cur.includes(ref) ? cur.filter((x) => x !== ref) : cur.concat(ref).slice(-2) };
          if (!t.source.out.length) delete t.source;
        });
        return;
      }
      if (!WIRED.has(c.type)) return;
      ctx.mutate("wire " + (c.label || c.type), (p) => {
        const t = p.controls.find((q) => q.id === c.id);
        t.wire = (t.wire || []).filter((w) => w.param !== ref);
        t.wire.push({ param: ref });
        if (!t.label) t.label = def.name;
      });
    }
    /// The range a new wire to a jack starts with, and the control that suits it.
    const jackRange = (j, wheel) => (j.type === "pitch" || wheel ? [-1, 1] : [0, 1]);
    function wireJack(j) {
      const c = control(selected);
      if (!c) return;
      if (j.id === "notes" ? c.type !== "keys" : !["dial", "slider", "wheel", "button"].includes(c.type)) return;
      ctx.mutate("wire " + (c.label || c.type), (p) => {
        const t = p.controls.find((q) => q.id === c.id);
        const same = (w) => (j.id === "notes" ? w.notes : w.cell === j.id);
        t.wire = (t.wire || []).filter((w) => !same(w));
        t.wire.push(j.id === "notes" ? { notes: "cell" } : { cell: j.id, ...(jackRange(j, t.type === "wheel")[0] < 0 ? { range: [-1, 1] } : {}) });
        if (!t.label && j.id !== "notes") t.label = j.name;
      });
    }
    function newForJack(j) {
      if (j.type === "notes") return addControl("keys", { wire: [{ notes: "cell" }] });
      const pulse = j.type === "trigger" || j.type === "gate";
      const spring = j.id === "bend";
      const type = pulse ? "button" : spring ? "wheel" : "dial";
      const range = jackRange(j, spring);
      addControl(type, { label: j.name, ...(spring ? { spring: true } : {}), wire: [{ cell: j.id, ...(range[0] < 0 ? { range } : {}) }] });
    }
    function newFor(ref, def) {
      const type = def.kind === "bool" ? "button" : def.kind === "choice" ? "select" : "dial";
      addControl(type, { label: def.name, wire: [{ param: ref }] });
    }
    function setNode(c, nodeId) {
      ctx.mutate("set module", (p) => { const t = p.controls.find((q) => q.id === c.id); t.node = nodeId; });
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
      if (view === "wiring") return wiring(c);
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
      if (WIRED.has(c.type) || c.type === "meter") field(insp, "Label", text(c.label, (v) => change("label", (t) => (t.label = v))));
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

    function wiring(c) {
      if (c.type === "view" || c.type === "panel") {
        insp.append(el("p", "pe-note", "Click a module in the list to choose which one this shows."));
        return;
      }
      if (c.type === "meter") {
        insp.append(el("p", "pe-note", "Click up to two outputs in the list to show them."));
        for (const ref of c.source ? [].concat(c.source.out) : []) insp.append(el("div", "pe-wire", label(ref)));
        return;
      }
      if (!WIRED.has(c.type)) { insp.append(el("p", "pe-note", "Nothing to wire.")); return; }
      const ws = c.wire || [];
      if (!ws.length) insp.append(el("p", "pe-note", c.type === "keys"
        ? "Not wired. Click “Notes” under Cell inputs to play the cell."
        : "Not wired. Click a knob or a cell input in the list, or press Learn and move a knob in a module's view."));
      ws.forEach((w, i) => {
        const box = el("div", "pe-wire");
        const head = el("div", "pe-wire-head");
        head.append(el("span", "", (i === 0 ? "● " : "") + wireLabel(w)));
        const rm = el("button", "", "×");
        rm.title = "Remove this wire";
        rm.addEventListener("click", () => change("remove wire", (t) => { t.wire.splice(i, 1); if (!t.wire.length) delete t.wire; }));
        head.append(rm);
        box.append(head);
        if (!w.notes) {
          const signed = !!w.cell;   // a cell input swings −100…+100 %; a knob's range is 0…100 %
          const [lo, hi] = w.range || [0, 1];
          const r = el("div", "pe-range");
          const lowIn = num(Math.round(lo * 100), (v) => setRange(i, v / 100, null), signed ? -100 : 0, 100);
          const highIn = num(Math.round(hi * 100), (v) => setRange(i, null, v / 100), signed ? -100 : 0, 100);
          r.append(lowIn, el("span", "", "% to"), highIn, el("span", "", "%"));
          box.append(r);
          if (w.param) {
            const [key, pid] = BleepPanels.split(w.param);
            const n = scopeNode(key), d = n && n.params.find((q) => q.id === pid);
            if (d) box.append(el("div", "pe-units", `${BleepPanels.show(d, lo)} … ${BleepPanels.show(d, hi)}`));
          }
        }
        insp.append(box);
      });
      if (c.type === "wheel") {
        const sp = el("label", "pe-field");
        const cb = el("input", ""); cb.type = "checkbox"; cb.checked = !!c.spring;
        cb.addEventListener("change", () => change("spring", (t) => { if (cb.checked) t.spring = true; else delete t.spring; }));
        sp.append(cb, el("span", "", " Springs back to the middle"));
        insp.append(sp);
      }
      if (c.type !== "keys") {
        const learn = el("button", "pe-learn" + (learning ? " on" : ""), learning ? "Move a knob in a module view…" : "Learn");
        learn.addEventListener("click", () => { learning ? stopLearn() : startLearn(); drawInsp(); });
        insp.append(learn);
      }
    }
    function setRange(index, lo, hi) {
      change("range", (t) => {
        const w = t.wire[index];
        const cur = w.range || [0, 1];
        w.range = [lo ?? cur[0], hi ?? cur[1]];
        if (w.param && w.range[0] === 0 && w.range[1] === 1) delete w.range;
        if (w.cell && w.range[0] === 0 && w.range[1] === 1) delete w.range;
      });
    }
    function startLearn() {
      learning = true;
      ctx.learn((id, pid) => {
        const n = scopeNode(id);
        if (!n) return false;   // not in this panel's scope: keep waiting
        const d = n.params.find((q) => q.id === pid);
        learning = false;
        wireTo(`${id}.${pid}`, d || { name: pid }, false);
        return true;
      });
    }
    function stopLearn() { if (learning) { learning = false; ctx.learn(null); } }

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
      ctx.mutate("duplicate", (p) => {
        const copy = JSON.parse(JSON.stringify(c));
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
      destroy() { stopLearn(); root.remove(); },
    };
  }

  window.BleepPanelEditor = { mount };
})();
