// SPDX-License-Identifier: GPL-3.0-only
// Oscillator view: a scrolling phosphor trace of the waveform the settings make
// (Waveform crossfaded toward Secondary by Morph, with the pulse width; FM with a
// test modulator: linear through zero or clamped at 0 Hz, or exponential), the pitch as Hz and note name,
// and the morph ruler between the two waveforms.
// Mirrors patch/modules/oscillator/dsp/OscillatorDsp.h and common/dsp/OscCore.h.
(function () {
  "use strict";
  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const style = document.createElement("style");
  style.textContent = ".osc-cv{height:128px!important}.osc-panel{padding-bottom:4px}";
  document.head.appendChild(style);

  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id), x = view.value(st, id);
    return p ? p.min + (p.max - p.min) * x : 0;
  };
  const frac = (x) => x - Math.floor(x);
  const WAVES = ["sine", "tri", "saw", "square"];
  function one(phase, k, pw) {
    if (k === 0) return Math.sin(2 * Math.PI * phase);
    if (k === 1) return 1 - 4 * Math.abs(frac(phase + 0.25) - 0.5);
    if (k === 2) return 2 * frac(phase + 0.5) - 1;
    return frac(phase) < pw ? 1 : -1;
  }
  function wave(phase, a, b, morph, pw) {
    const x = one(phase, a, pw), m = Math.min(Math.max(morph, 0), 1);
    return m > 0 && a !== b ? x + m * (one(phase, b, pw) - x) : x;
  }

  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const wa = Math.round(view.units("wave")), wb = Math.round(view.units("wave2"));
    const morph = view.value(st, "morph"), pw = real(view, st, "pw"), fm = view.value(st, "fm");
    const tz = view.value(st, "tzfm") >= 0.5, expo = view.units("fmmode") >= 1;
    const oct = view.units("octave") - 3;
    const pitch = oct + real(view, st, "coarse") / 12 + real(view, st, "fine") / 1200;
    const hz = 261.6256 * Math.pow(2, pitch);
    const midi = 60 + 12 * pitch, nn = Math.round(midi);
    const cents = Math.round((midi - nn) * 100);
    const label = `${NOTES[((nn % 12) + 12) % 12]}${Math.floor(nn / 12) - 1}${cents ? (cents > 0 ? "+" : "") + cents : ""}  ·  ${hz < 1000 ? hz.toFixed(1) : (hz / 1000).toFixed(2) + "k"} Hz`;
    const ruler = 16, top = 6, bot = h - ruler - 4, mid = (top + bot) / 2, amp = (bot - top) / 2 - 2;
    // grid
    g.strokeStyle = th.line; g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= 8; k++) { const x = Math.round(k / 8 * w) + 0.5; g.moveTo(x, top); g.lineTo(x, bot); }
    g.moveTo(0, mid + 0.5); g.lineTo(w, mid + 0.5);
    g.stroke();
    // the trace, scrolling; speed follows the pitch so higher notes visibly run faster
    const cycles = 3.2, speed = 0.25 + 0.18 * (pitch + 3);
    const modRate = 0.8;
    const trace = (lag, alpha, width) => {
      g.beginPath();
      let ph = -(t - lag) * speed;
      const dx = 2;
      for (let x = 0; x <= w; x += dx) {
        const u = x / w;
        // linear FM: the frequency is 1 + 4 depth m(u) (m: a sine test modulator); through zero or clamped at 0
        // exponential FM: 2^(4 depth m(u)), ±4 octaves at full depth
        const mod = Math.sin(2 * Math.PI * (modRate * u - (t - lag) * 0.35));
        let f = expo ? Math.pow(2, 4 * fm * mod) : 1 + 4 * fm * mod;
        if (!expo && !tz) f = Math.max(f, 0);
        ph += cycles * f * dx / w;
        const y = mid - amp * wave(ph, wa, wb, morph, pw);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.globalAlpha = alpha; g.lineWidth = width;
      g.stroke();
    };
    g.strokeStyle = th.accent; g.lineJoin = "round";
    BleepView.glow(g, th.accent, 12);
    trace(0.10, 0.18, 2); trace(0.05, 0.35, 2); trace(0, 1, 2);
    g.shadowBlur = 0; g.globalAlpha = 1;
    g.fillStyle = th.text; g.font = "11px system-ui, sans-serif"; g.textAlign = "right";
    g.fillText(label, w - 6, 14);
    if (fm > 0.001) { g.fillStyle = th.mod; g.textAlign = "left"; g.fillText(`FM ${Math.round(fm * 100)}%${expo ? " exp" : tz ? "" : " (clamped)"}`, 6, 14); }
    // morph ruler: Waveform on the left, Secondary on the right, the morph position as a lit dot
    const ry = h - 9;
    g.font = "9px system-ui, sans-serif";
    g.fillStyle = morph < 0.5 ? th.text : th.muted; g.textAlign = "left"; g.fillText(WAVES[wa] || "", w * 0.1, h - 1);
    g.fillStyle = morph >= 0.5 ? th.text : th.muted; g.textAlign = "right"; g.fillText(WAVES[wb] || "", w * 0.9, h - 1);
    g.strokeStyle = th.line; g.beginPath(); g.moveTo(w * 0.1, ry - 2); g.lineTo(w * 0.9, ry - 2); g.stroke();
    const sx = w * (0.1 + 0.8 * morph);
    BleepView.glow(g, th.accent, 10);
    g.fillStyle = th.accent; g.beginPath(); g.arc(sx, ry - 2, 3.5, 0, 7); g.fill();
    g.shadowBlur = 0;
  }

  BleepViews.register("oscillator", {
    width: 550,
    template: '<div class="bv-panel osc-panel"><h2>Waveform</h2><canvas class="osc-cv"></canvas></div>',
    layout: [
      { title: "Pitch", params: ["octave", "coarse", "fine"] },
      { title: "Waveform", params: ["wave", "wave2", "morph", "pw"] },
      { title: "FM", params: ["fm", "fmmode", "hardsync", "tzfm"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
