// SPDX-License-Identifier: MIT
// Grains: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// Grains' stereo out → a mixer with makeup gain → Out 1/2.
function finish(p, g, at, gain = 6) {
  const mix = p.add("audio-mixer", at, { level1: gain, pan1: -1, level2: gain, pan2: 1, master: gain }, { name: "Level" });
  p.cable(g, "l", mix, "in1l").cable(g, "r", mix, "in2l").stereo(mix, p.out, { from: ["outl", "outr"] });
}

function frozenCloud() {
  const p = patch("Grains: Frozen Cloud", {
    module: "grains", tempo: 90,
    description: "A short plucked phrase is recorded, then a slow square LFO on the Freeze gate holds the buffer for a few bars at a time: the grains turn one moment of the phrase into a wide, endless pad, and the next phrase is caught when the freeze lets go.",
    tags: ["freeze", "pad", "texture"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2], { rate: "1/8" });
  const g = p.add("grains", [3, 0], { position: 0.25, size: 0.45, pitch: 0, density: 0.75, texture: 0.5, spread: 0.7,
    feedback: 0.25, blur: 0.5, mix: 1, mode: "Continuous", buffer: "4 s" });
  p.cable(m.amp, "l", g, "l");
  finish(p, g, [4, 0]);
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "4 bars", pw: 0.7, polarity: "Unipolar" }, { name: "Hold" });
  const drift = p.add("lfo", [3, 1], { rate: 0.07, wave: "Triangle" }, { name: "Drift" });
  p.cable(hold, "out", g, "freeze").cable(drift, "out", g, "position", 0.25);
  return p;
}

function stutterRhythm() {
  const p = patch("Grains: Stutter Rhythm", {
    module: "grains", tempo: 118,
    description: "Triggered mode with Sync on 1/16: every step fires a short, reversed-or-forward grain of a bass loop, chopping it into a stuttering rhythm. Raise Density to fire bursts.",
    tags: ["rhythm", "stutter", "triggered", "sync"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 5, 0, 3, 7], { rate: "1/8", shape: 0.3, scale: "Natural Minor", root: "E" });
  const g = p.add("grains", [3, 0], { position: 0.1, size: 0.08, pitch: -12, density: 0.8, texture: 0.9, spread: 0.2,
    reverse: 0.3, mix: 0.8, mode: "Triggered", sync: "1/16", buffer: "2 s" });
  const rnd = p.add("random", [2, 1], { rate: 4, spread: 0.6, sync: "1/16", seed: 5 }, { name: "Jump" });
  p.cable(m.amp, "l", g, "l");
  finish(p, g, [4, 0]);
  p.cable(rnd, "out", g, "position", 0.4);
  return p;
}

function shimmerLeaps() {
  const p = patch("Grains: Shimmer Leaps", {
    module: "grains", tempo: 76,
    description: "Pitch Quant on Octaves + fifths and a little Pitch Jitter turn a slow melody into a shimmering halo that climbs by fifths and octaves. Feedback keeps the glow after each note.",
    tags: ["shimmer", "pitch", "feedback"],
  });
  const m = melody(p, [0, 0], [0, ".", 5, ".", 3, ".", 7, "."], { rate: "1/4", shape: 0.5, root: "D", scale: "Major Pentatonic" });
  const g = p.add("grains", [3, 0], { position: 0.05, size: 0.35, pitch: 12, density: 0.7, texture: 0.5, spread: 0.5,
    pitchjitter: 7, pitchquant: "Octaves + fifths", feedback: 0.55, blur: 0.65, mix: 0.7 });
  p.cable(m.amp, "l", g, "l").stereo(g, p.out);
  return p;
}

function melodicCloud() {
  const p = patch("Grains: Melodic Cloud", {
    module: "grains", tempo: 100,
    description: "A sequencer drives the Pitch input of a frozen noise burst's grains, so the cloud itself plays the tune: a shimmering sine-like melody made of nothing but grains.",
    tags: ["pitch input", "melody", "noise"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "C", scale: "Minor Pentatonic" },
    { data: steps([0, 3, 7, 10, 12, 10, 7, 3]) });
  const n = p.add("noise", [0, 1], { colour: -0.3, level: 0.6 });
  const g = p.add("grains", [2, 0], { position: 0.4, size: 0.3, pitch: 0, density: 0.9, texture: 0.45, spread: 0.4,
    pitchquant: "Semitones", blur: 0.3, mix: 1, freeze: false });
  p.cable(n, "out", g, "l").cable(seq, "pitch", g, "pitch").stereo(g, p.out);
  return p;
}

function backwardsTexture() {
  const p = patch("Grains: Backwards Garden", {
    module: "grains", tempo: 84,
    description: "Long grains that mostly play backwards, scattered by Spread and Pitch Jitter around a slow melody, with Blur washing everything: a swelling, reversed-reverb garden.",
    tags: ["reverse", "ambient", "blur"],
  });
  const m = melody(p, [0, 0], [0, 7, 4, 9, 2, 7, 5, 4], { rate: "1/4", shape: 0.6, root: "G", scale: "Dorian" });
  const g = p.add("grains", [3, 0], { position: 0.55, size: 0.9, pitch: 0, density: 0.45, texture: 0.5, spread: 0.85,
    reverse: 0.9, pitchjitter: 3, feedback: 0.3, blur: 0.8, mix: 0.85, buffer: "8 s" });
  const lfo = p.add("lfo", [3, 1], { rate: 0.05 }, { name: "Slow Drift" });
  p.cable(m.amp, "l", g, "l").cable(lfo, "out", g, "position", 0.3);
  finish(p, g, [4, 0]);
  return p;
}

export default [frozenCloud, stutterRhythm, shimmerLeaps, melodicCloud, backwardsTexture];
