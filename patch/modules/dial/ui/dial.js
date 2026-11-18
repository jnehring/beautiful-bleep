// SPDX-License-Identifier: GPL-3.0-only
// Dial view (doc/specs/modules/dial.md §5): the curve from the dial's position
// (left to right) to Out (−1 at the bottom, +1 at the top), with Min and Max as
// lines and the Steps as a staircase of detents; a dot sits at the dial's
// position and a mark on the edge at the live Out. Then Value as a normal knob,
// the range and the feel. Mirrors DialDsp.h.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".dl-cv{width:100%;height:130px!important;display:block}";
  document.head.appendChild(style);

  const BEND = 6;  // kDialCurveBend
  function curve(v, c) {
    const k = (Math.min(1, Math.max(0, c)) - 0.5) * 2 * BEND;
    return Math.abs(k) < 1e-3 ? v : Math.expm1(k * v) / Math.expm1(k);
  }
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id);
    return p.min + (p.max - p.min) * view.value(st, id);
  };

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const min = real(view, st, "min"), max = real(view, st, "max"), c = view.value(st, "curve");
    const pos = Math.min(1, Math.max(0, view.value(st, "value")));
    const steps = view.units("steps");
    const stepped = (v) => (steps >= 2 ? Math.round(v * (steps - 1)) / (steps - 1) : v);
    const out = (v) => min + (max - min) * curve(stepped(v), c);

    const padL = 34, padR = 8, padT = 6, padB = 6;
    const pw = w - padL - padR, ph = h - padT - padB;
    const X = (v) => padL + v * pw, Y = (u) => padT + (1 - (Math.max(-1, Math.min(1, u)) + 1) / 2) * ph;

    // Frame and the 0 line.
    g.strokeStyle = th.line; g.lineWidth = 1;
    g.strokeRect(padL + 0.5, padT + 0.5, pw - 1, ph - 1);
    g.globalAlpha = 0.5;
    g.beginPath(); g.moveTo(padL, Math.round(Y(0)) + 0.5); g.lineTo(padL + pw, Math.round(Y(0)) + 0.5); g.stroke();
    g.globalAlpha = 1;

    // Min and Max: dashed lines with their values on the left.
    g.font = "10px system-ui, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    g.setLineDash([3, 3]); g.strokeStyle = th.muted;
    const labels = [["Max", max], ["Min", min]];
    const near = Math.abs(Y(max) - Y(min)) < 11;
    labels.forEach(([name, u], i) => {
      const y = Math.round(Y(u)) + 0.5;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke();
      // When the two lines nearly meet, push the labels apart (Max above, Min below, whichever is higher).
      const up = (name === "Max") === (max >= min);
      const ly = near ? (Y(u) + (up ? -5 : 5)) : Y(u);
      g.fillStyle = th.muted;
      g.fillText((u >= 0 ? "+" : "−") + Math.abs(u).toFixed(2), padL - 4, Math.max(padT + 4, Math.min(padT + ph - 4, ly)));
    });
    g.setLineDash([]);

    // The curve: dim and continuous under the steps, bright on its own.
    const N = Math.max(2, Math.floor(pw));
    const line = (f) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) { const v = i / N, x = X(v), y = Y(f(v)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    };
    const smooth = (v) => min + (max - min) * curve(v, c);
    g.lineJoin = "round";
    if (steps >= 2) {
      g.strokeStyle = th.text; g.globalAlpha = 0.25; g.lineWidth = 1; line(smooth); g.globalAlpha = 1;
      // Staircase: each detent holds from half a step before it to half a step after.
      g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 9);
      g.beginPath();
      for (let i = 0; i < steps; i++) {
        const a = Math.max(0, (i - 0.5) / (steps - 1)), b = Math.min(1, (i + 0.5) / (steps - 1));
        const y = Y(smooth(i / (steps - 1)));
        i ? g.lineTo(X(a), y) : g.moveTo(X(a), y);
        g.lineTo(X(b), y);
      }
      g.stroke(); g.shadowBlur = 0;
      g.fillStyle = th.accent;
      for (let i = 0; i < steps; i++) {
        const v = i / (steps - 1);
        g.beginPath(); g.arc(X(v), Y(smooth(v)), 2.5, 0, 7); g.fill();
      }
    } else {
      g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 9);
      line(smooth); g.shadowBlur = 0;
    }
    g.lineWidth = 1;

    // The dial's position: a faint vertical line and a dot on the curve.
    g.strokeStyle = th.text; g.globalAlpha = 0.25;
    g.beginPath(); g.moveTo(Math.round(X(pos)) + 0.5, padT); g.lineTo(Math.round(X(pos)) + 0.5, padT + ph); g.stroke();
    g.globalAlpha = 1;
    BleepView.glow(g, th.text, 12); g.fillStyle = th.text;
    g.beginPath(); g.arc(X(pos), Y(out(pos)), 3.5, 0, 7); g.fill(); g.shadowBlur = 0;

    // The live Out (after Smooth): a small mark on the right edge.
    const o = st && st.outputs && st.outputs.out;
    if (typeof o === "number") {
      const y = Y(o), x = padL + pw;
      g.fillStyle = th.text;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y - 4); g.lineTo(x + 6, y + 4); g.closePath(); g.fill();
    }
  }

  BleepViews.register("dial", {
    width: 640,
    template: '<div class="bv-panel"><h2>Curve</h2><canvas class="dl-cv"></canvas></div>',
    layout: [
      { title: "Dial", params: ["value"] },
      { title: "Range", params: ["min", "max", "curve"] },
      { title: "Feel", params: ["steps", "smooth"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
