// SPDX-License-Identifier: MIT
// Resonator: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

function seqOnly(p, at, notes, opts = {}) {
  return p.add("step-sequencer", at, { length: notes.length, rate: opts.rate || "1/8", root: opts.root || "A", scale: opts.scale || "Minor Pentatonic",
    octave: opts.octave ?? 0, gatelength: 0.4 }, { data: steps(notes), name: opts.name || "Strummer" });
}

// Odd/even outputs to Out 1/2 through a gain stage (dB, up to +12), one body on each side.
function toOut(p, r, db = 0) {
  const g = p.add("audio-mixer", [5, 0], { level1: Math.min(db, 6), pan1: -1, level2: Math.min(db, 6), pan2: 1, master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.cable(r, "odd", g, "in1l").cable(r, "even", g, "in2l").stereo(g, p.out, { from: ["outl", "outr"] });
}

function bellStrikes() {
  const p = patch("Resonator: Bell Strikes", {
    module: "resonator", tempo: 72,
    description: "A sequencer strums the Modal model with its own internal exciter and pitches it, so each note rings like a struck bell or bar. Move Structure to change the metal, and Damping to shorten the ring.",
    tags: ["modal", "bell", "strum", "pitched"],
  });
  const seq = seqOnly(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, 12], { rate: "1/4", root: "D", scale: "Major Pentatonic", octave: 1 });
  const r = p.add("resonator", [3, 0], { model: "Modal", polyphony: "4", structure: 0.55, brightness: 0.7, damping: 0.35, position: 0.4, exciter: 0.5, width: 1 });
  p.cable(seq, "trigger", r, "strum").cable(seq, "pitch", r, "pitch");
  toOut(p, r, 4);
  return p;
}

function sympatheticStrings() {
  const p = patch("Resonator: Sympathetic Drone", {
    module: "resonator", tempo: 84,
    description: "A plucked melody is fed into sympathetic strings tuned to a fixed root, so the drone strings glow along with whatever notes match them. Change Frequency to retune the drone, or Damping for a shorter shimmer.",
    tags: ["sympathetic", "drone", "shimmer", "input"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 4, 7, 9, 5], { rate: "1/8", shape: 0.8, root: "A", scale: "Minor Pentatonic",
    env: { decay: 0.2, sustain: 0.1, release: 0.15 } });
  const r = p.add("resonator", [3, 0], { model: "Sympathetic", polyphony: "4", frequency: -12, structure: 0.4, brightness: 0.65, damping: 0.25, inputgain: 12, dry: 0.6 });
  p.cable(m.amp, "l", r, "in");
  toOut(p, r, -3);
  return p;
}

function pluckedString() {
  const p = patch("Resonator: Plucked Strings", {
    module: "resonator", tempo: 100,
    description: "The String model plays a bouncy bass-and-treble pattern, four voices deep so older notes keep ringing under new ones. Try Position for a hollower or brighter pluck, and Brightness for nylon versus steel.",
    tags: ["string", "pluck", "polyphonic", "guitar-like"],
  });
  const seq = seqOnly(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7], { rate: "1/8", root: "E", scale: "Natural Minor", octave: 0 });
  const r = p.add("resonator", [3, 0], { model: "String", polyphony: "4", structure: 0.3, brightness: 0.55, damping: 0.5, position: 0.25, exciter: 0.4, width: 0.8 });
  p.cable(seq, "trigger", r, "strum").cable(seq, "pitch", r, "pitch");
  toOut(p, r, 2);
  return p;
}

function drumBody() {
  const p = patch("Resonator: Drum Body", {
    module: "resonator", tempo: 98,
    description: "A drum beat excites a Modal resonator that is tuned low, so every kick and hat rings the same plate-like body. Turn Dry up to bring the raw drums back, or sweep Frequency to retune the whole kit.",
    tags: ["drums", "modal", "plate", "texture"],
  });
  const mix = beat(p, [0, 0], { style: "half", level: -10 });
  const r = p.add("resonator", [3, 0], { model: "Modal", strumsource: "Input onsets", polyphony: "2", frequency: -7, structure: 0.7, brightness: 0.5, damping: 0.5, inputgain: 0, dry: 0.4 });
  p.cable(mix, "outl", r, "in");
  toOut(p, r, -3);
  return p;
}

function driftingStructure() {
  const p = patch("Resonator: Morphing Plate", {
    module: "resonator", tempo: 80,
    description: "A slow LFO sweeps Structure through string, bar and plate territory while the same strummed notes play, so the instrument seems to change material as it rings. Patch the LFO into Brightness too, or change its speed.",
    tags: ["modulation", "morph", "structure", "evolving"],
  });
  const seq = seqOnly(p, [0, 0], [0, 4, 7, 11, 9, 7, 4, 2], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 1 });
  const r = p.add("resonator", [3, 0], { model: "Modal", polyphony: "4", structure: 0.5, brightness: 0.6, damping: 0.4, position: 0.3, exciter: 0.6 });
  const l = p.add("lfo", [2, 1], { rate: 0.07, wave: "Triangle" }, { name: "Structure LFO" });
  p.cable(seq, "trigger", r, "strum").cable(seq, "pitch", r, "pitch").cable(l, "out", r, "structure", 0.45);
  toOut(p, r, -4);
  return p;
}

export default [bellStrikes, sympatheticStrings, pluckedString, drumBody, driftingStructure];
