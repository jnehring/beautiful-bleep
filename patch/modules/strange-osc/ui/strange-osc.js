// SPDX-License-Identifier: GPL-3.0-or-later
// Strange Osc view: the orbit as a phase portrait (X against Y, a fading trail
// of the last second or so, the head as a dot) next to X and Y over time.
(function () {
  "use strict";

  BleepViews.register("strange-osc", {
    width: 820,
    layout: [
      { title: "Pitch", params: ["attractor", "range", "coarse", "fine"] },
      { title: "Chaos", params: ["tame", "force", "seed"] },
      { title: "Output", params: ["mix", "tone", "level"] },
    ],
    template: '<div class="bv-panel" style="display:flex;gap:12px"><div style="flex:none;width:170px"><h2>Orbit</h2>' +
      '<canvas class="so-orbit" style="width:100%;height:110px"></canvas></div>' +
      '<div style="flex:1;min-width:0"><h2>X · Y over time</h2><canvas class="so-time" style="width:100%;height:110px"></canvas></div></div>',
    onState(st, view) {
      const a = (st && st.arrays) || {};
      const th = BleepView.theme(view.root);
      const xs = a.trailx || [], ys = a.traily || [];
      const orbit = view.root.querySelector(".so-orbit");
      if (orbit && orbit.clientWidth) {
        const { g, w, h } = BleepView.fit(orbit);
        g.strokeStyle = th.line; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
        g.globalAlpha = 1; g.lineWidth = 1.5;
        const n = xs.length;
        for (let i = 1; i < n; i++) {
          g.strokeStyle = th.accent; g.globalAlpha = 0.08 + 0.92 * (i / n);
          g.beginPath();
          g.moveTo(w / 2 + xs[i - 1] * (w / 2 - 6), h / 2 - ys[i - 1] * (h / 2 - 6));
          g.lineTo(w / 2 + xs[i] * (w / 2 - 6), h / 2 - ys[i] * (h / 2 - 6));
          g.stroke();
        }
        g.globalAlpha = 1;
        if (n) {
          g.fillStyle = th.text;
          g.beginPath(); g.arc(w / 2 + xs[n - 1] * (w / 2 - 6), h / 2 - ys[n - 1] * (h / 2 - 6), 3, 0, 6.2832); g.fill();
        }
        g.lineWidth = 1;
      }
      const time = view.root.querySelector(".so-time");
      if (time && time.clientWidth) {
        const { g, w, h } = BleepView.fit(time);
        const tr = (d, color, alpha) => {
          g.strokeStyle = color; g.globalAlpha = alpha; g.beginPath();
          d.forEach((v, i) => { const x = i / Math.max(1, d.length - 1) * w, y = h / 2 - Math.max(-1.2, Math.min(1.2, v)) * (h / 2 - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.stroke();
        };
        g.strokeStyle = th.line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
        tr(ys, th.text, 0.35);
        g.lineWidth = 2; BleepView.glow(g, th.accent, 8); tr(xs, th.accent, 1);
        g.shadowBlur = 0; g.lineWidth = 1; g.globalAlpha = 1;
      }
    },
  });
})();
