// SPDX-License-Identifier: MIT
// panels.js — front panels (doc/specs/panels.md): a cell's or the board's dials,
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
//               toggle(nodeId)           flip a Button module in Toggle mode (and save its state)
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
//   p.destroy()   release the computer-keyboard listeners (call when the panel is dropped)
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
    const cleanups = [];          // listeners on the document, released by destroy()
    let over = false;             // the pointer is over this panel: the computer keyboard plays its keys
    root.addEventListener("pointerenter", () => { over = true; });
    root.addEventListener("pointerleave", () => { over = false; });

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
        case "xy": return xy(c, bound, panel);
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

    /// What a control's wires drive, in order (the first leads): knobs, jacks (the cell's, a module's, or a
    /// knob in *mod* mode: a hidden source the engine makes, named `sid`), the cell's notes, a module's button.
    /// `axis` picks the wires of one axis of an XY pad.
    function targets(c, bound, panel, axis) {
      const out = [];
      (c.wire || []).forEach((w, i) => {
        if (axis && (w.axis || "x") !== axis) return;
        const sid = `~${panel.id}:${c.id}:${i}`;
        const [lo, hi] = w.range || [0, 1];
        if (w.param && w.mode !== "mod") {
          const [key, pid] = split(w.param);
          const node = host.node(key, bound);
          const info = node && host.param(node.id, pid);
          if (info) out.push({ kind: "param", id: node.id, pid, def: info.def, lo, hi });
        } else if (w.param || w.jack || w.cell) {
          let jtype = null, name = "";
          if (w.param) {   // modulation: like a cable into the knob
            const [key, pid] = split(w.param), node = host.node(key, bound), info = node && host.param(node.id, pid);
            if (info) { jtype = "control"; name = info.def.name; }
          } else if (w.jack) {
            const [key, jack] = split(w.jack), node = host.node(key, bound);
            jtype = node && host.nodeJackType ? host.nodeJackType(node.id, jack) : null;
            name = jack;
          } else {
            jtype = host.jackType ? host.jackType(panel, w.cell) : null;
            name = w.cell;
          }
          if (jtype) out.push({ kind: "jack", jtype, sid, lo: w.mod ? lo : lo, hi, def: { kind: "float", name, min: lo, max: hi, default: 0 } });
        } else if (w.notes) {
          out.push({ kind: "notes", sid });
        } else if (w.keyboard) {   // a Keyboard module on the board
          if (host.node(w.keyboard, bound)) out.push({ kind: "notes", sid: w.keyboard });
        } else if (w.press) {   // a Button module on the board
          if (host.node(w.press, bound)) out.push({ kind: "press", sid: w.press });
        } else if (w.command) {
          const [key, cmd] = split(w.command), node = host.node(key, bound);
          if (node) out.push({ kind: "command", id: node.id, cmd });
        }
      });
      return out;
    }

    /// Value, saving and what moving it drives, for one axis of a control. `o.initial`: the saved value,
    /// `o.save(x)`: store it, `o.paint(x)` and `o.title`.
    function driver(c, bound, panel, ts, o) {
      const lead = ts[0];
      // A jack has no knob to read: the control keeps its own value (saved with the panel), centred on 0.
      const home = (t) => (t.lo < 0 && t.hi > 0 ? -t.lo / (t.hi - t.lo) : 0);
      const read = () => {
        if (lead.kind !== "param") return clamp01(o.initial() ?? home(lead));
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
      const draw = () => o.paint(x, lead.lo + x * (lead.hi - lead.lo), lead.def);
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
          } else if (t.kind === "param") {
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
        if (c.spring) move(lead.kind === "param" ? (lead.hi === lead.lo ? 0 : clamp01((lead.def.default - lead.lo) / (lead.hi - lead.lo))) : home(lead));
        else if (dirty) o.save(x);
        dirty = false;
      };
      widgets.push({ refresh: () => { x = read(); draw(); } });
      draw();
      const dflt = lead.kind !== "param" ? home(lead) : (lead.hi === lead.lo ? 0 : clamp01((lead.def.default - lead.lo) / (lead.hi - lead.lo)));
      return { move, end, get: () => x, def: { default: dflt }, steps };
    }

    /// Wires value, drag and display together for dials, faders, buttons and selects.
    function wire(c, bound, e, paint, panel) {
      const label = el("i", "", c.label || "");
      e.append(label);
      const all = targets(c, bound, panel);
      const ts = all.filter((t) => t.kind === "param" || t.kind === "jack");
      if (!all.length || (!ts.length && c.type !== "button")) {
        e.classList.add("dead");
        e.title = (c.wire || []).length ? "Not connected: the module or jack is gone" : "Not wired";
        return null;
      }
      if (!ts.length) { if (!opts.edit) return { ts: [], all, commands: all.filter((t) => t.kind === "command" || t.kind === "press"), move() {}, end() {}, get: () => 0, def: { default: 0 }, steps: 0 }; return null; }
      const d = driver(c, bound, panel, ts, {
        // The board keeps the saved copy; keep this control's value current too, as a refresh re-reads it.
        initial: () => c.value, save: (x) => { c.value = x; host.save(panel.id, c.id, x); },
        paint: (x, units, def) => { paint(x); e.title = `${c.label || def.name}: ${show(def, units)}`; },
      });
      if (opts.edit) return null;
      return Object.assign(d, { ts, all, commands: all.filter((t) => t.kind === "command") });
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
        const cmds = w.commands;
        // A toggle (`toggle`: a Button module in Toggle mode): a press flips it, and the lamp shows what the module says.
        const flips = c.toggle ? cmds.filter((t) => t.kind === "press") : [];
        if (flips.length) {
          const state = () => { const m = host.node(flips[0].sid, bound); return !!(m && m.data && m.data.on); };
          lamp.classList.toggle("on", state());
          widgets.push({
            update: (live) => { const ns = live && live.nodes && live.nodes[flips[0].sid]; if (ns && typeof ns.on === "number") lamp.classList.toggle("on", ns.on > 0.5); },
            refresh: () => lamp.classList.toggle("on", state()),
          });
        }
        e.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          if (flips.length) {   // not held: the new state is saved with the board, like the Button's own view does
            host.begin();
            for (const t of flips) host.toggle(t.sid);
            lamp.classList.toggle("on", !lamp.classList.contains("on"));
            return;
          }
          if (pulses.length || cmds.length) {   // a trigger or gate, or a module's button: held while pressed
            e.setPointerCapture(ev.pointerId);
            for (const t of pulses) host.press(t.sid, true);
            for (const t of cmds) t.kind === "press" ? host.press(t.sid, true) : host.command(t.id, t.cmd, 1);
            lamp.classList.add("on");
            return;
          }
          host.begin();
          // On/off for a toggle; one step further, round again, for a choice.
          w.move(w.steps > 2 ? (Math.round(w.get() * (w.steps - 1)) + 1) % w.steps / (w.steps - 1) : w.get() > 0.5 ? 0 : 1);
          w.end();
        });
        const up = () => {
          if (flips.length) return;
          for (const t of pulses) host.press(t.sid, false);
          for (const t of cmds) t.kind === "press" ? host.press(t.sid, false) : host.command(t.id, t.cmd, 0);
          if (pulses.length || cmds.length) lamp.classList.remove("on");
        };
        e.addEventListener("pointerup", up);
        e.addEventListener("pointercancel", up);
      }
      return e;
    }

    /// Two values at once: x and y, each with its own wires (`axis`).
    function xy(c, bound, panel) {
      const e = el("div", "");
      const dot = el("s", "");
      e.append(dot, el("i", "", c.label || ""));
      const tx = targets(c, bound, panel, "x").filter((t) => t.kind !== "notes" && t.kind !== "command");
      const ty = targets(c, bound, panel, "y").filter((t) => t.kind !== "notes" && t.kind !== "command");
      if (!tx.length && !ty.length) { e.classList.add("dead"); e.title = "Not wired"; return e; }
      const pos = [0.5, 0.5];
      const save = () => host.save(panel.id, c.id, [pos[0], pos[1]]);
      const paint = () => { dot.style.left = pos[0] * 100 + "%"; dot.style.bottom = `calc(20px + (100% - 20px) * ${pos[1]})`; };
      const axes = [];
      [[tx, 0], [ty, 1]].forEach(([ts, k]) => {
        if (!ts.length) return;
        axes[k] = driver(c, bound, panel, ts, { initial: () => (Array.isArray(c.value) ? c.value[k] : undefined), save,
          paint: (x) => { pos[k] = x; paint(); } });
      });
      if (opts.edit) return e;
      let on = false;
      const at = (ev) => {
        const r = e.getBoundingClientRect();
        const x = clamp01((ev.clientX - r.left) / r.width), y = clamp01(1 - (ev.clientY - r.top) / Math.max(1, r.height - 20));
        if (axes[0]) axes[0].move(x);
        if (axes[1]) axes[1].move(y);
      };
      e.addEventListener("pointerdown", (ev) => { if (ev.button !== 0) return; ev.stopPropagation(); e.setPointerCapture(ev.pointerId); host.begin(); on = true; at(ev); });
      e.addEventListener("pointermove", (ev) => { if (on) at(ev); });
      const end = () => { if (on) { on = false; for (const a of axes) if (a) a.end(); } };
      e.addEventListener("pointerup", end);
      e.addEventListener("pointercancel", end);
      paint();
      return e;
    }

    function select(c, bound, panel) {
      const e = el("div", "");
      const sel = el("select", "");
      e.append(sel);
      const ts = targets(c, bound, panel);
      const def = ts.length && ts[0].kind === "param" && ts[0].def;
      // The choices: a knob's own, or the options of a Dial module in steps (`options`).
      const names = def && def.choices ? def.choices : Array.isArray(c.options) && c.options.length > 1 ? c.options : null;
      if (names) names.forEach((name, i) => sel.append(new Option(name, i)));
      const w = wire(c, bound, e, (v) => { if (names) sel.value = String(Math.round(v * (names.length - 1))); }, panel);
      if (w && names) {
        sel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        sel.addEventListener("change", () => { host.begin(); w.move(Number(sel.value) / Math.max(1, names.length - 1)); });
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
      if (!ts.length) { e.classList.add("dead"); e.title = "Not connected: its Keyboard module is gone"; return e; }
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

      // The computer keyboard while the pointer is over the panel: A W S E D F T G Y H U J K … like a piano, Z / X octave.
      const CODES = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
                      KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
      const down = new Map();   // code → note
      let shift = 0;
      const off = (code) => {
        const n = down.get(code);
        if (n === undefined) return;
        for (const t of ts) host.note(t.sid, "off", [n]);
        const k = nodes.get(n);
        if (k) k.classList.remove("on");
        down.delete(code);
      };
      const onDown = (ev) => {
        if (!over || ev.metaKey || ev.ctrlKey || ev.altKey) return;
        const tag = ev.target && ev.target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        if (ev.code === "KeyZ" || ev.code === "KeyX") {
          if (!ev.repeat) shift = Math.max(-3, Math.min(3, shift + (ev.code === "KeyX" ? 1 : -1)));
          ev.preventDefault(); ev.stopPropagation();
          return;
        }
        if (!(ev.code in CODES)) return;
        ev.preventDefault(); ev.stopPropagation();   // not the board's one-letter shortcuts
        if (ev.repeat || down.has(ev.code)) return;
        const n = base + CODES[ev.code] + shift * 12;
        if (n < 0 || n > 127) return;
        down.set(ev.code, n);
        for (const t of ts) host.note(t.sid, "on", [n, 0.8]);
        const k = nodes.get(n);
        if (k) k.classList.add("on");
      };
      const onUp = (ev) => { if (down.has(ev.code)) { ev.stopPropagation(); off(ev.code); } };
      const onBlur = () => { for (const code of [...down.keys()]) off(code); };
      document.addEventListener("keydown", onDown, true);
      document.addEventListener("keyup", onUp, true);
      window.addEventListener("blur", onBlur);
      cleanups.push(() => {
        document.removeEventListener("keydown", onDown, true);
        document.removeEventListener("keyup", onUp, true);
        window.removeEventListener("blur", onBlur);
        onBlur();
        release();
      });
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
      // The editor shows the view as it stands (not live, not reacting: its overlay takes the pointer); a view that
      // cannot be built there is a placeholder.
      const v = node ? host.view(node.id) : null;
      if (opts.edit && (!v || (c.part && !(v.showOnly && v.showOnly(c.part))))) {
        e.classList.add("placeholder");
        e.append(el("span", "", node ? (c.part && c.label) || `${node.name} view` : "view: module missing"));
        return e;
      }
      if (opts.edit) {
        e.classList.add("preview");
        e.append(v.root);
        return e;
      }
      if (!v) { e.classList.add("dead"); return e; }
      // A part of the view (a display, a section of knobs, the buttons) alone; one that is gone shows as a dead box.
      if (c.part && !(v.showOnly && v.showOnly(c.part))) { e.classList.add("dead"); e.append(el("i", "", "Part missing")); return e; }
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
      destroy: () => { for (const f of cleanups.splice(0)) f(); },
    });
  }

  window.BleepPanels = { create, U, units, show, split };
})();
