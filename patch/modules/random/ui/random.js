// SPDX-License-Identifier: GPL-3.0-only
// Random view: a scrolling trace of the live Out value over the band the
// distribution can reach (Bias +- Spread, RandomDsp::shapeValue), with the
// semitone grid when Quantize is on. Nothing here is invented: the trace is the
// module's output; the band and grid come from the settings.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".rn-cv{height:112px!important}";
  document.head.appendChild(style);
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id), x = view.value(st, id);
    if (p.map === "exp") return p.min * Math.pow(p.max / p.min, x);
    return p.min + (p.max - p.min) * x;
  };
  const N = 240;
  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const bias = real(view, st, "bias"), spread = real(view, st, "spread");
    const lo = Math.max(-1, bias - spread), hi = Math.min(1, bias + spread);
    const pad = 6, top = 8, bot = h - 8, Y = (v) => top + (1 - (v + 1) / 2) * (bot - top);
    g.fillStyle = th.accent; g.globalAlpha = 0.1; g.fillRect(0, Y(hi), w, Math.max(1, Y(lo) - Y(hi))); g.globalAlpha = 1;
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath();
    g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(w, Math.round(Y(0)) + 0.5); g.stroke();
    g.strokeStyle = th.accent; g.globalAlpha = 0.5; g.setLineDash([3, 3]); g.beginPath();
    g.moveTo(0, Y(hi)); g.lineTo(w, Y(hi)); g.moveTo(0, Y(lo)); g.lineTo(w, Y(lo)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    if (view.units("quantize") === 1) {  // semitones: 1/12 per step
      g.strokeStyle = th.line; g.beginPath();
      for (let k = -12; k <= 12; k++) { const y = Math.round(Y(k / 12)) + 0.5; g.moveTo(w - 14, y); g.lineTo(w, y); }
      g.stroke();
    }
    const hist = view._hist, n = hist.length;
    g.strokeStyle = th.accent; g.lineWidth = 2.5; g.lineJoin = "round";
    BleepView.glow(g, th.accent, 12);
    g.beginPath();
    const sm = view.value(st, "smooth");
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * (w - 16) + pad, y = Y(hist[(view._hi + i) % n]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    const last = hist[(view._hi + n - 1) % n];
    g.fillStyle = th.text; g.beginPath(); g.arc(w - 10, Y(last), 4, 0, 7); g.fill(); g.shadowBlur = 0;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    const sync = view.units("sync"), names = view.type.params.find((q) => q.id === "sync").choices;
    g.fillText(`${sync ? names[sync] : real(view, st, "rate").toFixed(2) + " Hz"} · loop ${Math.round(view.value(st, "loop") * 100)}% · smooth ${Math.round(sm * 100)}%`, 6, 10);
  }
  BleepViews.register("random", {
    width: 610,
    template: '<div class="bv-panel"><h2>Output</h2><canvas class="rn-cv"></canvas></div>',
    layout: [
      { title: "Timing", params: ["sync", "rate"] },
      { title: "Distribution", params: ["bias", "spread", "quantize"] },
      { title: "Memory", params: ["loop", "length", "seed"] },
      { title: "Motion", params: ["smooth"] },
    ],
    afterBuild(view, custom) {
      view._hist = new Float32Array(N); view._hi = 0;
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      view._st = st;
      const o = st && st.outputs;
      if (view._hist && o && typeof o.out === "number") { view._hist[view._hi] = Math.max(-1, Math.min(1, o.out)); view._hi = (view._hi + 1) % view._hist.length; }
    },
  });
})();
