// SPDX-License-Identifier: MIT
// Utility: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function sampleHold() {
  const p = patch("Utility: Sample and Hold Melody", {
    module: "utility", tempo: 108,
    description: "A slow triangle LFO is sampled by an eighth-note clock in Sample & Hold mode, and the stepped result is snapped to a scale to play the oscillator: a tune that never repeats. Change the LFO rate for a different walk, or pick another Mode to hear the raw values.",
    tags: ["sample and hold", "generative", "melody", "stepped"],
  });
  const clock = p.add("lfo", [0, 0], { wave: "Square", sync: "1/8", polarity: "Unipolar", pw: 0.45 }, { name: "Clock" });
  const walk = p.add("lfo", [0, 1], { wave: "Triangle", rate: 0.23 }, { name: "Walker" });
  const u = p.add("utility", [1, 0], { mode: "Sample & Hold" });
  const q = p.add("quantizer", [2, 0], { root: "D", scale: "Minor Pentatonic", range: 1.4 });
  const osc = p.add("oscillator", [3, 0], { shape: 0.7 });
  const env = p.add("adsr", [3, 1], { attack: 0.004, decay: 0.22, sustain: 0.1, release: 0.15 });
  const f = p.add("filter", [4, 0], { cutoff: 1500, resonance: 0.2, type: "Ladder Tanh" });
  const vca = p.add("vca", [5, 0], {});
  p.cable(walk, "out", u, "x").cable(clock, "out", u, "clock").cable(u, "out", q, "in").cable(q, "out", osc, "pitch")
    .cable(clock, "out", env, "gate").cable(osc, "out", f, "l").cable(f, "l", vca, "l").cable(env, "env", vca, "gain");
  finish(p, [6, 0], vca, "l", 4, { decay: 2.5 });
  return p;
}

function portamento() {
  const p = patch("Utility: Slew Glide", {
    module: "utility", tempo: 96,
    description: "The sequencer's pitch passes through the Utility's Slew before it reaches the oscillator, so every leap turns into a slide. Turn Slew down for sharp steps, or up until the notes smear into one long wail.",
    tags: ["slew", "portamento", "glide", "lead"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Minor Pentatonic", octave: 0, gatelength: 0.9 },
    { data: steps([0, "_", 7, "_", 12, 10, "_", 7, 3, "_", 5, "_", 12, "_", 15, 12]) });
  const u = p.add("utility", [1, 0], { slew: 0.12 });
  const osc = p.add("oscillator", [2, 0], { shape: 0.5 });
  const f = p.add("filter", [3, 0], { cutoff: 1300, resonance: 0.25, type: "Ladder Tanh" });
  const env = p.add("adsr", [2, 1], { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.2 });
  const vca = p.add("vca", [4, 0], {});
  p.cable(seq, "pitch", u, "x").cable(u, "out", osc, "pitch").cable(seq, "gate", env, "gate").cable(osc, "out", f, "l")
    .cable(f, "l", vca, "l").cable(env, "env", vca, "gain");
  const drums = beat(p, [0, 3], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -6, master: -2 });
  p.cable(vca, "l", mix, "in1l").cable(vca, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2.2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function folded() {
  const p = patch("Utility: Folded Sweeps", {
    module: "utility", tempo: 102,
    description: "Two slow LFOs are added in the Utility and together they swing past plus and minus one, where Fold reflects them back, so the filter on the arpeggio keeps turning around at new places. Switch Mode to Through to hear the same sweeps without the folds.",
    tags: ["fold", "mixing", "filter sweep", "modulation"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14], { rate: "1/16", shape: 0.9, root: "A", scale: "Natural Minor", gatelength: 0.4,
    env: { attack: 0.003, decay: 0.15, sustain: 0.1, release: 0.1 } });
  const a = p.add("lfo", [0, 2], { rate: 0.13 }, { name: "Slow A" });
  const b = p.add("lfo", [0, 3], { wave: "Triangle", rate: 0.31 }, { name: "Slow B" });
  const u = p.add("utility", [1, 2], { mode: "Fold", scalex: 1, scaley: 1, slew: 0.03 });
  const f = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.4, type: "Ladder Tanh" });
  p.cable(a, "out", u, "x").cable(b, "out", u, "y").cable(u, "out", f, "cutoff", 0.3).cable(m.amp, "l", f, "l");
  finish(p, [4, 0], f, "l", 3, { decay: 2 });
  return p;
}

function comparator() {
  const p = patch("Utility: Comparator Claps", {
    module: "utility", tempo: 120,
    description: "A slow triangle plus a fast sine run through the Utility, and its Gate output goes high whenever the sum rises above Threshold: the ripples cross the line in bursts and trigger the claps. Move Threshold to make the claps sparse or dense.",
    tags: ["comparator", "threshold", "gate", "drums"],
  });
  const slow = p.add("lfo", [0, 0], { wave: "Triangle", sync: "1 bar" }, { name: "Slow Wave" });
  const fast = p.add("lfo", [0, 1], { wave: "Sine", sync: "1/8" }, { name: "Ripple" });
  const u = p.add("utility", [1, 0], { scalex: 0.9, scaley: 0.5, threshold: 0.45 });
  const clap = p.add("punch-clap", [2, 0], { tone: 1800, decay: 0.3 });
  const drums = beat(p, [0, 3], { style: "sparse", level: -4 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -4, level3: -5, master: 0 });
  p.cable(slow, "out", u, "x").cable(fast, "out", u, "y").cable(u, "gate", clap, "trig")
    .cable(clap, "out", mix, "in1l").cable(clap, "out", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const bass = melody(p, [0, 6], [0, ".", 0, ".", 3, ".", 5, "."], { rate: "1/4", shape: 0.3, root: "C", scale: "Natural Minor", octave: -2, gatelength: 0.7,
    env: { decay: 0.3, sustain: 0.4, release: 0.1 } });
  p.cable(bass.amp, "l", mix, "in3l").cable(bass.amp, "l", mix, "in3r");
  const v = p.add("reverb", [5, 0], { size: 0.45, decay: 1.8, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function rectified() {
  const p = patch("Utility: Rectified Tremolo", {
    module: "utility", tempo: 80,
    description: "A sine LFO into Rectify mode flips its negative half upwards, so the pad's volume pulses at twice the LFO speed, always rising from silence. Change the LFO rate for a slow pulse or a fast shimmer, or switch Mode to Through for a plain tremolo.",
    tags: ["rectify", "tremolo", "pad", "amplitude"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 1 },
    { data: steps([0, 3, 5, 7]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.6, fine: -6 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.6, fine: 6, coarse: 7 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, level2: -9, pan1: -0.3, pan2: 0.3, master: -4 });
  const lfo = p.add("lfo", [1, 3], { rate: 3.2 }, { name: "Tremolo" });
  const u = p.add("utility", [2, 3], { mode: "Rectify" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r")
    .cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r").stereo(mix, vca, { from: ["outl", "outr"] })
    .cable(lfo, "out", u, "x").cable(u, "out", vca, "gain");
  const v = p.add("reverb", [4, 0], { size: 0.65, decay: 4, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(vca, v).stereo(v, p.out);
  return p;
}

export default [sampleHold, portamento, folded, comparator, rectified];
