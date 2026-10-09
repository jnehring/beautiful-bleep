// SPDX-License-Identifier: MIT
// Resonator: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

function strikeBells() {
  const p = patch("Resonator: Struck Bells", {
    module: "resonator", tempo: 84,
    description: "The Modal model rings like a bell or plate each time a sequencer strums it, tuned by the Pitch input. Structure moves from string to bar to bell, Damping decides how long they ring, and Position changes which overtones are struck.",
    tags: ["bell", "modal", "strum", "melody"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: 1, gatelength: 0.3 },
    { data: steps([0, ".", 7, ".", 5, 3, ".", 10]) });
  const r = p.add("resonator", [2, 0], { frequency: 0, structure: 0.6, brightness: 0.7, damping: 0.35, position: 0.35, exciter: 0.6,
    width: 1, model: "Modal", polyphony: "4", modes: "32" });
  const lfo = p.add("lfo", [1, 1], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "Structure Drift" });
  const m = p.add("audio-mixer", [3, 0], { level1: -4, pan1: -0.6, level2: -4, pan2: 0.6 }, { name: "Output" });
  p.cable(seq, "pitch", r, "pitch").cable(seq, "trigger", r, "strum").cable(lfo, "out", r, "structure", 0.3)
    .cable(r, "odd", m, "in1l").cable(r, "even", m, "in2l").stereo(m, p.out, { from: ["outl", "outr"] });
  return p;
}

function pluckedStrings() {
  const p = patch("Resonator: Plucked Strings", {
    module: "resonator", tempo: 100,
    description: "The String model with four voices turns a running arpeggio into a harp: each trigger plucks a string that rings over the next. Brightness and Damping change the string, Position moves the pluck point toward the bridge.",
    tags: ["string", "pluck", "arpeggio", "polyphonic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", root: "G", scale: "Major Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, 4, 7, 12, 7, 4, 9, 4, 0, 7, 12, 14, 12, 7, 4, 7]) });
  const r = p.add("resonator", [2, 0], { structure: 0.2, brightness: 0.55, damping: 0.5, position: 0.25, exciter: 0.4, width: 0.8,
    model: "String", polyphony: "4" });
  p.cable(seq, "pitch", r, "pitch").cable(seq, "trigger", r, "strum");
  const m = p.add("audio-mixer", [3, 0], { level1: -1, pan1: -0.5, level2: -1, pan2: 0.5 }, { name: "Output" });
  p.cable(r, "odd", m, "in1l").cable(r, "even", m, "in2l").stereo(m, p.out, { from: ["outl", "outr"] });
  return p;
}

function sympatheticDrone() {
  const p = patch("Resonator: Sympathetic Drone", {
    module: "resonator", tempo: 72,
    description: "A soft saw melody is fed into the Sympathetic model, whose strings ring along with whatever matches them: the tune turns into a shimmering sitar-like cloud. Try Frequency (in semitones) to retune the strings against the melody.",
    tags: ["sympathetic", "drone", "audio input", "shimmer"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 4, 7, 9, 7], { rate: "1/8", shape: 0.8, root: "D", scale: "Dorian", octave: -1,
    env: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.3 } });
  const r = p.add("resonator", [3, 0], { frequency: -12, structure: 0.4, brightness: 0.6, damping: 0.2, position: 0.4, inputgain: 0, exciter: 0.5,
    width: 1, dry: 0.25, model: "Sympathetic", polyphony: "2" });
  p.cable(m.amp, "l", r, "in").cable(m.seq, "pitch", r, "pitch");
  const o = p.add("audio-mixer", [4, 0], { level1: 5, pan1: -0.6, level2: 5, pan2: 0.6 }, { name: "Output" });
  p.cable(r, "odd", o, "in1l").cable(r, "even", o, "in2l").stereo(o, p.out, { from: ["outl", "outr"] });
  return p;
}

function drumBody() {
  const p = patch("Resonator: Drum Body", {
    module: "resonator", tempo: 108,
    description: "A drum beat is the exciter: Strum Source is set to Input onsets, so every kick, snare and hat hit makes the tuned body ring a note of a slow, random-walking bass line. Turn Dry up for the plain kit, or Structure for a different resonant body.",
    tags: ["drums", "input onsets", "tuned", "percussion"],
  });
  const mix = beat(p, [0, 0], { style: "shuffle", level: -4 });
  const rnd = p.add("random", [3, 1], { sync: "1/4", spread: 0.5, seed: 4, quantize: true }, { name: "Notes" });
  const r = p.add("resonator", [3, 0], { frequency: -12, structure: 0.3, brightness: 0.5, damping: 0.55, position: 0.3, inputgain: 0, exciter: 0.7,
    width: 1, dry: 0.4, model: "Modal", polyphony: "1", strumsource: "Input onsets" });
  p.cable(mix, "outl", r, "in").cable(rnd, "out", r, "frequency", 0.3);
  const o = p.add("audio-mixer", [4, 0], { level1: -8, pan1: -0.3, level2: -8, pan2: 0.3 }, { name: "Output" });
  p.cable(r, "odd", o, "in1l").cable(r, "even", o, "in2l").stereo(o, p.out, { from: ["outl", "outr"] });
  return p;
}

function noisePlate() {
  const p = patch("Resonator: Noise Plate", {
    module: "resonator", tempo: 66,
    description: "Rhythmic bursts of filtered noise strike a plate whose Structure and Brightness drift on slow LFOs, so the metallic timbre keeps changing from rubbed glass to gong. Change the strum rate, Damping or Position to retune the surface.",
    tags: ["plate", "noise", "evolving", "metal"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "C", scale: "Whole Tone", octave: -1, gatelength: 0.2 },
    { data: steps([0, ".", 4, ".", 2, ".", 6, "."]) });
  const n = p.add("noise", [0, 1], { level: 1, colour: 0.2 });
  const env = p.add("adsr", [1, 1], { attack: 0.002, decay: 0.12, sustain: 0, release: 0.1 }, { name: "Burst" });
  const amp = p.add("vca", [1, 0], {}, { name: "VCA" });
  p.cable(seq, "gate", env, "gate").cable(n, "out", amp, "l").cable(env, "env", amp, "gain");
  const r = p.add("resonator", [2, 0], { frequency: 0, structure: 0.8, brightness: 0.6, damping: 0.25, position: 0.5, inputgain: 20, exciter: 0.5,
    width: 1, dry: 0.1, model: "Modal", polyphony: "2", modes: "64" });
  const l1 = p.add("lfo", [2, 1], { rate: 0.06 }, { name: "Structure LFO" });
  const l2 = p.add("lfo", [3, 1], { rate: 0.09, wave: "Triangle" }, { name: "Brightness LFO" });
  p.cable(amp, "l", r, "in").cable(seq, "pitch", r, "pitch").cable(l1, "out", r, "structure", 0.3).cable(l2, "out", r, "brightness", 0.3);
  const o = p.add("audio-mixer", [4, 0], { level1: 0, pan1: -0.7, level2: 0, pan2: 0.7 }, { name: "Output" });
  p.cable(r, "odd", o, "in1l").cable(r, "even", o, "in2l").stereo(o, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [strikeBells, pluckedStrings, sympatheticDrone, drumBody, noisePlate];
