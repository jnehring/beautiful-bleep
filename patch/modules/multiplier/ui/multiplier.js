// SPDX-License-Identifier: GPL-3.0-only
// Multiplier view: the surface of each section, out = (x + bias X) * (y + bias Y)
// * gain, as a heat map over x, y in -1..1 (accent positive, modulation colour
// negative) with the zero lines glowing where the biases put them. Section 2
// takes Out 1 as its X when X2 is unpatched. Mirrors MultiplierDsp.h.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".mu-grid{display:flex;gap:8px;flex-wrap:nowrap}.mu-grid .bv-panel{flex:1 1 0}.mu-cv{height:132px!important}";
  document.head.appendChild(style);
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id);
    return p.min + (p.max - p.min) * view.value(st, id);
  };
  const N = 22;

  function drawOne(view, cv, st, k) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const bx = real(view, st, "biasx" + k), by = real(view, st, "biasy" + k), gain = real(view, st, "gain" + k);
    const size = Math.min(w, h), x0 = (w - size) / 2, cell = size / N;
    const maxv = Math.max(2 * 2 * Math.abs(gain), 0.5);  // (|x|+|b|) max 2 each at gain
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -1 + 2 * (i + 0.5) / N, y = 1 - 2 * (j + 0.5) / N;
        const v = (x + bx) * (y + by) * gain;
        g.fillStyle = v >= 0 ? th.accent : th.mod;
        g.globalAlpha = Math.min(1, Math.pow(Math.abs(v) / (Math.abs(gain) * 1.2 + 0.001), 0.8)) * 0.9;
        g.fillRect(x0 + i * cell, j * cell, cell + 0.5, cell + 0.5);
      }
    }
    g.globalAlpha = 1;
    g.strokeStyle = th.line; g.lineWidth = 1; g.strokeRect(x0 + 0.5, 0.5, size - 1, size - 1);
    // zero lines: x = -bias X, y = -bias Y
    g.strokeStyle = th.text; g.lineWidth = 1.5; BleepView.glow(g, th.text, 8);
    const zx = x0 + (-bx + 1) / 2 * size, zy = (1 - (-by + 1) / 2) * size;
    g.beginPath();
    if (zx >= x0 && zx <= x0 + size) { g.moveTo(zx, 0); g.lineTo(zx, size); }
    if (zy >= 0 && zy <= size) { g.moveTo(x0, zy); g.lineTo(x0 + size, zy); }
    g.stroke(); g.shadowBlur = 0;
    g.fillStyle = th.text; g.font = "9px system-ui, sans-serif"; g.textAlign = "left";
    g.fillText("X", x0 + size - 10, size - 4); g.fillText("Y", x0 + 4, 11);
  }

  BleepViews.register("multiplier", {
    parts: [{ id: "section-1", name: "Section 1", select: ".mu-grid > .bv-panel:nth-child(1)" }, { id: "section-2", name: "Section 2", select: ".mu-grid > .bv-panel:nth-child(2)" }],
    template: '<div class="mu-grid"><div class="bv-panel"><h2>Section 1: X1 x Y1</h2><canvas class="mu-cv" data-k="1"></canvas></div>' +
              '<div class="bv-panel"><h2>Section 2: X2 x Y2</h2><canvas class="mu-cv" data-k="2"></canvas></div></div>',
    side: true,
    layout: [
      { title: "Section 1", params: ["biasx1", "biasy1", "gain1"] },
      { title: "Section 2", params: ["biasx2", "biasy2", "gain2"] },
      { title: "Quality", params: ["oversampling"] },
    ],
    afterBuild(view, custom) {
      view._cvs = [...custom.querySelectorAll("canvas")];
      view._key = "";
    },
    onState(st, view) {
      if (!view._cvs) return;
      const key = ["biasx1", "biasy1", "gain1", "biasx2", "biasy2", "gain2"].map((id) => view.value(st, id).toFixed(3)).join();
      if (key === view._key) return;
      view._key = key;
      view._cvs.forEach((cv) => drawOne(view, cv, st, cv.dataset.k));
    },
  });
})();
