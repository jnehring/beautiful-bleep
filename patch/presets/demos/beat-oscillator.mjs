// SPDX-License-Identifier: MIT
// Beat Oscillator: five demo patches. Each plays by itself with the transport.
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


function heterodyneDrone() {
  const p = patch("Beat Oscillator: Heterodyne Drone", {
    module: "beat-oscillator", tempo: 60,
    description: "Two high carriers beat against each other and a slow LFO sweeps Beat, so a pure tone glides down into a throbbing pulse and back. Turn Drift up for a wandering, unstable tone or move Beat by hand for a held pitch.",
    tags: ["drone", "heterodyne", "sweep", "ambient"],
  });
  const osc = p.add("beat-oscillator", [0, 0], { carrier: 9000, beat: 0.35, drift: 0.3, range: "±2 kHz" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.06, wave: "Triangle" }, { name: "Beat Sweep" });
  const amp = p.add("vca", [1, 0], { gain: 1 }, { name: "VCA" });
  p.cable(lfo, "out", osc, "beat", 0.25).cable(osc, "out", amp, "l").cable(osc, "out", amp, "r");
  finish(p, [2, 0], amp, ["l", "r"], -12, { size: 0.8, decay: 6, mix: 0.4 });
  return p;
}

function playedTones() {
  const p = patch("Beat Oscillator: Played Melody", {
    module: "beat-oscillator", tempo: 100,
    description: "The sequencer's pitch is fed to the Pitch input so the heterodyne tone plays a tune, with a gentle envelope for each note. Change Carrier to shift the character, or raise Fine to detune the whole line.",
    tags: ["melody", "pitch", "heterodyne", "lead"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 3, 10, 7, 3, 0, 5, 7, 12, 10, 7, 5, 3, 7], { root: "A", rate: "1/8", gate: 0.55 });
  const osc = p.add("beat-oscillator", [1, 0], { carrier: 8000, beat: 0.3, drift: 0.05 });
  const v = play(p, [2, 0], osc, seq, ["out"], { env: { decay: 0.3, sustain: 0.4, release: 0.25 } });
  finish(p, [3, 0], v.amp, v.out, -4, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

function lockStutter() {
  const p = patch("Beat Oscillator: Pull and Stutter", {
    module: "beat-oscillator", tempo: 90,
    description: "A slow LFO raises Pull so the two carriers try to lock: the tone stutters, drops into pulses and jumps into pitch as they catch each other. Move Pull and Detector by hand to hear the stutter appear and disappear.",
    tags: ["lock", "pull", "stutter", "heterodyne"],
  });
  const osc = p.add("beat-oscillator", [0, 0], { carrier: 7000, beat: 0.2, pull: 0.5, detector: 0.4, drift: 0.2 });
  const lfo = p.add("lfo", [0, 2], { rate: 0.1, wave: "Triangle", polarity: "Unipolar" }, { name: "Pull" });
  const bl = p.add("lfo", [0, 3], { rate: 0.05 }, { name: "Beat" });
  const amp = p.add("vca", [1, 0], { gain: 1 }, { name: "VCA" });
  p.cable(lfo, "out", osc, "pull", 0.5).cable(bl, "out", osc, "beat", 0.15).cable(osc, "out", amp, "l").cable(osc, "out", amp, "r");
  const dl = p.add("delay", [2, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.4, mix: 0.3, mode: "Ping-Pong" });
  p.stereo(amp, dl);
  finish(p, [3, 0], dl, ["l", "r"], -10, { size: 0.6, decay: 3, mix: 0.25 });
  return p;
}

function slowPulses() {
  const p = patch("Beat Oscillator: Slow Pulse Bass", {
    module: "beat-oscillator", tempo: 108,
    description: "A low heterodyne bass under a drum loop: each sequencer note retunes the pair through Pitch and an envelope shapes it, with the Diode mixer adding grit. Try the Range setting at ±20 Hz or ±2 kHz and move Beat to change how deep it sits.",
    tags: ["bass", "range", "detune", "low frequency"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 3, ".", 0, 5, ".", 0, ".", 7, ".", 3, 5, 0, "."], { root: "E", rate: "1/8", gate: 0.6, octave: 0 });
  const osc = p.add("beat-oscillator", [1, 0], { carrier: 6000, beat: 0.3, range: "±200 Hz", mixer: "Diode", drift: 0.05 });
  const v = play(p, [2, 0], osc, seq, ["out"], { pitch: "pitch", env: { decay: 0.2, sustain: 0.6, release: 0.12 } });
  const drums = beat(p, [0, 4], { style: "half", level: -7 });
  withDrums(p, [3, 0], v.amp, v.out, drums, { l1: -3, l2: -6 });
  return p;
}

function overdrivenMixer() {
  const p = patch("Beat Oscillator: Overdriven Mixer", {
    module: "beat-oscillator", tempo: 78,
    description: "The Mixer setting on Overdriven adds harmonics and sidebands to the beat tone, and Drift keeps it alive and slightly unstable. Compare Ideal, Diode and Overdriven to hear the same beat with three characters.",
    tags: ["overdrive", "character", "drift", "mixer"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", 7, "_", "_", 5, "_", 3, "_", "_", 0, "_", "_", "_", "."], { root: "D", scale: "Natural Minor", rate: "1/8", gate: 0.9 });
  const osc = p.add("beat-oscillator", [1, 0], { carrier: 10000, beat: 0.4, mixer: "Overdriven", drift: 0.4, coupling: "DC" });
  const v = play(p, [2, 0], osc, seq, ["out"], { env: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.5 } });
  const lp = p.add("filter", [3, 0], { cutoff: 2800, resonance: 0.2 });
  p.stereo(v.amp, lp, { from: v.out });
  finish(p, [4, 0], lp, ["l", "r"], -8, { size: 0.65, decay: 4, mix: 0.3 });
  return p;
}

export default [heterodyneDrone, playedTones, lockStutter, slowPulses, overdrivenMixer];
