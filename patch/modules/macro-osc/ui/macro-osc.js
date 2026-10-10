// SPDX-License-Identifier: MIT
// Macro Osc view (doc/specs/modules/macro-oscillator.md §5): a 4 × 4 model
// picker (Pitched / Noise / Struck, the playing model highlighted, a fading
// one outlined), the scope of Out (solid) and Aux (dashed) from the module's
// live arrays (two cycles for pitched models, 50 ms for the others), and the
// spectrum of Out (1024 raw samples, Hann window, log frequency). Decay and
// Gate Colour are dimmed while Trigger is unpatched; the drum models say
// "patch Trigger" then.
(function () {
  "use strict";
  const MODELS = ["VA Pair", "Fold", "FM", "Phase Warp", "Grain", "Harmonic", "Table", "Chord", "Vowel",
    "Noise Band", "Dust", "Pluck", "Modal", "Kick", "Snare", "Metal"];
  const GROUP = (m) => (m <= 8 ? "pitched" : m <= 10 ? "noise" : "struck");
  const STYLE = `
    .mo-top { display: flex; gap: 8px; flex-wrap: wrap; }
    .mo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; flex: 1 1 330px; }
    .mo-cell { position: relative; border: 1px solid var(--line); border-radius: 5px; background: var(--panel);
      color: var(--muted); font-size: 10px; padding: 2px 3px 1px; cursor: pointer; text-align: left; line-height: 1.15;
      min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .mo-cell svg { display: block; width: 100%; height: 16px; margin-bottom: 1px; }
    .mo-cell path { fill: none; stroke: currentColor; stroke-width: 1.2; }
    .mo-cell::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 5px 0 0 5px; }
    .mo-cell.pitched::before { background: #38bdf8; }
    .mo-cell.noise::before { background: #a3a3a3; }
    .mo-cell.struck::before { background: #f59e0b; }
    .mo-cell.on { color: var(--text); border-color: var(--accent); background: var(--panel-3, var(--panel)); }
    .mo-cell.fading { border-style: dashed; }
    .mo-side { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .mo-head { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
    .mo-name { color: var(--text); font-weight: 600; }
    .mo-note { color: #f59e0b; }
    .mo-side canvas { width: 100%; display: block; }
  `;

  // A tiny deterministic random for the glyphs.
  function rnd(i) { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  /// Each model's glyph: y(x) for x in 0..1, about −1..1.
  const GLYPH = [
    (x) => 0.5 * ((2 * x * 2) % 2 - 1) + 0.5 * ((2 * x * 2.1 + 0.3) % 2 - 1),
    (x) => Math.sin(3 * Math.sin(2 * Math.PI * 2 * x)),
    (x) => Math.sin(2 * Math.PI * 2 * x + 2 * Math.sin(2 * Math.PI * 6 * x)),
    (x) => { const p = (2 * x) % 1, k = 0.15, d = p < k ? 0.5 * p / k : 0.5 + 0.5 * (p - k) / (1 - k); return -Math.cos(2 * Math.PI * d); },
    (x) => { const p = (2 * x) % 1; return Math.sin(Math.PI * p) ** 2 * Math.sin(2 * Math.PI * 5 * p); },
    (x) => (Math.sin(2 * Math.PI * 2 * x) + 0.5 * Math.sin(2 * Math.PI * 6 * x) + 0.3 * Math.sin(2 * Math.PI * 10 * x)) / 1.4,
    (x) => Math.round(4 * Math.sin(2 * Math.PI * 2 * x)) / 4,
    (x) => (Math.sin(2 * Math.PI * 2 * x) + Math.sin(2 * Math.PI * 2.52 * x) + Math.sin(2 * Math.PI * 3 * x)) / 2.2,
    (x) => { const p = (2 * x) % 1; return Math.exp(-6 * p) * Math.sin(2 * Math.PI * 4 * p) * 1.2 - 0.1; },
    (x) => 1.6 * (rnd(Math.floor(x * 60)) - 0.5),
    (x) => { const i = Math.floor(x * 40); return rnd(i + 7) > 0.85 ? (rnd(i) > 0.5 ? 0.9 : -0.6) : 0; },
    (x) => Math.exp(-3 * x) * ((4 * x * 4) % 2 - 1),
    (x) => Math.exp(-2.5 * x) * (Math.sin(2 * Math.PI * 4 * x) + 0.6 * Math.sin(2 * Math.PI * 11 * x)) / 1.4,
    (x) => Math.exp(-3 * x) * Math.sin(2 * Math.PI * (2 * x + 3 * (1 - Math.exp(-6 * x)))),
    (x) => Math.exp(-4 * x) * (0.6 * Math.sin(2 * Math.PI * 4 * x) + 0.8 * (rnd(Math.floor(x * 80)) - 0.5)),
    (x) => Math.exp(-2 * x) * ((Math.sin(2 * Math.PI * 7 * x) > 0 ? 0.5 : -0.5) + (Math.sin(2 * Math.PI * 11.3 * x) > 0 ? 0.4 : -0.4)),
  ];
  function glyphPath(m) {
    let d = "";
    for (let i = 0; i <= 48; i++) {
      const x = i / 48, y = Math.max(-1, Math.min(1, GLYPH[m](x)));
      d += (i ? "L" : "M") + (2 + x * 56).toFixed(1) + " " + (8 - y * 6.5).toFixed(1);
    }
    return d;
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
    return { accent: v("--accent", "#38bdf8"), line: v("--line", "#333"), muted: v("--muted", "#888") };
  }

  const steps = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return p && p.steps ? p.steps : 16;
  };
  /// The selected model (modulated if a cable moves it).
  const modelOf = (view, st) => Math.round(view.value(st, "model") * (steps(view, "model") - 1));

  /// Radix-2 FFT magnitude (dB) of a power-of-two array, Hann window.
  function spectrumDb(x) {
    const n = x.length, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    const out = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / (n / 4) + 1e-9);
    return out;
  }

  function drawScope(view) {
    const c = view.root.querySelector(".mo-scope");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const col = BleepView.theme(view.root), a = view.mo.arrays;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col.line;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    const line = (arr, colour, dash, blur) => {
      if (!arr || !arr.length) return;
      g.strokeStyle = colour;
      g.setLineDash(dash);
      g.lineWidth = dash.length ? 1 : 1.8;
      if (blur) BleepView.glow(g, colour, blur);
      g.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = (i / (arr.length - 1)) * w, y = h / 2 - Math.max(-1.2, Math.min(1.2, arr[i])) * (h / 2 - 3) / 1.2;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;
      g.setLineDash([]);
    };
    if (!a.scope || !a.scope.length) {  // no live capture: the playing model's glyph, faint
      const m = view.mo.playing | 0, arr = [];
      for (let i = 0; i <= 160; i++) arr.push(Math.max(-1, Math.min(1, GLYPH[m](i / 160))));
      g.globalAlpha = 0.5; line(arr, col.accent, [], 10); g.globalAlpha = 1;
      return;
    }
    line(a.scopeAux, col.muted, [3, 3], 0);
    line(a.scope, col.accent, [], 10);
  }

  function drawSpectrum(view) {
    const c = view.root.querySelector(".mo-spec");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const col = BleepView.theme(view.root), raw = view.mo.arrays.raw, sr = view.mo.sr || 48000;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col.line;
    for (const f of [100, 1000, 10000]) {
      const x = (Math.log(f / 20) / Math.log(1000)) * w;
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
    }
    if (!raw || raw.length < 64) return;
    const db = spectrumDb(raw), n = raw.length;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, col.accent); gr.addColorStop(1, col.accent + "11");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, h);
    for (let px = 0; px <= w; px++) {
      const f = 20 * Math.pow(1000, px / w), k = Math.min(n / 2 - 1, Math.max(1, Math.round((f * n) / sr)));
      const v = Math.max(0, Math.min(1, (db[k] + 80) / 80));
      g.lineTo(px, h - v * h);
    }
    g.lineTo(w, h);
    g.fill();
  }

  function update(view, st) {
    const m = modelOf(view, st), live = view.mo.live;
    const playing = typeof live.model === "number" ? Math.round(live.model) : m;
    view.mo.playing = playing;
    view.mo.cells.forEach((cell, i) => {
      cell.classList.toggle("on", i === playing);
      cell.classList.toggle("fading", i === m && i !== playing);
    });
    view.root.querySelector(".mo-name").textContent = `${playing + 1}  ${MODELS[playing]}`;
    const trig = view.api.isPatched ? view.api.isPatched("trig") : true;
    const note = view.root.querySelector(".mo-note");
    note.textContent = !trig && playing >= 13 ? "patch Trigger" : live.hz > 0 ? `${live.hz < 1000 ? live.hz.toFixed(1) + " Hz" : (live.hz / 1000).toFixed(2) + " kHz"}` : "";
    for (const id of ["decay", "gateColour"]) {
      const k = view.knobs.get(id);
      if (k && k.box) k.box.style.opacity = trig ? "" : "0.45";
    }
    drawScope(view);
    drawSpectrum(view);
  }

  BleepViews.register("macro-osc", {
    width: 1010,
    layout: [
      { title: "Model", params: ["model", "tone", "shape", "blend"] },
      { title: "Pitch", params: ["octave", "coarse", "fine", "fmDepth", "quality", "seed"] },
      { title: "Gate & level", params: ["decay", "gateColour", "level"] },
    ],
    template: `
      <div class="bv-panel mo-top">
        <div class="mo-grid" title="Click a model (the Model knob and cables move it too)"></div>
        <div class="mo-side">
          <div class="mo-head"><span class="mo-name"></span><span class="mo-note"></span></div>
          <canvas class="mo-scope" style="height:90px" title="Out (solid) and Aux (dashed)"></canvas>
          <canvas class="mo-spec" style="height:56px" title="Spectrum of Out, 20 Hz – 20 kHz"></canvas>
        </div>
      </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("mo-style")) {
        const s = document.createElement("style");
        s.id = "mo-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.mo = { arrays: {}, live: {}, sr: 48000, cells: [] };
      const grid = el.querySelector(".mo-grid");
      MODELS.forEach((name, i) => {
        const cell = document.createElement("button");
        cell.className = "mo-cell " + GROUP(i);
        cell.title = `${i + 1} ${name}`;
        cell.innerHTML = `<svg viewBox="0 0 60 16" preserveAspectRatio="none"><path d="${glyphPath(i)}"/></svg>${i + 1} ${name}`;
        cell.addEventListener("click", (e) => {
          e.stopPropagation();
          const v = i / (steps(view, "model") - 1);
          view.api.beginGesture();
          view.api.setParam("model", v);
          view.node.params.model = v;
          update(view, null);
        });
        grid.appendChild(cell);
        view.mo.cells.push(cell);
      });
      requestAnimationFrame(() => update(view, null));
    },
    onState(st, view) {
      if (!view.mo) return;
      if (st) {
        for (const k of ["model", "hz", "env", "span", "sr"]) if (typeof st[k] === "number") view.mo.live[k] = st[k];
        if (st.sr) view.mo.sr = st.sr;
        if (st.arrays) view.mo.arrays = st.arrays;
      }
      update(view, st);
    },
    onRefresh(view) { if (view.mo) update(view, null); },
  });
})();
