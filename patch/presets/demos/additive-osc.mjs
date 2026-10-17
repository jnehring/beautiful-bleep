// SPDX-License-Identifier: MIT
// Additive Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
function seqOf(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, {
    length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
  }, { data: steps(notes) });
}

/// Sequencer pitch → `src`, gate → ADSR → VCA. `jacks`: the source's audio outs (one = mono, two = stereo).
/// Returns {amp, out}: `out` are the VCA jacks to take (l, l for a mono source).
function play(p, at, src, seq, jacks, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  p.cable(seq, "pitch", src, o.pitch || "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain");
  if (jacks.length === 1) { p.cable(src, jacks[0], amp, "l"); return { amp, env, out: ["l", "l"] }; }
  p.stereo(src, amp, { from: jacks });
  return { amp, env, out: ["l", "r"] };
}

/// Source jacks → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// A drum loop and a voice mixed together into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}


function tiltSweep() {
  const p = patch("Additive Osc: Tilt Sweep", {
    module: "additive-osc", tempo: 96,
    description: "A saw-shaped stack of partials whose Tilt is swept by a slow LFO, from dark and woolly to bright and ringing, with no filter involved. Reduce Partials for a rounder tone or push Tilt up for an organ-like glare.",
    tags: ["tilt", "spectrum", "sweep", "lead"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 10, 7, 3, 12, 10, 7, 3, 5, 3, 0, 3, 7, "."], { root: "G", rate: "1/8", gate: 0.6 });
  const osc = p.add("additive-osc", [1, 0], { base: "Saw", partials: 40, tilt: -6, width: 0.4 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.1, wave: "Triangle" }, { name: "Tilt LFO" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.35, sustain: 0.5, release: 0.3 } });
  p.cable(lfo, "out", osc, "tilt", 0.6);
  finish(p, [3, 0], v.amp, v.out, 0, { size: 0.55, decay: 3, mix: 0.25 });
  return p;
}

function clarinet() {
  const p = patch("Additive Osc: Odd Partials Reed", {
    module: "additive-osc", tempo: 88,
    description: "Odd/Even is pulled to the odd side so only the 1st, 3rd, 5th partials sound: a hollow, reedy tone. Move Odd/Even through zero to bring back the even partials and watch the reed turn into a full saw.",
    tags: ["odd harmonics", "hollow", "reed", "melody"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 2, 4, 7, "_", 4, 2, 0, "_", -3, ".", 2, 4, 2, 0], { root: "D", scale: "Major", rate: "1/8", gate: 0.8, octave: 0 });
  const osc = p.add("additive-osc", [1, 0], { base: "Saw", oddEven: -1, partials: 24, tilt: -2 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.06 }, { name: "Odd/Even" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 0.04, decay: 0.2, sustain: 0.7, release: 0.2 } });
  p.cable(lfo, "out", osc, "oddEven", 0.25);
  finish(p, [3, 0], v.amp, v.out, -3, { size: 0.45, decay: 2.2, mix: 0.2 });
  return p;
}

function bellStretch() {
  const p = patch("Additive Osc: Stretched Bells", {
    module: "additive-osc", tempo: 72,
    description: "A flat spectrum with Stretch pushing the partials apart gives inharmonic, bell-like tones, and each trigger restarts a decay that makes the high partials die first. Change Stretch for a metallic or glassy family, or Decay for longer ringing.",
    tags: ["bell", "stretch", "inharmonic", "decay"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 7, ".", 12, ".", 9, ".", 4, ".", 7, ".", 2, 5, 7, "."], { root: "E", scale: "Major Pentatonic", rate: "1/8", octave: 1, gate: 0.4 });
  const osc = p.add("additive-osc", [1, 0], { base: "Flat", partials: 18, stretch: 0.35, tilt: -9, decay: 2.5, damp: 0.7, width: 0.8 });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 0.002, decay: 2, sustain: 0.8, release: 1.5 } });
  p.cable(seq, "trigger", osc, "trigger");
  finish(p, [3, 0], v.amp, v.out, -2, { size: 0.7, decay: 5, mix: 0.35 });
  return p;
}

function combChoir() {
  const p = patch("Additive Osc: Comb Choir", {
    module: "additive-osc", tempo: 66,
    description: "A slow chord line played by a comb-notched spectrum with a wide chorus, giving a shimmering, voice-like pad. Change Comb Spacing to move the notches or raise Chorus for a bigger, more unstable cloud.",
    tags: ["pad", "comb", "chorus", "ambient"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"], { root: "F", scale: "Major", octave: -1, rate: "1/4", gate: 1 });
  const osc = p.add("additive-osc", [1, 0], { base: "Saw", partials: 28, tilt: -4, comb: 0.65, combSpacing: 5, chorus: 22, chorusRate: 0.25, width: 1 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.05 }, { name: "Comb Phase" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 1.5, decay: 1, sustain: 0.85, release: 2.5 } });
  p.cable(lfo, "out", osc, "combPhase", 0.5);
  finish(p, [3, 0], v.amp, v.out, -2, { size: 0.85, decay: 7, mix: 0.4 });
  return p;
}

function oddEvenSplit() {
  const p = patch("Additive Osc: Odd and Even Split", {
    module: "additive-osc", tempo: 100,
    description: "The odd-partial and even-partial outputs go to separate mixer channels whose pans drift in opposite directions, so the two halves of one tone circle each other. Mute one channel to hear its half alone.",
    tags: ["odd output", "even output", "stereo", "pan"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 7, ".", 5, 3, ".", 0, ".", 0, 10, ".", 7, 5, 3], { root: "A", octave: -1, gate: 0.6 });
  const osc = p.add("additive-osc", [1, 0], { base: "Saw", partials: 32, tilt: -3 });
  const env = p.add("adsr", [2, 3], { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.25 }, { name: "Amp Env" });
  const a1 = p.add("vca", [2, 0], {}, { name: "Odd VCA" });
  const a2 = p.add("vca", [2, 1], {}, { name: "Even VCA" });
  const mix = p.add("audio-mixer", [3, 0], { level1: -2, level2: -4, pan1: -0.7, pan2: 0.7, master: 0 }, { name: "Halves" });
  const l1 = p.add("lfo", [1, 2], { rate: 0.2 }, { name: "Pan Odd" });
  const l2 = p.add("lfo", [1, 3], { rate: 0.2, phase: 180 }, { name: "Pan Even" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(env, "env", a1, "gain").cable(env, "env", a2, "gain").cable(osc, "odd", a1, "l").cable(osc, "even", a2, "l")
    .cable(a1, "l", mix, "in1l").cable(a2, "l", mix, "in2l").cable(l1, "out", mix, "pan1", 0.9).cable(l2, "out", mix, "pan2", 0.9);
  const drums = beat(p, [0, 5], { style: "half", level: -7 });
  withDrums(p, [4, 0], mix, ["outl", "outr"], drums, { l1: 4, l2: -2, master: 0 });
  return p;
}

export default [tiltSweep, clarinet, bellStretch, combChoir, oddEvenSplit];
