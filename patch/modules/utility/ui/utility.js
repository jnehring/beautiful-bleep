// SPDX-License-Identifier: MIT
// Utility view: the transfer curve out = f(x * scale X + offset) of the chosen
// mode (through, rectify, fold, quantize in twelfths; sample & hold passes the
// held value) with the comparator threshold, and a live trace of the Out
// signal with the gate it makes. Mirrors patch/modules/utility/dsp/UtilityDsp.h.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".ut-cv{height:136px!important}";
  document.head.appendChild(style);
  const RANGE = 2;
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id), x = view.value(st, id);
    return p.min + (p.max - p.min) * x;
  };
  function fold(v) {
    const t = ((v + 1) / 4) - Math.floor((v + 1) / 4);
    return 1 - 4 * Math.abs(t - 0.5);
  }
  function mode(m, v) {
    switch (m) {
      case 1: return Math.abs(v);
      case 2: return fold(v);
      case 3: return Math.round(v * 12) / 12;
      default: return v;
    }
  }

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const sx = real(view, st, "scalex"), off = real(view, st, "offset"), thr = real(view, st, "threshold");
    const slew = real(view, st, "slew"), m = view.units("mode");
    const size = Math.min(h - 24, w * 0.4), x0 = 10, y0 = 6;
    const X = (v) => x0 + (v + 1) / 2 * size, Y = (v) => y0 + (1 - (v + RANGE) / (2 * RANGE)) * size;
    const clampY = (v) => Math.min(RANGE, Math.max(-RANGE, v));
    g.strokeStyle = th.line; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, size, size);
    g.beginPath();
    g.moveTo(X(0) + 0.5, y0); g.lineTo(X(0) + 0.5, y0 + size);
    for (const v of [-1, 0, 1]) { g.moveTo(x0, Math.round(Y(v)) + 0.5); g.lineTo(x0 + size, Math.round(Y(v)) + 0.5); }
    g.stroke();
    g.setLineDash([3, 3]); g.strokeStyle = th.mod; g.globalAlpha = 0.8;
    g.beginPath(); g.moveTo(x0, Y(thr)); g.lineTo(x0 + size, Y(thr)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    g.strokeStyle = th.accent; g.lineWidth = 2; g.lineJoin = "round";
    BleepView.glow(g, th.accent, 10);
    g.beginPath();
    let prev = null;
    for (let i = 0; i <= 160; i++) {
      const x = -1 + 2 * i / 160, v = m === 4 ? x * sx + off : mode(m, x * sx + off);
      const y = Y(clampY(v));
      if (prev !== null && Math.abs(v - prev) > 1.2 && m === 3) { g.moveTo(X(x), y); } else i ? g.lineTo(X(x), y) : g.moveTo(X(x), y);
      prev = v;
    }
    g.stroke(); g.shadowBlur = 0;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    g.fillText("in X (Y = 0)", x0 + 3, y0 + size - 4);
    g.textAlign = "right"; g.fillText(m === 4 ? "held at each clock" : "out", x0 + size - 3, y0 + 10);
    // live trace
    const hist = view._hist || (view._hist = new Float32Array(200));
    const tx = x0 + size + 24, tw = w - tx - 8;
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath();
    g.moveTo(tx, Math.round(Y(0)) + 0.5); g.lineTo(tx + tw, Math.round(Y(0)) + 0.5); g.stroke();
    g.setLineDash([3, 3]); g.strokeStyle = th.mod; g.beginPath(); g.moveTo(tx, Y(thr)); g.lineTo(tx + tw, Y(thr)); g.stroke(); g.setLineDash([]);
    const n = hist.length;
    g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 10);
    g.beginPath();
    for (let i = 0; i < n; i++) { const x = tx + i / (n - 1) * tw, y = Y(clampY(hist[(view._hi + i) % n])); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    // gate lane
    g.strokeStyle = th.text; g.globalAlpha = 0.55; g.lineWidth = 1.5; g.beginPath();
    const gy1 = y0 + size - 4, gy0 = y0 + size - 16;
    for (let i = 0; i < n; i++) { const x = tx + i / (n - 1) * tw, y = hist[(view._hi + i) % n] > thr ? gy0 : gy1; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.globalAlpha = 1;
    g.fillStyle = th.muted; g.textAlign = "left"; g.fillText("out", tx + 2, y0 + 10);
    g.fillText(`gate > ${thr.toFixed(2)}${slew > 0.001 ? `   slew ${slew.toFixed(2)} s` : ""}`, tx + 2, y0 + size + 9);
  }

  BleepViews.register("utility", {
    template: '<div class="bv-panel"><h2>Transfer</h2><canvas class="ut-cv"></canvas></div>',
    layout: [
      { title: "Mode", params: ["mode"] },
      { title: "Scale and offset", params: ["scalex", "scaley", "offset"] },
      { title: "Output", params: ["slew", "threshold"] },
    ],
    afterBuild(view, custom) {
      view._hi = 0;
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      view._st = st;
      const o = st && st.outputs;
      if (view._hist && o && typeof o.out === "number") {
        view._hist[view._hi] = o.out;
        view._hi = (view._hi + 1) % view._hist.length;
      }
    },
  });
})();
