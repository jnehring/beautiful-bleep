// SPDX-License-Identifier: MIT
// Additive Osc view (doc/specs/modules/additive-oscillator.md §5): the final level
// of each partial at its real frequency (log axis, live arrays from the
// module) with the band limit marked, and, with Base = Drawn, an editor for
// the 64 drawn levels (node data "drawn"; one drag is one undo step).
(function () {
  "use strict";
  const P = 64, LO = 20, HI = 24000;
  const STYLE = `
    .aosc-tools { display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0; }
    .aosc-tools button { font-size: 11px; }
    .aosc-draw canvas { cursor: crosshair; }
  `;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const base = (view) => {
    const p = view.type.params.find((x) => x.id === "base");
    return Math.round((view.node.params.base ?? p.default) * (p.steps - 1));
  };
  const presets = {
    saw: (n) => 1 / n,
    square: (n) => (n % 2 ? 1 / n : 0),
    flat: (n) => 1 / Math.sqrt(n),
  };
  function drawn(view) {
    const d = view.node.data && Array.isArray(view.node.data.drawn) ? view.node.data.drawn.slice(0, P) : [];
    for (let n = d.length + 1; n <= P; n++) d.push(1 / n);
    return d.map((v) => clamp(+v || 0, 0, 1));
  }
  function save(view, levels) {
    const data = Object.assign({}, view.node.data || {}, { drawn: levels.map((v) => Math.round(v * 1e4) / 1e4) });
    view.node.data = data;
    view.api.setData(JSON.parse(JSON.stringify(data)));
  }

  function canvas2d(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function colours(view) {
    const css = getComputedStyle(view.root);
    const v = (k, d) => css.getPropertyValue(k).trim() || d;
    return { accent: v("--accent", "#a3e635"), line: v("--line", "#333"), muted: v("--muted", "#888"), text: v("--text", "#ddd") };
  }

  function drawSpectrum(view, st) {
    const c = view.root.querySelector(".aosc-spec");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = canvas2d(c);
    const col = colours(view);
    if (st && st.arrays) view.aosc.arrays = st.arrays;
    if (st && st.limit) view.aosc.limit = st.limit;
    const a = view.aosc.arrays || {}, levels = a.levels || [], hz = a.hz || [];
    const X = (f) => (Math.log(f / LO) / Math.log(HI / LO)) * w;
    g.strokeStyle = col.line;
    g.fillStyle = col.muted;
    g.font = "9px system-ui, sans-serif";
    for (const f of [100, 1000, 10000]) {
      g.beginPath(); g.moveTo(X(f) + 0.5, 0); g.lineTo(X(f) + 0.5, h); g.stroke();
      g.fillText(f >= 1000 ? f / 1000 + "k" : String(f), X(f) + 2, h - 2);
    }
    let peak = 1e-9;
    for (const v of levels) peak = Math.max(peak, v);
    g.strokeStyle = col.accent;
    g.lineWidth = 2;
    for (let i = 0; i < levels.length; i++) {
      if (!(levels[i] > 1e-6) || !(hz[i] > LO)) continue;  // dropped partials are hidden
      const db = 20 * Math.log10(levels[i] / peak);
      const bh = clamp((db + 60) / 60, 0, 1) * (h - 12);
      const x = Math.round(X(hz[i])) + 0.5;
      g.beginPath(); g.moveTo(x, h - 12); g.lineTo(x, h - 12 - bh); g.stroke();
    }
    g.lineWidth = 1;
    if (view.aosc.limit) {
      const x = Math.round(X(view.aosc.limit)) + 0.5;
      g.setLineDash([3, 3]);
      g.strokeStyle = col.text;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 12); g.stroke();
      g.setLineDash([]);
    }
  }

  function drawEditor(view) {
    const box = view.root.querySelector(".aosc-draw");
    if (!box) return;
    box.hidden = base(view) !== 3;
    const c = box.querySelector("canvas");
    if (box.hidden || !c.clientWidth) return;
    const { g, w, h } = canvas2d(c);
    const col = colours(view), d = drawn(view), bw = w / P;
    g.fillStyle = col.accent;
    for (let i = 0; i < P; i++) {
      const bh = d[i] * (h - 2);
      g.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
    }
    g.strokeStyle = col.line;
    g.beginPath();
    for (let i = 8; i < P; i += 8) { g.moveTo(i * bw + 0.5, 0); g.lineTo(i * bw + 0.5, h); }
    g.stroke();
  }

  function attachEditor(view, box) {
    const c = box.querySelector("canvas");
    let drag = null;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return { i: clamp(Math.floor(((e.clientX - r.left) / r.width) * P), 0, P - 1), v: clamp(1 - (e.clientY - r.top) / r.height, 0, 1), y: e.clientY };
    };
    const apply = (e) => {
      const { i, v, y } = at(e), d = drag.levels;
      if (e.shiftKey) d[i] = clamp(drag.start[i] + (drag.y0 - y) / 400, 0, 1);  // fine, relative
      else {
        // Paint every bar between the last and this position.
        const from = drag.last ?? i;
        for (let k = Math.min(from, i); k <= Math.max(from, i); k++) d[k] = v;
      }
      drag.last = i;
      save(view, d);
      drawEditor(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      const levels = drawn(view);
      drag = { levels, start: levels.slice(), y0: e.clientY, last: null };
      apply(e);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const { i } = at(e), d = drawn(view);
      view.api.beginGesture();
      d[i] = 1 / (i + 1);
      save(view, d);
      drawEditor(view);
    });
    const edit = (fn) => {
      view.api.beginGesture();
      const d = drawn(view);
      fn(d);
      save(view, d);
      drawEditor(view);
    };
    for (const b of box.querySelectorAll("button[data-preset]"))
      b.addEventListener("click", () => edit((d) => d.forEach((_, i) => (d[i] = presets[b.dataset.preset](i + 1)))));
    box.querySelector(".aosc-smooth").addEventListener("click", () => edit((d) => {
      const s = d.slice();
      for (let i = 0; i < P; i++) d[i] = (s[Math.max(i - 1, 0)] + 2 * s[i] + s[Math.min(i + 1, P - 1)]) / 4;
    }));
    box.querySelector(".aosc-random").addEventListener("click", () => edit((d) => d.forEach((_, i) => (d[i] = Math.random() ** 2 / Math.sqrt(i + 1)))));
  }

  BleepViews.register("additive-osc", {
    width: 600,
    top: true,
    template: `
      <div class="bv-panel"><h2>Spectrum</h2><canvas class="aosc-spec" style="height:96px"></canvas></div>
      <div class="bv-panel aosc-draw" hidden><h2>Drawn spectrum</h2>
        <canvas style="height:72px"></canvas>
        <div class="aosc-tools">
          <button class="bv-button" data-preset="saw" title="1/n">Saw</button>
          <button class="bv-button" data-preset="square" title="Odd partials, 1/n">Square</button>
          <button class="bv-button" data-preset="flat" title="1/√n">Flat</button>
          <button class="bv-button aosc-smooth" title="Smooth neighbouring bars">Smooth</button>
          <button class="bv-button aosc-random" title="Random levels">Randomize</button>
        </div>
      </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("aosc-style")) {
        const s = document.createElement("style");
        s.id = "aosc-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.aosc = { arrays: null, limit: 0 };
      attachEditor(view, el.querySelector(".aosc-draw"));
      requestAnimationFrame(() => { drawSpectrum(view, null); drawEditor(view); });
    },
    onState(st, view) {
      drawSpectrum(view, st);
      const box = view.root.querySelector(".aosc-draw");
      if (box && box.hidden !== (base(view) !== 3)) drawEditor(view);
    },
    onRefresh(view) { drawEditor(view); },
  });
})();
