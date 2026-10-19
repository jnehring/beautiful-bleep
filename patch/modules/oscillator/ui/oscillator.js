// SPDX-License-Identifier: GPL-3.0-or-later
// Oscillator view: a scrolling phosphor trace of the waveform the settings make
// (sine -> triangle -> saw -> square morph with the pulse width, through-zero FM
// with a test modulator), the pitch as Hz and note name, and the shape ruler.
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
  function wave(phase, shape, pw) {
    const sine = Math.sin(2 * Math.PI * phase);
    const tri = 1 - 4 * Math.abs(frac(phase + 0.25) - 0.5);
    const saw = 2 * frac(phase + 0.5) - 1;
    const sq = frac(phase) < pw ? 1 : -1;
    const m = Math.min(Math.max(shape, 0), 1) * 3, i = Math.min(Math.floor(m), 2), t = m - i;
    const w = [sine, tri, saw, sq];
    return w[i] + t * (w[i + 1] - w[i]);
  }

  function draw(view, cv, t) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const shape = view.value(st, "shape"), pw = real(view, st, "pw"), fm = view.value(st, "fm");
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
        // through-zero FM: the frequency is 1 + 4 depth m(u) (m: a sine test modulator)
        const f = 1 + 4 * fm * Math.sin(2 * Math.PI * (modRate * u - (t - lag) * 0.35));
        ph += cycles * f * dx / w;
        const y = mid - amp * wave(ph, shape, pw);
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
    if (fm > 0.001) { g.fillStyle = th.mod; g.textAlign = "left"; g.fillText(`FM ${Math.round(fm * 100)}%`, 6, 14); }
    // shape ruler: the four waves, the morph position as a lit dot
    const ry = h - 9;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    const names = ["sine", "tri", "saw", "square"];
    for (let k = 0; k < 4; k++) g.fillText(names[k], w * (0.1 + 0.8 * k / 3), h - 1);
    g.strokeStyle = th.line; g.beginPath(); g.moveTo(w * 0.1, ry - 2); g.lineTo(w * 0.9, ry - 2); g.stroke();
    const sx = w * (0.1 + 0.8 * shape);
    BleepView.glow(g, th.accent, 10);
    g.fillStyle = th.accent; g.beginPath(); g.arc(sx, ry - 2, 3.5, 0, 7); g.fill();
    g.shadowBlur = 0;
  }

  BleepViews.register("oscillator", {
    template: '<div class="bv-panel osc-panel"><h2>Waveform</h2><canvas class="osc-cv"></canvas></div>',
    layout: [
      { title: "Pitch", params: ["octave", "coarse", "fine"] },
      { title: "Waveform", params: ["shape", "pw"] },
      { title: "Modulation", params: ["fm"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, (t) => draw(view, cv, t));
    },
    onState(st, view) { view._st = st; },
  });
})();
