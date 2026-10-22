// SPDX-License-Identifier: GPL-3.0-or-later
// Swarm view: the cloud of oscillators, pitch up and pan across. Each voice
// is a glowing dot at its current pitch (gliding, detuned) and pan, sized by
// level, wandering a little with Drift and Detune and leaving a short
// trail, over ghost lines at the stack's chord notes. Live arrays come from
// SwarmModule::liveArrays (pitch and stack in semitones from the root, pan
// −1…1, level); without them the cloud is a preview from Count, Spread and
// Range alone.
(function () {
  "use strict";
  const PC = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const TRAIL = 12;
  const hash = (i) => { const x = Math.sin(i * 12.9898 + 1.3) * 43758.5453; return x - Math.floor(x); };

  /// A preview of the stack (no live arrays): a triad climbing through Range octaves, fanned by Spread.
  function preview(view, st) {
    const n = Math.round(1 + 15 * view.value(st, "count")), range = Math.round(1 + 3 * view.value(st, "range"));
    const spread = view.value(st, "spread"), tri = [0, 4, 7], pitch = [], pan = [], level = [], stack = [];
    for (let k = 0; k < n; k++) {
      const s = tri[k % 3] + 12 * Math.floor((k / 3) % range);
      stack.push(s);
      pitch.push(s * (0.6 + 0.4 * spread));
      pan.push(n > 1 ? ((k / (n - 1)) * 2 - 1) * (0.2 + 0.8 * view.value(st, "width")) : 0);
      level.push(1 - 0.35 * (k / Math.max(1, n - 1)));
    }
    return { pitch, pan, level, stack };
  }

  function draw(view, t) {
    const s = view.sw;
    const cv = view.root.querySelector(".sw-cloud");
    if (!s || !cv || !cv.clientWidth) return;
    const { g, w, h } = BleepView.fit(cv), col = BleepView.theme(view.root), st = s.st;
    const a = st && st.arrays && st.arrays.pitch ? st.arrays : preview(view, st);
    const pitch = a.pitch, pan = a.pan || [], level = a.level || [], stack = a.stack || [];
    const n = pitch.length;
    const drift = view.value(st, "drift"), detune = view.value(st, "detune");
    let lo = Math.min(0, ...stack, ...pitch), hi = Math.max(12, ...stack, ...pitch);
    lo = 12 * Math.floor(lo / 12); hi = 12 * Math.ceil(hi / 12);
    const x0 = 34, X = (p) => x0 + ((p + 1) / 2) * (w - x0 - 10), Y = (sm) => h - 10 - ((sm - lo) / (hi - lo || 1)) * (h - 20);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    // octave grid with note names, stereo centre line, stack notes as ghost lines
    g.font = "9px system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
    const octave = Math.round(view.value(st, "octave") * 8) - 4;
    for (let sm = lo; sm <= hi; sm += 12) {
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x0, Math.round(Y(sm)) + 0.5); g.lineTo(w, Math.round(Y(sm)) + 0.5); g.stroke();
      g.fillStyle = col.muted; g.fillText(PC[0] + (4 + octave + sm / 12), 3, Y(sm));
    }
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(Math.round(X(0)) + 0.5, 0); g.lineTo(Math.round(X(0)) + 0.5, h); g.stroke();
    g.fillStyle = col.muted; g.textAlign = "center"; g.fillText("L", x0 + 8, 8); g.fillText("R", w - 14, 8);
    g.strokeStyle = col.accent; g.globalAlpha = 0.18;
    for (const sm of stack) { g.beginPath(); g.moveTo(x0, Y(sm)); g.lineTo(w, Y(sm)); g.stroke(); }
    g.globalAlpha = 1;
    // the voices
    if (!s.trail || s.trail.length !== n) s.trail = Array.from({ length: n }, () => []);
    const wob = 0.04 + 0.5 * drift + 0.3 * detune;  // semitone / pan wander
    for (let k = 0; k < n; k++) {
      const ph = hash(k) * 6.28, sp = 0.4 + hash(k + 40);
      const px = X(Math.max(-1, Math.min(1, (pan[k] || 0) + 0.06 * drift * Math.sin(t * sp + ph))));
      const py = Y(pitch[k] + wob * 0.5 * Math.sin(t * sp * 1.3 + ph * 2) * (1 + 0.5 * Math.sin(t * 0.3 + ph)));
      const tr = s.trail[k];
      tr.push([px, py]); if (tr.length > TRAIL) tr.shift();
      const lv = Math.min(1, level[k] ?? 1), r = 2.2 + 3.2 * lv, root = k === 0;
      const c = root ? col.accent : col.text;
      g.strokeStyle = c; g.lineWidth = 1.2;
      for (let i = 1; i < tr.length; i++) {
        g.globalAlpha = (i / tr.length) * 0.35 * lv;
        g.beginPath(); g.moveTo(tr[i - 1][0], tr[i - 1][1]); g.lineTo(tr[i][0], tr[i][1]); g.stroke();
      }
      g.globalAlpha = 0.45 + 0.55 * lv;
      BleepView.glow(g, col.accent, root ? 16 : 10);
      g.fillStyle = c; g.beginPath(); g.arc(px, py, root ? r + 1 : r, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1; g.shadowBlur = 0; g.lineWidth = 1;
  }

  BleepViews.register("swarm", {
    width: 860,
    layout: [
      { title: "Pitch", params: ["octave", "coarse", "fine", "glide", "quality", "seed"] },
      { title: "Cloud", params: ["count", "chord", "spread", "range", "pattern", "stack"] },
      { title: "Tone & stereo", params: ["warp", "detune", "drift", "crossfm", "width"] },
    ],
    template: '<div class="bv-panel"><h2>Cloud · pitch up, pan across</h2><canvas class="sw-cloud" style="height:104px"></canvas></div>',
    afterBuild(view) {
      view.sw = { st: null, trail: null };
      BleepView.loop(view.root, (t) => draw(view, t));
    },
    onState(st, view) { if (view.sw) view.sw.st = st; },
  });
})();
