// SPDX-License-Identifier: MIT
// Wavetable Osc: five demo patches. Each plays by itself with the transport.
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


function analogScan() {
  const p = patch("Wavetable Osc: Analog Scan", {
    module: "wavetable-osc", tempo: 98,
    description: "A slow LFO scans through the Analog bank, so the tone evolves from soft to sharp and back across a pentatonic line. Change Bank for a different family of tables, or set Scan by hand to pick one spot in the grid.",
    tags: ["scan", "wavetable", "analog", "lead"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 10, 7, 3, 12, 10, 7, 3, 5, 3, 0, 3, 7, "."], { root: "A", rate: "1/8", gate: 0.6 });
  const osc = p.add("wavetable-osc", [1, 0], { bank: "Analog", scan: 0.2, stereo: 0.2, subLevel: 0.15 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.1, wave: "Triangle", polarity: "Unipolar" }, { name: "Scan LFO" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.35, sustain: 0.5, release: 0.3 } });
  p.cable(lfo, "out", osc, "scan", 0.7);
  finish(p, [3, 0], v.amp, v.out, -3, { size: 0.55, decay: 3, mix: 0.25 });
  return p;
}

function vowelTable() {
  const p = patch("Wavetable Osc: Vowel Table", {
    module: "wavetable-osc", tempo: 80,
    description: "The Vowel bank with X and Y wandering under two slow LFOs: the pad seems to murmur through different mouth shapes. Try Frame Blend on Step for abrupt vowel changes instead of smooth morphs.",
    tags: ["vowel", "x/y", "pad", "morph"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"], { root: "D", scale: "Natural Minor", octave: -1, rate: "1/4", gate: 1 });
  const osc = p.add("wavetable-osc", [1, 0], { bank: "Vowel", x: 0.3, y: 0.3, stereo: 0.4, blend: "Smooth" });
  const lx = p.add("lfo", [1, 2], { rate: 0.08, polarity: "Unipolar" }, { name: "X" });
  const ly = p.add("lfo", [1, 3], { rate: 0.13, wave: "Triangle", polarity: "Unipolar" }, { name: "Y" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 1.2, decay: 1, sustain: 0.85, release: 2.2 } });
  p.cable(lx, "out", osc, "x", 0.7).cable(ly, "out", osc, "y", 0.7);
  finish(p, [3, 0], v.amp, v.out, -10, { size: 0.8, decay: 6, mix: 0.4 });
  return p;
}

function spiralPath() {
  const p = patch("Wavetable Osc: Spiral Path", {
    module: "wavetable-osc", tempo: 110,
    description: "With Path set to Spiral, one Scan knob walks the whole 8 by 8 grid in a spiral, and an envelope on Scan sweeps it for every note: each pluck travels through many tables. Try Rows, Snake or Diagonal for other journeys through the grid.",
    tags: ["path", "spiral", "pluck", "envelope"],
  });
  const seq = seqOf(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7, 0, 5, 12, 5, 2, 7, 10, 14], { root: "E", scale: "Minor Pentatonic", rate: "1/8", gate: 0.4 });
  const osc = p.add("wavetable-osc", [1, 0], { bank: "Harmonic", path: "Spiral", scan: 0.1, stereo: 0.25 });
  const se = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.6, sustain: 0.1, release: 0.4 }, { name: "Scan Env" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 0.003, decay: 0.45, sustain: 0.1, release: 0.3 } });
  p.cable(seq, "gate", se, "gate").cable(seq, "trigger", se, "retrig").cable(se, "env", osc, "scan", 0.7);
  const dl = p.add("delay", [3, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.35, mix: 0.25, mode: "Ping-Pong" });
  p.stereo(v.amp, dl, { from: v.out });
  finish(p, [4, 0], dl, ["l", "r"], 2, { size: 0.5, decay: 2.5, mix: 0.2 });
  return p;
}

function bellBank() {
  const p = patch("Wavetable Osc: Bell Bank", {
    module: "wavetable-osc", tempo: 72,
    description: "The Bell bank played softly and slowly, with Y raised a little by each note's envelope, gives glassy, inharmonic chimes. Change X to pick other bells from the grid, or Read to Linear for a rougher, more digital edge.",
    tags: ["bell", "chime", "bank", "ambient"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 7, ".", 12, ".", 9, ".", 4, ".", 7, ".", 2, 5, 7, "."], { root: "C", scale: "Major Pentatonic", octave: 1, rate: "1/8", gate: 0.4 });
  const osc = p.add("wavetable-osc", [1, 0], { bank: "Bell", x: 0.4, y: 0.2, stereo: 0.35, subLevel: 0 });
  const ye = p.add("adsr", [1, 2], { attack: 0.002, decay: 1.2, sustain: 0, release: 1 }, { name: "Y Env" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 0.002, decay: 2, sustain: 0, release: 1.5 } });
  p.cable(seq, "gate", ye, "gate").cable(seq, "trigger", ye, "retrig").cable(ye, "env", osc, "y", 0.4);
  finish(p, [3, 0], v.amp, v.out, -2, { size: 0.75, decay: 5, mix: 0.4 });
  return p;
}

function warpBass() {
  const p = patch("Wavetable Osc: Warp Bass", {
    module: "wavetable-osc", tempo: 100,
    description: "A low sequence on the Fold bank with Warp Mode on Sync and a slow LFO on Warp, plus a little Sub Level, for a bass that snarls and calms over a beat. Switch Warp Mode to Mirror, Squash or Steps for other kinds of damage.",
    tags: ["warp", "bass", "sync", "drums"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 0, ".", 3, ".", 0, 5, 0, "_", ".", 0, 7, ".", 5, 3], { root: "F", octave: -2, rate: "1/8", gate: 0.7 });
  const osc = p.add("wavetable-osc", [1, 0], { bank: "Fold", x: 0.4, y: 0.5, warp: 0.3, warpMode: "Sync", subLevel: 0.4 });
  const lfo = p.add("lfo", [1, 2], { wave: "Triangle", sync: "2 bars", polarity: "Unipolar" }, { name: "Warp" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.2, sustain: 0.7, release: 0.12 } });
  p.cable(lfo, "out", osc, "warp", 0.6);
  const lp = p.add("filter", [3, 0], { cutoff: 1800, resonance: 0.2 });
  p.stereo(v.amp, lp, { from: v.out });
  const drums = beat(p, [0, 4], { style: "broken", level: -7 });
  withDrums(p, [4, 0], lp, ["l", "r"], drums, { l1: -3, l2: -6 });
  return p;
}

export default [analogScan, vowelTable, spiralPath, bellBank, warpBass];
