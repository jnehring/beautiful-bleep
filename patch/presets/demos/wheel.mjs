// Wheel: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A Step Sequencer: `notes` as in steps(); `knobs` are its settings; `vel` the velocities.
function sq(p, at, notes, knobs = {}, vel) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: "1/8", gatelength: 0.45, ...knobs }, { data: steps(notes, vel) });
}

/// Oscillator → ADSR → VCA from a pitch and gate source ({node, pitch, gate, trigger, velocity}), optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger !== false) p.cable(src.node, src.trigger || "trigger", env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Mono source → optional delay → reverb → Out 1/2. Returns the reverb.
function space(p, at, from, jack, { level = 3, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: true }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    node = p.add("zone-delay", [c, r], delay);
    p.stereo(m, node, { from: out });
    out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

/// Mono voice + drums → mixer → short reverb → Out 1/2.
function withBeat(p, at, from, jack, style, { lead = -2, drums = -4, level = -9, verb = {} } = {}) {
  const [c, r] = at;
  const d = beat(p, [c, r + 1], { style, level });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: lead, level2: drums, master: -2 }, { name: "Mix" });
  p.cable(from, jack, mix, "in1l").cable(from, jack, mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [c + 2, r], { size: 0.3, decay: 1.2, mix: 0.12, ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

function pitchBend() {
  const p = patch("Wheel: Pitch Bend", {
    module: "wheel", tempo: 104,
    description: "A lead line plays while the Wheel sits at rest in the middle (zero) and feeds the sequencer's Transpose input at a small amount: push it up or down and the whole line bends by a couple of notes, then springs back when you let go. Turn Spring off to leave it where you put it.",
    tags: ["pitch bend", "spring", "lead", "performance"],
  });
  const s = sq(p, [0, 0], [0, 4, 7, 12, 11, 7, 4, 2], { rate: "1/8", root: "A", scale: "Dorian", gatelength: 0.8 });
  const w = p.add("wheel", [0, 2], { value: 0.5, min: -1, max: 1, smooth: 0.03, spring: true }, { name: "Bend Wheel" });
  p.cable(w, "out", s, "transpose", 1 / 6);
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.8 }, env: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.2 }, filter: { cutoff: 2400, resonance: 0.2 } });
  space(p, [4, 0], v.out, "l", { level: 5, delay: { zone: 3, time: 0.45, feedback: 0.4, mix: 0.25 }, verb: { size: 0.5, decay: 2.2, mix: 0.25 } });
  return p;
}

function foldWheel() {
  const p = patch("Wheel: Fold Wheel", {
    module: "wheel", tempo: 96,
    description: "Min is 0 and Spring is off, so this Wheel behaves like a mod wheel that stays where you leave it: it raises the wavefolder inside a dual oscillator, turning a plain tone into a bright, buzzing one. Drag it slowly across the tune and listen to the overtones appear.",
    tags: ["mod wheel", "fold", "timbre", "latching"],
  });
  const s = sq(p, [0, 0], [0, 7, 3, 10, 5, 3, 7, 0], { rate: "1/8", root: "D", scale: "Natural Minor", octave: -1, gatelength: 0.7 });
  const o = p.add("dual-osc", [1, 0], { shapeA: 0.3, shapeB: 0.5, octaveB: -1, balance: 0.4, fold: 0.1 });
  const env = p.add("adsr", [1, 2], { attack: 0.01, decay: 0.35, sustain: 0.4, release: 0.25 }, { name: "Amp Env" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  const w = p.add("wheel", [0, 2], { value: 0.3, min: 0, max: 1, spring: false, smooth: 0.1 }, { name: "Fold Wheel" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig")
    .cable(o, "mix", amp, "l").cable(env, "env", amp, "gain").cable(w, "out", o, "fold", 0.8);
  space(p, [4, 0], amp, "l", { level: 5, delay: { zone: 3, time: 0.4, feedback: 0.35, mix: 0.2 }, verb: { size: 0.5, decay: 2.2, mix: 0.25 } });
  return p;
}

function crunchRide() {
  const p = patch("Wheel: Crunch Ride", {
    module: "wheel", tempo: 112,
    description: "The Wheel rides the Drive and bit depth of a Crunch effect on a whole beat and bass: at rest the groove is clean and warm, pushed up it breaks into grit. Min is 0 here, so the wheel only adds grit; set it to -1 and the lower half takes the drive below the starting point.",
    tags: ["distortion", "drums", "drive", "performance"],
  });
  const s = sq(p, [0, 0], [0, 0, ".", 12, 0, ".", 7, 10], { rate: "1/16", root: "C", scale: "Minor Pentatonic", octave: -2, gatelength: 0.5 });
  const bass = voice(p, [1, 0], { node: s }, { osc: { shape: 0.9 }, env: { decay: 0.18, sustain: 0.35, release: 0.08 }, filter: { cutoff: 600, resonance: 0.25 } });
  const drums = beat(p, [0, 3], { style: "shuffle", level: -9 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -2, level2: -3, master: -2 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").cable(bass.out, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const cr = p.add("crunch", [4, 0], { drive: 0.25, bits: 12, rate: 0.1, tone: 9000, level: 0.9, mix: 1 });
  const w = p.add("wheel", [4, 2], { value: 0.5, min: 0, max: 1, spring: true, smooth: 0.05 }, { name: "Grit Wheel" });
  p.stereo(mix, cr, { from: ["outl", "outr"] }).stereo(cr, p.out).cable(w, "out", cr, "drive", 0.7).cable(w, "out", cr, "bits", -0.4);
  return p;
}

function phaserSweep() {
  const p = patch("Wheel: Phaser Sweep", {
    module: "wheel", tempo: 90,
    description: "A chord-like arpeggio passes through a slow phaser whose Centre frequency is steered by the Wheel instead of its LFO: roll it up and the notches climb, down and they sink. Raise the phaser's Feedback to make the sweep more vocal.",
    tags: ["phaser", "sweep", "arpeggio", "manual"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 5], { rate: "1/8", shape: 0.85, root: "G", scale: "Mixolydian", env: { decay: 0.4, sustain: 0.3, release: 0.3 }, gatelength: 0.6 });
  const ph = p.add("phaser", [3, 0], { rate: 0.05, depth: 0.2, centre: 800, feedback: 0.6, stages: "8", mix: 0.65 });
  const w = p.add("wheel", [3, 2], { value: 0.5, min: -1, max: 1, spring: false, smooth: 0.1 }, { name: "Sweep Wheel" });
  const lvl = p.add("audio-mixer", [2, 1], { level1: 0, master: 0 }, { name: "Level" });
  const v = p.add("reverb", [4, 0], { size: 0.5, decay: 2.5, mix: 0.2 });
  p.cable(m.amp, "l", lvl, "in1l").cable(m.amp, "l", lvl, "in1r").stereo(lvl, ph, { from: ["outl", "outr"] }).stereo(ph, v).stereo(v, p.out)
    .cable(w, "out", ph, "centre", 0.4);
  return p;
}

function tapeBend() {
  const p = patch("Wheel: Tape Bend", {
    module: "wheel", tempo: 80,
    description: "The Wheel pushes the delay time of a tape-style echo while a pluck melody plays: nudge it and the echoes slide in pitch as the tape speeds up or slows down, then settle when the wheel springs home. Turn Smooth up for lazier moves.",
    tags: ["delay", "tape", "time", "spring"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 10, 5, ".", 7, "."], { rate: "1/8", shape: 0.6, root: "F", scale: "Dorian", env: { decay: 0.3, sustain: 0.05, release: 0.2 }, gatelength: 0.3 });
  const d = p.add("zone-delay", [3, 0], { zone: 3, time: 0.45, feedback: 0.6, mix: 0.5, tone: -0.3, wobble: 0.2 });
  const v = p.add("reverb", [4, 0], { size: 0.45, decay: 2, mix: 0.2 });
  const w = p.add("wheel", [3, 2], { value: 0.5, min: -1, max: 1, spring: true, smooth: 0.15 }, { name: "Tape Wheel" });
  p.cable(m.amp, "l", d, "l").cable(m.amp, "l", d, "r").stereo(d, v).stereo(v, p.out).cable(w, "out", d, "time", 0.15);
  return p;
}

export default [pitchBend, foldWheel, crunchRide, phaserSweep, tapeBend];
