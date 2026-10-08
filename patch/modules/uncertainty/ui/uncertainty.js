// SPDX-License-Identifier: MIT
// Uncertainty view (specs/modules/uncertainty.md §5): a 4-second scope per
// output; the Quantized lanes show their levels (note names in semitone
// mode); next to Stored the distribution of the current Shape and
// Distribution (computed here, as UncertaintyDsp::shapeStored) and a scatter
// plot of successive stored values, which shows Correlation.
(function () {
  "use strict";
  const LANES = [["fluct1", "Fluct 1", -1, 1], ["fluct2", "Fluct 2", -1, 1], ["quant1", "Quant 1", 0, 1],
                 ["quant2", "Quant 2", 0, 1], ["stored", "Stored", -1, 1], ["integrated", "Integrated", -1, 1]];
  const INTERVALS = [0, 1, 2, 5, 7, 12];
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const LANE_H = 30, SIDE = 92;
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  };
  const units = (view, st, id) => { const p = view.type.params.find((x) => x.id === id); return p.min + view.value(st, id) * (p.max - p.min); };
  const smoothstep = (u) => u * u * (3 - 2 * u);
  const invSmoothstep = (y) => 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);
  function shapeStored(u, shape, dist) {
    if (shape === 1) u = invSmoothstep(u);
    else if (shape === 2) u = smoothstep(u);
    return 2 * Math.pow(Math.min(1, Math.max(0, u)), Math.pow(4, -dist)) - 1;
  }
  /// Levels of a Quantized output, top value for scaling.
  function levels(view, q) {
    const bits = setting(view, `q${q}bits`), iv = INTERVALS[setting(view, `q${q}interval`)] || 0, n = 1 << bits;
    return Array.from({ length: n }, (_, l) => (iv ? (l * iv) / 12 : l / (n - 1)));
  }

  function draw(view, st) {
    const c = view.unc && view.unc.canvas;
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim();
    const muted = css.getPropertyValue("--muted").trim();
    const a = (st && st.arrays) || {};
    const lw = w - SIDE - 6;
    g.font = "9px system-ui, sans-serif";
    LANES.forEach(([key, label, lo0, hi0], k) => {
      const top = k * LANE_H + 2, bot = top + LANE_H - 4;
      let lo = lo0, hi = hi0, lv = null;
      if (key.startsWith("quant")) {
        lv = levels(view, key === "quant1" ? 1 : 2);
        hi = Math.max(1e-6, lv[lv.length - 1]);
        lo = 0;
      }
      const y = (v) => bot - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (bot - top);
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath();
      if (lv && lv.length <= 16) for (const v of lv) { g.moveTo(0, y(v) + 0.5); g.lineTo(lw, y(v) + 0.5); }
      else { g.moveTo(0, y((lo + hi) / 2) + 0.5); g.lineTo(lw, y((lo + hi) / 2) + 0.5); }
      g.stroke();
      const arr = a[key];
      if (arr && arr.length) {
        g.strokeStyle = accent; g.lineWidth = 1.5;
        g.beginPath();
        arr.forEach((v, i) => { const x = (i / (arr.length - 1)) * lw; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
        g.stroke();
      }
      g.fillStyle = muted;
      g.fillText(label, 3, top + 9);
      if (lv && INTERVALS[setting(view, `q${key === "quant1" ? 1 : 2}interval`)]) {  // note names of the lowest and highest level
        const name = (v) => { const s = Math.round(v * 12); return NAMES[((s % 12) + 12) % 12] + (4 + Math.floor(s / 12)); };
        g.fillText(name(lv[0]), lw - 24, bot);
        g.fillText(name(lv[lv.length - 1]), lw - 24, top + 9);
      }
    });

    // Stored: distribution (analytic) and scatter of (value, next value).
    const x0 = w - SIDE, shape = setting(view, "shape"), dist = units(view, st, "distribution");
    const bins = new Array(24).fill(0);
    for (let i = 0; i < 2400; i++) bins[Math.min(23, Math.floor(((shapeStored((i + 0.5) / 2400, shape, dist) + 1) / 2) * 24))]++;
    const peak = Math.max(...bins), hTop = 4, hBot = 4 + 2 * LANE_H - 8;
    g.fillStyle = accent; g.globalAlpha = 0.7;
    bins.forEach((b, i) => {
      const bh = (b / peak) * (hBot - hTop);
      g.fillRect(x0 + (i / 24) * SIDE, hBot - bh, SIDE / 24 - 1, bh);
    });
    g.globalAlpha = 1;
    const cur = a.stored && a.stored.length ? a.stored[a.stored.length - 1] : null;
    if (cur !== null) {
      g.fillStyle = muted;
      g.fillRect(x0 + ((cur + 1) / 2) * SIDE - 1, hTop, 2, hBot - hTop);
    }
    g.fillStyle = muted; g.fillText("distribution", x0, hBot + 9);
    const sTop = 2 * LANE_H + 8, size = Math.min(SIDE, 3 * LANE_H - 16);
    g.strokeStyle = line;
    g.strokeRect(x0 + 0.5, sTop + 0.5, size, size);
    const sc = a.scatter;
    if (sc && sc.length > 1) {
      g.fillStyle = accent;
      for (let i = 0; i + 1 < sc.length; i++) {
        if (sc[i] === 0 && sc[i + 1] === 0) continue;  // not filled yet
        const px = x0 + ((sc[i] + 1) / 2) * size, py = sTop + size - ((sc[i + 1] + 1) / 2) * size;
        g.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
    }
    g.fillStyle = muted; g.fillText("value → next", x0, sTop + size + 10);
  }

  BleepViews.register("uncertainty", {
    top: true,
    width: 400,
    template: `<div class="bv-panel" style="flex:1 1 100%"><canvas class="unc-scope" style="width:100%;height:${LANES.length * LANE_H + 4}px"></canvas></div>`,
    afterBuild(view, el) {
      view.unc = { canvas: el.querySelector("canvas") };
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) { draw(view, st); },
    onRefresh(view) { draw(view, null); },
  });
})();
