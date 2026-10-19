// SPDX-License-Identifier: GPL-3.0-or-later
// Tuner view (doc/specs/modules/tuner.md §5): the note name large on the left with its
// octave and the cents error, a needle over a −50 … +50 cent arc whose green zone is the
// In Tune window, the heard frequency and the frequency of the note it is aiming at,
// and a strip below with the last few seconds of the error. The reading stays on the
// screen, dimmed, after the sound stops.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".tn-cv{height:170px!important}";
  document.head.appendChild(style);
  const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  const N = 150;  // ~5 s of history at the view's 30 updates a second
  const noteName = (midi, flats) => (flats ? FLAT : SHARP)[((midi % 12) + 12) % 12];
  const octaveOf = (midi) => Math.floor(midi / 12) - 1;
  const polar = (cx, cy, r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    const m = view.tn;
    if (!w || !h || !m) return;
    const th = BleepView.theme(view.root);
    const live = m.heard, have = m.have;
    const flats = view.units("names") === 1;
    const tol = view._st ? view.value(view._st, "tolerance") : 5;
    const ref = view._st ? view.value(view._st, "reference") : 440;
    g.clearRect(0, 0, w, h);
    const stripH = 34, topH = h - stripH - 6;

    // --- needle gauge (right) ---
    const cx = w * 0.64, cy = topH - 6, R = Math.min(topH - 18, w * 0.3);
    const a0 = -60, a1 = 60, ang = (c) => a0 + (a1 - a0) * ((Math.max(-50, Math.min(50, c)) + 50) / 100);
    const arc = (r, from, to, color, lw) => {
      g.beginPath();
      g.arc(cx, cy, r, ((from - 90) * Math.PI) / 180, ((to - 90) * Math.PI) / 180);
      g.strokeStyle = color; g.lineWidth = lw; g.lineCap = "round"; g.stroke();
    };
    arc(R, a0, a1, th.line, 5);
    if (have) arc(R, ang(-tol), ang(tol), live ? "#4ade80" : th.muted, 5);
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let c = -50; c <= 50; c += 10) {
      const major = c % 50 === 0 || c === 0;
      const [x1, y1] = polar(cx, cy, R - 6, ang(c)), [x2, y2] = polar(cx, cy, R - (major ? 14 : 10), ang(c));
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokeStyle = th.muted; g.lineWidth = 1; g.stroke();
      if (major) {
        const [tx, ty] = polar(cx, cy, R - 24, ang(c));
        g.fillStyle = th.muted; g.fillText(c > 0 ? "+" + c : String(c), tx, ty);
      }
    }
    if (have) {
      const inTune = live && Math.abs(m.shown) <= tol;
      const col = inTune ? "#4ade80" : th.accent;
      const [nx, ny] = polar(cx, cy, R - 4, ang(m.shown));
      g.globalAlpha = live ? 1 : 0.35;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny);
      g.strokeStyle = col; g.lineWidth = 3; g.lineCap = "round";
      BleepView.glow(g, col, inTune ? 12 : 4); g.stroke(); g.shadowBlur = 0;
      g.globalAlpha = 1;
    }
    g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fillStyle = th.text; g.fill();

    // --- note name (left) ---
    g.globalAlpha = have ? (live ? 1 : 0.4) : 0.25;
    g.fillStyle = have && live && Math.abs(m.shown) <= tol ? "#4ade80" : th.text;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    const name = have ? noteName(m.midi, flats) : "–";
    g.font = "bold 64px system-ui, sans-serif";
    g.fillText(name, 14, topH - 40);
    const nameW = g.measureText(name).width;
    g.font = "18px system-ui, sans-serif";
    if (have) g.fillText(String(octaveOf(m.midi)), 18 + nameW, topH - 18);
    g.globalAlpha = 1;
    g.fillStyle = th.muted; g.font = "12px system-ui, sans-serif";
    const cents = have ? (m.shown >= 0 ? "+" : "−") + Math.abs(m.shown).toFixed(1) + " ct" : "";
    g.fillText(cents, 16, topH - 20);
    const heardHz = have ? m.hz.toFixed(m.hz < 100 ? 2 : 1) + " Hz" : "";
    const aimHz = have ? (ref * Math.pow(2, (m.midi - 69) / 12)).toFixed(2) + " Hz" : "";
    g.fillText(heardHz, 16, topH + 0);
    g.fillStyle = th.line; g.textAlign = "right";
    if (have) g.fillText("aim " + aimHz, w - 10, topH + 0);

    // --- history strip ---
    const left = 10, right = 10, top = h - stripH, pw = w - left - right;
    const Y = (c) => top + stripH * (0.5 - Math.max(-50, Math.min(50, c)) / 100);
    g.fillStyle = th.accent; g.globalAlpha = 0.12;
    g.fillRect(left, Y(tol), pw, Y(-tol) - Y(tol)); g.globalAlpha = 1;
    g.fillStyle = th.line; g.fillRect(left, Math.round(Y(0)), pw, 1);
    g.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      const k = (m.at + i) % N, v = m.hist[k];
      if (Number.isNaN(v)) { pen = false; continue; }
      const x = left + (pw * i) / (N - 1), y = Y(v);
      pen ? g.lineTo(x, y) : g.moveTo(x, y);
      pen = true;
    }
    g.strokeStyle = th.accent; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
  }

  BleepViews.register("tuner", {
    template: '<div class="bv-panel"><h2>Tuner</h2><canvas class="tn-cv"></canvas></div>',
    layout: [
      { title: "Tuning", params: ["reference", "tolerance", "names"] },
      { title: "Reading", params: ["damping", "guard"] },
      { title: "Range", params: ["low", "high"] },
    ],
    afterBuild(view, custom) {
      view.tn = { hist: new Float32Array(N).fill(NaN), at: 0, shown: 0, midi: 69, hz: 0, heard: false, have: false };
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      view._st = st;
      const m = view.tn;
      if (!m || !st) return;
      m.hz = st.hz || 0;
      m.midi = typeof st.midi === "number" ? st.midi : 69;
      m.heard = !!st.heard;
      m.have = !!st.have;
      // the needle eases towards the reading
      const c = typeof st.cents === "number" ? st.cents : 0;
      m.shown += (c - m.shown) * 0.6;
      m.hist[m.at] = m.heard ? c : NaN;
      m.at = (m.at + 1) % N;
    },
  });
})();
