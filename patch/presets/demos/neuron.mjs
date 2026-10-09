// SPDX-License-Identifier: MIT
// Neuron: five demo patches. Each plays by itself with the transport.
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

/// A drone pad: two detuned oscillators through a soft filter. Returns the filter (mono on "l").
function drone(p, at, coarse, o = {}) {
  const a = p.add("oscillator", [at[0], at[1]], { coarse, octave: o.octave ?? "-1", shape: o.shape ?? 0.5, fine: -6 }, { name: "Drone A" });
  const b = p.add("oscillator", [at[0], at[1] + 1], { coarse: coarse + 7, octave: o.octave ?? "-1", shape: o.shape ?? 0.5, fine: 6 }, { name: "Drone B" });
  const m = p.add("audio-mixer", [at[0] + 1, at[1]], { level1: -8, level2: -10, master: 0 }, { name: "Drone Mix" });
  p.cable(a, "out", m, "in1l").cable(b, "out", m, "in2l");
  const f = p.add("filter", [at[0] + 2, at[1]], { cutoff: o.cutoff ?? 900, resonance: 0.15 }, { name: "Drone Filter" });
  p.cable(m, "outl", f, "l");
  return f;
}

function defaultRhythm() {
  const p = patch("Neuron: Self-Made Rhythm", {
    module: "neuron", tempo: 100,
    description: "Neuron A fires regularly from its own bias; as it charges, its Out pushes Neuron B down, so B fires in irregular gaps. A Spike plays the kick, B Spike the snare and A AND B a clap over a pad: a rhythm made by two cells listening to each other. Try the Leak knobs or the W3 weights.",
    tags: ["rhythm", "spikes", "drums", "generative"],
  });
  const n = p.add("neuron", [0, 0], { aw1: 0.6, aleak: 0.25, bw1: 0.9, bleak: 0.4, bw3: -1, aw3: 0.5, cross: "Out" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const clap = p.add("punch-clap", [2, 2], { level: 0.5 });
  const hat = p.add("punch-hats", [2, 3], { level: 0.45, tone: 0.65 });
  p.cable(n, "aspike", kick, "trig").cable(n, "bspike", snare, "trig").cable(n, "and", clap, "trig").cable(n, "xor", hat, "closed");
  const pad = drone(p, [0, 5], 5, { cutoff: 700 });
  finish(p, [4, 0], [[kick, "out"], [snare, "out"], [clap, "out"], [hat, "out"]], { levels: [-4, -8, -9, -16], pans: [0, -0.25, 0.3, 0.45], sends: [-30, -12, -8, -14], decay: 2.2, master: -2 });
  const m2 = p.add("audio-mixer", [4, 4], { level1: -14, master: 0 }, { name: "Pad" });
  p.cable(pad, "l", m2, "in1l").cable(pad, "l", m2, "in1r");
  p.stereo(m2, p.out, { from: ["outl", "outr"] });
  return p;
}

function spikeMelody() {
  const p = patch("Neuron: Spike Melody", {
    module: "neuron", tempo: 90,
    description: "Neuron A's spikes ping a pair of low pass gates, while Neuron B's saw-like Out is sampled by a quantizer on every spike: pitches from an irregular rhythm, in D minor pentatonic, through a long delay. Change the Pulse and Leak of either neuron to rewrite the tune.",
    tags: ["melody", "quantizer", "generative", "bells"],
  });
  const n = p.add("neuron", [0, 0], { aw1: 0.7, aleak: 0.3, bw1: 0.5, bleak: 1.4, bw3: -0.4, aw3: 0.3, cross: "Out", apulse: 0.05 });
  const q = p.add("quantizer", [2, 0], { root: "D", scale: "Minor Pentatonic", range: 1.6 });
  const osc = p.add("oscillator", [3, 0], { shape: 0.1, octave: "0" }, { name: "Bell" });
  const lpg = p.add("low-pass-gate", [4, 0], { response: 0.45, ping: 0.9, brightness: 0.55, resonance: 0.2 }, { name: "Pluck" });
  const bass = p.add("oscillator", [3, 1], { shape: 0.2, octave: "-2", coarse: 2 }, { name: "Bass" });
  const blpg = p.add("low-pass-gate", [4, 1], { response: 0.6, ping: 0.9, brightness: 0.4 }, { name: "Bass Pluck" });
  p.cable(n, "bout", q, "in").cable(n, "aspike", q, "clock").cable(q, "out", osc, "pitch");
  p.cable(osc, "out", lpg, "l").cable(osc, "out", lpg, "r").cable(n, "aspike", lpg, "ping");
  p.cable(bass, "out", blpg, "l").cable(bass, "out", blpg, "r").cable(n, "bspike", blpg, "ping");
  const dl = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.45, mix: 0.45, tone: -0.2 }, { name: "Echoes" });
  p.cable(lpg, "l", dl, "l").cable(lpg, "r", dl, "r");
  finish(p, [6, 0], [[dl, "l", "r"], [blpg, "l", "r"]], { levels: [5, 0], sends: [-6, -12], decay: 4, master: 0 });
  return p;
}

function accelerando() {
  const p = patch("Neuron: Accelerando", {
    module: "neuron", tempo: 108,
    description: "A slow triangle LFO feeds Neuron A's In 2: the higher it rises, the faster A fires, so the hats and rim accelerate into a roll and fall silent as the level drops. Neuron B answers with a tom. Try a different W2 or Threshold to move where the roll starts.",
    tags: ["accelerando", "lfo input", "hats", "bursts"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.12, wave: "Triangle", polarity: "Unipolar" }, { name: "Level" });
  const n = p.add("neuron", [1, 0], { aw1: 0.05, aw2: 1.3, aw3: 0, aleak: 0.06, athreshold: 0.5, apulse: 0.02, bw1: 0.1, bw2: 0.9, bw3: 0, bleak: 0.5, bpulse: 0.04, cross: "Off" });
  p.cable(lfo, "out", n, "a2").cable(lfo, "out", n, "b2");
  const hat = p.add("punch-hats", [3, 0], { level: 0.55, closed: 0.04, tone: 0.7 });
  const rim = p.add("punch-rim", [3, 1], { level: 0.6 });
  const tom = p.add("punch-tom", [3, 2], { level: 0.8, tune: 90 });
  p.cable(n, "aspike", hat, "closed").cable(n, "aspike", rim, "trig").cable(n, "bspike", tom, "trig");
  const bass = melody(p, [0, 4], [0, ".", ".", ".", 0, ".", 7, "."], { rate: "1/4", root: "G", scale: "Natural Minor", octave: -2, shape: 0.2, env: { decay: 0.5, sustain: 0.3 } });
  finish(p, [5, 0], [[hat, "out"], [rim, "out"], [tom, "out"], [bass.amp, "l"]], { levels: [-8, -10, -4, -6], pans: [0.3, -0.3, 0, 0], sends: [-14, -10, -10, -30], decay: 2, master: 0 });
  return p;
}

function neuronOscillator() {
  const p = patch("Neuron: Audio-Rate Buzz", {
    module: "neuron", tempo: 76,
    description: "With Leak near 0 and Cross on Gate, the two neurons chase each other so fast that their output is an audio-rate buzz. A slow LFO bends the weights and so the pitch, a filter tames it and a slow envelope shapes it into a drifting, electric drone. Nudge W3 or Pulse to retune it.",
    tags: ["audio rate", "buzz", "drone", "experimental"],
  });
  const n = p.add("neuron", [0, 0], { aw1: 1, aw2: 0, aw3: 1.4, aleak: 0, athreshold: 0.2, apulse: 0.004, asharp: 6, bw1: 0.6, bw2: 0, bw3: 1.2, bleak: 0, bthreshold: 0.2, bpulse: 0.006, cross: "Gate", amode: "Spike", bmode: "Spike" });
  const lfo = p.add("lfo", [0, 1], { rate: 0.07, wave: "Triangle" }, { name: "Bend" });
  p.cable(lfo, "out", n, "aw3", 0.3).cable(lfo, "out", n, "bpulse", 0.4);
  const hp = p.add("filter", [2, 0], { type: "1-Pole High-pass", cutoff: 60 }, { name: "DC Block" });
  const lp = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.3, drive: 0.1 }, { name: "Tame" });
  p.cable(n, "agate", hp, "l").cable(n, "bgate", hp, "r").cable(hp, "l", lp, "l").cable(hp, "r", lp, "r");
  const sweep = p.add("lfo", [3, 1], { rate: 0.05, wave: "Sine" }, { name: "Cutoff Drift" });
  p.cable(sweep, "out", lp, "cutoff", 0.4);
  const pad = drone(p, [0, 4], 0, { cutoff: 600, octave: "-2" });
  const mix = finish(p, [4, 0], [[lp, "l", "r"], [pad, "l"]], { levels: [-2, -10], pans: [0, 0], sends: [-8, -10], decay: 5, master: 0 });
  return p;
}

function logicDrums() {
  const p = patch("Neuron: Logic Drums", {
    module: "neuron", tempo: 118,
    description: "Both neurons are in Compare mode, each a Schmitt trigger on its own clocked LFO. Their gates are combined by AND, OR and XOR into kick, clap and hats, so a few slow waves yield a changing polymetric groove. Change the Threshold of A or B to change which crossings count.",
    tags: ["logic", "compare", "polymeter", "groove"],
  });
  const la = p.add("lfo", [0, 0], { sync: "1/2", wave: "Sine", polarity: "Unipolar" }, { name: "Wave A" });
  const lb = p.add("lfo", [0, 1], { sync: "1/4", wave: "Triangle", polarity: "Unipolar", phase: 40 }, { name: "Wave B" });
  const n = p.add("neuron", [1, 0], { amode: "Compare", bmode: "Compare", aw1: 0, aw2: 1, aw3: 0, bw1: 0, bw2: 1, bw3: 0, aleak: 0, bleak: 0,
    athreshold: 0.6, bthreshold: 0.35, ahysteresis: 0.05, bhysteresis: 0.05, cross: "Off" });
  p.cable(la, "out", n, "a2").cable(lb, "out", n, "b2");
  const kick = p.add("punch-kick", [3, 0], { level: 0.85 });
  const clap = p.add("punch-clap", [3, 1], { level: 0.55 });
  const hat = p.add("punch-hats", [3, 2], { level: 0.5, tone: 0.6 });
  const snare = p.add("punch-snare", [3, 3], { level: 0.45 });
  p.cable(n, "and", kick, "trig").cable(n, "xor", clap, "trig").cable(n, "or", hat, "closed").cable(n, "agate", snare, "trig");
  const bass = melody(p, [0, 5], [0, 0, ".", 0, 3, ".", 5, "."], { rate: "1/8", root: "A", scale: "Natural Minor", octave: -2, shape: 0.25, env: { decay: 0.25, sustain: 0.4 } });
  finish(p, [5, 0], [[kick, "out"], [clap, "out"], [hat, "out"], [bass.amp, "l"]], { levels: [-5, -9, -14, -6], pans: [0, 0.25, -0.3, 0], sends: [-30, -10, -16, -30], decay: 1.8, master: 0 });
  return p;
}

export default [defaultRhythm, spikeMelody, accelerando, neuronOscillator, logicDrums];
