// SPDX-License-Identifier: GPL-3.0-or-later
// Wobble view (doc/specs/modules/wobble.md §5): a three-trace scope over the last
// four steps (Stepped, Smooth, Wobble), burst pulses as ticks below, and the
// step response of the two filters at the current knobs drawn faintly behind
// (same filter as WobbleDsp: cutoff 2^(4 − 8·Smooth) per step, Q 0.5 + 7.5·Wobble²).
(function () {
  "use strict";
  const RANGE = 1.6;

  /// Step response (0 → 1) of the zero-delay-feedback low-pass over `steps`
  /// steps at `n` points, for a cutoff in cycles per step.
  function stepResponse(cyclesPerStep, q, steps, n) {
    const sub = 16, fs = (n / steps) * sub;  // samples per step
    const g = Math.tan(Math.PI * Math.min(cyclesPerStep / fs, 0.49)), k = 1 / Math.max(q, 0.05);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    let ic1 = 0, ic2 = 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      let v2 = 0;
      for (let s = 0; s < sub; s++) {
        const v3 = 1 - ic2, v1 = a1 * ic1 + a2 * v3;
        v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      }
      out.push(v2);
    }
    return out;
  }

  function draw(view, st) {
    const c = view.wobble && view.wobble.canvas;
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim();
    const muted = css.getPropertyValue("--muted").trim(), text = css.getPropertyValue("--text").trim();
    const plotH = h - 14;
    const y = (v) => plotH / 2 - (Math.max(-RANGE, Math.min(RANGE, v)) / RANGE) * (plotH / 2 - 2);
    g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath();
    for (const v of [-1, 0, 1]) { g.moveTo(0, y(v) + 0.5); g.lineTo(w, y(v) + 0.5); }
    for (let s = 1; s < 4; s++) { g.moveTo((s / 4) * w + 0.5, 0); g.lineTo((s / 4) * w + 0.5, plotH); }
    g.stroke();

    // step responses behind, from −1 to +1 over the first step's start
    const smooth = view.value(st, "smooth"), wob = view.value(st, "wobble");
    const cycles = Math.pow(2, 4 - 8 * smooth), n = 96;
    const curves = [stepResponse(cycles, 0.5, 4, n), stepResponse(cycles, 0.5 + 7.5 * wob * wob, 4, n)];
    g.globalAlpha = 0.18; g.lineWidth = 3;
    curves.forEach((r, k) => {
      g.strokeStyle = k ? accent : text;
      g.beginPath();
      r.forEach((v, i) => { const x = (i / (n - 1)) * w, yy = y(-1 + 2 * v); i ? g.lineTo(x, yy) : g.moveTo(x, yy); });
      g.stroke();
    });
    g.globalAlpha = 1;

    const a = (st && st.arrays) || {};
    const trace = (arr, colour, width, stepped) => {
      if (!arr || !arr.length) return;
      g.strokeStyle = colour; g.lineWidth = width;
      g.beginPath();
      arr.forEach((v, i) => {
        const x = (i / (arr.length - 1)) * w;
        if (!i) g.moveTo(x, y(v));
        else { if (stepped) g.lineTo(x, y(arr[i - 1])); g.lineTo(x, y(v)); }
      });
      g.stroke();
    };
    trace(a.stepped, muted, 1, true);
    BleepView.glow(g, text, 4);
    trace(a.smooth, text, 1.5, false);
    BleepView.glow(g, accent, 12);
    trace(a.wobble, accent, 2.2, false);
    g.shadowBlur = 0;
    if (a.burst) {
      g.fillStyle = accent;
      a.burst.forEach((v, i) => { if (v > 0.5) g.fillRect((i / (a.burst.length - 1)) * w, h - 10, 1.5, 8); });
    }
    g.font = "9px system-ui, sans-serif";
    g.fillStyle = muted; g.fillText("Stepped", 4, 10);
    g.fillStyle = text; g.fillText("Smooth", 48, 10);
    g.fillStyle = accent; g.fillText("Wobble", 90, 10);
  }

  BleepViews.register("wobble", {
    top: true,
    width: 820,
    layout: [
      { title: "Clock", params: ["rate", "sync"] },
      { title: "Smoothing", params: ["smooth", "wobble", "chaos"] },
      { title: "Bursts", params: ["burst", "burstsize"] },
      { title: "Output", params: ["level", "polarity", "seed"] },
    ],
    template: '<div class="bv-panel"><h2>Last four steps</h2><canvas class="wobble-scope" style="width:100%;height:120px"></canvas></div>',
    afterBuild(view, el) {
      view.wobble = { canvas: el.querySelector("canvas") };
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) { draw(view, st); },
    onRefresh(view) { draw(view, null); },
  });
})();
