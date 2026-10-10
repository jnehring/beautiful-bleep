// SPDX-License-Identifier: MIT
// Low Pass Gate view: the cell's openness over the last 2 s (the light that
// drove it dimmer behind), and a small low-pass curve whose corner follows
// the current cutoff. The Ping button comes from the module's buttons.
(function () {
  "use strict";
  const choice = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round((view.node.params[id] ?? p.default) * (p.steps - 1));
  };

  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  function curve(g, values, w, h, max) {
    g.beginPath();
    const n = values.length;
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(n - 1, 1)) * w;
      const y = h - 3 - (Math.min(values[i], max) / max) * (h - 6);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  }

  // The cell's own response to a ping (2 ms flash), simulated with the Vactrol.h model at 10 kHz.
  const CELLS = [[0.001, 0.012, 3, 0.15, 0.5, 1], [0.003, 0.028, 4, 0.3, 1, 1.5], [0.006, 0.06, 5, 0.6, 3, 3]];
  let simKey = "", simData = null;
  function simulate(cell, resp, ping) {
    const key = cell + "/" + resp.toFixed(3) + "/" + ping.toFixed(2);
    if (key === simKey) return simData;
    const t = CELLS[cell] || CELLS[1], fs = 10000, sc = 0.25 * Math.pow(2, 4 * resp);
    const coef = (sec) => 1 - Math.exp(-1 / (sec * sc * fs));
    const rA = coef(t[0]), mrA = coef(t[3]), mfA = coef(t[4]), tau0 = t[1] * sc * fs;
    const out = new Float32Array(2 * fs / 20);
    let c = 0, m = 0;
    for (let i = 0; i < 2 * fs; i++) {
      const L = i < 0.002 * fs ? 0.4 + 0.8 * ping : 0;
      m += (L - m) * (L > m ? mrA : mfA);
      if (L > c) c += (L - c) * rA;
      else { const dark = 1 - Math.min(c, 1), tau = tau0 * (1 + t[2] * dark * dark) * (1 + t[5] * m), x = 1 / tau; c += (L - c) * (2 * x / (2 + x)); }
      if (i % 20 === 0) out[i / 20] = c;
    }
    simKey = key; simData = out;
    return out;
  }

  BleepViews.register("low-pass-gate", {
    width: 880,
    layout: [
      { title: "Cell", params: ["mode", "cell"] },
      { title: "Open / close", params: ["level", "response", "ping"] },
      { title: "Tone", params: ["resonance", "brightness", "drive", "bleed"] },
    ],
    template:
      '<div class="bv-panel"><h2>Vactrol — openness over 2 s <span style="float:right;font-weight:normal;text-transform:none">dashed: a ping through this cell</span></h2>' +
      '<div style="display:flex;gap:10px">' +
      '<canvas class="lpg-history" style="height:110px;flex:3;min-width:0"></canvas>' +
      '<canvas class="lpg-filter" style="height:110px;flex:2;min-width:0"></canvas></div></div>',
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const accent = th.accent, line = th.line;
      const hist = view.root.querySelector(".lpg-history");
      if (hist && hist.clientWidth) {
        const { g, w, h } = BleepView.fit(hist);
        const arrays = (st && st.arrays) || {};
        g.strokeStyle = line; g.globalAlpha = 0.5;
        g.beginPath();
        for (let i = 1; i < 4; i++) { const x = Math.round(i * w / 4) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
        g.moveTo(0, h - 3); g.lineTo(w, h - 3); g.stroke(); g.globalAlpha = 1;
        const sim = simulate(choice(view, "mode") >= 0 ? choice(view, "cell") : 1, view.value(st, "response"), view.value(st, "ping"));
        g.strokeStyle = accent; g.globalAlpha = 0.55; g.setLineDash([4, 4]); g.lineWidth = 1.5;
        curve(g, sim, w, h, 1.2); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (arrays.light) {
          curve(g, arrays.light, w, h, 1.2);
          g.lineTo(w, h - 3); g.lineTo(0, h - 3); g.closePath();
          g.globalAlpha = 0.15; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
        }
        if (arrays.c) {
          g.strokeStyle = accent; g.lineWidth = 2.5;
          BleepView.glow(g, accent, 12);
          curve(g, arrays.c, w, h, 1.2);
          g.stroke(); g.shadowBlur = 0;
          const gr = g.createLinearGradient(0, 0, 0, h);
          gr.addColorStop(0, accent); gr.addColorStop(1, "transparent");
          g.lineTo(w, h - 3); g.lineTo(0, h - 3); g.closePath(); g.globalAlpha = 0.2; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
          g.lineWidth = 1;
        }
      }
      const filt = view.root.querySelector(".lpg-filter");
      if (filt && filt.clientWidth) {
        const { g, w, h } = BleepView.fit(filt);
        const mode = choice(view, "mode");  // 0 LP, 1 VCA, 2 Both
        const res = view.value(st, "resonance");
        const q = 0.5 + 5.5 * res * res;
        const c = Math.min(Math.max((st && st.c) || 0, 0), 1);
        const gain = mode === 0 ? 1 : Math.pow(c, mode === 1 ? 1.4 : 1.2) / (mode === 2 ? 1 + 0.3 * res : 1);
        const fc = (st && st.cutoff) || 30;
        const top = 12, bottom = -48;
        const y = (db) => (top - Math.min(top, Math.max(bottom, db))) / (top - bottom) * h;
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
        const pts = [];
        for (let x = 0; x <= w; x += 2) {
          const f = 20 * Math.pow(1000, x / w);
          let mag = gain;
          if (mode !== 1) {
            const s = f / fc;  // |1 / (s² + s/q + 1)| at s = jω/ωc
            mag *= 1 / Math.hypot(1 - s * s, s / q);
          }
          pts.push([x, y(20 * Math.log10(Math.max(mag, 1e-6)))]);
        }
        const path = () => { g.beginPath(); pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy))); };
        g.strokeStyle = accent; g.lineWidth = 2;
        BleepView.glow(g, accent, 10);
        path(); g.stroke(); g.shadowBlur = 0;
        path(); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.globalAlpha = 0.12; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
        g.lineWidth = 1;
      }
    },
  });
})();
