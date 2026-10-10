// SPDX-License-Identifier: MIT
// MIDI Device view: live bars for what the keyboard/controller sends (pitch bend,
// mod wheel, pressure, velocity and the eight CC outputs), then the channel and
// the CC numbers in the order of the CC outputs.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".md-cv{height:96px!important}";
  document.head.appendChild(style);
  const BARS = [["bend", "bend", true], ["mod", "mod"], ["pressure", "press"], ["velocity", "vel"],
    ["cc1", "CC1"], ["cc2", "CC2"], ["cc3", "CC3"], ["cc4", "CC4"], ["cc5", "CC5"], ["cc6", "CC6"], ["cc7", "CC7"], ["cc8", "CC8"]];
  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st, o = (st && st.outputs) || {};
    const pad = 8, slot = (w - pad * 2) / BARS.length, bw = Math.min(26, slot * 0.55), top = 8, bot = h - 16;
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    BARS.forEach(([id, name, bi], k) => {
      const cx = pad + slot * (k + 0.5), v = typeof o[id] === "number" ? o[id] : 0;
      const gap = k >= 4 ? 6 : 0;
      const x = cx - bw / 2 + gap;
      g.fillStyle = th.panel2 || th.line; g.fillRect(x, top, bw, bot - top);
      g.strokeStyle = th.line; g.lineWidth = 1; g.strokeRect(x + 0.5, top + 0.5, bw - 1, bot - top - 1);
      const n = bi ? (Math.max(-1, Math.min(1, v)) + 1) / 2 : Math.max(0, Math.min(1, v));
      const y = bot - n * (bot - top);
      const gr = g.createLinearGradient(0, bot, 0, y);
      gr.addColorStop(0, "transparent"); gr.addColorStop(1, th.accent);
      g.fillStyle = gr; g.fillRect(x, bi ? Math.min(y, (top + bot) / 2) : y, bw, bi ? Math.abs(y - (top + bot) / 2) : bot - y);
      BleepView.glow(g, th.accent, 8); g.strokeStyle = th.accent; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + bw, y); g.stroke(); g.shadowBlur = 0;
      g.fillStyle = th.muted; g.fillText(name, cx + gap, h - 4);
    });
  }
  BleepViews.register("midi-device", {
    width: 700,
    template: '<div class="bv-panel"><h2>Live</h2><canvas class="md-cv"></canvas></div>',
    layout: [
      { title: "Input", params: ["channel"] },
      { title: "CC outputs 1-4", params: ["cc1", "cc2", "cc3", "cc4"] },
      { title: "CC outputs 5-8", params: ["cc5", "cc6", "cc7", "cc8"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
