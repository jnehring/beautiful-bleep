// SPDX-License-Identifier: MIT
// Sampler: five demo patches. Each plays by itself with the transport and carries the recordings it plays
// (patch/presets/samples, see the README there for where they come from).
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";
import { samplerData, equalMarkers } from "../media.mjs";

/// A Step Sequencer that plays the Sampler's Notes input.
function player(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, {
    length: Math.min(32, notes.length), rate: o.rate || "1/8", root: o.root || "C", scale: o.scale || "Chromatic",
    octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
  }, { data: steps(notes, o.vel), name: o.name || "Player" });
}
/// Stereo source → trim mixer → Verb → Out 1/2.
function room(p, at, src, o = {}) {
  const m = p.add("audio-mixer", at, { level1: o.trim ?? 0, pan1: -1, level2: o.trim ?? 0, pan2: 1, master: o.master ?? 0 }, { name: "Level" });
  p.cable(src, "l", m, "in1l").cable(src, "r", m, "in2r");
  const v = p.add("reverb", [at[0] + 1, at[1]], { size: 0.5, decay: 2.2, damping: 0.5, mix: o.mix ?? 0.2, quality: "Eco (8 lines)", ...(o.v || {}) });
  p.cable(m, "outl", v, "l").cable(m, "outr", v, "r").stereo(v, p.out);
  return m;
}
const slice = (o = {}) => ({ mode: -1, transpose: 0, level: 1, pan: 0, reverse: false, choke: 0, ...o });

function woodSlicer() {
  const p = patch("Sampler: Wood Bar Shuffle", {
    module: "sampler", tempo: 120,
    description: "One bar of claves, castanets and granite blocks is cut into sixteen equal slices. With Slice Mode on, each key plays one slice (slice 1 on the Root Note), so a step sequencer re-orders the bar into a new groove; two slices are set to Reverse in the view. Edit the sequence, drag a marker, or select a slice to change its pitch and level.",
    tags: ["slices", "percussion", "rearrange", "wood", "groove"],
  });
  const s = p.sample("wood-loop");
  const seq = player(p, [0, 0], [0, 1, 2, 3, 4, ".", 4, 3, 8, 9, 10, 11, 12, 5, 14, 15], { rate: "1/16", gate: 0.9 });
  const smp = p.add("sampler", [1, 0], { mode: "One-shot", slicemode: "On", root: 60, release: 0.02, level: 1.1 },
    { data: samplerData(s, { markers: equalMarkers(s, 16), slicing: { kind: "beats", beats: 16 }, slices: { 5: slice({ reverse: true }), 14: slice({ reverse: true, transpose: 5 }) } }) });
  p.cable(seq, "notes", smp, "notes");
  const d = beat(p, [0, 1], { style: "sparse", level: -8 });
  const m = room(p, [2, 0], smp, { trim: 0, mix: 0.12 });
  p.cable(d, "outl", m, "in3l").cable(d, "outr", m, "in3r");
  return p;
}

function pianoKeys() {
  const p = patch("Sampler: Two-Note Piano", {
    module: "sampler", tempo: 88,
    description: "Two recorded piano notes, C3 and C4, each sit on their own Sampler with the right Root Note, and a step sequencer plays the left hand on one and the right hand on the other. Sampler pitches the single recording across the keyboard, tape-style. Try Quality for cleaner pitch shifting, Release for staccato, or Cutoff for a softer touch.",
    tags: ["piano", "pitched", "melody", "instrument", "root note"],
  });
  const c3 = p.sample("piano-c3"), c4 = p.sample("piano-c4");
  const rh = player(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 7, 5, 9, 12, 14, 12, 9, 7, "."], { rate: "1/8", scale: "Major", gate: 0.8, name: "Right Hand", vel: [105, 80, 90, 80] });
  const lh = player(p, [0, 1], [0, ".", ".", ".", 7, ".", ".", ".", 5, ".", ".", ".", 7, ".", ".", "."], { rate: "1/4", scale: "Major", octave: -1, gate: 1.0, name: "Left Hand" });
  const hi = p.add("sampler", [1, 0], { mode: "Gate", root: 60, release: 0.45, voices: 8, level: 0.9, cutoff: 9000, quality: "Sinc" }, { data: samplerData(c4), name: "Right Hand Piano" });
  const lo = p.add("sampler", [1, 1], { mode: "Gate", root: 48, release: 0.8, voices: 4, level: 0.9, pan: -0.15, cutoff: 5000 }, { data: samplerData(c3), name: "Left Hand Piano" });
  p.cable(rh, "notes", hi, "notes").cable(lh, "notes", lo, "notes");
  const mix = p.add("audio-mixer", [2, 0], { level1: -4, pan1: 0.2, level2: -5, pan2: -0.2, master: -1 }, { name: "Mix" });
  p.cable(hi, "l", mix, "in1l").cable(hi, "r", mix, "in1r").cable(lo, "l", mix, "in2l").cable(lo, "r", mix, "in2r");
  const v = p.add("reverb", [3, 0], { size: 0.55, decay: 2.5, mix: 0.2, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", v, "l").cable(mix, "outr", v, "r").stereo(v, p.out);
  return p;
}

function gongLayers() {
  const p = patch("Sampler: Gong Garden", {
    module: "sampler", tempo: 58,
    description: "A Thai gong played in Layers voice mode: every note starts three playheads a fifth apart (Layer Pitch 7), each a little later than the last, so one gong becomes a bell cluster. Slow notes ring into each other. Change Layers, Layer Pitch or Layer Offset for other stacks, or switch Voice Mode back to Poly for a single gong.",
    tags: ["gong", "layers", "ambient", "bell", "voice mode"],
  });
  const s = p.sample("thai-gong-a4");
  const seq = player(p, [0, 0], [0, ".", ".", 5, ".", ".", 7, ".", ".", 3, ".", ".", 10, ".", ".", "."], { rate: "1/4", scale: "Minor Pentatonic", root: "A", octave: 0, gate: 0.4 });
  const smp = p.add("sampler", [1, 0], { mode: "To end of sample", root: 69, voicemode: "Layers", layers: 3, layerpitch: 7, layeroffset: 60, release: 1.5, level: 1.0, voices: 12 },
    { data: samplerData(s) });
  p.cable(seq, "notes", smp, "notes");
  room(p, [2, 0], smp, { trim: -3, mix: 0.35, v: { size: 0.8, decay: 6 } });
  return p;
}

function tamTamPad() {
  const p = patch("Sampler: Tam-Tam Drone", {
    module: "sampler", tempo: 60,
    description: "A short, steady stretch of a tam-tam recording is looped (Mode Loop with a crossfade that hides the seam) and played slowly from the keys as a shimmering metallic pad. A slow LFO scrubs the Position inside the region and another opens the filter. Move Start and End to choose a different part of the gong, or shorten the region for a more electronic drone.",
    tags: ["loop", "pad", "drone", "scrub", "texture"],
  });
  const s = p.sample("tam-tam");
  const seq = player(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", scale: "Natural Minor", root: "D", octave: -1, gate: 1 });
  const smp = p.add("sampler", [1, 0], { mode: "Loop", loopfade: 0.04, start: 0.3, end: 0.55, root: 60, attack: 1.2, release: 2.5, decay: 0.2, sustain: 1, cutoff: 3000, resonance: 0.25, level: 1.6, voices: 6, positionmode: "Scrub", quality: "Cubic" },
    { data: samplerData(s) });
  const scrub = p.add("lfo", [1, 1], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "Scrub" });
  const open = p.add("lfo", [1, 2], { rate: 0.037, wave: "Sine" }, { name: "Open" });
  p.cable(seq, "notes", smp, "notes").cable(scrub, "out", smp, "position", 0.8).cable(open, "out", smp, "cutoff", 0.25);
  room(p, [2, 0], smp, { trim: 3, mix: 0.4, v: { size: 0.85, decay: 8 } });
  return p;
}

function shakerChoke() {
  const p = patch("Sampler: Shaker Choke", {
    module: "sampler", tempo: 112,
    description: "A tambourine shake is cut into four slices, all in choke group 1, so each new hit cuts off the one before it. Trigger By is CV: a trigger starts a playhead and a random control signal on the Slice input picks which part of the shake plays, one of them reversed. Change the sequence, or select a slice in the view and give it another group.",
    tags: ["choke", "cv", "slice input", "reverse", "shaker"],
  });
  const s = p.sample("tambourine-shake");
  const seq = player(p, [0, 0], [0, ".", 0, 0, ".", 0, 0, 0, ".", 0, 0, ".", 0, ".", 0, 0], { rate: "1/8", gate: 0.5, vel: [120, 85, 100, 75] });
  const rnd = p.add("random", [0, 1], { sync: "1/8", spread: 1, loop: 0.9, length: "8 steps", seed: 11 }, { name: "Slice Picker" });
  const uni = p.add("utility", [0, 2], { scalex: 0.5, offset: 0.5 }, { name: "Unipolar" });
  const ch = { mode: 2, choke: 1 };
  const smp = p.add("sampler", [1, 0], { triggerby: "CV", slicemode: "On", mode: "To end of slice", level: 1.2, release: 0.03, velocity: 0.6 },
    { data: samplerData(s, { markers: equalMarkers(s, 4), slicing: { kind: "beats", beats: 4 },
      slices: { 0: slice(ch), 1: slice(ch), 2: slice({ ...ch, reverse: true }), 3: slice(ch) } }) });
  p.cable(seq, "trigger", smp, "trigger").cable(seq, "velocity", smp, "velocity").cable(rnd, "out", uni, "x").cable(uni, "out", smp, "slice");
  const d = beat(p, [0, 3], { style: "half", level: -6 });
  const m = room(p, [2, 0], smp, { trim: 0, mix: 0.15 });
  p.cable(d, "outl", m, "in3l").cable(d, "outr", m, "in3r");
  return p;
}

export default [woodSlicer, pianoKeys, gongLayers, tamTamPad, shakerChoke];
