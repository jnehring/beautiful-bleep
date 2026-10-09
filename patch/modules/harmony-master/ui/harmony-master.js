// SPDX-License-Identifier: MIT
// Harmony Master view (doc/specs/modules/harmony-master.md §5): the chord now
// playing with its key and scale and a one-octave keyboard, and the
// progression strip (Progression source): click a slot to edit it, drag its
// right edge to change the length, + adds a slot. Slots live in the node's
// data; every edit is one undo step.
(function () {
  "use strict";
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
  // patch/common/dsp/Chords.h, in table order: [id, label, suffix].
  const CHORDS = [
    ["unison", "Unison", ""], ["fifth", "Fifth", "5"], ["major", "Major", ""], ["minor", "Minor", "m"],
    ["diminished", "Diminished", "dim"], ["augmented", "Augmented", "aug"], ["sus2", "Sus2", "sus2"], ["sus4", "Sus4", "sus4"],
    ["major6", "Major 6", "6"], ["minor6", "Minor 6", "m6"], ["dominant7", "Dominant 7", "7"], ["major7", "Major 7", "maj7"],
    ["minor7", "Minor 7", "m7"], ["half-diminished", "Half-diminished", "m7♭5"], ["diminished7", "Diminished 7", "dim7"],
    ["minor-major7", "Minor-major 7", "m(maj7)"], ["7sus4", "7sus4", "7sus4"], ["add9", "Add9", "add9"],
    ["minor-add9", "Minor add9", "m(add9)"], ["6-9", "6/9", "6/9"], ["major9", "Major 9", "maj9"], ["minor9", "Minor 9", "m9"],
    ["dominant9", "Dominant 9", "9"], ["quartal", "Quartal", "4ths"], ["dominant11", "Dominant 11", "11"],
    ["minor11", "Minor 11", "m11"], ["dominant13", "Dominant 13", "13"], ["7b9", "7♭9", "7♭9"], ["7#9", "7♯9", "7♯9"],
    ["augmented7", "Augmented 7", "aug7"], ["7b5", "7♭5", "7♭5"], ["major7#11", "Major 7♯11", "maj7♯11"],
  ];
  const SCALES = ["Chromatic", "Major", "Natural Minor", "Harmonic Minor", "Melodic Minor", "Dorian", "Phrygian", "Lydian",
    "Mixolydian", "Locrian", "Phrygian Dominant", "Major Pentatonic", "Minor Pentatonic", "Blues", "Whole Tone",
    "Diminished", "Hirajoshi"];
  const SCALE_MASKS = [0xfff, 0xab5, 0x5ad, 0x9ad, 0xaad, 0x6ad, 0x5ab, 0xad5, 0x6b5, 0x56b, 0x5b3, 0x295, 0x4a9, 0x4e9,
    0x555, 0xb6d, 0x18d];
  const LENGTHS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];
  const BEAT_PX = 14;
  const mod = (a, m) => ((a % m) + m) % m;

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function chordName(root, quality, bass) {
    const suffix = quality >= 0 && quality < CHORDS.length ? CHORDS[quality][2] : "?";
    const name = NAMES[mod(root, 12)] + suffix;
    return bass >= 0 && mod(bass, 12) !== mod(root, 12) ? name + "/" + NAMES[mod(bass, 12)] : name;
  }
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.slots)) d = view.node.data = { slots: [] };
    return d;
  }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view));
    view.api.setData(JSON.parse(JSON.stringify(data(view))));
    drawStrip(view);
  }
  function slotLabel(s) {
    const root = s.deg ? ROMAN[s.deg - 1] : NAMES[s.root];
    const q = s.q === "diatonic-triad" ? "" : s.q === "diatonic-seventh" ? "⁷" :
      (CHORDS.find((c) => c[0] === s.q) || ["", "", "?"])[2];
    return root + q + (s.bass >= 0 && s.bass !== undefined ? "/" + NAMES[s.bass] : "");
  }

  // ---- now playing ---------------------------------------------------------
  function drawNow(view, st) {
    const h = view.hm;
    if (!h || !st || typeof st.root !== "number") return;
    h.name.textContent = chordName(st.root, st.quality, st.bass);
    h.prog.hidden = setting(view, "source") !== 1;
    const scaleIdx = setting(view, "scale");
    const own = (SCALE_MASKS[scaleIdx] || 0xfff);
    const adapted = setting(view, "policy") === 1 && st.scale !== own;
    h.key.textContent = NAMES[st.key] + " " + (SCALES[scaleIdx] || "").toLowerCase() + (adapted ? " · adapted" : "") +
      (st.degree ? " · " + ROMAN[Math.min(6, st.degree - 1)] : "");
    h.warn.hidden = !st.conflict;
    h.warn.textContent = "Bus " + "ABCD"[setting(view, "bus")] + " already has a Harmony Master: this one publishes nothing.";
    const scale = mod12rot(st.scale, st.key), chord = mod12rot(st.chord, st.root);
    h.keys.forEach((k, pc) => {
      k.classList.toggle("in", !!((scale >> pc) & 1));
      k.classList.toggle("tone", !!((chord >> pc) & 1));
      k.classList.toggle("root", pc === st.root);
    });
    if (st.slot !== view.hm.playing) {
      view.hm.playing = st.slot;
      drawStrip(view);
    }
  }
  /// A 12-bit mask relative to `root`, rotated to be relative to C.
  function mod12rot(m, root) {
    const s = mod(root, 12);
    return ((m << s) | (m >> (12 - s))) & 0xfff;
  }

  // ---- progression strip -------------------------------------------------------
  function drawStrip(view) {
    const h = view.hm;
    if (!h) return;
    h.prog.hidden = setting(view, "source") !== 1;
    const d = data(view);
    h.strip.innerHTML = "";
    d.slots.forEach((s, i) => {
      const b = document.createElement("div");
      b.className = "hm-slot" + (i === h.playing ? " playing" : "") + (i === h.editing ? " editing" : "");
      b.style.width = Math.max(18, s.len * BEAT_PX) + "px";
      b.textContent = slotLabel(s);
      b.title = s.len + (s.len === 1 ? " beat" : " beats");
      b.addEventListener("click", (e) => { if (!b.dragged) openEditor(view, i); b.dragged = false; e.stopPropagation(); });
      const grip = document.createElement("span");
      grip.className = "hm-grip";
      grip.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        grip.setPointerCapture(e.pointerId);
        const x0 = e.clientX, len0 = s.len;
        view.api.beginGesture();
        const move = (ev) => {
          const want = len0 + (ev.clientX - x0) / BEAT_PX;
          let best = LENGTHS[0];
          for (const l of LENGTHS) if (Math.abs(l - want) < Math.abs(best - want)) best = l;
          if (best !== data(view).slots[i].len) {
            data(view).slots[i].len = best;
            b.style.width = Math.max(18, best * BEAT_PX) + "px";
            b.dragged = true;
            view.api.setData(JSON.parse(JSON.stringify(data(view))));
          }
        };
        const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", up);
      });
      b.appendChild(grip);
      h.strip.appendChild(b);
    });
    h.add.disabled = d.slots.length >= 16;
    if (h.editing >= d.slots.length) closeEditor(view);
  }

  function select(options, value, onChange) {
    const s = document.createElement("select");
    s.className = "bv-select";
    for (const [v, label] of options) s.appendChild(new Option(label, v));
    s.value = String(value);
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function openEditor(view, i) {
    const h = view.hm, s = data(view).slots[i];
    if (!s) return;
    h.editing = i;
    h.editor.hidden = false;
    h.editor.innerHTML = "";
    const row = (label, el) => {
      const r = document.createElement("label");
      r.className = "hm-row";
      r.append(Object.assign(document.createElement("span"), { textContent: label }), el);
      h.editor.appendChild(r);
    };
    const change = (fn) => edit(view, (d) => fn(d.slots[i]));
    const rootOpts = ROMAN.map((r, k) => ["d" + (k + 1), "Degree " + r]).concat(NAMES.map((n, k) => ["r" + k, n]));
    row("Root", select(rootOpts, s.deg ? "d" + s.deg : "r" + s.root, (v) => change((t) => {
      if (v[0] === "d") { t.deg = +v.slice(1); delete t.root; } else { t.root = +v.slice(1); delete t.deg; }
    })));
    const qOpts = [["diatonic-triad", "Diatonic Triad"], ["diatonic-seventh", "Diatonic Seventh"]].concat(CHORDS.map((c) => [c[0], c[1]]));
    row("Quality", select(qOpts, s.q, (v) => change((t) => (t.q = v))));
    row("Bass", select([["-1", "—"]].concat(NAMES.map((n, k) => [String(k), n])), s.bass ?? -1, (v) => change((t) => {
      if (+v < 0) delete t.bass; else t.bass = +v;
    })));
    row("Length", select(LENGTHS.map((l) => [String(l), l + (l === 1 ? " beat" : " beats")]), s.len, (v) => change((t) => (t.len = +v))));
    const tools = document.createElement("div");
    tools.className = "hm-tools";
    const del = Object.assign(document.createElement("button"), { textContent: "Delete slot" });
    del.addEventListener("click", () => { edit(view, (d) => d.slots.splice(i, 1)); closeEditor(view); });
    const done = Object.assign(document.createElement("button"), { textContent: "Done" });
    done.addEventListener("click", () => closeEditor(view));
    tools.append(del, done);
    h.editor.appendChild(tools);
    drawStrip(view);
  }
  function closeEditor(view) {
    view.hm.editing = -1;
    view.hm.editor.hidden = true;
    drawStrip(view);
  }

  const STYLE = `
    .hm-now { display: flex; align-items: center; gap: 12px; }
    .hm-name { font-size: 28px; font-weight: 600; min-width: 90px; }
    .hm-key { color: var(--muted); font-size: 11px; }
    .hm-warn { color: #f87171; font-size: 11px; margin-top: 4px; }
    .hm-kb { display: flex; gap: 2px; margin-top: 6px; }
    .hm-kb span { flex: 1; height: 22px; border-radius: 3px; background: var(--panel-3, #2d323d); position: relative; }
    .hm-kb span.black { height: 16px; }
    .hm-kb span.in { background: var(--line); outline: 1px solid var(--muted); }
    .hm-kb span.tone { background: var(--accent); }
    .hm-kb span.root::after { content: ""; position: absolute; left: 50%; bottom: 3px; width: 5px; height: 5px;
      margin-left: -2.5px; border-radius: 50%; background: var(--text); }
    .hm-prog { margin-top: 8px; }
    .hm-strip-row { display: flex; align-items: center; gap: 4px; overflow-x: auto; }
    .hm-strip { display: flex; gap: 2px; }
    .hm-slot { position: relative; height: 26px; line-height: 26px; padding: 0 4px; box-sizing: border-box; border-radius: 4px;
      background: var(--panel-2, #252932); border: 1px solid var(--line); font-size: 11px; white-space: nowrap; overflow: hidden;
      cursor: pointer; flex: none; }
    .hm-slot.playing { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 25%, transparent); }
    .hm-slot.editing { outline: 1px dashed var(--text); }
    .hm-grip { position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: ew-resize; }
    .hm-editor { margin-top: 6px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 10px; font-size: 11px; color: var(--muted); }
    .hm-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .hm-tools { grid-column: 1 / -1; display: flex; gap: 6px; justify-content: flex-end; }`;

  BleepViews.register("harmony-master", {
    top: true,
    width: 420,
    template: `<div class="bv-panel">
      <div class="hm-now"><div class="hm-name">C</div><div><div class="hm-key"></div></div></div>
      <div class="hm-warn" hidden></div>
      <div class="hm-kb"></div>
      <div class="hm-prog" hidden>
        <div class="hm-strip-row"><div class="hm-strip"></div><button class="hm-add" title="Add a slot">+</button></div>
        <div class="hm-editor" hidden></div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("hm-style")) {
        const s = document.createElement("style");
        s.id = "hm-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const kb = el.querySelector(".hm-kb");
      const keys = NAMES.map((n, pc) => {
        const k = document.createElement("span");
        k.title = n;
        if ([1, 3, 6, 8, 10].includes(pc)) k.classList.add("black");
        kb.appendChild(k);
        return k;
      });
      view.hm = {
        name: el.querySelector(".hm-name"), key: el.querySelector(".hm-key"), warn: el.querySelector(".hm-warn"), keys,
        prog: el.querySelector(".hm-prog"), strip: el.querySelector(".hm-strip"), add: el.querySelector(".hm-add"),
        editor: el.querySelector(".hm-editor"), playing: -1, editing: -1,
      };
      view.hm.add.addEventListener("click", () => edit(view, (d) => {
        const last = d.slots[d.slots.length - 1];
        d.slots.push(last ? JSON.parse(JSON.stringify(last)) : { deg: 1, q: "diatonic-triad", len: 4 });
      }));
      drawStrip(view);
    },
    onState(st, view) { drawNow(view, st); },
    onRefresh(view) {
      drawStrip(view);
      if (view.hm && view.hm.editing >= 0) openEditor(view, view.hm.editing);
    },
  });
})();
