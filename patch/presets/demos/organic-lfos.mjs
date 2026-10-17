// SPDX-License-Identifier: MIT
// Organic LFOs: five demo patches. Each plays by itself with the transport.
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

function livingPad() {
  const p = patch("Organic LFOs: Living Pad", {
    module: "organic-lfos", tempo: 76,
    description: "Eight slow, related movements are spread over a pad: the filter, the oscillator shape and the reverb size each follow a different one, so the sound breathes without ever repeating exactly. Change Rate, Spread and Drift on the module to speed up or loosen the group.",
    tags: ["pad", "slow modulation", "drift", "evolving"],
  });
  const pd = pad(p, [0, 0], [0, 3, 7, 5, 0, 3, 8, 5], { rate: "1/1", root: "C", scale: "Natural Minor", gain: 1, shape: 0.6, filter: { cutoff: 900, resonance: 0.25 } });
  const o = p.add("organic-lfos", [0, 3], { rate: 0.12, spread: 0.5, drift: 0.4, scatter: 1, level: 1, polarity: "Bipolar" });
  const verb = finish(p, [5, 0], pd.filt, { stereo: true, trim: -13, verb: { size: 0.55, decay: 4, mix: 0.35 } });
  p.cable(o, "out1", pd.filt, "cutoff", 0.45).cable(o, "out2", pd.filt, "resonance", 0.2).cable(o, "out3", pd.o1, "shape", 0.35)
    .cable(o, "out4", pd.o2, "shape", 0.35).cable(o, "out5", verb, "size", 0.3).cable(o, "out6", verb, "mix", 0.15);
  return p;
}

function eightTones() {
  const p = patch("Organic LFOs: Breathing Chord", {
    module: "organic-lfos", tempo: 70,
    description: "Six of the eight outputs swell six notes of a chord in and out, so the harmony rearranges itself in a slow, natural way. Lower Scatter to make the voices move more alike, or turn Spread negative to reverse the order.",
    tags: ["chord", "levels", "swell", "scatter"],
  });
  const o = p.add("organic-lfos", [0, 0], { rate: 0.25, spread: 0.6, drift: 0.35, scatter: 1, polarity: "Unipolar" });
  const c = chord(p, [1, 0], [[0, "-1"], [7, "-1"], [4, "0"], [11, "0"], [2, "+1"], [9, "0"]], { master: -4, lvl: -10 });
  for (let i = 0; i < 6; i++) p.cable(o, `out${i + 1}`, c.vcas[i], "gain", 1);
  finish(p, [5, 0], c.master, { jacks: c.jacks, stereo: true, trim: -3, verb: { size: 0.65, decay: 4.5, mix: 0.35 } });
  return p;
}

function lively() {
  const p = patch("Organic LFOs: Lively Pluck", {
    module: "organic-lfos", tempo: 108,
    description: "At a faster Rate with plenty of Drift, the same eight movements become a restless wobble: they open the filter, change the tone and add resonance to a plucked line, never twice the same way. Slow Rate and Drift down for a calmer feel.",
    tags: ["fast", "drift", "pluck", "filter"],
  });
  const v = voice(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/8", shape: 0.85, root: "A", env: { decay: 0.28, sustain: 0.1 }, filter: { cutoff: 700, resonance: 0.25 } });
  const o = p.add("organic-lfos", [3, 1], { rate: 1.4, spread: 0.8, drift: 0.7, scatter: 0.8 });
  p.cable(o, "out3", v.filt, "cutoff", 0.4).cable(o, "out5", v.filt, "resonance", 0.15).cable(o, "out7", v.osc, "shape", 0.3);
  finish(p, [4, 0], v.filt, { stereo: true, trim: 1, verb: { size: 0.45, decay: 2, mix: 0.25 } });
  return p;
}

function barLocked() {
  const p = patch("Organic LFOs: Bar-Locked Breath", {
    module: "organic-lfos", tempo: 110,
    description: "With Lock set to Bars the group repeats in step with the song, so the filter movement over a bass line and beat comes back exactly each time. Switch Lock back to Free and the same movement slips out of time.",
    tags: ["lock", "bars", "bass", "groove"],
  });
  const v = voice(p, [0, 0], [0, "_", 0, ".", 7, "_", 5, ".", 0, "_", 0, 3, 10, "_", 7, 5], { rate: "1/8", shape: 0.95, root: "G", octave: -2, gatelength: 0.8, env: { decay: 0.2, sustain: 0.7 }, filter: { cutoff: 350, resonance: 0.3 } });
  const o = p.add("organic-lfos", [3, 1], { rate: 0.5, spread: 0.4, drift: 0.2, lock: "Bars", polarity: "Unipolar" });
  p.cable(o, "out1", v.filt, "cutoff", 0.55).cable(o, "out2", v.filt, "resonance", 0.15);
  const drums = beat(p, [0, 4], { style: "broken", level: -6 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -9, master: 0 });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function panCloud() {
  const p = patch("Organic LFOs: Wandering Voices", {
    module: "organic-lfos", tempo: 84,
    description: "Four held notes each wander across the stereo field, steered by different outputs, while Twist bends how the group is related. Change Twist and Spread to change how the voices follow each other.",
    tags: ["pan", "stereo", "twist", "drone"],
  });
  const o = p.add("organic-lfos", [0, 4], { rate: 0.3, spread: 0.5, drift: 0.3, twist: 0.5 });
  const oscs = [[0, "-1"], [7, "-1"], [4, "0"], [12, "-1"]].map((t, i) =>
    p.add("oscillator", [0, i], { shape: 0.4, coarse: t[0], octave: t[1], fine: (i - 1.5) * 6 }, { name: `Tone ${i + 1}` }));
  const mix = p.add("audio-mixer", [1, 0], { level1: -9, level2: -9, level3: -9, level4: -9, master: 0 }, { name: "Pan Mix" });
  const f = p.add("filter", [2, 0], { cutoff: 1500, resonance: 0.15 }, { name: "Filter" });
  oscs.forEach((osc, i) => p.cable(osc, "out", mix, `in${i + 1}l`).cable(osc, "out", mix, `in${i + 1}r`).cable(o, `out${i + 1}`, mix, `pan${i + 1}`, 0.9));
  p.stereo(mix, f, { from: ["outl", "outr"] });
  finish(p, [3, 0], f, { stereo: true, trim: -10, verb: { size: 0.6, decay: 3.5, mix: 0.3 } });
  return p;
}

export default [livingPad, eightTones, lively, barLocked, panCloud];
