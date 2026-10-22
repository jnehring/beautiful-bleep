// SPDX-License-Identifier: MIT
// Saturator: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function tubeKeys() {
  const p = patch("Saturator: Tube Warmth", {
    module: "saturator", tempo: 88,
    description: "A thin sine-and-triangle melody gains harmonics from the Tube curve at moderate Drive: rounder, fuller and gently compressed. Raise Drive to move from warmth to overdrive, or compare with the Tape and Diode characters.",
    tags: ["tube", "warm", "harmonics", "drive"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 3, 10, 7, 3, 0, 5, 7, 12, 10, 7, 5, 3, 7],
    { rate: "1/8", shape: 0.1, root: "C", scale: "Natural Minor", gatelength: 0.7, env: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.2 } });
  const s = p.add("saturator", [3, 0], { drive: 0.6, character: "Tube", sag: 0.3, tone: 12000, level: 0.8 });
  feed(p, m.amp, s);
  out(p, [4, 0], s, -2);
  return p;
}

function tapeDrums() {
  const p = patch("Saturator: Tape Drum Bus", {
    module: "saturator", tempo: 94,
    description: "A shuffled beat runs through the Tape curve with some Sag and Age: the peaks soften, the highs round off and the kit glues together. Raise Age for a worn, uneven machine or Drive for heavier compression.",
    tags: ["tape", "drums", "glue", "age"],
  });
  const d = beat(p, [0, 0], { style: "shuffle", level: -6 });
  const s = p.add("saturator", [3, 0], { drive: 0.55, character: "Tape", sag: 0.45, age: 0.5, tone: 9000, level: 0.9 });
  p.stereo(d, s, { from: ["outl", "outr"] });
  out(p, [4, 0], s, 0);
  return p;
}

function diodeLead() {
  const p = patch("Saturator: Diode Bite", {
    module: "saturator", tempo: 116,
    description: "A saw lead hits the Diode curve hard, with Color tilted toward the highs: a bright, snarling edge that stays musical. Pull Color negative for a darker growl, or lower Drive for a cleaner sound.",
    tags: ["diode", "lead", "color", "aggressive"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 0, 12, 10, 0, 0, 7, 0, 5, 3, 5, 7],
    { rate: "1/8", shape: 1, root: "D", scale: "Natural Minor", gatelength: 0.55, env: { attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.1 } });
  const s = p.add("saturator", [3, 0], { drive: 0.85, character: "Diode", color: 0.5, sag: 0.2, tone: 7000, level: 0.45 });
  feed(p, m.amp, s);
  out(p, [4, 0], s, -2);
  return p;
}

function wanderingBias() {
  const p = patch("Saturator: Wandering Bias", {
    module: "saturator", tempo: 76,
    description: "A slow LFO moves Bias on a soft sine pad, so the curve becomes lopsided and even harmonics come and go: the tone drifts between hollow, nasal and full. Change the cable amount to wander more, or switch Character.",
    tags: ["bias", "even harmonics", "modulation", "pad"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 0, root: "F", scale: "Major Pentatonic", gatelength: 0.98, env: { attack: 0.4, decay: 0.4, sustain: 0.9, release: 0.9 } });
  const l = p.add("lfo", [2, 2], { wave: "Sine", sync: "Tempo", division: "4 bars" }, { name: "Bias Drift" });
  const s = p.add("saturator", [3, 0], { drive: 0.7, bias: 0, character: "Tube", color: -0.2, tone: 10000, level: 0.7 });
  feed(p, m.amp, s);
  p.cable(l, "out", s, "bias", 0.8);
  out(p, [4, 0], s, -9);
  return p;
}

function wornMachine() {
  const p = patch("Saturator: Worn Machine", {
    module: "saturator", tempo: 84,
    description: "Bass and a sparse beat go through heavy Sag and Age on the Tape curve: the level sags on loud hits and the sound slowly drifts like a tired old machine. Turn Sag and Age to zero to hear the clean, steady version.",
    tags: ["sag", "age", "drift", "vintage"],
  });
  const m = melody(p, [0, 3], [0, ".", ".", 0, ".", 3, ".", ".", 5, ".", 3, ".", 0, ".", ".", "."],
    { rate: "1/8", shape: 0.4, octave: -2, root: "G", scale: "Natural Minor", gatelength: 0.8 });
  const d = beat(p, [0, 0], { style: "sparse", level: -5 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -3, level2: -2, master: 0 });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const s = p.add("saturator", [4, 0], { drive: 0.75, character: "Tape", sag: 0.9, age: 0.85, tone: 8000, level: 0.8 });
  p.stereo(mix, s, { from: ["outl", "outr"] });
  out(p, [5, 0], s, 0);
  return p;
}

export default [tubeKeys, tapeDrums, diodeLead, wanderingBias, wornMachine];
