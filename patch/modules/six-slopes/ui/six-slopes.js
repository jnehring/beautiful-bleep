// SPDX-License-Identifier: MIT
// Six Slopes view (doc/specs/modules/six-slopes.md §5): six thin lanes, one per
// channel, each a short running scope with its live ratio (a note name in
// Sound mode, where the lane shows one cycle of the wave instead), and the
// Sum beside them. Rate is relabelled as a time, a note or a note value.
(function () {
  "use strict";
  const C4 = 261.6255653005986, HISTORY = 120;
  const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const curve = (u, c) => (c >= 0 ? Math.pow(u, 1 + 3 * c) : 1 - Math.pow(1 - u, 1 - 3 * c));
  const slope = (p, r) => (p < r ? p / r : (1 - p) / (1 - r));

  function units(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  }
  function fraction(r) {
    for (let q = 1; q <= 16; q++) {
      const n = Math.round(r * q);
      if (n > 0 && Math.abs(n / q - r) < 0.004 * r) return q === 1 ? String(n) : n + "/" + q;
    }
    return "×" + r.toFixed(2);
  }
  function noteText(hz) {
    const n = Math.round(69 + 12 * Math.log2(hz / 440));
    return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }
  function timeText(s) {
    if (s < 1) return Math.round(s * 1000) + " ms";
    return s < 10 ? s.toFixed(2) + " s" : s.toFixed(1) + " s";
  }

  BleepViews.register("six-slopes", {
    top: true,
    template: '<div class="bv-panel"><h2>Slopes</h2><div class="six-lanes" style="display:grid;grid-template-columns:1fr 64px;gap:2px 8px;align-items:center"></div></div>',
    afterBuild(view, el) {
      const lanes = el.querySelector(".six-lanes");
      view.six = { lanes: [], hist: [] };
      for (let k = 0; k <= 6; k++) {
        const canvas = document.createElement("canvas");
        canvas.style.height = k === 6 ? "30px" : "20px";
        canvas.style.width = "100%";
        const label = document.createElement("div");
        label.style.cssText = "font-size:11px;font-variant-numeric:tabular-nums;opacity:.85;white-space:nowrap";
        label.textContent = k === 6 ? "Sum" : String(k + 1);
        lanes.append(canvas, label);
        view.six.lanes.push({ canvas, label });
        view.six.hist.push([]);
      }
    },
    onState(st, view) {
      if (!view.six) return;
      const mode = units(view, "mode"), sound = mode === 3, sync = units(view, "sync");
      const bipolar = sound || (mode === 2 && units(view, "polarity") === 1);
      // Rate as a time, a note or a note value.
      const rate = view.knobs.get("rate");
      const n = clamp(view.value(st, "rate"), 0, 1);
      if (rate) {
        if (sound) rate.value.textContent = noteText(n < 0.5 ? 16 * Math.pow(C4 / 16, 2 * n) : C4 * Math.pow(4000 / C4, 2 * n - 1));
        else if (sync > 0) rate.value.textContent = view.type.params.find((x) => x.id === "sync").choices[sync];
        else rate.value.textContent = timeText(1 / (0.02 * Math.pow(50000, n)));
      }
      const arrays = (st && st.arrays) || {};
      const ratios = arrays.ratios || [1, 1, 1, 1, 1, 1], hz = arrays.hz || [];
      const outs = (st && st.outputs) || {};
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent").trim() || "#d97706";
      const line = css.getPropertyValue("--line");
      const skew = clamp(view.value(st, "skew"), 0.005, 0.995), c = view.value(st, "curve") * 2 - 1;
      const level = view.value(st, "level"), tilt = view.value(st, "tilt") * 2 - 1;
      for (let k = 0; k <= 6; k++) {
        const { canvas, label } = view.six.lanes[k];
        const id = k === 6 ? "sum" : "out" + (k + 1);
        const h = view.six.hist[k];
        if (typeof outs[id] === "number") { h.push(outs[id]); if (h.length > HISTORY) h.shift(); }
        if (k < 6) label.textContent = (k + 1) + "  " + (sound && hz[k] ? noteText(hz[k]) : fraction(ratios[k] || 1));
        const w = canvas.clientWidth, ht = canvas.clientHeight;
        if (!w) continue;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = ht * dpr; }
        const g = canvas.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, ht);
        const y = (v) => (bipolar ? ht / 2 - v * (ht / 2 - 1.5) : ht - 1.5 - v * (ht - 3));
        g.strokeStyle = line;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, y(0) + 0.5); g.lineTo(w, y(0) + 0.5); g.stroke();
        g.strokeStyle = accent;
        g.lineWidth = k === 6 ? 1.6 : 1.2;
        g.beginPath();
        if (sound && k < 6) {  // one cycle of channel 1, k + 1 … per ratio
          const gain = level * clamp(1 + (tilt * (k + 1 - 3.5)) / 2.5, 0, 1);
          const cycles = Math.min(8, ratios[k] / Math.max(ratios[0], 1e-6));
          for (let x = 0; x <= w; x++) {
            const p = ((x / w) * cycles) % 1, v = (2 * curve(slope(p, skew), c) - 1) * gain;
            x ? g.lineTo(x, y(v)) : g.moveTo(x, y(v));
          }
        } else {
          for (let i = 0; i < h.length; i++) {
            const px = w - (h.length - 1 - i) * (w / (HISTORY - 1));
            i ? g.lineTo(px, y(h[i])) : g.moveTo(px, y(h[i]));
          }
        }
        g.stroke();
      }
    },
  });
})();
