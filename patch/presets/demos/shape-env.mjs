// SPDX-License-Identifier: MIT
// Shape Env: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mixes (source, left jack, right jack, level dB) rows into Out 1/2.
function mixOut(p, at, parts, master = 0) {
  const lv = {};
  parts.forEach(([, , , l], i) => { lv[`level${i + 1}`] = l; });
  const mx = p.add("audio-mixer", at, { ...lv, master });
  parts.forEach(([src, jl, jr], i) => p.cable(src, jl, mx, `in${i + 1}l`).cable(src, jr, mx, `in${i + 1}r`));
  p.stereo(mx, p.out, { from: ["outl", "outr"] });
  return mx;
}

function pluckShapes() {
  const p = patch("Shape Env: Pluck Morph", {
    module: "shape-env", tempo: 100,
    description: "A Shape Env triggered by every note replaces the ADSR: it plays a Pluck shape in One-shot mode, and a slow LFO on Morph blends it with its neighbours, so the notes slide between snappy and soft plucks. Browse other shapes with the Shape knob while it plays.",
    tags: ["pluck", "envelope", "morph", "melody"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "A", scale: "Minor Pentatonic", gatelength: 0.5 },
    { data: steps([0, 3, 7, 3, 10, 7, 3, 5]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.8 });
  const flt = p.add("filter", [2, 0], { cutoff: 1500, resonance: 0.2, type: "Ladder Tanh" });
  const amp = p.add("vca", [3, 0]);
  const se = p.add("shape-env", [1, 1], { shape: "Pluck 1:8 soft", time: 0.35, mode: "One-shot", morph: 0.3 });
  const lfo = p.add("lfo", [0, 2], { rate: 0.1, polarity: "Unipolar" }, { name: "Morph Drift" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "trigger", se, "trig").cable(lfo, "out", se, "morph", 0.6)
    .cable(osc, "out", flt, "l").cable(se, "out", flt, "cutoff", 0.35).cable(flt, "l", amp, "l").cable(se, "out", amp, "gain");
  const gm = p.add("audio-mixer", [3, 1], { level1: 6, master: 0 });
  const v = p.add("reverb", [4, 0], { size: 0.6, decay: 2.6, mix: 0.3 });
  p.cable(amp, "l", gm, "in1l").cable(amp, "l", gm, "in1r").stereo(gm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function tranceGate() {
  const p = patch("Shape Env: Gate Pattern", {
    module: "shape-env", tempo: 126,
    description: "A drawn-style gate shape looped over one bar and locked to the song chops a sustained chord into a rhythm, like a trance gate. Change Shape to another of the rhythmic patterns, or sweep Morph to blend between two of them.",
    tags: ["gate", "chopper", "loop", "rhythm"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "D", scale: "Natural Minor", gatelength: 1 },
    { data: steps([0, "_", 5, 3]) });
  const mix = p.add("audio-mixer", [2, 0], { level1: -5, level2: -7, level3: -7, level4: -9, pan1: -0.4, pan2: 0.4, pan3: -0.2, pan4: 0.2, master: 0 });
  [["Root", 0, -6, "-1"], ["Fifth", 7, 4, "0"], ["Octave", 12, -3, "0"], ["Third", 3, 5, "0"]].forEach(([name, c, f, oct], i) => {
    const o = p.add("oscillator", [1, i], { shape: 0.9, coarse: Math.min(c, 12), fine: f, octave: oct }, { name });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const flt = p.add("filter", [3, 0], { cutoff: 2200, resonance: 0.2, type: "SVF Multimode" });
  const amp = p.add("vca", [4, 0]);
  const se = p.add("shape-env", [3, 1], { shape: "x.xxx.x.", mode: "Loop", sync: "1/1", time: 2, morph: 0, level: 1 });
  const lfo = p.add("lfo", [4, 1], { sync: "8 bars", polarity: "Unipolar" }, { name: "Variation" });
  p.stereo(mix, flt, { from: ["outl", "outr"] }).stereo(flt, amp).cable(se, "out", amp, "gain").cable(lfo, "out", se, "morph", 0.7);
  const bt = beat(p, [0, 3], { style: "four", level: -8 });
  const gm = p.add("audio-mixer", [5, 0], { level1: 2, master: -5 });
  const dl = p.add("delay-network", [6, 0], { time: 0.24, taps: 2, feedback: 0.35, mix: 0.25 });
  p.stereo(amp, gm, { to: ["in1l", "in1r"] }).stereo(gm, dl, { from: ["outl", "outr"] });
  mixOut(p, [7, 0], [[dl, "l", "r", -3], [bt, "outl", "outr", -4]], 0);
  return p;
}

function echoingBounce() {
  const p = patch("Shape Env: Echoing Bell", {
    module: "shape-env", tempo: 90,
    description: "Shape Env plays the Echoes 1/8 shape, a burst that repeats itself on the beat grid, once per trigger from a slow melody, so every bell note comes back as a row of echoes without any delay effect. Change Sync or Skew to move the echoes, or try Ping-pong or Bounce 5.",
    tags: ["echo", "bell", "bounce", "rhythmic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "F", scale: "Major Pentatonic", gatelength: 0.1, octave: 1 },
    { data: steps([0, 4, 7, 9, 12, 9, 7, 4]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.0 }, { name: "Bell" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.0, coarse: 7, octave: "+1", fine: 3 }, { name: "Overtone" });
  const mix = p.add("audio-mixer", [2, 0], { level1: 6, level2: -3, pan2: 0.3, master: 6 });
  const amp = p.add("vca", [3, 0], { response: "Linear" });
  const se = p.add("shape-env", [2, 2], { shape: "Echoes 1/8", sync: "1/2", mode: "One-shot", time: 1, skew: 0.2 });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(seq, "trigger", se, "trig")
    .cable(o1, "out", mix, "in1l").cable(o2, "out", mix, "in2l").cable(mix, "outl", amp, "l").cable(se, "out", amp, "gain");
  const gm = p.add("audio-mixer", [3, 1], { level1: 6, master: 6 });
  const v = p.add("reverb", [4, 0], { size: 0.75, decay: 5, mix: 0.4 });
  p.cable(amp, "l", gm, "in1l").cable(amp, "l", gm, "in1r").stereo(gm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function breathingFilter() {
  const p = patch("Shape Env: Breathing Filter", {
    module: "shape-env", tempo: 70,
    description: "The Breathing shape loops every four seconds and opens and closes a low-pass filter on a sustained chord, while Inv, the upside-down shape, moves a second filter band the opposite way. Try other Wobbles shapes or change Time for a slower or faster breath.",
    tags: ["lfo", "breathing", "pad", "filter"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "C", scale: "Dorian", gatelength: 1 }, { data: steps([0, "_", 3, 5]) });
  const mix = p.add("audio-mixer", [2, 0], { level1: -5, level2: -7, level3: -7, pan1: -0.4, pan2: 0.4, master: 0 });
  [["Root", 0, -7, "-1"], ["Fifth", 7, 6, "0"], ["Ninth", 2, -2, "+1"]].forEach(([name, c, f, oct], i) => {
    const o = p.add("oscillator", [1, i], { shape: 0.85, coarse: c, fine: f, octave: oct }, { name });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const se = p.add("shape-env", [2, 2], { shape: "Breathing", mode: "Loop", time: 4, level: 1 });
  const f1 = p.add("filter", [3, 0], { cutoff: 400, resonance: 0.35, type: "SVF Multimode" }, { name: "Breath Filter" });
  const f2 = p.add("filter", [4, 0], { cutoff: 1800, resonance: 0.2, mode: 0.5, type: "SVF Multimode", mix: 0.6 }, { name: "Opposite Filter" });
  p.stereo(mix, f1, { from: ["outl", "outr"] }).cable(se, "out", f1, "cutoff", 0.5).stereo(f1, f2).cable(se, "inv", f2, "cutoff", 0.3);
  const gm = p.add("audio-mixer", [5, 1], { level1: -2, master: 0 });
  const v = p.add("reverb", [6, 0], { size: 0.85, decay: 8, mix: 0.4 });
  p.stereo(f2, gm, { to: ["in1l", "in1r"] }).stereo(gm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function synthDrums() {
  const p = patch("Shape Env: Synth Drums", {
    module: "shape-env", tempo: 110,
    description: "Five Shape Envs build the drums from sine oscillators: Short exp as pitch drop and Pluck as amplitude make a kick and a tom, and the Roll shape fills out a snare of noise. Change Time or the shapes to retune and reshape each drum.",
    tags: ["drums", "synthesis", "pitch envelope", "percussion"],
  });
  const grid = beat(p, [0, 6], { style: "sparse", level: -14 });
  // Shaped kick: Short exp as pitch sweep, Pluck as amplitude
  const kseq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", root: "C", scale: "Chromatic", gatelength: 0.1 },
    { data: steps([0, ".", ".", ".", ".", ".", 0, ".", ".", ".", 0, ".", ".", ".", ".", "."]) });
  const kp = p.add("shape-env", [1, 0], { shape: "Short exp", time: 0.1 }, { name: "Kick Pitch" });
  const ka = p.add("shape-env", [1, 1], { shape: "Pluck 1:8 soft", time: 0.45 }, { name: "Kick Amp" });
  const ko = p.add("oscillator", [2, 0], { shape: 0, octave: "-3", coarse: -2 }, { name: "Kick Osc" });
  const kv = p.add("vca", [3, 0], {}, { name: "Kick VCA" });
  p.cable(kseq, "trigger", kp, "trig").cable(kseq, "trigger", ka, "trig").cable(kp, "out", ko, "pitch", 0.9)
    .cable(ko, "out", kv, "l").cable(ka, "out", kv, "gain");
  // Tom, on the off-beats
  const tseq = p.add("step-sequencer", [0, 2], { length: 16, rate: "1/16", root: "C", scale: "Minor Pentatonic", gatelength: 0.1 },
    { data: steps([".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", 7, ".", 3, 0]) });
  const tp = p.add("shape-env", [1, 2], { shape: "Short exp", time: 0.18 }, { name: "Tom Pitch" });
  const ta = p.add("shape-env", [1, 3], { shape: "Pluck 1:4 soft", time: 0.5 }, { name: "Tom Amp" });
  const to = p.add("oscillator", [2, 2], { shape: 0, octave: "-1" }, { name: "Tom Osc" });
  const tv = p.add("vca", [3, 2], {}, { name: "Tom VCA" });
  p.cable(tseq, "trigger", tp, "trig").cable(tseq, "trigger", ta, "trig").cable(tseq, "pitch", to, "pitch").cable(tp, "out", to, "pitch", 0.5)
    .cable(to, "out", tv, "l").cable(ta, "out", tv, "gain");
  // Snare: noise through a roll envelope on beats 2 and 4
  const sseq = p.add("step-sequencer", [0, 4], { length: 16, rate: "1/16", gatelength: 0.1 },
    { data: steps([".", ".", ".", ".", 0, ".", ".", ".", ".", ".", ".", ".", 0, ".", ".", "."]) });
  const sa = p.add("shape-env", [1, 4], { shape: "Roll", time: 0.3, mode: "One-shot" }, { name: "Snare Roll" });
  const nz = p.add("noise", [2, 4], { colour: 0.4, level: 0.7 });
  const sf = p.add("filter", [3, 4], { cutoff: 1500, resonance: 0.2, mode: 0.5, type: "SVF Multimode" });
  const sv = p.add("vca", [4, 4], {}, { name: "Snare VCA" });
  p.cable(sseq, "trigger", sa, "trig").cable(nz, "out", sf, "l").cable(sf, "l", sv, "l").cable(sa, "out", sv, "gain");
  mixOut(p, [5, 0], [[kv, "l", "l", 0], [tv, "l", "l", -4], [sv, "l", "l", -6], [grid, "outl", "outr", -6]], -3);
  return p;
}

export default [pluckShapes, tranceGate, echoingBounce, breathingFilter, synthDrums];
