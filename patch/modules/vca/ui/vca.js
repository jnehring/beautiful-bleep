// SPDX-License-Identifier: GPL-3.0-only
// VCA view: the gain law (linear, or cubed below 100 % for the exponential response:
// about -60 dB .. 0 dB, then linear up to 400 %) with a dot at the current (modulated) Gain, and a scope of a
// test tone before (ghost) and after the amplifier. Mirrors VcaModule.cpp.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".vca-cv{height:130px!important}";
  document.head.appendChild(style);

  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const x = view.value(st, "gain") * 4, expo = view.units("response") === 1;   // x: 0 – 4 (0 – 400 %)
    const gain = expo && x < 1 ? x * x * x : x, rng = 4;
    const split = Math.min(w * 0.38, 190), pad = 8;
    // left: gain law
    const px = pad + 4, pw = split - pad * 2 - 4, py = 8, phh = h - 20;
    g.strokeStyle = th.line; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, pw, phh);
    const Y = (v) => py + (1 - Math.min(v / rng, 1)) * phh, XX = (v) => px + v / 4 * pw;
    const curve = (e) => { g.beginPath(); for (let i = 0; i <= 80; i++) { const v = i / 20, y = Y(e && v < 1 ? v * v * v : v); i ? g.lineTo(XX(v), y) : g.moveTo(XX(v), y); } g.stroke(); };
    g.strokeStyle = th.line; g.lineWidth = 1.5; curve(!expo);
    g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 8); curve(expo); g.shadowBlur = 0;
    g.strokeStyle = th.muted; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(XX(x), Y(0)); g.lineTo(XX(x), Y(gain)); g.lineTo(XX(0), Y(gain)); g.stroke(); g.setLineDash([]);
    BleepView.glow(g, th.accent, 14); g.fillStyle = th.text; g.beginPath(); g.arc(XX(x), Y(gain), 4, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    g.fillText("gain CV", px + pw / 2, h - 3);
    // right: scope
    const sx = split + 8, sw = w - sx - 8, mid = h / 2 - 4, amp = h / 2 - 14;
    g.strokeStyle = th.line; g.beginPath(); g.moveTo(sx, mid + 0.5); g.lineTo(sx + sw, mid + 0.5); g.stroke();
    const sine = (a, colour, wd) => {
      g.strokeStyle = colour; g.lineWidth = wd; g.beginPath();
      for (let i = 0; i <= sw; i += 2) { const y = mid - a * amp * Math.sin(2 * Math.PI * (i / sw * 3 - t * 0.8)); i ? g.lineTo(sx + i, y) : g.moveTo(sx + i, y); }
      g.stroke();
    };
    sine(1, th.line, 1.5);
    BleepView.glow(g, th.accent, 12); sine(Math.min(gain, 1.4), th.accent, 2); g.shadowBlur = 0;
    const db = gain < 0.0005 ? "-inf" : (20 * Math.log10(gain)).toFixed(1);
    g.fillStyle = th.text; g.font = "11px system-ui, sans-serif"; g.textAlign = "right";
    g.fillText(`${db} dB`, sx + sw, 14);
    g.fillStyle = th.muted; g.textAlign = "left"; g.fillText(expo ? "exponential" : "linear", sx, 14);
  }

  BleepViews.register("vca", {
    width: 530,
    template: '<div class="bv-panel"><h2>Gain</h2><canvas class="vca-cv"></canvas></div>',
    side: true,
    layout: [{ title: "Amplifier", params: ["gain", "response"] }],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
