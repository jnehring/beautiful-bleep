// SPDX-License-Identifier: MIT
// Additive Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";

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

function glassPad() {
  const p = patch("Additive Osc: Glass Pad", {
    module: "additive-osc", tempo: 72,
    description: "A saw-based spectrum with a gentle Tilt, a touch of Stretch and a slow Chorus makes a wide, glassy pad. Try pulling Tilt down for a duller tone, or raising Chorus and Width.",
    tags: ["pad", "chorus", "tilt", "ambient"],
  });
  const s = seq(p, [0, 0], [0, ".", "_", "_", 7, "_", "_", "_", 4, "_", "_", "_", 9, "_", "_", "_"], { rate: "1/4", root: "D", octave: -1 });
  const o = p.add("additive-osc", [1, 0], { partials: 40, tilt: -4, stretch: 0.04, chorus: 18, chorusRate: 0.25, width: 0.9, base: "Saw" });
  const v = amp(p, [1, 1], s, o, { attack: 0.8, decay: 1, sustain: 0.8, release: 2 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.06 }, { name: "Slow Tilt" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "tilt", 0.4);
  room(p, [3, 0], v, { mix: 0.4, v: { decay: 5 } });
  return p;
}

function hollowReed() {
  const p = patch("Additive Osc: Hollow Reed", {
    module: "additive-osc", tempo: 100,
    description: "A square spectrum with Odd/Even pushed to the odd side gives a hollow, woody reed. A slow LFO sweeps Odd/Even toward the even partials so the tone keeps turning from hollow to bright.",
    tags: ["reed", "odd even", "melody", "woody"],
  });
  const s = seq(p, [0, 0], [0, 3, 5, 7, 5, 3, 7, 10, 12, 10, 7, 5, 3, 0, 5, "."], { rate: "1/8", root: "E", octave: 0, gate: 0.7 });
  const o = p.add("additive-osc", [1, 0], { base: "Square", partials: 48, oddEven: -0.8, tilt: -2, width: 0.3, damp: 0.5 });
  const v = amp(p, [1, 1], s, o, { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.2 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.11, wave: "Triangle" }, { name: "Odd Even Sweep" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "oddEven", 0.8);
  room(p, [3, 0], v, { mix: 0.2, v: { decay: 1.6 } });
  return p;
}

function inharmonicBells() {
  const p = patch("Additive Osc: Inharmonic Bells", {
    module: "additive-osc", tempo: 84,
    description: "Stretch spreads the partials out of tune with each other and Decay lets each one ring and die on a trigger, so every note strikes like a struck bell. Change Stretch toward negative values for a softer, gong-like cluster.",
    tags: ["bell", "stretch", "inharmonic", "decay"],
  });
  const s = seq(p, [0, 0], [0, ".", 7, ".", 3, ".", 10, 7, ".", 12, ".", 5, ".", ".", 3, "."], { rate: "1/8", root: "C", octave: 1, scale: "Natural Minor" });
  const o = p.add("additive-osc", [1, 0], { base: "Flat", partials: 24, stretch: 0.45, tilt: -3, decay: 2.2, damp: 0.7, width: 0.6, phases: "Aligned" });
  const v = amp(p, [1, 1], s, o, { attack: 0.002, decay: 2.5, sustain: 0, release: 1.5 });
  p.cable(s, "pitch", o, "pitch").cable(s, "trigger", o, "trigger");
  room(p, [3, 0], v, { mix: 0.45, v: { decay: 4.5, size: 0.7 } });
  return p;
}

function combDrone() {
  const p = patch("Additive Osc: Comb Drone", {
    module: "additive-osc", tempo: 66,
    description: "A low saw drone whose partials are notched by a Comb: a slow LFO on Comb Phase moves the notches up the spectrum, so the drone sweeps like a phaser made purely of harmonics. Try Comb Spacing for different notch patterns.",
    tags: ["drone", "comb", "sweep", "bass"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", root: "A", octave: -2 });
  const o = p.add("additive-osc", [1, 0], { base: "Saw", partials: 64, tilt: -1, comb: 0.9, combSpacing: 5, chorus: 8, width: 0.6 });
  const v = amp(p, [1, 1], s, o, { attack: 1.5, decay: 1, sustain: 1, release: 2 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.09 }, { name: "Comb Sweep" });
  const lfo2 = p.add("lfo", [0, 2], { rate: 0.03, wave: "Triangle" }, { name: "Spacing" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "combPhase", 0.5).cable(lfo2, "out", o, "comb", 0.1);
  room(p, [3, 0], v, { mix: 0.25, trim: -10, v: { decay: 3 } });
  return p;
}

function spectralPulse() {
  const p = patch("Additive Osc: Spectral Pulse", {
    module: "additive-osc", tempo: 112,
    description: "A short rhythmic pluck whose Partials count and Tilt are pushed around by a random generator, so every note is a different slice of the spectrum, from a pure sine to a rich buzz. Lower Damp for brighter plucks.",
    tags: ["pluck", "rhythm", "random", "partials"],
  });
  const s = seq(p, [0, 0], [0, 0, 7, ".", 0, 12, ".", 7, 3, ".", 5, 5, 10, ".", 7, "."], { rate: "1/16", root: "F", octave: 0, gate: 0.3, scale: "Dorian" });
  const o = p.add("additive-osc", [1, 0], { base: "Saw", partials: 20, tilt: -6, width: 0.5, shift: 0.0 });
  const v = amp(p, [1, 1], s, o, { attack: 0.002, decay: 0.2, sustain: 0, release: 0.15 });
  const r = p.add("random", [0, 1], { rate: 4, spread: 1, sync: "1/16", seed: 7, smooth: 0.2 }, { name: "Spectrum Dice" });
  const r2 = p.add("random", [0, 2], { rate: 4, sync: "1/8", seed: 3 }, { name: "Shift Dice" });
  p.cable(s, "pitch", o, "pitch").cable(r, "out", o, "partials", 0.6).cable(r, "out", o, "tilt", 0.5).cable(r2, "out", o, "shift", 0.15);
  const mix = p.add("audio-mixer", [3, 0], { level1: 2, master: 3 });
  p.stereo(v, mix, { to: ["in1l", "in1r"] });
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.2, v: { decay: 1.8 } });
  return p;
}

export default [glassPad, hollowReed, inharmonicBells, combDrone, spectralPulse];
