// SPDX-License-Identifier: MIT
// Grains: five demo patches. Each plays by itself with the transport. The clouds are made from recordings the
// project carries (patch/presets/samples): Grains plays the clip instead of recording its input.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";
import { grainsData } from "../media.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: o.rate || "1/8", root: o.root || "C",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.5 }, { data: steps(notes, o.vel), name: o.name || "Notes" });
}
/// Grains' stereo out → a mixer (gain in dB) → Verb → Out 1/2. Returns the mixer.
function finish(p, g, at, o = {}) {
  const gain = o.gain ?? 0;
  const mix = p.add("audio-mixer", at, { level1: gain, pan1: -1, level2: gain, pan2: 1, level3: -3, master: o.master ?? 0 }, { name: "Level" });
  p.cable(g, "l", mix, "in1l").cable(g, "r", mix, "in2r");
  if (o.mix === false) { p.stereo(mix, p.out, { from: ["outl", "outr"] }); return mix; }
  const v = p.add("reverb", [at[0] + 1, at[1]], { size: 0.6, decay: 3, damping: 0.5, mix: o.mix ?? 0.2, quality: "Eco (8 lines)", ...(o.v || {}) });
  p.cable(mix, "outl", v, "l").cable(mix, "outr", v, "r").stereo(v, p.out);
  return mix;
}

function rainCurtain() {
  const p = patch("Grains: Rain Curtain", {
    module: "grains", tempo: 60,
    description: "A recording of steady rain is played as a cloud of 300 ms grains, scattered wide by Spread and slowly scanned by an LFO on Position, with Blur smoothing the grains into a soft, deep curtain of sound. Lower Size and raise Density for a crisp downpour, or raise Pitch for a lighter, more distant shower.",
    tags: ["rain", "texture", "scan", "ambient", "field recording"],
  });
  const s = p.sample("rain-b");
  const g = p.add("grains", [1, 0], { position: 0.4, size: 0.3, pitch: -4, density: 0.8, texture: 0.5, spread: 0.85, blur: 0.5, freeze: true, mix: 1, maxgrains: "32", pitchquant: "Off" }, { data: grainsData(s) });
  const lfo = p.add("lfo", [0, 1], { rate: 0.03, wave: "Triangle", polarity: "Unipolar" }, { name: "Scan" });
  p.cable(lfo, "out", g, "position", 0.7);
  finish(p, g, [2, 0], { gain: 5, mix: 0.2, v: { size: 0.7, decay: 4 } });
  return p;
}

function raindropMelody() {
  const p = patch("Grains: Raindrop Melody", {
    module: "grains", tempo: 96,
    description: "In Triggered mode each sequencer step fires one short, percussive grain of rain, and the sequencer's Pitch is patched into Grains' Pitch input, so the raindrops play a tune. Texture at 100 % gives a plucked attack. Change Size for longer notes, Pitch Quant to Off for glides, or Pitch Jitter for a more scattered melody.",
    tags: ["pitch input", "melody", "triggered", "rain"],
  });
  const s = p.sample("rain-a");
  const q = seq(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3, 0, 5, 8, 12, 15, 12, 8, 5], { rate: "1/8", root: "A", scale: "Natural Minor", octave: 0, gate: 0.4, vel: [110, 80, 95, 80] });
  const g = p.add("grains", [1, 0], { position: 0.3, size: 0.18, pitch: 0, density: 0.4, texture: 1, spread: 0.45, pitchquant: "Semitones", blur: 0.2, freeze: true, mix: 1, mode: "Triggered", reverse: 0.0, maxgrains: "32" }, { data: grainsData(s) });
  p.cable(q, "trigger", g, "trigger").cable(q, "pitch", g, "pitch");
  const rnd = p.add("random", [0, 1], { sync: "1/4", spread: 1, smooth: 0, loop: 0, seed: 3 }, { name: "Drop Place" });
  p.cable(rnd, "out", g, "position", 0.3);
  const m = finish(p, g, [2, 0], { gain: 6, mix: 0.3, v: { size: 0.7, decay: 4 } });
  const d = beat(p, [0, 2], { style: "sparse", level: -10 });
  p.cable(d, "outl", m, "in3l").cable(d, "outr", m, "in3r");
  return p;
}

function pianoFreeze() {
  const p = patch("Grains: Frozen Piano", {
    module: "grains", tempo: 70,
    description: "A single recorded piano note is turned into a slow, endless pad: grains of 600 ms drawn from around Position, detuned by Pitch Jitter and snapped by Pitch Quant to octaves and fifths, so the cloud sings in stacked octaves and fifths. A slow LFO moves Position from the attack to the tail. Try Size, Density and Feedback.",
    tags: ["freeze", "pad", "piano", "pitch quant"],
  });
  const s = p.sample("piano-c3");
  const g = p.add("grains", [1, 0], { position: 0.25, size: 0.7, pitch: 0, density: 0.65, texture: 0.5, spread: 0.3, pitchjitter: 7, pitchquant: "Octaves + fifths", feedback: 0.2, blur: 0.5, freeze: true, mix: 1 }, { data: grainsData(s) });
  const lfo = p.add("lfo", [0, 1], { rate: 0.04, wave: "Triangle", polarity: "Unipolar" }, { name: "Scan" });
  p.cable(lfo, "out", g, "position", 0.5);
  finish(p, g, [2, 0], { gain: -6, mix: 0.4, v: { size: 0.85, decay: 8 } });
  return p;
}

function gongShimmer() {
  const p = patch("Grains: Gong Shimmer", {
    module: "grains", tempo: 64,
    description: "A struck gong is stretched into grains an octave higher, with Feedback and Blur feeding the cloud back into itself so each hit blooms into a glassy halo. A sequencer plays the gong's pitch (Pitch input) and fires a grain burst on each note. Raise Feedback for a longer afterglow, or lower Pitch to hear the gong's own size.",
    tags: ["shimmer", "gong", "feedback", "triggered"],
  });
  const s = p.sample("thai-gong-a4");
  const q = seq(p, [0, 0], [0, ".", ".", ".", 5, ".", ".", ".", 7, ".", ".", ".", 3, ".", ".", "."], { rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: 0, gate: 0.5 });
  const g = p.add("grains", [1, 0], { position: 0.1, size: 0.5, pitch: 12, density: 0.7, texture: 0.5, spread: 0.35, pitchjitter: 0, pitchquant: "Semitones", feedback: 0.45, blur: 0.65, freeze: true, mix: 1, mode: "Triggered" }, { data: grainsData(s) });
  p.cable(q, "trigger", g, "trigger").cable(q, "pitch", g, "pitch");
  finish(p, g, [2, 0], { gain: 6, mix: 0.4, master: 2, v: { size: 0.85, decay: 7 } });
  return p;
}

function crotaleStutter() {
  const p = patch("Grains: Crotale Stutter", {
    module: "grains", tempo: 118,
    description: "Triggered mode with Sync on 1/16: a grid of tiny, percussive grains cut from a crotale recording makes a glittering rhythmic stutter, with some grains reversed. A stepped random source jumps Position on every beat so each bar pulls a different piece of the bell. Raise Density for bursts, or Size for a ringing tail.",
    tags: ["stutter", "rhythm", "sync", "reverse", "crotale"],
  });
  const s = p.sample("crotale-c6");
  const rnd = p.add("random", [0, 1], { sync: "1/8", spread: 1, loop: 0.9, length: "8 steps", seed: 21 }, { name: "Jump" });
  const g = p.add("grains", [1, 0], { position: 0.1, size: 0.08, pitch: -12, density: 0.5, texture: 1, spread: 0.1, reverse: 0.3, pitchquant: "Octaves", blur: 0.15, freeze: true, mix: 1, mode: "Continuous", sync: "1/16", maxgrains: "32" }, { data: grainsData(s) });
  const uni = p.add("utility", [0, 2], { scalex: 0.5, offset: 0.5 }, { name: "Unipolar" });
  p.cable(rnd, "out", uni, "x").cable(uni, "out", g, "position", 0.6);
  const m = finish(p, g, [2, 0], { gain: 6, master: 6, mix: 0.2 });
  const d = beat(p, [0, 3], { style: "broken", level: -9 });
  p.cable(d, "outl", m, "in3l").cable(d, "outr", m, "in3r");
  return p;
}

export default [rainCurtain, raindropMelody, pianoFreeze, gongShimmer, crotaleStutter];
