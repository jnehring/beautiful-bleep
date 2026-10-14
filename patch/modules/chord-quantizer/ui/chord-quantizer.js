// SPDX-License-Identifier: MIT
// Chord Quantizer view (doc/specs/modules/chord-quantizer.md §5): the chord's
// name (and the Harmony Master's chord in Follow), a two-octave keyboard
// with each voice as a numbered dot and the previous chord faintly (Voice
// Leading), and in Diatonic the key's seven chords: clicking one previews
// it on the keyboard (no state change).
(function () {
  "use strict";
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
  // patch/common/dsp/Chords.h, table order: [suffix, intervals].
  const CHORDS = [
    ["", [0]], ["5", [0, 7]], ["", [0, 4, 7]], ["m", [0, 3, 7]], ["dim", [0, 3, 6]], ["aug", [0, 4, 8]],
    ["sus2", [0, 2, 7]], ["sus4", [0, 5, 7]], ["6", [0, 4, 7, 9]], ["m6", [0, 3, 7, 9]], ["7", [0, 4, 7, 10]],
    ["maj7", [0, 4, 7, 11]], ["m7", [0, 3, 7, 10]], ["m7♭5", [0, 3, 6, 10]], ["dim7", [0, 3, 6, 9]],
    ["m(maj7)", [0, 3, 7, 11]], ["7sus4", [0, 5, 7, 10]], ["add9", [0, 4, 7, 14]], ["m(add9)", [0, 3, 7, 14]],
    ["6/9", [0, 4, 7, 9, 14]], ["maj9", [0, 4, 7, 11, 14]], ["m9", [0, 3, 7, 10, 14]], ["9", [0, 4, 7, 10, 14]],
    ["4ths", [0, 5, 10, 15]], ["11", [0, 4, 7, 10, 14, 17]], ["m11", [0, 3, 7, 10, 14, 17]], ["13", [0, 4, 7, 10, 14, 21]],
    ["7♭9", [0, 4, 7, 10, 13]], ["7♯9", [0, 4, 7, 10, 15]], ["aug7", [0, 4, 8, 10]], ["7♭5", [0, 4, 6, 10]],
    ["maj7♯11", [0, 4, 7, 11, 18]],
  ];
  // Scale stacks (Chords.h ScaleStack): scale steps above the degree.
  const STACKS = [[0], [0, 4], [0, 2, 4], [0, 1, 4], [0, 3, 4], [0, 2, 4, 5], [0, 2, 4, 6], [0, 2, 4, 8], [0, 2, 4, 6, 8], [0, 3, 6, 9]];
  const STACK_CHROMATIC = [0, 1, 2, 6, 7, 8, 10, 17, 22, 23];  // table quality on the Chromatic scale
  // A pitch-class ring (C at the top): the scale as a glowing polygon, the chord inside it,
  // the root ringed, and a fading glow on the notes just played. Shared by the pitch modules.
  const pitchRing = window.BleepPitchRing || (window.BleepPitchRing = function (canvas, th, o) {
    const { g, w, h } = BleepView.fit(canvas);
    if (w < 24 || h < 24) return;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 15, TAU = Math.PI * 2;
    const P = (pc, r) => { const a = pc * Math.PI / 6 - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const has = (m, pc) => ((m >> pc) & 1) === 1;
    g.lineWidth = 1; g.strokeStyle = th.line;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.globalAlpha = 0.45; g.beginPath(); g.arc(cx, cy, R * 0.5, 0, TAU); g.stroke(); g.globalAlpha = 1;
    const poly = (mask, fill, stroke, lw, blur, r) => {
      const pcs = []; for (let i = 0; i < 12; i++) if (has(mask, i)) pcs.push(i);
      if (pcs.length < 2) return;
      g.beginPath();
      pcs.forEach((pc, i) => { const [x, y] = P(pc, r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath();
      g.globalAlpha = fill; g.fillStyle = stroke; g.fill();
      g.globalAlpha = 1; g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = "round";
      BleepView.glow(g, stroke, blur); g.stroke(); g.shadowBlur = 0;
    };
    poly(o.scale, 0.1, th.accent, 1.5, 8, R);
    if (o.chord) poly(o.chord, 0.3, th.text, 1.5, 10, R * 0.86);
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const NM = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    for (let pc = 0; pc < 12; pc++) {
      const [x, y] = P(pc, R), heat = o.heat ? o.heat[pc] : 0, inS = has(o.scale, pc), inC = o.chord && has(o.chord, pc);
      if (heat > 0.02) {
        const gr = g.createRadialGradient(x, y, 0, x, y, 8 + 14 * heat);
        gr.addColorStop(0, th.accent); gr.addColorStop(1, "transparent");
        g.globalAlpha = heat; g.fillStyle = gr; g.beginPath(); g.arc(x, y, 8 + 14 * heat, 0, TAU); g.fill(); g.globalAlpha = 1;
      }
      g.fillStyle = inC ? th.text : inS ? th.accent : th.line;
      if (inS || inC) BleepView.glow(g, inC ? th.text : th.accent, 6);
      g.beginPath(); g.arc(x, y, inC ? 4.5 : inS ? 3.2 : 1.8, 0, TAU); g.fill(); g.shadowBlur = 0;
      if (pc === o.root) { g.strokeStyle = th.text; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 7.5, 0, TAU); g.stroke(); }
      const [lx, ly] = P(pc, R + 11);
      g.fillStyle = inS ? th.text : th.muted; g.globalAlpha = inS ? 0.9 : 0.5; g.fillText(NM[pc], lx, ly); g.globalAlpha = 1;
    }
    if (o.now != null) {  // the note sounding: a spoke from the centre
      const [x, y] = P(o.now, R);
      g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 12);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); g.shadowBlur = 0;
    }
  });
  /// Fades `heat` (12 values) by dt and lights the notes in `lit` (pitch classes).
  const heatStep = (heat, dt, lit) => {
    const f = Math.exp(-dt * 1.6);
    for (let i = 0; i < 12; i++) heat[i] *= f;
    for (const pc of lit) heat[pc] = 1;
  };
  const KEYS = 24;
  const mod = (a, m) => ((a % m) + m) % m;
  const maskOf = (iv) => iv.reduce((m, x) => m | (1 << mod(x, 12)), 0);
  const qualityOf = (mask) => CHORDS.findIndex((c) => maskOf(c[1]) === mask);

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function name(root, quality, bass) {
    const n = NAMES[mod(root, 12)] + (quality >= 0 ? CHORDS[quality][0] : "?");
    return bass >= 0 && mod(bass, 12) !== mod(root, 12) ? n + "/" + NAMES[mod(bass, 12)] : n;
  }
  /// The scale note at `index` (Chords.h scaleNote), semitones above the key.
  function scaleNote(mask, index) {
    const notes = [];
    for (let k = 0; k < 12; k++) if ((mask >> k) & 1) notes.push(k);
    if (!notes.length) return index;
    const oct = Math.floor(index / notes.length);
    return notes[index - oct * notes.length] + 12 * oct;
  }
  /// The chords of the key's degrees with the current stack: [{root, iv, quality}].
  function diatonic(key, mask, stack) {
    const steps = STACKS[Math.max(0, Math.min(STACKS.length - 1, stack))];
    const size = [...Array(12).keys()].filter((k) => (mask >> k) & 1).length;
    const out = [];
    for (let d = 0; d < Math.min(7, size); d++) {
      const root = scaleNote(mask, d);
      let iv = steps.map((s) => scaleNote(mask, d + s) - root);
      if (mask === 0xfff) iv = CHORDS[STACK_CHROMATIC[stack]][1].slice();
      out.push({ root: key + root, iv, quality: qualityOf(maskOf(iv)) });
    }
    return out;
  }

  function draw(view) {
    const c = view.cq;
    if (!c) return;
    const st = c.state || {}, arr = st.arrays || {};
    const mode = setting(view, "mode");
    let voices = (arr.voices || []).map(Math.round);
    const prev = setting(view, "lead") > 0 ? (arr.prev || []).map(Math.round) : [];
    let root = st.root ?? 0, quality = st.quality ?? -1;
    if (c.preview) {
      voices = c.preview.iv.map((x) => c.preview.root + x);
      root = c.preview.root;
      quality = c.preview.quality;
    }
    const lowest = voices.length ? Math.min(...voices) : 0;
    c.name.textContent = voices.length ? name(root, quality, lowest) : "–";
    c.sub.textContent = c.preview ? "preview" :
      mode === 2 ? (st.noHarmony ? "no harmony" : "Bus " + "ABCD"[Math.max(0, setting(view, "harmony") - 1)] + ": " +
        name(st.busRoot ?? 0, st.busQuality ?? -1, -1)) :
      mode === 1 && st.noHarmony ? "no harmony" : "";
    // Keyboard: two octaves from the C at or below the lowest voice.
    const base = Math.floor(Math.min(lowest, ...(prev.length ? prev : [lowest])) / 12) * 12;
    c.keys.forEach((k, i) => {
      const p = base + i;
      k.classList.toggle("prev", prev.includes(p) && !voices.includes(p));
      k.classList.toggle("root", mod(p, 12) === mod(root, 12));
      const idx = voices.indexOf(p);
      k.dataset.voice = idx >= 0 ? String([...voices].sort((a, b) => a - b).indexOf(p) + 1) : "";
      k.classList.toggle("voice", idx >= 0);
    });
    c.octave.textContent = "C" + (Math.floor(base / 12) + 4);
    // Diatonic row.
    c.row.hidden = mode !== 1;
    if (mode === 1) {
      const key = st.key ?? setting(view, "root"), mask = st.scale ?? 0xab5;
      const chords = diatonic(key, mask, setting(view, "stack"));
      const sig = JSON.stringify(chords.map((x) => [x.root, x.quality]));
      if (sig !== c.rowSig) {
        c.rowSig = sig;
        c.row.innerHTML = "";
        chords.forEach((ch, d) => {
          const b = document.createElement("button");
          const minor = ch.iv.length > 1 && ch.iv[1] === 3;
          b.innerHTML = `<b>${minor ? ROMAN[d].toLowerCase() : ROMAN[d]}</b><span>${name(ch.root, ch.quality, -1)}</span>`;
          b.addEventListener("click", () => {
            const same = c.preview && c.preview.d === d;
            c.preview = same ? null : { d, root: mod(ch.root, 12) + 12 * Math.floor(lowest / 12), iv: ch.iv, quality: ch.quality };
            for (const x of c.row.children) x.classList.toggle("on", !same && x === b);
            draw(view);
          });
          c.row.appendChild(b);
        });
      }
    } else if (c.preview) {
      c.preview = null;
    }
  }

  const STYLE = `
    .cq-wrap { display: flex; gap: 14px; align-items: center; }
    .bv-panel canvas.cq-ring { width: 136px; height: 136px; flex: none; }
    .cq-main { flex: 1; min-width: 0; }
    .cq-head { display: flex; align-items: baseline; gap: 10px; }
    .cq-name { font-size: 26px; font-weight: 600; }
    .cq-sub { color: var(--muted); font-size: 11px; }
    .cq-kb { position: relative; display: flex; gap: 1px; margin-top: 6px; }
    .cq-kb span { flex: 1; height: 36px; border-radius: 3px; background: var(--panel-3, #2d323d); position: relative;
      font-size: 9px; text-align: center; line-height: 14px; }
    .cq-kb span.black { background: var(--panel, #1d2027); height: 24px; }
    .cq-kb span.root { box-shadow: inset 0 -3px 0 var(--muted); }
    .cq-kb span.prev::before { content: ""; position: absolute; left: 50%; top: 4px; width: 8px; height: 8px; margin-left: -4px;
      border-radius: 50%; border: 1px solid var(--muted); opacity: .6; }
    .cq-kb span.voice::before { content: attr(data-voice); position: absolute; left: 50%; top: 2px; width: 12px; height: 12px;
      margin-left: -6px; border-radius: 50%; background: var(--accent); color: var(--bg, #15171c); font-weight: 700; }
    .cq-oct { color: var(--muted); font-size: 9px; margin-top: 2px; }
    .cq-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-top: 6px; }
    .cq-row button { display: flex; flex-direction: column; align-items: center; padding: 2px 0; font-size: 10px; line-height: 13px; }
    .cq-row button.on { border-color: var(--accent); }
    .cq-row span { color: var(--muted); }`;

  BleepViews.register("chord-quantizer", {
    partNames: ["Chord"],
    width: 900,
    layout: [
      { title: "Source", params: ["mode", "root", "scale", "harmony", "hysteresis"] },
      { title: "Chord", params: ["chord", "stack", "inversion", "voices"] },
      { title: "Voicing", params: ["voicing", "lead", "anchor", "range"] },
      { title: "Strum & output", params: ["strum", "velocity", "strumorder"] },
    ],
    template: `<div class="bv-panel"><div class="cq-wrap"><canvas class="cq-ring"></canvas><div class="cq-main">
      <div class="cq-head"><div class="cq-name">–</div><div class="cq-sub"></div></div>
      <div class="cq-kb"></div><div class="cq-oct"></div>
      <div class="cq-row" hidden></div>
    </div></div></div>`,
    afterBuild(view, el) {
      if (!document.getElementById("cq-style")) {
        const s = document.createElement("style");
        s.id = "cq-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const kb = el.querySelector(".cq-kb");
      const keys = [];
      for (let i = 0; i < KEYS; i++) {
        const k = document.createElement("span");
        if ([1, 3, 6, 8, 10].includes(i % 12)) k.classList.add("black");
        kb.appendChild(k);
        keys.push(k);
      }
      view.cq = { name: el.querySelector(".cq-name"), sub: el.querySelector(".cq-sub"), keys, octave: el.querySelector(".cq-oct"),
        row: el.querySelector(".cq-row"), state: null, preview: null, rowSig: "" };
      const strum = [...view.root.querySelectorAll(".bv-controls .bv-sec")].pop();
      if (strum) strum.querySelector(".bv-sec-body").style.cssText = "flex-direction:row;align-items:center;gap:8px";
      view.cq.heat = new Float32Array(12);
      view.cq.sig = "";
      view.cq.t = 0;
      const ring = el.querySelector(".cq-ring");
      BleepView.loop(view.root, (t) => {
        const c = view.cq, st = c.state || {}, arr = st.arrays || {};
        const dt = c.t ? Math.min(0.1, t - c.t) : 0;
        c.t = t;
        let voices = c.preview ? c.preview.iv.map((x) => c.preview.root + x) : (arr.voices || []).map(Math.round);
        const pcs = voices.map((v) => mod(v, 12));
        const sig = pcs.join(",");
        heatStep(c.heat, dt, sig !== c.sig ? pcs : []);
        c.sig = sig;
        let chord = pcs.reduce((a, pc) => a | (1 << pc), 0), rootPc = voices.length ? mod(c.preview ? c.preview.root : st.root ?? 0, 12) : -1;
        if (!voices.length && setting(view, "mode") === 0) {  // no live voices: the chord shape on C
          const q = CHORDS[Math.min(CHORDS.length - 1, setting(view, "chord"))];
          chord = q ? maskOf(q[1]) : 0; rootPc = 0;
        }
        const mode = setting(view, "mode"), key = st.key ?? setting(view, "root");
        const rel = st.scale ?? 0xab5;
        const scale = mode === 1 || mode === 2 ? [...Array(12).keys()].reduce((a, pc) => a | (((rel >> mod(pc - key, 12)) & 1) << pc), 0) : 0;
        pitchRing(ring, BleepView.theme(view.root), { scale, chord, root: rootPc, heat: c.heat });
      });
      draw(view);
    },
    onState(st, view) {
      if (!view.cq) return;
      view.cq.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
