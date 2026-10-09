// SPDX-License-Identifier: MIT
// Dual Osc view (doc/specs/modules/dual-oscillator.md §5): a scope of A, B and Out
// over two cycles of B (live arrays from the module), and the folder's
// transfer curve at the current Fold and Symmetry with a dot at the input
// level. The curve mirrors DualOscDsp::folderParams and dsp::Folder::transfer.
(function () {
  "use strict";
  const STYLE = `
    .dosc-row { display: flex; gap: 8px; }
    .dosc-row > div { flex: 1; min-width: 0; }
    .dosc-legend { display: flex; gap: 10px; font-size: 10px; color: var(--muted); margin-top: 2px; }
    .dosc-legend i { display: inline-block; width: 10px; height: 2px; vertical-align: middle; margin-right: 3px; }
  `;

  // dsp::fold::curve: soft sine fold blended with a hard reflection.
  function curve(x, shape) {
    const soft = Math.sin(0.5 * Math.PI * x);
    const m = x + 1 - 4 * Math.floor((x + 1) / 4);
    const hard = 1 - Math.abs(m - 2);
    return (1 - shape) * soft + shape * hard;
  }
  /// dsp::Folder::transfer with DualOscDsp::folderParams(fold, symmetry).
  function transfer(x, fold, sym) {
    const tap = 1 + 3 * fold, lo = Math.floor(tap), frac = tap - lo;
    const n = frac > 0 ? Math.min(lo + 1, 6) : lo;
    const first = 1 - Math.min(1, 4 * fold);
    const y = [x + sym];
    for (let k = 1; k <= n; k++) y[k] = curve(y[k - 1] + (k === 2 ? 0.5 * sym : 0), k === 1 ? first : 0.5);
    return frac > 0 ? y[lo] + frac * (y[lo + 1] - y[lo]) : y[lo];
  }

  function canvas2d(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function colours(view) {
    const css = getComputedStyle(view.root);
    const v = (k, d) => css.getPropertyValue(k).trim() || d;
    return { accent: v("--accent", "#2dd4bf"), line: v("--line", "#333"), muted: v("--muted", "#888"), text: v("--text", "#ddd") };
  }

  function drawScope(view, st) {
    const c = view.root.querySelector(".dosc-scope");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = canvas2d(c);
    const col = colours(view);
    g.strokeStyle = col.line;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    const arrays = (st && st.arrays) || view.doscArrays || {};
    if (st && st.arrays) view.doscArrays = st.arrays;
    const traces = [["scopeB", col.muted, 1], ["scopeA", col.text, 1], ["scopeOut", col.accent, 2]];
    for (const [key, colour, width] of traces) {
      const a = arrays[key];
      if (!a || !a.length) continue;
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.beginPath();
      for (let i = 0; i < a.length; i++) {
        const x = (i / (a.length - 1)) * w, y = h / 2 - Math.max(-1.2, Math.min(1.2, a[i])) * (h / 2 - 4) / 1.2;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.lineWidth = 1;
  }

  function drawFold(view, st) {
    const c = view.root.querySelector(".dosc-fold");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = canvas2d(c);
    const col = colours(view);
    const fold = view.value(st, "fold"), sym = 2 * view.value(st, "symmetry") - 1;
    const range = 1 + 11 * fold;  // the mix (±1) times the drive
    const X = (x) => ((x / range) * 0.5 + 0.5) * w, Y = (y) => h / 2 - y * (h / 2 - 4);
    g.strokeStyle = col.line;
    g.beginPath();
    g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5);
    g.moveTo(w / 2 + 0.5, 0); g.lineTo(w / 2 + 0.5, h);
    g.stroke();
    g.strokeStyle = col.accent;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= w; i++) {
      const x = (i / w - 0.5) * 2 * range;
      i ? g.lineTo(i, Y(transfer(x, fold, sym))) : g.moveTo(i, Y(transfer(x, fold, sym)));
    }
    g.stroke();
    g.lineWidth = 1;
    if (st && typeof st.foldIn === "number") {
      const x = Math.min(st.foldIn, range);
      g.fillStyle = col.text;
      g.beginPath();
      g.arc(X(x), Y(transfer(x, fold, sym)), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  BleepViews.register("dual-osc", {
    width: 560,
    template: `
      <div class="bv-panel dosc-row">
        <div><h2>Scope</h2><canvas class="dosc-scope" style="height:84px"></canvas>
          <div class="dosc-legend"><span><i style="background:var(--text)"></i>A</span>
          <span><i style="background:var(--muted)"></i>B</span><span><i style="background:var(--accent)"></i>Out</span></div></div>
        <div style="flex:0 0 150px"><h2>Fold curve</h2><canvas class="dosc-fold" style="height:84px"></canvas></div>
      </div>`,
    afterBuild(view) {
      if (!document.getElementById("dosc-style")) {
        const s = document.createElement("style");
        s.id = "dosc-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      requestAnimationFrame(() => { drawScope(view, null); drawFold(view, null); });
    },
    onState(st, view) {
      drawScope(view, st);
      drawFold(view, st);
    },
    onRefresh(view) { drawFold(view, null); },
  });
})();
