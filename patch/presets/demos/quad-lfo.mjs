// SPDX-License-Identifier: MIT
// Quad LFO: five demo patches. Each plays by itself with the transport.
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

function quadrature() {
  const p = patch("Quad LFO: Quadrature Chord", {
    module: "quad-lfo", tempo: 88,
    description: "In Quadrature mode the four LFOs are a quarter-turn apart, so four notes of a chord swell one after another in a rotating pattern. Change Rate to turn it faster, or switch Mode to Free to let each LFO run at its own speed.",
    tags: ["quadrature", "chord", "rotation", "swell"],
  });
  const q = p.add("quad-lfo", [0, 0], { rate1: 0.3, mode: "Quadrature", wave1: "Sine", polarity: "Unipolar" });
  const c = chord(p, [1, 0], [[0, "-1"], [7, "-1"], [3, "0"], [10, "0"]], { master: -3, lvl: -9 });
  for (let i = 0; i < 4; i++) p.cable(q, `out${i + 1}`, c.vcas[i], "gain", 1);
  finish(p, [5, 0], c.master, { jacks: c.jacks, stereo: true, trim: -3, verb: { size: 0.6, decay: 4, mix: 0.35 } });
  return p;
}

function divided() {
  const p = patch("Quad LFO: Divided Movements", {
    module: "quad-lfo", tempo: 112,
    description: "Locked to the tempo in Divide mode, the four LFOs run at whole fractions of one rate: the fastest shapes the tone, slower ones open the filter over two, four and eight times as long. Change a Divide setting or switch Sync off to unlock it.",
    tags: ["divide", "sync", "polyrhythm", "groove"],
  });
  const v = voice(p, [0, 0], [0, 0, 7, 0, 10, 0, 7, 5, 0, 0, 7, 12, 10, 7, 5, 3], { rate: "1/16", shape: 0.9, root: "D", octave: -1, env: { decay: 0.16, sustain: 0.3 }, filter: { cutoff: 500, resonance: 0.35 } });
  const q = p.add("quad-lfo", [3, 1], { rate1: 1, mode: "Divide", sync: true, divide1: "÷1", divide2: "÷2", divide3: "÷4", divide4: "÷8", wave1: "Triangle", wave2: "Sine", wave3: "Sine", wave4: "Sine" });
  p.cable(q, "out1", v.osc, "shape", 0.25).cable(q, "out2", v.filt, "cutoff", 0.35).cable(q, "out3", v.filt, "cutoff", 0.3).cable(q, "out4", v.filt, "resonance", 0.15);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -11, master: 0 });
  const verb = p.add("reverb", [5, 0], { size: 0.4, decay: 1.8, mix: 0.12, quality: "Eco (8 lines)" });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function stereoSweep() {
  const p = patch("Quad LFO: Stereo Filter Sweep", {
    module: "quad-lfo", tempo: 92,
    description: "Phase mode keeps all four LFOs at the same rate but staggered by Spread. Here two of them sweep a separate filter for each channel, so the pad's brightness moves from left to right. Widen or narrow Spread, or change Rate 1 for a faster sweep.",
    tags: ["phase", "spread", "stereo", "filter sweep"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "E", scale: "Minor Pentatonic", octave: -1, gatelength: 0.95 },
    { data: steps([0, 3, 7, 5, 0, 5, 10, 7]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.9, fine: -8 }, { name: "Osc L" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.9, fine: 8 }, { name: "Osc R" });
  const fl = p.add("filter", [2, 0], { cutoff: 600, resonance: 0.4 }, { name: "Filter L" });
  const fr = p.add("filter", [2, 1], { cutoff: 600, resonance: 0.4 }, { name: "Filter R" });
  const q = p.add("quad-lfo", [1, 3], { rate1: 0.22, mode: "Phase", spread: 150, wave1: "Sine", polarity: "Unipolar" });
  const mix = p.add("audio-mixer", [3, 0], { level1: -13, level2: -13, pan1: -1, pan2: 1, master: 0 });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", fl, "l").cable(o1, "out", fl, "r").cable(o2, "out", fr, "l").cable(o2, "out", fr, "r")
    .cable(q, "out1", fl, "cutoff", 0.55).cable(q, "out2", fr, "cutoff", 0.55)
    .cable(fl, "l", mix, "in1l").cable(fr, "l", mix, "in2r");
  const v = p.add("reverb", [4, 0], { size: 0.5, decay: 3, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function freeTexture() {
  const p = patch("Quad LFO: Free Texture", {
    module: "quad-lfo", tempo: 100,
    description: "In Free mode the four LFOs run at unrelated rates with different waves (sine, smooth random, triangle and stepped random); their Sum output moves the filter while the others change tone and resonance, an endlessly shifting texture. Change a Rate or Wave to steer it.",
    tags: ["free", "waveforms", "random", "texture"],
  });
  const v = voice(p, [0, 0], [0, 7, 3, 10, 12, 7, 5, 3, 0, 5, 8, 7, 12, 10, 7, 3], { rate: "1/8", shape: 0.7, root: "F", scale: "Dorian", env: { decay: 0.3, sustain: 0.2 }, filter: { cutoff: 700, resonance: 0.3 } });
  const q = p.add("quad-lfo", [3, 1], { rate1: 0.13, rate2: 0.31, rate3: 0.77, rate4: 1.9, mode: "Free", level1: 0.8, level2: 0.8, level3: 0.5, level4: 0.5,
    wave1: "Sine", wave2: "Random Smooth", wave3: "Triangle", wave4: "Random Step" });
  p.cable(q, "sum", v.filt, "cutoff", 0.4).cable(q, "out3", v.osc, "shape", 0.3).cable(q, "out2", v.filt, "resonance", 0.12);
  finish(p, [4, 0], v.filt, { stereo: true, trim: -2, verb: { size: 0.5, decay: 3, mix: 0.3 } });
  return p;
}

function clockHold() {
  const p = patch("Quad LFO: Clocked and Held", {
    module: "quad-lfo", tempo: 106,
    description: "The LFOs follow a clock from the sequencer rather than a free rate, and a second, sparser gate patched to Hold freezes them for a moment. The result is a filter movement that stops and resumes in time with the notes. Change Clock Ratio for a faster or slower cycle.",
    tags: ["clock", "hold", "sync", "freeze"],
  });
  const v = voice(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/8", shape: 0.8, root: "C", scale: "Natural Minor", env: { decay: 0.25, sustain: 0.2 }, filter: { cutoff: 600, resonance: 0.35 } });
  const hold = p.add("step-sequencer", [3, 2], { length: 8, rate: "1/4", gatelength: 0.5 }, { data: steps([".", ".", 0, ".", ".", ".", 0, 0]) });
  const q = p.add("quad-lfo", [3, 1], { mode: "Quadrature", sync: true, clockratio: "8", wave1: "Triangle", polarity: "Unipolar" });
  p.cable(v.seq, "trigger", q, "clock").cable(hold, "gate", q, "hold").cable(q, "out1", v.filt, "cutoff", 0.5).cable(q, "out2", v.osc, "shape", 0.3);
  finish(p, [4, 0], v.filt, { stereo: true, trim: -2, verb: { size: 0.45, decay: 2.2, mix: 0.25 } });
  return p;
}

export default [quadrature, divided, stereoSweep, freeTexture, clockHold];
