// SPDX-License-Identifier: MIT
// Dual Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/8", root: o.root || "A",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.5 }, { data: steps(notes, o.vel) });
}
/// Stereo oscillator → VCA with an ADSR from the sequencer gate. Returns the VCA.
function amp(p, at, s, osc, adsr, from = ["outL", "outR"]) {
  const env = p.add("adsr", at, adsr, { name: "Amp Env" });
  const v = p.add("vca", [at[0] + 1, at[1]], {}, { name: "VCA" });
  p.cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(env, "env", v, "gain");
  p.stereo(osc, v, { from });
  return v;
}
function room(p, at, src, o = {}) {
  if (o.trim !== undefined) {  // level trim through a mixer first
    const m = p.add("audio-mixer", [at[0] - 1, at[1] + 1], { level1: o.trim, pan1: -1, level2: o.trim, pan2: 1, master: 0 }, { name: "Trim" });
    p.cable(src, (o.from || ["l", "r"])[0], m, "in1l").cable(src, (o.from || ["l", "r"])[1], m, "in2r");
    src = m; o = { ...o, from: ["outl", "outr"] };
  }
  const v = p.add("reverb", at, { size: 0.6, decay: 3, damping: 0.45, mix: o.mix ?? 0.35, quality: "Eco (8 lines)", ...o.v });
  p.stereo(src, v, { from: o.from || ["l", "r"] }).stereo(v, p.out);
  return v;
}


function syncLead() {
  const p = patch("Dual Osc: Sync Lead", {
    module: "dual-osc", tempo: 104,
    description: "Oscillator B hard-syncs oscillator A and a slow LFO sweeps Tune B, so the lead's tone rips from mellow to searing and back. Change Sync for a softer or harder grip, or pull Tune B to a fixed value to freeze the sound.",
    tags: ["sync", "lead", "sweep", "melody"],
  });
  const s = seq(p, [0, 0], [0, 0, 7, 0, 10, 7, 3, 5, 0, 0, 12, 10, 7, 5, 3, "."], { rate: "1/8", root: "A", octave: 0, scale: "Minor Pentatonic", gate: 0.6 });
  const o = p.add("dual-osc", [1, 0], { octaveB: 0, tuneB: 5, shapeA: 0.8, sync: 1, balance: 0.1, drift: 0.15, width: 0.4, fold: 0.1 });
  const v = amp(p, [1, 1], s, o, { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.2 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.13, wave: "Triangle" }, { name: "Sync Sweep" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "tuneB", 0.8);
  room(p, [3, 0], v, { trim: -2, mix: 0.2, v: { decay: 1.8 } });
  return p;
}

function metalBells() {
  const p = patch("Dual Osc: Metal Bells", {
    module: "dual-osc", tempo: 88,
    description: "Sine B frequency-modulates sine A at an odd ratio (B Tune +7 semitones) with Exponential FM, and a decaying envelope on both level and FM turns every note into a struck, clangorous bell. Try changing Tune B for different metals.",
    tags: ["fm", "bell", "metallic", "pluck"],
  });
  const s = seq(p, [0, 0], [0, ".", 7, ".", 12, ".", 5, ".", 3, ".", 10, ".", 7, ".", ".", "."], { rate: "1/8", root: "D", octave: 1, scale: "Minor Pentatonic" });
  const o = p.add("dual-osc", [1, 0], { shapeA: 0, shapeB: 0, octaveB: 0, tuneB: 7.3, fmDepth: 0.35, fmMode: "Exponential", balance: 0, width: 0.5, drift: 0.05 });
  const v = amp(p, [1, 1], s, o, { attack: 0.002, decay: 1.8, sustain: 0, release: 1 });
  const fe = p.add("adsr", [0, 1], { attack: 0.002, decay: 0.7, sustain: 0.05, release: 0.5 }, { name: "FM Env" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", fe, "gate").cable(s, "trigger", fe, "retrig");
  p.cable(fe, "env", o, "fmDepth", 0.4);
  room(p, [3, 0], v, { trim: -2, mix: 0.4, v: { decay: 4, size: 0.7 } });
  return p;
}

function foldBass() {
  const p = patch("Dual Osc: Folding Bass", {
    module: "dual-osc", tempo: 98,
    description: "A triangle bass pushed through the stereo wavefolder: an envelope opens Fold on every note so each one starts snarling and settles into a round tone. Raise Symmetry for a more even-harmonic growl.",
    tags: ["bass", "wavefolder", "fold", "growl"],
  });
  const s = seq(p, [0, 0], [0, ".", 0, 0, ".", 7, ".", 5, 0, ".", 0, 3, ".", 5, 7, "."], { rate: "1/8", root: "E", octave: -2, scale: "Minor Pentatonic", gate: 0.55 });
  const o = p.add("dual-osc", [1, 0], { shapeA: 0.3, octaveB: -1, shapeB: 0.3, balance: 0.3, fold: 0.25, symmetry: 0.2, width: 0.2 });
  const v = amp(p, [1, 1], s, o, { attack: 0.003, decay: 0.3, sustain: 0.6, release: 0.12 });
  const fe = p.add("adsr", [0, 1], { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.15 }, { name: "Fold Env" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.1 }, { name: "Slow Symmetry" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", fe, "gate").cable(s, "trigger", fe, "retrig").cable(fe, "env", o, "fold", 0.6).cable(lfo, "out", o, "symmetry", 0.5);
  const drums = beat(p, [0, 3], { style: "half", level: -10 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -4, pan1: -0.3, level2: -4, pan2: 0.3, level3: -3, level4: -3, master: 0 }, { name: "Main" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.12, v: { decay: 1.2 } });
  return p;
}

function driftPad() {
  const p = patch("Dual Osc: Drifting Pair", {
    module: "dual-osc", tempo: 70,
    description: "Two saw cores a few cents apart with strong Drift and wide stereo Width: the slowly beating pair makes a warm, breathing pad. Raise Fine B or Drift for a wider, less stable sound.",
    tags: ["pad", "detune", "drift", "warm"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "F", octave: -1, scale: "Major Pentatonic", gate: 1 });
  const o = p.add("dual-osc", [1, 0], { shapeA: 0.67, octaveB: 0, shapeB: 0.67, fineB: 9, fineA: -7, balance: 0.5, drift: 0.7, width: 1, fold: 0.05 });
  const v = amp(p, [1, 1], s, o, { attack: 1.4, decay: 1, sustain: 0.9, release: 2.5 });
  const f = p.add("filter", [3, 0], { cutoff: 1200, resonance: 0.15 }, { name: "Warmth" });
  const lfo = p.add("lfo", [3, 1], { rate: 0.05 }, { name: "Filter Drift" });
  p.cable(s, "pitch", o, "pitch").stereo(v, f).cable(lfo, "out", f, "cutoff", 0.35);
  room(p, [5, 0], f, { trim: -14, mix: 0.4, v: { decay: 5 } });
  return p;
}

function ringClang() {
  const p = patch("Dual Osc: Ring Clang", {
    module: "dual-osc", tempo: 108,
    description: "The Ring output multiplies the two cores into inharmonic clangs; a short envelope turns it into a metallic percussion line over a light beat. Change Tune B to retune the clang, or Octave B for a lower rumble.",
    tags: ["ring mod", "percussion", "metallic", "rhythm"],
  });
  const s = seq(p, [0, 0], [0, ".", 0, ".", 7, ".", 0, 0, ".", 5, ".", 0, 12, ".", 7, "."], { rate: "1/8", root: "G", octave: 0, scale: "Minor Pentatonic", gate: 0.3 });
  const o = p.add("dual-osc", [1, 0], { shapeA: 0.1, shapeB: 0.1, octaveB: 1, tuneB: 1.4, drift: 0.05 });
  const env = p.add("adsr", [1, 1], { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 }, { name: "Clang Env" });
  const v = p.add("vca", [2, 0], {}, { name: "VCA" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(o, "ring", v, "l").cable(env, "env", v, "gain");
  const drums = beat(p, [0, 3], { style: "broken", level: -10 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -5, pan1: -0.2, level2: -5, pan2: 0.2, level3: 0, level4: 0, master: 0 }, { name: "Main" });
  p.cable(v, "l", mix, "in1l").cable(v, "l", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.15, v: { decay: 1.5 } });
  return p;
}

export default [syncLead, metalBells, foldBass, driftPad, ringClang];
