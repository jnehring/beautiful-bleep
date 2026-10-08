// SPDX-License-Identifier: MIT
// Function view: a slope preview of Rise/Fall and Shape, including live modulation.
(function () {
  "use strict";
  // Inverse of the Rise/Fall range (1 ms .. 10 s, centre 250 ms).
  const skew = Math.log(0.5) / Math.log((0.25 - 0.001) / (10 - 0.001));
  const seconds = (v) => 0.001 + (10 - 0.001) * Math.exp(Math.log(Math.max(v, 1e-6)) / skew);
  const curve = (u, s) => (s >= 0 ? Math.pow(u, 1 + 3 * s) : 1 - Math.pow(1 - u, 1 - 3 * s));

  BleepViews.register("function", {
    template: '<div class="bv-panel"><h2>Slope</h2><canvas class="slope" style="height:64px"></canvas></div>',
    onState(st, view) {
      const c = view.root.querySelector(".slope");
      if (!c || !c.clientWidth) return;
      const rise = seconds(view.value(st, "rise")), fall = seconds(view.value(st, "fall"));
      const shape = view.value(st, "shape") * 2 - 1;
      const r = rise / (rise + fall);
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = getComputedStyle(view.root).getPropertyValue("--accent");
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const p = x / w, u = p < r ? p / r : 1 - (p - r) / (1 - r);
        const y = h - 4 - curve(u, shape) * (h - 8);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    },
  });
})();
