// SPDX-License-Identifier: MIT
// Quad LFO: five demo patches. Each plays by itself with the transport.
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

/// Oscillator → VCA pairs for a chord (semitones from C); returns {oscs, vcas}.
function voices(p, at, semis, o = {}) {
  const oscs = [], vcas = [];
  semis.forEach((s, i) => {
    const osc = p.add("oscillator", [at[0], at[1] + i], { coarse: s, shape: o.shape ?? 0.7, octave: o.octave ?? "-1", fine: (i - 1.5) * 3 }, { name: `Voice ${i + 1}` });
    const v = p.add("vca", [at[0] + 1, at[1] + i], {}, { name: `Gate ${i + 1}` });
    p.cable(osc, "out", v, "l").cable(osc, "out", v, "r");
    oscs.push(osc); vcas.push(v);
  });
  return { oscs, vcas };
}

function circularPan() {
  const p = patch("Quad LFO: Circular Pan", {
    module: "quad-lfo", tempo: 92,
    description: "In Quadrature mode four sines run a quarter cycle apart. Out 1 and Out 2 pan two plucked lines in a slow circle around the listener while the other two outputs swell a pad. Switch the module's view to XY to see the circle, and change Rate 1 to spin it faster.",
    tags: ["quadrature", "pan", "circle", "stereo"],
  });
  const a = melody(p, [0, 0], [0, 4, 7, 11, 9, 7, 4, 2], { rate: "1/8", root: "F", scale: "Lydian", octave: 0, shape: 0.5, env: { decay: 0.3, sustain: 0.55, release: 0.3 } });
  const b = melody(p, [0, 2], [7, ".", 4, ".", 11, ".", 9, "."], { rate: "1/8", root: "F", scale: "Lydian", octave: -1, shape: 0.3, env: { decay: 0.4, sustain: 0.5 }, gatelength: 0.8 });
  const q = p.add("quad-lfo", [3, 0], { rate1: 0.18, mode: "Quadrature", polarity: "Bipolar" });
  const pad = p.add("oscillator", [3, 2], { octave: "-1", coarse: 5, shape: 0.4 }, { name: "Pad" });
  const padv = p.add("vca", [4, 2], {}, { name: "Swell" });
  p.cable(pad, "out", padv, "l").cable(pad, "out", padv, "r").cable(q, "out3", padv, "gain", 0.3).cable(q, "out4", padv, "gain", 0.3);
  const mix = finish(p, [5, 0], [[a.amp, "l"], [b.amp, "l"], [padv, "l", "r"]], { levels: [-4, -3, -8], sends: [-8, -8, -4], decay: 3.5, master: -2 });
  p.cable(q, "out1", mix, "pan1", 0.9).cable(q, "out2", mix, "pan2", 0.9);
  return p;
}

function polyrhythmPlucks() {
  const p = patch("Quad LFO: Polyrhythm Plucks", {
    module: "quad-lfo", tempo: 120,
    description: "Divide mode runs four falling saws at x1, 1/2, 1/3 and 1/4 of one rate, each plucking a note of an A minor chord: a 4-against-3-against-2 pattern that only lines up every twelve beats. Change Divide 2-4 to remix the polyrhythm.",
    tags: ["divide", "polyrhythm", "pluck", "arpeggio"],
  });
  const v = voices(p, [0, 0], [0, 3, 7, 10], { octave: "0", shape: 0.6 });
  const q = p.add("quad-lfo", [2, 0], { rate1: 4, mode: "Divide", divide1: "÷1", divide2: "÷2", divide3: "÷3", divide4: "÷4", wave1: "Saw Down", wave2: "Saw Down",
    wave3: "Saw Down", wave4: "Saw Down", polarity: "Unipolar" });
  const lp = v.vcas.map((vca, i) => {
    p.cable(q, `out${i + 1}`, vca, "gain");
    return vca;
  });
  finish(p, [4, 0], lp.map((l) => [l, "l", "r"]), { levels: [-7, -7, -7, -7], pans: [-0.6, -0.2, 0.2, 0.6], sends: [-9, -9, -9, -9], decay: 2.5, master: -5 });
  return p;
}

function chordBreath() {
  const p = patch("Quad LFO: Chord Breath", {
    module: "quad-lfo", tempo: 66,
    description: "Phase mode with Spread at 90 degrees lets four unipolar sines pass one swell along the voices of a major-seventh chord: the chord rolls up and down like a breath. Try Spread 0 (all together) or 180 (two pairs).",
    tags: ["phase", "pad", "swell", "slow"],
  });
  const v = voices(p, [0, 0], [0, 4, 7, 11], { shape: 0.55, octave: "-1" });
  const q = p.add("quad-lfo", [2, 0], { rate1: 0.16, mode: "Phase", spread: 90, polarity: "Unipolar" });
  v.vcas.forEach((vca, i) => p.cable(q, `out${i + 1}`, vca, "gain"));
  const flt = p.add("filter", [2, 2], { cutoff: 1800, resonance: 0.2 }, { name: "Soften" });
  // the pad passes the filter after a quick mix of the four voices
  const sum = p.add("audio-mixer", [3, 0], { level1: -6, level2: -6, level3: -6, level4: -6, master: 0 }, { name: "Chord" });
  v.vcas.forEach((vca, i) => p.cable(vca, "l", sum, `in${i + 1}l`).cable(vca, "r", sum, `in${i + 1}r`));
  p.cable(sum, "outl", flt, "l").cable(sum, "outr", flt, "r");
  p.cable(q, "sum", flt, "cutoff", 0.35);
  const mix = finish(p, [4, 0], [[flt, "l", "r"]], { levels: [-1], sends: [-6], decay: 6, master: 0 });
  return p;
}

function cycleDrums() {
  const p = patch("Quad LFO: Cycle Drums", {
    module: "quad-lfo", tempo: 112,
    description: "The Cycle outputs fire once per LFO cycle, and in Divide mode each LFO has its own fraction of the rate: kick every beat, hat every half beat, clap every third and a tom every fifth - a drum pattern that slowly phases. Change the Divide settings to rearrange it.",
    tags: ["cycle", "drums", "divide", "triggers"],
  });
  const q = p.add("quad-lfo", [0, 0], { rate1: 3.7333, mode: "Divide", divide1: "÷2", divide2: "÷1", divide3: "÷3", divide4: "÷5", level1: 1 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85 });
  const hat = p.add("punch-hats", [2, 1], { level: 0.5, tone: 0.6 });
  const clap = p.add("punch-clap", [2, 2], { level: 0.6 });
  const tom = p.add("punch-tom", [2, 3], { level: 0.7, tune: 140 });
  p.cable(q, "cycle1", kick, "trig").cable(q, "cycle2", hat, "closed").cable(q, "cycle3", clap, "trig").cable(q, "cycle4", tom, "trig");
  const bass = melody(p, [0, 5], [0, ".", 0, ".", 3, ".", 5, "."], { rate: "1/8", root: "D", scale: "Dorian", octave: -2, shape: 0.15, env: { decay: 0.3, sustain: 0.4 } });
  const pad = p.add("oscillator", [0, 7], { octave: "-1", coarse: 2, shape: 0.5 }, { name: "Pad" });
  const padv = p.add("vca", [1, 7], { gain: 0.3 }, { name: "Pad Level" });
  p.cable(pad, "out", padv, "l").cable(pad, "out", padv, "r");
  finish(p, [4, 0], [[kick, "out"], [hat, "out"], [clap, "out"], [tom, "out"]], { levels: [-4, -12, -8, -6], pans: [0, 0.4, -0.3, 0.3], sends: [-30, -20, -8, -10], decay: 1.8, master: -3 });
  // bass and pad into a second small mixer feeding the same outputs would double-count; keep them on the reverb via their own mixer
  const m2 = p.add("audio-mixer", [5, 3], { level1: -6, level2: -16, master: -3 }, { name: "Bass+Pad" });
  p.cable(bass.amp, "l", m2, "in1l").cable(bass.amp, "l", m2, "in1r").cable(padv, "l", m2, "in2l").cable(padv, "r", m2, "in2r");
  p.stereo(m2, p.out, { from: ["outl", "outr"] });
  return p;
}

function clockChop() {
  const p = patch("Quad LFO: Clock Chop", {
    module: "quad-lfo", tempo: 104,
    description: "A sequencer's step trigger is patched into Clock: LFO 1 runs one cycle per Clock Ratio pulses, here two, and a square wave chops a sustained saw chord on that grid while LFO 2 sweeps the filter. Change Clock Ratio or Pulse Width to change the rhythm of the chop.",
    tags: ["clock", "chop", "gate", "rhythmic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "E", scale: "Natural Minor", octave: -1, gatelength: 0.9 },
    { data: steps([0, 0, 7, 0, 5, 0, 3, 7]) });
  const q = p.add("quad-lfo", [1, 1], { mode: "Free", clockratio: "2", wave1: "Square", wave2: "Triangle", pw: 0.35, polarity: "Unipolar", rate2: 0.12, level3: 0, level4: 0 });
  p.cable(seq, "trigger", q, "clock");
  const chordOscs = [0, 7, 12].map((s, i) => {
    const o = p.add("oscillator", [1, i], { coarse: s % 12, octave: s >= 12 ? "0" : "-1", shape: 0.85, fine: i * 5 - 5 }, { name: `Saw ${i + 1}` });
    return o;
  });
  const m = p.add("audio-mixer", [2, 0], { level1: -8, level2: -8, level3: -8, master: 0 }, { name: "Chord" });
  chordOscs.forEach((o, i) => p.cable(o, "out", m, `in${i + 1}l`).cable(o, "out", m, `in${i + 1}r`));
  const flt = p.add("filter", [3, 0], { cutoff: 1000, resonance: 0.3 }, { name: "Sweep" });
  const vca = p.add("vca", [4, 0], {}, { name: "Chop" });
  p.cable(m, "outl", flt, "l").cable(m, "outr", flt, "r").cable(flt, "l", vca, "l").cable(flt, "r", vca, "r");
  p.cable(q, "out1", vca, "gain").cable(q, "out2", flt, "cutoff", 0.5);
  const drums = beat(p, [0, 4], { style: "sparse", level: -8 });
  finish(p, [5, 0], [[vca, "l", "r"], [drums, "outl", "outr"]], { levels: [0, -2], sends: [-10, -24], decay: 2 });
  return p;
}

export default [circularPan, polyrhythmPlucks, chordBreath, cycleDrums, clockChop];
