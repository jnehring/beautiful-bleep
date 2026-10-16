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

  const rootOf = (preset) => (preset.nodes || []).find((n) => n.id === preset.root) || null;
  const jacks = (list) => (list || []).map((j) => j.id);
  const audioOut = (root) => {
    const audio = (root.outputs || []).filter((j) => j.type === "audio").map((j) => j.id);
    return audio.length ? audio.slice(0, 2) : [];
  };

  /// How to play `preset` as `role` ("instrument" or "effect"):
  ///   {ok: true, role, midi: [{from, to}], out: [jack, jack], in: [jack, jack], notes: [string]}   midi: MIDI In output → cell input
  ///   {ok: false, reason: "role" | "jacks", message}
  function plan(preset, role) {
    const plays = preset && preset.plays && preset.plays[role];
    const root = preset && rootOf(preset);
    if (!plays || !root) return { ok: false, reason: "role", message: `This preset is not an ${role}.` };
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
    if (m.trigger !== undefined) {
      if (typeof m.trigger === "string") want("trigger", m.trigger);
      else if (m.trigger && typeof m.trigger === "object") {   // a map of MIDI notes to jacks: one note stream has no way to tell them apart here
        want("trigger", m.trigger.default);
        const others = Object.keys(m.trigger).filter((k) => k !== "default" && m.trigger[k] !== m.trigger.default);
        if (others.length) notes.push("Every key plays the same sound: Play cannot tell the keys of a drum map apart yet.");
      }
    }
    if (m.velocity !== undefined) want("velocity", m.velocity);
    if (m.pitch !== undefined) want("pitch", m.pitch);
    if (m.gate !== undefined) want("gate", m.gate);
    if (m.notes !== undefined) want("notes", m.notes);
    return { ok: true, role, midi, in: [], out, notes };
  }

  /// The presets that can feed an effect: instruments that play by themselves (no keys needed), as [{name, preset}], in order.
  function sources(presets) {
    return (presets || []).filter((p) => {
      const pl = p.preset && p.preset.plays && p.preset.plays.instrument;
      const root = p.preset && rootOf(p.preset);
      return pl && root && root.type === "cell" && pl.notes && typeof pl.notes === "object" && Object.keys(pl.notes).length === 0 && plan(p.preset, "instrument").ok;
    });
  }

  window.BleepPlayWrap = { rootOf, plan, sources };
})();
