// SPDX-License-Identifier: MIT
// Chord Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: o.rate || "1/4", root: o.root || "A",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.9 }, { data: steps(notes, o.vel), name: o.name || "Roots" });
}
/// Stereo source → VCA with an ADSR from the sequencer gate. Returns the VCA.
function amp(p, at, s, src, adsr, from = ["l", "r"]) {
  const env = p.add("adsr", at, adsr, { name: "Amp Env" });
  const v = p.add("vca", [at[0] + 1, at[1]], {}, { name: "VCA" });
  p.cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(env, "env", v, "gain");
  p.stereo(src, v, { from });
  return v;
}
function room(p, at, src, o = {}) {
  if (o.trim !== undefined) {  // level trim through a mixer first
    const m = p.add("audio-mixer", [at[0] - 1, at[1] + 2], { level1: o.trim, pan1: -1, level2: o.trim, pan2: 1, master: 0 }, { name: "Trim" });
    p.cable(src, (o.from || ["l", "r"])[0], m, "in1l").cable(src, (o.from || ["l", "r"])[1], m, "in2r");
    src = m; o = { ...o, from: ["outl", "outr"] };
  }
  const v = p.add("reverb", at, { size: 0.6, decay: 3, damping: 0.45, mix: o.mix ?? 0.3, quality: "Eco (8 lines)", ...o.v });
  p.stereo(src, v, { from: o.from || ["l", "r"] }).stereo(v, p.out);
  return v;
}

function seventhPad() {
  const p = patch("Chord Osc: Slow Seventh Pad", {
    module: "chord-osc", tempo: 66,
    description: "A slow bass line plays the root and Chord Osc stacks a minor seventh on it in the Open voicing, with a little Detune, wide Stereo and Glide so each chord melts into the next. Try other Chord types, change Voicing, or push Inversion up and down to hear the same chord from a different bass note.",
    tags: ["pad", "minor 7", "voicing", "glide"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/2", root: "A", octave: -1, scale: "Natural Minor" });
  const o = p.add("chord-osc", [1, 0], { chord: "Minor 7", voicing: "Open", voices: 4, shape: 0.5, detune: 9, stereo: 0.8, glide: 0.35, rootLevel: 0.8 });
  p.cable(s, "pitch", o, "pitch");
  const v = amp(p, [1, 1], s, o, { attack: 1.0, decay: 1, sustain: 0.9, release: 2.0 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.05 }, { name: "Slow Shape" });
  p.cable(lfo, "out", o, "shape", 0.3);
  room(p, [3, 0], v, { trim: -11, v: { size: 0.8, decay: 6, mix: 0.4 } });
  return p;
}

function diatonic() {
  const p = patch("Chord Osc: Chords From a Melody", {
    module: "chord-osc", tempo: 96,
    description: "In Scale mode every note of a simple melody becomes the diatonic chord on that scale degree: major, minor and diminished triads appear by themselves in C major. The melody's trigger is patched into Latch so chords change exactly on the step. Change Scale or Root to re-colour the tune, or set the stack to Seventh.",
    tags: ["scale mode", "progression", "latch", "diatonic"],
  });
  const m = seq(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", 1, "_", 4, "_", 2, "_"], { rate: "1/4", root: "C", scale: "Major", octave: 0, name: "Melody" });
  const o = p.add("chord-osc", [1, 0], { mode: "Scale", key: "C", scale: "Major", stack: "Triad", voicing: "Drop 2", voices: 4, shape: 0.35, detune: 6, stereo: 0.6, glide: 0.04 });
  p.cable(m, "pitch", o, "pitch").cable(m, "trigger", o, "latch");
  const v = amp(p, [1, 1], m, o, { attack: 0.02, decay: 0.6, sustain: 0.35, release: 0.6 });
  const d = beat(p, [0, 2], { style: "half", level: -10 });
  const mix = p.add("audio-mixer", [3, 0], { level1: 2, pan1: -1, level2: 2, pan2: 1, level3: -2, level4: -2, master: 0 }, { name: "Mix" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in2r").cable(d, "outl", mix, "in3l").cable(d, "outr", mix, "in3r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.22 });
  return p;
}

function stabs() {
  const p = patch("Chord Osc: Bass and Stabs", {
    module: "chord-osc", tempo: 122,
    description: "One Chord Osc is two instruments: its Root output, filtered and sub-heavy, is the bassline, and the chord itself plays short offbeat stabs on top (Root Level lowered so they do not double the bass). Try Dominant 9 or Minor add9 in Chord, or open the stab filter.",
    tags: ["bass", "stabs", "root output", "dance"],
  });
  const s = seq(p, [0, 0], [0, 0, ".", 0, 0, ".", 3, ".", 0, 0, ".", 5, 0, ".", 7, "."], { rate: "1/8", root: "F", scale: "Dorian", octave: -1, gate: 0.6 });
  const o = p.add("chord-osc", [1, 0], { chord: "Minor 9", voicing: "Drop 2", voices: 4, shape: 0.9, detune: 10, stereo: 0.7, rootLevel: 0.3 });
  p.cable(s, "pitch", o, "pitch");
  const bass = p.add("filter", [2, 0], { cutoff: 380, resonance: 0.3, type: "Ladder Tanh", drive: 0.3 }, { name: "Bass Filter" });
  const benv = p.add("adsr", [2, 1], { attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.08 }, { name: "Bass Env" });
  const bamp = p.add("vca", [3, 0], {}, { name: "Bass VCA" });
  p.cable(o, "root", bass, "l").cable(s, "gate", benv, "gate").cable(s, "trigger", benv, "retrig").cable(bass, "l", bamp, "l").cable(benv, "env", bamp, "gain");
  // stabs: the same chord, gated on the off-beats by their own sequencer
  const g = seq(p, [0, 1], [".", 0, ".", ".", ".", 0, ".", 0], { rate: "1/8", root: "F", scale: "Dorian", octave: 0, gate: 0.25, name: "Stab Rhythm" });
  const stabEnv = p.add("adsr", [0, 2], { attack: 0.004, decay: 0.18, sustain: 0.0, release: 0.12 }, { name: "Stab Env" });
  const sv = p.add("vca", [1, 2], {}, { name: "Stab VCA" });
  const sf = p.add("filter", [2, 2], { cutoff: 2600, resonance: 0.25 }, { name: "Stab Filter" });
  p.cable(g, "gate", stabEnv, "gate").cable(g, "trigger", stabEnv, "retrig").cable(stabEnv, "env", sv, "gain").stereo(o, sv).stereo(sv, sf);
  const d = beat(p, [0, 3], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: -3, pan2: -1, level3: -3, pan3: 1, level4: -4, master: 0 }, { name: "Mix" });
  p.cable(bamp, "l", mix, "in1l").cable(sf, "l", mix, "in2l").cable(sf, "r", mix, "in3r").cable(d, "outl", mix, "in4l").cable(d, "outr", mix, "in4r");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function arpFromChord() {
  const p = patch("Chord Osc: Chord Tone Arp", {
    module: "chord-osc", tempo: 104,
    description: "The four Pitch outputs carry the chord tones from low to high; a Switch steps through them every sixteenth to play an arpeggio on a separate oscillator that always follows the chord. The pad underneath plays the whole chord. Change the Chord, or the Inversion, and the arpeggio changes with it.",
    tags: ["arpeggio", "pitch outputs", "switch", "voice leading"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 4, "_", "_", "_"], { rate: "1/4", root: "E", scale: "Natural Minor", octave: -1 });
  const o = p.add("chord-osc", [1, 0], { chord: "Minor 7", voicing: "Close", voices: 4, shape: 0.2, detune: 4, stereo: 0.5, glide: 0.1 });
  p.cable(s, "pitch", o, "pitch");
  const padv = amp(p, [1, 1], s, o, { attack: 0.4, decay: 1, sustain: 0.8, release: 1.2 });
  const sw = p.add("switch", [2, 1], { fade: 0.002 }, { name: "Chord Tone" });
  ["p1", "p2", "p3", "p4"].forEach((j, i) => p.cable(o, j, sw, `in${i + 1}`));
  const clk = p.add("step-sequencer", [0, 2], { length: 1, rate: "1/16", root: "C", gatelength: 0.4 }, { data: steps([0]), name: "Arp Clock" });
  const osc = p.add("oscillator", [3, 1], { shape: 0.7, octave: "+1" }, { name: "Arp Voice" });
  const env = p.add("adsr", [3, 2], { attack: 0.003, decay: 0.15, sustain: 0.0, release: 0.1 }, { name: "Arp Env" });
  const av = p.add("vca", [4, 1], {}, { name: "Arp VCA" });
  p.cable(clk, "trigger", sw, "step").cable(sw, "out", osc, "pitch").cable(clk, "gate", env, "gate").cable(clk, "trigger", env, "retrig")
    .cable(osc, "out", av, "l").cable(env, "env", av, "gain");
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, pan1: -0.6, level2: -2, pan2: 0.6, level3: -2, pan3: 0.2, master: -8 }, { name: "Mix" });
  p.cable(padv, "l", mix, "in1l").cable(padv, "r", mix, "in2r").cable(av, "l", mix, "in3l");
  room(p, [5, 0], mix, { from: ["outl", "outr"], mix: 0.3 });
  return p;
}

function glassFifths() {
  const p = patch("Chord Osc: Quartal Glass", {
    module: "chord-osc", tempo: 72,
    description: "Five voices stacked in fourths with the Wide voicing, near-sine waves and slow Detune make a cool, open sound with no clear major or minor. A slow LFO sweeps the Inversion, so the bass note of the chord keeps changing. Switch Chord to Sus2 or Add9 for a warmer cloud.",
    tags: ["quartal", "wide", "inversion", "ambient"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/2", root: "D", scale: "Dorian", octave: -1 });
  const o = p.add("chord-osc", [1, 0], { chord: "Quartal", voicing: "Wide", voices: 5, shape: 0.12, detune: 14, stereo: 1, glide: 0.8 });
  p.cable(s, "pitch", o, "pitch");
  const sl = p.add("lfo", [1, 2], { rate: 0.06, wave: "Triangle" }, { name: "Inversion" });
  p.cable(sl, "out", o, "inversion", 0.5);
  const v = amp(p, [1, 1], s, o, { attack: 2, decay: 1, sustain: 1, release: 3 });
  const ch = p.add("chorus", [3, 1], { rate: 0.3, depth: 0.4, mix: 0.4 }, { name: "Shimmer" });
  p.stereo(v, ch);
  room(p, [4, 0], ch, { trim: -11, v: { size: 0.9, decay: 9, mix: 0.45 } });
  return p;
}

export default [seventhPad, diatonic, stabs, arpFromChord, glassFifths];
