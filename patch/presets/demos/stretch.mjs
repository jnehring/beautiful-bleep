// SPDX-License-Identifier: GPL-3.0-or-later
// Stretch: five demo patches. Each plays by itself with the transport. The tape is a short rolling take of a looping
// source (the loop is as long as the tape), so the stretched sound is there from the first bar.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, s) => p.cable(amp, "l", s, "l");
/// Stretch stereo out (+ optional dry/drums) → mixer (gain dB) → Verb → Out 1/2. `extra` = [[node, jacks]] on channels 2, 3.
function finish(p, s, at, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.gain ?? 0, pan1: -1, level2: o.gain ?? 0, pan2: 1, master: o.master ?? 0 }, { name: "Level" });
  p.cable(s, "l", mix, "in1l").cable(s, "r", mix, "in2r");
  (o.extra || []).forEach(([n], i) => {
    const ch = 3 + i;
    p.cable(n, "outl", mix, "in" + ch + "l").cable(n, "outr", mix, "in" + ch + "r");
  });
  const v = p.add("reverb", [at[0] + 1, at[1]], { size: 0.7, decay: 4, damping: 0.5, mix: o.verb ?? 0.25, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"], to: ["l", "r"] }).stereo(v, p.out);
  return mix;
}

function slowPad() {
  const p = patch("Stretch: Melody into Pad", {
    module: "stretch", tempo: 120,
    description: "A plucked loop is recorded into a four second rolling tape and played back four times slower by the Smear engine, so the notes melt into a slowly changing pad over a plain beat. Try Stretch at 8 for a still drone, Wobble for a drifting sense of time, or Mix lower to hear the live melody under the pad.",
    tags: ["pad", "smear", "slow down", "ambient"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 10, 3, 7, 5, 10], { rate: "1/4", shape: 0.5, root: "A", scale: "Natural Minor", gatelength: 0.8,
    env: { attack: 0.01, decay: 0.7, sustain: 0.3, release: 0.5 } });
  const s = p.add("stretch", [3, 0], { stretch: 4, engine: "Smear", window: "4096", record: "Rolling", length: 4, mix: 1, wobble: 0.08, wobblerate: 0.3, wobbleshape: "Sine" });
  feed(p, m.amp, s);
  const d = beat(p, [0, 3], { style: "half", level: -10 });
  finish(p, s, [4, 0], { gain: 3, verb: 0.3, extra: [[d]] });
  return p;
}

function cloud() {
  const p = patch("Stretch: Granular Cloud", {
    module: "stretch", tempo: 100,
    description: "An arpeggio is cut into 250 ms grains that are scattered around the play head, four at a time, while the head crawls through a four second tape at a quarter of the speed. The result is a shimmering cloud with the dry arpeggio underneath. Move Scatter between 0 and 100 %, shorten Grain for a glitchier texture, or raise Pitch.",
    tags: ["grains", "cloud", "scatter", "texture", "arpeggio"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 12, 11, 7, 4], { rate: "1/8", shape: 0.3, root: "D", scale: "Dorian", octave: 0, gatelength: 0.4,
    env: { attack: 0.003, decay: 0.35, sustain: 0.05, release: 0.25 } });
  const s = p.add("stretch", [3, 0], { stretch: 4, engine: "Grains", grain: 250, overlap: "4×", scatter: 0.7, record: "Rolling", length: 2.4, mix: 0.75, pitch: 0 });
  feed(p, m.amp, s);
  const dry = p.add("audio-mixer", [3, 2], { level1: -9, master: 0 }, { name: "Dry" });
  p.cable(m.amp, "l", dry, "in1l").cable(m.amp, "l", dry, "in1r");
  finish(p, s, [4, 0], { gain: 6, verb: 0.3, extra: [[dry]] });
  return p;
}

function scanner() {
  const p = patch("Stretch: Frozen Scanner", {
    module: "stretch", tempo: 60,
    description: "A short chord progression is recorded once, then the tape is frozen and Position Mode is set to Scrub, so a slow LFO on Position sweeps a spectral scanner back and forth through the chords. It sounds like one sustained organ whose harmony slides between the recorded chords. Change the LFO rate, or turn Freeze off to hear the tape move again.",
    tags: ["freeze", "scrub", "spectral", "lfo", "chords"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "C", scale: "Natural Minor", gatelength: 1 }, {});
  const osc1 = p.add("oscillator", [1, 0], { shape: 0.3 }, { name: "Root" });
  const osc2 = p.add("oscillator", [1, 1], { shape: 0.3, coarse: 7 }, { name: "Fifth" });
  const osc3 = p.add("oscillator", [1, 2], { shape: 0.3, coarse: 3, fine: 6 }, { name: "Third" });
  const sum = p.add("audio-mixer", [2, 0], { level1: -8, level2: -9, level3: -9, master: 0 }, { name: "Chord" });
  p.cable(seq, "pitch", osc1, "pitch").cable(seq, "pitch", osc2, "pitch").cable(seq, "pitch", osc3, "pitch")
    .cable(osc1, "out", sum, "in1l").cable(osc2, "out", sum, "in2l").cable(osc3, "out", sum, "in3l");
  const s = p.add("stretch", [3, 0], { engine: "Smear", window: "4096", record: "Once", length: 4, freeze: true, mode: "Scrub", position: 0.5, start: 0, range: 1, hold: true, mix: 1 });
  p.cable(sum, "outl", s, "l");
  const lfo = p.add("lfo", [3, 2], { rate: 0.08, wave: "Triangle", polarity: "Unipolar" }, { name: "Scan" });
  p.cable(lfo, "out", s, "position", 0.5);
  finish(p, s, [4, 0], { gain: -10, verb: 0.35 });
  return p;
}

function stutter() {
  const p = patch("Stretch: Hold Range Stutter", {
    module: "stretch", tempo: 110,
    description: "Hold Range loops a window of only 4 % of a one-bar tape, which stutters a bright pluck line into a tiny repeating loop. A slow random source moves Start, so the stutter keeps landing on a different piece of the phrase. Change Range for longer or shorter loops, or Grains for a rougher edge.",
    tags: ["stutter", "hold range", "loop", "glitch", "rhythm"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 12, 10, 7, 3, 5], { rate: "1/8", shape: 0.8, root: "E", scale: "Minor Pentatonic", gatelength: 0.5,
    env: { attack: 0.003, decay: 0.2, sustain: 0.1, release: 0.15 } });
  const s = p.add("stretch", [3, 0], { stretch: 1, engine: "Grains", grain: 40, overlap: "3×", scatter: 0, record: "Rolling", length: 2.2, hold: true, start: 0.3, range: 0.04, mix: 1 });
  feed(p, m.amp, s);
  const r = p.add("random", [3, 2], { sync: "1/2", spread: 1, smooth: 0, seed: 5 }, { name: "Start" });
  const uni = p.add("utility", [2, 2], { scalex: 0.5, offset: 0.5 }, { name: "Unipolar" });
  p.cable(r, "out", uni, "x").cable(uni, "out", s, "start", 0.8);
  const d = beat(p, [0, 3], { style: "broken", level: -9 });
  finish(p, s, [4, 0], { gain: 6, verb: 0.15, extra: [[d]] });
  return p;
}

function wobble() {
  const p = patch("Stretch: Time Wobble", {
    module: "stretch", tempo: 96,
    description: "A drum and bass loop is replayed from a rolling tape seven semitones up while Wobble with a random shape keeps changing the stretch factor, so the groove slows down, speeds up and smears as if time itself was swaying. Turn Wobble down for a steady pitch-shifted copy, or set Pitch to -12 for a heavy, slowed sound.",
    tags: ["wobble", "random", "drums", "bass", "time"],
  });
  const bass = melody(p, [0, 0], [0, ".", 0, 7, ".", 5, 3, "."], { rate: "1/8", shape: 0.7, octave: -1, root: "G", scale: "Minor Pentatonic", gatelength: 0.6,
    env: { attack: 0.004, decay: 0.2, sustain: 0.5, release: 0.1 } });
  const d = beat(p, [0, 3], { style: "four", level: -6 });
  const src = p.add("audio-mixer", [3, 0], { level1: -4, level2: -3, level3: -3 }, { name: "Loop" });
  p.cable(bass.amp, "l", src, "in1l").cable(d, "outl", src, "in2l").cable(d, "outr", src, "in3r");
  const s = p.add("stretch", [4, 0], { stretch: 1.5, pitch: 7, engine: "Grains", grain: 90, overlap: "3×", scatter: 0.1, record: "Rolling", length: 2.5,
    wobble: 0.6, wobblerate: 0.8, wobbleshape: "Random", mix: 1 });
  p.cable(src, "outl", s, "l").cable(src, "outr", s, "r");
  finish(p, s, [5, 0], { gain: 6, verb: 0.15 });
  return p;
}

export default [slowPad, cloud, scanner, stutter, wobble];
