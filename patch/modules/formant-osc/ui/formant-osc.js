// SPDX-License-Identifier: GPL-3.0-or-later
// Formant Osc view (doc/specs/modules/formant-oscillator.md §5): one fundamental
// cycle (window outline, burst, square) and the first 64 harmonics with a
// marker at each formant. Both are computed here from the modulated knob
// values and the module's live f0 / formant frequencies, mirroring
// dsp::FormantOsc (window sin²(πu/L)^q, L = 1 − 0.95·Narrow, q = 1 + 3·Narrow).
(function () {
  "use strict";
  const N = 512, HARMONICS = 64, C4 = 261.6255653005986;
  const STYLE = `
    .fosc-row { display: flex; gap: 8px; }
    .fosc-row > div { flex: 1; min-width: 0; }
  `;

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
    return { accent: v("--accent", "#e879f9"), line: v("--line", "#333"), muted: v("--muted", "#888"), text: v("--text", "#ddd") };
  }
  const choice = (view, st, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(view.value(st, id) * ((p && p.steps ? p.steps : 2) - 1));
  };
  /// formant::formantScale: sign(F)·2^|F|, linear through zero within ±0.1 octave.
  const scale = (F) => (Math.abs(F) >= 0.1 ? Math.sign(F) * Math.pow(2, Math.abs(F)) : (F / 0.1) * Math.pow(2, 0.1));

  /// One cycle (Reset 100 %): window, burst and square at N points.
  function cycle(view, st) {
    const narrow = view.value(st, "narrow"), roll = view.value(st, "roll");
    const cosine = choice(view, st, "start") === 1;
    let f0 = st && st.f0 > 0 ? st.f0 : 0, ff = st && typeof st.ff === "number" ? st.ff : 0;
    if (!f0) {  // no live values yet: the knobs alone
      const oct = Math.round(view.value(st, "octave") * 8) - 4;
      f0 = C4 * Math.pow(2, oct + (24 * view.value(st, "coarse") - 12) / 12 + (200 * view.value(st, "fine") - 100) / 1200);
      const F = 12 * view.value(st, "formant") - 6;
      ff = (choice(view, st, "tracking") === 1 ? C4 : f0) * scale(F);
    }
    const ratio = ff / f0, len = 1 - 0.95 * narrow, q = 1 + 3 * narrow;
    const win = new Float32Array(N), burst = new Float32Array(N), sq = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const phi = i / N, u = phi - roll - Math.floor(phi - roll);
      const w = u < len ? Math.pow(Math.sin((Math.PI * u) / len) ** 2, q) : 0;
      win[i] = w;
      burst[i] = w * Math.sin(2 * Math.PI * ratio * u + (cosine ? Math.PI / 2 : 0));
      sq[i] = phi < 0.5 ? 1 : -1;
    }
    return { win, burst, sq, f0, ff, ff2: st && typeof st.ff2 === "number" ? st.ff2 : ff };
  }

  function drawCycle(view, st, cy) {
    const c = view.root.querySelector(".fosc-cycle");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const col = BleepView.theme(view.root);
    const body = view.value(st, "body");
    const X = (i) => (i / (N - 1)) * w, Y = (v) => h / 2 - v * (h / 2 - 4);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col.line;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    const line = (a, colour, width, alpha, blur) => {
      g.globalAlpha = alpha;
      g.strokeStyle = colour;
      g.lineWidth = width;
      if (blur) BleepView.glow(g, colour, blur);
      g.beginPath();
      for (let i = 0; i < N; i++) i ? g.lineTo(X(i), Y(a[i])) : g.moveTo(X(i), Y(a[i]));
      g.stroke();
      g.shadowBlur = 0;
    };
    // the window (and its mirror) the burst lives in: a soft filled envelope
    g.globalAlpha = 0.14; g.fillStyle = col.accent; g.beginPath(); g.moveTo(0, h / 2);
    for (let i = 0; i < N; i++) g.lineTo(X(i), Y(cy.win[i]));
    for (let i = N - 1; i >= 0; i--) g.lineTo(X(i), Y(-cy.win[i]));
    g.fill();
    line(cy.sq, col.muted, 1, 0.25 + 0.5 * (1 - body));
    line(cy.win, col.muted, 1, 0.8);
    line(cy.burst, col.accent, 2, 0.4 + 0.6 * body, 10);
    g.globalAlpha = 1;
    g.lineWidth = 1;
  }

  function drawSpectrum(view, st, cy) {
    const c = view.root.querySelector(".fosc-spec");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const col = BleepView.theme(view.root);
    const mags = new Float32Array(HARMONICS + 1);
    let peak = 1e-9;
    for (let k = 1; k <= HARMONICS; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) {
        const a = (2 * Math.PI * k * i) / N;
        re += cy.burst[i] * Math.cos(a);
        im -= cy.burst[i] * Math.sin(a);
      }
      mags[k] = Math.hypot(re, im);
      peak = Math.max(peak, mags[k]);
    }
    const bw = w / HARMONICS;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    BleepView.glow(g, col.accent, 7);
    for (let k = 1; k <= HARMONICS; k++) {
      const db = 20 * Math.log10(mags[k] / peak + 1e-9);
      const bh = Math.max(0, (db + 60) / 60) * (h - 10);
      const gr = g.createLinearGradient(0, h, 0, h - bh);
      gr.addColorStop(0, col.accent + "44"); gr.addColorStop(1, col.accent);
      g.fillStyle = gr;
      g.fillRect((k - 1) * bw + 1, h - bh, Math.max(1, bw - 2), bh);
    }
    g.shadowBlur = 0;
    const marker = (hz, colour) => {
      const k = Math.abs(hz) / cy.f0;
      if (!(k > 0) || k > HARMONICS + 0.5) return;
      const x = (k - 0.5) * bw;
      g.fillStyle = colour;
      g.beginPath(); g.moveTo(x - 4, 0); g.lineTo(x + 4, 0); g.lineTo(x, 7); g.fill();
    };
    marker(cy.ff, col.text);
    if (Math.abs(cy.ff2 - cy.ff) > 1e-3) marker(cy.ff2, col.muted);
  }

  function draw(view, st) {
    const cy = cycle(view, st);
    drawCycle(view, st, cy);
    drawSpectrum(view, st, cy);
  }

  BleepViews.register("formant-osc", {
    parts: [{ id: "cycle", name: "One cycle", select: ".fosc-row > div:nth-child(1)" }, { id: "harmonics", name: "Harmonics", select: ".fosc-row > div:nth-child(2)" }],
    width: 900,
    layout: [
      { title: "Pitch", params: ["octave", "coarse", "fine", "tracking", "quality"] },
      { title: "Formant", params: ["formant", "narrow", "body", "start"] },
      { title: "Motion", params: ["reset", "roll", "spread", "fmDepth"] },
    ],
    template: `
      <div class="bv-panel fosc-row">
        <div><h2>One cycle · window, burst, square</h2><canvas class="fosc-cycle" style="height:100px"></canvas></div>
        <div><h2>Harmonics · ▼ formants</h2><canvas class="fosc-spec" style="height:100px"></canvas></div>
      </div>`,
    afterBuild(view) {
      if (!document.getElementById("fosc-style")) {
        const s = document.createElement("style");
        s.id = "fosc-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      requestAnimationFrame(() => draw(view, null));
      view.fosc = {};
    },
    onState(st, view) { draw(view, st); },
    onRefresh(view) { draw(view, null); },
  });
})();
