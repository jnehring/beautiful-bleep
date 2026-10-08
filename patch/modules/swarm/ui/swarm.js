// SPDX-License-Identifier: MIT
// Swarm view: a pitch map with one dot per oscillator at its current pitch
// (gliding, detuned) over ghost lines at the stack's chord notes, and a
// stereo field with the oscillators placed by pan and level. Live arrays
// come from SwarmModule::liveArrays (pitch and stack in semitones from the root).
(function () {
  "use strict";
  const PC = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return [g, w, h];
  }

  BleepViews.register("swarm", {
    top: true,
    width: 560,
    template: '<div class="bv-panel" style="display:flex;gap:8px">' +
      '<div style="flex:1"><h2>Pitch map</h2><canvas class="sw-map" style="width:100%;height:110px"></canvas></div>' +
      '<div style="width:120px"><h2>Stereo</h2><canvas class="sw-pan" style="width:100%;height:110px"></canvas></div></div>',
    onState(st, view) {
      const a = st && st.arrays;
      if (!a || !a.pitch) return;
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text");
      const pitch = a.pitch, pan = a.pan || [], level = a.level || [], stack = a.stack || [];
      const n = pitch.length;

      // Pitch map: y in semitones from the root, over the stack's range.
      const map = view.root.querySelector(".sw-map");
      if (map && map.clientWidth) {
        const [g, w, h] = canvas(map);
        let lo = Math.min(0, ...stack, ...pitch), hi = Math.max(12, ...stack, ...pitch);
        lo = 12 * Math.floor(lo / 12); hi = 12 * Math.ceil(hi / 12);
        const y = (s) => h - 6 - (s - lo) / (hi - lo || 1) * (h - 12);
        g.strokeStyle = line;
        g.globalAlpha = 0.5;
        for (const s of stack) { g.beginPath(); g.moveTo(28, y(s)); g.lineTo(w, y(s)); g.stroke(); }
        g.globalAlpha = 1;
        g.fillStyle = text;
        g.font = "10px sans-serif";
        g.textBaseline = "middle";
        const pitchKnob = view.value(st, "octave");
        const octave = Math.round(pitchKnob * 8) - 4;
        for (let s = lo; s <= hi; s += 12) g.fillText(PC[0] + (4 + octave + s / 12), 2, y(s));
        for (let k = 0; k < n; k++) {
          const x = 36 + (w - 44) * (n > 1 ? k / (n - 1) : 0.5);
          g.fillStyle = k === 0 ? accent : text;
          g.globalAlpha = 0.35 + 0.65 * Math.min(1, level[k] ?? 1);
          g.beginPath();
          g.arc(x, y(pitch[k]), k === 0 ? 4.5 : 3.5, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }

      // Stereo: x by pan, y by pitch rank, size by level.
      const pc = view.root.querySelector(".sw-pan");
      if (pc && pc.clientWidth) {
        const [g, w, h] = canvas(pc);
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
        for (let k = 0; k < n; k++) {
          const x = w / 2 + (pan[k] || 0) * (w / 2 - 6);
          const yy = 8 + (h - 16) * (n > 1 ? 1 - k / (n - 1) : 0.5);
          g.fillStyle = k === 0 ? accent : text;
          g.beginPath();
          g.arc(x, yy, 1.5 + 3 * Math.min(1, level[k] ?? 1), 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  });
})();
