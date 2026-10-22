// SPDX-License-Identifier: MIT
// Matrix Mixer (matrix-mixer): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Matrix Mixer node. `gains`: {"i>j": gain} crosspoints (1-based, input > output); everything else is 0.
/// `extra`: other knobs/settings; `data`: node data (snapshots, labels).
function matrix(p, at, nIn, nOut, gains, extra = {}, data) {
  const v = { inputs: nIn, outputs: nOut, ...extra };
  for (let i = 1; i <= nIn; i++) for (let j = 1; j <= nOut; j++) v[`g_${i}_${j}`] = gains[`${i}>${j}`] ?? 0;
  return p.add("matrix-mixer", at, v, data ? { data } : {});
}

/// A snapshot for the node data: gains as an 8×8 array (rows = inputs).
function snap(name, gains) {
  const g = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (const [k, v] of Object.entries(gains)) { const [i, j] = k.split(">").map(Number); g[i - 1][j - 1] = v; }
  return { name, g, level: Array(8).fill(1), mute: Array(8).fill(0) };
}

/// Two matrix outputs → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["out1", "out2"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.18, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function sceneSwitch() {
  const p = patch("Matrix Mixer: Four Into Stereo", {
    module: "matrix-mixer", tempo: 106,
    description: "Four sources (bass, chords, lead, drums) go into a 4 by 2 matrix, each with its own left and right gain: the bass sits in the middle, the chords lean left, the lead right and the drums are spread. Click a crosspoint to change how much of a source goes to which side.",
    tags: ["routing", "stereo", "panning", "mix", "crosspoints"],
  });
  const b = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 10, ".", 7, 5], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -2, shape: 0.9, gatelength: 0.55, env: { decay: 0.2, sustain: 0.5 } });
  const c = melody(p, [0, 2], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 0.3, gatelength: 1, env: { attack: 0.05, sustain: 0.8, release: 0.5 } });
  const l = melody(p, [0, 4], [12, ".", 10, 12, ".", 15, 12, 10, ".", 7, ".", 10, 12, ".", ".", "."], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 1, shape: 0.5, gatelength: 0.4, env: { decay: 0.3, sustain: 0.1 } });
  const d = beat(p, [0, 6], { style: "four", level: -6 });
  const mx = matrix(p, [4, 0], 5, 2, { "1>1": 0.5, "1>2": 0.5, "2>1": 0.45, "2>2": 0.1, "3>1": 0.1, "3>2": 0.45, "4>1": 0.4, "5>2": 0.4 });
  p.cable(b.amp, "l", mx, "in1").cable(c.amp, "l", mx, "in2").cable(l.amp, "l", mx, "in3").cable(d, "outl", mx, "in4").cable(d, "outr", mx, "in5");
  p.stereo(mx, p.out, { from: ["out1", "out2"] });
  return p;
}

function morphScenes() {
  const p = patch("Matrix Mixer: Scene Morph", {
    module: "matrix-mixer", tempo: 100,
    description: "Two stored snapshots: A is a sparse scene with bass and a pad, B adds drums and the lead on the right. A slow LFO on Morph blends smoothly between them, so the arrangement builds and thins by itself. Drag Morph by hand, or edit a snapshot's crosspoints.",
    tags: ["snapshots", "morph", "scenes", "arrangement", "lfo"],
  });
  const b = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 10, ".", 7, 5], { rate: "1/8", root: "D", scale: "Dorian", octave: -2, shape: 0.9, gatelength: 0.55, env: { decay: 0.2, sustain: 0.5 } });
  const c = melody(p, [0, 2], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", root: "D", scale: "Dorian", octave: 0, shape: 0.3, gatelength: 1, env: { attack: 0.05, sustain: 0.8, release: 0.5 } });
  const l = melody(p, [0, 4], [12, ".", 10, 12, ".", 15, 12, 10, ".", 7, ".", 10, 12, ".", ".", "."], { rate: "1/8", root: "D", scale: "Dorian", octave: 1, shape: 0.5, gatelength: 0.4, env: { decay: 0.3, sustain: 0.1 } });
  const d = beat(p, [0, 6], { style: "half", level: -6 });
  const A = snap("Sparse", { "1>1": 0.5, "1>2": 0.5, "2>1": 0.5, "2>2": 0.3 });
  const B = snap("Full", { "1>1": 0.5, "1>2": 0.5, "2>1": 0.2, "2>2": 0.4, "3>2": 0.5, "3>1": 0.1, "4>1": 0.4, "5>2": 0.4 });
  const mx = matrix(p, [4, 0], 5, 2, {}, { morphon: "On", curve: "Smooth" },
    { labels: { in: ["Bass", "Pad", "Lead", "Drums L", "Drums R"], out: ["Left", "Right"] }, snapshots: [A, B, null, null, null, null, null, null], morphA: 0, morphB: 1 });
  const lfo = p.add("lfo", [4, 3], { wave: "Triangle", sync: "Tempo", division: "4 bars", polarity: "Unipolar" }, { name: "Morph" });
  p.cable(b.amp, "l", mx, "in1").cable(c.amp, "l", mx, "in2").cable(l.amp, "l", mx, "in3").cable(d, "outl", mx, "in4").cable(d, "outr", mx, "in5").cable(lfo, "out", mx, "morph", 0.5);
  p.stereo(mx, p.out, { from: ["out1", "out2"] });
  return p;
}

function feedbackFree() {
  const p = patch("Matrix Mixer: Voice Swap", {
    module: "matrix-mixer", tempo: 112,
    description: "A saw arpeggio and a square arpeggio enter a 2 by 2 matrix. Each output carries a mix of both, and two LFOs in opposite phase move the crossing gains, so the voices drift from one side to the other and back. Change a gain to a negative value to hear phase effects.",
    tags: ["crosspoints", "negative gain", "swap", "phase", "arpeggio"],
  });
  const a = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14], { rate: "1/8", root: "E", scale: "Natural Minor", octave: 0, shape: 1, gatelength: 0.5, env: { decay: 0.2, sustain: 0.1 } });
  const b = melody(p, [0, 3], [12, 10, 7, 10, 15, 12, 7, 3, 17, 15, 12, 10, 19, 17, 14, 12], { rate: "1/8", root: "E", scale: "Natural Minor", octave: -1, shape: 0.4, gatelength: 0.5, osc: { fine: 4 }, env: { decay: 0.25, sustain: 0.1 } });
  const mx = matrix(p, [4, 0], 2, 2, { "1>1": 0.7, "1>2": 0.2, "2>1": 0.2, "2>2": 0.7 });
  const lfo1 = p.add("lfo", [4, 2], { rate: 0.12, wave: "Sine" }, { name: "Cross 1>2" });
  const lfo2 = p.add("lfo", [4, 3], { rate: 0.12, phase: 180, wave: "Sine" }, { name: "Cross 2>1" });
  p.cable(a.amp, "l", mx, "in1").cable(b.amp, "l", mx, "in2").cable(lfo1, "out", mx, "g_1_2", 0.5).cable(lfo2, "out", mx, "g_2_1", 0.5);
  finish(p, [5, 0], mx, -6, { size: 0.55, decay: 3, mix: 0.25 });
  return p;
}

function splitterFan() {
  const p = patch("Matrix Mixer: One to Many", {
    module: "matrix-mixer", tempo: 98,
    description: "One plucked line fans out to four outputs through four crosspoints with different gains; outputs 1 and 2 go to the speakers and outputs 3 and 4 pass through delays on the other side, so a single melody turns into a stereo echo field. Raise or lower the 1 to 3 and 1 to 4 gains to place the echoes.",
    tags: ["fan out", "splitter", "echo", "delay", "one to many"],
  });
  const a = melody(p, [0, 0], [0, 4, 7, 12, 9, 7, 4, 2, 0, 4, 9, 7, 12, 9, 7, 4], { rate: "1/8", root: "G", scale: "Major Pentatonic", octave: 0, shape: 0.6, gatelength: 0.35, env: { decay: 0.3, sustain: 0 } });
  const mx = matrix(p, [3, 0], 1, 4, { "1>1": 0.9, "1>2": 0.4, "1>3": 1, "1>4": 1 });
  const d1 = p.add("delay", [4, 1], { timel: 270, timer: 270, feedback: 0.4, mix: 1 });
  const d2 = p.add("delay", [4, 2], { timel: 420, timer: 420, feedback: 0.4, mix: 1 });
  p.cable(a.amp, "l", mx, "in1").cable(mx, "out3", d1, "l").cable(mx, "out3", d1, "r").cable(mx, "out4", d2, "l").cable(mx, "out4", d2, "r");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -2, pan1: -0.6, pan2: 0.6, level3: -6, pan3: -0.8, level4: -6, pan4: 0.8, master: 0 });
  p.cable(mx, "out1", mix, "in1l").cable(mx, "out1", mix, "in1r").cable(mx, "out2", mix, "in2l").cable(mx, "out2", mix, "in2r")
    .stereo(d1, mix, { from: ["l", "r"], to: ["in3l", "in3r"] }).stereo(d2, mix, { from: ["l", "r"], to: ["in4l", "in4r"] });
  finish(p, [6, 0], mix, 1, { size: 0.5, decay: 2.5, mix: 0.2 }, ["outl", "outr"]);
  return p;
}

function softClipSum() {
  const p = patch("Matrix Mixer: Soft Clip Stage", {
    module: "matrix-mixer", tempo: 120,
    description: "Four loud parts are summed into one output with every crosspoint at full gain, and the Output Stage setting is Soft clip, so peaks are rounded off instead of cutting hard. Try Clean and Normalize for the other behaviours, or turn Level 1 down to rebalance.",
    tags: ["output stage", "soft clip", "sum", "level", "mixdown"],
  });
  const d = beat(p, [0, 0], { style: "four", level: 0 });
  const b = melody(p, [0, 4], [0, 0, ".", 7, 0, ".", 5, ".", 0, 0, ".", 3, 10, ".", 7, 5], { rate: "1/8", root: "F", scale: "Minor Pentatonic", octave: -2, shape: 1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.6 } });
  const c = melody(p, [0, 6], [12, "_", "_", "_", 15, "_", "_", "_", 10, "_", "_", "_", 14, "_", "_", "_"], { rate: "1/4", root: "F", scale: "Minor Pentatonic", octave: 0, shape: 1, gatelength: 1, env: { attack: 0.02, sustain: 0.8, release: 0.3 } });
  const mx = matrix(p, [4, 0], 4, 2, { "1>1": 1, "2>2": 1, "3>1": 0.8, "3>2": 0.8, "4>1": 0.6, "4>2": 0.6 }, { stage: "Soft clip", level_1: 0.4, level_2: 0.4 });
  p.cable(d, "outl", mx, "in1").cable(d, "outr", mx, "in2").cable(b.amp, "l", mx, "in3").cable(c.amp, "l", mx, "in4");
  p.stereo(mx, p.out, { from: ["out1", "out2"] });
  return p;
}

export default [sceneSwitch, morphScenes, feedbackFree, splitterFan, softClipSum];
