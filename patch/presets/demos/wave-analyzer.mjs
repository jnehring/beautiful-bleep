// SPDX-License-Identifier: MIT
// Wave Analyzer (wave-analyzer): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// src (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
/// Mono jack of a node into both inputs of a stereo module.
function mono(p, from, jack, to, l = "l", r = "r") { p.cable(from, jack, to, l).cable(from, jack, to, r); }
/// Two stereo sources blended into Out.
function blend(p, at, a, b, la = -3, lb = -6, aj = ["l", "r"], bj = ["outl", "outr"]) {
  const mix = p.add("audio-mixer", at, { level1: la, level2: lb, master: -1 });
  p.stereo(a, mix, { from: aj, to: ["in1l", "in1r"] }).stereo(b, mix, { from: bj, to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function partialPicker() {
  const p = patch("Wave Analyzer: Partial Picker", {
    module: "wave-analyzer", tempo: 90,
    description: "A low saw drone has many partials; the analyzer is a very narrow band-pass that an LFO moves slowly over them, so you hear single sine-like overtones appear and fade, over the dry drone. Change Bandwidth for a wider or glassier peak, or move Frequency by hand.",
    tags: ["partials", "band-pass", "overtones", "manual", "drone"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_"], {
    rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: -2, shape: 1, gatelength: 1, env: { attack: 0.1, decay: 0.3, sustain: 1, release: 0.5 } });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Manual", frequency: 440, bandwidth: "10 Hz", gain: 12 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "Frequency" });
  p.cable(m.amp, "l", wa, "in").cable(lfo, "out", wa, "frequency", 0.55);
  const mix = p.add("audio-mixer", [4, 0], { level1: -5, level2: -4, master: 0 });
  p.cable(wa, "thru", mix, "in1l").cable(wa, "thru", mix, "in1r").cable(wa, "band", mix, "in2l").cable(wa, "band", mix, "in2r");
  finish(p, [5, 0], mix, -10, { size: 0.7, decay: 4, mix: 0.3 }, ["outl", "outr"]);
  return p;
}

function sweepSpectrum() {
  const p = patch("Wave Analyzer: Spectrum Sweep", {
    module: "wave-analyzer", tempo: 100,
    description: "Mode is Sweep: the narrow band glides from low to high and back across a bed of noise and drums, drawing out a rising and falling whistle. Change Sweep Dir, Span or Sweep Time, or widen Bandwidth for a softer tone.",
    tags: ["sweep", "spectrum", "noise", "whistle", "drums"],
  });
  const n = p.add("noise", [0, 0], { colour: 0.3, level: 0.6 });
  const d = beat(p, [0, 2], { style: "sparse", level: -6 });
  const src = p.add("audio-mixer", [3, 1], { level1: -4, level2: -2, master: 0 }, { name: "Source" });
  p.cable(n, "out", src, "in1l").stereo(d, src, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const wa = p.add("wave-analyzer", [4, 0], { mode: "Sweep", sweepdir: "Up-Down", sync: "4 bars", bandwidth: "30 Hz", span: 5, gain: 30 });
  p.cable(src, "outl", wa, "in");
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -8, master: 0 });
  p.cable(wa, "band", mix, "in1l").cable(wa, "band", mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, [6, 0], mix, -2, { size: 0.55, decay: 2.5, mix: 0.25 }, ["outl", "outr"]);
  return p;
}

function lockFollow() {
  const p = patch("Wave Analyzer: Pitch Shadow", {
    module: "wave-analyzer", tempo: 104,
    description: "In Lock mode the analyzer finds the strongest partial of a melody and its Track output drives a pure sine that shadows every note an octave up. Change Listen to move the range it hears, or Threshold to make it more or less eager to lock.",
    tags: ["lock", "track", "pitch follower", "shadow", "melody"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3, 5, 8, 12, 15, 17, 15, 12, 8], {
    rate: "1/8", root: "C", scale: "Natural Minor", octave: -1, shape: 1, gatelength: 0.8, env: { attack: 0.005, decay: 0.25, sustain: 0.6, release: 0.15 } });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Lock", listen: 700, threshold: 0.4, bandwidth: "30 Hz", gain: 12, drift: 0.1 });
  p.cable(m.amp, "l", wa, "in");
  const sh = p.add("oscillator", [4, 1], { shape: 0, octave: "+1" }, { name: "Shadow" });
  const shv = p.add("vca", [5, 1], {}, { name: "Shadow VCA" });
  p.cable(wa, "track", sh, "pitch").cable(sh, "out", shv, "l").cable(m.env, "env", shv, "gain", 0.7);
  const mix = p.add("audio-mixer", [5, 0], { level1: -4, level2: -9, master: 0 });
  p.cable(wa, "thru", mix, "in1l").cable(wa, "thru", mix, "in1r").cable(shv, "l", mix, "in2l").cable(shv, "l", mix, "in2r");
  finish(p, [6, 0], mix, -2, { size: 0.5, decay: 2.5, mix: 0.2 }, ["outl", "outr"]);
  return p;
}

function levelFollower() {
  const p = patch("Wave Analyzer: Kick Pump", {
    module: "wave-analyzer", tempo: 120,
    description: "The analyzer is tuned to the kick's low note and its Level output follows how strong that partial is; the level swells a chord pad in time with the beat. Move Frequency to follow a different drum, or Gain to make the pad react more.",
    tags: ["level", "follower", "kick", "pump", "control"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -6 });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Manual", frequency: 70, bandwidth: "30 Hz", range: "20–200 Hz", gain: 18, ballistics: "Fast" });
  p.cable(d, "outl", wa, "in");
  const m = melody(p, [0, 4], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], {
    rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 1, gatelength: 1, env: { attack: 0.02, decay: 0.3, sustain: 1, release: 0.3 } });
  const pump = p.add("vca", [4, 4], {}, { name: "Pump" });
  p.cable(m.amp, "l", pump, "l").cable(wa, "level", pump, "gain", 1);
  const bed = p.add("audio-mixer", [4, 5], { level1: -1, master: 0 }, { name: "Pad level" });
  p.cable(pump, "l", bed, "in1l").cable(pump, "l", bed, "in1r");
  blend(p, [5, 0], bed, d, 0, -4, ["outl", "outr"]);
  return p;
}

function shiftedHarmony() {
  const p = patch("Wave Analyzer: Shifted Harmony", {
    module: "wave-analyzer", tempo: 96,
    description: "A wide band-pass picks the fundamental of a plucked line and the Shifted output moves it up by the Capture amount, a seventh semitones for a fifth, so a thin sine harmony chases each note. Change Capture for other intervals, or Bandwidth to let more of the original through.",
    tags: ["shifted", "capture", "harmony", "interval", "pluck"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2, 0, 4, 7, 12, 9, 7, 4, 7], {
    rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, shape: 0.9, gatelength: 0.4, env: { decay: 0.3, sustain: 0, release: 0.2 } });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Lock", listen: 800, capture: 7, bandwidth: "1/3 octave", threshold: 0.3, gain: 14 });
  p.cable(m.amp, "l", wa, "in");
  const mix = p.add("audio-mixer", [4, 0], { level1: -4, level2: -3, pan1: -0.3, pan2: 0.4, master: 0 });
  p.cable(wa, "thru", mix, "in1l").cable(wa, "thru", mix, "in1r").cable(wa, "shifted", mix, "in2l").cable(wa, "shifted", mix, "in2r");
  finish(p, [5, 0], mix, -2, { size: 0.55, decay: 3, mix: 0.3 }, ["outl", "outr"]);
  return p;
}

export default [partialPicker, sweepSpectrum, lockFollow, levelFollower, shiftedHarmony];
