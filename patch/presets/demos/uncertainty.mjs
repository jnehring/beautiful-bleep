// SPDX-License-Identifier: MIT
// Uncertainty: five demo patches. Each plays by itself with the transport.
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

function fluctuating() {
  const p = patch("Uncertainty: Fluctuating Filter", {
    module: "uncertainty", tempo: 94,
    description: "The two fluctuating curves wander at unrelated speeds: one opens and closes the filter on a plucked line, the other changes the tone shape. Raise F1 Rate and F2 Rate to speed them up, or lower F1 Spread to shrink the sweep.",
    tags: ["fluctuating", "smooth random", "filter", "slow"],
  });
  const v = voice(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/8", shape: 0.8, root: "G", scale: "Natural Minor", env: { decay: 0.3, sustain: 0.15 }, filter: { cutoff: 650, resonance: 0.3 } });
  const u = p.add("uncertainty", [3, 1], { f1rate: 0.35, f2rate: 0.13, f1spread: 0.9, f2spread: 0.8, fsync: "Free" });
  p.cable(u, "fluct1", v.filt, "cutoff", 0.5).cable(u, "fluct2", v.osc, "shape", 0.35);
  finish(p, [4, 0], v.filt, { stereo: true, trim: -2, verb: { size: 0.5, decay: 3, mix: 0.3 } });
  return p;
}

function quantSteps() {
  const p = patch("Uncertainty: Stepped Levels", {
    module: "uncertainty", tempo: 108,
    description: "Quantized outputs jump between a few evenly spaced levels (Q1 Bits sets how many): Q1 pushes the pitch up by octaves and Q2 moves the filter, both in time with the eighth notes. Try Q1 Interval at 7 st for stacked fifths or raise the bits for more levels.",
    tags: ["quantized", "bits", "interval", "steps"],
  });
  const v = voice(p, [0, 0], [0, 0, 0, ".", 0, 0, ".", 0, 0, 0, 0, ".", 0, ".", 0, 0], { rate: "1/8", shape: 0.85, root: "E", octave: -1, env: { decay: 0.2, sustain: 0.2 }, filter: { cutoff: 600, resonance: 0.3 } });
  const u = p.add("uncertainty", [3, 1], { qrate: 4, qsync: "1/8", q1bits: 2, q2bits: 3, q1interval: "7 st", q2interval: "Even" });
  p.cable(u, "quant1", v.osc, "pitch", 0.2).cable(u, "quant2", v.filt, "cutoff", 0.5);
  finish(p, [4, 0], v.filt, { stereo: true, trim: 4, verb: { size: 0.45, decay: 2, mix: 0.25 } });
  return p;
}

function stored() {
  const p = patch("Uncertainty: Stored Per Note", {
    module: "uncertainty", tempo: 112,
    description: "Each note of the line tells the Store input to take a fresh stored value, which then holds until the next note; it sets the filter, and the Store Trigger output also fires a hi-hat. Raise Correlation so each value leans on the last, or move Distribution to favour low or high settings.",
    tags: ["store", "correlation", "distribution", "hats"],
  });
  const v = voice(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/8", shape: 0.85, root: "D", scale: "Dorian", env: { decay: 0.2, sustain: 0.2 }, filter: { cutoff: 900, resonance: 0.3 } });
  const u = p.add("uncertainty", [3, 1], { correlation: 0.5, distribution: 0.2, shape: "Bell" });
  const hats = p.add("punch-hats", [3, 3], { level: 0.45 });
  p.cable(v.seq, "trigger", u, "store").cable(u, "stored", v.filt, "cutoff", 0.55).cable(u, "storetrig", hats, "closed");
  const drums = beat(p, [0, 4], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 3, level2: -10, level3: -10, master: 0 });
  const verb = p.add("reverb", [5, 0], { size: 0.4, decay: 1.8, mix: 0.12, quality: "Eco (8 lines)" });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .cable(hats, "out", mix, "in3l").cable(hats, "out", mix, "in3r").stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function integrated() {
  const p = patch("Uncertainty: Integrated Drift", {
    module: "uncertainty", tempo: 70,
    description: "The Integrated output is the running total of the stored steps, so it wanders like a slow random walk; here it steers the brightness of a held pad and the stored value tilts the oscillators. Change Integrate to make the walk shorter-lived or longer, and Store Rate for how often it is nudged.",
    tags: ["integrated", "random walk", "pad", "slow"],
  });
  const pd = pad(p, [0, 0], [0, 7, 3, 10, 5, 8, 3, 7], { rate: "1/1", root: "C", scale: "Natural Minor", gain: 1, shape: 0.6, filter: { cutoff: 800, resonance: 0.25 } });
  const u = p.add("uncertainty", [0, 3], { storerate: 0.6, storesync: "Free", integrate: 2, distribution: 0, correlation: 0.3 });
  p.cable(u, "integrated", pd.filt, "cutoff", 0.7).cable(u, "stored", pd.o1, "shape", 0.2).cable(u, "stored", pd.o2, "shape", -0.2);
  finish(p, [5, 0], pd.filt, { stereo: true, trim: -13, verb: { size: 0.6, decay: 4, mix: 0.35 } });
  return p;
}

function edges() {
  const p = patch("Uncertainty: Extreme Moods", {
    module: "uncertainty", tempo: 120,
    description: "Setting Shape to Edges makes the random values favour the extremes, so the filter on this bass line jumps between very closed and wide open instead of sitting in the middle. Switch Shape to Bell or Uniform to hear it settle.",
    tags: ["edges", "shape", "bass", "extremes"],
  });
  const v = voice(p, [0, 0], [0, "_", 0, 3, 0, "_", 7, 5, 0, "_", 0, 3, 10, "_", 7, 5], { rate: "1/8", shape: 0.95, root: "A", octave: -2, gatelength: 0.8, env: { decay: 0.2, sustain: 0.7 }, filter: { cutoff: 300, resonance: 0.35 } });
  const u = p.add("uncertainty", [3, 1], { shape: "Edges", f1rate: 1, f1spread: 1, fsync: "1/2", qrate: 3, qsync: "1/8", q1bits: 1, distribution: 0 });
  p.cable(u, "fluct1", v.filt, "cutoff", 0.5).cable(u, "quant1", v.filt, "resonance", 0.2);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -11, master: 0 });
  const verb = p.add("reverb", [5, 0], { size: 0.4, decay: 1.8, mix: 0.12, quality: "Eco (8 lines)" });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [fluctuating, quantSteps, stored, integrated, edges];
