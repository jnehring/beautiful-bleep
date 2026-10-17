// SPDX-License-Identifier: MIT
// Phaser: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function classicSweep() {
  const p = patch("Phaser: Classic Four-Stage Sweep", {
    module: "phaser", tempo: 100,
    description: "A saw riff passes a four-stage Phaser at a slow Rate with moderate Feedback: two soft notches slide up and down the sound. Change Stages for a busier or gentler sweep.",
    tags: ["classic", "four stages", "sweep", "riff"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3, 5, 8, 12, 15, 12, 8, 5, 3],
    { rate: "1/8", shape: 1, root: "A", scale: "Natural Minor", gatelength: 0.85, env: { attack: 0.004, decay: 0.3, sustain: 0.7, release: 0.15 } });
  const f = p.add("phaser", [3, 0], { rate: 0.25, depth: 0.7, centre: 800, feedback: 0.45, stages: "4", spread: 0.4, mix: 0.5 });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -9);
  return p;
}

function deepTwelve() {
  const p = patch("Phaser: Deep Twelve-Stage Swirl", {
    module: "phaser", tempo: 90,
    description: "Twelve stages and strong negative Feedback on a held pad carve many narrow notches that sweep through the sound with a hollow, vocal quality. Try positive Feedback for a brighter, ringing sweep.",
    tags: ["12 stages", "negative feedback", "pad", "deep"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "D", scale: "Dorian", gatelength: 0.98, env: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 0.8 } });
  const f = p.add("phaser", [3, 0], { rate: 0.12, depth: 0.85, centre: 600, feedback: -0.8, stages: "12", spread: 0.6, mix: 0.6 });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -14);
  return p;
}

function stereoDrift() {
  const p = patch("Phaser: Wide Stereo Drift", {
    module: "phaser", tempo: 84,
    description: "With Spread at maximum the left and right LFOs are far apart, so the notches move in opposite places in each ear and a mono pluck melody floats around the stereo field. Lower Spread to centre the movement.",
    tags: ["stereo", "spread", "pluck", "ambient"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 5, 12, 10, 7, 3, 7, 0, "."],
    { rate: "1/8", shape: 0.9, root: "F", scale: "Minor Pentatonic", gatelength: 0.6, env: { attack: 0.003, decay: 0.5, sustain: 0.25, release: 0.4 } });
  const f = p.add("phaser", [3, 0], { rate: 0.18, depth: 0.8, centre: 1100, feedback: 0.55, stages: "6", spread: 1, mix: 0.55 });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -2);
  return p;
}

function fastRotor() {
  const p = patch("Phaser: Fast Rotor", {
    module: "phaser", tempo: 96,
    description: "A fast Rate with shallow Depth and few Stages gives a quick, rotary-like shimmer on a held organ-style tone. Slow Rate down for a classic sweep or deepen Depth to add warble.",
    tags: ["fast rate", "shimmer", "organ", "two stages"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 0.3, root: "C", scale: "Major Pentatonic", gatelength: 0.98, osc: { fine: 5 }, env: { attack: 0.02, decay: 0.2, sustain: 1, release: 0.3 } });
  const f = p.add("phaser", [3, 0], { rate: 5.2, depth: 0.3, centre: 1500, feedback: 0.3, stages: "2", spread: 0.8, mix: 0.5 });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -14);
  return p;
}

function jetNoise() {
  const p = patch("Phaser: Jet Noise Sweep", {
    module: "phaser", tempo: 100,
    description: "Pink noise through a ten-stage Phaser with high Feedback turns into a rolling, whooshing jet over a quiet beat. Change Centre to move the sweep higher or lower, or reduce Feedback for a softer whoosh.",
    tags: ["noise", "whoosh", "feedback", "texture"],
  });
  const n = p.add("noise", [0, 0], { level: 0.25, colour: -0.3 });
  const f = p.add("phaser", [3, 0], { rate: 0.1, depth: 0.9, centre: 900, feedback: 0.9, stages: "10", spread: 0.7, mix: 1 });
  p.cable(n, "out", f, "l").cable(n, "out", f, "r");
  const d = beat(p, [0, 3], { style: "sparse", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -2, master: 0 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [classicSweep, deepTwelve, stereoDrift, fastRotor, jetNoise];
