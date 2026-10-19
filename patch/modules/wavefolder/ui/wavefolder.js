// SPDX-License-Identifier: GPL-3.0-or-later
// Folder view: the transfer curve of the stages up to Tap (computed by the
// module with dsp::Folder::transfer, x from −2 to +2 after Level) with the
// live input range shaded, a row of six dots for the Tap position, and a
// scope of the output over the dry signal (about 20 ms, triggered).
(function () {
  "use strict";

  function trace(g, data, w, h, scale) {
    g.beginPath();
    data.forEach((v, i) => {
      const x = i / (data.length - 1) * w, y = h / 2 - Math.max(-1.2, Math.min(1.2, v)) * scale;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }

  // dsp::Folder::transfer in JS (soft/hard blend per stage), for when no live curve arrives.
  const hard = (x) => 1 - Math.abs(((x + 1) - 4 * Math.floor((x + 1) / 4)) - 2);
  const fcurve = (x, shape) => (1 - shape) * Math.sin(Math.PI / 2 * x) + shape * hard(x);
  function transfer(x, gain, sym, shape, tap) {
    tap = Math.min(6, Math.max(1, tap));
    const lo = Math.floor(tap), frac = tap - lo, n = frac > 0 ? Math.min(lo + 1, 6) : lo;
    const y = [x + sym];
    for (let k = 1; k <= n; k++) y[k] = fcurve(gain * y[k - 1] + (k === 2 ? 0.5 * sym : 0), shape);
    return frac > 0 ? y[lo] + frac * (y[lo + 1] - y[lo]) : y[lo];
  }

  BleepViews.register("wavefolder", {
    width: 900,
    layout: [
      { title: "Source", params: ["source", "wave", "octave", "coarse", "fine", "fm"] },
      { title: "Fold", params: ["level", "fold", "symmetry", "shape", "tap", "spread"] },
      { title: "Output", params: ["mix", "quality"] },
    ],
    template: '<div class="bv-panel" style="display:flex;gap:12px">' +
      '<div style="flex:none;width:200px"><h2>Transfer</h2><canvas class="wf-curve" style="width:100%;height:84px"></canvas>' +
      '<div class="wf-taps" style="display:flex;justify-content:space-between;padding:4px 6px 0"></div></div>' +
      '<div style="flex:1;min-width:0"><h2>Scope <span style="float:right;font-weight:normal;text-transform:none">dim: dry · bright: folded</span></h2><canvas class="wf-scope" style="width:100%;height:99px"></canvas></div></div>',
    afterBuild(view, el) {
      const taps = el.querySelector(".wf-taps");
      for (let i = 0; i < 6; i++) {
        const d = document.createElement("span");
        d.style.cssText = "width:8px;height:8px;border-radius:50%;background:var(--line)";
        taps.append(d);
      }
    },
    onState(st, view) {
      const a = (st && st.arrays) || {};
      const th = BleepView.theme(view.root);
      const accent = th.accent, line = th.line, text = th.text;
      const fold = view.value(st, "fold"), sym = view.value(st, "symmetry") * 2 - 1;
      const shape = view.value(st, "shape"), tap = 1 + 5 * view.value(st, "tap");
      const gain = Math.pow(2, 2 * fold), lvl = Math.pow(view.value(st, "level"), 3);
      const T = (x) => transfer(x, gain, sym, shape, tap);

      // Transfer curve, x −2 … +2, y −1 … +1, with the input range shaded.
      const c = view.root.querySelector(".wf-curve");
      if (c && c.clientWidth) {
        const { g, w, h } = BleepView.fit(c);
        const X = (x) => (x + 2) / 4 * w, Y = (y) => h / 2 - y * (h / 2 - 4);
        const [lo, hi] = a.range || [-lvl, lvl];
        g.fillStyle = accent;
        g.globalAlpha = 0.14;
        g.fillRect(X(Math.max(-2, lo)), 0, Math.max(1, X(Math.min(2, hi)) - X(Math.max(-2, lo))), h);
        g.globalAlpha = 0.5;
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h);
        for (const v of [-1, 1]) { g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); }
        g.stroke(); g.globalAlpha = 1;
        g.strokeStyle = accent;
        g.lineWidth = 2;
        BleepView.glow(g, accent, 10);
        g.beginPath();
        const N = Math.max(2, Math.floor(w));
        for (let i = 0; i < N; i++) {
          const x = -2 + 4 * i / (N - 1), v = a.transfer ? a.transfer[Math.round(i / (N - 1) * (a.transfer.length - 1))] : T(x);
          i ? g.lineTo(X(x), Y(v)) : g.moveTo(X(x), Y(v));
        }
        g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
      }

      // Tap dots: brightness by weight of the two stages heard.
      view.root.querySelectorAll(".wf-taps span").forEach((d, i) => {
        const weight = Math.max(0, 1 - Math.abs(tap - (i + 1)));
        d.style.background = weight > 0 ? accent : line;
        d.style.opacity = weight > 0 ? String(0.35 + 0.65 * weight) : "1";
        d.style.boxShadow = weight > 0 ? "0 0 6px " + accent : "none";
      });

      // Scope: dry dim, output bright (live, or a sine folded by the curve).
      const s = view.root.querySelector(".wf-scope");
      if (s && s.clientWidth) {
        const { g, w, h } = BleepView.fit(s);
        const scale = h / 2 - 4;
        g.strokeStyle = line; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.globalAlpha = 1;
        const live = a.wet && a.wet.length;
        const n = live ? a.wet.length : 256, ph = live ? 0 : (performance.now() / 4000) % 1;
        const dry = live ? a.dry || [] : Array.from({ length: n }, (_, i) => lvl * Math.sin(2 * Math.PI * (2.5 * i / (n - 1) + ph)));
        const wet = live ? a.wet : dry.map(T);
        g.strokeStyle = text; g.globalAlpha = 0.3;
        trace(g, dry, w, h, scale);
        g.globalAlpha = 1;
        g.strokeStyle = accent; g.lineWidth = 2;
        BleepView.glow(g, accent, 10);
        trace(g, wet, w, h, scale);
        g.shadowBlur = 0; g.lineWidth = 1;
      }
    },
  });
})();
