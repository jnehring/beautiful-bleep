// SPDX-License-Identifier: GPL-3.0-only
// Attenuverter view: one transfer line per channel, out = in x scale + offset,
// limited by the Clip mode (off, soft knee past 0.8, hard +-1). A dot sits where
// the live Out is (an unpatched row's input is 1). Mirrors AttenuverterDsp.h.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".at-cv{height:108px!important}";
  document.head.appendChild(style);
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id);
    return p.min + (p.max - p.min) * view.value(st, id);
  };
  function clip(x, mode) {
    if (mode === 1) { const a = Math.abs(x); return a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2)); }
    return mode === 2 ? Math.max(-1, Math.min(1, x)) : x;
  }
  const RANGE = 2;
  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st, mode = view.units("clip");
    const o = (st && st.outputs) || {};
    const gap = 10, cw = (w - gap * 3) / 4, size = Math.min(cw, h - 16), top = 4;
    for (let r = 0; r < 4; r++) {
      const sc = real(view, st, "scale" + (r + 1)), off = real(view, st, "offset" + (r + 1));
      const x0 = r * (cw + gap) + (cw - size) / 2;
      const X = (v) => x0 + (v + 1) / 2 * size, Y = (v) => top + (1 - (v + RANGE) / (2 * RANGE)) * size;
      const cy = (v) => Math.max(-RANGE, Math.min(RANGE, v));
      g.strokeStyle = th.line; g.lineWidth = 1; g.strokeRect(x0 + 0.5, top + 0.5, size, size);
      g.beginPath(); g.moveTo(X(0) + 0.5, top); g.lineTo(X(0) + 0.5, top + size);
      for (const v of [-1, 0, 1]) { g.moveTo(x0, Math.round(Y(v)) + 0.5); g.lineTo(x0 + size, Math.round(Y(v)) + 0.5); }
      g.stroke();
      g.strokeStyle = th.accent; g.lineWidth = 2; g.lineJoin = "round"; BleepView.glow(g, th.accent, 9);
      g.beginPath();
      for (let i = 0; i <= 40; i++) { const x = -1 + i / 20, y = Y(cy(clip(x * sc + off, mode))); i ? g.lineTo(X(x), y) : g.moveTo(X(x), y); }
      g.stroke(); g.shadowBlur = 0;
      const out = o["out" + (r + 1)];
      if (typeof out === "number" && Math.abs(sc) > 0.02) {
        const x = Math.max(-1, Math.min(1, (out - off) / sc));  // the input that makes this output
        BleepView.glow(g, th.text, 12); g.fillStyle = th.text; g.beginPath(); g.arc(X(x), Y(cy(out)), 3.5, 0, 7); g.fill(); g.shadowBlur = 0;
      }
      g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
      g.fillText(`CH ${r + 1}`, x0 + size / 2, h - 3);
    }
  }
  BleepViews.register("attenuverter", {
    width: 530,
    template: '<div class="bv-panel"><h2>Transfer lines</h2><canvas class="at-cv"></canvas></div>',
    layout: [
      { title: "Ch 1", params: ["scale1", "offset1"], columns: true },
      { title: "Ch 2", params: ["scale2", "offset2"], columns: true },
      { title: "Ch 3", params: ["scale3", "offset3"], columns: true },
      { title: "Ch 4", params: ["scale4", "offset4"], columns: true },
      { title: "Limit", params: ["clip"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
