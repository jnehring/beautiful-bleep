// SPDX-License-Identifier: MIT
// play-wrap.js — what it takes to play a cell preset on its own in Bleep Play (doc/specs/preset-system-plan.md, section 9).
//
// An instrument or effect preset is a cell with `plays` (doc/specs/cell-plugins.md §2). The plugins wire such a cell to the host: MIDI in
// and audio out for an instrument, audio in and out for an effect. Play does the same on a fresh board:
//
//   instrument   MIDI In ──► the cell ──► Audio Out         what the cell takes from MIDI follows `plays.instrument.notes`
//   effect       a source ──► the cell ──► Audio Out        the source is a self-playing instrument preset (Play has no audio input yet)
//
// `plan(preset, role)` says whether a preset can be played this way and which cables the wiring needs; the board code builds the board.
// Voice Cells play: the web engine runs one copy of the voice per note (patch/web/js/voices.js). Not supported yet: the audio input of the browser.
// No DOM here.
(function () {
  "use strict";

  // The General MIDI drum notes each output of the Drum Notes module listens to (patch/modules/drum-notes/doc/drum-notes.md).
  const GM = { kick: [35, 36], snare: [38, 40], rim: [37], clap: [39], hat: [42, 44], open: [46], tom: [41, 43, 45, 47, 48, 50], bell: [56], ride: [51, 53, 59], crash: [49, 52, 55, 57] };
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const noteName = (n) => NAMES[n % 12] + (Math.floor(n / 12) - 1);   // 60 is C4, as on the keyboard under an instrument
  /// The keyboard octave that puts the General MIDI drum notes (35 to 59) under the keys of a drum map.
  const DRUM_OCTAVE = 2;

  const rootOf = (preset) => (preset.nodes || []).find((n) => n.id === preset.root) || null;
  const jacks = (list) => (list || []).map((j) => j.id);
  const audioOut = (root) => {
    const audio = (root.outputs || []).filter((j) => j.type === "audio").map((j) => j.id);
    return audio.length ? audio.slice(0, 2) : [];
  };

  /// How to play `preset` as `role` ("instrument" or "effect"):
  ///   {ok: true, role, midi: [{from, to}], out: [jack, jack], in: [jack, jack], notes: [string]}   midi: MIDI In output → cell input
  ///     a preset that maps keys to different jacks also has `drums: [{from, to}]` (Drum Notes output → cell input: the Drum Notes module sits
  ///     between MIDI In and the cell) and `octave` (the keyboard octave that shows the drum notes)
  ///   {ok: false, reason: "role" | "jacks" | "media", message}
  function plan(preset, role) {
    const plays = preset && preset.plays && preset.plays[role];
    const root = preset && rootOf(preset);
    if (!plays || !root) return { ok: false, reason: "role", message: `This preset is not an ${role}.` };
    // Play has no media folder yet (preset-system-plan.md, "Samples in presets"): a preset that carries recordings needs the app.
    if (preset.media && Object.keys(preset.media).length) return { ok: false, reason: "media", message: "This preset plays recordings, which Bleep Play cannot load yet. Use the app or the plugin." };
    const voice = root.type === "voice-cell";   // a Voice Cell as the root has the fixed jacks notes, l and r
    const out = voice ? ["l", "r"] : audioOut(root);
    if (!out.length) return { ok: false, reason: "jacks", message: "This preset has no audio output." };
    const have = new Set(jacks(root.inputs));
    if (voice) have.add("notes");
    const notes = [];
    if (voice && role === "instrument" && plays.notes === "voice") return { ok: true, role, midi: [{ from: "notes", to: "notes" }], in: [], out, notes };
    if (role === "effect") {
      const inputs = (plays.in || []).filter((j) => have.has(j));
      if (!inputs.length) return { ok: false, reason: "jacks", message: "This effect has no audio input." };
      return { ok: true, role, midi: [], in: inputs.slice(0, 2), out, notes };
    }
    const midi = [];
    const want = (from, to) => {
      if (typeof to === "string" && have.has(to)) midi.push({ from, to });
      else if (typeof to === "string") notes.push(`The jack “${to}” is missing, so ${from} is not connected.`);
    };
    const m = plays.notes && typeof plays.notes === "object" ? plays.notes : {};
    let drums = null;
    if (m.trigger !== undefined) {
      if (typeof m.trigger === "string") want("trigger", m.trigger);
      else if (m.trigger && typeof m.trigger === "object") {
        // A map of MIDI notes to jacks (hats: 44 closed, 46 open, the rest closed). The Drum Notes module turns the General MIDI drum notes
        // into one trigger per drum, so each of its outputs goes to the jack the map gives its notes, or to the default jack.
        const map = m.trigger;
        drums = [];
        for (const [out, gm] of Object.entries(GM)) {
          const mapped = gm.map((n) => map[String(n)]).filter((j) => typeof j === "string");
          const to = mapped.length ? mapped[0] : map.default;
          if (typeof to === "string" && have.has(to)) drums.push({ from: out, to });
        }
        if (typeof map.default === "string" && !have.has(map.default)) notes.push(`The jack “${map.default}” is missing, so the other keys play nothing.`);
        const named = Object.keys(map).filter((k) => k !== "default" && map[k] !== map.default).map((k) => `${noteName(+k)} plays “${map[k]}”`);
        notes.push(`The keys are the General MIDI drum notes (C2 and up)${named.length ? ": " + named.join(", ") : ""}${typeof map.default === "string" ? `; every other drum key plays “${map.default}”` : ""}.`);
      }
    }
    if (m.velocity !== undefined) {
      if (drums && typeof m.velocity === "string" && have.has(m.velocity)) drums.push({ from: "velocity", to: m.velocity });   // the hit's velocity, with its trigger
      else want("velocity", m.velocity);
    }
    if (m.pitch !== undefined) want("pitch", m.pitch);
    if (m.gate !== undefined) want("gate", m.gate);
    if (m.notes !== undefined) want("notes", m.notes);
    return { ok: true, role, midi, in: [], out, notes, ...(drums ? { drums, octave: DRUM_OCTAVE } : {}) };
  }

  /// The presets that can feed an effect: instruments that play by themselves (no keys needed), as [{name, preset}], in order.
  function sources(presets) {
    return (presets || []).filter((p) => {
      const pl = p.preset && p.preset.plays && p.preset.plays.instrument;
      const root = p.preset && rootOf(p.preset);
      return pl && root && root.type === "cell" && pl.notes && typeof pl.notes === "object" && Object.keys(pl.notes).length === 0 && plan(p.preset, "instrument").ok;
    });
  }

  window.BleepPlayWrap = { rootOf, plan, sources, noteName, DRUM_OCTAVE };
})();
