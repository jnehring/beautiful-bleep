// SPDX-License-Identifier: GPL-3.0-only
// Endless Tone view: the loudness window over log-frequency (a Gaussian times a
// raised cosine, as the module computes it) with one vertical line per partial
// at its live position, so the lines slide through the window while the sound
// glides, and the loop ramp as a small ring.
(function () {
  "use strict";

  const sigmaOf = (width, count) => 0.6 + width * 0.35 * count;
  function win(pos, count, width) {
    if (pos <= 0 || pos >= count) return 0;
    const s = sigmaOf(width, count), r = pos - count / 2, h = Math.sin(Math.PI * pos / count);
    return Math.exp(-0.5 * r * r / (s * s)) * h * h;
  }

  BleepViews.register("endless-tone", {
    width: 650,
    layout: [
      { title: "Glide", params: ["rate", "direction", "phase"] },
      { title: "Tone", params: ["coarse", "fine", "count", "width", "timbre", "spread", "level"] },
    ],
    template: '<div class="bv-panel"><h2>Window · partials</h2><canvas class="et-win" style="width:100%;height:110px"></canvas></div>',
    onState(st, view) {
      const c = view.root.querySelector(".et-win");
      if (!c || !c.clientWidth) return;
      const th = BleepView.theme(view.root);
      const { g, w, h } = BleepView.fit(c);
      const count = Math.round(6 + 6 * view.value(st, "count")), width = view.value(st, "width");
      const loop = st ? +st.loop || 0 : 0;
      g.strokeStyle = th.line; g.globalAlpha = 0.5;
      g.beginPath(); g.moveTo(0, h - 8); g.lineTo(w, h - 8); g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 8);
      g.beginPath();
      for (let i = 0; i <= 200; i++) {
        const pos = i / 200 * count, x = i / 200 * w, y = h - 8 - win(pos, count, width) * (h - 20);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0; g.lineWidth = 1.5;
      for (let k = 0; k < count; k++) {
        const pos = k + loop, a = win(pos, count, width), x = pos / count * w;
        g.strokeStyle = th.text; g.globalAlpha = 0.25 + 0.75 * a;
        g.beginPath(); g.moveTo(x, h - 8); g.lineTo(x, h - 8 - Math.max(3, a * (h - 20))); g.stroke();
        g.fillStyle = th.text; g.beginPath(); g.arc(x, h - 8 - Math.max(3, a * (h - 20)), 3, 0, 6.2832); g.fill();
      }
      g.globalAlpha = 1; g.lineWidth = 1;
    },
  });
})();
