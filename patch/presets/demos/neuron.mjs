// SPDX-License-Identifier: MIT
// Neuron: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono/stereo source (`src`, jacks l/r) → trim → reverb → Out.
function finish(p, at, src, o = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: o.trim ?? 0, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...(o.verb || {}) });
  const [jl, jr] = o.jacks || ["l", "r"];
  p.cable(src, jl, t, "in1l").cable(src, o.stereo ? jr : jl, t, "in1r");
  p.stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

/// Plucked melody into a Multi Filter (returns the filter, stereo out).
function voice(p, at, notes, o = {}) {
  const m = melody(p, at, notes, o);
  const f = p.add("filter", [at[0] + 3, at[1]], { cutoff: 1200, resonance: 0.25, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r");
  return { ...m, filt: f };
}

/// Two detuned oscillators (left / right) held by a sequencer → VCA (gain left to the caller) → Multi Filter.
function pad(p, at, notes, o = {}) {
  const [c, r] = at;
  const seq = p.add("step-sequencer", [c, r], { length: notes.length, rate: o.rate || "1/2", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? -1, gatelength: o.gate ?? 0.95 }, { data: steps(notes) });
  const o1 = p.add("oscillator", [c + 1, r], { shape: o.shape ?? 0.5, fine: -9 }, { name: "Osc L" });
  const o2 = p.add("oscillator", [c + 1, r + 1], { shape: o.shape ?? 0.5, fine: 9 }, { name: "Osc R" });
  const amp = p.add("vca", [c + 2, r], { gain: o.gain ?? 1 }, { name: "VCA" });
  const f = p.add("filter", [c + 3, r], { cutoff: 1400, resonance: 0.2, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", amp, "l").cable(o2, "out", amp, "r")
    .stereo(amp, f);
  return { seq, o1, o2, amp, filt: f };
}

/// Up to six oscillators, each through its own VCA (gain from the caller), mixed to stereo on `master` (jacks outl/outr).
/// tones: [semitones, octave] per oscillator.
function chord(p, at, tones, o = {}) {
  const [c, r] = at;
  const lv = o.lvl ?? -10;
  const mixA = p.add("audio-mixer", [c + 2, r], { level1: lv, level2: lv, level3: lv, pan1: -0.7, pan2: 0, pan3: 0.7, master: 0 }, { name: "Mix 1-3" });
  const mixB = p.add("audio-mixer", [c + 2, r + 3], { level1: lv, level2: lv, level3: lv, pan1: 0.5, pan2: -0.4, pan3: 0.2, master: 0 }, { name: "Mix 4-6" });
  const vcas = [], oscs = [];
  tones.forEach((t, i) => {
    const osc = p.add("oscillator", [c, r + i], { shape: o.shape ?? 0, coarse: t[0], octave: t[1] }, { name: `Tone ${i + 1}` });
    const vca = p.add("vca", [c + 1, r + i], { gain: o.gain ?? 0 }, { name: `Level ${i + 1}` });
    p.cable(osc, "out", vca, "l");
    if (o.pitch) p.cable(o.pitch, "pitch", osc, "pitch");
    const m = i < 3 ? mixA : mixB, k = (i % 3) + 1;
    p.cable(vca, "l", m, `in${k}l`).cable(vca, "l", m, `in${k}r`);
    vcas.push(vca); oscs.push(osc);
  });
  const master = p.add("audio-mixer", [c + 3, r], { level1: 0, level2: 0, master: o.master ?? 0 }, { name: "Master" });
  p.stereo(mixA, master, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(mixB, master, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { vcas, oscs, master, jacks: ["outl", "outr"] };
}

function rhythm() {
  const p = patch("Neuron: Self-Playing Rhythm", {
    module: "neuron", tempo: 110,
    description: "Two neurons charge up, fire and listen to each other, and that conversation is a drum pattern: A fires the kick, B the snare, and the logic outputs add hats and claps where they agree or differ. Change the Threshold or Leak of either neuron and the rhythm re-forms.",
    tags: ["rhythm", "drums", "spikes", "logic"],
  });
  const n = p.add("neuron", [0, 0], { athreshold: 0.5, bthreshold: 0.5 });
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [1, 2], { level: 0.45 });
  const clap = p.add("punch-clap", [1, 3], { level: 0.5 });
  p.cable(n, "aspike", kick, "trig").cable(n, "bspike", snare, "trig").cable(n, "xor", hats, "closed").cable(n, "and", clap, "trig");
  const mix = p.add("audio-mixer", [2, 0], { level1: -9, level2: -12, level3: -16, level4: -14, master: 0 });
  p.cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(snare, "out", mix, "in2l").cable(snare, "out", mix, "in2r")
    .cable(hats, "out", mix, "in3l").cable(hats, "out", mix, "in3r").cable(clap, "out", mix, "in4l").cable(clap, "out", mix, "in4r");
  const verb = p.add("reverb", [3, 0], { size: 0.4, decay: 1.6, mix: 0.15, quality: "Eco (8 lines)" });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function melody2() {
  const p = patch("Neuron: Spiking Melody", {
    module: "neuron", tempo: 100,
    description: "Neuron A's gate plays the notes and its membrane level, passed through a Quantizer, picks the pitch: as the neuron charges the notes climb, then drop when it fires. Lower the Threshold for a faster tune, or raise Leak to flatten the climb.",
    tags: ["melody", "quantizer", "membrane", "gate"],
  });
  const n = p.add("neuron", [0, 0], { athreshold: 0.45, aleak: 0.6, aw1: 1, apulse: 0.12 });
  const q = p.add("quantizer", [1, 0], { root: "E", scale: "Minor Pentatonic", range: 1 });
  const osc = p.add("oscillator", [2, 0], { shape: 0.75 }, { name: "Source" });
  const env = p.add("adsr", [2, 1], { attack: 0.004, decay: 0.3, sustain: 0.2, release: 0.25 }, { name: "Amp Env" });
  const amp = p.add("vca", [3, 0], {});
  const f = p.add("filter", [4, 0], { cutoff: 1800, resonance: 0.2 }, { name: "Filter" });
  p.cable(n, "aout", q, "in", 0.3).cable(n, "aspike", q, "clock").cable(q, "out", osc, "pitch").cable(n, "agate", env, "gate").cable(n, "aspike", env, "retrig")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain").cable(amp, "l", f, "l").cable(amp, "l", f, "r");
  finish(p, [5, 0], f, { stereo: true, trim: 6, verb: { size: 0.5, decay: 2.5, mix: 0.3 } });
  return p;
}

function callResponse() {
  const p = patch("Neuron: Call and Response", {
    module: "neuron", tempo: 92,
    description: "With Cross on Gate, each neuron's firing nudges the other, so a low bass note from A is answered by a high bell from B. Set Cross to Off and the two stop listening and drift apart; change B's W3 to turn the answer into a hesitation.",
    tags: ["cross", "interaction", "bass", "bell"],
  });
  const n = p.add("neuron", [0, 0], { cross: "Gate", athreshold: 0.5, bthreshold: 0.45, aw3: 0.4, bw3: -0.6 });
  const bass = p.add("oscillator", [1, 0], { shape: 0.05, octave: "-2" }, { name: "Bass" });
  const be = p.add("adsr", [1, 1], { attack: 0.005, decay: 0.5, sustain: 0.3, release: 0.3 }, { name: "Bass Env" });
  const ba = p.add("vca", [2, 0], {});
  const bell = p.add("oscillator", [1, 2], { shape: 0, octave: "+2", coarse: 7 }, { name: "Bell" });
  const ee = p.add("adsr", [1, 3], { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 }, { name: "Bell Env" });
  const ea = p.add("vca", [2, 2], {});
  p.cable(n, "agate", be, "gate").cable(be, "env", ba, "gain").cable(bass, "out", ba, "l")
    .cable(n, "bgate", ee, "gate").cable(n, "bspike", ee, "retrig").cable(ee, "env", ea, "gain").cable(bell, "out", ea, "l");
  const mix = p.add("audio-mixer", [3, 0], { level1: -4, level2: -14, master: 0 });
  const verb = p.add("reverb", [4, 0], { size: 0.65, decay: 4, mix: 0.4, quality: "Eco (8 lines)" });
  p.cable(ba, "l", mix, "in1l").cable(ba, "l", mix, "in1r").cable(ea, "l", mix, "in2l").cable(ea, "l", mix, "in2r")
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function swell() {
  const p = patch("Neuron: Slow Charge", {
    module: "neuron", tempo: 76,
    description: "The neurons' membrane levels (A Out and B Out) are slow, irregular swells here: one fades a pad in and out and the other opens its filter. Lower Leak for longer swells, or raise Sharp on a neuron for a harder snap at the top.",
    tags: ["slow", "modulation", "pad", "membrane"],
  });
  const pd = pad(p, [0, 0], [0, 7, 3, 10], { rate: "1/1", root: "A", scale: "Natural Minor", gain: 0.7, shape: 0.7, filter: { cutoff: 700, resonance: 0.25 } });
  const n = p.add("neuron", [0, 3], { aw1: 0.15, aleak: 0.05, athreshold: 0.8, bw1: 0.12, bleak: 0.08, bthreshold: 0.7, bw3: 0, aw3: 0 });
  p.cable(n, "aout", pd.amp, "gain", 1).cable(n, "bout", pd.filt, "cutoff", 0.5);
  finish(p, [5, 0], pd.filt, { stereo: true, trim: -6, verb: { size: 0.6, decay: 4, mix: 0.35 } });
  return p;
}

function driven() {
  const p = patch("Neuron: Driven by an LFO", {
    module: "neuron", tempo: 120,
    description: "A slow triangle LFO feeds the neurons' inputs: when it is high they fire fast and when it is low they go quiet, so a bass, tom and hat pattern speeds up and thins out in waves. Change the LFO Rate or the neuron weights to change the ebb and flow.",
    tags: ["lfo", "input", "bursts", "drums"],
  });
  const l = p.add("lfo", [0, 3], { rate: 0.13, wave: "Triangle", polarity: "Unipolar" }, { name: "Drive" });
  const n = p.add("neuron", [0, 0], { aw1: 0.3, aw2: 1.2, aw3: 0, bw1: 0.3, bw2: 0.9, bw3: 0, athreshold: 0.6, bthreshold: 0.6, aleak: 0.5, bleak: 0.7 });
  const tom = p.add("punch-tom", [1, 0], { tune: 90, level: 0.8, decay: 0.3 });
  const hats = p.add("punch-hats", [1, 1], { level: 0.45, closed: 0.04 });
  const kick = p.add("punch-kick", [1, 2], { level: 0.7 });
  const g = p.add("lfo", [1, 3], { wave: "Square", sync: "1/4", polarity: "Unipolar", pw: 0.1 }, { name: "Pulse" });
  p.cable(l, "out", n, "a2").cable(l, "out", n, "b2").cable(n, "aspike", tom, "trig").cable(n, "bspike", hats, "closed").cable(g, "cycle", kick, "trig");
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, level2: -12, level3: -5, master: 0 });
  const verb = p.add("reverb", [3, 0], { size: 0.4, decay: 1.8, mix: 0.18, quality: "Eco (8 lines)" });
  p.cable(tom, "out", mix, "in1l").cable(tom, "out", mix, "in1r").cable(hats, "out", mix, "in2l").cable(hats, "out", mix, "in2r")
    .cable(kick, "out", mix, "in3l").cable(kick, "out", mix, "in3r").stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [rhythm, melody2, callResponse, swell, driven];
