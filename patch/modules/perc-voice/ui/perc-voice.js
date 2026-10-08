// SPDX-License-Identifier: MIT
// Perc Voice view: the eight partials of the current (modulated) settings
// (position = ratio on a log axis, height = amplitude, shade = decay) and a
// sketch of the hit's amplitude envelope (Decay, Click) with its pitch sweep.
// The Hit button comes from the module's buttons.
(function () {
  "use strict";

  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  /// Decay knob (normalised) → seconds: 10 ms … 8 s, skewed so 0.6 s is the centre.
  function decaySeconds(x) {
    const min = 0.01, max = 8, centre = 0.6;
    const skew = Math.log(0.5) / Math.log((centre - min) / (max - min));
    return x <= 0 ? min : min + (max - min) * Math.exp(Math.log(x) / skew);
  }

  BleepViews.register("perc-voice", {
    settingsTop: true,  // the engine first: it decides what Morph does
    template:
      '<div class="bv-panel"><h2>Partials</h2><canvas class="pv-partials" style="height:64px"></canvas>' +
      '<canvas class="pv-env" style="height:40px;margin-top:6px"></canvas></div>',
    onState(st, view) {
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line");
      const arrays = (st && st.arrays) || {};
      const parts = view.root.querySelector(".pv-partials");
      if (parts && parts.clientWidth && arrays.ratios) {
        const { g, w, h } = canvas(parts);
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, h - 2); g.lineTo(w, h - 2); g.stroke();
        const maxAmp = Math.max(...arrays.amps, 1e-6);
        const x = (r) => 6 + (Math.log(r) / Math.log(40)) * (w - 12);  // ratios 1 … 40
        g.lineWidth = 3;
        g.strokeStyle = accent;
        for (let k = arrays.ratios.length - 1; k >= 0; k--) {
          const a = arrays.amps[k] / maxAmp;
          if (a < 0.003) continue;
          g.globalAlpha = 0.25 + 0.75 * Math.min(1, Math.max(0, arrays.decays[k]));
          const xx = x(arrays.ratios[k]);
          g.beginPath(); g.moveTo(xx, h - 2); g.lineTo(xx, h - 2 - a * (h - 6)); g.stroke();
        }
        g.globalAlpha = 1; g.lineWidth = 1;
      }
      const env = view.root.querySelector(".pv-env");
      if (env && env.clientWidth) {
        const { g, w, h } = canvas(env);
        const decay = decaySeconds(view.value(st, "decay"));
        const click = view.value(st, "click"), sweep = view.value(st, "sweep");
        const span = Math.min(decay * 1.3, 8);
        g.fillStyle = accent; g.globalAlpha = 0.35;
        g.beginPath(); g.moveTo(0, h);
        for (let px = 0; px <= w; px++) {
          const t = (px / w) * span;
          let a = Math.pow(10, -3 * t / decay);
          if (t < 0.004) a = Math.min(1, a + click * (1 - t / 0.004));
          g.lineTo(px, h - Math.min(a, 1) * (h - 2));
        }
        g.lineTo(w, h); g.closePath(); g.fill(); g.globalAlpha = 1;
        // Pitch sweep: +3 octaves × Sweep, falling to 5 % in Decay / 8.
        if (sweep > 0) {
          g.strokeStyle = css.getPropertyValue("--text"); g.setLineDash([3, 3]);
          g.beginPath();
          for (let px = 0; px <= w; px++) {
            const t = (px / w) * span;
            const oct = 3 * sweep * Math.exp(-3 * t / (decay / 8));
            const yy = h - 2 - (oct / 3) * (h - 4);
            px ? g.lineTo(px, yy) : g.moveTo(px, yy);
          }
          g.stroke(); g.setLineDash([]);
        }
      }
    },
  });
})();
