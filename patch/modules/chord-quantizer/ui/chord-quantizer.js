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
    .cq-head { display: flex; align-items: baseline; gap: 10px; }
    .cq-name { font-size: 26px; font-weight: 600; }
    .cq-sub { color: var(--muted); font-size: 11px; }
    .cq-kb { position: relative; display: flex; gap: 1px; margin-top: 6px; }
    .cq-kb span { flex: 1; height: 30px; border-radius: 3px; background: var(--panel-3, #2d323d); position: relative;
      font-size: 9px; text-align: center; line-height: 14px; }
    .cq-kb span.black { background: var(--panel, #1d2027); height: 22px; }
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
    top: true,
    width: 380,
    template: `<div class="bv-panel">
      <div class="cq-head"><div class="cq-name">–</div><div class="cq-sub"></div></div>
      <div class="cq-kb"></div><div class="cq-oct"></div>
      <div class="cq-row" hidden></div>
    </div>`,
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
