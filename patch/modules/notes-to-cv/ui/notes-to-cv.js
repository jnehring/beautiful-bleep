// SPDX-License-Identifier: GPL-3.0-or-later
// Notes to CV view: a live strip of what the module sends (pitch trace, gate
// lane, velocity), then the settings in the order a note travels: which notes
// are listened to, how the voice is picked, the gate, then glide.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".nc-cv{height:84px!important}";
  document.head.appendChild(style);
  const N = 200;
  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), hp = view._pitch, hg = view._gate, hv = view._vel, n = N;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, hp[i]); hi = Math.max(hi, hp[i]); }
    if (hi - lo < 1) { const c = (hi + lo) / 2; lo = c - 0.5; hi = c + 0.5; }
    const top = 6, laneH = 14, bot = h - laneH - 10;
    const Y = (v) => bot - (v - lo) / (hi - lo) * (bot - top);
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, bot + 0.5); g.lineTo(w, bot + 0.5); g.stroke();
    g.strokeStyle = th.accent; g.lineWidth = 2; g.lineJoin = "round"; BleepView.glow(g, th.accent, 10);
    g.beginPath();
    for (let i = 0; i < n; i++) { const k = (view._hi + i) % n, x = i / (n - 1) * w, y = Y(hp[k]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    // gate lane, thickness = velocity
    for (let i = 0; i < n; i++) {
      const k = (view._hi + i) % n;
      if (hg[k] < 0.5) continue;
      g.globalAlpha = 0.35 + 0.65 * Math.min(1, hv[k] || 0.8);
      g.fillStyle = th.accent; g.fillRect(i / n * w, h - 8 - laneH, w / n + 0.5, laneH);
    }
    g.globalAlpha = 1;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    g.fillText("pitch", 6, 12); g.fillText("gate (brightness = velocity)", 6, h - 1);
  }
  BleepViews.register("notes-to-cv", {
    width: 640,
    template: '<div class="bv-panel"><h2>Live</h2><canvas class="nc-cv"></canvas></div>',
    layout: [
      { title: "Listen", params: ["channel", "priority"] },
      { title: "Gate", params: ["retrigger"] },
      { title: "Glide", params: ["glide", "glidemode"] },
    ],
    afterBuild(view, custom) {
      view._pitch = new Float32Array(N); view._gate = new Float32Array(N); view._vel = new Float32Array(N); view._hi = 0;
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      const o = st && st.outputs;
      if (!view._pitch || !o) return;
      const i = view._hi;
      view._pitch[i] = o.pitch || 0; view._gate[i] = o.gate || 0; view._vel[i] = o.velocity || 0;
      view._hi = (i + 1) % N;
    },
  });
})();
