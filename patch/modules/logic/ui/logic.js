// SPDX-License-Identifier: GPL-3.0-or-later
// Logic view: the comparator window and the live outputs. A test signal (a slow
// wave with jitter) runs through the real Schmitt trigger (rise at the threshold,
// fall at threshold - hysteresis; LogicDsp.h) so you can see what the hysteresis
// rejects. The ten outputs light as the engine reports them.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".lg-cv{height:120px!important}.lg-leds{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}" +
    ".lg-led{font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:10px;border:1px solid var(--line);color:var(--muted)}" +
    ".lg-led.on{color:#0d1014;background:var(--accent);border-color:var(--accent);box-shadow:0 0 8px var(--accent)}";
  document.head.appendChild(style);
  const OUTS = ["and", "or", "xor", "nand", "nor", "nota", "ff", "rise", "fall", "change"];
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id);
    return p.min + (p.max - p.min) * view.value(st, id);
  };

  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const thr = real(view, st, "threshold"), hy = real(view, st, "hysteresis");
    const padT = 8, laneH = 18, ph = h - padT - laneH - 8;
    const Y = (v) => padT + (1 - (v + 1) / 2) * ph;
    // hysteresis window
    g.fillStyle = th.mod; g.globalAlpha = 0.18;
    g.fillRect(0, Y(thr), w, Math.max(1, Y(thr - hy) - Y(thr)));
    g.globalAlpha = 1;
    g.strokeStyle = th.mod; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(0, Y(thr)); g.lineTo(w, Y(thr)); g.moveTo(0, Y(thr - hy)); g.lineTo(w, Y(thr - hy)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = th.line; g.beginPath(); g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(w, Math.round(Y(0)) + 0.5); g.stroke();
    // the test signal through the Schmitt
    const sig = (u) => 0.7 * Math.sin(2 * Math.PI * (u * 1.6 - t * 0.12)) + 0.12 * Math.sin(2 * Math.PI * (u * 23 + t * 0.7)) + 0.06 * Math.sin(2 * Math.PI * (u * 61 - t));
    let high = false;
    const pts = [], gate = [];
    const N = Math.max(2, Math.floor(w / 2));
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = sig(u);
      high = high ? v >= thr - hy : v >= thr;
      pts.push([u * w, Y(v)]); gate.push(high);
    }
    g.strokeStyle = th.muted; g.lineWidth = 1.5; g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    const gy0 = h - 6 - laneH, gy1 = h - 6;
    g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 10);
    g.beginPath();
    gate.forEach((hi, i) => { const x = pts[i][0], y = hi ? gy0 : gy1; i ? (g.lineTo(x, gate[i - 1] ? gy0 : gy1), g.lineTo(x, y)) : g.moveTo(x, y); });
    g.stroke(); g.shadowBlur = 0;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    g.fillText("test signal", 6, padT + 8);
    g.textAlign = "right"; g.fillText(`rises at ${thr.toFixed(2)}, falls at ${(thr - hy).toFixed(2)}`, w - 6, padT + 8);
  }

  BleepViews.register("logic", {
    width: 530,
    template: '<div class="bv-panel"><h2>Comparator window</h2><canvas class="lg-cv"></canvas><div class="lg-leds"></div></div>',
    layout: [
      { title: "Comparator", params: ["threshold", "hysteresis"] },
      { title: "Flip-flop", params: ["flipsource"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas"), leds = custom.querySelector(".lg-leds");
      view._leds = OUTS.map((id) => { const s = document.createElement("span"); s.className = "lg-led"; s.textContent = id; leds.appendChild(s); return s; });
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) {
      view._st = st;
      const o = (st && st.outputs) || {};
      if (view._leds) OUTS.forEach((id, i) => view._leds[i].classList.toggle("on", (o[id] || 0) > 0.5));
    },
  });
})();
