// SPDX-License-Identifier: MIT
// Formant Osc: five demo patches. Each plays by itself with the transport.
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


function vowelSweep() {
  const p = patch("Formant Osc: Vowel Sweep", {
    module: "formant-osc", tempo: 84,
    description: "A flowing melody on the Formant Osc while a slow LFO sweeps the Formant peak, so the tone opens and closes like a voice changing vowels, without a filter anywhere. Move Formant by hand, or raise Narrow for a more nasal peak.",
    tags: ["vowel", "sweep", "voice", "formant"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 3, "_", 7, "_", 5, "_", 0, "_", 10, "_", 7, "_", 3, "."], { root: "A", octave: -1, rate: "1/8", gate: 0.85 });
  const osc = p.add("formant-osc", [1, 0], { formant: 2, narrow: 0.35, body: 0.7 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.13, wave: "Sine" }, { name: "Formant LFO" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.25 } });
  p.cable(lfo, "out", osc, "formantCv", 0.4);
  finish(p, [3, 0], v.amp, v.out, -2, { size: 0.55, decay: 3, mix: 0.28 });
  return p;
}

function acidBass() {
  const p = patch("Formant Osc: Squelch Bass", {
    module: "formant-osc", tempo: 118,
    description: "A decaying envelope sweeps the formant peak up and down on every note, giving a squelchy bass that behaves like a resonant filter although there is none. Change Narrow for a sharper squelch, or lengthen the decay for a longer wow.",
    tags: ["bass", "squelch", "envelope", "drums"],
  });
  const seq = seqOf(p, [0, 0], [0, 0, ".", 12, 0, ".", 10, 0, 3, ".", 0, 7, ".", 0, 5, "."], { root: "E", octave: -2, rate: "1/16", gate: 0.5, scale: "Minor Pentatonic" });
  const osc = p.add("formant-osc", [1, 0], { formant: 0.3, narrow: 0.55, body: 0.6, roll: 0.2 });
  const fe = p.add("adsr", [1, 2], { attack: 0.002, decay: 0.28, sustain: 0.05, release: 0.15 }, { name: "Formant Env" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.2, sustain: 0.6, release: 0.1 } });
  p.cable(seq, "gate", fe, "gate").cable(seq, "trigger", fe, "retrig").cable(fe, "env", osc, "formantCv", 0.55);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  withDrums(p, [3, 0], v.amp, v.out, drums, { l1: 1, l2: -6 });
  return p;
}

function choirPad() {
  const p = patch("Formant Osc: Wide Choir", {
    module: "formant-osc", tempo: 62,
    description: "Slow chord roots on the Formant Osc with Spread and Body opened up make a breathy, choir-like pad that sits wide in the stereo field. Turn Spread to zero for mono, or Roll up to soften the upper end.",
    tags: ["pad", "choir", "stereo", "ambient"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { root: "G", scale: "Natural Minor", octave: -1, rate: "1/4", gate: 1 });
  const osc = p.add("formant-osc", [1, 0], { formant: 1.6, narrow: 0.25, body: 0.85, spread: 0.9, roll: 0.3 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.05 }, { name: "Drift" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 1.4, decay: 1, sustain: 0.85, release: 2.5 } });
  p.cable(lfo, "out", osc, "formantCv", 0.2);
  finish(p, [3, 0], v.amp, v.out, -1, { size: 0.85, decay: 7, mix: 0.4 });
  return p;
}

function talkingArp() {
  const p = patch("Formant Osc: Random Vowels", {
    module: "formant-osc", tempo: 110,
    description: "A fast arpeggio while a Random module picks a new smooth Formant position every few beats: each note wears a different vowel. Raise Random's Smooth for glides between vowels, or Spread for bolder jumps.",
    tags: ["random", "arpeggio", "vowel", "generative"],
  });
  const seq = seqOf(p, [0, 0], [0, 7, 12, 7, 3, 7, 12, 15, 0, 7, 12, 7, 5, 8, 12, 17], { root: "C", scale: "Natural Minor", octave: 0, rate: "1/16", gate: 0.45 });
  const osc = p.add("formant-osc", [1, 0], { formant: 1.5, narrow: 0.4, body: 0.7 });
  const rnd = p.add("random", [1, 2], { sync: "1/8", spread: 0.8, smooth: 0.5 }, { name: "Vowel Picker" });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { decay: 0.18, sustain: 0.1, release: 0.15 } });
  p.cable(rnd, "out", osc, "formantCv", 0.55);
  const dl = p.add("delay", [3, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/8", feedback: 0.35, mix: 0.25, mode: "Ping-Pong" });
  p.stereo(v.amp, dl, { from: v.out });
  finish(p, [4, 0], dl, ["l", "r"], 3, { size: 0.5, decay: 2.4, mix: 0.2 });
  return p;
}

function fixedFormant() {
  const p = patch("Formant Osc: Fixed Resonance", {
    module: "formant-osc", tempo: 92,
    description: "With Tracking on Fixed, the formant peak stays put while the notes move, as in a real vowel across a sung tune, instead of rising with the pitch. Switch Tracking back to Ratio and the whole tone shifts with each note.",
    tags: ["tracking", "fixed", "voice", "melody"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 4, 7, "_", 12, 7, 4, 0, "_", 5, 9, "_", 12, 9, 5], { root: "D", scale: "Major", octave: -1, rate: "1/8", gate: 0.7 });
  const osc = p.add("formant-osc", [1, 0], { formant: 3.5, narrow: 0.45, body: 0.7, tracking: "Fixed", spread: 0.3 });
  const v = play(p, [2, 0], osc, seq, ["outL", "outR"], { env: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.2 } });
  finish(p, [3, 0], v.amp, v.out, -2, { size: 0.5, decay: 2.8, mix: 0.25 });
  return p;
}

export default [vowelSweep, acidBass, choirPad, talkingArp, fixedFormant];
