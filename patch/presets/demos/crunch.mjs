// SPDX-License-Identifier: MIT
// Crunch: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function grittyBass() {
  const p = patch("Crunch: Overdriven Bass", {
    module: "crunch", tempo: 98,
    description: "A plain bass line is pushed into Drive with Tone rolled down to 3 kHz: warm, thick overdrive with the harshest top cut away. Raise Drive for fuzz, or open Tone for a more biting edge.",
    tags: ["overdrive", "bass", "tone", "warm"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 10, ".", 7, 5],
    { rate: "1/8", shape: 0.5, octave: -2, root: "E", scale: "Minor Pentatonic", gatelength: 0.7, env: { attack: 0.004, decay: 0.2, sustain: 0.6, release: 0.1 } });
  const c = p.add("crunch", [3, 0], { drive: 0.75, bits: 16, rate: 0, tone: 3000, level: 0.6, mix: 1 });
  feed(p, m.amp, c);
  const d = beat(p, [0, 3], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -2, master: 0 });
  p.stereo(c, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function crushedDrums() {
  const p = patch("Crunch: Bit-Crushed Breaks", {
    module: "crunch", tempo: 92,
    description: "A broken beat loses bits and sample rate, so the kick turns gritty and the hats turn into digital hiss; Mix keeps some of the clean drum underneath. Push Bits toward 1 for noise, or pull Rate Red. down to restore the highs.",
    tags: ["bit crusher", "drums", "digital", "lo-fi"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -6 });
  const c = p.add("crunch", [3, 0], { drive: 0.2, bits: 5, rate: 0.35, tone: 12000, level: 1, mix: 0.75 });
  p.stereo(d, c, { from: ["outl", "outr"] });
  out(p, [4, 0], c, 3);
  return p;
}

function aliasedLead() {
  const p = patch("Crunch: Aliased Lead", {
    module: "crunch", tempo: 120,
    description: "Rate Red. at about 55 % with full 16-bit depth leaves the lead's pitch intact but folds new, glassy partials around it, like an old video-game chip. Sweep Rate Red. slowly while the riff plays.",
    tags: ["sample rate reduction", "aliasing", "chiptune", "lead"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 0, 4, 2, 5, 9, 14, 9, 5, 2, 5],
    { rate: "1/16", shape: 0.9, root: "C", scale: "Major Pentatonic", octave: 1, gatelength: 0.6, env: { attack: 0.002, decay: 0.15, sustain: 0.5, release: 0.08 } });
  const c = p.add("crunch", [3, 0], { drive: 0.1, bits: 16, rate: 0.55, tone: 9000, level: 0.7, mix: 1 });
  feed(p, m.amp, c);
  out(p, [4, 0], c, -1);
  return p;
}

function fallingBits() {
  const p = patch("Crunch: Dissolving Pad", {
    module: "crunch", tempo: 70,
    description: "A slow LFO sweeps Bits from clean to coarse and back on a held pad, so the sound breaks into steps and re-forms in long waves. Change the cable amount for a shallower sweep or move Rate Red. for another kind of breakup.",
    tags: ["modulation", "bits", "pad", "evolving"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"],
    { rate: "1/4", shape: 0.95, root: "A", scale: "Dorian", gatelength: 0.98, env: { attack: 0.5, decay: 0.5, sustain: 0.9, release: 1.0 } });
  const l = p.add("lfo", [2, 2], { wave: "Triangle", sync: "2 bars", polarity: "Unipolar" }, { name: "Bit Sweep" });
  const c = p.add("crunch", [3, 0], { drive: 0.15, bits: 12, rate: 0.1, tone: 8000, level: 0.8, mix: 1 });
  feed(p, m.amp, c);
  p.cable(l, "out", c, "bits", -0.75);
  out(p, [4, 0], c, -10);
  return p;
}

function parallelGrit() {
  const p = patch("Crunch: Parallel Grit", {
    module: "crunch", tempo: 110,
    description: "A four-on-the-floor beat gets near-maximum Drive and 8 bits but only 35 % Mix, so the clean punch stays and the crunch adds weight and fizz around it. Move Mix to find where the grit starts to take over.",
    tags: ["parallel", "mix", "drive", "drums"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -6 });
  const c = p.add("crunch", [3, 0], { drive: 0.95, bits: 8, rate: 0.2, tone: 6000, level: 0.8, mix: 0.35 });
  p.stereo(d, c, { from: ["outl", "outr"] });
  out(p, [4, 0], c, 0);
  return p;
}

export default [grittyBass, crushedDrums, aliasedLead, fallingBits, parallelGrit];
