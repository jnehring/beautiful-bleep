// SPDX-License-Identifier: GPL-3.0-or-later
// Envelope Follower view (doc/specs/modules/envelope-follower.md §5): the last
// seconds of the Env output as a glowing area, the open gate shaded behind it
// and the threshold as a dashed line. A signed follower (Peak + None) gets a
// scale of -1 to +1, everything else 0 to 1 (the trace is clipped above 1).
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".ef-cv{height:140px!important}";
  document.head.appendChild(style);
  const N = 240;  // ~8 s at the view's 30 updates a second

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    const m = view.ef;
    if (!w || !h || !m) return;
    const th = BleepView.theme(view.root);
    const signed = view.units("detector") === 0 && view.units("rectify") === 3;
    const left = 30, right = 8, top = 8, bottom = 8, pw = w - left - right, ph = h - top - bottom;
    const Y = (v) => top + ph * (1 - (Math.max(signed ? -1 : 0, Math.min(1, v)) - (signed ? -1 : 0)) / (signed ? 2 : 1));
    const X = (i) => left + pw * i / (N - 1);
    // Grid and scale
    g.font = "9px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    for (const v of signed ? [-1, 0, 1] : [0, 0.5, 1]) {
      g.fillStyle = th.line; g.fillRect(left, Math.round(Y(v)), pw, 1);
      g.fillStyle = th.muted; g.fillText(v.toFixed(v === 0.5 ? 1 : 0), left - 5, Y(v));
    }
    // Gate shading
    g.fillStyle = th.accent; g.globalAlpha = 0.12;
    for (let i = 0, start = -1; i <= N; i++) {
      const on = i < N && m.gate[(m.at + i) % N] > 0.5;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { g.fillRect(X(start), top, X(i - 1) - X(start) + 1, ph); start = -1; }
    }
    g.globalAlpha = 1;
    // Threshold
    const thr = view.value(view._st, "threshold");
    g.strokeStyle = th.mod; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(left, Math.round(Y(thr)) + 0.5); g.lineTo(left + pw, Math.round(Y(thr)) + 0.5); g.stroke();
    g.setLineDash([]);
    // Env trace
    const base = Y(0);
    const area = g.createLinearGradient(0, top, 0, top + ph);
    area.addColorStop(0, th.accent); area.addColorStop(1, "transparent");
    g.beginPath(); g.moveTo(X(0), base);
    for (let i = 0; i < N; i++) g.lineTo(X(i), Y(m.env[(m.at + i) % N]));
    g.lineTo(X(N - 1), base); g.closePath();
    g.globalAlpha = 0.3; g.fillStyle = area; g.fill(); g.globalAlpha = 1;
    g.beginPath();
    for (let i = 0; i < N; i++) { const y = Y(m.env[(m.at + i) % N]); i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); }
    g.strokeStyle = th.accent; g.lineWidth = 2; g.lineJoin = "round";
    BleepView.glow(g, th.accent, 9); g.stroke(); g.shadowBlur = 0;
    // Now
    const now = m.env[(m.at + N - 1) % N];
    g.fillStyle = th.text; g.textAlign = "right"; g.textBaseline = "top"; g.font = "10px system-ui, sans-serif";
    g.fillText(now.toFixed(2), left + pw - 4, top + 3);
  }

  BleepViews.register("envelope-follower", {
    template: '<div class="bv-panel"><h2>Envelope</h2><canvas class="ef-cv"></canvas></div>',
    layout: [
      { title: "Times", params: ["attack", "release"] },
      { title: "Level", params: ["gain", "threshold"] },
      { title: "Detector", params: ["detector", "rectify"] },
    ],
    afterBuild(view, custom) {
      view.ef = { env: new Float32Array(N), gate: new Float32Array(N), at: 0 };
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      view._st = st;
      const m = view.ef, o = st && st.outputs;
      if (!m || !o) return;
      m.env[m.at] = o.env || 0;
      m.gate[m.at] = o.gate || 0;
      m.at = (m.at + 1) % N;
    },
  });
})();
