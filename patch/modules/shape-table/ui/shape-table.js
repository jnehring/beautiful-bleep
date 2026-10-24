// SPDX-License-Identifier: GPL-3.0-only
// Shape Table view: draw the transfer curve with the mouse (65 control points,
// the node's data), pick a curve preset, watch the live operating point (input
// after Drive and Bias → output) and the harmonics a full-scale sine would get.
(function () {
  "use strict";

  const N = 65;
  const PRESETS = [
    ["Linear", (x) => x],
    ["Soft", (x) => Math.tanh(2.2 * x) / Math.tanh(2.2)],
    ["Hard", (x) => Math.max(-1, Math.min(1, 2 * x))],
    ["Fold", (x) => Math.sin(2 * Math.PI * x)],
    ["Stairs", (x) => {
      const s = (x + 1) * 4, k = Math.floor(s), f = s - k;
      const m = f < 0.7 ? 0 : (f - 0.7) / 0.3;
      return Math.max(-1, Math.min(1, (k + m * m * (3 - 2 * m)) / 4 - 1 + 0.125));
    }],
    ["Asym", (x) => (x >= 0 ? Math.tanh(1.8 * x) / Math.tanh(1.8) : Math.max(-0.85, 1.3 * x))],
    ["Rectify", (x) => Math.abs(x) * 2 - 1],
    ["Sine", (x) => Math.sin(0.5 * Math.PI * x)],
  ];
  const presetCurve = (i) => Array.from({ length: N }, (_, k) => Math.max(-1, Math.min(1, PRESETS[i][1](-1 + 2 * k / (N - 1)))));
  const curveOf = (view) => {
    const d = view.node.data;
    return d && Array.isArray(d.curve) && d.curve.length === N ? d.curve.slice() : presetCurve(1);
  };

  // Catmull-Rom through the points, as the module does.
  function sample(c, u) {
    const k = Math.min(Math.floor(u), N - 2), t = u - k;
    const at = (j) => (j < 0 ? 2 * c[0] - c[1] : j > N - 1 ? 2 * c[N - 1] - c[N - 2] : c[j]);
    const y0 = at(k - 1), y1 = at(k), y2 = at(k + 1), y3 = at(k + 2);
    return y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
  }

  BleepViews.register("shape-table", {
    width: 550,
    layout: [
      { title: "Input", params: ["drive", "bias", "edge"] },
      { title: "Output", params: ["mix", "out", "quality", "dcblock"] },
    ],
    template: '<div class="bv-panel" style="display:flex;gap:12px"><div style="flex:none;width:260px"><h2>Curve <span style="float:right;font-weight:normal;text-transform:none">draw on it</span></h2>' +
      '<canvas class="st-curve" style="width:100%;height:200px;cursor:crosshair;touch-action:none"></canvas>' +
      '<div class="st-presets" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px"></div></div>' +
      '<div style="flex:1;min-width:0"><h2>Harmonics <span style="float:right;font-weight:normal;text-transform:none">1–16 · full-scale sine at the current Drive</span></h2>' +
      '<canvas class="st-harm" style="width:100%;height:200px"></canvas></div></div>',
    afterBuild(view, el) {
      const box = el.querySelector(".st-presets");
      PRESETS.forEach(([name], i) => {
        const b = document.createElement("button");
        b.textContent = name;
        b.addEventListener("click", () => {
          view.api.beginGesture();
          view.node.data = { ...(view.node.data || {}), curve: presetCurve(i) };
          view.api.setData(JSON.parse(JSON.stringify(view.node.data)));
        });
        box.append(b);
      });
      const c = el.querySelector(".st-curve");
      let last = null, pending = false;
      const push = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          view.api.setData(JSON.parse(JSON.stringify(view.node.data)));
        });
      };
      const paint = (e) => {
        const r = c.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(-1, Math.min(1, 1 - 2 * (e.clientY - r.top) / r.height));
        const idx = x * (N - 1);
        const curve = curveOf(view);
        if (last === null) curve[Math.round(idx)] = y;
        else {  // fill the points between the last and this position
          const a = Math.min(last.i, idx), b = Math.max(last.i, idx);
          for (let k = Math.ceil(a); k <= Math.floor(b); k++) {
            const t = b === a ? 1 : (k - last.i) / (idx - last.i);
            curve[k] = last.y + (y - last.y) * Math.max(0, Math.min(1, t));
          }
          curve[Math.round(idx)] = y;
        }
        last = { i: idx, y };
        view.node.data = { ...(view.node.data || {}), curve: curve.map((v) => Math.round(v * 1000) / 1000) };
        push();
      };
      c.addEventListener("pointerdown", (e) => {
        c.setPointerCapture(e.pointerId);
        view.api.beginGesture();
        last = null;
        paint(e);
        c.onpointermove = paint;
      });
      c.addEventListener("pointerup", () => { c.onpointermove = null; last = null; });
    },
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const curve = curveOf(view);
      const c = view.root.querySelector(".st-curve");
      if (c && c.clientWidth) {
        const { g, w, h } = BleepView.fit(c);
        const X = (x) => (x + 1) / 2 * w, Y = (y) => h / 2 - y * (h / 2 - 4);
        g.strokeStyle = th.line; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h);
        for (const v of [-1, 1]) { g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.moveTo(X(v), 0); g.lineTo(X(v), h); }
        g.stroke(); g.globalAlpha = 0.3; g.beginPath(); g.moveTo(X(-1), Y(-1)); g.lineTo(X(1), Y(1)); g.stroke(); g.globalAlpha = 1;
        g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 8);
        g.beginPath();
        const M = Math.max(2, Math.floor(w));
        for (let i = 0; i < M; i++) {
          const u = i / (M - 1) * (N - 1), v = Math.max(-1.5, Math.min(1.5, sample(curve, u)));
          i ? g.lineTo(X(-1 + 2 * i / (M - 1)), Y(v)) : g.moveTo(X(-1), Y(v));
        }
        g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
        g.fillStyle = th.text; g.globalAlpha = 0.5;
        curve.forEach((v, k) => { if (k % 4 === 0) { g.beginPath(); g.arc(X(-1 + 2 * k / (N - 1)), Y(v), 2, 0, 6.2832); g.fill(); } });
        g.globalAlpha = 1;
        if (st && typeof st.x === "number") {  // the live operating point
          const px = Math.max(-1, Math.min(1, st.x)), py = Math.max(-1, Math.min(1, st.y));
          g.fillStyle = th.text; BleepView.glow(g, th.accent, 10);
          g.beginPath(); g.arc(X(px), Y(py), 4, 0, 6.2832); g.fill(); g.shadowBlur = 0;
        }
      }
      const hc = view.root.querySelector(".st-harm");
      if (hc && hc.clientWidth) {
        const { g, w, h } = BleepView.fit(hc);
        const hs = (st && st.arrays && st.arrays.harmonics) || [];
        const n = 16, bw = w / n;
        g.strokeStyle = th.line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, h - 14); g.lineTo(w, h - 14); g.stroke(); g.globalAlpha = 1;
        hs.forEach((v, i) => {
          // dB scale from 0 dBFS down to −60 dB
          const db = 20 * Math.log10(Math.max(v, 1e-6)), hh = Math.max(0, Math.min(1, (db + 60) / 60)) * (h - 24);
          g.fillStyle = i === 0 ? th.text : th.accent; g.globalAlpha = i === 0 ? 0.5 : 0.9;
          g.fillRect(i * bw + 3, h - 14 - hh, bw - 6, hh);
          g.globalAlpha = 0.7; g.fillStyle = th.text; g.font = "10px sans-serif"; g.textAlign = "center";
          g.fillText(String(i + 1), i * bw + bw / 2, h - 2);
        });
        g.globalAlpha = 1;
      }
    },
  });
})();
