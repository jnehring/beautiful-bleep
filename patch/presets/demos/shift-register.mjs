// SPDX-License-Identifier: MIT
// Shift Register: five demo patches. Each plays by itself with the transport.
import { patch, drumGrid, pattern } from "../kit.mjs";

// ------------------------------------------------------------ local helpers

/// Oscillator → ADSR → VCA from a pitch and gate source, optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Mono source → level → optional delay → reverb → Out 1/2.
function space(p, at, from, jack, { level = 0, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: false }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    const d = p.add("zone-delay", [c, r], delay);
    p.stereo(m, d, { from: out });
    node = d; out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

function lockedLoop() {
  const p = patch("Shift Register: Locked Loop", {
    module: "shift-register", tempo: 100,
    description: "An eight-bit register in E minor pentatonic with Lock almost at 100 %: the melody repeats, and a very slow LFO lets it slip a note now and then before it settles again. Pull Lock down by hand to loosen it, or push it to the top to freeze the tune.",
    tags: ["turing", "melody", "pentatonic", "lock"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 0.92, length: 8, sync: "1/8", octaves: 2, root: "E", scale: "Minor Pentatonic", gatelength: 0.55 },
    { data: { start: 0xb4d3, combo: 9 } });
  const slip = p.add("lfo", [0, 2], { rate: 0.03, polarity: "Bipolar" }, { name: "Slip" });
  p.cable(slip, "out", sr, "lock", 0.12);
  const v = voice(p, [1, 0], { node: sr, gate: "bit1" }, { name: "Pluck", osc: { shape: 0.5 },
    env: { decay: 0.35, sustain: 0.1, release: 0.3 }, filter: { cutoff: 2600, resonance: 0.15 } });
  const bass = voice(p, [1, 2], { node: sr, gate: "bit5", pitch: "pitch" }, { name: "Echo", osc: { shape: 0.1, octave: "-1" },
    env: { attack: 0.01, decay: 0.5, sustain: 0.3, release: 0.4 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: -6, master: 4, limiter: false }, { name: "Voices" });
  p.cable(v.out, "l", mix, "in1l").cable(bass.out, "l", mix, "in2l");
  const delay = p.add("zone-delay", [5, 0], { zone: 3, time: 0.4, feedback: 0.45, character: 0.3, tone: -0.3, mix: 0.35 });
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3, mix: 0.3 });
  p.stereo(mix, delay, { from: ["outl", "outr"] }).stereo(delay, verb).stereo(verb, p.out);
  return p;
}

function canonBeat() {
  const p = patch("Shift Register: Canon Beat", {
    module: "shift-register", tempo: 108,
    description: "One sixteen-step pattern in the register, read at four places: the kick takes Bit 1, the clap Bit 3, the hats Bit 4 and a rim Bit 6, so the same rhythm echoes itself two, three and five steps later. Lower Lock to let the groove mutate, change Length for new cycles.",
    tags: ["drums", "canon", "bits", "groove"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 0.96, length: 16, sync: "1/16", octaves: 1, root: "A", scale: "Natural Minor", gatelength: 0.4 },
    { data: { start: 0x1351, combo: 0 } });
  const kick = p.add("punch-kick", [1, 0], { tune: 52, decay: 0.5, level: 0.85 });
  const clap = p.add("punch-clap", [1, 1], { level: 0.5, decay: 0.3 });
  const hats = p.add("punch-hats", [1, 2], { closed: 0.04, tone: 0.6, level: 0.5 });
  const rim = p.add("ring-rim", [1, 3], { level: 0.5 });
  p.cable(sr, "bit1", kick, "trig").cable(sr, "bit3", clap, "trig").cable(sr, "bit4", hats, "closed").cable(sr, "bit6", rim, "trig");
  const bass = voice(p, [1, 4], { node: sr, gate: "bit2" }, { name: "Bass", osc: { shape: 0.9, octave: "-1" },
    env: { decay: 0.2, sustain: 0.4, release: 0.1 }, filter: { cutoff: 420, resonance: 0.3 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -9, pan2: 0.1, level3: -13, pan3: 0.3, level4: -11, pan4: -0.3, send2: -12, send4: -10, return: -5, master: -3 }, { name: "Kit" });
  p.cable(kick, "out", mix, "in1l").cable(clap, "out", mix, "in2l").cable(hats, "out", mix, "in3l").cable(rim, "out", mix, "in4l");
  const mix2 = p.add("audio-mixer", [5, 0], { level1: 0, level2: -3, master: 0, limiter: false }, { name: "Master" });
  p.stereo(mix, mix2, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(bass.out, "l", mix2, "in2l");
  const room = p.add("reverb", [5, 2], { size: 0.35, decay: 1, damping: 0.6, mix: 1 });
  p.cable(mix, "sendl", room, "l").cable(mix, "sendr", room, "r").stereo(room, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix2, p.out, { from: ["outl", "outr"] });
  return p;
}

function rhythmEcho() {
  const p = patch("Shift Register: Rhythm Echo", {
    module: "shift-register", tempo: 94,
    description: "Source = Data: a little kick-and-snare pattern is fed into the register's Data input and comes back out of the bits as echoes that drive chimes and a pad of notes. Lock below 100 % corrupts the echoes, so the rhythm slowly drifts from its original.",
    tags: ["data", "echo", "rhythm", "chimes"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Hat", "Perc", "Clap", "Tom", "Tom 2", "Perc 2"],
    [pattern("Echo", ["X.....x...x.....", "........X.......", "x.x.x.x.x.x.x.x.", ""])]) });
  const kick = p.add("punch-kick", [1, 0], { tune: 50, decay: 0.5, level: 0.8 });
  const snare = p.add("punch-snare", [1, 1], { tune: 190, snappy: 0.5, level: 0.6 });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity").cable(grid, "gate2", snare, "trig").cable(grid, "velocity2", snare, "velocity");
  const sr = p.add("shift-register", [0, 2], { lock: 0.9, length: 6, sync: "1/16", source: "Data", octaves: 2, root: "D", scale: "Major Pentatonic", gatelength: 0.4 });
  p.cable(grid, "gate1", sr, "data");
  const v = voice(p, [1, 2], { node: sr, gate: "bit3" }, { name: "Chime", osc: { shape: 0.0 },
    env: { decay: 0.6, sustain: 0, release: 0.5 } });
  const v2 = voice(p, [1, 4], { node: sr, gate: "bit5" }, { name: "Echo Chime", osc: { shape: 0.1, octave: "+1" },
    env: { decay: 0.5, sustain: 0, release: 0.5 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -6, level3: -12, pan3: -0.3, level4: -16, pan4: 0.4, send3: -6, send4: -6, return: -3, master: -3 }, { name: "Mix" });
  p.cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(v.out, "l", mix, "in3l").cable(v2.out, "l", mix, "in4l");
  const delay = p.add("zone-delay", [5, 1], { zone: 3, time: 0.45, feedback: 0.5, tone: -0.3, mix: 1 });
  const verb = p.add("reverb", [6, 1], { size: 0.7, decay: 4, mix: 1 });
  p.cable(mix, "sendl", delay, "l").cable(mix, "sendr", delay, "r").stereo(delay, verb).stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function mirrorFlip() {
  const p = patch("Shift Register: Mirror Flip", {
    module: "shift-register", tempo: 90,
    description: "Lock at -100 % flips every returning bit, so the five-step pattern comes back inverted and the whole line repeats every ten steps. The Combo output (odd number of the chosen bits) rings a high bell, Voltage opens the filter. Move Lock towards the middle to hear the mirror blur.",
    tags: ["lock", "inverse", "combo", "arpeggio"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: -1, length: 5, sync: "1/8", octaves: 2, root: "G", scale: "Dorian", combine: "Odd", gatelength: 0.6 },
    { data: { start: 0x6b9a, combo: 0b10111 } });
  const v = voice(p, [1, 0], { node: sr, gate: "bit2" }, { name: "Arp", osc: { shape: 0.85 },
    env: { decay: 0.3, sustain: 0.3, release: 0.2 }, filter: { cutoff: 700, resonance: 0.35 } });
  p.cable(sr, "voltage", v.filter, "cutoff", 0.5);
  const bell = p.add("modal-voice", [1, 2], { strike: 1, strikeTimbre: 0.75, geometry: 0.85, brightness: 0.7, damping: 0.2, position: 0.35, size: 0.3, space: 0.25, coarse: 12 }, { name: "Combo Bell" });
  p.cable(sr, "pitch", bell, "pitch").cable(sr, "combo", bell, "strike");
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: -9, send1: -9, send2: -6, return: -3, master: 0, limiter: false }, { name: "Mix" });
  p.cable(v.out, "l", mix, "in1l").stereo(bell, mix, { to: ["in2l", "in2r"] });
  const delay = p.add("zone-delay", [5, 1], { zone: 3, time: 0.38, feedback: 0.5, tone: -0.3, mix: 1 });
  const verb = p.add("reverb", [6, 1], { size: 0.75, decay: 5, mix: 1 });
  p.cable(mix, "sendl", delay, "l").cable(mix, "sendr", delay, "r").stereo(delay, verb).stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function driftingFreeRun() {
  const p = patch("Shift Register: Drifting Free Run", {
    module: "shift-register", tempo: 80,
    description: "Sync = Free: the register runs on its own Rate instead of the song tempo, and a slow LFO speeds it up and slows it down, over a whole-tone scale. A second LFO on Lock moves between frozen, mutating and random. Switch Sync to a note value to lock it back to the beat.",
    tags: ["free run", "whole tone", "dreamy", "evolving"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 0.6, length: 12, sync: "Free", rate: 3.2, octaves: 3, root: "C", scale: "Whole Tone", gatelength: 0.8 },
    { data: { start: 0x9c6b, combo: 0 } });
  const speed = p.add("lfo", [0, 2], { rate: 0.035, wave: "Triangle" }, { name: "Speed" });
  const lockLfo = p.add("lfo", [0, 3], { rate: 0.021, wave: "Sine" }, { name: "Lock Sweep" });
  p.cable(speed, "out", sr, "rate", 0.35).cable(lockLfo, "out", sr, "lock", 0.4);
  const v = voice(p, [1, 0], { node: sr, gate: "bit1" }, { name: "Dream", osc: { shape: 0.3 },
    env: { attack: 0.03, decay: 0.5, sustain: 0.3, release: 0.9 }, filter: { cutoff: 2200, resonance: 0.1, type: "1-Pole Low-pass" } });
  space(p, [4, 0], v.out, "l", { level: 0, delay: { zone: 4, time: 0.55, feedback: 0.55, character: 0.35, wobble: 0.3, tone: -0.3, mix: 0.45 }, verb: { size: 0.85, decay: 7, mix: 0.4 } });
  return p;
}

export default [lockedLoop, canonBeat, rhythmEcho, mirrorFlip, driftingFreeRun];
