// SPDX-License-Identifier: MIT
// Oscillator: five demo patches. Each plays by itself with the transport.
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


function shapeSweep() {
  const p = patch("Oscillator: Shape Sweep", {
    module: "oscillator", tempo: 100,
    description: "A bass line on one Oscillator while a slow LFO turns Shape from triangle through saw toward square, so the same note keeps changing colour. Set Shape by hand to freeze a waveform, or move Pulse Width for a thinner square.",
    tags: ["shape", "morph", "bass", "lfo"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 7, ".", 5, 3, "."], { root: "D", octave: -1, gate: 0.6 });
  const osc = p.add("oscillator", [1, 0], { shape: 0.5, pw: 0.4 }, { name: "Bass" });
  const lfo = p.add("lfo", [1, 2], { rate: 0.12, wave: "Triangle" }, { name: "Shape LFO" });
  const v = play(p, [2, 0], osc, seq, ["out"], { env: { decay: 0.25, sustain: 0.5, release: 0.15 } });
  p.cable(lfo, "out", osc, "shape", 0.5);
  const drums = beat(p, [0, 4], { style: "half", level: -6 });
  const filt = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.25 });
  p.stereo(v.amp, filt, { from: v.out });
  withDrums(p, [4, 0], filt, ["l", "r"], drums, { l1: -2 });
  return p;
}

function syncLead() {
  const p = patch("Oscillator: Hard Sync Sweep", {
    module: "oscillator", tempo: 108,
    description: "A lead oscillator is reset by the sequencer's gate on every note, while a slow LFO pushes its Coarse tuning upward: the classic tearing sync sweep. Turn Shape toward the saw for more bite, or lower the LFO amount for a calmer tone.",
    tags: ["sync", "lead", "sweep", "retrigger"],
  });
  const seq = seqOf(p, [0, 0], [0, 0, 7, ".", 12, 10, 7, 5, 0, 0, 3, ".", 10, 7, 5, 3], { root: "E", octave: 0, gate: 0.7, rate: "1/8" });
  const osc = p.add("oscillator", [1, 0], { shape: 0.85, coarse: 0 }, { name: "Slave" });
  const lfo = p.add("lfo", [1, 2], { wave: "Saw Up", sync: "Tempo", division: "2 bars" }, { name: "Sweep" });
  const v = play(p, [2, 0], osc, seq, ["out"], { env: { decay: 0.2, sustain: 0.6, release: 0.12 } });
  p.cable(seq, "gate", osc, "sync").cable(lfo, "out", osc, "coarse", 0.5);
  const dl = p.add("delay", [3, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.35, mix: 0.25, highcut: 6000, mode: "Ping-Pong" });
  p.stereo(v.amp, dl, { from: v.out });
  const t = p.add("audio-mixer", [4, 0], { level1: 2, master: 0 }, { name: "Trim" });
  p.stereo(dl, t, { to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return p;
}

function fmBells() {
  const p = patch("Oscillator: Through-Zero Bells", {
    module: "oscillator", tempo: 76,
    description: "A second Oscillator frequency-modulates the first through its FM input, and a decaying envelope on FM Depth makes each bell strike bright and then mellow. Change the modulator's Coarse for different bell families, or raise FM Depth for glassier tones.",
    tags: ["fm", "through-zero", "bells", "pluck"],
  });
  const seq = seqOf(p, [0, 0], [0, 7, 12, 9, 4, 7, 2, 9], { root: "C", scale: "Major Pentatonic", octave: 1, rate: "1/4", gate: 0.3 });
  const mod = p.add("oscillator", [1, 1], { shape: 0, coarse: 7, octave: "+1" }, { name: "Modulator" });
  const car = p.add("oscillator", [1, 0], { shape: 0, fm: 0.2 }, { name: "Carrier" });
  const fenv = p.add("adsr", [2, 2], { attack: 0.002, decay: 0.8, sustain: 0, release: 0.5 }, { name: "FM Env" });
  const v = play(p, [2, 0], car, seq, ["out"], { env: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.8 } });
  p.cable(seq, "pitch", mod, "pitch").cable(mod, "out", car, "fm").cable(seq, "gate", fenv, "gate").cable(seq, "trigger", fenv, "retrig")
    .cable(fenv, "env", car, "fm", 0.6);
  finish(p, [3, 0], v.amp, v.out, -2, { size: 0.65, decay: 4.5, mix: 0.35 });
  return p;
}

function subBass() {
  const p = patch("Oscillator: Sub Octave Weight", {
    module: "oscillator", tempo: 94,
    description: "The main output and the Sub output (one octave down) are mixed under a drum loop, with Pulse Width moving slowly for a hollow, breathing bass. Mute the Sub channel on the mixer to hear how much weight it adds.",
    tags: ["sub", "bass", "pulse width", "drums"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 0, ".", 3, ".", 0, 5, 0, "_", ".", 0, 7, ".", 5, 3], { root: "F", octave: -1, gate: 0.75 });
  const osc = p.add("oscillator", [1, 0], { shape: 0.95, pw: 0.3 }, { name: "Bass" });
  const lfo = p.add("lfo", [1, 2], { rate: 0.18 }, { name: "Width LFO" });
  const env = p.add("adsr", [2, 1], { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.12 }, { name: "Amp Env" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  const lp = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.2 }, { name: "Low-pass" });
  const bm = p.add("audio-mixer", [3, 1], { level1: -5, level2: -3, pan1: -0.15, pan2: 0.15, master: 0 }, { name: "Main + Sub" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain")
    .cable(lfo, "out", osc, "pw", 0.5).cable(osc, "out", lp, "l").cable(lp, "l", amp, "l")
    .cable(amp, "l", bm, "in1l");
  const sub = p.add("vca", [2, 2], {}, { name: "Sub VCA" });
  p.cable(osc, "sub", sub, "l").cable(env, "env", sub, "gain").cable(sub, "l", bm, "in2l");
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  withDrums(p, [4, 0], bm, ["outl", "outr"], drums, { l1: -2, l2: -7 });
  return p;
}

function detunedPad() {
  const p = patch("Oscillator: Three-Voice Pad", {
    module: "oscillator", tempo: 70,
    description: "Three Oscillators a few cents apart play slow chord roots, one pushed a fifth up, and a reverb spreads them wide. Change Fine on any oscillator for faster beating, or Shape for a brighter or softer pad.",
    tags: ["pad", "detune", "chorus", "ambient"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { root: "A", scale: "Natural Minor", octave: -1, rate: "1/4", gate: 0.95 });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.6, fine: -9 }, { name: "Voice 1" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.45, fine: 8, octave: "+1" }, { name: "Voice 2" });
  const o3 = p.add("oscillator", [1, 2], { shape: 0.3, coarse: 7, fine: 3 }, { name: "Voice 3" });
  const env = p.add("adsr", [2, 3], { attack: 1.2, decay: 1, sustain: 0.8, release: 2 }, { name: "Pad Env" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -11, level3: -12, pan1: -0.5, pan2: 0.5, pan3: 0, master: 0 }, { name: "Voices" });
  const amp = p.add("vca", [3, 0], {}, { name: "VCA" });
  const lp = p.add("filter", [3, 1], { cutoff: 2200, resonance: 0.15 });
  p.cable(seq, "gate", env, "gate").cable(env, "env", amp, "gain");
  for (const [o, i] of [[o1, 1], [o2, 2], [o3, 3]]) p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i}l`);
  p.stereo(mix, lp, { from: ["outl", "outr"] }).stereo(lp, amp);
  finish(p, [4, 0], amp, ["l", "r"], 0, { size: 0.8, decay: 6, mix: 0.4 });
  return p;
}

export default [shapeSweep, syncLead, fmBells, subBass, detunedPad];
