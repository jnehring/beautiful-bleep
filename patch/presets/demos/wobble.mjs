// SPDX-License-Identifier: MIT
// Wobble: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Reverb to Out 1/2 from a mono source.
function verbOut(p, at, src, jack, opts = {}) {
  const { gain = 0, ...rest } = opts;
  const m = p.add("audio-mixer", [at[0] - 1, at[1] + 1], { level1: gain, master: 0 });
  const v = p.add("reverb", at, { size: 0.6, decay: 3, mix: 0.3, ...rest });
  p.cable(src, jack, m, "in1l").cable(src, jack, m, "in1r").stereo(m, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

function wanderingMelody() {
  const p = patch("Wobble: Wandering Melody", {
    module: "wobble", tempo: 96,
    description: "Wobble's Stepped output picks a new pitch every eighth note and a Quantizer keeps them in D Dorian, while the Wobble output opens the filter with a springy overshoot. Raise Chaos to make the tune run in streaks, or lower Smooth for sharper filter jumps.",
    tags: ["melody", "random", "quantized", "generative"],
  });
  const w = p.add("wobble", [0, 0], { sync: "1/8", smooth: 0.35, wobble: 0.55, chaos: 0.1, seed: 12 });
  const q = p.add("quantizer", [1, 0], { root: "D", scale: "Dorian" });
  const osc = p.add("oscillator", [2, 0], { shape: 0.55, octave: 0 });
  const flt = p.add("filter", [3, 0], { cutoff: 900, resonance: 0.35, type: "Ladder Tanh" });
  const env = p.add("adsr", [2, 1], { attack: 0.004, decay: 0.28, sustain: 0.1, release: 0.25 });
  const amp = p.add("vca", [4, 0]);
  const gt = p.add("lfo", [0, 1], { wave: "Square", sync: "1/8", pw: 0.4, polarity: "Unipolar" }, { name: "Step Gate" });
  p.cable(w, "stepped", q, "in", 0.5).cable(q, "out", osc, "pitch").cable(osc, "out", flt, "l")
    .cable(w, "wobble", flt, "cutoff", 0.3)
    .cable(gt, "out", env, "gate")
    .cable(flt, "l", amp, "l").cable(env, "env", amp, "gain");
  verbOut(p, [5, 0], amp, "l", { mix: 0.3, gain: 6 });
  return p;
}

function bouncyBass() {
  const p = patch("Wobble: Bouncy Bass", {
    module: "wobble", tempo: 110,
    description: "A bass line goes through a ladder filter whose cutoff is bounced by Wobble's overshooting output, one new value every eighth. Try Wobble at 100 % for wilder rings or Smooth up to soften the jumps.",
    tags: ["bass", "filter", "overshoot", "bounce"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 3, 0, 5, 7], { rate: "1/8", root: "F", scale: "Natural Minor", octave: -1, shape: 0.85,
    env: { decay: 0.2, sustain: 0.6, release: 0.1 }, gatelength: 0.6 });
  const w = p.add("wobble", [0, 2], { sync: "1/8", smooth: 0.4, wobble: 0.85, level: 1, seed: 3 });
  const flt = p.add("filter", [3, 0], { cutoff: 250, resonance: 0.55, drive: 0.25, type: "Ladder Tanh" });
  const mix = p.add("audio-mixer", [4, 0], { level1: 4, master: 0 });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r").cable(w, "wobble", flt, "cutoff", 0.35)
    .cable(flt, "l", mix, "in1l").cable(flt, "r", mix, "in1r");
  const bt = beat(p, [0, 3], { style: "half", level: -8 });
  const mx2 = p.add("audio-mixer", [5, 1], { master: -3 });
  p.cable(mix, "outl", mx2, "in1l").cable(mix, "outr", mx2, "in1r").cable(bt, "outl", mx2, "in2l").cable(bt, "outr", mx2, "in2r")
    .stereo(mx2, p.out, { from: ["outl", "outr"] });
  return p;
}

function burstDrums() {
  const p = patch("Wobble: Burst Rolls", {
    module: "wobble", tempo: 100,
    description: "Wobble's Burst output fires quick rolls of triggers on a quarter-note grid into a tom, while Stepped retunes the tom every step and Compare gates the open hats. Turn Burst up for more rolls and Burst Size for longer ones.",
    tags: ["drums", "rolls", "burst", "percussion"],
  });
  const w = p.add("wobble", [0, 0], { sync: "1/8", burst: 0.5, burstsize: 6, smooth: 0.5, seed: 21 });
  const tom = p.add("punch-tom", [2, 0], { tune: 140, decay: 0.3, bend: 0.4, level: 0.8 });
  const hats = p.add("punch-hats", [2, 1], { level: 0.5 });
  const bt = beat(p, [0, 2], { style: "sparse", level: -8 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -4, level2: -8, pan1: -0.3, pan2: 0.3, master: 0 });
  p.cable(w, "burst", tom, "trig").cable(w, "stepped", tom, "tune", 0.25)
    .cable(w, "compare", hats, "open").cable(w, "clock", hats, "closed")
    .cable(tom, "out", mix, "in1l").cable(hats, "out", mix, "in2l");
  const mx2 = p.add("audio-mixer", [4, 0], { master: -2 });
  p.cable(mix, "outl", mx2, "in1l").cable(mix, "outr", mx2, "in1r").cable(bt, "outl", mx2, "in2l").cable(bt, "outr", mx2, "in2r")
    .stereo(mx2, p.out, { from: ["outl", "outr"] });
  return p;
}

function driftingPad() {
  const p = patch("Wobble: Drifting Pad", {
    module: "wobble", tempo: 72,
    description: "At 0.15 Hz with Smooth at 100 %, Wobble becomes a slow wandering line: Smooth sweeps the filter, Wobble slides the pulse width of two detuned oscillators, Stepped nudges the pitch within a held chord. Try Rate and Chaos for a faster or more restless drift.",
    tags: ["pad", "drift", "slow", "ambient"],
  });
  const w = p.add("wobble", [0, 0], { rate: 0.15, sync: "Free", smooth: 1, wobble: 0.5, chaos: 0.2, seed: 8 });
  const n1 = p.add("oscillator", [1, 0], { shape: 0.8, coarse: 0, fine: -7 }, { name: "Root" });
  const n2 = p.add("oscillator", [1, 1], { shape: 0.8, coarse: 0, fine: 6 }, { name: "Root 2" });
  const n3 = p.add("oscillator", [1, 2], { shape: 0.5, coarse: 7, fine: 3, octave: "0" }, { name: "Fifth" });
  const n4 = p.add("oscillator", [1, 3], { shape: 0.5, coarse: 3, fine: -4, octave: "+1" }, { name: "Third" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -9, level2: -9, level3: -11, level4: -13, pan1: -0.5, pan2: 0.5, pan3: -0.2, pan4: 0.2, master: 0 });
  const flt = p.add("filter", [3, 0], { cutoff: 900, resonance: 0.3, type: "SVF Multimode" });
  [n1, n2, n3, n4].forEach((o, i) => p.cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`));
  p.cable(w, "smooth", flt, "cutoff", 0.3).cable(w, "wobble", n1, "pw", 0.0)
    .cable(w, "stepped", n3, "pitch", 0.04).cable(w, "smooth", n1, "shape", 0.2)
    .stereo(mix, flt, { from: ["outl", "outr"] });
  const v = p.add("reverb", [4, 0], { size: 0.8, decay: 8, mix: 0.4, modDepth: 0.4 });
  p.stereo(flt, v).stereo(v, p.out);
  return p;
}

function sampledArp() {
  const p = patch("Wobble: Sampled Arp", {
    module: "wobble", tempo: 120,
    description: "A slow triangle LFO is sampled by Wobble on every sixteenth through its Sample input, so the Stepped output draws a rising and falling staircase; a Quantizer turns it into an arpeggio. Change the LFO's Sync, or raise Chaos so the line breaks away from the staircase.",
    tags: ["arpeggio", "sample and hold", "sequence", "chaos"],
  });
  const lfo = p.add("lfo", [0, 0], { wave: "Triangle", sync: "4 bars" }, { name: "Staircase" });
  const w = p.add("wobble", [1, 0], { sync: "1/16", smooth: 0.2, wobble: 0.3, chaos: 0.0, seed: 4 });
  const q = p.add("quantizer", [2, 0], { root: "A", scale: "Minor Pentatonic" });
  const osc = p.add("oscillator", [3, 0], { shape: 0.3 });
  const env = p.add("adsr", [3, 1], { attack: 0.002, decay: 0.15, sustain: 0, release: 0.1 });
  const amp = p.add("vca", [4, 0]);
  const gt = p.add("lfo", [1, 1], { wave: "Square", sync: "1/16", pw: 0.4, polarity: "Unipolar" }, { name: "Step Gate" });
  p.cable(lfo, "out", w, "sample").cable(w, "stepped", q, "in", 0.6).cable(q, "out", osc, "pitch")
    .cable(w, "clock", env, "gate").cable(gt, "out", env, "gate")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain", 0.9);
  const dl = p.add("delay-network", [5, 0], { time: 0.375, taps: 3, feedback: 0.45, mix: 0.3, scatter: 0.3 });
  p.cable(amp, "l", dl, "l").cable(amp, "l", dl, "r").stereo(dl, p.out);
  return p;
}

export default [wanderingMelody, bouncyBass, burstDrums, driftingPad, sampledArp];
