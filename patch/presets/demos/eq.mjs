// SPDX-License-Identifier: MIT
// EQ: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}
/// A bright saw riff, rich enough for the EQ to bite.
const riff = (p, o = {}) => melody(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3, 0, 5, 8, 12, 15, 12, 8, 5],
  { rate: "1/8", shape: 1, root: "A", scale: "Natural Minor", gatelength: 0.8, env: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.12 }, ...o });

function radioVoice() {
  const p = patch("EQ: Small Radio", {
    module: "eq", tempo: 100,
    description: "A full-range saw riff and a beat are squeezed through a steep Low Cut, a steep High Cut and a Bell boost in the midrange: the sound shrinks to a tiny speaker. Switch bands 1 and 6 off to open the sound again, or move the Bell around.",
    tags: ["lo-fi", "low cut", "high cut", "band-limiting"],
  });
  const m = riff(p);
  const d = beat(p, [0, 3], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -3, level2: -3, master: 0 });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const e = p.add("eq", [4, 0], {
    b1On: true, b1Type: "Low Cut", b1Hz: 500, b1Slope: "24 dB/oct",
    b3Type: "Bell", b3Hz: 1400, b3Gain: 9, b3Q: 1.5,
    b6On: true, b6Type: "High Cut", b6Hz: 3200, b6Slope: "24 dB/oct", level: 3,
  });
  p.stereo(mix, e, { from: ["outl", "outr"] });
  out(p, [5, 0], e, -9);
  return p;
}

function wahBell() {
  const p = patch("EQ: Sweeping Bell Wah", {
    module: "eq", tempo: 108,
    description: "A narrow Bell boosted by 14 dB glides up and down the spectrum under an LFO on its Freq, so the riff sings like a wah pedal. Widen Q for a gentler vowel, or give the LFO a faster rate.",
    tags: ["wah", "modulation", "bell", "lfo", "resonant"],
  });
  const m = riff(p, { rate: "1/16" });
  const l = p.add("lfo", [2, 2], { wave: "Triangle", sync: "1 bar" }, { name: "Wah LFO" });
  const e = p.add("eq", [3, 0], { b3Type: "Bell", b3Hz: 900, b3Gain: 14, b3Q: 5, b2On: false, b4On: false, b5On: false, level: -6 });
  feed(p, m.amp, e);
  p.cable(l, "out", e, "b3Hz", 0.6);
  out(p, [4, 0], e, -2);
  return p;
}

function warmRoom() {
  const p = patch("EQ: Warm Bus Tilt", {
    module: "eq", tempo: 96,
    description: "A mix of bass, riff and drums gets a Low Shelf lift, a small Bell cut in the muddy low mids and a High Shelf cut: a darker, rounder balance. Flip the Shelf gains to the other side for a bright, thin version.",
    tags: ["tone shaping", "shelf", "mix bus", "warm"],
  });
  const m = riff(p, { rate: "1/8", shape: 0.9 });
  const b = melody(p, [0, 2], [0, ".", 0, ".", 5, ".", 3, "."], { rate: "1/4", shape: 0.4, octave: -2, root: "A", scale: "Natural Minor", gatelength: 0.8 });
  const d = beat(p, [0, 5], { style: "broken", level: -8 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -6, level2: -3, level3: -1, master: 0 });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").cable(b.amp, "l", mix, "in2l").cable(b.amp, "l", mix, "in2r")
    .stereo(d, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  const e = p.add("eq", [4, 0], {
    b2Type: "Low Shelf", b2Hz: 160, b2Gain: 6, b2Q: 0.7,
    b3Type: "Bell", b3Hz: 380, b3Gain: -4, b3Q: 1.2,
    b4On: false, b5Type: "High Shelf", b5Hz: 5000, b5Gain: -9, b5Q: 0.7, level: 0,
  });
  p.stereo(mix, e, { from: ["outl", "outr"] });
  out(p, [5, 0], e, -4);
  return p;
}

function notchSweep() {
  const p = patch("EQ: Twin Notch Phaser", {
    module: "eq", tempo: 84,
    description: "Two Notch bands moved in opposite directions by one slow LFO carve gaps in a sustained saw line, giving a hollow, phaser-like sweep without any feedback. Raise Q for thinner, sharper gaps.",
    tags: ["notch", "sweep", "phaser-like", "pad"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 10, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "D", scale: "Dorian", gatelength: 0.98, env: { attack: 0.2, decay: 0.4, sustain: 0.9, release: 0.6 } });
  const l = p.add("lfo", [2, 2], { wave: "Sine", sync: "2 bars" }, { name: "Sweep" });
  const e = p.add("eq", [3, 0], { b2On: false, b3Type: "Notch", b3Hz: 600, b3Q: 4, b4Type: "Notch", b4Hz: 2400, b4Q: 4, b5On: false, level: 2 });
  feed(p, m.amp, e);
  p.cable(l, "out", e, "b3Hz", 0.5).cable(l, "out", e, "b4Hz", -0.5);
  out(p, [4, 0], e, -16);
  return p;
}

function steepSweep() {
  const p = patch("EQ: 48 dB Cutoff Rise", {
    module: "eq", tempo: 122,
    description: "A High Cut with the steepest 48 dB/oct slope is pushed open by a slow LFO over a riff and beat, like a filter riser. Choose a gentler Slope for a softer glide, or turn the sweep depth down.",
    tags: ["high cut", "steep slope", "riser", "filter sweep"],
  });
  const m = riff(p, { rate: "1/8" });
  const d = beat(p, [0, 3], { style: "four", level: -8 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -2, level2: -3, master: 0 });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const l = p.add("lfo", [3, 2], { wave: "Saw Up", sync: "8 bars", polarity: "Unipolar" }, { name: "Rise" });
  const e = p.add("eq", [4, 0], { b2On: false, b4On: false, b5On: false, b6On: true, b6Type: "High Cut", b6Hz: 400, b6Slope: "48 dB/oct", b6Q: 3, level: 0 });
  p.stereo(mix, e, { from: ["outl", "outr"] }).cable(l, "out", e, "b6Hz", 0.7);
  out(p, [5, 0], e, -8);
  return p;
}

export default [radioVoice, wahBell, warmRoom, notchSweep, steepSweep];
