// SPDX-License-Identifier: MIT
// Filter view: the magnitude response of the current (modulated) settings.
(function () {
  "use strict";
  // Analog prototype of the SVF: LP 1, BP s/Q, HP s², notch s²+1, over s² + s/Q + 1.
  function magnitude(freq, fc, q, morph) {
    const w = freq / fc;
    const den = [1 - w * w, w / q];
    const outs = [[1, 0], [0, w / q], [-w * w, 0], [1 - w * w, 0]];
    const m = Math.min(Math.max(morph, 0), 1) * 3;
    const i = Math.min(Math.floor(m), 2), t = m - i;
    const num = [outs[i][0] + t * (outs[i + 1][0] - outs[i][0]), outs[i][1] + t * (outs[i + 1][1] - outs[i][1])];
    return Math.hypot(num[0], num[1]) / Math.hypot(den[0], den[1]);
  }

  BleepViews.register("filter", {
    template: '<div class="bv-panel"><h2>Response</h2><canvas class="response" style="height:96px"></canvas></div>',
    onState(st, view) {
      const c = view.root.querySelector(".response");
      if (!c || !c.clientWidth) return;
      const fc = 20 * Math.pow(1000, view.value(st, "cutoff"));
      const q = 0.5 * Math.pow(50, view.value(st, "resonance"));
      const morph = view.value(st, "mode"), mix = view.value(st, "mix");
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const top = 24, bottom = -36;
      const y = (db) => (top - Math.min(top, Math.max(bottom, db))) / (top - bottom) * h;
      g.strokeStyle = getComputedStyle(view.root).getPropertyValue("--line");
      g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
      g.strokeStyle = getComputedStyle(view.root).getPropertyValue("--accent");
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const freq = 20 * Math.pow(1000, x / w);
        const lin = mix * magnitude(freq, fc, q, morph) + (1 - mix);
        const yy = y(20 * Math.log10(Math.max(lin, 1e-6)));
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    },
  });
})();
