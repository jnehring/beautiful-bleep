// SPDX-License-Identifier: MIT
// panels.js — front panels (specs/panels.md): a cell's or the board's dials,
// faders, buttons, selects, meters, labels and the views of the modules, laid
// out on a 20 px grid, with tabs. "set" wires on knobs (with a range per wire),
// view controls and loaded panels. Controls of other types are kept and shown
// as an empty box.
//
//   const p = BleepPanels.create(panels, main, host, opts)
//     panels  the panel documents ([{id, name, cols, rows, tabs, controls}])
//     main    the id of the panel to show
//     host    { node(key, bound) → the board node a panel names, or null
//               param(nodeId, pid) → {node, def} | null
//               value(nodeId, pid) → normalised 0…1
//               set(nodeId, pid, v)      a knob moved
//               begin()                  a drag starts (undo step)
//               view(nodeId) → {root, update(state), refresh(node)} | null
//               refreshView(nodeId, view) }
//     opts    { edit: true   controls don't react and views are placeholders (the editor draws over them)
//               tab: id      the tab to start on
//               onTab(id)    the user switched tabs }
//   p.root        the element to insert
//   p.stage       the element the main panel's controls sit in (the editor draws over it)
//   p.elements    control id → element, of the main panel
//   p.tab() / p.setTab(id)
//   p.update(live)  the engine's state event: meters, embedded views
//   p.refresh()   values changed elsewhere (module views, undo)
//   p.nodeIds()   nodes whose views are embedded (the board watches them)
(function () {
  "use strict";
  const U = 20;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /// A knob's normalised value → its own units, as ParamSpec::fromNormalised.
  function units(p, x) {
    const { min, max } = p;
    let v;
    if (p.map === "exp") v = min * Math.pow(max / min, x);
    else if (p.map === "skew") {
      const skew = Math.log(0.5) / Math.log((p.centre - min) / (max - min));
      v = x <= 0 ? min : min + (max - min) * Math.exp(Math.log(x) / skew);
    } else v = min + (max - min) * x;
    return p.kind === "float" ? v : Math.round(v);
  }
  function show(p, x) {
    if (p.kind === "choice" && p.choices) return p.choices[Math.round(units(p, x)) - p.min] ?? "";
    if (p.kind === "bool") return x > 0.5 ? "on" : "off";
    const v = units(p, x), a = Math.abs(v);
    return (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3)).replace(/\.?0+$/, "") || "0";
  }

  /// The "node.knob" of a wire, split at the first dot (node ids have none; knob ids may).
  function split(ref) {
    const i = ref.indexOf(".");
    return [ref.slice(0, i), ref.slice(i + 1)];
  }

  function create(panels, main, host, opts = {}) {
    const byId = new Map(panels.map((p) => [p.id, p]));
    const root = el("div", "bp-root" + (opts.edit ? " bp-edit" : ""));
    const widgets = [];           // {update(live), refresh()}
    const embedded = new Set();   // node ids whose view is drawn here
    const result = { root, stage: null, elements: new Map(), tab: () => null, setTab: () => {} };

    /// Draws one panel into `into`. `bound`: the node a module panel fronts ("this").
    function draw(panel, into, bound, depth) {
      const tabs = panel.tabs || [];
      const box = el("div", "bp-box");
      box.style.width = panel.cols * U + "px";
      const stage = el("div", "bp-stage");
      box.append(stage);
      const top = depth === 0;
      let tab = tabs.length ? (top && tabs.some((t) => t.id === opts.tab) ? opts.tab : tabs[0].id) : null;
      const tabEls = [], controlEls = [];
      const apply = () => {
        const t = tabs.find((q) => q.id === tab);
        stage.style.height = (t && t.rows || panel.rows) * U + "px";
        for (const [c, e] of controlEls) e.hidden = !!c.tab && c.tab !== tab;
        tabEls.forEach(([id, b]) => b.classList.toggle("on", id === tab));
      };
      if (tabs.length) {
        const strip = el("div", "bp-tabs");
        for (const t of tabs) {
          const b = el("button", "", t.name);
          b.addEventListener("click", () => { tab = t.id; apply(); if (top && opts.onTab) opts.onTab(tab); });
          tabEls.push([t.id, b]);
          strip.append(b);
        }
        box.prepend(strip);
      }
      for (const c of panel.controls) {
        const e = control(c, bound, depth, panel);
        e.classList.add("bp-c", "bp-" + c.type);
        e.style.left = c.at[0] * U + "px";
        e.style.top = c.at[1] * U + "px";
        e.style.width = c.size[0] * U + "px";
        e.style.height = c.size[1] * U + "px";
        stage.append(e);
        controlEls.push([c, e]);
        if (top) result.elements.set(c.id, e);
      }
      apply();
      into.append(box);
      if (top) {
        result.stage = stage;
        result.tab = () => tab;
        result.setTab = (id) => { if (tabs.some((t) => t.id === id)) { tab = id; apply(); } };
      }
      return box;
    }

    function control(c, bound, depth, panel) {
      switch (c.type) {
        case "label": return el("div", "bp-text " + (c.style || ""), c.text);
        case "section": {
          const e = el("div", "");
          e.style.setProperty("--c", c.colour || "#8b92a3");
          e.append(el("span", "", c.text));
          return e;
        }
        case "dial": return knob(c, bound, panel);
        case "slider": case "wheel": return fader(c, bound, panel);
        case "button": return button(c, bound, panel);
        case "select": return select(c, bound, panel);
        case "keys": return keys(c, bound, panel);
        case "meter": return meter(c, bound);
        case "view": return embeddedView(c, bound);
        case "panel": {
          const e = el("div", "");
          const sub = byId.get(c.panel);
          if (!sub) { e.classList.add("dead"); e.append(el("i", "", "Panel missing")); return e; }
          if (depth < 4) draw(sub, e, c.node ? host.node(c.node, bound) : bound, depth + 1);
          return e;
        }
        default: return el("div", "bp-unknown");  // newer than this app: kept, shown empty
      }
    }

    /// What a control's wires drive, in order (the first leads): knobs, the cell's input jacks, its notes.
    /// `sid` names the hidden source the engine makes for a jack or notes wire.
    function targets(c, bound, panel) {
      const out = [];
      (c.wire || []).forEach((w, i) => {
        const sid = `~${panel.id}:${c.id}:${i}`;
        if (w.param) {
          const [key, pid] = split(w.param);
          const node = host.node(key, bound);
          const info = node && host.param(node.id, pid);
          if (!info) return;
          const [lo, hi] = w.range || [0, 1];
          out.push({ kind: "param", id: node.id, pid, def: info.def, lo, hi });
        } else if (w.cell) {
          const [lo, hi] = w.range || [0, 1];
          const jtype = host.jackType ? host.jackType(panel, w.cell) : null;
          if (!jtype) return;   // the cell has no such jack
          out.push({ kind: "jack", jack: w.cell, jtype, sid, lo, hi,
                     def: { kind: "float", name: w.cell, min: lo, max: hi, default: 0 } });
        } else if (w.notes) {
          out.push({ kind: "notes", sid });
        }
      });
      return out;
    }

    /// Wires value, drag and display together for dials, faders, buttons and selects.
    function wire(c, bound, e, paint, panel) {
      const label = el("i", "", c.label || "");
      e.append(label);
      const ts = targets(c, bound, panel).filter((t) => t.kind !== "notes");
      if (!ts.length) { e.classList.add("dead"); e.title = (c.wire || []).length ? "Not connected: the module or jack is gone" : "Not wired"; return null; }
      const lead = ts[0];
      // A jack has no knob to read: the control keeps its own value (saved with the panel), centred on 0.
      const home = (t) => (t.lo < 0 && t.hi > 0 ? -t.lo / (t.hi - t.lo) : 0);
      const read = () => {
        if (lead.kind === "jack") return clamp01(c.value ?? home(lead));
        const v = host.value(lead.id, lead.pid);
        return lead.hi === lead.lo ? 0 : clamp01((v - lead.lo) / (lead.hi - lead.lo));
      };
      let x = read();
      const steps = lead.kind === "param" && lead.def.kind !== "float" ? lead.def.steps || 0 : 0;
      const snap = (q) => {
        q = clamp01(q);
        if (steps > 1 && lead.lo === 0 && lead.hi === 1) return Math.round(q * (steps - 1)) / (steps - 1);
        return q;
      };
      const draw = () => { paint(x); e.title = `${c.label || lead.def.name}: ${show(lead.def, lead.lo + x * (lead.hi - lead.lo))}`; };
      let dirty = false;
      const move = (q) => {
        q = snap(q);
        if (q === x) return;
        x = q;
        for (const t of ts) {
          if (t.kind === "jack") {
            const signal = t.lo + x * (t.hi - t.lo);
            host.source(t.sid, clamp01((signal + 1) / 2));
            dirty = true;
          } else {
            let v = t.lo + x * (t.hi - t.lo);
            const n = t.def.kind === "float" ? 0 : t.def.steps || 0;
            if (n > 1) v = Math.round(v * (n - 1)) / (n - 1);
            host.set(t.id, t.pid, clamp01(v));
          }
        }
        draw();
      };
      // The gesture ends: a jack-driven control saves where it was left (a spring control doesn't).
      const end = () => {
        if (c.spring) move(home(lead));
        else if (dirty) { host.save(panel.id, c.id, x); }
        dirty = false;
      };
      widgets.push({ refresh: () => { x = read(); draw(); } });
      draw();
      if (opts.edit) return null;
      const dflt = lead.kind === "jack" ? home(lead) : (lead.hi === lead.lo ? 0 : clamp01((lead.def.default - lead.lo) / (lead.hi - lead.lo)));
      return { move, end, ts, get: () => x, def: { default: dflt }, steps };
    }

    function knob(c, bound, panel) {
      const e = el("div", "");
      const g = svg("svg", { viewBox: "0 0 64 64" });
      const A0 = -135, A1 = 135;
      const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [32 + r * Math.cos(a), 32 + r * Math.sin(a)]; };
      const arc = (a, b) => {
        if (b < a) [a, b] = [b, a];
        if (b - a < 0.5) b = a + 0.5;
        const [x1, y1] = pt(24, a), [x2, y2] = pt(24, b);
        return `M ${x1} ${y1} A 24 24 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
      };
      const track = svg("path", { d: arc(A0, A1), class: "track" });
      const val = svg("path", { class: "val" });
      const tick = svg("line", { class: "tick", x1: 32, y1: 32 });
      g.append(track, val, tick);
      e.append(g);
      const w = wire(c, bound, e, (v) => {
        const a = A0 + (A1 - A0) * v, [x, y] = pt(20, a);
        val.setAttribute("d", arc(A0, a));
        tick.setAttribute("x2", x);
        tick.setAttribute("y2", y);
      }, panel);
      if (w) drag(e, w, true);
      return e;
    }

    function fader(c, bound, panel) {
      const e = el("div", "");
      const rail = el("u", "");
      const cap = el("s", "");
      e.append(rail, cap);
      const w = wire(c, bound, e, (v) => { cap.style.bottom = `calc(20px + (100% - 32px) * ${v})`; }, panel);
      if (w) drag(e, w, false, rail);
      return e;
    }

    function button(c, bound, panel) {
      const e = el("div", "");
      const lamp = el("s", "");
      e.append(lamp);
      const w = wire(c, bound, e, (v) => lamp.classList.toggle("on", v > 0.5), panel);
      if (w) {
        const pulses = w.ts.filter((t) => t.kind === "jack" && (t.jtype === "trigger" || t.jtype === "gate"));
        e.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          if (pulses.length) {   // a trigger or gate into the cell: held while pressed
            e.setPointerCapture(ev.pointerId);
            for (const t of pulses) host.press(t.sid, true);
            lamp.classList.add("on");
            return;
          }
          host.begin();
          // On/off for a toggle; one step further, round again, for a choice.
          w.move(w.steps > 2 ? (Math.round(w.get() * (w.steps - 1)) + 1) % w.steps / (w.steps - 1) : w.get() > 0.5 ? 0 : 1);
          w.end();
        });
        const up = () => { for (const t of pulses) host.press(t.sid, false); if (pulses.length) lamp.classList.remove("on"); };
        e.addEventListener("pointerup", up);
        e.addEventListener("pointercancel", up);
      }
      return e;
    }

    function select(c, bound, panel) {
      const e = el("div", "");
      const sel = el("select", "");
      e.append(sel);
      const ts = targets(c, bound, panel);
      const def = ts.length && ts[0].kind === "param" && ts[0].def;
      if (def && def.choices) def.choices.forEach((name, i) => sel.append(new Option(name, i)));
      const w = wire(c, bound, e, (v) => { if (def && def.choices) sel.value = String(Math.round(v * (def.choices.length - 1))); }, panel);
      if (w && def && def.choices) {
        sel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        sel.addEventListener("change", () => { host.begin(); w.move(Number(sel.value) / Math.max(1, def.choices.length - 1)); });
      } else sel.disabled = true;
      return e;
    }

    /// Vertical drag (200 px for the full range, Shift for fine); double-click for the default.
    function drag(e, w, relative, rail) {
      let y0 = 0, v0 = 0, on = false;
      e.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        e.setPointerCapture(ev.pointerId);
        host.begin();
        on = true; y0 = ev.clientY; v0 = w.get();
        if (!relative && rail) {  // a fader jumps to where it is grabbed
          const r = rail.getBoundingClientRect();
          if (ev.clientY >= r.top - 4 && ev.clientY <= r.bottom + 4) { v0 = clamp01((r.bottom - ev.clientY) / r.height); w.move(v0); }
        }
      });
      e.addEventListener("pointermove", (ev) => {
        if (!on) return;
        const span = relative ? 200 : (rail ? rail.getBoundingClientRect().height : 160);
        w.move(v0 + (y0 - ev.clientY) / (ev.shiftKey ? span * 5 : span));
      });
      const end = () => { if (on) w.end(); on = false; };
      e.addEventListener("pointerup", end);
      e.addEventListener("pointercancel", end);
      e.addEventListener("dblclick", () => { host.begin(); w.move(w.def.default); w.end(); });
    }

    /// The notes of a keyboard control: "C3" → 48.
    const baseNote = (name) => {
      const m = /^([A-G])(#?)(-?\d)$/.exec(name || "C3");
      return m ? ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0)) + (Number(m[3]) + 1) * 12 : 48;
    };
    function keys(c, bound, panel) {
      const e = el("div", "");
      const base = baseNote(c.from), octaves = Math.max(1, Math.min(6, c.octaves || 3));
      const total = octaves * 7;
      const white = [0, 2, 4, 5, 7, 9, 11], blackAfter = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };
      const nodes = new Map();
      for (let i = 0; i < total; i++) {
        const note = base + Math.floor(i / 7) * 12 + white[i % 7];
        const k = el("div", "k w");
        k.dataset.note = note;
        k.style.left = (i / total * 100) + "%";
        k.style.width = (100 / total) + "%";
        e.append(k);
        nodes.set(note, k);
      }
      for (let i = 0; i < total; i++) {
        const b = blackAfter[i % 7];
        if (b === undefined) continue;
        const note = base + Math.floor(i / 7) * 12 + b;
        const k = el("div", "k b");
        k.dataset.note = note;
        k.style.left = ((i + 1) / total * 100 - 100 / total * 0.3) + "%";
        k.style.width = (100 / total * 0.6) + "%";
        e.append(k);
        nodes.set(note, k);
      }
      const ts = targets(c, bound, panel).filter((t) => t.kind === "notes");
      if (!ts.length) { e.classList.add("dead"); e.title = "Not wired: this keyboard plays a Voice Cell"; return e; }
      if (opts.edit) return e;
      let held = null;
      const press = (k, ev) => {
        const r = k.getBoundingClientRect();
        const vel = Math.min(1, Math.max(0.15, 0.3 + 0.7 * (ev.clientY - r.top) / r.height));
        held = Number(k.dataset.note);
        k.classList.add("on");
        for (const t of ts) host.note(t.sid, "on", [held, vel]);
      };
      const release = () => {
        if (held === null) return;
        for (const t of ts) host.note(t.sid, "off", [held]);
        nodes.get(held).classList.remove("on");
        held = null;
      };
      e.addEventListener("pointerdown", (ev) => {
        const k = ev.target.closest("[data-note]");
        if (!k || ev.button !== 0) return;
        ev.stopPropagation();
        e.setPointerCapture(ev.pointerId);
        press(k, ev);
      });
      e.addEventListener("pointermove", (ev) => {   // sliding across the keys plays each
        if (held === null) return;
        const k = document.elementFromPoint(ev.clientX, ev.clientY);
        const key = k && k.closest && k.closest("[data-note]");
        if (key && Number(key.dataset.note) !== held && e.contains(key)) { release(); press(key, ev); }
      });
      e.addEventListener("pointerup", release);
      e.addEventListener("pointercancel", release);
      return e;
    }

    function meter(c, bound) {
      const e = el("div", "");
      const refs = Array.isArray(c.source && c.source.out) ? c.source.out : [c.source && c.source.out];
      const outs = [];
      for (const ref of refs) {
        if (!ref) continue;
        const [key, jack] = split(ref), node = host.node(key, bound);
        const bar = el("u", ""), fill = el("b", "");
        bar.append(fill);
        e.append(bar);
        if (node) outs.push({ id: node.id, jack, fill, level: 0 });
      }
      e.append(el("i", "", c.label || ""));
      if (!outs.length) e.classList.add("dead");
      widgets.push({
        update: (live) => {
          for (const o of outs) {
            const ns = live && live.nodes && live.nodes[o.id];
            const a = ns && ns.activity ? ns.activity[o.jack] || 0 : 0;
            const t = Math.min(1, Math.sqrt(a / 0.5));
            o.level = t > o.level ? t : o.level * 0.88;
            o.fill.style.height = (o.level * 100).toFixed(1) + "%";
          }
        },
      });
      return e;
    }

    function embeddedView(c, bound) {
      const e = el("div", "");
      const node = host.node(c.node, bound);
      if (opts.edit) {   // the editor draws a placeholder: a live view per rebuild is heavy
        e.classList.add("placeholder");
        e.append(el("span", "", node ? `${node.name} view` : "view: module missing"));
        return e;
      }
      const v = node ? host.view(node.id) : null;
      if (!v) { e.classList.add("dead"); return e; }
      embedded.add(node.id);
      e.append(v.root);
      widgets.push({
        update: (live) => v.update(live && live.nodes && live.nodes[node.id]),
        refresh: () => host.refreshView(node.id, v),
      });
      return e;
    }

    const first = byId.get(main);
    if (first) draw(first, root, null, 0);
    return Object.assign(result, {
      update: (live) => { for (const w of widgets) if (w.update) w.update(live); },
      refresh: () => { for (const w of widgets) if (w.refresh) w.refresh(); },
      nodeIds: () => [...embedded],
    });
  }

  window.BleepPanels = { create, U, units, show, split };
})();
