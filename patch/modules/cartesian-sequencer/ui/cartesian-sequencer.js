// SPDX-License-Identifier: MIT
// Cartesian Seq view (specs/modules/cartesian-sequencer.md §5): the 8 × 8
// grid editor with layers (gate, pitch, velocity, mod, access), row and
// column rotation, copy/paste, the playhead, the X/Y crosshair in Cartesian
// mode and per-layer Randomize. Cells live in the node's data; edits go to
// the engine with api.setData.
(function () {
  "use strict";
  const N = 8, CELLS = 64, CELL = 54, LEFT = 18, TOP = 16, ARROWS = 44, FOOT = 24, MIN_P = -24, MAX_P = 36;
  // Same order and notes as patch/common/dsp/Scales.h.
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const LAYERS = [["gate", "Gate"], ["pitch", "Pitch"], ["velocity", "Vel"], ["mod", "Mod"], ["access", "Access"]];
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function inScale(scale, s) { return SCALES[scale].includes(mod(s, 12)); }
  function quantize(semi, scale) {
    let lo = Math.floor(semi), hi = Math.ceil(semi);
    while (!inScale(scale, lo)) lo--;
    while (!inScale(scale, hi)) hi++;
    return semi - lo <= hi - semi ? lo : hi;
  }
  const setting = (view, id) => view.units(id);
  const scaleOf = (view) => clamp(setting(view, "scale"), 0, SCALES.length - 1);
  const blank = () => ({ g: 0, p: 0, v: 100, m: 0, a: 1 });
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.cells)) d = view.node.data = { cells: [] };
    while (d.cells.length < CELLS) d.cells.push(blank());
    if (!d.randomize) d.randomize = { density: 0.6, octaves: 1, velocity: [0.6, 1], skip: 0 };
    return d;
  }
  function noteName(view, p) {
    const note = 60 + setting(view, "root") + quantize(setting(view, "octave") * 12 + p, scaleOf(view));
    return NAMES[mod(note, 12)] + (Math.floor(note / 12) - 1);
  }
  function area(view) {
    const all = view.cart.showAll;
    return { cols: all ? N : clamp(setting(view, "columns"), 1, N), rows: all ? N : clamp(setting(view, "rows"), 1, N),
             playCols: clamp(setting(view, "columns"), 1, N), playRows: clamp(setting(view, "rows"), 1, N) };
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view));
    send(view);
    draw(view);
  }

  // ---- drawing --------------------------------------------------------------
  function draw(view) {
    const c = view.cart && view.cart.canvas;
    if (!c) return;
    const d = data(view), st = view.cart.state || {}, a = area(view);
    const w = LEFT + a.cols * CELL + ARROWS, h = TOP + a.rows * CELL + FOOT;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px";
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#e8c547";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const panel = css.getPropertyValue("--panel").trim() || "#222";
    const layer = view.cart.layer;
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = muted;
    for (let x = 0; x < a.cols; x++) g.fillText(String(x + 1), LEFT + x * CELL + CELL / 2, TOP / 2);
    for (let y = 0; y < a.rows; y++) g.fillText(String(y + 1), LEFT / 2, TOP + y * CELL + CELL / 2);
    for (let y = 0; y < a.rows; y++)
      for (let x = 0; x < a.cols; x++) {
        const s = d.cells[y * N + x], X = LEFT + x * CELL, Y = TOP + y * CELL;
        const outside = x >= a.playCols || y >= a.playRows;
        g.globalAlpha = outside ? 0.35 : 1;
        g.fillStyle = panel;
        g.fillRect(X + 1, Y + 1, CELL - 2, CELL - 2);
        g.strokeStyle = line;
        g.strokeRect(X + 1.5, Y + 1.5, CELL - 3, CELL - 3);
        // mod tint (corner)
        if (s.m) {
          g.globalAlpha = (outside ? 0.35 : 1) * (0.25 + 0.6 * Math.abs(s.m) / 100);
          g.fillStyle = s.m > 0 ? accent : text;
          g.beginPath();
          g.moveTo(X + 2, Y + CELL - 2); g.lineTo(X + 2, Y + CELL - 16); g.lineTo(X + 16, Y + CELL - 2);
          g.fill();
          g.globalAlpha = outside ? 0.35 : 1;
        }
        const dim = !s.a || s.g === 0;
        // gate glyph
        g.fillStyle = accent;
        g.strokeStyle = muted;
        if (s.g === 0) g.strokeRect(X + CELL - 15.5, Y + 5.5, 9, 9);
        else if (s.g === 1) g.fillRect(X + CELL - 16, Y + 5, 10, 10);
        else g.fillRect(X + CELL - 26, Y + 7, 20, 6);
        // note name
        g.fillStyle = dim ? muted : text;
        g.font = layer === "pitch" ? "bold 12px system-ui, sans-serif" : "11px system-ui, sans-serif";
        g.fillText(s.g === 0 ? "—" : noteName(view, s.p), X + CELL / 2, Y + CELL / 2 + 1);
        g.font = "9px system-ui, sans-serif";
        if (layer === "mod" || layer === "velocity") {
          g.fillStyle = muted;
          g.fillText(layer === "mod" ? (s.m > 0 ? "+" : "") + s.m : String(s.v), X + 14, Y + 10);
        }
        // velocity bar
        g.fillStyle = accent;
        g.globalAlpha *= dim ? 0.4 : 0.9;
        g.fillRect(X + 5, Y + CELL - 7, ((CELL - 10) * (s.v - 1)) / 126, layer === "velocity" ? 4 : 2);
        g.globalAlpha = outside ? 0.35 : 1;
        // skipped
        if (!s.a) {
          g.strokeStyle = text;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(X + 6, Y + 6); g.lineTo(X + CELL - 6, Y + CELL - 6);
          g.moveTo(X + CELL - 6, Y + 6); g.lineTo(X + 6, Y + CELL - 6);
          g.stroke();
          g.lineWidth = 1;
        }
        g.globalAlpha = 1;
      }
    // playhead
    if (typeof st.cell === "number") {
      const x = st.cell % N, y = Math.floor(st.cell / N);
      if (x < a.cols && y < a.rows) {
        g.strokeStyle = accent;
        g.lineWidth = st.sounding ? 3 : 2;
        g.strokeRect(LEFT + x * CELL + 2, TOP + y * CELL + 2, CELL - 4, CELL - 4);
        g.lineWidth = 1;
      }
    }
    // crosshair: the Cartesian position over the playing area
    if (setting(view, "mode") === 1 && typeof st.px === "number") {
      const cx = LEFT + clamp(st.px, 0, 1) * a.playCols * CELL, cy = TOP + clamp(st.py, 0, 1) * a.playRows * CELL;
      g.strokeStyle = text;
      g.globalAlpha = 0.8;
      g.beginPath();
      g.moveTo(cx, TOP); g.lineTo(cx, TOP + a.playRows * CELL);
      g.moveTo(LEFT, cy); g.lineTo(LEFT + a.playCols * CELL, cy);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, 5, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    // rotate arrows
    g.fillStyle = muted;
    g.font = "11px system-ui, sans-serif";
    for (let y = 0; y < a.rows; y++) {
      const Y = TOP + y * CELL + CELL / 2, X = LEFT + a.cols * CELL;
      g.fillText("◀", X + 12, Y);
      g.fillText("▶", X + 32, Y);
    }
    for (let x = 0; x < a.cols; x++) {
      const X = LEFT + x * CELL + CELL / 2, Y = TOP + a.rows * CELL + FOOT / 2;
      g.fillText("▲", X - 10, Y);
      g.fillText("▼", X + 10, Y);
    }
    view.cart.info.textContent = `${a.playCols} × ${a.playRows}` + (setting(view, "mode") === 1 ? " · Cartesian" : "");
  }

  // ---- editing --------------------------------------------------------------
  function hit(view, c, e) {
    const r = c.getBoundingClientRect(), a = area(view);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const x = Math.floor((px - LEFT) / CELL), y = Math.floor((py - TOP) / CELL);
    if (x >= 0 && x < a.cols && y >= 0 && y < a.rows) return { kind: "cell", x, y, i: y * N + x, py };
    if (y >= 0 && y < a.rows && px >= LEFT + a.cols * CELL) return { kind: "row", y, by: px < LEFT + a.cols * CELL + 22 ? -1 : 1 };
    if (x >= 0 && x < a.cols && py >= TOP + a.rows * CELL)
      return { kind: "col", x, by: px - (LEFT + x * CELL) < CELL / 2 ? -1 : 1 };
    return null;
  }
  const FIELD = { gate: "g", pitch: "p", velocity: "v", mod: "m", access: "a" };
  function rotateRow(view, y, by) {
    edit(view, (d) => {
      const n = clamp(setting(view, "columns"), 1, N), row = [];
      for (let x = 0; x < n; x++) row.push(d.cells[y * N + x]);
      for (let x = 0; x < n; x++) d.cells[y * N + x] = row[mod(x - by, n)];
    });
  }
  function rotateCol(view, x, by) {
    edit(view, (d) => {
      const n = clamp(setting(view, "rows"), 1, N), col = [];
      for (let y = 0; y < n; y++) col.push(d.cells[y * N + x]);
      for (let y = 0; y < n; y++) d.cells[y * N + x] = col[mod(y - by, n)];
    });
  }
  function attach(view, c) {
    let drag = null;
    const apply = (e) => {
      const h = hit(view, c, e);
      if (!h || h.kind !== "cell") return;
      const d = data(view), s = d.cells[h.i], f = FIELD[drag.layer];
      if (drag.paint !== undefined) {
        if (s[f] === drag.paint) return;
        s[f] = drag.paint;
      } else if (h.i !== drag.i) {
        return;  // value drags stay on their cell
      } else {
        const dy = drag.y0 - e.clientY;
        if (drag.layer === "pitch") {
          let p = drag.v0 + dy / (e.shiftKey ? 8 : 5);
          p = e.shiftKey ? Math.round(p) : quantize(p, scaleOf(view));
          s.p = clamp(p, MIN_P, MAX_P);
        } else if (drag.layer === "velocity") s.v = clamp(Math.round(drag.v0 + dy / (e.shiftKey ? 4 : 1)), 1, 127);
        else if (drag.layer === "mod") s.m = clamp(Math.round(drag.v0 + dy / (e.shiftKey ? 4 : 1)), -100, 100);
      }
      send(view);
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      closeMenu(view);
      const h = hit(view, c, e);
      if (!h) return;
      e.stopPropagation();
      if (h.kind === "row") return rotateRow(view, h.y, h.by);
      if (h.kind === "col") return rotateCol(view, h.x, h.by);
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      const layer = view.cart.layer, s = data(view).cells[h.i], f = FIELD[layer];
      drag = { layer, i: h.i, y0: e.clientY, v0: s[f] };
      if (e.altKey) drag.paint = s[f];                         // Alt: paint the first cell's value
      else if (layer === "gate") drag.paint = (s.g + 1) % 3;   // click cycles, drag paints
      else if (layer === "access") drag.paint = s.a ? 0 : 1;
      apply(e);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const h = hit(view, c, e);
      if (!h || h.kind !== "cell") return;
      const layer = view.cart.layer;
      if (layer === "pitch") edit(view, (d) => (d.cells[h.i].p = 0));
      else if (layer === "velocity") edit(view, (d) => (d.cells[h.i].v = 100));
      else if (layer === "mod") edit(view, (d) => (d.cells[h.i].m = 0));
    });
    c.addEventListener("contextmenu", (e) => {
      const h = hit(view, c, e);
      if (!h || h.kind !== "cell") return;
      e.preventDefault();
      e.stopPropagation();
      openMenu(view, e, h.i);
    });
  }

  // ---- copy / paste / reset menu ----------------------------------------------
  function closeMenu(view) {
    if (view.cart.menu) { view.cart.menu.remove(); view.cart.menu = null; }
  }
  function openMenu(view, e, i) {
    closeMenu(view);
    const m = document.createElement("div");
    m.className = "cart-menu";
    const wrap = view.cart.wrap.getBoundingClientRect();
    m.style.left = e.clientX - wrap.left + "px";
    m.style.top = e.clientY - wrap.top + "px";
    const item = (label, fn, disabled) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.disabled = !!disabled;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); closeMenu(view); fn(); });
      m.appendChild(b);
    };
    item("Copy", () => (view.cart.clipboard = { ...data(view).cells[i] }));
    item("Paste", () => edit(view, (d) => (d.cells[i] = { ...view.cart.clipboard })), !view.cart.clipboard);
    item("Reset", () => edit(view, (d) => (d.cells[i] = blank())));
    view.cart.wrap.appendChild(m);
    view.cart.menu = m;
  }

  // ---- Randomize ------------------------------------------------------------
  function randomize(view, layers) {
    edit(view, (d) => {
      const o = d.randomize, scale = scaleOf(view), notes = [];
      for (let k = 0; k <= 12 * (o.octaves || 1); k++) if (inScale(scale, k)) notes.push(k);
      const [lo, hi] = o.velocity || [0.6, 1];
      const cols = clamp(setting(view, "columns"), 1, N), rows = clamp(setting(view, "rows"), 1, N);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const s = d.cells[y * N + x];
          if (layers.includes("gate")) s.g = Math.random() < (o.density ?? 0.6) ? (Math.random() < 0.125 ? 2 : 1) : 0;
          if (layers.includes("pitch")) s.p = notes[Math.floor(Math.random() * notes.length)];
          if (layers.includes("velocity")) s.v = clamp(Math.round((lo + Math.random() * (hi - lo)) * 127), 1, 127);
          if (layers.includes("mod")) s.m = Math.round(Math.random() * 200 - 100);
          if (layers.includes("access")) s.a = Math.random() < (o.skip || 0) ? 0 : 1;
        }
    });
  }
  function options(view, box) {
    const o = data(view).randomize;
    box.innerHTML = "";
    const row = (label, input) => {
      const r = document.createElement("label");
      r.className = "seq-opt";
      r.append(Object.assign(document.createElement("span"), { textContent: label }), input);
      box.appendChild(r);
    };
    const save = () => { view.api.beginGesture(); send(view); };
    const number = (value, min, max, set) => {
      const n = Object.assign(document.createElement("input"), { type: "number", min, max, value, className: "bv-number" });
      n.addEventListener("change", () => { set(clamp(parseFloat(n.value) || 0, min, max)); save(); options(view, box); });
      return n;
    };
    row("Density %", number(Math.round(o.density * 100), 0, 100, (v) => (o.density = v / 100)));
    row("Octaves", number(o.octaves, 1, 3, (v) => (o.octaves = Math.round(v))));
    row("Velocity low %", number(Math.round(o.velocity[0] * 100), 1, 100, (v) => (o.velocity = [v / 100, Math.max(v / 100, o.velocity[1])])));
    row("Velocity high %", number(Math.round(o.velocity[1] * 100), 1, 100, (v) => (o.velocity = [Math.min(v / 100, o.velocity[0]), v / 100])));
    row("Skip density %", number(Math.round((o.skip || 0) * 100), 0, 50, (v) => (o.skip = v / 100)));
  }

  const STYLE = `
    .cart-panel { flex: 1 1 100%; min-width: 0; position: relative; }
    .cart-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .cart-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; }
    .cart-tools button.on { border-color: var(--accent); color: var(--accent); }
    .cart-tools .cart-info { margin-left: auto; color: var(--muted); font-size: 11px; }
    .cart-tools .cart-gap { width: 8px; }
    .cart-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 4px 12px;
      margin-bottom: 6px; font-size: 11px; color: var(--muted); }
    .cart-options .seq-opt { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .cart-options .bv-number { width: 56px; }
    .cart-wrap { position: relative; overflow-x: auto; }
    .cart-wrap canvas { display: block; touch-action: none; cursor: crosshair; }
    .cart-menu { position: absolute; z-index: 5; display: flex; flex-direction: column; background: var(--panel);
      border: 1px solid var(--line); border-radius: 6px; padding: 2px; }
    .cart-menu button { background: none; border: 0; color: var(--text); text-align: left; padding: 3px 12px;
      font: inherit; font-size: 11px; cursor: pointer; }
    .cart-menu button:hover:not(:disabled) { color: var(--accent); }
    .cart-menu button:disabled { color: var(--muted); cursor: default; }`;

  BleepViews.register("cartesian-sequencer", {
    top: true,
    width: 600,
    template: `<div class="bv-panel cart-panel">
      <div class="cart-tools">
        <span class="cart-layers"></span>
        <span class="cart-gap"></span>
        <button class="cart-rand" title="Randomize the shown layer (one undo step)">Randomize</button>
        <button class="cart-more" title="Randomize options">▾</button>
        <button class="cart-all" title="Show the whole 8 × 8 grid">Show all</button>
        <span class="cart-info"></span>
      </div>
      <div class="cart-options" hidden></div>
      <div class="cart-wrap"><canvas></canvas></div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("cart-style")) {
        const s = document.createElement("style");
        s.id = "cart-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.cart = { canvas, wrap: el.querySelector(".cart-wrap"), info: el.querySelector(".cart-info"), state: null,
                    layer: "gate", showAll: false, clipboard: null, menu: null };
      const layers = el.querySelector(".cart-layers");
      for (const [id, label] of LAYERS) {
        const b = document.createElement("button");
        b.textContent = label;
        b.dataset.layer = id;
        b.title = id === "gate" ? "Click cycles Off → On → Tie; drag paints" : id === "access" ? "Click skips a cell or plays it again"
          : "Drag up and down on a cell (Shift: fine); double-click resets";
        b.addEventListener("click", () => {
          view.cart.layer = id;
          for (const o of layers.children) o.classList.toggle("on", o === b);
          draw(view);
        });
        if (id === "gate") b.classList.add("on");
        layers.appendChild(b);
      }
      attach(view, canvas);
      const box = el.querySelector(".cart-options"), more = el.querySelector(".cart-more");
      el.querySelector(".cart-rand").addEventListener("click", () => randomize(view, [view.cart.layer]));
      more.addEventListener("click", () => {
        box.hidden = !box.hidden;
        more.classList.toggle("on", !box.hidden);
        if (!box.hidden) options(view, box);
      });
      const all = el.querySelector(".cart-all");
      all.addEventListener("click", () => {
        view.cart.showAll = !view.cart.showAll;
        all.classList.toggle("on", view.cart.showAll);
        draw(view);
      });
      document.addEventListener("pointerdown", (e) => { if (view.cart.menu && !view.cart.menu.contains(e.target)) closeMenu(view); });
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.cart) return;
      view.cart.state = st;
      draw(view);
    },
    onRefresh(view) {
      const box = view.root.querySelector(".cart-options");
      if (box && !box.hidden) options(view, box);
      draw(view);
    },
  });
})();
