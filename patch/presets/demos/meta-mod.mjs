// SPDX-License-Identifier: MIT
// Meta Mod: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mixer: channel i takes `srcs[i]` = [node, jack, rightJack?]; reverb on the send; out to Out 1/2.
function finish(p, at, srcs, o = {}) {
  const [c, r] = at;
  const v = { master: o.master ?? -3, return: o.ret ?? -6 };
  srcs.forEach((s, i) => { v[`level${i + 1}`] = (o.levels || [])[i] ?? -9; v[`pan${i + 1}`] = (o.pans || [])[i] ?? 0; v[`send${i + 1}`] = (o.sends || [])[i] ?? -12; });
  const mix = p.add("audio-mixer", [c, r], v, { name: "Mix" });
  srcs.forEach(([n, j, j2], i) => p.cable(n, j, mix, `in${i + 1}l`).cable(n, j2 || j, mix, `in${i + 1}r`));
  const verb = p.add("reverb", [c + 1, r], { size: 0.6, decay: o.decay ?? 3.5, damping: 0.5, mix: 1, quality: "Eco (8 lines)" }, { name: "Room" });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").cable(verb, "l", mix, "returnl").cable(verb, "r", mix, "returnr");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function ringBells() {
  const p = patch("Meta Mod: Ring Bells", {
    module: "meta-mod", tempo: 84,
    description: "A plain sine melody is the carrier; with nothing patched into Modulator the internal oscillator ring-modulates it, and a slow LFO sweeps Osc Tune so the plucks turn into shifting, inharmonic bells. Try Timbre towards 100 % to let the carrier bleed through, or change Osc Octave.",
    tags: ["ring mod", "bells", "inharmonic", "sweep"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 5], { rate: "1/4", root: "C", scale: "Major Pentatonic", octave: 0, shape: 0, env: { decay: 0.7, sustain: 0.1, release: 0.5 } });
  const mm = p.add("meta-mod", [3, 0], { algorithm: 2, timbre: 0.25, oscTune: 7, oscShape: 0, mix: 1, carrierLevel: 1.2, oscOctave: "-1" });
  const sweep = p.add("lfo", [3, 1], { rate: 0.05, wave: "Triangle" }, { name: "Tune Sweep" });
  p.cable(m.amp, "l", mm, "carrierL").cable(sweep, "out", mm, "oscTune", 0.7);
  finish(p, [5, 0], [[mm, "l", "r"]], { levels: [-3], sends: [-4], decay: 4, master: -4 });
  return p;
}

function robotChoir() {
  const p = patch("Meta Mod: Robot Choir", {
    module: "meta-mod", tempo: 104,
    description: "The vocoder algorithm lets a drum beat talk through a sustained buzzy chord: every kick, snare and hat from the Modulator carves its rhythm and spectrum into the Carrier. Move Timbre to shift the formants, or change Algorithm to hear the same signals ring-modulated.",
    tags: ["vocoder", "drums", "robot", "formant"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "G", scale: "Minor Pentatonic", octave: -1 },
    { data: steps([0, 3, 7, 5, 0, 3, 10, 7]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 1 }, { name: "Saw A" });
  const o2 = p.add("oscillator", [1, 1], { shape: 1, coarse: 7, fine: 8 }, { name: "Saw B" });
  const nz = p.add("noise", [1, 2], { colour: 0.3, level: 0.3 });
  const cm = p.add("audio-mixer", [2, 0], { level1: -6, level2: -9, level3: -14, master: 0 }, { name: "Carrier Mix" });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch");
  p.cable(o1, "out", cm, "in1l").cable(o2, "out", cm, "in2l").cable(nz, "out", cm, "in3l");
  const drums = beat(p, [0, 4], { style: "broken", level: 0 });
  const mm = p.add("meta-mod", [3, 0], { algorithm: 6, timbre: 0.5, carrierLevel: 1.2, modLevel: 1.5, mix: 1 });
  p.cable(cm, "outl", mm, "carrierL").cable(drums, "outl", mm, "modulator");
  const lfo = p.add("lfo", [3, 1], { rate: 0.1, wave: "Sine" }, { name: "Formant Drift" });
  p.cable(lfo, "out", mm, "timbre", 0.25);
  finish(p, [5, 0], [[mm, "l", "r"], [drums, "outl", "outr"]], { levels: [-8, -16], sends: [-8, -20], decay: 2, master: 0 });
  return p;
}

function harmonicArp() {
  const p = patch("Meta Mod: Harmonic Arpeggio", {
    module: "meta-mod", tempo: 100,
    description: "Algorithm 7 (Chebyshev) turns a pure sine into its Nth harmonic, and a stepped Random picks N for every sixteenth: the same note blurs through brighter and brighter overtones like an arpeggio inside each pitch. Turn Timbre by hand to hear single harmonics, or raise Carrier Level for a hotter sound.",
    tags: ["chebyshev", "harmonics", "arpeggio", "sine"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 5, ".", 3, "."], { rate: "1/4", root: "E", scale: "Minor Pentatonic", octave: -1, shape: 0, gatelength: 0.9, env: { decay: 0.5, sustain: 0.6 } });
  const mm = p.add("meta-mod", [3, 0], { algorithm: 7, timbre: 0.3, carrierLevel: 0.9, mix: 1 });
  const rnd = p.add("random", [3, 1], { rate: 4, spread: 0.55, bias: -0.35, sync: "1/16", seed: 12, length: "8 steps", loop: 0.9 }, { name: "Order" });
  const flt = p.add("filter", [4, 0], { cutoff: 5000, resonance: 0.1 }, { name: "Tame" });
  p.cable(m.amp, "l", mm, "carrierL").cable(rnd, "out", mm, "timbre", 0.5);
  p.cable(mm, "l", flt, "l").cable(mm, "r", flt, "r");
  finish(p, [5, 0], [[flt, "l", "r"]], { levels: [-14], sends: [-8], decay: 2.5, master: 0 });
  return p;
}

function foldBass() {
  const p = patch("Meta Mod: Ring Bass", {
    module: "meta-mod", tempo: 118,
    description: "A bass voice made entirely inside Meta Mod: a sequencer plays its internal oscillator while a second oscillator a fifth up goes into Modulator, and a slow LFO glides Algorithm between ring, crossfade and fold. Listen for the growl when the algorithm passes the ring-mod area, then change Timbre.",
    tags: ["bass", "ring mod", "fold", "growl"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "F", scale: "Natural Minor", octave: -2, gatelength: 0.6 },
    { data: steps([0, 0, ".", 0, 3, ".", 0, 5, 0, 0, ".", 7, 5, ".", 3, 0]) });
  const env = p.add("adsr", [1, 1], { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.1 }, { name: "Amp Env" });
  const mod = p.add("oscillator", [1, 0], { coarse: 7, shape: 0.6, octave: "+1" }, { name: "Modulator Osc" });
  const mm = p.add("meta-mod", [2, 0], { algorithm: 2, timbre: 0.45, oscShape: 0.75, carrierLevel: 1, modLevel: 1, oscOctave: "-2", mix: 1, quality: "High (4×)" });
  const sweep = p.add("lfo", [2, 1], { rate: 0.12, wave: "Triangle" }, { name: "Algorithm Sweep" });
  const vca = p.add("vca", [3, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [4, 0], { cutoff: 1500, resonance: 0.2, drive: 0.2 }, { name: "Cut" });
  p.cable(seq, "pitch", mod, "pitch").cable(seq, "pitch", mm, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig");
  p.cable(mod, "out", mm, "modulator").cable(sweep, "out", mm, "algorithm", 0.3);
  p.cable(mm, "l", flt, "l").cable(mm, "r", flt, "r").cable(flt, "l", vca, "l").cable(flt, "r", vca, "r").cable(env, "env", vca, "gain");
  const drums = beat(p, [0, 4], { style: "four", level: -10 });
  finish(p, [5, 0], [[vca, "l", "r"], [drums, "outl", "outr"]], { levels: [-4, -8], sends: [-24, -22], decay: 1.5, master: 0 });
  return p;
}

function bitwiseMachine() {
  const p = patch("Meta Mod: Bitwise Machine", {
    module: "meta-mod", tempo: 126,
    description: "Algorithm 4 treats the carrier and modulator as integers and combines their bits: a saw lead and a square arpeggio turn into gritty, digital chords. A slow LFO lowers and raises Timbre (the bit resolution); switch Bitwise Op between XOR, AND, OR and Sum mod for different textures.",
    tags: ["bitwise", "digital", "lo-fi", "xor"],
  });
  const a = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, "."], { rate: "1/8", root: "D", scale: "Natural Minor", octave: -1, shape: 1, gatelength: 0.8, env: { decay: 0.3, sustain: 0.6 } });
  const b = melody(p, [0, 2], [12, 10, 7, 10, 12, 15, 12, 10], { rate: "1/16", root: "D", scale: "Natural Minor", octave: 0, shape: 0.5, env: { decay: 0.1, sustain: 0.3 } });
  const mm = p.add("meta-mod", [3, 0], { algorithm: 4, timbre: 0.4, bitwiseOp: "XOR", carrierLevel: 0.9, modLevel: 0.6, mix: 0.85 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.08, wave: "Triangle" }, { name: "Resolution" });
  const flt = p.add("filter", [4, 0], { cutoff: 2800, resonance: 0.15 }, { name: "Smooth" });
  p.cable(a.amp, "l", mm, "carrierL").cable(b.amp, "l", mm, "modulator").cable(lfo, "out", mm, "timbre", 0.35);
  p.cable(mm, "l", flt, "l").cable(mm, "r", flt, "r");
  const drums = beat(p, [0, 5], { style: "four", level: -10 });
  finish(p, [5, 0], [[flt, "l", "r"], [drums, "outl", "outr"]], { levels: [-8, -2], sends: [-12, -24], decay: 1.5, master: 0 });
  return p;
}

export default [ringBells, robotChoir, harmonicArp, foldBass, bitwiseMachine];
