// SPDX-License-Identifier: MIT
// Meta Mod: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// Meta Mod's stereo output to Out 1/2 through a gain stage (dB), since the algorithms differ a lot in level.
function toOut(p, x, db) {
  const g = p.add("audio-mixer", [5, 0], { level1: Math.min(db, 6), master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.stereo(x, g, { to: ["in1l", "in1r"] }).stereo(g, p.out, { from: ["outl", "outr"] });
}

function ringBells() {
  const p = patch("Meta Mod: Ring Bells", {
    module: "meta-mod", tempo: 80,
    description: "With no modulator patched, the internal oscillator multiplies a simple melody in analog ring mode, giving clangorous bell tones. Change Osc Tune to move between consonant and metallic, or sweep Algorithm to the neighbours.",
    tags: ["ring mod", "bells", "internal oscillator", "metallic"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, "."], { rate: "1/4", shape: 0.2, root: "C", scale: "Major Pentatonic",
    env: { decay: 0.7, sustain: 0.1, release: 0.5 } });
  const x = p.add("meta-mod", [3, 0], { algorithm: 2, timbre: 0.5, oscTune: 7.5, oscShape: 0.1, mix: 1 });
  p.cable(m.amp, "l", x, "carrierL").cable(m.amp, "l", x, "carrierR");
  toOut(p, x, 0);
  return p;
}

function talkingBeat() {
  const p = patch("Meta Mod: Talking Drums", {
    module: "meta-mod", tempo: 100,
    description: "In vocoder mode a buzzing saw carrier is shaped by the drum beat as modulator, so the pad seems to pump and speak in the rhythm of the kit. Change Timbre for a different band balance, or the saw's pitch for another vowel colour.",
    tags: ["vocoder", "drums", "rhythm", "carrier"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -6 });
  const m = melody(p, [0, 3], [0, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", shape: 1, root: "A", octave: -1, scale: "Natural Minor",
    env: { attack: 0.02, decay: 0.3, sustain: 1, release: 0.3 }, gatelength: 1 });
  const x = p.add("meta-mod", [4, 0], { algorithm: 6, timbre: 0.55, carrierLevel: 1, modLevel: 1.5, mix: 1 });
  p.cable(m.amp, "l", x, "carrierL").cable(m.amp, "l", x, "carrierR").cable(mix, "outl", x, "modulator");
  toOut(p, x, -8);
  return p;
}

function bitwiseGrit() {
  const p = patch("Meta Mod: Bitwise Grit", {
    module: "meta-mod", tempo: 92,
    description: "Bitwise mode combines a bass line with the internal oscillator number by number, producing digital edge and odd harmonics that move with Osc Tune. Switch Bitwise Op between XOR, AND and OR, or sweep Timbre.",
    tags: ["bitwise", "digital", "bass", "gritty"],
  });
  const m = melody(p, [0, 0], [0, 0, ".", 3, 0, ".", 5, 7], { rate: "1/8", shape: 0.9, root: "E", octave: -1, scale: "Natural Minor",
    env: { decay: 0.25, sustain: 0.4, release: 0.15 }, gatelength: 0.7 });
  const x = p.add("meta-mod", [3, 0], { algorithm: 4, timbre: 0.6, oscTune: -5, oscShape: 0.3, bitwiseOp: "XOR", mix: 0.8, carrierLevel: 0.8 });
  p.cable(m.amp, "l", x, "carrierL").cable(m.amp, "l", x, "carrierR");
  toOut(p, x, -18);
  return p;
}

function algorithmSweep() {
  const p = patch("Meta Mod: Algorithm Sweep", {
    module: "meta-mod", tempo: 88,
    description: "A slow triangle LFO walks the Algorithm knob from crossfade through fold and ring modulation and back, so the same two tones keep changing character. Narrow the LFO's amount to stay in one family, or move Timbre by hand.",
    tags: ["morph", "algorithm", "modulation", "evolving"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 5], { rate: "1/8", shape: 0.7, root: "D", scale: "Dorian",
    env: { decay: 0.3, sustain: 0.4, release: 0.2 }, gatelength: 0.7 });
  const x = p.add("meta-mod", [3, 0], { algorithm: 2.5, timbre: 0.5, oscTune: 12, mix: 1, carrierLevel: 0.9 });
  const l = p.add("lfo", [2, 1], { rate: 0.06, wave: "Triangle" }, { name: "Algorithm LFO" });
  p.cable(m.amp, "l", x, "carrierL").cable(m.amp, "l", x, "carrierR").cable(l, "out", x, "algorithm", 0.5);
  toOut(p, x, -20);
  return p;
}

function chebyshevGlow() {
  const p = patch("Meta Mod: Chebyshev Glow", {
    module: "meta-mod", tempo: 72,
    description: "The last algorithm adds harmonics to a plain sine bass line, with a slow LFO moving Timbre from a pure tone to a bright, organ-like glow. Try Quality for cleaner top end, or Mix to blend the pure sine back in.",
    tags: ["harmonics", "chebyshev", "sine", "bass"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", 3, "_"], { rate: "1/4", shape: 0, root: "G", octave: -1, scale: "Natural Minor",
    env: { attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.4 }, gatelength: 0.9 });
  const x = p.add("meta-mod", [3, 0], { algorithm: 7, timbre: 0.4, carrierLevel: 0.8, mix: 1, quality: "High (4×)" });
  const l = p.add("lfo", [2, 1], { rate: 0.1, wave: "Sine" }, { name: "Timbre LFO" });
  p.cable(m.amp, "l", x, "carrierL").cable(m.amp, "l", x, "carrierR").cable(l, "out", x, "timbre", 0.4);
  toOut(p, x, -22);
  return p;
}

export default [ringBells, talkingBeat, bitwiseGrit, algorithmSweep, chebyshevGlow];
