// SPDX-License-Identifier: MIT
// Function view: the four outputs drawn as in FunctionDsp: cycling, B..D are phase-shifted copies
// of A (Spread × ¼ cycle each); as an envelope they stretch by (1 + Spread) each. A comet runs
// along the traces (a free-running preview), the live output levels are the bars at the right.
(function () {
  "use strict";
  // Inverse of the Rise/Fall range (1 ms .. 10 s, centre 250 ms).
  const skew = Math.log(0.5) / Math.log((0.25 - 0.001) / (10 - 0.001));
  const seconds = (v) => 0.001 + (10 - 0.001) * Math.exp(Math.log(Math.max(v, 1e-6)) / skew);
  const curve = (u, s) => (s >= 0 ? Math.pow(u, 1 + 3 * s) : 1 - Math.pow(1 - u, 1 - 3 * s));
  const frac = (x) => x - Math.floor(x);

  BleepViews.register("function", {
    top: true,
    layout: [
      { title: "Mode", params: ["cycle", "sync"] },
      { title: "Slope", params: ["rise", "fall", "shape"] },
      { title: "Outputs", params: ["spread"] },
    ],
    template: '<div class="bv-panel"><h2>Slope · A B C D</h2><canvas class="fn-slope" style="height:130px"></canvas></div>',
    afterBuild(view) {
      const S = view.fn = { st: null, t0: 0 };
      BleepView.loop(view.root, (t) => {
        const c = view.root.querySelector(".fn-slope");
        if (!c || !c.clientWidth) return;
        const th = BleepView.theme(view.root), { g, w, h } = BleepView.fit(c);
        const st = S.st, v = (id) => view.value(st, id);
        const rise = seconds(v("rise")), fall = seconds(v("fall"));
        const shape = v("shape") * 2 - 1, spread = v("spread"), cyc = view.units("cycle") === 1;
        const r = rise / (rise + fall);
        const barW = 34, pw = w - barW - 6, padY = 12, base = h - padY, top = padY;
        const y = (u) => base - u * (base - top);
        // x extent: one cycle, or the longest (D) envelope
        const stretch = (k) => Math.pow(1 + spread, k);
        const span = cyc ? 1 : stretch(3);
        const val = (k, x) => {  // x in 0..1 of the window
          if (cyc) { const p = frac(x + k * spread * 0.25); return curve(p < r ? p / r : 1 - (p - r) / (1 - r), shape); }
          const u = (x * span) / stretch(k);
          return u >= 1 ? 0 : curve(u < r ? u / r : 1 - (u - r) / (1 - r), shape);
        };
        g.strokeStyle = th.line; g.lineWidth = 1; g.globalAlpha = 0.6;
        g.beginPath();
        for (let i = 1; i < 8; i++) { const x = Math.round((i / 8) * pw) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
        g.moveTo(0, base + 0.5); g.lineTo(pw, base + 0.5); g.moveTo(0, top + 0.5); g.lineTo(pw, top + 0.5);
        g.stroke(); g.globalAlpha = 1;
        // playhead: cycles through the window; the envelope view repeats with a short rest
        const period = cyc ? 3.2 : 4.2, ph = Math.min(1, frac(t / period) * (cyc ? 1 : 1.18));
        const px = ph * pw;
        const traces = [3, 2, 1, 0];
        for (const k of traces) {
          const a = 1 - k * 0.22;
          const path = (x0, x1) => { g.beginPath(); for (let x = x0; x <= x1; x++) x > x0 ? g.lineTo(x, y(val(k, x / pw))) : g.moveTo(x, y(val(k, x / pw))); };
          g.lineCap = "round"; g.strokeStyle = th.accent;
          g.globalAlpha = a * 0.3; g.lineWidth = 1.3; path(0, pw); g.stroke();
          if (k === 0) {  // area under A up to the playhead
            const grad = g.createLinearGradient(0, top, 0, base);
            grad.addColorStop(0, th.accent); grad.addColorStop(1, "transparent");
            g.save(); g.globalAlpha = 0.2; g.fillStyle = grad; path(0, px); g.lineTo(px, base); g.lineTo(0, base); g.closePath(); g.fill(); g.restore();
          }
          BleepView.glow(g, th.accent, k === 0 ? 10 : 5);
          g.lineWidth = k === 0 ? 2.4 : 1.6;
          const tail = Math.round(pw * 0.35), seg = 6;
          for (let x = Math.max(0, Math.floor(px - tail)); x < px; x += seg) {
            g.globalAlpha = a * Math.pow(1 - (px - x) / tail, 1.5);
            path(x, Math.min(px, x + seg)); g.stroke();
          }
          g.shadowBlur = 0;
        }
        g.globalAlpha = 1;
        BleepView.glow(g, th.accent, 14);
        g.fillStyle = th.text;
        for (const k of [0, 1, 2, 3]) {
          if (k && spread < 0.02) break;
          g.globalAlpha = 1 - k * 0.22;
          g.beginPath(); g.arc(px, y(val(k, px / pw)), k ? 3 : 4.5, 0, Math.PI * 2); g.fill();
        }
        g.shadowBlur = 0; g.globalAlpha = 1;
        // live output levels
        const o = (st && st.outputs) || {};
        ["a", "b", "c", "d"].forEach((id, k) => {
          const x = pw + 8 + k * 7, u = typeof o[id] === "number" ? Math.max(0, Math.min(1, o[id])) : 0;
          g.fillStyle = th.line; g.fillRect(x, top, 4, base - top);
          g.fillStyle = th.accent; g.globalAlpha = 1 - k * 0.2; g.fillRect(x, y(u), 4, base - y(u)); g.globalAlpha = 1;
        });
        g.fillStyle = th.muted; g.font = "10px system-ui, sans-serif";
        g.fillText(cyc ? "one cycle" : "envelope", 8, 11);
      });
    },
    onState(st, view) { if (view.fn) view.fn.st = st; },
  });
})();
