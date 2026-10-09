// SPDX-License-Identifier: MIT
// Macro Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";

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


/// Macro Osc "out" (mono) and "aux" into a mixer: out left of centre, aux right.
function pair(p, at, o, lvl = -4) {
  const m = p.add("audio-mixer", at, { level1: lvl, pan1: -0.5, level2: lvl - 3, pan2: 0.5, master: 0 }, { name: "Out + Aux" });
  p.cable(o, "out", m, "in1l").cable(o, "aux", m, "in2l");
  return m;
}

function pluckedStrings() {
  const p = patch("Macro Osc: Plucked Strings", {
    module: "macro-osc", tempo: 92,
    description: "The Pluck model struck by a sequencer trigger rings like a plucked string, and its built-in decay and low-pass gate need no envelope at all. Try a longer Decay for sustain or move Tone for a brighter string.",
    tags: ["pluck", "string", "trigger", "melody"],
  });
  const s = seq(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7, 5, 8, 12, 8, 7, 3, 2, "."], { rate: "1/8", root: "D", octave: 0, scale: "Minor Pentatonic", gate: 0.4 });
  const o = p.add("macro-osc", [1, 0], { model: "Pluck", tone: 0.55, shape: 0.5, blend: 0.3, decay: 1.4, gateColour: 0.5, level: 0.8 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.08 }, { name: "Brightness" });
  p.cable(s, "pitch", o, "pitch").cable(s, "trigger", o, "trig").cable(lfo, "out", o, "tone", 0.3);
  const m = pair(p, [2, 0], o, 5);
  room(p, [3, 0], m, { from: ["outl", "outr"], mix: 0.3, v: { decay: 2.8 } });
  return p;
}

function miniKit() {
  const p = patch("Macro Osc: Synthetic Kit", {
    module: "macro-osc", tempo: 118,
    description: "Three Macro Oscs play a whole drum kit from one grid: the Kick, Snare and Metal models, each struck by its own trigger. Change Tone and Decay on each one to retune the kit.",
    tags: ["drums", "kick", "snare", "metal"],
  });
  const rows = ["X...x...X...x...", "....X.......X..x", "x.xxx.xxx.xxx.xx", "......x.........", "", "", "", ""];
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Hat", "Open", "Clap", "Tom", "Tom 2", "Perc"], [pattern("Kit", rows)]) });
  const kick = p.add("macro-osc", [1, 0], { model: "Kick", octave: -1, tone: 0.5, shape: 0.55, decay: 0.45, level: 0.9 }, { name: "Kick" });
  const snare = p.add("macro-osc", [1, 1], { model: "Snare", tone: 0.5, shape: 0.5, blend: 0.4, decay: 0.25, level: 0.6 }, { name: "Snare" });
  const hat = p.add("macro-osc", [1, 2], { model: "Metal", tone: 0.8, shape: 0.6, decay: 0.07, gateColour: 0.8, level: 0.4 }, { name: "Hat" });
  const open = p.add("macro-osc", [1, 3], { model: "Metal", tone: 0.7, shape: 0.5, decay: 0.4, gateColour: 0.7, level: 0.35 }, { name: "Open Hat" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -1, level2: -4, pan2: 0.1, level3: -9, pan3: 0.3, level4: -10, pan4: -0.3, master: 1 }, { name: "Kit Mix" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "accent").cable(grid, "gate2", snare, "trig").cable(grid, "velocity2", snare, "accent")
    .cable(grid, "gate3", hat, "trig").cable(grid, "velocity3", hat, "accent").cable(grid, "gate4", open, "trig");
  p.cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hat, "out", mix, "in3l").cable(open, "out", mix, "in4l");
  room(p, [3, 0], mix, { from: ["outl", "outr"], mix: 0.12, v: { decay: 1.2 } });
  return p;
}

function chordMist() {
  const p = patch("Macro Osc: Chord Mist", {
    module: "macro-osc", tempo: 70,
    description: "The Chord model plays a whole chord from one pitch; slow LFOs on Tone and Shape change the chord type and voicing, and Aux carries a second voice to the other side. Turn Blend to taste.",
    tags: ["chord", "pad", "evolving", "ambient"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "F", octave: -1, scale: "Natural Minor", gate: 1 });
  const o = p.add("macro-osc", [1, 0], { model: "Chord", tone: 0.4, shape: 0.5, blend: 0.5, level: 0.7 });
  const l1 = p.add("lfo", [0, 1], { rate: 0.04 }, { name: "Chord Type" });
  const l2 = p.add("lfo", [0, 2], { rate: 0.065, wave: "Triangle" }, { name: "Voicing" });
  p.cable(s, "pitch", o, "pitch").cable(l1, "out", o, "tone", 0.4).cable(l2, "out", o, "shape", 0.4);
  const m = pair(p, [2, 0], o, -12);
  room(p, [3, 0], m, { from: ["outl", "outr"], mix: 0.45, v: { decay: 5.5, size: 0.75 } });
  return p;
}

function warpedBass() {
  const p = patch("Macro Osc: Phase Warp Bass", {
    module: "macro-osc", tempo: 100,
    description: "The Phase Warp model with an envelope on its Tone macro: each bass note starts wide open and bent, then settles into a round, quiet sound. Try other Models such as Fold or FM on the same line.",
    tags: ["bass", "phase warp", "envelope", "model"],
  });
  const s = seq(p, [0, 0], [0, ".", 0, 0, ".", 7, ".", 5, 0, ".", 0, 3, ".", 5, 7, "."], { rate: "1/8", root: "A", octave: -2, scale: "Minor Pentatonic", gate: 0.55 });
  const o = p.add("macro-osc", [1, 0], { model: "Phase Warp", tone: 0.3, shape: 0.5, blend: 0.2, level: 0.7 });
  const env = p.add("adsr", [0, 1], { attack: 0.002, decay: 0.28, sustain: 0.1, release: 0.15 }, { name: "Warp Env" });
  const amp = p.add("adsr", [1, 1], { attack: 0.003, decay: 0.3, sustain: 0.65, release: 0.1 }, { name: "Amp Env" });
  const v = p.add("vca", [2, 0], {}, { name: "VCA" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(env, "env", o, "tone", 0.6)
    .cable(s, "gate", amp, "gate").cable(s, "trigger", amp, "retrig").cable(o, "out", v, "l").cable(amp, "env", v, "gain");
  const m = p.add("audio-mixer", [3, 0], { level1: 0, pan1: -0.2, level2: 0, pan2: 0.2, master: 0 }, { name: "Main" });
  p.cable(v, "l", m, "in1l").cable(v, "l", m, "in2r");
  room(p, [4, 0], m, { from: ["outl", "outr"], mix: 0.12, v: { decay: 1.4 } });
  return p;
}

function dustStorm() {
  const p = patch("Macro Osc: Dust Garden", {
    module: "macro-osc", tempo: 80,
    description: "The Dust model scatters tiny pitched clicks, with the sequencer walking them through a pentatonic scale, and a second Macro Oscillator on Noise Band adds airy breath beneath. Move Tone for denser crackle and Blend for a wider texture.",
    tags: ["dust", "texture", "noise", "crackle"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_", 10, "_", "_", "_"], { rate: "1/4", root: "G", octave: 0, scale: "Minor Pentatonic", gate: 1 });
  const d = p.add("macro-osc", [1, 0], { model: "Dust", tone: 0.55, shape: 0.5, blend: 0.4, level: 0.7 }, { name: "Dust" });
  const n = p.add("macro-osc", [1, 1], { model: "Noise Band", tone: 0.4, shape: 0.3, blend: 0.3, level: 0.5 }, { name: "Breath" });
  const l1 = p.add("lfo", [0, 1], { rate: 0.05 }, { name: "Density" });
  const l2 = p.add("lfo", [0, 2], { rate: 0.09, wave: "Triangle" }, { name: "Colour" });
  p.cable(s, "pitch", d, "pitch").cable(s, "pitch", n, "pitch").cable(l1, "out", d, "tone", 0.4).cable(l2, "out", n, "tone", 0.4);
  const m = p.add("audio-mixer", [2, 0], { level1: -2, pan1: -0.4, level2: -4, pan2: 0.4, level3: -8, pan3: 0.6, level4: -10, pan4: -0.6, master: -8 }, { name: "Mix" });
  p.cable(d, "out", m, "in1l").cable(n, "out", m, "in2l").cable(d, "aux", m, "in3l").cable(n, "aux", m, "in4l");
  room(p, [3, 0], m, { from: ["outl", "outr"], mix: 0.4, v: { decay: 4, size: 0.7 } });
  return p;
}

export default [pluckedStrings, miniKit, chordMist, warpedBass, dustStorm];
