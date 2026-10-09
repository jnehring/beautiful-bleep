// SPDX-License-Identifier: MIT
// Formant Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/8", root: o.root || "A",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.5 }, { data: steps(notes, o.vel) });
}
/// Stereo oscillator → VCA with an ADSR from the sequencer gate. Returns the VCA.
function amp(p, at, s, osc, adsr, from = ["outL", "outR"]) {
  const env = p.add("adsr", at, adsr, { name: "Amp Env" });
  const v = p.add("vca", [at[0] + 1, at[1]], {}, { name: "VCA" });
  p.cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(env, "env", v, "gain");
  p.stereo(osc, v, { from });
  return v;
}
function room(p, at, src, o = {}) {
  if (o.trim !== undefined) {  // level trim through a mixer first
    const m = p.add("audio-mixer", [at[0] - 1, at[1] + 1], { level1: o.trim, pan1: -1, level2: o.trim, pan2: 1, master: 0 }, { name: "Trim" });
    p.cable(src, (o.from || ["l", "r"])[0], m, "in1l").cable(src, (o.from || ["l", "r"])[1], m, "in2r");
    src = m; o = { ...o, from: ["outl", "outr"] };
  }
  const v = p.add("reverb", at, { size: 0.6, decay: 3, damping: 0.45, mix: o.mix ?? 0.35, quality: "Eco (8 lines)", ...o.v });
  p.stereo(src, v, { from: o.from || ["l", "r"] }).stereo(v, p.out);
  return v;
}


function wahLead() {
  const p = patch("Formant Osc: Wah Lead", {
    module: "formant-osc", tempo: 100,
    description: "A slow triangle LFO sweeps Formant up and down over a simple tune, so the resonant peak wanders through the harmonics like a hand on a wah pedal. Try Narrow for a sharper peak, or Body for a fuller base.",
    tags: ["lead", "wah", "sweep", "melody"],
  });
  const s = seq(p, [0, 0], [0, 3, 7, 10, 7, 3, 5, 3, 0, 3, 7, 12, 10, 7, 5, "."], { rate: "1/8", root: "A", octave: 0, scale: "Minor Pentatonic", gate: 0.7 });
  const o = p.add("formant-osc", [1, 0], { formant: 2, narrow: 0.45, body: 0.6, spread: 0.3 });
  const v = amp(p, [1, 1], s, o, { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.2, wave: "Triangle" }, { name: "Wah" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "formant", 0.7);
  room(p, [3, 0], v, { trim: 2, mix: 0.2, v: { decay: 1.8 } });
  return p;
}

function acidBass() {
  const p = patch("Formant Osc: Squelch Bass", {
    module: "formant-osc", tempo: 120,
    description: "An envelope snaps Formant upward on every bass note and lets it fall, giving the squelch of a resonant filter without any filter. Raise Narrow for more bite and shorten the envelope for a tighter pluck.",
    tags: ["bass", "squelch", "envelope", "acid"],
  });
  const s = seq(p, [0, 0], [0, 0, ".", 0, 12, ".", 0, 3, ".", 0, 0, 7, ".", 5, 3, "."], { rate: "1/16", root: "E", octave: -2, scale: "Minor Pentatonic", gate: 0.5 });
  const o = p.add("formant-osc", [1, 0], { formant: 0.5, narrow: 0.6, body: 0.5, reset: 1 });
  const v = amp(p, [1, 1], s, o, { attack: 0.002, decay: 0.2, sustain: 0.5, release: 0.08 });
  const fe = p.add("adsr", [0, 1], { attack: 0.002, decay: 0.22, sustain: 0.05, release: 0.1 }, { name: "Squelch Env" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", fe, "gate").cable(s, "trigger", fe, "retrig").cable(fe, "env", o, "formant", 0.8);
  const drums = beat(p, [0, 3], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -1, pan1: -0.2, level2: -1, pan2: 0.2, level3: -2, level4: -2, master: 0 }, { name: "Main" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.1, v: { decay: 1.1 } });
  return p;
}

function vowelChoir() {
  const p = patch("Formant Osc: Vowel Choir", {
    module: "formant-osc", tempo: 66,
    description: "A slow chord-like line with a wide Spread and two LFOs gently moving Formant and Narrow, so the pad seems to sing different vowels in a big room. Change Roll to soften the top and Spread to widen it.",
    tags: ["choir", "vowel", "pad", "ambient"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "D", octave: -1, scale: "Minor Pentatonic", gate: 1 });
  const o = p.add("formant-osc", [1, 0], { formant: 1.2, narrow: 0.25, body: 0.8, roll: 0.3, spread: 0.9 });
  const v = amp(p, [1, 1], s, o, { attack: 1.5, decay: 1, sustain: 0.9, release: 3 });
  const l1 = p.add("lfo", [0, 1], { rate: 0.07 }, { name: "Vowel" });
  const l2 = p.add("lfo", [0, 2], { rate: 0.043, wave: "Triangle" }, { name: "Focus" });
  p.cable(s, "pitch", o, "pitch").cable(l1, "out", o, "formant", 0.8).cable(l2, "out", o, "narrow", 0.3);
  room(p, [3, 0], v, { trim: -3, mix: 0.45, v: { decay: 5.5, size: 0.75 } });
  return p;
}

function throughZero() {
  const p = patch("Formant Osc: Through Zero", {
    module: "formant-osc", tempo: 72,
    description: "A low drone while Formant is swept slowly across zero, from below the pitch to far above it. The tone folds through a hollow, ghostly moment at the middle of every pass. Try FM Depth with a cable for a more metallic movement.",
    tags: ["drone", "sweep", "evolving", "hollow"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "G", octave: -2, scale: "Natural Minor", gate: 1 });
  const o = p.add("formant-osc", [1, 0], { formant: 0, narrow: 0.35, body: 0.9, spread: 0.5, tracking: "Ratio" });
  const v = amp(p, [1, 1], s, o, { attack: 2, decay: 1, sustain: 1, release: 3 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.06, wave: "Triangle" }, { name: "Through Zero" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "formant", 1);
  room(p, [3, 0], v, { trim: -6, mix: 0.3, v: { decay: 4 } });
  return p;
}

function chatterBox() {
  const p = patch("Formant Osc: Chatter", {
    module: "formant-osc", tempo: 112,
    description: "A random generator jumps Formant on every sixteenth so a short repeating phrase seems to chatter in a different voice each time, over a broken beat. Lock the pattern with Loop on the Random, or change Spread to widen the chatter.",
    tags: ["random", "rhythm", "talking", "stepped"],
  });
  const s = seq(p, [0, 0], [0, 0, 7, ".", 0, 5, ".", 3, 0, 0, ".", 7, 10, ".", 5, "."], { rate: "1/16", root: "C", octave: -1, scale: "Minor Pentatonic", gate: 0.45 });
  const o = p.add("formant-osc", [1, 0], { formant: 1.5, narrow: 0.5, body: 0.6, spread: 0.6 });
  const v = amp(p, [1, 1], s, o, { attack: 0.003, decay: 0.15, sustain: 0.3, release: 0.1 });
  const r = p.add("random", [0, 1], { rate: 4, sync: "1/16", spread: 0.8, loop: 0.7, length: "8 steps", seed: 11 }, { name: "Jumps" });
  p.cable(s, "pitch", o, "pitch").cable(r, "out", o, "formant", 0.9);
  const drums = beat(p, [0, 3], { style: "broken", level: -10 });
  const mix = p.add("audio-mixer", [3, 0], { level1: 2, pan1: -0.3, level2: 2, pan2: 0.3, level3: -1, level4: -1, master: 0 }, { name: "Main" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.12, v: { decay: 1.3 } });
  return p;
}

export default [wahLead, acidBass, vowelChoir, throughZero, chatterBox];
