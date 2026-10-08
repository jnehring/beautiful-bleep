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

  BleepViews.register("low-pass-gate", {
    template:
      '<div class="bv-panel"><h2>Response</h2>' +
      '<div style="display:flex;gap:8px">' +
      '<canvas class="lpg-history" style="height:72px;flex:3;min-width:0"></canvas>' +
      '<canvas class="lpg-filter" style="height:72px;flex:1;min-width:0"></canvas></div></div>',
    onState(st, view) {
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line");
      const hist = view.root.querySelector(".lpg-history");
      if (hist && hist.clientWidth) {
        const { g, w, h } = canvas(hist);
        const arrays = (st && st.arrays) || {};
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, h - 3); g.lineTo(w, h - 3); g.stroke();
        if (arrays.light) {
          curve(g, arrays.light, w, h, 1.2);
          g.lineTo(w, h - 3); g.lineTo(0, h - 3); g.closePath();
          g.globalAlpha = 0.18; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
        }
        if (arrays.c) {
          g.strokeStyle = accent; g.lineWidth = 2;
          curve(g, arrays.c, w, h, 1.2);
          g.stroke(); g.lineWidth = 1;
        }
      }
      const filt = view.root.querySelector(".lpg-filter");
      if (filt && filt.clientWidth) {
        const { g, w, h } = canvas(filt);
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
        g.strokeStyle = accent; g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x <= w; x++) {
          const f = 20 * Math.pow(1000, x / w);
          let mag = gain;
          if (mode !== 1) {
            const s = f / fc;  // |1 / (s² + s/q + 1)| at s = jω/ωc
            mag *= 1 / Math.hypot(1 - s * s, s / q);
          }
          const yy = y(20 * Math.log10(Math.max(mag, 1e-6)));
          x ? g.lineTo(x, yy) : g.moveTo(x, yy);
        }
        g.stroke();
      }
    },
  });
})();
