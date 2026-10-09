// SPDX-License-Identifier: MIT
// Quantizer Suite view (doc/specs/modules/quantizer-suite.md §5): four channel
// strips with the Out note name, the mode, and a one-octave keyboard: scale
// notes lit, masked-out notes crossed, the current note highlighted, chord
// tones dotted (Follow). Clicking a key toggles it in the channel's mask
// (node data, one undo step); the mask is relative to the channel's key.
(function () {
  "use strict";
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const MODES = ["Quantize", "Transpose", "Arp", "Follow"];
  const LETTERS = ["a", "b", "c", "d"];
  const mod = (a, m) => ((a % m) + m) % m;

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.masks)) d = view.node.data = { masks: [4095, 4095, 4095, 4095] };
    while (d.masks.length < 4) d.masks.push(4095);
    return d;
  }
  const noteName = (semis) => NAMES[mod(semis, 12)] + (Math.floor((semis + 60) / 12) - 1);

  function draw(view) {
    const q = view.qs;
    if (!q) return;
    const st = q.state || {}, arr = st.arrays || {};
    const masks = data(view).masks;
    q.strips.forEach((s, k) => {
      const mode = setting(view, LETTERS[k] + ".mode");
      const note = arr.notes ? Math.round(arr.notes[k]) : null;
      const key = arr.key ? Math.round(arr.key[k]) : setting(view, (setting(view, "link") && k ? "a" : LETTERS[k]) + ".root");
      const scale = arr.scale ? Math.round(arr.scale[k]) : 0xfff;
      const chord = arr.chord ? Math.round(arr.chord[k]) : 0;
      s.note.textContent = note === null ? "–" : noteName(note);
      s.mode.textContent = MODES[mode] + (mode === 2 && arr.arp ? " · " + (Math.round(arr.arp[k]) + 1) : "");
      s.warn.hidden = !(arr.noHarmony && arr.noHarmony[k] > 0.5);
      s.keys.forEach((el, pc) => {
        const rel = mod(pc - key, 12);
        el.classList.toggle("in", !!((scale >> pc) & 1));
        el.classList.toggle("masked", !((masks[k] >> rel) & 1));
        el.classList.toggle("now", note !== null && mod(note, 12) === pc);
        el.classList.toggle("tone", mode === 3 && !!((chord >> pc) & 1));
        el.classList.toggle("key", pc === key);
      });
    });
  }

  const STYLE = `
    .qs-strips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .qs-strip { min-width: 0; }
    .qs-head { display: flex; justify-content: space-between; align-items: baseline; }
    .qs-ch { font-weight: 700; color: var(--muted); }
    .qs-note { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .qs-mode { color: var(--muted); font-size: 10px; }
    .qs-warn { color: #f87171; font-size: 10px; }
    .qs-kb { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1px; margin-top: 3px; }
    .qs-kb span { height: 22px; border-radius: 2px; background: var(--bg, #15171c); position: relative; cursor: pointer; }
    .qs-kb span.in { background: var(--panel-3, #2d323d); box-shadow: inset 0 0 0 1px var(--muted); }
    .qs-kb span.key { box-shadow: inset 0 -2px 0 var(--muted); }
    .qs-kb span.masked { background: transparent; outline: 1px solid var(--line); }
    .qs-kb span.masked::after { content: "×"; position: absolute; inset: 0; text-align: center; line-height: 22px;
      font-size: 10px; color: var(--muted); }
    .qs-kb span.now { background: var(--accent); }
    .qs-kb span.tone::before { content: ""; position: absolute; left: 50%; top: 3px; width: 4px; height: 4px; margin-left: -2px;
      border-radius: 50%; background: var(--text); }`;

  BleepViews.register("quantizer-suite", {
    top: true,
    width: 480,
    template: `<div class="bv-panel"><div class="qs-strips"></div></div>`,
    afterBuild(view, el) {
      if (!document.getElementById("qs-style")) {
        const s = document.createElement("style");
        s.id = "qs-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const box = el.querySelector(".qs-strips");
      const strips = LETTERS.map((letter, k) => {
        const strip = document.createElement("div");
        strip.className = "qs-strip";
        strip.innerHTML = `<div class="qs-head"><span class="qs-ch">${letter.toUpperCase()}</span><span class="qs-note">–</span></div>
          <div class="qs-mode"></div><div class="qs-warn" hidden>no harmony</div><div class="qs-kb"></div>`;
        const kb = strip.querySelector(".qs-kb");
        const keys = NAMES.map((n, pc) => {
          const key = document.createElement("span");
          key.title = n + " (click: allow / mask)";
          key.addEventListener("click", () => {
            const arr = (view.qs.state && view.qs.state.arrays) || {};
            const root = arr.key ? Math.round(arr.key[k]) : 0;
            view.api.beginGesture();
            const d = data(view);
            d.masks[k] ^= 1 << mod(pc - root, 12);
            view.api.setData(JSON.parse(JSON.stringify(d)));
            draw(view);
          });
          kb.appendChild(key);
          return key;
        });
        box.appendChild(strip);
        return { note: strip.querySelector(".qs-note"), mode: strip.querySelector(".qs-mode"), warn: strip.querySelector(".qs-warn"), keys };
      });
      view.qs = { strips, state: null };
      draw(view);
    },
    onState(st, view) {
      if (!view.qs) return;
      view.qs.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
