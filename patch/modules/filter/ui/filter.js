// SPDX-License-Identifier: GPL-3.0-or-later
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
    "svfAtanh", "svfHyper", "svfRough",
    "keyLp", "keyHp", "vowel", "combPos", "combNeg", "stairLp", "stairHp"];

  // Vowel table: formant centre (Hz), level (dB), bandwidth (Hz), as in VaFilters.h.
  const VOWELS = [
    { hz: [780, 1180, 2850, 3800], db: [0, -5, -16, -22], bw: [85, 95, 130, 190] },
    { hz: [430, 1900, 2650, 3450], db: [0, -9, -14, -22], bw: [70, 110, 140, 200] },
    { hz: [310, 2150, 2950, 3700], db: [0, -13, -15, -24], bw: [60, 120, 150, 210] },
    { hz: [460, 820, 2700, 3500], db: [0, -4, -18, -24], bw: [75, 90, 130, 190] },
    { hz: [330, 720, 2450, 3350], db: [0, -8, -20, -26], bw: [65, 90, 120, 180] },
  ];

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
  function coeffs(type, res, mode, gainDb, ex) {
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
    if (type === "keyLp" || type === "keyHp") c.R = (3 - (1 + 2.04 * res)) / 2;  // amplifier gain K: H = 1 / (s² + (3 − K)·s + 1)
    c.R = Math.max(c.R, 0.01);
    c.ex = ex || {};
    c.res = res;
    c.gainDb = gainDb;
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
    const ex = c.ex;
    if (type === "vowel") {
      const bwScale = 2 * Math.pow(0.1, c.res), spacing = 1 + Math.min(Math.max(c.gainDb, -24), 24) / 48, shift = fc / 2000;
      const pos = Math.min(Math.max(ex.vowel || 0, 0), 1) * 4, i = Math.min(Math.floor(pos), 3), t = pos - i;
      const a = VOWELS[i], b = VOWELS[i + 1];
      let sum = [0, 0];
      for (let n = 0; n < 4; n++) {
        const f0 = a.hz[n] * Math.pow(b.hz[n] / a.hz[n], t);
        const f = Math.min(Math.max(1500 * Math.pow(f0 / 1500, spacing) * shift, 40), 18000);
        const bw = (a.bw[n] + t * (b.bw[n] - a.bw[n])) * bwScale * Math.sqrt(shift);
        const R = Math.max(0.01, 0.5 * bw / f), amp = 2 * Math.pow(10, (a.db[n] + t * (b.db[n] - a.db[n])) / 20);
        const sn = [0, freq / f];
        const den = add(add(mul(sn, sn), scale(sn, 2 * R)), ONE);
        sum = add(sum, scale(div(sn, den), 2 * R * amp));
      }
      return sum;
    }
    if (type === "combPos" || type === "combNeg") {
      const neg = type === "combNeg", k = (neg ? -0.985 : 0.985) * c.res;
      const fd = 20000 * Math.pow(0.02, Math.min(Math.max(ex.damping || 0, 0), 1));
      const L = div(ONE, [1, freq / fd]);
      const phase = Math.atan(fc / fd) / (2 * Math.PI * fc);  // the damping filter's delay at the pitch
      const D = (neg ? 0.5 : 1) / fc - phase, ph = -2 * Math.PI * freq * D;
      return div([1 - Math.abs(k), 0], sub(ONE, scale(mul(L, [Math.cos(ph), Math.sin(ph)]), k)));
    }
    if (type === "stairLp" || type === "stairHp") {
      const n = ex.stages || 4, lp = type === "stairLp", edge = Math.sqrt(Math.pow(2, 1 / n) - 1);
      const base = lp ? fc / edge : fc * edge;
      let h = ONE;
      for (let i = 0; i < n; i++) {
        const fi = base * Math.pow(2, c.res * (i - 0.5 * (n - 1)));
        const l = div(ONE, [1, freq / fi]);
        h = mul(h, lp ? l : sub(ONE, l));
      }
      return h;
    }
    const fbMix = (ap) => div(scale(add(ONE, scale(ap, c.invert)), 0.5), sub(ONE, scale(ap, c.k)));
    switch (type) {
      case "svf": case "biquad": case "svfAtanh": case "svfHyper": case "svfRough": return svfMorph();
      case "svfUnitBp": return scale(svf().bp, 2 * c.R);
      case "svfBandShelf": return add(ONE, scale(svf().bp, 2 * c.R * c.K));
      case "svfPeak": { const o = svf(); return sub(o.lp, o.hp); }
      case "svfAllpass": return sub(ONE, scale(svf().bp, 4 * c.R));
      case "keyLp": return svf().lp;
      case "keyHp": return svf().hp;
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

  const HIT = 14;  // px around the cutoff dot that grab it

  /// Drag the dot: left / right = cutoff (same log axis as the knob), up / down = resonance.
  function attach(view, cv) {
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const norm = (id) => { const p = view.type.params.find((x) => x.id === id); return view.node.params[id] ?? (p ? p.default : 0); };
    const set = (id, v) => {
      v = Math.min(Math.max(v, 0), 1);
      view.node.params[id] = v;
      view.api.setParam(id, v);
      const k = view.knobs.get(id);
      if (k) k.draw();
    };
    const redraw = () => { if (view.flt.st) hooks.onState(view.flt.st, view); };
    const over = (p) => view.flt.dot && Math.hypot(view.flt.dot.x - p.x, view.flt.dot.y - p.y) <= HIT;
    cv.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const p = at(e);
      if (!over(p)) return;
      e.stopPropagation(); e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      view.api.beginGesture();  // one undo step per drag
      view.flt.drag = { x: p.x, y: p.y, c: norm("cutoff"), r: norm("resonance") };
      cv.style.cursor = "grabbing";
    });
    cv.addEventListener("pointermove", (e) => {
      const p = at(e), d = view.flt.drag;
      if (!d) { cv.style.cursor = over(p) ? "grab" : "default"; return; }
      const fine = e.shiftKey ? 0.2 : 1;
      set("cutoff", d.c + (p.x - d.x) / cv.clientWidth * fine);
      set("resonance", d.r + (d.y - p.y) / 100 * fine);
      redraw();
    });
    const end = () => { view.flt.drag = null; cv.style.cursor = "default"; };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", (e) => {
      if (!over(at(e))) return;
      view.api.beginGesture();
      for (const id of ["cutoff", "resonance"]) { const p = view.type.params.find((x) => x.id === id); if (p) set(id, p.default); }
      redraw();
    });
  }

  const hooks = {
    width: 800,
    layout: [
      { title: "Algorithm", params: ["type", "mode", "vowel", "damping", "slope"] },
      { title: "Cutoff", params: ["cutoff", "keytrack", "resonance"] },
      { title: "Drive / Output", params: ["drive", "gain", "mix"] },
    ],
    template: '<div class="bv-panel"><h2>Response</h2><canvas class="response" style="height:130px"></canvas></div>',
    onState(st, view) {
      const cv = view.root.querySelector(".response");
      if (!cv || !cv.clientWidth) return;
      if (!view.flt) { view.flt = { st: null, dot: null, drag: null }; attach(view, cv); }
      view.flt.st = st;
      const fc = 20 * Math.pow(1000, view.value(st, "cutoff"));
      const tp = view.type.params.find((p) => p.id === "type");
      const index = Math.round(view.value(st, "type") * ((tp ? tp.steps : TYPES.length) - 1));
      const type = TYPES[index] || "svf";
      const mode = view.value(st, "mode"), mix = view.value(st, "mix"), res = view.value(st, "resonance");
      const sp = view.type.params.find((p) => p.id === "slope");
      const ex = {
        vowel: view.value(st, "vowel"), damping: view.value(st, "damping"),
        stages: 1 + Math.round(view.value(st, "slope") * ((sp ? sp.steps : 8) - 1)),
      };
      const co = coeffs(type, res, mode, -24 + 48 * view.value(st, "gain"), ex);
      const { g, w, h } = BleepView.fit(cv);
      if (!w || !h) return;
      const th = BleepView.theme(view.root);
      const top = 24, bottom = -36;
      const y = (db) => (top - Math.min(top, Math.max(bottom, db))) / (top - bottom) * (h - 4) + 2;
      // grid: decades and 12 dB steps
      g.lineWidth = 1; g.strokeStyle = th.line; g.globalAlpha = 0.45;
      g.beginPath();
      for (const f of [100, 1000, 10000]) { const x = Math.round(Math.log(f / 20) / Math.log(1000) * w) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
      for (const db of [12, -12, -24]) { const yy = Math.round(y(db)) + 0.5; g.moveTo(0, yy); g.lineTo(w, yy); }
      g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = th.muted; g.beginPath(); g.moveTo(0, y(0) + 0.5); g.lineTo(w, y(0) + 0.5); g.stroke();
      const pts = [];
      for (let x = 0; x <= w; x += 2) {
        const freq = 20 * Math.pow(1000, x / w);
        const wet = response(type, freq, fc, co, mode);
        const lin = abs(add(scale(wet, mix), [1 - mix, 0]));
        pts.push([x, y(20 * Math.log10(Math.max(lin, 1e-6)))]);
      }
      const path = () => { g.beginPath(); pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy))); };
      // gradient fill under the curve
      path(); g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, th.accent); gr.addColorStop(1, "transparent");
      g.globalAlpha = 0.22; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
      // resonance halo at the cutoff
      const cx = Math.log(fc / 20) / Math.log(1000) * w;
      const near = pts.reduce((b, p) => (Math.abs(p[0] - cx) < Math.abs(b[0] - cx) ? p : b), pts[0]);
      g.strokeStyle = th.accent; g.globalAlpha = 0.35; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(cx + 0.5, 0); g.lineTo(cx + 0.5, h); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      const rg = g.createRadialGradient(cx, near[1], 0, cx, near[1], 10 + 40 * res);
      rg.addColorStop(0, th.accent); rg.addColorStop(1, "transparent");
      g.globalAlpha = 0.25 + 0.4 * res; g.fillStyle = rg;
      g.fillRect(cx - 60, near[1] - 60, 120, 120); g.globalAlpha = 1;
      // the glowing curve
      g.lineWidth = 2; g.lineJoin = "round"; g.strokeStyle = th.accent;
      BleepView.glow(g, th.accent, 10);
      path(); g.stroke();
      g.shadowBlur = 0;
      view.flt.dot = { x: cx, y: near[1] };
      g.fillStyle = th.text; g.beginPath(); g.arc(cx, near[1], view.flt.drag ? 5 : 3, 0, 7); g.fill();
    },
  };
  BleepViews.register("filter", hooks);
})();
