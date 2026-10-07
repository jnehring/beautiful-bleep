// SPDX-License-Identifier: MIT
// bleep-module.js — the shared Bleep Patch module UI library.
//
// A module's ui/index.html loads this file last. It builds the standard page
// (header, knobs, settings, ports) from native("describe"); live values
// arrive in "state" events, cables in "patch" events.
//
// A module customises its page through window.BleepModule (its <slug>.js):
//   demo         description used by bleep-demo.js in a plain browser
//   afterBuild(module, customSection)   add module-specific views
//   onState(state, module)              update them, 30 times per second
// and through markup in <template id="module-custom">, which is copied into
// the custom section before afterBuild runs.
(function () {
  "use strict";
  const hooks = window.BleepModule || {};
  const SKELETON = `
    <header class="top">
      <div class="product" id="product">…</div>
      <input class="name" id="name" spellcheck="false" maxlength="63" aria-label="Instance name">
      <div class="status" id="status"></div>
    </header>
    <main>
      <section class="knobs" id="knobs" aria-label="Parameters"></section>
      <section class="custom" id="custom"></section>
      <section class="settings" id="settings" aria-label="Settings"></section>
      <section class="ports">
        <div class="port-col" id="inputs-col"><h2>In</h2><div id="inputs"></div></div>
        <div class="port-col" id="outputs-col"><h2>Out</h2><div id="outputs"></div></div>
      </section>
    </main>`;
  const app = document.getElementById("app") || document.body;
  app.insertAdjacentHTML("afterbegin", SKELETON);
  const $ = (id) => document.getElementById(id);
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

  let module = null;            // describe() result
  let sources = [];             // bus outputs
  let connections = {};         // input name → cables
  const knobs = new Map();      // param id → knob view
  const pickers = [];           // all source pickers
  const scopes = new Map();     // output name → scope view
  const settings = new Map();   // param id → setting view
  const inputJacks = new Map(); // input name → jack element

  // ---------------------------------------------------------------- knobs
  const START = -135, END = 135;
  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arcPath(r, from, to) {
    if (to < from) [from, to] = [to, from];
    if (to - from < 0.5) to = from + 0.5;
    const [x1, y1] = polar(32, 32, r, from), [x2, y2] = polar(32, 32, r, to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }
  const angle = (v) => START + (END - START) * v;

  function makeKnob(p) {
    const root = el("div", "knob");
    root.appendChild(el("div", "label", p.name));
    const s = svg("svg", { viewBox: "0 0 64 64" });
    const track = svg("path", { class: "track", d: arcPath(24, START, END), fill: "none", "stroke-width": 4, "stroke-linecap": "round" });
    const arc = svg("path", { class: "arc", fill: "none", "stroke-width": 4, "stroke-linecap": "round" });
    const ring = svg("path", { class: "ring", fill: "none", "stroke-width": 3, "stroke-linecap": "round", opacity: 0 });
    const pointer = svg("line", { class: "pointer", "stroke-width": 2, "stroke-linecap": "round" });
    s.append(track, arc, ring, pointer);
    root.appendChild(s);
    const value = el("div", "value", "");
    root.appendChild(value);

    const view = { p, root, arc, ring, pointer, value, v: p.default, eff: p.default, active: false, dragging: false };
    view.draw = function () {
      arc.setAttribute("d", arcPath(24, START, angle(this.v)));
      const [x1, y1] = polar(32, 32, 10, angle(this.v)), [x2, y2] = polar(32, 32, 20, angle(this.v));
      pointer.setAttribute("x1", x1); pointer.setAttribute("y1", y1);
      pointer.setAttribute("x2", x2); pointer.setAttribute("y2", y2);
      // Live modulation: a ring from the knob to the effective value.
      ring.setAttribute("opacity", this.active ? 1 : 0);
      if (this.active) ring.setAttribute("d", arcPath(29, angle(this.v), angle(this.eff)));
      root.classList.toggle("modulated", this.active);
    };

    // Drag: vertical, 200 px for the full range, Shift for fine. Double-click resets.
    let startY = 0, startV = 0;
    s.addEventListener("pointerdown", (e) => {
      s.setPointerCapture(e.pointerId);
      startY = e.clientY; startV = view.v; view.dragging = true;
      native("beginGesture", p.id);
    });
    s.addEventListener("pointermove", (e) => {
      if (!view.dragging) return;
      const range = e.shiftKey ? 1000 : 200;
      view.v = Math.min(1, Math.max(0, startV + (startY - e.clientY) / range));
      view.draw();
      native("setParam", p.id, view.v);
    });
    const end = () => { if (view.dragging) { view.dragging = false; native("endGesture", p.id); } };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("dblclick", () => {
      view.v = p.default; view.draw();
      native("beginGesture", p.id); native("setParam", p.id, view.v); native("endGesture", p.id);
    });
    s.addEventListener("wheel", (e) => {
      e.preventDefault();
      view.v = Math.min(1, Math.max(0, view.v - e.deltaY / (e.shiftKey ? 3000 : 600)));
      view.draw();
      native("setParam", p.id, view.v);
    }, { passive: false });

    if (p.input) root.appendChild(makePicker(p.input, 0.5).root);
    view.draw();
    return view;
  }

  // -------------------------------------------------------- source pickers
  // One source per input from this UI (the bus allows more; the patchbay
  // will show them). Changing the source replaces the cable.
  function sourceKey(uid, output) { return uid + "|" + output; }
  function sourceLabel(s) {
    const owner = s.self ? s.owner + " (this)" : s.owner;
    return (s.track ? s.track + " › " : "") + owner;
  }

  function makePicker(inputName, defaultAmount) {
    const root = el("div", "source");
    const select = el("select");
    select.title = "Modulation source for " + inputName;
    const amount = el("input", "amount");
    amount.type = "range"; amount.min = -1; amount.max = 1; amount.step = 0.001;
    amount.value = defaultAmount; amount.hidden = true;
    amount.title = "Amount";
    root.append(select, amount);
    const picker = { inputName, root, select, amount, current: null };

    picker.render = function () {
      const cables = connections[inputName] || [];
      const c = cables[0] || null;
      this.current = c;
      const keep = document.activeElement === select;
      select.innerHTML = "";
      select.appendChild(new Option("— no source —", ""));
      const groups = new Map();
      for (const s of sources) {
        const g = sourceLabel(s);
        if (!groups.has(g)) { const og = document.createElement("optgroup"); og.label = g; groups.set(g, og); }
        groups.get(g).appendChild(new Option(s.output, sourceKey(s.uid, s.output)));
      }
      groups.forEach((og) => select.appendChild(og));
      if (c) {
        const key = sourceKey(c.uid, c.output);
        if (!c.present) select.appendChild(new Option("⚠ missing: " + c.output + " (" + c.uid.slice(-4) + ")", key));
        select.value = key;
        amount.value = c.amount;
      } else {
        select.value = "";
      }
      if (keep) select.focus();
      select.classList.toggle("patched", !!c && c.present);
      select.classList.toggle("missing", !!c && !c.present);
      amount.hidden = !c;
      if (cables.length > 1) select.title = cables.length + " cables; the first is shown";
    };

    select.addEventListener("change", () => {
      if (!select.value) { native("disconnect", inputName); return; }
      const [uid, output] = select.value.split("|");
      native("connect", inputName, uid, output, parseFloat(amount.value));
    });
    amount.addEventListener("input", () => {
      if (picker.current) native("setAmount", inputName, picker.current.uid, picker.current.output, parseFloat(amount.value));
    });
    amount.addEventListener("dblclick", () => {
      amount.value = defaultAmount;
      amount.dispatchEvent(new Event("input"));
    });
    pickers.push(picker);
    picker.render();
    return picker;
  }

  // -------------------------------------------------------------- settings
  function makeSetting(p) {
    const root = el("div", "setting");
    root.appendChild(el("span", "label", p.name));
    const view = { p, root };
    if (p.kind === "bool") {
      const b = el("button", "toggle", p.name);
      root.firstChild.remove();
      b.addEventListener("click", () => native("setParam", p.id, view.v >= 0.5 ? 0 : 1));
      root.appendChild(b);
      view.set = (v, text) => { view.v = v; b.classList.toggle("on", v >= 0.5); };
    } else if (p.kind === "choice" || (p.kind === "int" && p.steps <= 129)) {
      const select = el("select");
      const steps = Math.max(2, p.steps);
      const labels = p.choices || null;
      for (let i = 0; i < steps; i++) select.appendChild(new Option(labels ? labels[i] : String(i), i));
      select.addEventListener("change", () => native("setParam", p.id, parseInt(select.value, 10) / (steps - 1)));
      root.appendChild(select);
      view.set = (v, text) => {
        view.v = v;
        const i = Math.round(v * (steps - 1));
        if (!labels && select.options[i]) select.options[i].text = text;
        if (document.activeElement !== select) select.value = i;
      };
    } else {
      const r = el("input"); r.type = "range"; r.min = 0; r.max = 1; r.step = 0.0001;
      const t = el("span", "value");
      r.addEventListener("input", () => native("setParam", p.id, parseFloat(r.value)));
      root.append(r, t);
      view.set = (v, text) => { view.v = v; if (document.activeElement !== r) r.value = v; t.textContent = text; };
    }
    return view;
  }

  // ------------------------------------------------------------------ ports
  function makeInput(port) {
    const row = el("div", "port");
    const name = el("div", "pname");
    const jack = el("span", "jack");
    name.append(jack, document.createTextNode(port.name));
    row.appendChild(name);
    row.appendChild(makePicker(port.name, 1.0).root);
    inputJacks.set(port.name, jack);
    return row;
  }

  function makeOutput(port) {
    const row = el("div", "port out");
    const name = el("div", "pname");
    name.append(el("span", "jack"), document.createTextNode(port.name));
    const canvas = el("canvas", "scope");
    canvas.title = port.type + (port.bipolar ? ", bipolar" : ", unipolar");
    row.append(name, canvas);
    const view = { port, canvas, history: new Float32Array(120), head: 0 };
    view.push = function (v) { this.history[this.head] = v; this.head = (this.head + 1) % this.history.length; };
    view.draw = function () {
      const c = this.canvas, dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const lo = this.port.bipolar ? -1 : 0, hi = 1;
      const y = (v) => h - 3 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * (h - 6);
      if (this.port.bipolar) { g.strokeStyle = "#333845"; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke(); }
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
      g.lineWidth = 1.5;
      g.beginPath();
      const n = this.history.length;
      for (let i = 0; i < n; i++) {
        const v = this.history[(this.head + i) % n];
        const x = i / (n - 1) * w;
        i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v));
      }
      g.stroke();
    };
    scopes.set(port.name, view);
    return row;
  }

  // ------------------------------------------------------------- lifecycle
  function setStatus(text) {
    $("status").textContent = text || "";
    $("status").classList.toggle("offline", /offline|could not/i.test(text || ""));
  }

  async function build() {
    module = await native("describe");
    if (!module) return;
    document.documentElement.style.setProperty("--accent", module.colour);
    document.title = module.product;
    $("product").textContent = module.product;
    $("name").value = module.name;
    setStatus(module.status);
    sources = (await native("sources")) || [];
    connections = (await native("connections")) || {};

    for (const p of module.params) {
      if (p.kind === "float") {
        const k = makeKnob(p);
        knobs.set(p.id, k);
        $("knobs").appendChild(k.root);
      } else {
        const s = makeSetting(p);
        settings.set(p.id, s);
        $("settings").appendChild(s.root);
      }
    }
    if (!module.inputs.length) $("inputs").appendChild(el("div", "empty", "—"));
    for (const port of module.inputs) $("inputs").appendChild(makeInput(port));
    for (const port of module.outputs) $("outputs").appendChild(makeOutput(port));
    if (!module.outputs.length) $("outputs-col").hidden = true;
    pickers.forEach((p) => p.render());

    const custom = $("custom");
    const tpl = document.getElementById("module-custom");
    if (tpl) custom.appendChild(tpl.content.cloneNode(true));
    if (hooks.afterBuild) hooks.afterBuild(module, custom);
    if (!custom.childElementCount) custom.remove();
  }

  $("name").addEventListener("change", async (e) => { e.target.value = await native("setName", e.target.value); });
  $("name").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

  onNative("state", (s) => {
    if (!module) return;
    if (hooks.onState) hooks.onState(s, module);
    for (const id in s.params) {
      const k = knobs.get(id);
      if (k) {
        if (!k.dragging) k.v = s.params[id].v;
        k.value.textContent = s.params[id].text;
        const m = s.mods[id];
        k.active = !!(m && m.active);
        if (m) k.eff = m.v;
        k.draw();
      }
      const st = settings.get(id);
      if (st) st.set(s.params[id].v, s.params[id].text);
    }
    for (const name in s.outputs) {
      const sc = scopes.get(name);
      if (sc) { sc.push(s.outputs[name]); sc.draw(); }
    }
    for (const name in s.inputs) {
      const j = inputJacks.get(name);
      if (j) j.classList.toggle("on", !!s.inputs[name]);
    }
  });

  onNative("patch", (p) => {
    if (p.sources) sources = p.sources;
    if (p.connections) connections = p.connections;
    if (p.status) setStatus(p.status);
    if (p.name && document.activeElement !== $("name")) $("name").value = p.name;
    pickers.forEach((pk) => pk.render());
  });

  build();
})();
