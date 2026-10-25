// SPDX-License-Identifier: MIT
// Contour: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function pluckLib() {
  const p = patch("Contour: Pluck Library", {
    module: "shape-env", tempo: 100,
    description: "Every note triggers a one-shot shape from the library, a soft 1:8 pluck, that opens both volume and filter. Try the other plucks, Bounce and Echoes shapes, or move Morph to change its curve.",
    tags: ["one-shot", "pluck", "shape library", "melody"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.4 },
    { data: steps([0, 4, 7, 9, 12, 9, 7, 4, 2, 5, 9, 12, 9, 5, 4, 2]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.75 });
  const env = p.add("shape-env", [1, 1], { shape: "Pluck 1:8 soft", time: 0.45, morph: 0.25, mode: "One-shot" });
  const f = p.add("filter", [2, 0], { cutoff: 400, resonance: 0.25, type: "Ladder Tanh" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "trigger", env, "trig").cable(osc, "out", f, "l").cable(env, "out", f, "cutoff", 0.55)
    .cable(f, "l", vca, "l").cable(env, "out", vca, "gain");
  finish(p, [4, 0], vca, "l", 3, { decay: 2.2 });
  return p;
}

function wobbleBass() {
  const p = patch("Contour: Looping Wobble Bass", {
    module: "shape-env", tempo: 96,
    description: "In Loop mode the Wobble shape repeats once per beat and swings the cutoff of a held bass, locked to the tempo. Switch Sync to another note length for faster or slower wobble, or try Double wobble and Swing wobble.",
    tags: ["loop", "wobble", "bass", "synced"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/4", root: "F", scale: "Natural Minor", octave: -2, gatelength: 1 },
    { data: steps([0, "_", "_", "_", 3, "_", "_", "_", 5, "_", "_", "_", 2, "_", "_", "_"]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.9 });
  const lfo = p.add("shape-env", [1, 1], { shape: "Wobble", mode: "Loop", sync: "1/4", level: 1 }, { name: "Wobble" });
  const f = p.add("filter", [2, 0], { cutoff: 250, resonance: 0.45, type: "Ladder Tanh", drive: 0.25 });
  const vca = p.add("vca", [3, 0], { gain: 1 });
  p.cable(seq, "pitch", osc, "pitch").cable(osc, "out", f, "l").cable(lfo, "out", f, "cutoff", 0.6).cable(f, "l", vca, "l");
  const drums = beat(p, [0, 3], { style: "half", level: -5 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -10, level2: -6, master: -1 });
  p.cable(vca, "l", mix, "in1l").cable(vca, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function breathing() {
  const p = patch("Contour: Breathing Pad", {
    module: "shape-env", tempo: 66,
    description: "A pad is held steady while one looped Contour breathes its volume over two bars and a second one slowly sways its filter over four. Choose Heartbeat or Sway shapes, or change Sync, and the whole pad takes on a new pulse.",
    tags: ["pad", "loop", "slow", "ambient"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "D", scale: "Dorian", octave: 0, gatelength: 1 },
    { data: steps([0, 7, 5, 3]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.7, fine: -8 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.7, fine: 8, coarse: 7 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -7, level2: -11, pan1: -0.4, pan2: 0.4, master: 3 });
  const f = p.add("filter", [3, 0], { cutoff: 900, resonance: 0.1, type: "SVF Multimode" });
  const breath = p.add("shape-env", [1, 2], { shape: "Breathing", mode: "Loop", sync: "2 bars" }, { name: "Breath" });
  const sway = p.add("shape-env", [2, 2], { shape: "Sway", mode: "Loop", sync: "4 bars" }, { name: "Sway" });
  const vca = p.add("vca", [4, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch");
  p.cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r").cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r")
    .stereo(mix, f, { from: ["outl", "outr"] }).cable(sway, "out", f, "cutoff", 0.25).stereo(f, vca).cable(breath, "out", vca, "gain");
  const v = p.add("reverb", [5, 0], { size: 0.75, decay: 7, mix: 0.35, quality: "Eco (8 lines)" });
  p.stereo(vca, v).stereo(v, p.out);
  return p;
}

function stabs() {
  const p = patch("Contour: Drawn Rhythm Gate", {
    module: "shape-env", tempo: 118,
    description: "The rhythm shapes are patterns drawn as amplitude: one looping shape chops a held chord into syncopated stabs, another carves a bass note into a different pattern. Pick any of the x.xx shapes, or change Sync, to make a new groove.",
    tags: ["rhythm shapes", "loop", "chop", "groove"],
  });
  const chord = p.add("step-sequencer", [0, 0], { length: 2, rate: "1/1", root: "A", scale: "Natural Minor", octave: 0, gatelength: 1 },
    { data: steps([0, 5]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.7 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.7, coarse: 7 });
  const o3 = p.add("oscillator", [1, 2], { shape: 0.7, coarse: 3, octave: "+1" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -9, level2: -10, level3: -12, pan1: -0.3, pan3: 0.3, master: 0 });
  const vca = p.add("vca", [3, 0], {});
  const rh = p.add("shape-env", [2, 1], { shape: "x.xxx.x.", mode: "Loop", sync: "1/2" }, { name: "Chord Rhythm" });
  const bs = p.add("oscillator", [1, 4], { shape: 0.4, octave: "-2" }, { name: "Bass" });
  const bvca = p.add("vca", [3, 4], {});
  const br = p.add("shape-env", [2, 4], { shape: "x..x..x...x..x..", mode: "Loop", sync: "1/1" }, { name: "Bass Rhythm" });
  p.cable(chord, "pitch", o1, "pitch").cable(chord, "pitch", o2, "pitch").cable(chord, "pitch", o3, "pitch").cable(chord, "pitch", bs, "pitch");
  p.cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r").cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r")
    .cable(o3, "out", mix, "in3l").cable(o3, "out", mix, "in3r").stereo(mix, vca, { from: ["outl", "outr"] }).cable(rh, "out", vca, "gain")
    .cable(bs, "out", bvca, "l").cable(br, "out", bvca, "gain");
  const drums = beat(p, [0, 6], { style: "four", level: -6 });
  const fm = p.add("audio-mixer", [4, 0], { level1: -7, level2: -4, level3: -8, pan1: 0, master: 0 });
  p.stereo(vca, fm, { to: ["in1l", "in1r"] }).cable(bvca, "l", fm, "in2l").cable(bvca, "l", fm, "in2r")
    .stereo(drums, fm, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.6, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(fm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function reversed() {
  const p = patch("Contour: Reversed Swells", {
    module: "shape-env", tempo: 84,
    description: "With Reverse on, a plucked shape plays backwards: each note swells up and is cut off at its peak, like a tape played in reverse. Switch Reverse off for normal plucks, or lengthen Time for slower swells.",
    tags: ["reverse", "swell", "backwards", "pluck"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.4 },
    { data: steps([0, 7, 3, 10, 12, 10, 7, 3]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.4 });
  const env = p.add("shape-env", [1, 1], { shape: "Pluck 1:4 soft", time: 0.55, reverse: true, mode: "One-shot" });
  const f = p.add("filter", [2, 0], { cutoff: 800, resonance: 0.2, type: "SVF Multimode" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "trigger", env, "trig").cable(osc, "out", f, "l").cable(env, "out", f, "cutoff", 0.4)
    .cable(f, "l", vca, "l").cable(env, "out", vca, "gain");
  finish(p, [4, 0], vca, "l", -1, { size: 0.7, decay: 4.5, mix: 0.35 });
  return p;
}

export default [pluckLib, wobbleBass, breathing, stabs, reversed];
