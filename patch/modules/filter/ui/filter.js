// SPDX-License-Identifier: MIT
// Filter view: the magnitude response of the current (modulated) settings,
// from the analog prototype of the selected algorithm. Types, resonance and
// mode mappings mirror patch/modules/filter/dsp/VaFilters.h.
(function () {
  "use strict";
  const TYPES = ["svf", "svfUnitBp", "svfBandShelf", "svfPeak", "svfAllpass",
    "lp1", "hp1", "ap1", "lowShelf1", "highShelf1",
    "ladder", "ladderHp", "ladderTanh", "ladderHyper", "ladderNl",
    "diode", "diodeTanh",
    "phaser1", "phaser2", "flanger",
    "naive", "biquad",
    "svfAtanh", "svfHyper", "svfRough"];

  // Complex numbers as [re, im].
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const scale = (a, k) => [a[0] * k, a[1] * k];
  const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const ONE = [1, 0];
  const abs = (a) => Math.hypot(a[0], a[1]);

  function morphWeights(m) {
    m = Math.min(Math.max(m, 0), 1) * 3;
    const i = Math.min(Math.floor(m), 2), t = m - i, w = [0, 0, 0, 0];
    w[i] = 1 - t; w[i + 1] = t;
    return w;
  }

  /// Settings → the parameters the response needs (cf. makeCoeffs).
  function coeffs(type, res, mode, gainDb) {
    res = Math.min(Math.max(res, 0), 1);
    const q = 0.5 * Math.pow(50, res);
    const c = { R: 0.5 / q, K: Math.pow(10, gainDb / 20) - 1, k: 0, comp: 1, invert: mode < 0.5 ? 1 : -1, scale: 1 };
    if (type === "svfRough") c.R = 0.4 / q;
    if (type === "ladder" || type === "ladderHp") c.k = 3.95 * res;
    if (type === "ladderTanh" || type === "ladderHyper" || type === "ladderNl") c.k = 5 * res;
    if (type === "diode") c.k = 16.5 * res;
    if (type === "diodeTanh") c.k = 21 * res;
    if (type === "phaser1" || type === "phaser2" || type === "flanger") c.k = 0.85 * res;
    if (type === "svfAtanh" || type === "svfHyper") c.R -= 0.06 * res * res;
    if (type.startsWith("ladder") && type !== "ladderHp") c.comp = 1 + c.k * morphWeights(mode)[0];
    if (type.startsWith("diode")) { c.comp = Math.pow(1 + c.k, 0.75); c.scale = Math.SQRT2; }
    if (type === "lowShelf1") c.scale = 1 / Math.sqrt(1 + c.K);
    if (type === "highShelf1") c.scale = Math.sqrt(1 + c.K);
    if (type === "phaser2") c.R = 5 * Math.pow(0.02, Math.min(Math.max(mode, 0), 1));
    // The linear curve of a self-oscillating model would be unstable: draw it just below.
    c.k = Math.min(c.k, type.startsWith("diode") ? 16.9 : type.startsWith("ladder") ? 3.97 : c.k);
    c.R = Math.max(c.R, 0.01);
    return c;
  }

  /// H(jω) for a frequency in Hz.
  function response(type, freq, fc, c, mode) {
    const s = [0, freq / (fc * c.scale)];
    const svf = () => {
      const den = add(add(mul(s, s), scale(s, 2 * c.R)), ONE);
      return { lp: div(ONE, den), bp: div(s, den), hp: div(mul(s, s), den) };
    };
    const svfMorph = () => {
      const o = svf(), w = morphWeights(mode);
      return add(add(scale(o.lp, w[0] + w[3]), scale(o.bp, w[1])), scale(o.hp, w[2] + w[3]));
    };
    const lp1 = () => div(ONE, add(ONE, s));
    const ladder = () => {
      // y_n = L^n·U, U = comp / (1 + k·L⁴·F); F: feedback high-pass (§4.3) or 1.
      const L = lp1(), L2 = mul(L, L), L4 = mul(L2, L2);
      let F = ONE;
      if (type === "ladderHp") { const sh = [0, freq / 250]; F = div(sh, add(ONE, sh)); }
      const U = div([c.comp, 0], add(ONE, scale(mul(L4, F), c.k)));
      const y = [U]; for (let i = 0; i < 4; i++) y.push(mul(y[i], L));
      const bp = add(sub(y[2], scale(y[3], 2)), y[4]);
      const hp = add(add(sub(y[0], scale(y[1], 4)), sub(scale(y[2], 6), scale(y[3], 4))), y[4]);
      const w = morphWeights(mode);
      return add(add(scale(y[4], w[0]), scale(bp, 4 * w[1])), add(scale(hp, w[2]), scale(add(add(y[4], scale(bp, 2)), hp), w[3])));
    };
    const fbMix = (ap) => div(scale(add(ONE, scale(ap, c.invert)), 0.5), sub(ONE, scale(ap, c.k)));
    switch (type) {
      case "svf": case "biquad": case "svfAtanh": case "svfHyper": case "svfRough": return svfMorph();
      case "svfUnitBp": return scale(svf().bp, 2 * c.R);
      case "svfBandShelf": return add(ONE, scale(svf().bp, 2 * c.R * c.K));
      case "svfPeak": { const o = svf(); return sub(o.lp, o.hp); }
      case "svfAllpass": return sub(ONE, scale(svf().bp, 4 * c.R));
      case "lp1": case "naive": return lp1();
      case "hp1": return sub(ONE, lp1());
      case "ap1": return sub(scale(lp1(), 2), ONE);
      case "lowShelf1": return add(ONE, scale(lp1(), c.K));
      case "highShelf1": return add(ONE, scale(sub(ONE, lp1()), c.K));
      case "diode": case "diodeTanh": {
        const L = lp1(), L2 = mul(L, L), L4 = scale(mul(L2, L2), 1 / 8);
        const d = div(L4, add(sub(L4, L2), ONE));
        return div(scale(d, c.comp), add(ONE, scale(d, c.k)));
      }
      case "phaser1": { const a = sub(scale(lp1(), 2), ONE), a2 = mul(a, a); return fbMix(mul(a2, a2)); }
      case "phaser2": { const o = svf(), a = sub(ONE, scale(o.bp, 4 * c.R)); return fbMix(mul(a, a)); }
      case "flanger": { const ph = -2 * Math.PI * freq / fc; return fbMix([Math.cos(ph), Math.sin(ph)]); }
      default: return ladder();
    }
  }

  BleepViews.register("filter", {
    settingsTop: true,  // the algorithm first: it decides what the knobs do
    template: '<div class="bv-panel"><h2>Response</h2><canvas class="response" style="height:96px"></canvas></div>',
    onState(st, view) {
      const c = view.root.querySelector(".response");
      if (!c || !c.clientWidth) return;
      const fc = 20 * Math.pow(1000, view.value(st, "cutoff"));
      const tp = view.type.params.find((p) => p.id === "type");
      const index = Math.round(view.value(st, "type") * ((tp ? tp.steps : TYPES.length) - 1));
      const type = TYPES[index] || "svf";
      const mode = view.value(st, "mode"), mix = view.value(st, "mix");
      const co = coeffs(type, view.value(st, "resonance"), mode, -24 + 48 * view.value(st, "gain"));
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const top = 24, bottom = -36;
      const y = (db) => (top - Math.min(top, Math.max(bottom, db))) / (top - bottom) * h;
      g.strokeStyle = getComputedStyle(view.root).getPropertyValue("--line");
      g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
      g.strokeStyle = getComputedStyle(view.root).getPropertyValue("--accent");
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const freq = 20 * Math.pow(1000, x / w);
        const wet = response(type, freq, fc, co, mode);
        const lin = abs(add(scale(wet, mix), [1 - mix, 0]));
        const yy = y(20 * Math.log10(Math.max(lin, 1e-6)));
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    },
  });
})();
