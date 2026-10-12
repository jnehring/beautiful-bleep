// SPDX-License-Identifier: MIT
// Synthesizers: general-purpose polyphonic Voice Cells. Notes in, Out L/R.
// (Basic Poly, the starter synth, lives in ../board/ui/factory-presets.js.)
import { voice, cell, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Two detuned saws into a tanh ladder: the classic warm poly, built as a demonstrator. The voice is a Voice Cell inside a
// plain cell, so a Keyboard can play it beside the cell's Notes input. The panel's dials are Dial modules in a Panel cell,
// which sends them to the module they control through one patch bay each (the panel build adds them, see panels.mjs).
function warmSawsVoice() {
  const p = voice("Voice", {
    description: "The voice of Warm Saws.",
    help: "Two detuned saws into a Ladder Tanh filter, with a soft filter envelope and a slow release.",
  }).settings({ voices: 8, spread: 0.4 });
  const o1 = p.add("oscillator", [3, 0], { fine: -7 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [3, 1], { fine: 7 }, { name: "Saw 2" });
  const envf = envelope(p, [3, 2], { attack: 0.01, decay: 0.8, sustain: 0.35, release: 0.6, velamount: 0.6 }, "Filter Env");
  const flt = p.add("filter", [5, 0], { cutoff: 700, resonance: 0.25, drive: 0.2, keytrack: 0.4, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch").cable(p.vin, "pitch", flt, "pitch")
    .cable(o1, "out", flt, "l", 0.6).cable(o2, "out", flt, "l", 0.6).cable(envf, "env", flt, "cutoff", 0.3);
  ampEnvelope(p, { node: flt, stereo: true }, [7, 1], { attack: 0.006, decay: 0.5, sustain: 0.8, release: 0.7 });
  p.place(p.vout, 40 + 10 * 300, 40);
  return p;
}

function warmSaws() {
  const p = cell("Warm Saws", {
    description: "Two saws detuned ±7 cents into a saturating transistor ladder, with a soft filter envelope and slow release.",
    tags: ["poly", "analog", "warm", "chords"],
    help: "A Keyboard and Notes in play the Voice Cell, which holds the sound: two Oscillators (saws) detuned by -7 and +7 " +
      "cents feed a Ladder Tanh filter at 700 Hz with a little drive. A filter envelope opens it on each note and the amp " +
      "release is slow. Eight voices are spread across the stereo field.\n\n" +
      "Open the Panel cell: every dial of the panel is a Dial module there, collected by a Patch Bay per module (Saw 1, " +
      "Saw 2, Filter Env, Multi Filter, Amp Env). One bundle cable per module goes into the Voice Cell, where a Patch Bay " +
      "Out next to the module cables the dials to its knobs. The wheel bends both saws by two semitones.\n\n" +
      "Tip: play wide chords.",
  }).input("notes", "Notes", "notes").stereoOut();
  const keys = p.add("keyboard", [0, 0], {}, { name: "Keys" });
  const vc = p.embed(warmSawsVoice(), [2, 1], "Voice");
  p.cable(p.cin, "notes", vc, "notes").cable(keys, "notes", vc, "notes").stereo(vc, p.cout);
  p.place(p.cout, 40 + 5 * 300, 40 + 1 * 220);
  return p;
}

// Square and sub, a gentle low-pass and shared vibrato: a combo organ.
function comboOrgan() {
  const p = voice("Combo Organ", {
    description: "Square wave and sub octave through a 1-pole low-pass, organ-style on/off envelope and a shared vibrato LFO.",
    tags: ["poly", "organ", "keys", "vintage"],
    help: "A square Oscillator plus its sub-octave go through a 1-Pole Low-pass at 3.2 kHz. The amp " +
      "envelope is organ-style (instant attack, full sustain, short release) and a Vibrato LFO at 6.2 " +
      "Hz fades in on pitch.\n\n" +
      "Play Notes in, take Out L/R. There are no shared inputs; the vibrato is built in and applies to " +
      "every voice.\n\n" +
      "Tip: velocity does not change the level here, so play it like a drawbar organ and balance " +
      "it with a mixer after Out L/R.",
  }).settings({ voices: 10 });
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.5 });
  const vib = p.add("lfo", [0, 1], { rate: 6.2, fade: 0.15 }, { name: "Vibrato" });
  const flt = p.add("filter", [1, 0], { cutoff: 3200, keytrack: 0.5, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(vib, "sine", osc, "pitch", semis(0.12))
    .cable(osc, "out", flt, "l", 0.55).cable(osc, "sub", flt, "l", 0.45).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.004, decay: 0.1, sustain: 1, release: 0.06, velamount: 0 });
  return p;
}

// Slow-attack saws with a filter swell: brass.
function brassSection() {
  const p = voice("Brass Section", {
    description: "Detuned saw pair from Dual Osc into a ladder whose envelope swells in with the notes: synth brass stabs and swells.",
    tags: ["poly", "brass", "analog", "stabs"],
    help: "A Dual Osc gives two saws, the second 9 cents sharp, with a little drift, into a Ladder Tanh " +
      "filter. A filter envelope with a 70 ms attack makes each note swell open like a brass stab.\n\n" +
      "Notes in, Out L/R. No shared inputs. Harder velocity opens the filter further, so the playing " +
      "dynamics change the brightness.\n\n" +
      "Tip: play short, hard chords for stabs, or hold notes and let the filter settle for a section " +
      "sound.",
  }).settings({ voices: 8, spread: 0.3 });
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, shapeB: 0.67, octaveB: 0, fineB: 9, balance: 0.5, drift: 0.25 });
  const envf = envelope(p, [0, 1], { attack: 0.07, decay: 0.6, sustain: 0.55, release: 0.25, velamount: 0.7 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 420, resonance: 0.15, drive: 0.3, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(osc, "mix", flt, "l").cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.4);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.03, decay: 0.4, sustain: 0.85, release: 0.3 });
  return p;
}

// Wavetable position swept by an envelope, shared X input.
function tableSweep() {
  const p = voice("Table Sweep", {
    description: "Wavetable Osc on the Digital bank: each note sweeps through the table, a stereo-detuned bright poly. Shared input Position.",
    tags: ["poly", "wavetable", "digital", "bright"],
    help: "A Wavetable Osc on the Digital bank. An envelope sweeps its X position on every note, so each " +
      "one starts at one timbre and travels through the table. Stereo detune widens it, and a " +
      "filter at 9 kHz sits behind it.\n\n" +
      "Notes in, Out L/R. The shared input Position moves the table's Y axis, so patch a LFO, knob or " +
      "sequencer there to change which part of the table the sweep plays.\n\n" +
      "Tip: slowly modulate Position for a different tone each bar.",
  }).settings({ voices: 8 }).input("pos", "Position");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "Digital", x: 0.1, y: 0.3, stereo: 0.25, subLevel: 0.2 });
  const envx = envelope(p, [0, 1], { attack: 0.002, decay: 1.2, sustain: 0.2, release: 0.8, velamount: 0.4 }, "Table Env");
  const flt = p.add("filter", [1, 0], { cutoff: 9000, resonance: 0.1, keytrack: 0.3 });
  p.cable(p.vin, "pitch", wt, "pitch").cable(envx, "env", wt, "x", 0.6).cable(p.cin, "pos", wt, "y", 0.5)
    .stereo(wt, flt, { from: ["outL", "outR"] });
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.6, sustain: 0.7, release: 0.6 });
  return p;
}

// Two-operator FM with a decaying index: electric piano tines.
function fmTines() {
  const p = voice("FM Tines", {
    description: "Dual Osc as a two-operator FM piano: a sine modulator an octave up whose index decays with each note, harder with velocity.",
    tags: ["poly", "fm", "keys", "electric piano"],
    help: "A Dual Osc as two-operator FM: a sine carrier with a sine modulator one octave up. An envelope " +
      "raises the FM depth at the start of each note and lets it fall, which gives the bell-like tine " +
      "attack and mellow tail.\n\n" +
      "Notes in, Out L/R. No shared inputs. The amp and index envelopes both respond to velocity.\n\n" +
      "Tip: play softly for a clean tone, hard for a bright, clangy attack.",
  }).settings({ voices: 10 });
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0, shapeB: 0, octaveB: 1, fmDepth: 0.05, balance: 0, drift: 0.05 });
  const envi = envelope(p, [0, 1], { attack: 0.001, decay: 0.7, sustain: 0.05, release: 0.3, velamount: 0.9 }, "Index Env");
  p.cable(p.vin, "pitch", osc, "pitch").cable(envi, "env", osc, "fmDepth", 0.35);
  ampEnvelope(p, { node: osc, jack: "a" }, [1, 1], { attack: 0.001, decay: 2.2, sustain: 0.25, release: 0.5, velamount: 0.7 });
  return p;
}

// A minor-seventh chord per key into a plucky low-pass: dub chords.
function dubChords() {
  const p = voice("Dub Chords", {
    description: "Chord Osc stacks a minor seventh on every key into a resonant low-pass with a short envelope: dub-techno chord stabs.",
    tags: ["poly", "chords", "stabs", "dub", "techno"],
    help: "A Chord Osc plays a Minor 7 chord (Drop 2 voicing, 4 notes) from every key, slightly detuned " +
      "and spread in stereo, into a resonant SVF Multimode filter at 380 Hz. A short filter envelope " +
      "plucks it open.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter, so a knob or LFO there gives the " +
      "classic filter-swept dub stab.\n\n" +
      "Tip: play single notes and send Out L/R into a delay or reverb.",
  }).settings({ voices: 4 }).input("cut", "Cutoff");
  const chord = p.add("chord-osc", [0, 0], { chord: "Minor 7", voices: 4, voicing: "Drop 2", detune: 6, stereo: 0.5, shape: 0.67 });
  const envf = envelope(p, [0, 1], { attack: 0.001, decay: 0.22, sustain: 0, release: 0.2, velamount: 0.6 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 380, resonance: 0.45, keytrack: 0.3, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", chord, "pitch").stereo(chord, flt).cable(envf, "env", flt, "cutoff", 0.35)
    .cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.001, decay: 0.5, sustain: 0, release: 0.35 });
  return p;
}

// Formant oscillator with the formant following an envelope: vocal glass.
function glassVoice() {
  const p = voice("Glass Voice", {
    description: "Formant Osc whose resonant peak glides up with each note and settles: glassy, vocal keys with stereo spread.",
    tags: ["poly", "formant", "vocal", "glassy"],
    help: "A Formant Osc whose formant peak is pushed up by an envelope at each note and then settles " +
      "back. The result is a vocal, glassy tone, spread in stereo, with a slow release.\n\n" +
      "Notes in, Out L/R. No shared inputs. The cell's own Formant Env sets the sweep; velocity and " +
      "sustain shape the amp.\n\n" +
      "Tip: hold chords in the middle of the keyboard, where the formant sounds the most voice-like.",
  }).settings({ voices: 8, spread: 0.5 });
  const fo = p.add("formant-osc", [0, 0], { formant: 1.5, narrow: 0.5, body: 0.6, spread: 0.4 });
  const envf = envelope(p, [0, 1], { attack: 0.02, decay: 0.9, sustain: 0.4, release: 0.8 }, "Formant Env");
  p.cable(p.vin, "pitch", fo, "pitch").cable(envf, "env", fo, "formant", 0.15);
  ampEnvelope(p, { node: fo, stereo: true, jacks: ["outL", "outR"] }, [1, 1],
    { attack: 0.01, decay: 0.8, sustain: 0.7, release: 1.2 });
  return p;
}

// Phase-distortion keys: an envelope bends the waveform from sine to bright.
function phaseWarpKeys() {
  const p = voice("Phase Warp Keys", {
    description: "Macro Osc in Phase Warp: each note starts bright and relaxes towards a sine, like a phase-distortion digital keyboard.",
    tags: ["poly", "digital", "keys", "phase distortion"],
    help: "A Macro Osc in Phase Warp mode, in the style of phase-distortion synths. An envelope raises the " +
      "tone and shape on each note, so it starts bright and relaxes towards a plain sine.\n\n" +
      "Notes in, Out L/R. No shared inputs. Velocity scales how much the envelope warps the wave.\n\n" +
      "Tip: play hard for a sharp, metallic attack and soft for a nearly pure tone.",
  }).settings({ voices: 8, spread: 0.3 });
  const osc = p.add("macro-osc", [0, 0], { model: "Phase Warp", tone: 0.3, shape: 0.2, blend: 0.3, level: 0.8 });
  const envw = envelope(p, [0, 1], { attack: 0.001, decay: 0.6, sustain: 0.2, release: 0.4, velamount: 0.6 }, "Warp Env");
  p.cable(p.vin, "pitch", osc, "pitch").cable(envw, "env", osc, "tone", 0.55).cable(envw, "env", osc, "shape", 0.3);
  ampEnvelope(p, { node: osc, jack: "out" }, [1, 1], { attack: 0.002, decay: 1.4, sustain: 0.5, release: 0.5 });
  return p;
}

// A swarm of detuned saws per note: supersaw.
function hyperSaw() {
  const p = voice("Hyper Saw", {
    description: "Swarm in unison: eight drifting, detuned oscillators per note spread across the stereo field, through a bright low-pass.",
    tags: ["poly", "supersaw", "trance", "wide"],
    help: "A Swarm in Unison mode stacks eight drifting saws per note, detuned by 22 cents and spread " +
      "across the stereo field, then an SVF Multimode low-pass at 5 kHz.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter, so a knob or LFO there closes and " +
      "opens the sound.\n\n" +
      "Tip: play simple octaves or fifths. With six voices the stack gets thick quickly.",
  }).settings({ voices: 6 }).input("cut", "Cutoff");
  const sw = p.add("swarm", [0, 0], { chord: "Unison", count: 8, detune: 22, drift: 0.3, width: 0.9, glide: 0 });
  const flt = p.add("filter", [1, 0], { cutoff: 5000, resonance: 0.1, keytrack: 0.3, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", sw, "pitch").stereo(sw, flt).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.005, decay: 0.4, sustain: 0.85, release: 0.45 });
  return p;
}

export default category("Synthesizers", "Polyphonic Voice Cells for chords and keys: patch Notes in and Out L/R out.", [
  warmSaws, comboOrgan, brassSection, tableSweep, fmTines, dubChords, glassVoice, phaseWarpKeys, hyperSaw,
]);
