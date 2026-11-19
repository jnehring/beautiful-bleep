// SPDX-License-Identifier: GPL-3.0-only
// Oscillator view: a scrolling phosphor trace of the waveform the settings make
// (Waveform crossfaded toward Secondary by Morph, with the pulse width; FM with a
// test modulator: linear through zero or clamped at 0 Hz, exponential, or phase modulation; the sub oscillator
// added at its level), the pitch as Hz and note name
// (Tuned: Octave, Coarse and Fine from C4; Free: Coarse and Fine in Hz),
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
  // an exponential (Hz) knob: min · (max / min)^x
  const hzOf = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id), x = view.value(st, id);
    return p ? p.min * Math.pow(p.max / p.min, x) : 0;
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
  // the sub: the carrier's phase slowed down by 2 or 4, a square or a sine
  function sub(phase, n, sine) {
    const s = frac(phase / n);
    return sine ? Math.sin(2 * Math.PI * s) : s < 0.5 ? 1 : -1;
  }

  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const wa = Math.round(view.units("wave")), wb = Math.round(view.units("wave2"));
    const morph = view.value(st, "morph"), pw = real(view, st, "pw"), fm = view.value(st, "fmdepth");
    // FM Mode: Linear, Phase, Exponential
    const mode = Math.round(view.units("fmmode")), pm = mode === 1, expo = mode === 2;
    const tz = view.value(st, "tzfm") >= 0.5;
    const subLevel = view.value(st, "sublevel"), subN = view.units("suboct") >= 1 ? 4 : 2, subSine = view.units("subwave") >= 1;
    const drift = view.value(st, "drift");
    // Tuned: Octave + Coarse (semitones) + Fine (cents) from C4; Free: Coarse + Fine in Hz
    const free = view.units("freepitch") >= 1;
    const oct = view.units("octave") - 3;
    const hz = free ? Math.max(0, hzOf(view, st, "freehz") + real(view, st, "freefine"))
      : 261.6256 * Math.pow(2, oct + real(view, st, "coarse") / 12 + real(view, st, "fine") / 1200);
    const pitch = Math.log2(Math.max(hz, 0.01) / 261.6256);
    const midi = 60 + 12 * pitch, nn = Math.round(midi);
    const cents = Math.round((midi - nn) * 100);
    const label = hz <= 0 ? "0 Hz" : `${NOTES[((nn % 12) + 12) % 12]}${Math.floor(nn / 12) - 1}${cents ? (cents > 0 ? "+" : "") + cents : ""}  ·  ${hz < 1000 ? hz.toFixed(1) : (hz / 1000).toFixed(2) + "k"} Hz`;
    const ruler = 16, top = 6, bot = h - ruler - 4, mid = (top + bot) / 2;
    const amp = ((bot - top) / 2 - 2) / (1 + subLevel);   // with the sub the sum reaches 1 + Sub Level
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
        // exponential FM: 2^(4 depth m(u)), ±4 octaves at full depth; phase modulation: the waveform is read
        // ±depth cycles away from the carrier, whose frequency stays
        // drift: a slow wobble of the speed, exaggerated so it shows
        const mod = Math.sin(2 * Math.PI * (modRate * u - (t - lag) * 0.35));
        let f = pm ? 1 : expo ? Math.pow(2, 4 * fm * mod) : 1 + 4 * fm * mod;
        if (!expo && !pm && !tz) f = Math.max(f, 0);
        if (drift > 0) f *= 1 + 0.08 * drift * Math.sin(2 * Math.PI * (0.7 * u + 0.13 * t)) * Math.sin(0.37 * t);
        ph += cycles * f * dx / w;
        let v = wave(pm ? ph + fm * mod : ph, wa, wb, morph, pw);
        if (subLevel > 0) v += subLevel * sub(ph, subN, subSine);
        const y = mid - amp * v;
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
    const tags = [];
    if (fm > 0.001) tags.push(`${pm ? "PM" : "FM"} ${Math.round(fm * 100)}%${expo ? " exp" : pm || tz ? "" : " (clamped)"}`);
    if (subLevel > 0.001) tags.push(`Sub ${subN === 4 ? "−2" : "−1"} ${Math.round(subLevel * 100)}%`);
    if (drift > 0.001) tags.push(`Drift ${Math.round(drift * 100)}%`);
    if (tags.length) { g.fillStyle = th.mod; g.textAlign = "left"; g.fillText(tags.join("  ·  "), 6, 14); }
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
      { title: "Pitch", params: ["freepitch", "octave", "coarse", "fine", "freehz", "freefine", "drift"] },
      { title: "Waveform", params: ["wave", "wave2", "morph", "pw"] },
      { title: "Sub", params: ["sublevel", "suboct", "subwave"] },
      { title: "FM", params: ["fmdepth", "fmmode", "tzfm"] },
      { title: "Sync", params: ["hardsync", "phase"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
