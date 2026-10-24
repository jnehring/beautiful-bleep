// SPDX-License-Identifier: GPL-3.0-only
// Organic LFOs view (doc/specs/modules/organic-lfos.md §5): a rate strip (each
// LFO's live rate as a tick on a log axis) above an eight-trace scrolling
// scope of about the last four cycles of LFO 1, with the Sum as a thicker
// line on top. With Lock = Bars the Rate knob shows note values.
(function () {
  "use strict";
  const MAX_HISTORY = 900;  // 30 s at the view's 30 updates per second
  const LO = 0.002, HI = 50;
  const BARS = ["64 bars", "32 bars", "16 bars", "8 bars", "4 bars", "2 bars", "1/1.", "1/1", "1/1T", "1/2.", "1/2", "1/2T",
    "1/4.", "1/4", "1/4T"];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function units(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  }
  // The DSP's wave (OrganicLfosDsp::wave), for the preview when no live outputs arrive.
  function wave(p, t) {
    p -= Math.floor(p);
    if (t >= 0) {
      const a = 0.5 - 0.4 * t, q = (p + 0.25) % 1, s = q < a ? 0.5 * q / a : 0.5 + 0.5 * (q - a) / (1 - a), x = -Math.cos(2 * Math.PI * s);
      return t < 1e-4 ? x : Math.sign(x) * Math.pow(Math.abs(x), 1 + 2 * t);
    }
    const g = -6 * t, x = Math.sin(2 * Math.PI * p);
    return g < 1e-4 ? x : Math.tanh(g * x) / Math.tanh(g);
  }
  function setup(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w) return null;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  BleepViews.register("organic-lfos", {
    partNames: ["Rates and motion"],
    top: true,
    layout: [
      { title: "Rate", params: ["rate", "lock", "anchor"] },
      { title: "Spread", params: ["spread", "twist", "scatter", "drift"] },
      { title: "Output", params: ["level", "polarity", "seed"] },
    ],
    template: '<div class="bv-panel"><h2>Rates</h2><canvas class="org-rates" style="height:26px;width:100%;margin-bottom:6px"></canvas>' +
      '<h2>Motion</h2><canvas class="org-scope" style="height:120px;width:100%"></canvas></div>',
    afterBuild(view) {
      view.org = { hist: Array.from({ length: 10 }, () => []) };
    },
    onState(st, view) {
      if (!view.org) return;
      const bars = units(view, "lock") === 1, unipolar = units(view, "polarity") === 1;
      const rate = view.knobs.get("rate");
      if (rate && bars) rate.value.textContent = BARS[clamp(Math.round(view.value(st, "rate") * 14), 0, 14)];
      let outs = (st && st.outputs) || {};
      let arr = st && st.arrays && st.arrays.rates;
      if (!arr) {  // no live rates: from the knobs
        const f1 = bars ? 0.25 : 0.002 * Math.pow(10000, clamp(view.value(st, "rate"), 0, 1)), sp = view.value(st, "spread") * 2 - 1;
        arr = Array.from({ length: 8 }, (_, k) => clamp(f1 * Math.pow(2, sp * 4 * k / 7), 0.002, 50));
      }
      if (typeof outs.out1 !== "number") {  // no live outputs: preview from the knobs
        const f1 = bars ? 0.25 : 0.002 * Math.pow(10000, clamp(view.value(st, "rate"), 0, 1));
        const sp = view.value(st, "spread") * 2 - 1, tw = view.value(st, "twist") * 2 - 1, lv = view.value(st, "level");
        const now = performance.now() / 1000, o = {};
        let sum = 0;
        arr = [];
        for (let k = 0; k < 8; k++) {
          const hz = clamp(f1 * Math.pow(2, sp * 4 * k / 7), 0.002, 50);
          arr.push(hz);
          const v = wave(now * hz + k * 0.37, tw);
          o["out" + (k + 1)] = unipolar ? (0.5 + 0.5 * v) * lv : v * lv;
          sum += v;
        }
        o.sum = (unipolar ? 0.5 + 0.5 * Math.tanh(1.4 * sum / Math.sqrt(8)) / 0.885 : Math.tanh(1.4 * sum / Math.sqrt(8)) / 0.885) * lv;
        outs = o;
      }
      const ids = ["out1", "out2", "out3", "out4", "out5", "out6", "out7", "out8", "sum", "max"];
      ids.forEach((id, k) => {
        const h = view.org.hist[k];
        if (typeof outs[id] === "number") { h.push(outs[id]); if (h.length > MAX_HISTORY) h.shift(); }
      });
      const rates = arr || [];
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent").trim() || "#bef264";
      const line = css.getPropertyValue("--line"), muted = css.getPropertyValue("--muted");

      // Rate strip: a log axis 0.002 … 50 Hz with a tick per LFO.
      const rs = setup(view.root.querySelector(".org-rates"));
      if (rs) {
        const { g, w, h } = rs;
        const x = (hz) => 4 + ((Math.log(clamp(hz, LO, HI)) - Math.log(LO)) / (Math.log(HI) - Math.log(LO))) * (w - 8);
        g.strokeStyle = line;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(4, h - 6.5); g.lineTo(w - 4, h - 6.5);
        for (const d of [0.01, 0.1, 1, 10]) { g.moveTo(x(d) + 0.5, h - 9); g.lineTo(x(d) + 0.5, h - 4); }
        g.stroke();
        g.fillStyle = muted;
        g.font = "8px system-ui, sans-serif";
        g.textAlign = "center";
        for (const [d, t] of [[0.01, "0.01"], [0.1, "0.1"], [1, "1 Hz"], [10, "10"]]) g.fillText(t, x(d), h - 0.5);
        g.strokeStyle = accent;
        g.lineWidth = 2;
        BleepView.glow(g, accent, 6);
        rates.forEach((hz, k) => {
          g.globalAlpha = 1 - k * 0.08;
          g.beginPath(); g.moveTo(x(hz), 1); g.lineTo(x(hz), h - 9); g.stroke();
        });
        g.globalAlpha = 1; g.shadowBlur = 0;
      }

      // Scope: about four cycles of LFO 1 (as many updates as fit), scrolling.
      const sc = setup(view.root.querySelector(".org-scope"));
      if (!sc) return;
      const { g, w, h } = sc;
      const f1 = rates[0] || 0.2;
      const n = clamp(Math.round((3 / f1) * 30), 60, 300);
      const y = (v) => (unipolar ? h - 3 - v * (h - 6) : h / 2 - v * (h / 2 - 3));
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y(0) + 0.5); g.lineTo(w, y(0) + 0.5); g.stroke();
      const trace = (hist, width, alpha) => {
        const from = Math.max(0, hist.length - n);
        g.globalAlpha = alpha;
        g.lineWidth = width;
        g.beginPath();
        for (let i = from; i < hist.length; i++) {
          const px = w - (hist.length - 1 - i) * (w / (n - 1));
          i > from ? g.lineTo(px, y(hist[i])) : g.moveTo(px, y(hist[i]));
        }
        g.stroke();
      };
      g.strokeStyle = accent;
      BleepView.glow(g, accent, 5);
      for (let k = 7; k >= 0; k--) trace(view.org.hist[k], 1.2, 0.75 - k * 0.06);
      g.strokeStyle = css.getPropertyValue("--text");
      BleepView.glow(g, accent, 12);
      trace(view.org.hist[8], 2.2, 0.9);
      g.globalAlpha = 1; g.shadowBlur = 0;
    },
  });
})();
