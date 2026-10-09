// SPDX-License-Identifier: MIT
// Synthesizers: general-purpose polyphonic Voice Cells. Notes in, Out L/R.
// (Basic Poly, the starter synth, lives in ../board/ui/factory-presets.js.)
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Two detuned saws into a tanh ladder: the classic warm poly.
function warmSaws() {
  const p = voice("Warm Saws", {
    description: "Two saws detuned ±7 cents into a saturating transistor ladder, with a soft filter envelope and slow release.",
    tags: ["poly", "analog", "warm", "chords"],
  }).settings({ voices: 8, spread: 0.4 }).input("cut", "Cutoff");
  const o1 = p.add("oscillator", [0, 0], { fine: -7 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [0, 1], { fine: 7 }, { name: "Saw 2" });
  const envf = envelope(p, [0, 2], { attack: 0.01, decay: 0.8, sustain: 0.35, release: 0.6, velamount: 0.6 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 700, resonance: 0.25, drive: 0.2, keytrack: 0.4, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch")
    .cable(o1, "out", flt, "l", 0.6).cable(o2, "out", flt, "l", 0.6).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.3).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.006, decay: 0.5, sustain: 0.8, release: 0.7 });
  return p;
}

// Square and sub, a gentle low-pass and shared vibrato: a combo organ.
function comboOrgan() {
  const p = voice("Combo Organ", {
    description: "Square wave and sub octave through a 1-pole low-pass, organ-style on/off envelope and a shared vibrato LFO.",
    tags: ["poly", "organ", "keys", "vintage"],
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
