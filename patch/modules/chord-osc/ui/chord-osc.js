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

  function pitchesOf(view, st) {
    if (st && typeof st.count === "number") {
      const count = Math.max(1, Math.min(6, st.count | 0)), out = [];
      for (let k = 1; k <= count; k++) out.push(Math.round((st["voicePitch" + k] || 0) * 12));
      return { pitches: out, live: true };
    }
    // No live chord yet: a stacked-thirds preview with the Voices count (not the real chord).
    const n = Math.round(1 + 5 * view.value(st, "voices")), tri = [0, 4, 7, 12, 16, 19];
    return { pitches: tri.slice(0, n), live: false };
  }

  function draw(view, t) {
    const cv = view.root.querySelector(".co-keys");
    if (!cv || !cv.clientWidth) return;
    const { g, w, h } = BleepView.fit(cv), c = BleepView.theme(view.root);
    const st = view.co.st, { pitches, live } = pitchesOf(view, st);
    const sorted = pitches.slice().sort((a, b) => a - b);
    const rootSemis = pitches[0], kh = Math.round(h * 0.3), top = h - kh;
    const centre = (sorted[0] + sorted[sorted.length - 1]) / 2;
    const low = 12 * Math.floor((centre - 18) / 12), whites = 21, kw = w / whites;
    const pos = new Map();  // semitone → {x, black}
    let wi = 0;
    for (let s = low; s < low + 36; s++) {
      const pc = ((s % 12) + 12) % 12;
      if (BLACK.includes(pc)) pos.set(s, { x: wi * kw, black: true });
      else { pos.set(s, { x: wi * kw + kw / 2, black: false, left: wi * kw }); wi++; }
    }
    const lit = new Map();
    for (const p of pitches) lit.set(p, p === rootSemis ? 2 : Math.max(lit.get(p) || 0, 1));
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, top);
    // faint octave guides
    g.strokeStyle = c.line; g.globalAlpha = 0.4;
    for (let s = low; s < low + 36; s += 12) { const p = pos.get(s); g.beginPath(); g.moveTo(p.left + 0.5, 0); g.lineTo(p.left + 0.5, top); g.stroke(); }
    g.globalAlpha = 1;
    // white keys, then black keys
    for (const [s, p] of pos) if (!p.black) {
      g.fillStyle = lit.has(s) ? c.accent : "#c9cdd4"; g.globalAlpha = lit.has(s) ? 0.95 : 0.85;
      g.fillRect(p.left + 0.5, top, kw - 1, kh);
    }
    g.globalAlpha = 1;
    for (const [s, p] of pos) if (p.black) {
      g.fillStyle = lit.has(s) ? c.accent : "#1d2026";
      g.fillRect(p.x - kw * 0.3, top, kw * 0.6, kh * 0.62);
    }
    // the voices: glowing beams rising from their keys, the root tallest, with a gentle shimmer
    const level = (k) => (k === 0 ? 1 : 0.62 + 0.08 * Math.sin(t * 2 + k));
    const bx = new Map();
    for (let k = 0; k < pitches.length; k++) {
      const p = pos.get(pitches[k]);
      if (!p) continue;
      const x = p.x, hgt = (top - 8) * level(k) * (live ? 1 : 0.75);
      const gr = g.createLinearGradient(0, top, 0, top - hgt);
      gr.addColorStop(0, c.accent); gr.addColorStop(1, c.accent + "55");
      BleepView.glow(g, c.accent, k === 0 ? 14 : 8);
      g.strokeStyle = gr; g.lineWidth = k === 0 ? 4 : 2.5; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, top - hgt); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = c.text; g.beginPath(); g.arc(x, top - hgt, k === 0 ? 2.8 : 2, 0, 6.3); g.fill();
      bx.set(k, [x, top - hgt]);
    }
    g.lineCap = "butt";
    // a faint outline joining the beam tips (the chord's shape)
    const tips = [...bx.entries()].sort((a, b) => a[1][0] - b[1][0]).map((e) => e[1]);
    g.strokeStyle = c.text; g.globalAlpha = 0.25; g.lineWidth = 1;
    g.beginPath(); tips.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = c.muted; g.font = "9px system-ui, sans-serif"; g.textBaseline = "bottom";
    for (let s = low; s < low + 36; s += 12) g.fillText(noteName(s), pos.get(s).left + 3, h - 2);
  }

  function texts(view, st) {
    const root = view.root, { pitches, live } = pitchesOf(view, st);
    const scaleMode = choice(view, st, "mode") === 1;
    let name = "–", keyText = "";
    if (live) {
      if (st.quality >= 0 && st.quality < SUFFIX.length) name = PC[st.rootPc] + SUFFIX[st.quality];
      else {
        const stack = param(view, "stack");
        name = PC[st.rootPc] + " " + (stack ? stack.choices[choice(view, st, "stack")] : "?");
      }
      if (st.bassPc !== st.rootPc) name += "/" + PC[st.bassPc];
      if (scaleMode) {
        const sc = param(view, "scale");
        const scaleName = sc ? sc.choices[choice(view, st, "scale")] : "";
        let deg = ROMAN[st.degree] || String(st.degree + 1);
        if (st.quality === 2 || st.quality === 5) deg = deg.toUpperCase();  // major, augmented
        keyText = PC[choice(view, st, "key")] + " " + scaleName + " · " + deg + (scaleName === "Chromatic" ? " (clusters)" : "");
      }
    } else name = "chord preview";
    root.querySelector(".co-chord").textContent = (live && st.latched ? "🔒 " : "") + name;
    root.querySelector(".co-key").textContent = keyText;
    const sorted = pitches.slice().sort((a, b) => a - b);
    root.querySelector(".co-notes").textContent = sorted.map((p) => noteName(p)).join("  ");
  }

  BleepViews.register("chord-osc", {
    width: 900,
    layout: [
      { title: "Pitch", params: ["octave", "tune", "glide", "seed"] },
      { title: "Chord", params: ["mode", "chord", "stack", "key", "scale"] },
      { title: "Voicing", params: ["inversion", "voicing", "voices", "rootLevel"] },
      { title: "Tone", params: ["shape", "pw", "detune"] },
      { title: "Output", params: ["stereo", "fm"] },
    ],
    template: '<div class="bv-panel"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px">' +
      '<span class="co-chord" style="font-size:20px;font-weight:600;color:var(--accent)">–</span>' +
      '<span class="co-key" style="color:var(--muted);font-size:12px"></span>' +
      '<span class="co-notes" style="margin-left:auto;font-size:12px;color:var(--text);font-variant-numeric:tabular-nums"></span></div>' +
      '<canvas class="co-keys" style="height:100px"></canvas></div>',
    afterBuild(view) {
      view.co = { st: null };
      requestAnimationFrame(() => texts(view, null));
      BleepView.loop(view.root, (t) => draw(view, t));
    },
    onState(st, view) {
      if (!view.co) return;
      view.co.st = st;
      texts(view, st);
    },
    onRefresh(view) { if (view.co) texts(view, view.co.st); },
  });
})();
