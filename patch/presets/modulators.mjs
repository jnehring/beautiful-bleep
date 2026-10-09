// SPDX-License-Identifier: MIT
// Modulators: cells of control, gate and trigger outputs to move things on the board.
import { cell, category, raw } from "./kit.mjs";

// Quad LFO / Segments helpers: a synced Rate knob on the shared note-value
// list (16 bars … 1/32T), and Segments node data (types, loop and wait flags).
const NOTE_VALUES = ["16 bars", "8 bars", "4 bars", "2 bars", "1/1.", "1/1", "1/1T", "1/2.", "1/2", "1/2T", "1/4.",
                     "1/4", "1/4T", "1/8.", "1/8", "1/8T", "1/16.", "1/16", "1/16T", "1/32.", "1/32", "1/32T"];
const quadNote = (name) => raw(NOTE_VALUES.indexOf(name) / (NOTE_VALUES.length - 1));
function segmentData(defs) {
  const segments = [];
  for (let i = 0; i < 8; i++) {
    const d = defs[i] || {};
    segments.push({ type: d.type || "ramp", loop: !!d.loop, wait: d.wait || "gate", segIn: "advance", sync: "1/4" });
  }
  return { segments };
}

// Quad LFO dividing one bar into four related tempo-locked movements.
function tempoQuartet() {
  const p = cell("Tempo Quartet", {
    description: "Four tempo-locked LFOs from one Quad LFO, at a quarter, a half, one and two bars: sines and triangles that always meet on the downbeat. Shared input Hold.",
    tags: ["lfo", "tempo", "sync", "quad"],
  }).input("hold", "Hold", "gate")
    .output("q", "1/4", "control").output("h", "1/2", "control").output("b1", "1 Bar", "control").output("b2", "2 Bars", "control");
  const q = p.add("quad-lfo", [0, 0], { mode: "Divide", sync: true, rate1: quadNote("1/1"),
                                        divide1: "×4", divide2: "×2", divide3: "÷1", divide4: "÷2",
                                        wave1: "Sine", wave2: "Triangle", wave3: "Sine", wave4: "Triangle" });
  p.cable(p.cin, "hold", q, "hold")
    .cable(q, "out1", p.cout, "q").cable(q, "out2", p.cout, "h").cable(q, "out3", p.cout, "b1").cable(q, "out4", p.cout, "b2");
  return p;
}

// Organic LFOs: slow, related, never quite in step.
function driftPack() {
  const p = cell("Drift Pack", {
    description: "Four slow organic LFOs that wander like a living group, plus their sum: subtle analog drift for cutoffs, pans and detune. Shared input Speed.",
    tags: ["lfo", "organic", "slow", "drift", "ambient"],
  }).input("speed", "Speed")
    .output("d1", "Drift 1", "control").output("d2", "Drift 2", "control").output("d3", "Drift 3", "control")
    .output("d4", "Drift 4", "control").output("sum", "Sum", "control");
  const o = p.add("organic-lfos", [0, 0], { rate: 0.06, spread: 0.5, drift: 0.5, twist: 0.2 });
  p.cable(p.cin, "speed", o, "rate", 0.3)
    .cable(o, "out1", p.cout, "d1").cable(o, "out2", p.cout, "d2").cable(o, "out3", p.cout, "d3")
    .cable(o, "out4", p.cout, "d4").cable(o, "sum", p.cout, "sum");
  return p;
}

// Wobble: one random stream as steps, glides and ringing overshoots.
function randomWalkers() {
  const p = cell("Random Walkers", {
    description: "One random stream on quarter notes in three shapes: stepped sample-and-hold, a smooth walk and a springy wobble, plus burst triggers. Shared input Clock.",
    tags: ["random", "sample and hold", "smooth", "tempo"],
  }).input("clock", "Clock", "trigger")
    .output("step", "Stepped", "control").output("smooth", "Smooth", "control").output("wob", "Wobble", "control")
    .output("burst", "Burst", "trigger");
  const w = p.add("wobble", [0, 0], { sync: "1/4", smooth: 0.6, wobble: 0.5, chaos: 0.15, burst: 0.2 });
  p.cable(p.cin, "clock", w, "clock")
    .cable(w, "stepped", p.cout, "step").cable(w, "smooth", p.cout, "smooth").cable(w, "wobble", p.cout, "wob")
    .cable(w, "burst", p.cout, "burst");
  return p;
}

// Tidal looping over two bars, four phase-offset copies.
function tideCycler() {
  const p = cell("Tide Cycler", {
    description: "A Tidal slope looping every two bars with a slow rise and quick fall, in four phase-shifted copies for staggered swells. Shared inputs Restart and Skew.",
    tags: ["envelope", "cycle", "tempo", "slope"],
  }).input("restart", "Restart", "gate").input("skew", "Skew")
    .output("a", "Tide A", "control").output("b", "Tide B", "control").output("c", "Tide C", "control")
    .output("d", "Tide D", "control").output("end", "End", "trigger");
  const t = p.add("tidal", [0, 0], { sync: "2 bars", skew: 0.75, curve: 0.3, smooth: 0.3, spread: 0.5,
                                     relation: "Phase", polarity: "Unipolar", range: "Slow" });
  p.cable(p.cin, "restart", t, "trig").cable(p.cin, "skew", t, "skew", 0.4)
    .cable(t, "a", p.cout, "a").cable(t, "b", p.cout, "b").cable(t, "c", p.cout, "c").cable(t, "d", p.cout, "d")
    .cable(t, "end", p.cout, "end");
  return p;
}

// A triggered six-second swell next to a looping two-bar breath.
function breathAndBloom() {
  const p = cell("Breath & Bloom", {
    description: "A two-bar breathing loop that never stops, and a six-second exponential swell each time Trigger fires: slow movement for pads and drones.",
    tags: ["envelope", "swell", "slow", "breathing"],
  }).input("trig", "Trigger", "trigger")
    .output("breath", "Breath", "control").output("bloom", "Bloom", "control").output("fade", "Fade", "control")
    .output("end", "Bloom End", "trigger");
  const br = p.add("shape-env", [0, 0], { shape: "Breathing", mode: "Loop", sync: "2 bars" }, { name: "Breath" });
  const bl = p.add("shape-env", [0, 1], { shape: "Exp swell", mode: "One-shot", time: 6 }, { name: "Bloom" });
  p.cable(p.cin, "trig", bl, "trig")
    .cable(br, "out", p.cout, "breath").cable(bl, "out", p.cout, "bloom").cable(bl, "inv", p.cout, "fade")
    .cable(bl, "end", p.cout, "end");
  return p;
}

// Uncertainty: fluctuating curves, quantized steps and a stored value.
function fogOfChance() {
  const p = cell("Fog of Chance", {
    description: "Six-way randomness from Uncertainty: two slow fluctuating curves, eighth-note quantized steps in fifths and a bell-shaped value stored every half note. Shared input Clock.",
    tags: ["random", "turing", "stepped", "tempo"],
  }).input("clock", "Clock", "trigger")
    .output("f1", "Fluct 1", "control").output("f2", "Fluct 2", "control").output("q1", "Steps", "control")
    .output("st", "Stored", "control").output("stt", "Store Trig", "trigger");
  const u = p.add("uncertainty", [0, 0], { f1rate: 0.3, f2rate: 0.11, qsync: "1/8", storesync: "1/2",
                                           q1interval: "7 st", shape: "Bell", correlation: 0.5 });
  p.cable(p.cin, "clock", u, "clockq1")
    .cable(u, "fluct1", p.cout, "f1").cable(u, "fluct2", p.cout, "f2").cable(u, "quant1", p.cout, "q1")
    .cable(u, "stored", p.cout, "st").cable(u, "storetrig", p.cout, "stt");
  return p;
}

// Two firing neurons pushing each other: irregular gates and a saw.
function synapseGates() {
  const p = cell("Synapse Gates", {
    description: "Two leaky neurons that fire and inhibit each other: a steady gate, an irregular one, their XOR and A's charging ramp. Shared input Excite speeds them up.",
    tags: ["gates", "chaotic", "rhythm", "neuron"],
  }).input("excite", "Excite")
    .output("a", "Gate A", "gate").output("b", "Gate B", "gate").output("x", "XOR", "gate").output("ramp", "Ramp", "control");
  const n = p.add("neuron", [0, 0], { apulse: 0.06, bpulse: 0.04, aleak: 0.3 });
  p.cable(p.cin, "excite", n, "a2", 0.6).cable(p.cin, "excite", n, "b2", 0.4)
    .cable(n, "agate", p.cout, "a").cable(n, "bgate", p.cout, "b").cable(n, "xor", p.cout, "x").cable(n, "aout", p.cout, "ramp");
  return p;
}

// Segments: a snap, a dip, a slow rise, sustain, then a two-stage fade.
function contourChain() {
  const p = cell("Contour Chain", {
    description: "A six-stage Segments envelope on the Gate input: a snap up, a dip, a slow bloom to a held sustain, then a two-stage fall. Shared input Stretch scales every time.",
    tags: ["envelope", "multi-stage", "segments", "gate"],
  }).input("gate", "Gate", "gate").input("stretch", "Stretch")
    .output("out", "Contour", "control").output("inv", "Inverted", "control").output("end", "End", "trigger");
  const s = p.add("segments", [0, 0], {
    count: 6, release: "Jump",
    time1: 0.01, level1: 1, shape1: 0.5,
    time2: 0.25, level2: 0.35, shape2: 0.5,
    time3: 1.5, level3: 0.8, shape3: -0.4,
    time4: 1, level4: 0.8, shape4: 0,
    time5: 0.6, level5: 0.3, shape5: 0.5,
    time6: 2, level6: 0, shape6: 0.3,
  }, { data: segmentData([{ type: "ramp", wait: "time" }, { type: "ramp", wait: "time" }, { type: "ramp", wait: "time" },
                          { type: "hold", wait: "gate" }, { type: "ramp", wait: "time" }, { type: "ramp", wait: "time" }]) });
  p.cable(p.cin, "gate", s, "gate").cable(p.cin, "stretch", s, "timescale", 0.3)
    .cable(s, "out", p.cout, "out").cable(s, "inv", p.cout, "inv").cable(s, "end", p.cout, "end");
  return p;
}

// Sixteenth and eighth clocks through weighted coins, AND for accents.
function coinFlipRhythm() {
  const p = cell("Coin Flip Rhythm", {
    description: "Sixteenth and eighth clocks through weighted coins that repeat every 16 tosses: two probabilistic gate streams and the accents where both land. Shared input Chance.",
    tags: ["gates", "probability", "rhythm", "tempo"],
  }).input("chance", "Chance")
    .output("s16", "Sixteenths", "gate").output("s8", "Eighths", "gate").output("acc", "Accents", "gate");
  const c16 = p.add("lfo", [0, 0], { wave: "Square", sync: "1/16", polarity: "Unipolar", pw: 0.4 }, { name: "Clock 1/16" });
  const c8 = p.add("lfo", [0, 1], { wave: "Square", sync: "1/8", polarity: "Unipolar", pw: 0.4 }, { name: "Clock 1/8" });
  const coin = p.add("coin-toss", [1, 0], { prob1: 0.35, prob2: 0.6, loop: "16 tosses", seed: 7 });
  const acc = p.add("logic", [2, 0], {}, { name: "Accents" });
  p.cable(c16, "out", coin, "in1").cable(c8, "out", coin, "in2")
    .cable(p.cin, "chance", coin, "prob1", 0.5).cable(p.cin, "chance", coin, "prob2", 0.5)
    .cable(coin, "a1", acc, "a").cable(coin, "a2", acc, "b")
    .cable(coin, "a1", p.cout, "s16").cable(coin, "a2", p.cout, "s8").cable(acc, "and", p.cout, "acc");
  return p;
}

// A four-bar rising saw, slewed, beside a four-bar up-and-down arc.
function fourBarArc() {
  const p = cell("Four-Bar Arc", {
    description: "Macro movement locked to the bars: a smoothed rise over four bars, an up-and-down arc over the same four, and a pulse at the start of each phrase.",
    tags: ["macro", "sweep", "tempo", "build-up"],
  }).output("rise", "Rise", "control").output("arc", "Arc", "control").output("phrase", "Phrase", "trigger");
  const saw = p.add("lfo", [0, 0], { wave: "Saw Up", sync: "4 bars", polarity: "Unipolar" }, { name: "Ramp" });
  const slew = p.add("utility", [1, 0], { slew: 0.25 }, { name: "Smooth" });
  const arc = p.add("function", [0, 1], { sync: "4 bars", cycle: true, shape: 0.3 }, { name: "Arc" });
  p.cable(saw, "out", slew, "x").cable(slew, "out", p.cout, "rise").cable(arc, "a", p.cout, "arc")
    .cable(saw, "cycle", p.cout, "phrase");
  return p;
}

export default category("Modulators", "Control, gate and trigger sources for everything else on the board: LFOs, randomness, envelopes and rhythms.", [
  tempoQuartet, driftPack, randomWalkers, tideCycler, breathAndBloom, fogOfChance, synapseGates, contourChain,
  coinFlipRhythm, fourBarArc,
]);
