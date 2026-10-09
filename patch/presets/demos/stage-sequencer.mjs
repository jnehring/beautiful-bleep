// SPDX-License-Identifier: MIT
// Stage Seq: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// Stage Seq stages: [semitones, pulses, gate, opts]; gate is Rest/First/Every/Hold/Ratchet,
/// opts {r: ratchets, slide, accent, v: velocity}.
const GATES = ["Rest", "First", "Every", "Hold", "Ratchet"];
function stages(list) {
  return {
    stages: list.map(([pitch, n, g, o = {}]) => ({ p: pitch, n, g: GATES.indexOf(g), r: o.r || 2, s: o.slide ? 1 : 0, v: o.v || 100, a: o.accent ? 1 : 0 })),
    randomize: { lanes: ["pitch", "pulses", "gate"], octaves: 1, maxPulses: 4, slide: 0.15, accent: 0.15 },
  };
}

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

function staircaseLead() {
  const p = patch("Stage Seq: Staircase Lead", {
    module: "stage-sequencer", tempo: 110,
    description: "Eight stages of C harmonic minor: held notes, repeats, a ratchet and two slides make a one-bar riff, with louder accented stages. Change a stage's Pulses or Gate mode in the view, or raise Slide Time to melt the slides further.",
    tags: ["lead", "riff", "slide", "harmonic minor"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.6, slidetime: 0.07, accent: 0.6, stages: 8, rate: "1/16", root: "C", scale: "Harmonic Minor", octave: 0 }, {
    data: stages([
      [0, 3, "Hold", { accent: true, v: 115 }],
      [0, 1, "Every", { v: 80 }],
      [7, 2, "First"],
      [8, 1, "Every", { slide: true }],
      [7, 2, "Ratchet", { r: 3, v: 90 }],
      [3, 2, "Hold", { accent: true, v: 115 }],
      [2, 1, "Every", { v: 85 }],
      [-1, 4, "Hold", { slide: true }],
    ]),
  });
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger", velocity: "velocity" }, { name: "Lead", osc: { shape: 0.88 },
    env: { decay: 0.2, sustain: 0.6, release: 0.15 }, filter: { cutoff: 1800, resonance: 0.3, drive: 0.15 } });
  const accentEnv = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.25, sustain: 0, release: 0.1 }, { name: "Accent Env" });
  p.cable(seq, "accentgate", accentEnv, "gate").cable(accentEnv, "env", v.filter, "cutoff", 0.45);
  space(p, [4, 0], v.out, "l", { level: 0, delay: { zone: 3, time: 0.4, feedback: 0.4, mix: 0.3, tone: -0.2 }, verb: { size: 0.45, decay: 1.8, mix: 0.2 } });
  return p;
}

function pendulumPad() {
  const p = patch("Stage Seq: Pendulum Pad", {
    module: "stage-sequencer", tempo: 64,
    description: "Pendulum mode swings back and forth across six stages of long held notes in F Lydian, each lasting four to eight pulses; a pair of detuned oscillators and a slowly opening filter turn the chord-like line into a pad. Change Mode to Forward or Reverse, or shorten the Pulses.",
    tags: ["pad", "pendulum", "lydian", "slow"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 1, stages: 6, rate: "1/8", mode: "Pendulum", root: "F", scale: "Lydian", octave: -1, slidetime: 0.4 }, {
    data: stages([
      [0, 8, "Hold"], [7, 6, "Hold", { slide: true }], [11, 8, "Hold"], [16, 4, "Hold", { slide: true }], [14, 6, "Hold"], [9, 8, "Hold", { slide: true }],
    ]),
  });
  const pad = voice(p, [1, 0], { node: seq }, { name: "Pad A", osc: { shape: 0.7, fine: -7 },
    env: { attack: 1.2, decay: 1, sustain: 0.8, release: 3 } });
  const b = p.add("oscillator", [1, 2], { shape: 0.7, fine: 7, octave: "+1" }, { name: "Pad B" });
  const bamp = p.add("vca", [2, 2], {}, { name: "Pad B VCA" });
  p.cable(seq, "pitch", b, "pitch").cable(b, "out", bamp, "l").cable(pad.env, "env", bamp, "gain");
  const mix = p.add("audio-mixer", [3, 0], { level1: -6, level2: -12, master: 0, limiter: false }, { name: "Pad Mix" });
  p.cable(pad.out, "l", mix, "in1l").cable(bamp, "l", mix, "in2l");
  const filt = p.add("filter", [4, 0], { cutoff: 700, resonance: 0.2, type: "SVF Multimode" }, { name: "Pad Filter" });
  const open = p.add("lfo", [4, 2], { rate: 0.05, polarity: "Unipolar", wave: "Triangle" }, { name: "Opening" });
  p.stereo(mix, filt, { from: ["outl", "outr"] }).cable(open, "out", filt, "cutoff", 0.5).cable(seq, "stage", filt, "cutoff", 0.2);
  const verb = p.add("reverb", [5, 0], { size: 0.9, decay: 8, mix: 0.45, modDepth: 0.4 });
  p.stereo(filt, verb).stereo(verb, p.out);
  return p;
}

function brownianBells() {
  const p = patch("Stage Seq: Brownian Bells", {
    module: "stage-sequencer", tempo: 80,
    description: "Brownian mode takes one stage up or down at a time, so the sixteen-stage bell melody in D major pentatonic wanders like a drunk on a staircase and always returns to the same neighbours. Change the Seed, or switch Mode to Random, to hear a different walk.",
    tags: ["brownian", "bells", "generative", "pentatonic"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.4, stages: 16, rate: "1/8", mode: "Brownian", root: "D", scale: "Major Pentatonic", octave: 0, seed: 11, phrase: "8 bars" }, {
    data: stages([
      [0, 1, "Every"], [2, 2, "Every"], [4, 1, "Every"], [7, 1, "Ratchet", { r: 2 }], [9, 2, "Every", { accent: true }], [12, 1, "Every"], [14, 1, "Every"], [16, 2, "Every", { accent: true }],
      [14, 1, "Every"], [12, 1, "First"], [9, 2, "Every"], [7, 1, "Every"], [4, 2, "Ratchet", { r: 3 }], [2, 1, "Every"], [0, 2, "Every", { accent: true }], [-3, 1, "Every"],
    ]),
  });
  const mix = p.add("audio-mixer", [3, 0], { level1: -13, send1: -6, return: -3, master: 0, limiter: false }, { name: "Bells" });
  const bell = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.7, geometry: 0.85, brightness: 0.7, damping: 0.18, position: 0.35, size: 0.3, space: 0.3 }, { name: "Bell" });
  p.cable(seq, "pitch", bell, "pitch").cable(seq, "trigger", bell, "strike").cable(seq, "velocity", bell, "velocity")
    .stereo(bell, mix, { to: ["in1l", "in1r"] });
  const delay = p.add("zone-delay", [2, 1], { zone: 3, time: 0.45, feedback: 0.5, character: 0.3, tone: -0.3, mix: 1 });
  const verb = p.add("reverb", [3, 1], { size: 0.85, decay: 6, mix: 1 });
  p.cable(mix, "sendl", delay, "l").cable(mix, "sendr", delay, "r").stereo(delay, verb).stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function slideBass() {
  const p = patch("Stage Seq: Slide Bass", {
    module: "stage-sequencer", tempo: 120,
    description: "A reversed run of E minor stages with slides between stages and accents that fire the Accent Gate: it opens the filter with an extra snap on the accented stages. Turn Accent or Slide Time to change the squelch, or add pulses to a stage to lengthen it.",
    tags: ["bass", "slide", "accent", "reverse"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.6, slidetime: 0.09, accent: 0.8, stages: 8, rate: "1/16", mode: "Reverse", root: "E", scale: "Natural Minor", octave: -2 }, {
    data: stages([
      [0, 2, "Every", { accent: true }], [0, 1, "Every"], [12, 2, "Hold", { slide: true }], [10, 1, "Every", { slide: true }],
      [7, 2, "Hold", { accent: true }], [5, 1, "Every", { slide: true }], [3, 2, "Ratchet", { r: 2 }], [7, 3, "Hold", { slide: true, accent: true }],
    ]),
  });
  const bass = voice(p, [1, 0], { node: seq, trigger: "trigger", velocity: "velocity" }, { name: "Bass", osc: { shape: 0.95 },
    env: { decay: 0.25, sustain: 0.6, release: 0.08 }, filter: { cutoff: 360, resonance: 0.5, drive: 0.25 } });
  const snap = p.add("adsr", [1, 2], { attack: 0.002, decay: 0.18, sustain: 0, release: 0.1 }, { name: "Accent Snap" });
  p.cable(seq, "accentgate", snap, "gate").cable(snap, "env", bass.filter, "cutoff", 0.6);
  const drums = beat(p, [0, 4], { style: "broken", level: -9 });
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -3, master: -2 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [6, 0], { size: 0.3, decay: 1, mix: 0.1 });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function holdFreeze() {
  const p = patch("Stage Seq: Hold Freeze", {
    module: "stage-sequencer", tempo: 98,
    description: "Random mode with a two-bar Phrase: ten A Dorian stages come in a shuffled order that repeats every phrase. A square LFO on the Hold input freezes the sequence on one stage for a bar, and the Stage output sweeps the filter. Try a longer Phrase, or hold Hold yourself.",
    tags: ["random", "hold", "phrase", "dorian"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.5, stages: 10, rate: "1/8", mode: "Random", phrase: "2 bars", root: "A", scale: "Dorian", octave: 0, seed: 21 }, {
    data: stages([
      [0, 1, "Every"], [2, 1, "Every", { accent: true }], [3, 2, "Hold"], [7, 1, "Every"], [9, 1, "Ratchet", { r: 2 }],
      [10, 2, "Hold", { accent: true }], [12, 1, "Every"], [14, 1, "Every"], [5, 1, "Every"], [7, 2, "First"],
    ]),
  });
  const freeze = p.add("lfo", [0, 2], { wave: "Square", sync: "8 bars", pw: 0.15, phase: 300, polarity: "Unipolar" }, { name: "Freeze" });
  p.cable(freeze, "out", seq, "hold");
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger", velocity: "velocity" }, { name: "Keys", osc: { shape: 0.35 },
    env: { decay: 0.4, sustain: 0.25, release: 0.4 }, filter: { cutoff: 900, resonance: 0.3 } });
  p.cable(seq, "stage", v.filter, "cutoff", 0.45);
  space(p, [4, 0], v.out, "l", { level: 3, delay: { zone: 3, time: 0.5, feedback: 0.45, mix: 0.35, tone: -0.25 }, verb: { size: 0.6, decay: 3.5, mix: 0.3 } });
  return p;
}

export default [staircaseLead, pendulumPad, brownianBells, slideBass, holdFreeze];
