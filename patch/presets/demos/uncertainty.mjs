// SPDX-License-Identifier: MIT
// Uncertainty: five demo patches. Each plays by itself with the transport.
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

const same = (n) => new Array(n).fill(0);

function randomMelody() {
  const p = patch("Uncertainty: Random Melody", {
    module: "uncertainty", tempo: 104,
    description: "Quantized 1 jumps between eight levels two semitones apart on every sixteenth, and a quantizer pulls them into D minor pentatonic: a small random vocabulary the ear hears as a tune. Lower Q1 Bits for fewer notes, or change Q1 Interval and Seed for a different melody.",
    tags: ["random", "melody", "quantized", "pentatonic"],
  });
  const m = melody(p, [0, 0], same(16), { rate: "1/16", root: "D", scale: "Minor Pentatonic", octave: 0, shape: 0.7, gatelength: 0.55, env: { decay: 0.18, sustain: 0.15 } });
  const un = p.add("uncertainty", [0, 3], { q1bits: 3, q1interval: "2 st", seed: 11 });
  const qz = p.add("quantizer", [2, 3], { root: "D", scale: "Minor Pentatonic" });
  p.cable(m.seq, "trigger", un, "clockq1").cable(un, "quant1", qz, "in").cable(m.seq, "trigger", qz, "clock").cable(qz, "out", m.osc, "pitch");
  const bass = melody(p, [0, 5], [0, ".", ".", ".", 0, ".", 7, "."], { rate: "1/4", root: "D", scale: "Minor Pentatonic", octave: -2, shape: 0.2, env: { decay: 0.5, sustain: 0.3 } });
  const dl = p.add("delay-network", [3, 0], { sync: "1/8.", taps: 2, feedback: 0.35, mix: 0.35, tone: -0.2 }, { name: "Echo" });
  p.cable(m.amp, "l", dl, "l").cable(m.amp, "l", dl, "r");
  finish(p, [4, 0], [[dl, "l", "r"], [bass.amp, "l"]], { levels: [-2, -4], sends: [-8, -22], decay: 2.5, master: 0 });
  return p;
}

function fluctuatingPad() {
  const p = patch("Uncertainty: Drifting Pad", {
    module: "uncertainty", tempo: 62,
    description: "The two Fluctuating outputs are smooth random curves with different speeds: one opens and closes the filters of a four-voice chord, the other pans the voices together and bends their waveform. Nothing repeats. Raise F1 Rate or F2 Rate for a busier shimmer, or lower F1 Spread for a calmer pad.",
    tags: ["fluctuating", "pad", "slow", "ambient"],
  });
  const un = p.add("uncertainty", [0, 0], { f1rate: 0.13, f2rate: 0.07, f1spread: 0.9, f2spread: 0.8, seed: 31 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -9, level2: -9, level3: -9, level4: -9, pan1: -0.5, pan2: -0.2, pan3: 0.2, pan4: 0.5, send1: -8, send2: -8, send3: -8, send4: -8, return: -4, master: -2 }, { name: "Mix" });
  [0, 4, 7, 11].forEach((s, i) => {
    const o = p.add("oscillator", [1, i], { coarse: s, octave: "-1", shape: 0.8, fine: (i - 1.5) * 5 }, { name: `Voice ${i + 1}` });
    const f = p.add("filter", [2, i], { cutoff: 700, resonance: 0.3 }, { name: `Filter ${i + 1}` });
    p.cable(o, "out", f, "l").cable(un, i % 2 ? "fluct2" : "fluct1", f, "cutoff", 0.5).cable(un, i % 2 ? "fluct1" : "fluct2", o, "shape", 0.2);
    p.cable(f, "l", mix, `in${i + 1}l`).cable(f, "l", mix, `in${i + 1}r`);
  });
  p.cable(un, "fluct2", mix, "pan2", 0.6).cable(un, "fluct1", mix, "pan3", 0.6);
  const verb = p.add("reverb", [4, 0], { size: 0.8, decay: 6, mix: 1, quality: "Eco (8 lines)" }, { name: "Hall" });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").cable(verb, "l", mix, "returnl").cable(verb, "r", mix, "returnr");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function randomSweeps() {
  const p = patch("Uncertainty: Random Sweeps", {
    module: "uncertainty", tempo: 112,
    description: "Stored takes a new value every half note and Correlation keeps each close to the last; Integrated turns that into long random sweeps that open and close the filter of a saw arpeggio. A one-bit Quantized 2 switches the hats on and off. Change Correlation to make the sweeps longer or jitterier.",
    tags: ["integrated", "sweeps", "correlation", "filter"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3, 0, 5, 8, 12, 15, 12, 8, 5], { rate: "1/16", root: "A", scale: "Natural Minor", octave: -1, shape: 1, env: { decay: 0.14, sustain: 0.1 } });
  const un = p.add("uncertainty", [0, 3], { correlation: 0.65, integrate: 1.8, storesync: "1/2", q2bits: 1, q2interval: "Even", q2divide: "/4", qsync: "1/16", shape: "Bell", seed: 5 });
  const flt = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.4 }, { name: "Sweeper" });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r").cable(un, "integrated", flt, "cutoff", 0.9);
  const drums = beat(p, [0, 5], { style: "half", level: -8 });
  const hats = p.add("punch-hats", [3, 5], { level: 0.45, tone: 0.65 });
  const hvca = p.add("vca", [4, 5], {}, { name: "Hat Switch" });
  const hseq = p.add("step-sequencer", [3, 6], { length: 16, rate: "1/16", gatelength: 0.3 }, { data: steps([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
  p.cable(hseq, "gate", hats, "closed").cable(hats, "out", hvca, "l").cable(hats, "out", hvca, "r").cable(un, "quant2", hvca, "gain");
  finish(p, [5, 0], [[flt, "l", "r"], [drums, "outl", "outr"], [hvca, "l", "r"]], { levels: [-6, -7, -11], pans: [0, 0, 0.3], sends: [-9, -24, -16], decay: 2, master: 0 });
  p.cable(un, "stored", flt, "resonance", 0.15);
  return p;
}

function randomOctaves() {
  const p = patch("Uncertainty: Random Octaves", {
    module: "uncertainty", tempo: 124,
    description: "A fixed riff plays while two Uncertainty quantizers decorate it: Quantized 2 with Interval 12 sends each note to one of four octaves, and a one-bit Quantized 1 on Interval 7 adds a fifth now and then. Try Q2 Bits 1 for a plain octave jump or Q2 Divide /1 for a new octave on every note.",
    tags: ["octaves", "riff", "leaps", "random"],
  });
  const m = melody(p, [0, 0], [0, 0, 3, 0, 5, 0, 7, 3, 0, 0, 10, 0, 7, 5, 3, 5], { rate: "1/8", root: "E", scale: "Natural Minor", octave: -2, shape: 0.6, gatelength: 0.5, env: { decay: 0.2, sustain: 0.25 } });
  const un = p.add("uncertainty", [0, 3], { q1bits: 1, q1interval: "7 st", q2bits: 2, q2interval: "12 st", q2divide: "/2", seed: 23 });
  const flt = p.add("filter", [3, 0], { cutoff: 2200, resonance: 0.2 }, { name: "Tone" });
  p.cable(m.seq, "trigger", un, "clockq1").cable(un, "quant1", m.osc, "pitch", 1).cable(un, "quant2", m.osc, "pitch", 1);
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r");
  const drums = beat(p, [0, 5], { style: "four", level: -9 });
  finish(p, [4, 0], [[flt, "l", "r"], [drums, "outl", "outr"]], { levels: [-4, -2], sends: [-12, -26], decay: 1.8, master: 0 });
  return p;
}

function drunkenWalk() {
  const p = patch("Uncertainty: Drunken Walk", {
    module: "uncertainty", tempo: 78,
    description: "Stored picks a new value on every step and with Correlation at +85 % each is close to the last, so the pitch wanders up and down like a drunken walk; a quantizer keeps it in F Lydian and pinged low pass gates turn each step into a bell. Try Correlation negative for a zig-zag, or the Shape set to Edges.",
    tags: ["stored", "correlation", "walk", "bells"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", gatelength: 0.3 }, { data: steps(same(8)) });
  const un = p.add("uncertainty", [1, 0], { correlation: 0.85, distribution: 0, storerate: 2, storesync: "1/8", shape: "Bell", seed: 3 });
  const qz = p.add("quantizer", [2, 0], { root: "F", scale: "Lydian", range: 1.2 });
  p.cable(seq, "trigger", un, "store").cable(un, "stored", qz, "in").cable(un, "storetrig", qz, "clock");
  const bell = p.add("oscillator", [3, 0], { shape: 0.05, octave: "0" }, { name: "Bell" });
  const lpg = p.add("low-pass-gate", [4, 0], { response: 0.5, ping: 0.9, brightness: 0.6 }, { name: "Strike" });
  const sub = p.add("oscillator", [3, 1], { shape: 0.1, octave: "-1" }, { name: "Echo Bell" });
  const lpg2 = p.add("low-pass-gate", [4, 1], { response: 0.7, ping: 0.8, brightness: 0.35 }, { name: "Soft Strike" });
  p.cable(qz, "out", bell, "pitch").cable(qz, "out", sub, "pitch").cable(bell, "out", lpg, "l").cable(bell, "out", lpg, "r").cable(sub, "out", lpg2, "l").cable(sub, "out", lpg2, "r");
  p.cable(seq, "trigger", lpg, "ping").cable(un, "storetrig", lpg2, "ping");
  const dl = p.add("delay-network", [5, 0], { sync: "1/4.", taps: 3, feedback: 0.5, mix: 0.5, tone: -0.1 }, { name: "Echoes" });
  p.cable(lpg, "l", dl, "l").cable(lpg, "r", dl, "r");
  finish(p, [6, 0], [[dl, "l", "r"], [lpg2, "l", "r"]], { levels: [3, 0], pans: [0, 0], sends: [-6, -8], decay: 5, master: 0 });
  return p;
}

export default [randomMelody, fluctuatingPad, randomSweeps, randomOctaves, drunkenWalk];
