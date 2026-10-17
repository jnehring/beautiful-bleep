// SPDX-License-Identifier: MIT
// VCA (vca): five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// src (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
/// Mono jack of a node into both inputs of a stereo module.
function mono(p, from, jack, to, l = "l", r = "r") { p.cable(from, jack, to, l).cable(from, jack, to, r); }
/// Two stereo sources blended into Out.
function blend(p, at, a, b, la = -3, lb = -6, aj = ["l", "r"], bj = ["outl", "outr"]) {
  const mix = p.add("audio-mixer", at, { level1: la, level2: lb, master: -1 });
  p.stereo(a, mix, { from: aj, to: ["in1l", "in1r"] }).stereo(b, mix, { from: bj, to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function expPluck() {
  const p = patch("VCA: Exponential Pluck", {
    module: "vca", tempo: 100,
    description: "A saw note shaped by a short envelope into the VCA's Gain, with Response on Exponential so the decay sounds natural and plucked. Switch Response to Linear to hear a stiffer, more abrupt tail, or change the envelope's Decay.",
    tags: ["envelope", "exponential", "pluck", "response", "basic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.4 },
    { data: steps([0, 4, 7, 12, 9, 7, 4, 2, 0, 4, 9, 7, 12, 9, 7, 4]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.8 });
  const env = p.add("adsr", [1, 1], { attack: 0.003, decay: 0.6, sustain: 0.15, release: 0.3 }, { name: "Amp Env" });
  const amp = p.add("vca", [2, 0], { gain: 0, response: "Exponential" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(osc, "out", amp, "l").cable(osc, "out", amp, "r").cable(env, "env", amp, "gain");
  finish(p, [3, 0], amp, 6, { size: 0.55, decay: 2.8, mix: 0.25 });
  return p;
}

function tremolo() {
  const p = patch("VCA: Tremolo Chords", {
    module: "vca", tempo: 88,
    description: "A held chord goes through a VCA whose Gain rests at a middle value while a triangle LFO swings it up and down, a classic tremolo. Raise the LFO Rate for a flutter, change its amount for a deeper chop, or move the VCA's Gain to rebalance.",
    tags: ["tremolo", "lfo", "chords", "amplitude modulation", "gain"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], {
    rate: "1/4", root: "E", scale: "Dorian", octave: -1, shape: 0.6, gatelength: 1, env: { attack: 0.1, decay: 0.3, sustain: 1, release: 0.6 } });
  const o2 = p.add("oscillator", [1, 2], { shape: 0.6, coarse: 7, fine: 6 }, { name: "Fifth" });
  const o3 = p.add("oscillator", [1, 3], { shape: 0.6, coarse: 12, fine: -7 }, { name: "Octave" });
  const sum = p.add("audio-mixer", [2, 2], { level1: -3, level2: -6, level3: -9, master: 0 }, { name: "Chord" });
  p.cable(m.seq, "pitch", o2, "pitch").cable(m.seq, "pitch", o3, "pitch").cable(m.osc, "out", sum, "in1l").cable(o2, "out", sum, "in2l").cable(o3, "out", sum, "in3l");
  const trem = p.add("vca", [3, 0], { gain: 1.2, response: "Linear" }, { name: "Tremolo VCA" });
  const lfo = p.add("lfo", [3, 1], { rate: 5.5, wave: "Triangle" }, { name: "Tremolo" });
  p.cable(sum, "outl", trem, "l").cable(sum, "outl", trem, "r").cable(lfo, "out", trem, "gain", 0.8);
  const gate = p.add("vca", [4, 0], {}, { name: "Note VCA" });
  p.stereo(trem, gate).cable(m.env, "env", gate, "gain");
  finish(p, [5, 0], gate, -14, { size: 0.6, decay: 3.5, mix: 0.3 });
  return p;
}

function linearSwell() {
  const p = patch("VCA: Linear Swell", {
    module: "vca", tempo: 70,
    description: "A very slow attack on the envelope lets a rich pad fade in and out through a VCA with Response set to Linear, so the volume rises evenly instead of rushing in at the end. Compare it with Exponential, or lengthen Attack and Release.",
    tags: ["linear", "swell", "pad", "slow attack", "fade"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_"], {
    rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 0.9, gatelength: 1, env: { attack: 0.01, sustain: 1 } });
  const o2 = p.add("oscillator", [1, 2], { shape: 0.9, coarse: 7, fine: 9 }, { name: "Fifth" });
  const o3 = p.add("oscillator", [1, 3], { shape: 0.9, coarse: 12, fine: -8 }, { name: "Octave" });
  const sum = p.add("audio-mixer", [2, 2], { level1: -3, level2: -6, level3: -9, master: 0 }, { name: "Chord" });
  p.cable(m.seq, "pitch", o2, "pitch").cable(m.seq, "pitch", o3, "pitch").cable(m.osc, "out", sum, "in1l").cable(o2, "out", sum, "in2l").cable(o3, "out", sum, "in3l");
  const env = p.add("adsr", [3, 2], { attack: 3, decay: 1, sustain: 0.8, release: 4 }, { name: "Swell" });
  const amp = p.add("vca", [3, 0], { gain: 0, response: "Linear" });
  p.cable(m.seq, "gate", env, "gate").cable(sum, "outl", amp, "l").cable(sum, "outl", amp, "r").cable(env, "env", amp, "gain", 1);
  finish(p, [4, 0], amp, -6, { size: 0.8, decay: 5, mix: 0.35 });
  return p;
}

function ducking() {
  const p = patch("VCA: Kick Ducking", {
    module: "vca", tempo: 122,
    description: "Every kick fires an envelope that pushes the pad VCA's Gain down by a negative amount, so the chords dip on the beat and swell back between hits. Change the envelope Release for a longer pump, or raise the VCA's Gain for an even bigger pad.",
    tags: ["ducking", "sidechain", "pump", "negative cv", "dance"],
  });
  const m = melody(p, [0, 4], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"], {
    rate: "1/4", root: "F", scale: "Natural Minor", octave: 0, shape: 1, gatelength: 1, env: { attack: 0.02, decay: 0.3, sustain: 1, release: 0.3 } });
  const o2 = p.add("oscillator", [1, 6], { shape: 1, coarse: 7, fine: 8 }, { name: "Fifth" });
  const sum = p.add("audio-mixer", [2, 6], { level1: -3, level2: -7, master: 0 }, { name: "Chord" });
  p.cable(m.seq, "pitch", o2, "pitch").cable(m.amp, "l", sum, "in1l").cable(o2, "out", sum, "in2l");
  const d = beat(p, [0, 0], { style: "four", level: -5 });
  const duck = p.add("adsr", [3, 5], { attack: 0.002, decay: 0.28, sustain: 0, release: 0.1 }, { name: "Duck Env" });
  const pad = p.add("vca", [3, 4], { gain: 1.6, response: "Linear" }, { name: "Pad VCA" });
  p.cable(sum, "outl", pad, "l").cable(sum, "outl", pad, "r").cable(duck, "env", pad, "gain", -0.75);
  const kickTrig = p.add("step-sequencer", [2, 5], { length: 4, rate: "1/4", root: "C", scale: "Chromatic", gatelength: 0.3 }, { name: "Kick Clock", data: steps([0, 0, 0, 0]) });
  p.cable(kickTrig, "gate", duck, "gate").cable(kickTrig, "trigger", duck, "retrig");
  blend(p, [4, 0], pad, d, -13, -9);
  return p;
}

function trancegate() {
  const p = patch("VCA: Rhythm Gate", {
    module: "vca", tempo: 130,
    description: "A sustained saw chord is chopped into a rhythm by a drum-grid track that fires a tight envelope into the VCA's Gain, the stuttering gate used in trance and electro. Edit the pattern, or lengthen the envelope Release to soften the chops.",
    tags: ["gate", "rhythm", "chop", "trance", "envelope"],
  });
  const m = melody(p, [0, 4], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], {
    rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.01, sustain: 1, decay: 0.2, release: 0.2 } });
  const o2 = p.add("oscillator", [1, 6], { shape: 1, coarse: 7, fine: 10 }, { name: "Fifth" });
  const o3 = p.add("oscillator", [1, 7], { shape: 1, coarse: 12, fine: -9 }, { name: "Octave" });
  const sum = p.add("audio-mixer", [2, 6], { level1: -3, level2: -6, level3: -8, master: 0 }, { name: "Chord" });
  p.cable(m.seq, "pitch", o2, "pitch").cable(m.seq, "pitch", o3, "pitch").cable(m.amp, "l", sum, "in1l").cable(o2, "out", sum, "in2l").cable(o3, "out", sum, "in3l");
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Gate", "Kick", "", "", "", "", "", ""], [pattern("Gate", ["xx.xx.x.xx.xx.xx", "X...X...X...X...", "", "", "", "", "", ""])]) });
  const env = p.add("adsr", [3, 5], { attack: 0.002, decay: 0.12, sustain: 0.0, release: 0.05 }, { name: "Gate Env" });
  const amp = p.add("vca", [3, 4], { gain: 0, response: "Linear" }, { name: "Gate VCA" });
  p.cable(grid, "gate1", env, "gate").cable(grid, "gate1", env, "retrig").cable(sum, "outl", amp, "l").cable(sum, "outl", amp, "r").cable(env, "env", amp, "gain", 1);
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  p.cable(grid, "gate2", kick, "trig");
  const mix = p.add("audio-mixer", [4, 0], { level1: -8, level2: -8, master: -1 });
  p.stereo(amp, mix, { to: ["in1l", "in1r"] }).cable(kick, "out", mix, "in2l").cable(kick, "out", mix, "in2r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [expPluck, tremolo, linearSwell, ducking, trancegate];
