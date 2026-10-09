// SPDX-License-Identifier: MIT
// Chord Osc: five demo patches. Each plays by itself with the transport.
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


function softPads() {
  const p = patch("Chord Osc: Soft Minor Pads", {
    module: "chord-osc", tempo: 68,
    description: "A slow bass line plays the root and Chord Osc stacks a Minor 7 on it, spread with the Open voicing, a little Detune and Stereo, and Glide so each chord melts into the next. Try other Chord types, or Inversion for different voice leading.",
    tags: ["pad", "minor 7", "voicing", "glide"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "A", octave: -1, scale: "Natural Minor" });
  const o = p.add("chord-osc", [1, 0], { chord: "Minor 7", voicing: "Open", voices: 4, shape: 0.55, detune: 9, stereo: 0.8, glide: 0.35 });
  const v = amp(p, [1, 1], s, o, { attack: 1.2, decay: 1, sustain: 0.9, release: 2.5 }, ["l", "r"]);
  const lfo = p.add("lfo", [0, 1], { rate: 0.05 }, { name: "Slow Shape" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "shape", 0.3);
  room(p, [3, 0], v, { trim: -6, mix: 0.4, v: { decay: 5 } });
  return p;
}

function diatonicRun() {
  const p = patch("Chord Osc: Diatonic Run", {
    module: "chord-osc", tempo: 96,
    description: "In Scale mode a plain melody becomes a chord progression: each note of the tune turns into the diatonic triad on that scale degree, changing exactly on the step through Latch. Change Root or Scale and the whole harmony follows.",
    tags: ["scale", "progression", "latch", "harmony"],
  });
  const s = seq(p, [0, 0], [0, "_", 2, "_", 4, "_", 3, "_", 5, "_", 4, "_", 1, "_", 0, "_"], { rate: "1/4", root: "G", octave: 0, scale: "Major", gate: 0.9 });
  const o = p.add("chord-osc", [1, 0], { mode: "Scale", key: "G", scale: "Major", stack: "Seventh", shape: 0.4, detune: 6, stereo: 0.7, glide: 0.08 });
  const v = amp(p, [1, 1], s, o, { attack: 0.02, decay: 0.8, sustain: 0.5, release: 0.9 }, ["l", "r"]);
  p.cable(s, "pitch", o, "pitch").cable(s, "trigger", o, "latch");
  room(p, [3, 0], v, { trim: -2, mix: 0.3, v: { decay: 2.6 } });
  return p;
}

function chordArp() {
  const p = patch("Chord Osc: Chord Arpeggio", {
    module: "chord-osc", tempo: 110,
    description: "The four Pitch outputs carry the chord's tones; a Switch steps through them on every sixteenth and plays an oscillator, so the arpeggio follows whatever chord Chord Osc is holding, while the full chord hums underneath. Change Chord or Voicing to re-voice the arpeggio.",
    tags: ["arpeggio", "pitch outputs", "switch", "chord"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", root: "D", octave: -1, scale: "Natural Minor", gate: 1 });
  const o = p.add("chord-osc", [1, 0], { chord: "Minor 9", voicing: "Drop 2", voices: 4, shape: 0.3, detune: 5, stereo: 0.9, glide: 0 });
  const sw = p.add("switch", [2, 1], { length: 4, rate: "1/16", fade: 0.002 });
  const ao = p.add("oscillator", [3, 1], { shape: 0.75, octave: "+1" }, { name: "Arp Voice" });
  const env = p.add("adsr", [3, 2], { attack: 0.002, decay: 0.16, sustain: 0, release: 0.1 }, { name: "Pluck" });
  const av = p.add("vca", [4, 1], {}, { name: "Arp VCA" });
  const clk = p.add("random", [2, 2], { rate: 4, sync: "1/16", spread: 0 }, { name: "16th Clock" });
  p.cable(s, "pitch", o, "pitch");
  [1, 2, 3, 4].forEach((i) => p.cable(o, "p" + i, sw, "in" + i));
  p.cable(sw, "out", ao, "pitch").cable(clk, "trig", env, "retrig").cable(clk, "trig", env, "gate").cable(ao, "out", av, "l").cable(env, "env", av, "gain");
  const mix = p.add("audio-mixer", [5, 0], { level1: -16, pan1: -1, level2: -16, pan2: 1, level3: -8, pan3: 0.1, master: 0 }, { name: "Mix" });
  p.cable(o, "l", mix, "in1l").cable(o, "r", mix, "in2r").cable(av, "l", mix, "in3l");
  room(p, [6, 0], mix, { from: ["outl", "outr"], mix: 0.28, v: { decay: 2.2 } });
  return p;
}

function offbeatStabs() {
  const p = patch("Chord Osc: Offbeat Stabs", {
    module: "chord-osc", tempo: 122,
    description: "Short dominant-ninth stabs on the off-beats, voiced Drop 2 with a squarer Shape and a snappy envelope, over a four-on-the-floor beat. Try Dominant 7, Quartal or a higher Inversion for a different punch.",
    tags: ["stabs", "dance", "dominant", "rhythm"],
  });
  const s = seq(p, [0, 0], [".", ".", 0, ".", ".", ".", 0, ".", ".", ".", 5, ".", ".", ".", 3, 7], { rate: "1/8", root: "C", octave: 0, scale: "Minor Pentatonic", gate: 0.35, vel: [100] });
  const o = p.add("chord-osc", [1, 0], { chord: "Dominant 9", voicing: "Drop 2", voices: 5, shape: 0.85, detune: 12, stereo: 0.7, inversion: 1 });
  const v = amp(p, [1, 1], s, o, { attack: 0.003, decay: 0.2, sustain: 0.05, release: 0.12 }, ["l", "r"]);
  const lp = p.add("filter", [3, 1], { cutoff: 1500, resonance: 0.25 }, { name: "Stab Filter" });
  const lfo = p.add("lfo", [3, 2], { rate: 0.12, wave: "Triangle" }, { name: "Open" });
  p.cable(s, "pitch", o, "pitch").stereo(v, lp).cable(lfo, "out", lp, "cutoff", 0.4);
  const drums = beat(p, [0, 3], { style: "four", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 1, pan1: -1, level2: 1, pan2: 1, level3: 0, level4: 0, master: 0 }, { name: "Main" });
  p.cable(lp, "l", mix, "in1l").cable(lp, "r", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [5, 0], mix, { from: ["outl", "outr"], mix: 0.15, v: { decay: 1.4 } });
  return p;
}

function fmChoir() {
  const p = patch("Chord Osc: FM Quartal Glow", {
    module: "chord-osc", tempo: 78,
    description: "Pure sine voices stacked in fourths, with a low oscillator in the FM input and FM Depth moved by a slow LFO: the chord shimmers between smooth and metallic. Turn Detune and Stereo up for a wider glow.",
    tags: ["fm", "quartal", "evolving", "sine"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 2, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "E", octave: -1, scale: "Minor Pentatonic", gate: 1 });
  const o = p.add("chord-osc", [1, 0], { chord: "Quartal", shape: 0, voices: 4, detune: 14, stereo: 1, glide: 0.4, fm: 0.25 });
  const mod = p.add("oscillator", [0, 1], { shape: 0, octave: "-2", coarse: 7 }, { name: "FM Source" });
  const v = amp(p, [1, 1], s, o, { attack: 1.5, decay: 1, sustain: 0.9, release: 3 }, ["l", "r"]);
  const lfo = p.add("lfo", [0, 2], { rate: 0.07, polarity: "Unipolar" }, { name: "Metal Amount" });
  const gate = p.add("vca", [1, 2], {}, { name: "FM Amount" });
  p.cable(s, "pitch", o, "pitch").cable(s, "pitch", mod, "pitch").cable(mod, "out", gate, "l").cable(lfo, "out", gate, "gain", 0.5).cable(gate, "l", o, "fm");
  room(p, [3, 0], v, { trim: -12, mix: 0.4, v: { decay: 5.5 } });
  return p;
}

export default [softPads, diatonicRun, chordArp, offbeatStabs, fmChoir];
