// SPDX-License-Identifier: MIT
// Chord Osc view: the chord's name (with the slash bass and, in Scale mode,
// the key and Roman degree), a three-octave keyboard with the sounding
// voices lit (the root stronger) and the note names of Pitch 1–4. Live
// values come from ChordOscModule::liveValues; the suffixes mirror the chord
// table in patch/common/dsp/Chords.h.
(function () {
  "use strict";
  const SUFFIX = ["", "5", "", "m", "dim", "aug", "sus2", "sus4", "6", "m6", "7", "maj7", "m7", "m7♭5", "dim7",
    "m(maj7)", "7sus4", "add9", "m(add9)", "6/9", "maj9", "m9", "9", "4ths", "11", "m11", "13", "7♭9", "7♯9",
    "aug7", "7♭5", "maj7♯11"];
  const PC = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"];
  const BLACK = [1, 3, 6, 8, 10];
  const noteName = (semis) => PC[((semis % 12) + 12) % 12] + (4 + Math.floor(semis / 12));
  const param = (view, id) => view.type.params.find((x) => x.id === id);
  const choice = (view, st, id) => {
    const p = param(view, id);
    return p ? Math.round(view.value(st, id) * (p.steps - 1)) : 0;
  };

  BleepViews.register("chord-osc", {
    top: true,
    template: '<div class="bv-panel"><h2 class="co-name" style="display:flex;justify-content:space-between;gap:8px">' +
      '<span class="co-chord">–</span><span class="co-key" style="opacity:.7;font-weight:normal"></span></h2>' +
      '<canvas class="co-keys" style="height:56px"></canvas>' +
      '<div class="co-notes" style="font-size:11px;opacity:.8;margin-top:4px;font-variant-numeric:tabular-nums"></div></div>',
    onState(st, view) {
      if (!st || typeof st.count !== "number") return;
      const root = view.root;
      const count = Math.max(1, Math.min(6, st.count | 0));
      const pitches = [];
      for (let k = 1; k <= count; k++) pitches.push(Math.round((st["voicePitch" + k] || 0) * 12));
      const scaleMode = choice(view, st, "mode") === 1;

      // Name: the quality found, or in Scale mode the stack name for clusters.
      let name;
      if (st.quality >= 0 && st.quality < SUFFIX.length) name = PC[st.rootPc] + SUFFIX[st.quality];
      else {
        const stack = param(view, "stack");
        name = PC[st.rootPc] + " " + (stack ? stack.choices[choice(view, st, "stack")] : "?");
      }
      if (st.bassPc !== st.rootPc) name += "/" + PC[st.bassPc];
      root.querySelector(".co-chord").textContent = (st.latched ? "🔒 " : "") + name;
      let keyText = "";
      if (scaleMode) {
        const sc = param(view, "scale");
        const scaleName = sc ? sc.choices[choice(view, st, "scale")] : "";
        let deg = ROMAN[st.degree] || String(st.degree + 1);
        if (st.quality === 2 || st.quality === 5) deg = deg.toUpperCase();  // major, augmented
        keyText = PC[choice(view, st, "key")] + " " + scaleName + " · " + deg + (scaleName === "Chromatic" ? " (clusters)" : "");
      }
      root.querySelector(".co-key").textContent = keyText;
      const sorted = pitches.slice().sort((a, b) => a - b);
      root.querySelector(".co-notes").textContent =
        [0, 1, 2, 3].map((j) => (j + 1) + ":" + noteName(sorted[Math.min(j, sorted.length - 1)])).join("  ");

      // Keyboard: three octaves from the C below the chord's centre.
      const c = root.querySelector(".co-keys");
      if (!c.clientWidth) return;
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const css = getComputedStyle(view.root);
      const centre = (sorted[0] + sorted[sorted.length - 1]) / 2;
      const low = 12 * Math.floor((centre - 18) / 12);
      const whites = 21, kw = w / whites;
      const rootSemis = pitches[0];
      const lit = new Map();
      for (const p of pitches) lit.set(p, p === rootSemis ? 2 : Math.max(lit.get(p) || 0, 1));
      const fill = (s) => (lit.get(s) === 2 ? css.getPropertyValue("--accent") : lit.get(s) ? css.getPropertyValue("--text") : null);
      let x = 0;
      const blackAt = [];
      for (let s = low; s < low + 36; s++) {
        const pc = ((s % 12) + 12) % 12;
        if (BLACK.includes(pc)) { blackAt.push([s, x]); continue; }
        g.fillStyle = fill(s) || "#f4f4f5";
        g.globalAlpha = fill(s) ? 0.9 : 0.85;
        g.fillRect(x + 0.5, 0, kw - 1, h);
        x += kw;
      }
      g.globalAlpha = 1;
      for (const [s, bx] of blackAt) {
        g.fillStyle = fill(s) || "#27272a";
        g.fillRect(bx - kw * 0.3, 0, kw * 0.6, h * 0.6);
      }
      g.fillStyle = css.getPropertyValue("--text");
      g.font = "10px sans-serif";
      g.textBaseline = "bottom";
      g.fillText(noteName(low), 2, h - 2);
    },
  });
})();
