// SPDX-License-Identifier: MIT
// Multiplier: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function bells() {
  const p = patch("Multiplier: Ring Mod Bells", {
    module: "multiplier", tempo: 78,
    description: "Two sine oscillators multiplied together make only their sum and difference tones, which are not whole-number multiples of the note: clangorous bells that fade with each strike. Change the second oscillator's Coarse to retune the bell.",
    tags: ["ring modulation", "bells", "inharmonic", "pluck"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, 7, 4, 9, 12, 9, 7, 2]) });
  const a = p.add("oscillator", [1, 0], { shape: 0 }, { name: "Carrier" });
  const b = p.add("oscillator", [1, 1], { shape: 0, coarse: 5.4, octave: "+1" }, { name: "Modulator" });
  const m = p.add("multiplier", [2, 0], { gain1: 1 });
  const env = p.add("adsr", [2, 1], { attack: 0.002, decay: 1.2, sustain: 0, release: 1 }, { name: "Bell Env" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", a, "pitch").cable(seq, "pitch", b, "pitch").cable(a, "out", m, "x1").cable(b, "out", m, "y1")
    .cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(m, "out1", vca, "l").cable(env, "env", vca, "gain");
  finish(p, [4, 0], vca, "l", 2, { size: 0.65, decay: 4.5, mix: 0.33 });
  return p;
}

function tremolo() {
  const p = patch("Multiplier: Offset Tremolo", {
    module: "multiplier", tempo: 100,
    description: "A saw melody goes into X1 and a sine LFO into Y1, with Bias Y1 lifting the LFO above zero so it works as a smooth tremolo; without the bias the sound would also flip its phase. Lower Bias Y1 toward zero for a deeper, rougher ring.",
    tags: ["tremolo", "amplitude modulation", "bias", "lfo"],
  });
  const m0 = melody(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3], { rate: "1/4", shape: 0.8, root: "A", scale: "Natural Minor", gatelength: 0.9,
    env: { attack: 0.01, decay: 0.4, sustain: 0.7, release: 0.2 } });
  const lfo = p.add("lfo", [0, 2], { rate: 6.5 }, { name: "Tremolo LFO" });
  const m = p.add("multiplier", [3, 0], { biasy1: 1, gain1: 0.5 });
  p.cable(m0.amp, "l", m, "x1").cable(lfo, "out", m, "y1");
  finish(p, [4, 0], m, "out1", 4, { decay: 2 });
  return p;
}

function scaled() {
  const p = patch("Multiplier: Envelope Times LFO", {
    module: "multiplier", tempo: 108,
    description: "Every note's decay envelope is multiplied by a slow LFO before it reaches the filter, so the notes open the filter wide when the LFO is high, hardly at all when it is low and even invert when it dips below zero. Raise Bias Y1 to keep the LFO positive.",
    tags: ["scaling modulation", "envelope", "filter", "lfo"],
  });
  const m0 = melody(p, [0, 0], [0, 0, 7, 12, 10, 7, 3, 5, 0, 0, 7, 12, 15, 12, 10, 7], { rate: "1/8", shape: 0.9, root: "E", scale: "Natural Minor", octave: -1, gatelength: 0.4,
    env: { attack: 0.003, decay: 0.18, sustain: 0.3, release: 0.12 } });
  const fe = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.2, sustain: 0, release: 0.1 }, { name: "Filter Env" });
  const lfo = p.add("lfo", [1, 3], { sync: "4 bars" }, { name: "Slow LFO" });
  const m = p.add("multiplier", [2, 2], { biasy1: 0.2, gain1: 1 });
  const f = p.add("filter", [3, 0], { cutoff: 250, resonance: 0.4, type: "Ladder Tanh", drive: 0.2 });
  p.cable(m0.seq, "gate", fe, "gate").cable(m0.seq, "trigger", fe, "retrig").cable(fe, "env", m, "x1").cable(lfo, "out", m, "y1")
    .cable(m, "out1", f, "cutoff", 0.7).cable(m0.amp, "l", f, "l");
  const drums = beat(p, [0, 4], { style: "four", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 1, level2: -5, master: -1 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function stereoPair() {
  const p = patch("Multiplier: Twin Ring Modulators", {
    module: "multiplier", tempo: 90,
    description: "Both multipliers ring-modulate the same saw melody, one with a modulator at a fifth above and one at a ratio that sits between notes, and each goes to its own side: left is nearly musical, right is metallic. Change either modulator's Coarse to move the clangour.",
    tags: ["ring modulation", "stereo", "two channels", "metallic"],
  });
  const m0 = melody(p, [0, 0], [0, 7, 3, 10, 5, 12, 8, 3], { rate: "1/8", shape: 0.75, root: "D", scale: "Dorian", gatelength: 0.5,
    env: { attack: 0.004, decay: 0.3, sustain: 0.25, release: 0.2 } });
  const a = p.add("oscillator", [1, 2], { shape: 0, coarse: 7 }, { name: "Mod Left" });
  const b = p.add("oscillator", [1, 3], { shape: 0, coarse: 3.4, octave: "+1" }, { name: "Mod Right" });
  const m = p.add("multiplier", [3, 0], { gain1: 1, gain2: 1 });
  p.cable(m0.seq, "pitch", a, "pitch").cable(m0.seq, "pitch", b, "pitch").cable(m0.amp, "l", m, "x1").cable(m0.amp, "l", m, "x2")
    .cable(a, "out", m, "y1").cable(b, "out", m, "y2");
  const mix = p.add("audio-mixer", [4, 0], { level1: 4, level2: 0, pan1: -0.7, pan2: 0.7, master: 5 });
  p.cable(m, "out1", mix, "in1l").cable(m, "out1", mix, "in1r").cable(m, "out2", mix, "in2l").cable(m, "out2", mix, "in2r");
  const v = p.add("reverb", [5, 0], { size: 0.55, decay: 3, mix: 0.25, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function robotDrums() {
  const p = patch("Multiplier: Robot Drums", {
    module: "multiplier", tempo: 112,
    description: "A whole drum loop is multiplied by a low sine so each hit turns pitched and robotic, mixed with the untouched loop underneath. Raise Oversampling to keep the highs clean, or change the sine's Coarse to tune the robot.",
    tags: ["drums", "ring modulation", "robot", "oversampling"],
  });
  const drums = beat(p, [0, 0], { style: "broken", level: -8 });
  const sine = p.add("oscillator", [3, 2], { shape: 0, octave: "-1", coarse: 3 }, { name: "Robot Tone" });
  const m = p.add("multiplier", [3, 0], { gain1: 1.4, oversampling: "2x" });
  p.cable(drums, "outl", m, "x1").cable(sine, "out", m, "y1");
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: -2, master: 3 });
  p.cable(m, "out1", mix, "in1l").cable(m, "out1", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.5, mix: 0.15, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [bells, tremolo, scaled, stereoPair, robotDrums];
