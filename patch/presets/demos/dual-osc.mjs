// SPDX-License-Identifier: MIT
// Dual Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
function seqOf(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, {
    length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
  }, { data: steps(notes) });
}

/// Sequencer pitch → `src`, gate → ADSR → VCA. `jacks`: the source's audio outs (one = mono, two = stereo).
/// Returns {amp, out}: `out` are the VCA jacks to take (l, l for a mono source).
function play(p, at, src, seq, jacks, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  p.cable(seq, "pitch", src, o.pitch || "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain");
  if (jacks.length === 1) { p.cable(src, jacks[0], amp, "l"); return { amp, env, out: ["l", "l"] }; }
  p.stereo(src, amp, { from: jacks });
  return { amp, env, out: ["l", "r"] };
}

/// Source jacks → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// A drum loop and a voice mixed together into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}


function complexLead() {
  const p = patch("Dual Osc: Complex Lead", {
    module: "dual-osc", tempo: 104,
    description: "Oscillator B frequency-modulates A while an envelope opens FM Depth and Fold on every note: each note starts bright and metallic and settles to a clearer tone. Change Tune B to pick different FM ratios, or raise Fold for more edge.",
    tags: ["fm", "fold", "complex oscillator", "lead"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 3, 10, 7, 3, 0, 5, 7, 12, 10, 7, 5, 3, 7], { root: "A", rate: "1/8", gate: 0.55 });
  const osc = p.add("dual-osc", [1, 0], { shapeA: 0.3, shapeB: 0, octaveB: 0, tuneB: 7, fmDepth: 0.15, fold: 0.1, balance: 0.2, width: 0.5 });
  const fe = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.4, sustain: 0.1, release: 0.3 }, { name: "Fold Env" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.35, sustain: 0.4, release: 0.3 } });
  p.cable(seq, "pitch", osc, "pitchB").cable(seq, "gate", fe, "gate").cable(seq, "trigger", fe, "retrig")
    .cable(fe, "env", osc, "fmDepth", 0.4).cable(fe, "env", osc, "fold", 0.5);
  finish(p, [3, 0], v.amp, v.out, -7, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

function syncSweep() {
  const p = patch("Dual Osc: Sync Sweep", {
    module: "dual-osc", tempo: 112,
    description: "A is hard-synced to B and the Sync amount is swept by a slow ramp, so the tone tears from a clean saw into a growling, harmonic-rich buzz. Turn Sync by hand to stop the sweep where you like it.",
    tags: ["sync", "sweep", "growl", "bass"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 0, 3, ".", 0, 5, 0, ".", 7, ".", 5, 3, 0, "."], { root: "E", octave: -1, rate: "1/8", gate: 0.6 });
  const osc = p.add("dual-osc", [1, 0], { shapeA: 0.85, shapeB: 0.85, octaveB: 0, sync: 0.4, balance: 0, fold: 0.05 });
  const lfo = p.add("lfo", [1, 2], { wave: "Saw Up", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Sync Ramp" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.25, sustain: 0.6, release: 0.12 } });
  p.cable(seq, "pitch", osc, "pitchB").cable(lfo, "out", osc, "sync", 0.9);
  const lp = p.add("filter", [3, 0], { cutoff: 2500, resonance: 0.2 });
  p.stereo(v.amp, lp, { from: v.out });
  const drums = beat(p, [0, 4], { style: "broken", level: -7 });
  withDrums(p, [4, 0], lp, ["l", "r"], drums, { l1: -3, l2: -5 });
  return p;
}

function widePad() {
  const p = patch("Dual Osc: Drifting Pad", {
    module: "dual-osc", tempo: 66,
    description: "Two softly detuned cores with Drift and Width turned up make a slowly moving stereo pad, with a hint of Fold from a slow LFO. Raise Drift for more instability or pull Tune B further from A for a thicker chord.",
    tags: ["pad", "detune", "stereo", "drift"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_"], { root: "C", scale: "Natural Minor", octave: -1, rate: "1/4", gate: 1 });
  const osc = p.add("dual-osc", [1, 0], { shapeA: 0.55, shapeB: 0.3, octaveB: 0, tuneB: 0.12, fineB: 8, balance: 0.5, drift: 0.5, width: 1, fold: 0.05 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.07 }, { name: "Fold" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 1.2, decay: 1, sustain: 0.85, release: 2.5 } });
  p.cable(seq, "pitch", osc, "pitchB").cable(lfo, "out", osc, "fold", 0.15);
  const lp = p.add("filter", [3, 0], { cutoff: 1800, resonance: 0.15 });
  p.stereo(v.amp, lp, { from: v.out });
  finish(p, [4, 0], lp, ["l", "r"], -11, { size: 0.85, decay: 6.5, mix: 0.4 });
  return p;
}

function ringBells() {
  const p = patch("Dual Osc: Ring Bells", {
    module: "dual-osc", tempo: 78,
    description: "The Ring output multiplies A and B, giving clangorous, bell-like sidebands that die away with each note. Tune B moves the bell from soft and hollow to harsh and tuneless; choose a fifth or a tritone to hear the difference.",
    tags: ["ring modulation", "bells", "metallic", "pluck"],
  });
  const seq = seqOf(p, [0, 0], [0, 7, 3, 12, 5, 10, 7, 2], { root: "D", scale: "Major Pentatonic", octave: 1, rate: "1/4", gate: 0.3 });
  const osc = p.add("dual-osc", [1, 0], { shapeA: 0, shapeB: 0, octaveB: 0, tuneB: 5.5, balance: 0.5 });
  const v = play(p, [2, 0], osc, seq, ["ring"], { env: { attack: 0.002, decay: 1.2, sustain: 0, release: 0.9 } });
  p.cable(seq, "pitch", osc, "pitchB");
  finish(p, [3, 0], v.amp, v.out, 4, { size: 0.7, decay: 5, mix: 0.35 }, 0);
  return p;
}

function foldBass() {
  const p = patch("Dual Osc: Folded Bass", {
    module: "dual-osc", tempo: 90,
    description: "A low note from both cores is driven into the wavefolder; Fold rides a slow LFO and Symmetry shifts the odd and even folds, so the bass flips between mellow and snarling. Try the Exponential FM Mode or a different Symmetry for other growls.",
    tags: ["wavefolder", "bass", "symmetry", "drums"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", ".", 0, 3, ".", 0, ".", 5, "_", 3, ".", 0, ".", 7, 5], { root: "F", octave: -2, rate: "1/8", gate: 0.75 });
  const osc = p.add("dual-osc", [1, 0], { shapeA: 0.2, shapeB: 0, octaveB: 0, fmDepth: 0.1, balance: 0.4, fold: 0.5, symmetry: 0.3 });
  const f = p.add("lfo", [1, 2], { wave: "Triangle", sync: "Tempo", division: "2 bars" }, { name: "Fold" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.2, sustain: 0.7, release: 0.12 } });
  p.cable(seq, "pitch", osc, "pitchB").cable(f, "out", osc, "fold", 0.3);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  withDrums(p, [3, 0], v.amp, v.out, drums, { l1: -4, l2: -6 });
  return p;
}

export default [complexLead, syncSweep, widePad, ringBells, foldBass];
