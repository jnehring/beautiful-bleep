// SPDX-License-Identifier: MIT
// Matrix Mixer: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Matrix Mixer with every crosspoint set: `gains` maps "in>out" to a value (−1…1), the rest are 0.
/// `extra`: other knobs/settings; `data`: node data (labels, snapshots).
function matrix(p, at, nIn, nOut, gains, extra = {}, data) {
  const v = { inputs: nIn, outputs: nOut, ...extra };
  for (let i = 1; i <= nIn; i++) for (let j = 1; j <= nOut; j++) v[`g_${i}_${j}`] = gains[`${i}>${j}`] ?? 0;
  return p.add("matrix-mixer", at, v, data ? { data } : {});
}

/// A snapshot for the node data: gains as an 8×8 array (rows = inputs).
function snapshot(name, gains, level = 1) {
  const g = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (const [k, v] of Object.entries(gains)) { const [i, j] = k.split(">").map(Number); g[i - 1][j - 1] = v; }
  return { name, g, level: new Array(8).fill(level), mute: new Array(8).fill(0) };
}

/// Mixer-less ending for stereo audio: a gentle glue stage then Out 1/2 (here a plain stereo reverb).
function room(p, at, l, r, o = {}) {
  const verb = p.add("reverb", at, { size: 0.55, decay: o.decay ?? 2.5, damping: 0.5, mix: o.mix ?? 0.25, quality: "Eco (8 lines)" }, { name: "Room" });
  p.cable(l[0], l[1], verb, "l").cable(r[0], r[1], verb, "r");
  p.stereo(verb, p.out);
  return verb;
}

function effectSends() {
  const p = patch("Matrix Mixer: Send Matrix", {
    module: "matrix-mixer", tempo: 96,
    description: "Eight inputs, four outputs: a lead, a bass and a drum kit go in, outputs 3 and 4 are sends to an echo and a reverb, and their returns come back into the matrix to be mixed into the main left and right. Each crosspoint is a send amount - try the lead's 1 -> 3 and 1 -> 4 circles.",
    tags: ["sends", "effects", "routing", "mix"],
  });
  const lead = melody(p, [0, 0], [0, 7, 3, 7, 10, 7, 5, 3], { rate: "1/8", root: "C", scale: "Dorian", octave: 0, shape: 0.75 });
  const bass = melody(p, [0, 2], [0, ".", ".", 0, ".", 7, ".", 5], { rate: "1/8", root: "C", scale: "Dorian", octave: -2, shape: 0.25, env: { decay: 0.35, sustain: 0.4 } });
  const drums = beat(p, [0, 4], { style: "shuffle", level: -6 });
  const g = { "1>1": 0.55, "1>2": 0.4, "1>3": 0.6, "1>4": 0.25, "2>1": 0.5, "2>2": 0.5, "3>1": 0.55, "3>4": 0.15, "4>2": 0.55, "4>4": 0.15,
              "5>1": 0.8, "6>2": 0.8, "7>1": 0.7, "8>2": 0.7 };
  const mm = matrix(p, [4, 0], 8, 4, g, { stage: "Soft clip", level_1: 1.25, level_2: 1.25 }, { labels: { in: ["Lead", "Bass", "Drums L", "Drums R", "Echo L", "Echo R", "Verb L", "Verb R"], out: ["Main L", "Main R", "To Echo", "To Verb"] } });
  p.cable(lead.amp, "l", mm, "in1").cable(bass.amp, "l", mm, "in2").cable(drums, "outl", mm, "in3").cable(drums, "outr", mm, "in4");
  const dl = p.add("delay-network", [6, 0], { sync: "1/8.", taps: 3, feedback: 0.4, tone: -0.3, mix: 1 }, { name: "Echo" });
  const vb = p.add("reverb", [6, 1], { size: 0.7, decay: 3.2, mix: 1, quality: "Eco (8 lines)" }, { name: "Verb" });
  p.cable(mm, "out3", dl, "l").cable(mm, "out3", dl, "r").cable(mm, "out4", vb, "l").cable(mm, "out4", vb, "r");
  p.cable(dl, "l", mm, "in5").cable(dl, "r", mm, "in6").cable(vb, "l", mm, "in7").cable(vb, "r", mm, "in8");
  p.cable(mm, "out1", p.out, "l").cable(mm, "out2", p.out, "r");
  return p;
}

function sceneMorph() {
  const p = patch("Matrix Mixer: Scene Morph", {
    module: "matrix-mixer", tempo: 100,
    description: "Two stored snapshots: A is a sparse scene (lead left, bass centre, pad), B a full groove with drums and the lead on the right. A slow LFO on Morph blends smoothly between them, so the arrangement keeps changing by itself. Click a snapshot button to hear it alone, or drag Morph.",
    tags: ["snapshots", "morph", "arrangement", "scenes"],
  });
  const lead = melody(p, [0, 0], [0, 4, 7, 11, 9, 7, 4, 2], { rate: "1/8", root: "G", scale: "Major Pentatonic", octave: 0, shape: 0.6 });
  const bass = melody(p, [0, 2], [0, ".", 0, ".", 7, ".", 5, "."], { rate: "1/8", root: "G", scale: "Major Pentatonic", octave: -2, shape: 0.2, env: { decay: 0.4, sustain: 0.4 } });
  const pad = p.add("oscillator", [0, 4], { coarse: 4, octave: "-1", shape: 0.4 }, { name: "Pad" });
  const pad2 = p.add("oscillator", [0, 5], { coarse: 11, octave: "-1", shape: 0.4, fine: 7 }, { name: "Pad 2" });
  const drums = beat(p, [0, 6], { style: "four", level: -6 });
  const A = snapshot("Sparse", { "1>1": 0.9, "2>1": 0.45, "2>2": 0.45, "3>1": 0.25, "3>2": 0.25, "4>1": 0.2, "4>2": 0.2, "5>1": 0, "5>2": 0 }, 0.5);
  const B = snapshot("Groove", { "1>2": 0.8, "1>1": 0.2, "2>1": 0.5, "2>2": 0.5, "3>1": 0.05, "3>2": 0.05, "5>1": 0.6, "5>2": 0.6 }, 0.5);
  const mm = matrix(p, [4, 0], 5, 2, { "1>1": 0.9, "2>1": 0.45, "2>2": 0.45, "3>1": 0.25, "3>2": 0.25, "4>1": 0.2, "4>2": 0.2 },
    { morphon: "On", curve: "Equal power", inputs: 5, outputs: 2, level_1: 0.5, level_2: 0.5 },
    { labels: { in: ["Lead", "Bass", "Pad", "Pad 2", "Drums"], out: ["Left", "Right"] }, snapshots: [A, B, null, null, null, null, null, null], morphA: 0, morphB: 1 });
  const lfo = p.add("lfo", [4, 2], { rate: 0.06, wave: "Triangle", polarity: "Unipolar" }, { name: "Scene Walk" });
  p.cable(lead.amp, "l", mm, "in1").cable(bass.amp, "l", mm, "in2").cable(pad, "out", mm, "in3").cable(pad2, "out", mm, "in4").cable(drums, "outl", mm, "in5");
  p.cable(lfo, "out", mm, "morph");
  room(p, [6, 0], [mm, "out1"], [mm, "out2"], { mix: 0.2 });
  return p;
}

function crosspointRing() {
  const p = patch("Matrix Mixer: Crosspoint Ring", {
    module: "matrix-mixer", tempo: 90,
    description: "Every crosspoint is also a knob, so an audio-rate oscillator patched into the 1 -> 1 gain turns the matrix into a ring modulator: the left output is the metallic product, the right output the dry melody. A slow LFO detunes the modulator for sweeping bell tones. Try changing the 1 -> 2 crosspoint to blend dry and ring.",
    tags: ["ring mod", "audio rate", "crosspoint", "bells"],
  });
  const m = melody(p, [0, 0], [0, 7, 4, 9, 12, 9, 7, 4], { rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 0.3, env: { decay: 0.6, sustain: 0.3, release: 0.4 } });
  const mod = p.add("oscillator", [0, 2], { coarse: 3, octave: "0", shape: 0 }, { name: "Modulator" });
  const lfo = p.add("lfo", [0, 3], { rate: 0.07, wave: "Triangle" }, { name: "Detune" });
  p.cable(lfo, "out", mod, "coarse", 0.6);
  const mm = matrix(p, [2, 0], 1, 2, { "1>1": 0, "1>2": 0.7 }, { stage: "Soft clip" }, { labels: { in: ["Melody"], out: ["Ring", "Dry"] } });
  p.cable(m.amp, "l", mm, "in1").cable(mod, "out", mm, "g_1_1", 1);
  const boost = p.add("filter", [3, 0], { cutoff: 9000, resonance: 0.05, gain: 0 }, { name: "Soften" });
  p.cable(mm, "out1", boost, "l").cable(mm, "out2", boost, "r");
  room(p, [4, 0], [boost, "l"], [boost, "r"], { mix: 0.3, decay: 3.5 });
  return p;
}

function feedbackWeb() {
  const p = patch("Matrix Mixer: Feedback Web", {
    module: "matrix-mixer", tempo: 84,
    description: "Two echo networks sit between matrix outputs and inputs, and their returns feed one another through the crosspoints with Normalize on, so the loops build a glassy web of repeats that never runs away. Lower or raise the crosspoint gains around 0.5 to thin out or thicken the web.",
    tags: ["feedback", "echo", "ambient", "network"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, 5, ".", ".", 2, "."], { rate: "1/8", root: "F", scale: "Lydian", octave: 0, shape: 0.2, env: { decay: 0.35, sustain: 0.15 } });
  const g = { "1>1": 0.7, "1>2": 0.5, "1>3": 0.5, "1>4": 0.5,
              "3>1": 0.5, "5>1": 0.5, "2>2": 0.5, "4>2": 0.5, "2>3": 0.6, "3>3": 0.6, "4>4": 0.6, "5>4": 0.6 };
  const mm = matrix(p, [2, 0], 5, 4, g, { stage: "Normalize", level_3: 1.4, level_4: 1.4 }, { labels: { in: ["Source", "Echo A L", "Echo B L", "Echo A R", "Echo B R"], out: ["To A", "To B", "Main L", "Main R"] } });
  const a = p.add("delay-network", [4, 0], { sync: "1/8.", taps: 3, feedback: 0.35, tone: -0.2, mix: 1, routing: "Chain" }, { name: "Echo A" });
  const b = p.add("delay-network", [4, 1], { sync: "1/4", taps: 2, feedback: 0.3, tone: 0.1, character: 0.4, mix: 1, routing: "Ring" }, { name: "Echo B" });
  p.cable(m.amp, "l", mm, "in1");
  p.cable(mm, "out1", a, "l").cable(mm, "out1", a, "r").cable(mm, "out2", b, "l").cable(mm, "out2", b, "r");
  p.cable(a, "l", mm, "in2").cable(b, "l", mm, "in3").cable(a, "r", mm, "in4").cable(b, "r", mm, "in5");
  p.cable(mm, "out3", p.out, "l").cable(mm, "out4", p.out, "r");
  return p;
}

function modulationBlender() {
  const p = patch("Matrix Mixer: Modulation Blender", {
    module: "matrix-mixer", tempo: 72,
    description: "The matrix isn't only for audio: four slow Quad LFO waves go in, and four differently blended mixes (some inverted) come out to move the filter of each voice of a chord. Change the crosspoint signs to make voices open when others close.",
    tags: ["modulation", "control", "blend", "pad"],
  });
  const q = p.add("quad-lfo", [0, 0], { rate1: 0.11, mode: "Free", rate2: 0.17, rate3: 0.07, rate4: 0.23, wave1: "Sine", wave2: "Triangle", wave3: "Sine", wave4: "Random Smooth" });
  const g = { "1>1": 0.8, "2>1": 0.4, "2>2": 0.8, "3>2": -0.5, "3>3": 0.8, "4>3": 0.4, "4>4": 0.8, "1>4": -0.4 };
  const mm = matrix(p, [1, 0], 4, 4, g, {}, { labels: { in: ["LFO 1", "LFO 2", "LFO 3", "LFO 4"], out: ["Voice 1", "Voice 2", "Voice 3", "Voice 4"] } });
  [1, 2, 3, 4].forEach((i) => p.cable(q, `out${i}`, mm, `in${i}`));
  const mix = p.add("audio-mixer", [4, 0], { level1: -9, level2: -9, level3: -9, level4: -9, pan1: -0.6, pan2: -0.2, pan3: 0.2, pan4: 0.6, master: -2, send1: -9, send2: -9, send3: -9, send4: -9, return: -5 }, { name: "Chord" });
  [0, 4, 7, 11].forEach((s, i) => {
    const o = p.add("oscillator", [2, i], { coarse: s, octave: "-1", shape: 0.75, fine: (i - 1.5) * 4 }, { name: `Voice ${i + 1}` });
    const f = p.add("filter", [3, i], { cutoff: 600, resonance: 0.3 }, { name: `Filter ${i + 1}` });
    p.cable(o, "out", f, "l").cable(mm, `out${i + 1}`, f, "cutoff", 0.7).cable(f, "l", mix, `in${i + 1}l`).cable(f, "l", mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [5, 0], { size: 0.7, decay: 4.5, mix: 1, quality: "Eco (8 lines)" }, { name: "Hall" });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").cable(verb, "l", mix, "returnl").cable(verb, "r", mix, "returnr");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [effectSends, sceneMorph, crosspointRing, feedbackWeb, modulationBlender];
