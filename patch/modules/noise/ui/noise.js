// SPDX-License-Identifier: GPL-3.0-or-later
// Noise view: the spectrum the Colour knob makes. Brown, pink, white, blue and
// violet are tilts of -6, -3, 0, +3 and +6 dB/octave, all at the same loudness
// (RMS), mixed linearly in amplitude between neighbours (NoiseDsp::colour).
// A shimmering band of "bins" shows the noise itself.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".nz-cv{height:140px!important}";
  document.head.appendChild(style);
  const F0 = 20, F1 = 20000, N = 96;
  const TILT = [-6.02, -3.01, 0, 3.01, 6.02];  // dB/octave
  const NAMES = ["brown", "pink", "white", "blue", "violet"];
  // Amplitude spectra on a log grid, each normalised to equal power.
  const bins = [];
  for (let i = 0; i < N; i++) bins.push(F0 * Math.pow(F1 / F0, i / (N - 1)));
  const amps = TILT.map((tilt) => {
    const a = bins.map((f) => Math.pow(2, (tilt / 6.02) * Math.log2(f / 1000)));
    // equal power over the log grid weighted by bandwidth (∝ f)
    let p = 0; for (let i = 0; i < N; i++) p += a[i] * a[i] * bins[i];
    const k = 1 / Math.sqrt(p);
    return a.map((v) => v * k);
  });
  const seed = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function spectrum(c) {
    const x = (Math.min(Math.max(c, -1), 1) + 1) * 2, i = Math.min(Math.floor(x), 3), t = x - i;
    return bins.map((_, k) => amps[i][k] + t * (amps[i + 1][k] - amps[i][k]));
  }

  function draw(view, cv, time) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const p = view.type.params.find((q) => q.id === "colour");
    const colour = p.min + (p.max - p.min) * view.value(st, "colour");
    const level = view.value(st, "level");
    const sp = spectrum(colour);
    const padB = 14, plotH = h - padB;
    const ref = amps[2][N >> 1], DBTOP = 14, DBBOT = -34;
    const yOf = (a, lv) => {
      const db = 20 * Math.log10(Math.max(a * lv, 1e-6) / ref);
      return Math.min(plotH, Math.max(0, (DBTOP - db) / (DBTOP - DBBOT) * plotH));
    };
    // grid: decades and 12 dB lines
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath();
    for (const f of [100, 1000, 10000]) { const x = Math.round(Math.log(f / F0) / Math.log(F1 / F0) * w) + 0.5; g.moveTo(x, 0); g.lineTo(x, plotH); }
    for (let d = DBBOT + 12; d < DBTOP; d += 12) { const y = Math.round((DBTOP - d) / (DBTOP - DBBOT) * plotH) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    for (const [f, l] of [[100, "100"], [1000, "1k"], [10000, "10k"]]) g.fillText(l, Math.log(f / F0) / Math.log(F1 / F0) * w, h - 2);
    // ghost lines of the five colours
    g.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const near = Math.abs((colour + 1) * 2 - k) < 0.5;
      g.strokeStyle = th.line; g.globalAlpha = 0.9;
      g.beginPath();
      for (let i = 0; i < N; i++) { const x = i / (N - 1) * w, y = yOf(amps[k][i], 1); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = near ? th.text : th.muted; g.textAlign = k ? (k === 4 ? "right" : "center") : "left";
      g.fillText(NAMES[k], [3, w * 0.3, w * 0.5, w * 0.72, w - 3][k], 10);
    }
    // the shimmering bins
    const gr = g.createLinearGradient(0, 0, 0, plotH);
    gr.addColorStop(0, th.accent); gr.addColorStop(1, "transparent");
    const bw = w / N;
    g.fillStyle = gr;
    BleepView.glow(g, th.accent, 6);
    for (let i = 0; i < N; i++) {
      const jitter = 0.78 + 0.44 * seed(i + Math.floor(time * 24) * 7.3);
      const y = yOf(sp[i] * jitter, level);
      g.globalAlpha = 0.5;
      g.fillRect(i * bw + 0.5, y, Math.max(1, bw - 1.5), plotH - y);
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
    // the mean line
    g.strokeStyle = th.accent; g.lineWidth = 2;
    BleepView.glow(g, th.accent, 10);
    g.beginPath();
    for (let i = 0; i < N; i++) { const x = i / (N - 1) * w, y = yOf(sp[i], level); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    // slope label
    const slope = colour < -0.5 ? -6 + (colour + 1) * 6 : colour < 0 ? -3 + (colour + 0.5) * 6 : colour < 0.5 ? colour * 6 : 3 + (colour - 0.5) * 6;
    g.fillStyle = th.text; g.textAlign = "right";
    g.font = "11px system-ui, sans-serif";
    g.fillText(`${slope > 0 ? "+" : ""}${slope.toFixed(1)} dB/oct`, w - 6, plotH - 6);
  }

  BleepViews.register("noise", {
    width: 520,
    template: '<div class="bv-panel"><h2>Spectrum</h2><canvas class="nz-cv"></canvas></div>',
    layout: [{ title: "Colour", params: ["colour"] }, { title: "Output", params: ["level"] }],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
