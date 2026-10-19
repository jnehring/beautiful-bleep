// SPDX-License-Identifier: GPL-3.0-or-later
// LFO view: one cycle of the current wave (Pulse Width, Phase and Polarity applied) drawn as a
// phosphor trace; a bright comet follows the live phase (st.phase, else it free-runs) and
// the cycle fades out behind it. Mirrors LfoDsp::value.
(function () {
  "use strict";
  const frac = (x) => x - Math.floor(x);
  const rnd = (k, s) => 2 * frac(Math.sin(k * 12.9898 + s * 78.233 + 4.1) * 43758.5453) - 1;  // preview only
  function value(wave, p, pw, cycle, seed) {
    switch (wave) {
      case 1: return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      case 2: return 2 * p - 1;
      case 3: return 1 - 2 * p;
      case 4: return p < pw ? 1 : -1;
      case 5: return rnd(cycle, seed);
      case 6: { const k = 0.5 - 0.5 * Math.cos(p * Math.PI); return (1 - k) * rnd(cycle, seed) + k * rnd(cycle + 1, seed); }
      default: return Math.sin(p * 2 * Math.PI);
    }
  }
  const WAVES = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Random Step", "Random Smooth"];

  BleepViews.register("lfo", {
    top: true,
    layout: [
      { title: "Wave", params: ["wave", "pw", "phase"] },
      { title: "Rate", params: ["rate", "sync", "fade"] },
      { title: "Output", params: ["polarity", "seed"] },
    ],
    template: '<div class="bv-panel"><h2>Wave</h2><canvas class="lfo-wave" style="height:120px"></canvas></div>',
    afterBuild(view) {
      const S = view.lfo = { st: null, phase: 0, last: 0, prev: 0, cyc: 0 };
      BleepView.loop(view.root, (t) => {
        const c = view.root.querySelector(".lfo-wave");
        if (!c || !c.clientWidth) return;
        const th = BleepView.theme(view.root), { g, w, h } = BleepView.fit(c);
        const st = S.st, v = (id) => view.value(st, id);
        const wave = view.units("wave"), unipolar = view.units("polarity") === 1;
        const pw = 0.05 + 0.9 * v("pw"), offset = v("phase"), seed = view.units("seed");
        const padY = 14, y = (x) => {
          const u = unipolar ? 0.5 + 0.5 * x : x;
          return unipolar ? h - padY - u * (h - 2 * padY) : h / 2 - u * (h / 2 - padY);
        };
        const cycles = wave >= 5 ? 8 : 1;  // random waves: show several cycles, else the trace is one flat step
        const at = (x) => { const s = (x / w) * cycles + offset; return value(wave, frac(s), pw, Math.floor(s), seed); };
        // live phase, or a free-running one
        let ph = st && typeof st.phase === "number" ? st.phase : null;
        if (ph === null) { S.phase = frac(S.phase + (t - S.last) * 0.25); ph = S.phase; }
        S.last = t;
        if (ph < S.prev - 0.5) S.cyc = (S.cyc + 1) % cycles;
        S.prev = ph; S.cyc %= cycles;
        // grid
        g.strokeStyle = th.line; g.lineWidth = 1; g.globalAlpha = 0.6;
        g.beginPath();
        for (let i = 1; i < 8; i++) { const x = Math.round((i / 8) * w) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
        const zero = Math.round(y(unipolar ? -1 : 0)) + 0.5;
        g.moveTo(0, zero); g.lineTo(w, zero);
        if (unipolar) { const top = Math.round(y(1)) + 0.5; g.moveTo(0, top); g.lineTo(w, top); }
        g.stroke(); g.globalAlpha = 1;
        // faint full cycle
        const path = (x0, x1) => { g.beginPath(); for (let x = x0; x <= x1; x++) x > x0 ? g.lineTo(x, y(at(x))) : g.moveTo(x, y(at(x))); };
        g.strokeStyle = th.accent; g.globalAlpha = 0.28; g.lineWidth = 1.5; path(0, w); g.stroke(); g.globalAlpha = 1;
        // area under the trace up to the playhead
        const px = Math.round(((S.cyc + ph) / cycles) * w);
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, th.accent); grad.addColorStop(1, "transparent");
        g.save(); g.globalAlpha = 0.18; g.fillStyle = grad;
        path(0, px); g.lineTo(px, zero); g.lineTo(0, zero); g.closePath(); g.fill(); g.restore();
        // comet: the trace just behind the playhead, fading with distance
        const tail = Math.round(w * 0.3), seg = 6;
        BleepView.glow(g, th.accent, 10);
        g.lineWidth = 2.4; g.lineCap = "round"; g.strokeStyle = th.accent;
        for (let x = Math.max(0, px - tail); x < px; x += seg) {
          g.globalAlpha = Math.pow(1 - (px - x) / tail, 1.6);
          path(x, Math.min(px, x + seg)); g.stroke();
        }
        g.globalAlpha = 1;
        // playhead
        g.shadowBlur = 0;
        g.strokeStyle = th.text; g.globalAlpha = 0.25; g.beginPath(); g.moveTo(px + 0.5, 0); g.lineTo(px + 0.5, h); g.stroke(); g.globalAlpha = 1;
        BleepView.glow(g, th.accent, 16);
        g.fillStyle = th.text;
        g.beginPath(); g.arc(px, y(at(px)), 4.5, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = th.muted; g.font = "10px system-ui, sans-serif";
        g.fillText(WAVES[wave] + (unipolar ? " · unipolar" : ""), 8, 12);
      });
    },
    onState(st, view) { if (view.lfo) view.lfo.st = st; },
  });
})();
