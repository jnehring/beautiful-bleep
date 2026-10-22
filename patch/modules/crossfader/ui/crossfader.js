// SPDX-License-Identifier: GPL-3.0-or-later
// Crossfader view: the gain curves of A and B against the Fade position
// (equal power: cos / sin, constant power; or linear), with a glowing marker at
// the current (modulated) fade and the two gains. Mirrors CrossfaderDsp.h.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".xf-cv{height:140px!important}";
  document.head.appendChild(style);
  function gains(f, linear) {
    return linear ? [1 - f, f] : [Math.cos(f * Math.PI / 2), Math.sin(f * Math.PI / 2)];
  }
  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const f = view.value(st, "fade"), linear = view.units("curve") === 1;
    const px = 24, pr = 10, pt = 10, pb = 18, pw = w - px - pr, ph = h - pt - pb;
    const X = (v) => px + v * pw, Y = (v) => pt + (1 - v) * ph;
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath();
    for (const v of [0, 0.5, 1]) { g.moveTo(px, Math.round(Y(v)) + 0.5); g.lineTo(px + pw, Math.round(Y(v)) + 0.5); }
    for (const v of [0, 0.5, 1]) { g.moveTo(Math.round(X(v)) + 0.5, pt); g.lineTo(Math.round(X(v)) + 0.5, pt + ph); }
    g.stroke();
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "right";
    g.fillText("1", px - 4, Y(1) + 3); g.fillText("0", px - 4, Y(0) + 3);
    g.textAlign = "center"; g.fillText("A", X(0), h - 4); g.fillText("fade", X(0.5), h - 4); g.fillText("B", X(1), h - 4);
    const line = (idx, colour, width) => {
      g.strokeStyle = colour; g.lineWidth = width; g.beginPath();
      for (let i = 0; i <= 60; i++) { const v = i / 60, y = Y(gains(v, linear)[idx]); i ? g.lineTo(X(v), y) : g.moveTo(X(v), y); }
      g.stroke();
    };
    // constant-power sum (what the ear hears): faint
    g.strokeStyle = th.line; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath();
    for (let i = 0; i <= 60; i++) { const v = i / 60, [a, b] = gains(v, linear), y = Y(Math.min(1.2, Math.sqrt(a * a + b * b)) / 1.2 * 1); i ? g.lineTo(X(v), y) : g.moveTo(X(v), y); }
    g.stroke(); g.setLineDash([]);
    BleepView.glow(g, th.accent, 10);
    line(0, th.accent, 2.5); line(1, th.mod, 2.5); g.shadowBlur = 0;
    const [a, b] = gains(f, linear);
    g.strokeStyle = th.text; g.globalAlpha = 0.4; g.beginPath(); g.moveTo(X(f) + 0.5, pt); g.lineTo(X(f) + 0.5, pt + ph); g.stroke(); g.globalAlpha = 1;
    for (const [v, c] of [[a, th.accent], [b, th.mod]]) {
      BleepView.glow(g, c, 14); g.fillStyle = th.text; g.beginPath(); g.arc(X(f), Y(v), 4, 0, 7); g.fill(); g.shadowBlur = 0;
    }
    g.font = "11px system-ui, sans-serif"; g.textAlign = "left"; g.fillStyle = th.accent; g.fillText(`A ${Math.round(a * 100)}%`, px + 6, pt + 12);
    g.textAlign = "right"; g.fillStyle = th.mod; g.fillText(`B ${Math.round(b * 100)}%`, px + pw - 6, pt + 12);
  }
  BleepViews.register("crossfader", {
    width: 420,
    template: '<div class="bv-panel"><h2>Gain curves</h2><canvas class="xf-cv"></canvas></div>',
    side: true,
    layout: [{ title: "Blend", params: ["fade", "curve"] }],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
