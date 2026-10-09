// SPDX-License-Identifier: MIT
// Dual Filter: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source `amp` → Dual Filter l and r; returns nothing. Caller wires the filter's output.
function feed(p, amp, f) { p.cable(amp, "l", f, "l").cable(amp, "l", f, "r"); }
/// Filter → mixer trim (dB) → reverb → Out.
function room(p, at, src, opts = {}, trim = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  p.stereo(src, t, { to: ["in1l", "in1r"] });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.3, quality: "Eco (8 lines)", ...opts });
  p.stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

function vowelPad() {
  const p = patch("Dual Filter: Vowel Pad", {
    module: "dual-filter", tempo: 72,
    description: "A saw pad runs through two band-pass filters in parallel, a formant pair that a slow LFO on Spread slides between vowels. Try Res 1 and Res 2 for a sharper or breathier voice.",
    tags: ["formant", "vowel", "pad", "parallel"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "D", scale: "Dorian", gatelength: 0.95, env: { attack: 0.4, decay: 0.5, sustain: 0.85, release: 1.2 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 700, spread: 1.4, res1: 0.7, res2: 0.65, mode1: 0.5, mode2: 0.5, routing: "Parallel", mix: 1, drive: 0.1 });
  const lfo = p.add("lfo", [2, 1], { rate: 0.09, wave: "Sine" }, { name: "Vowel" });
  const lfo2 = p.add("lfo", [3, 1], { rate: 0.037, wave: "Triangle" }, { name: "Drift" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "spread", 0.25).cable(lfo2, "out", f, "cutoff", 0.12);
  room(p, [4, 0], f, { size: 0.65, decay: 4, mix: 0.35 }, -14);
  return p;
}

function bandBass() {
  const p = patch("Dual Filter: Wide Band Bass", {
    module: "dual-filter", tempo: 104,
    description: "A growly saw bass in Serial with a high-pass on filter 1 and a low-pass on filter 2: a band whose width is Spread and whose position is Cutoff. A beat keeps time; try Spread and Drive.",
    tags: ["bass", "serial", "band-pass", "drive"],
  });
  const m = melody(p, [0, 0], [0, 0, ".", 0, 7, ".", 5, 3, 0, 0, ".", 0, 10, ".", 7, 5],
    { rate: "1/8", shape: 1, root: "E", scale: "Natural Minor", octave: -1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.5, release: 0.1 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 400, spread: 1.6, res1: 0.35, res2: 0.5, mode1: 1, mode2: 0, routing: "Serial", drive: 0.45, character: "Saturating", mix: 1 });
  const lfo = p.add("lfo", [2, 1], { wave: "Triangle", sync: "2 bars" }, { name: "Sweep" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -9, master: -3 });
  const drums = beat(p, [0, 3], { style: "half", level: -4 });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "cutoff", 0.22).stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function stereoBreath() {
  const p = patch("Dual Filter: Stereo Breath", {
    module: "dual-filter", tempo: 88,
    description: "One mono arpeggio goes in on the left; in Stereo routing each filter takes a channel and Spread places their cutoffs apart, so an LFO on Spread makes the image breathe left and right. Change Resonance for more ring.",
    tags: ["stereo", "arpeggio", "width", "movement"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 12, 11, 7, 4], { rate: "1/8", shape: 0.9, root: "A", scale: "Major Pentatonic", gatelength: 0.5, env: { decay: 0.3, sustain: 0.15, release: 0.3 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 1100, spread: 1.2, res1: 0.5, res2: 0.5, mode1: 0, mode2: 0, routing: "Stereo", mix: 1 });
  const lfo = p.add("lfo", [2, 1], { rate: 0.18, wave: "Sine" }, { name: "Breath" });
  p.cable(m.amp, "l", f, "l").cable(lfo, "out", f, "spread", 0.6);
  room(p, [4, 0], f, { size: 0.45, decay: 2 }, -3);
  return p;
}

function notchSweep() {
  const p = patch("Dual Filter: Notch Sweep", {
    module: "dual-filter", tempo: 112,
    description: "Parallel with the second filter inverted turns two band-passes into a steep notch. It sweeps through a bright saw riff over a beat; Spread widens the hole in the sound.",
    tags: ["notch", "sweep", "riff", "inverted"],
  });
  const m = melody(p, [0, 0], [0, 0, 3, ".", 7, 5, ".", 3, 0, ".", 10, 7, 5, 3, ".", 2],
    { rate: "1/8", shape: 1, root: "G", scale: "Minor Pentatonic", gatelength: 0.55, env: { decay: 0.25, sustain: 0.4, release: 0.15 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 900, spread: 0.7, res1: 0.35, res2: 0.35, mode1: 0.5, mode2: 0.5, routing: "Parallel (F2 inverted)", mix: 1 });
  const lfo = p.add("lfo", [2, 1], { wave: "Triangle", sync: "4 bars" }, { name: "Sweep" });
  const lfo2 = p.add("lfo", [3, 1], { wave: "Sine", sync: "2 bars" }, { name: "Width" });
  const mix = p.add("audio-mixer", [4, 0], { level1: 4, level2: -6, master: 0 });
  const drums = beat(p, [0, 3], { style: "four", level: -5 });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "cutoff", 0.35).cable(lfo2, "out", f, "spread", 0.2)
    .stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function mirrorMorph() {
  const p = patch("Dual Filter: Mirror Morph", {
    module: "dual-filter", tempo: 96,
    description: "With Link on Mirror, one slow LFO on Mode 1 morphs the pair from two low-passes through band-pass to two notches, mirrored on the other filter, while Saturating Character adds bite. Sweep Mode 1 and Mode 2 by hand.",
    tags: ["morph", "mirror", "saturating", "lead"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7, 0, 5, 12, 5, 2, 7, 9, 7],
    { rate: "1/8", shape: 0.75, root: "C", scale: "Natural Minor", octave: 0, gatelength: 0.6, env: { decay: 0.3, sustain: 0.35, release: 0.3 } });
  const f = p.add("dual-filter", [3, 0], { cutoff: 1300, spread: 0.9, res1: 0.55, res2: 0.55, mode1: 0.3, mode2: 0.3, routing: "Serial", link: "Mirror", character: "Saturating", drive: 0.3, mix: 1 });
  const lfo = p.add("lfo", [2, 1], { rate: 0.11, wave: "Sine" }, { name: "Morph" });
  feed(p, m.amp, f);
  p.cable(lfo, "out", f, "mode1", 0.5);
  room(p, [4, 0], f, { decay: 3, mix: 0.3 }, -1);
  return p;
}

export default [vowelPad, bandBass, stereoBreath, notchSweep, mirrorMorph];
