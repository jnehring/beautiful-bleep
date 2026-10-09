// SPDX-License-Identifier: MIT
// Polymeter Seq: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

const NEUTRAL = { trig: 1, note: 0, oct: 0, gate: 50, prob: 100, ratch: 1 };

/// One Polymeter Seq track as sanitiseData writes it. `values` are the steps (ratchets: a count or [count, shape]),
/// `div` one of x4 x3 x2 1 /2 /3 /4 /5 /6 /7 /8 /16 and `dir` one of fwd bwd pp rnd.
function track(key, values, div = "1", dir = "fwd") {
  const steps = [];
  for (let i = 0; i < 64; i++) {
    const v = i < values.length ? values[i] : NEUTRAL[key];
    steps.push(key === "ratch" ? (Array.isArray(v) ? v : [v, 0]) : v);
  }
  return { len: values.length, lo: 0, hi: values.length - 1, div, dir, mute: false, steps };
}

/// A pattern slot: `t` maps track keys to track(...) results; missing tracks are one neutral step.
const slot = (t) => ({ tracks: Object.fromEntries(["trig", "note", "oct", "gate", "prob", "ratch"].map((k) => [k, t[k] || track(k, [NEUTRAL[k]])])) });
const data = (slots) => ({ slot: 0, slots, randomize: { density: 0.5, degrees: [0, 7], stepwise: true, ratchet: 0.1 } });

/// Oscillator → ADSR → VCA from a pitch and gate source, optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger) p.cable(src.node, src.trigger, env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);

/// Mono source → level → optional delay → reverb → Out 1/2.
function space(p, at, from, jack, { level = 0, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: false }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    const d = p.add("zone-delay", [c, r], delay);
    p.stereo(m, d, { from: out });
    node = d; out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

function pentatonicCycles() {
  const p = patch("Polymeter Seq: Pentatonic Cycles", {
    module: "polymeter-sequencer", tempo: 92,
    description: "Rhythm 16, notes 5, octaves 7, gates 12 and chances 9 steps long: each track loops at its own length, so the soft A major pentatonic figure only repeats after hundreds of steps. Change one track's length in the view and the pattern re-weaves itself.",
    tags: ["polymeter", "pentatonic", "pluck", "evolving"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/8", root: "A", scale: "Major Pentatonic", velocity: 0.8, spread: 0.25, gatescale: 0.8, seed: 5 }, {
    data: data([slot({
      trig: track("trig", [2, 0, 1, 1, 0, 1, 2, 0, 1, 0, 1, 1, 0, 2, 1, 0]),
      note: track("note", [0, 2, 4, 1, 3]),
      oct: track("oct", [0, 0, 1, 0, 0, -1, 0]),
      gate: track("gate", [60, 40, 90, 40, 70, 40, 50, 80, 40, 60, 40, 90]),
      prob: track("prob", [100, 100, 85, 100, 70, 100, 100, 80, 100]),
    })]),
  });
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger", velocity: "velocity" }, { name: "Pluck", osc: { shape: 0.4 },
    env: { decay: 0.45, sustain: 0.2, release: 0.5 }, filter: { cutoff: 2800, resonance: 0.12 } });
  space(p, [4, 0], v.out, "l", { level: 4, delay: { zone: 3, time: 0.4, feedback: 0.5, character: 0.3, tone: -0.3, mix: 0.35 }, verb: { size: 0.65, decay: 4, mix: 0.35 } });
  return p;
}

function acidOddLengths() {
  const p = patch("Polymeter Seq: Acid Odd Lengths", {
    module: "polymeter-sequencer", tempo: 124,
    description: "An E Phrygian Dominant bass line from tracks of 13, 7, 5 and 11 steps, with ties for slides and a few ratchets, over a four-on-the-floor beat. Move Prob. Bias or Ratchet Amt to thin the line out or make it stutter.",
    tags: ["acid", "bass", "ties", "ratchet"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/16", root: "E", scale: "Phrygian Dominant", octave: -2, gatescale: 0.9, swing: 0.54, velocity: 0.75, spread: 0.3, seed: 9 }, {
    data: data([slot({
      trig: track("trig", [2, 1, 0, 1, 1, 0, 2, 1, 0, 1, 0, 1, 1]),
      note: track("note", [0, 0, 2, 0, 4, 1, 0]),
      oct: track("oct", [0, 0, 1, 0, 0]),
      gate: track("gate", [40, 40, -1, 30, 60, -1, 40, 30, 80, 40, 30]),
      prob: track("prob", [100, 100, 100, 90, 100, 75, 100, 100, 85, 100, 100]),
      ratch: track("ratch", [1, 1, 1, 1, 1, [2, 0], 1, 1, 1, 1, 1, 1, [3, 1], 1, 1]),
    })]),
  });
  const bass = voice(p, [1, 0], { node: seq, trigger: "trigger", velocity: "velocity" }, { name: "Acid", osc: { shape: 0.97 },
    env: { decay: 0.15, sustain: 0.55, release: 0.07 }, filter: { cutoff: 520, resonance: 0.5, drive: 0.3 } });
  const fenv = p.add("adsr", [1, 2], { attack: 0.002, decay: 0.22, sustain: 0.1, release: 0.1 }, { name: "Filter Env" });
  const sweep = p.add("lfo", [1, 3], { rate: 0.06, polarity: "Unipolar" }, { name: "Cutoff Drift" });
  p.cable(seq, "gate", fenv, "gate").cable(seq, "trigger", fenv, "retrig")
    .cable(fenv, "env", bass.filter, "cutoff", 0.5).cable(sweep, "out", bass.filter, "cutoff", 0.3);
  const drums = beat(p, [0, 4], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -3, master: -2 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [6, 0], { size: 0.3, decay: 1, mix: 0.1 });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function divisionDance() {
  const p = patch("Polymeter Seq: Division Dance", {
    module: "polymeter-sequencer", tempo: 96,
    description: "Each track runs at its own Division: triggers at double speed, notes at normal speed, octaves at half speed, gates ping-ponging and probability in thirds. A bright marimba line in D Dorian that keeps changing shape. Try other divisions on the tracks.",
    tags: ["division", "marimba", "dorian", "polyrhythm"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/8", root: "D", scale: "Dorian", octave: 0, velocity: 0.8, spread: 0.3, gatescale: 0.7 }, {
    data: data([slot({
      trig: track("trig", [2, 1, 0, 1, 1, 0, 1, 0], "x2"),
      note: track("note", [0, 2, 4, 6, 4, 2, 5, 3], "1"),
      oct: track("oct", [0, 0, 1, 0], "/2"),
      gate: track("gate", [50, 30, 70, 30, 40], "1", "pp"),
      prob: track("prob", [100, 100, 80, 100, 100, 70], "/3"),
    })]),
  });
  const mallet = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.55, geometry: 0.3, brightness: 0.6, damping: 0.5, position: 0.3,
    size: 0.35, space: 0.2 }, { name: "Marimba" });
  p.cable(seq, "pitch", mallet, "pitch").cable(seq, "trigger", mallet, "strike").cable(seq, "velocity", mallet, "velocity");
  const lvl = p.add("audio-mixer", [2, 0], { level1: -9, master: 0, limiter: false }, { name: "Level" });
  const verb = p.add("reverb", [3, 0], { size: 0.5, decay: 2.2, mix: 0.3 });
  p.stereo(mallet, lvl, { to: ["in1l", "in1r"] }).stereo(lvl, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function patternSlots() {
  const p = patch("Polymeter Seq: Pattern Slots", {
    module: "polymeter-sequencer", tempo: 100,
    description: "Three stored patterns with different track lengths share one voice. A slow saw LFO on the Pattern input moves from slot to slot on the next bar, so the tune changes character every few bars. Click a slot in the view to hear it alone.",
    tags: ["pattern slots", "changes", "lead", "arrangement"],
  });
  const lead = (notes, trigs, probs) => slot({
    trig: track("trig", trigs), note: track("note", notes),
    oct: track("oct", [0, 0, 0, 1, 0]), gate: track("gate", [60, 40, 70, 40]), prob: track("prob", probs),
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/8", root: "G", scale: "Mixolydian", slots: 3, patternchange: "Next bar", velocity: 0.8, spread: 0.2 }, {
    data: data([
      lead([0, 2, 4, 2, 5, 4, 2, 1], [2, 1, 0, 1, 2, 0, 1, 1], [100]),
      lead([4, 5, 4, 2, 0, 2, 1, 0, 3], [2, 0, 1, 1, 0, 1, 2, 1, 0], [100, 100, 80]),
      lead([0, 4, 6, 4, 7, 6, 4, 2], [2, 1, 1, 0, 1, 2, 0, 1], [100, 90]),
    ]),
  });
  const slotLfo = p.add("lfo", [0, 2], { wave: "Saw Up", sync: "4 bars", polarity: "Unipolar" }, { name: "Slot Walk" });
  p.cable(slotLfo, "out", seq, "pattern");
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger", velocity: "velocity" }, { name: "Lead", osc: { shape: 0.7 },
    env: { decay: 0.3, sustain: 0.25, release: 0.3 }, filter: { cutoff: 2200, resonance: 0.2 } });
  space(p, [4, 0], v.out, "l", { level: 4, delay: { zone: 3, time: 0.35, feedback: 0.4, mix: 0.3 }, verb: { size: 0.5, decay: 2.5, mix: 0.25 } });
  return p;
}

function glassShower() {
  const p = patch("Polymeter Seq: Glass Shower", {
    module: "polymeter-sequencer", tempo: 70,
    description: "Sparse, probability-driven bursts of high notes over a slow drone: ratchets turn single notes into showers, and a slow LFO on Prob. Bias keeps the density rising and falling. Turn Ratchet Amt down for plain notes, or up for more rain.",
    tags: ["probability", "ratchet", "ambient", "bells"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/16", root: "C", scale: "Major Pentatonic", octave: 1, velocity: 0.7, spread: 0.5,
    probbias: -0.2, ratchetamt: 0.8, gatescale: 0.5, seed: 17 }, {
    data: data([slot({
      trig: track("trig", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      note: track("note", [0, 2, 4, 1, 3, 5, 2, 4]),
      oct: track("oct", [0, 1, 0, 0, 1, -1]),
      gate: track("gate", [30, 40, 25, 50, 30]),
      prob: track("prob", [60, 35, 80, 25, 50, 70, 30, 55, 40, 90, 20, 45, 65]),
      ratch: track("ratch", [1, 1, [3, 1], 1, 1, [2, 0], 1, [4, 1], 1, 1, 1]),
    })]),
  });
  const bias = p.add("lfo", [0, 2], { rate: 0.04, polarity: "Bipolar" }, { name: "Density Drift" });
  p.cable(bias, "out", seq, "probbias", 0.6);
  const bells = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.75, geometry: 0.85, brightness: 0.7, damping: 0.15, position: 0.4,
    size: 0.3, space: 0.3 }, { name: "Glass" });
  p.cable(seq, "pitch", bells, "pitch").cable(seq, "trigger", bells, "strike").cable(seq, "velocity", bells, "velocity");
  const d1 = p.add("oscillator", [1, 2], { shape: 0.1, octave: "-1", fine: -6 }, { name: "Drone Root" });
  const d2 = p.add("oscillator", [1, 3], { shape: 0.1, octave: "-1", coarse: 7, fine: 5 }, { name: "Drone Fifth" });
  const swell = p.add("lfo", [2, 3], { rate: 0.03, polarity: "Unipolar", wave: "Triangle" }, { name: "Drone Swell" });
  const dv = p.add("vca", [3, 2], {}, { name: "Drone VCA" });
  const dmix = p.add("audio-mixer", [2, 2], { level1: -8, level2: -10 }, { name: "Drone Mix" });
  p.cable(d1, "out", dmix, "in1l").cable(d2, "out", dmix, "in2l");
  p.stereo(dmix, dv, { from: ["outl", "outr"] }).cable(swell, "out", dv, "gain", 0.7);
  const mix = p.add("audio-mixer", [3, 0], { level1: -4, level2: -2, send1: -8, return: -3, master: -11 }, { name: "Mix" });
  p.stereo(bells, mix, { to: ["in1l", "in1r"] }).stereo(dv, mix, { to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [4, 1], { size: 0.85, decay: 7, mix: 1 });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [pentatonicCycles, acidOddLengths, divisionDance, patternSlots, glassShower];
