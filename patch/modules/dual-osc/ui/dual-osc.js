// SPDX-License-Identifier: GPL-3.0-only
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

  // The naive waves behind OscCore::morph (sine, triangle, saw, square) at phase u in 0..1.
  const WAVE = [
    (u) => Math.sin(2 * Math.PI * u),
    (u) => 4 * Math.abs(((u + 0.75) % 1) - 0.5) - 1,
    (u) => 2 * ((u + 0.5) % 1) - 1,
    (u, pw) => (u < pw ? 1 : -1),
  ];
  function morph(u, shape, pw) {
    const m = Math.min(1, Math.max(0, shape)) * 3, i = Math.min(2, Math.floor(m)), t = m - i;
    const a = WAVE[i](u, pw), b = WAVE[i + 1](u, pw);
    return a + t * (b - a);
  }
  /// Two cycles of B from the knobs (no sync or FM): A, B, and the folded mix.
  function modelScope(view, st) {
    const v = (id) => view.value(st, id), N = 160;
    const semis = (o, t, f) => (Math.round(v(o) * 8) - 4) * 12 + (24 * v(t) - 12) + (200 * v(f) - 100) / 100;
    const ratio = Math.pow(2, (semis("octaveA", "tuneA", "fineA") - semis("octaveB", "tuneB", "fineB")) / 12);
    const fold = v("fold"), sym = 2 * v("symmetry") - 1, bal = v("balance"), pwA = 0.05 + 0.9 * v("widthA");
    const drive = 1 + 11 * fold;
    const A = [], B = [], O = [];
    for (let i = 0; i < N; i++) {
      const ub = ((2 * i) / N) % 1, ua = ((2 * i * ratio) / N) % 1;
      const a = morph(ua, v("shapeA"), pwA), b = morph(ub, v("shapeB"), 0.5), mix = a + bal * (b - a);
      A.push(a); B.push(b); O.push(Math.max(-1.2, Math.min(1.2, transfer(mix * drive, fold, sym))));
    }
    return { scopeA: A, scopeB: B, scopeOut: O };
  }

  function drawScope(view, st) {
    const c = view.root.querySelector(".dosc-scope");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c), col = BleepView.theme(view.root);
    if (st && st.arrays) view.doscArrays = st.arrays;
    const live = view.doscArrays && view.doscArrays.scopeOut;
    const arrays = live ? view.doscArrays : modelScope(view, st);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col.line; g.globalAlpha = 0.6;
    g.beginPath();
    for (let i = 1; i < 8; i++) { g.moveTo(Math.round((i * w) / 8) + 0.5, 0); g.lineTo(Math.round((i * w) / 8) + 0.5, h); }
    g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    g.globalAlpha = 1;
    const traces = [["scopeB", col.muted, 1.2, 0, [3, 3]], ["scopeA", col.text, 1.2, 0, []], ["scopeOut", col.accent, 2.2, 10, []]];
    for (const [key, colour, width, blur, dash] of traces) {
      const a = arrays[key];
      if (!a || !a.length) continue;
      g.strokeStyle = colour; g.lineWidth = width; g.setLineDash(dash);
      if (blur) BleepView.glow(g, colour, blur);
      g.beginPath();
      for (let i = 0; i < a.length; i++) {
        const x = (i / (a.length - 1)) * w, y = h / 2 - Math.max(-1.2, Math.min(1.2, a[i])) * (h / 2 - 5) / 1.2;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0; g.setLineDash([]);
    }
    g.lineWidth = 1;
  }

  function drawFold(view, st) {
    const c = view.root.querySelector(".dosc-fold");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c), col = BleepView.theme(view.root);
    const fold = view.value(st, "fold"), sym = 2 * view.value(st, "symmetry") - 1;
    const range = 1 + 11 * fold;  // the mix (±1) times the drive
    const X = (x) => ((x / range) * 0.5 + 0.5) * w, Y = (y) => h / 2 - y * (h / 2 - 5);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col.line;
    g.beginPath();
    g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5);
    g.moveTo(w / 2 + 0.5, 0); g.lineTo(w / 2 + 0.5, h);
    g.stroke();
    // the region the mix (±1) actually reaches, brighter than the rest of the curve
    const gx0 = X(-1), gx1 = X(1);
    g.fillStyle = col.accent; g.globalAlpha = 0.08; g.fillRect(gx0, 0, gx1 - gx0, h); g.globalAlpha = 1;
    g.strokeStyle = col.accent; g.lineWidth = 2;
    BleepView.glow(g, col.accent, 8);
    g.beginPath();
    for (let i = 0; i <= w; i++) {
      const x = (i / w - 0.5) * 2 * range;
      i ? g.lineTo(i, Y(transfer(x, fold, sym))) : g.moveTo(i, Y(transfer(x, fold, sym)));
    }
    g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
    if (st && typeof st.foldIn === "number") {
      const x = Math.min(st.foldIn, range);
      g.fillStyle = col.text;
      g.beginPath();
      g.arc(X(x), Y(transfer(x, fold, sym)), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  BleepViews.register("dual-osc", {
    parts: [{ id: "scope", name: "Scope", select: ".dosc-row > div:nth-child(1)" }, { id: "fold", name: "Fold curve", select: ".dosc-row > div:nth-child(2)" }],
    width: 840,
    layout: [
      { title: "Osc A", params: ["octaveA", "tuneA", "fineA", "shapeA", "widthA"] },
      { title: "Osc B", params: ["octaveB", "tuneB", "fineB", "shapeB", "bTrack", "bRange"] },
      { title: "Cross", params: ["balance", "fmDepth", "sync", "fmMode"] },
      { title: "Folder & out", params: ["fold", "symmetry", "drift", "width", "quality", "seed"] },
    ],
    template: `
      <div class="bv-panel dosc-row">
        <div><h2>Scope · two cycles of B</h2><canvas class="dosc-scope" style="height:80px"></canvas>
          <div class="dosc-legend"><span><i style="background:var(--text)"></i>A</span>
          <span><i style="background:var(--muted)"></i>B</span><span><i style="background:var(--accent)"></i>Out</span></div></div>
        <div style="flex:0 0 190px"><h2>Fold curve</h2><canvas class="dosc-fold" style="height:80px"></canvas></div>
      </div>`,
    afterBuild(view) {
      if (!document.getElementById("dosc-style")) {
        const s = document.createElement("style");
        s.id = "dosc-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.dosc = { st: null };
      BleepView.loop(view.root, () => { drawScope(view, view.dosc.st); drawFold(view, view.dosc.st); });
    },
    onState(st, view) { if (view.dosc) view.dosc.st = st; },
  });
})();
