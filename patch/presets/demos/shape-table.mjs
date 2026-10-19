// SPDX-License-Identifier: MIT
// Shape Table (shape-table): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
const seqOf = (p, at, notes, o = {}) => p.add("step-sequencer", at, {
  length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
  octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
}, { data: steps(notes) });

/// `src`'s pitch from the sequencer (jack `pitch`, or none), its output (`jack`) through an ADSR-driven VCA.
function gated(p, at, src, seq, jack, pitch, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(seq, "pitch", src, pitch);
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(src, jack, amp, "l").cable(env, "env", amp, "gain");
  return { amp, env };
}

/// Mono or stereo source → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.22, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// Mono or stereo source → trim mixer → Out 1/2 (no reverb).
function direct(p, at, src, jacks, trim = 0, master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

/// A voice and a drum loop into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

const N = 65;
const curve = (f) => ({ curve: Array.from({ length: N }, (_, i) => Math.round(Math.max(-1, Math.min(1, f(-1 + 2 * i / (N - 1)))) * 1000) / 1000) });
const SOFT = curve((x) => Math.tanh(2.2 * x) / Math.tanh(2.2));
const FOLD = curve((x) => Math.sin(2 * Math.PI * x));
const SINE = curve((x) => Math.sin(0.5 * Math.PI * x));
const STAIRS = curve((x) => {
  const s = (x + 1) * 4, k = Math.floor(s), f = s - k, m = f < 0.7 ? 0 : (f - 0.7) / 0.3;
  return (k + m * m * (3 - 2 * m)) / 4 - 1 + 0.125;
});
const ASYM = curve((x) => (x >= 0 ? Math.tanh(1.8 * x) / Math.tanh(1.8) : Math.max(-0.85, 1.3 * x)));

function softBass() {
  const p = patch("Shape Table: Soft Bass", {
    module: "shape-table", tempo: 98,
    description: "A pure sine bass is driven into the soft curve: the peaks round off and odd harmonics grow with Drive, so it gets warm and then gritty. Draw on the curve to change the harmonics, or raise Drive for more edge.",
    tags: ["bass", "saturation", "warm", "drive"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 3, ".", 5, 7, ".", 0, ".", 10, 7, ".", 5, 3, "."], { root: "E", octave: -2, gate: 0.7 });
  const osc = p.add("oscillator", [1, 0], { shape: 0 });
  const st = p.add("shape-table", [3, 0], { drive: 12, mix: 1, out: -6, quality: "4x" }, { data: SOFT });
  const v = gated(p, [2, 0], osc, seq, "out", "pitch", { env: { attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.15 } });
  p.cable(v.amp, "l", st, "l");
  const d = beat(p, [0, 4], { style: "half", level: -7 });
  withDrums(p, [4, 0], st, ["l", "r"], d, { l1: -3, l2: -4 });
  return p;
}

function foldLead() {
  const p = patch("Shape Table: Fold Lead", {
    module: "shape-table", tempo: 104,
    description: "A saw lead goes through a folding curve while an envelope pushes Drive up on every note: the first moment of each note is rich and bright and settles to a simpler tone. Change Drive or draw a new curve.",
    tags: ["fold", "lead", "envelope", "bright"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 10, 7, 3, 5, ".", 0, 3, 7, 12, 10, 7, 5, 3], { root: "A", gate: 0.6 });
  const osc = p.add("oscillator", [1, 0], { shape: 0.6 });
  const fe = p.add("adsr", [1, 2], { attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.1 }, { name: "Fold Env" });
  const st = p.add("shape-table", [3, 0], { drive: 3, out: -8, quality: "4x" }, { data: FOLD });
  const v = gated(p, [2, 0], osc, seq, "out", "pitch", { env: { decay: 0.3, sustain: 0.5, release: 0.25 } });
  p.cable(seq, "gate", fe, "gate").cable(seq, "trigger", fe, "retrig").cable(fe, "env", st, "drive", 0.45).cable(v.amp, "l", st, "l");
  finish(p, [4, 0], st, ["l", "r"], -4, { mix: 0.2 });
  return p;
}

function wrapTable() {
  const p = patch("Shape Table: Wrap Table", {
    module: "shape-table", tempo: 90,
    description: "Edge is Wrap: a slow triangle sweeps its way through the repeating sine curve, so the shaper becomes an oscillator-like table whose spectrum moves with Drive. Move Bias to shift where the curve is read.",
    tags: ["wrap", "table", "oscillator", "evolving"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"], { rate: "1/4", gate: 1, root: "G", octave: -1 });
  const osc = p.add("oscillator", [1, 0], { shape: 0.3 });
  const l = p.add("lfo", [1, 2], { wave: "Triangle", sync: "4 bars", polarity: "Unipolar" }, { name: "Drive Sweep" });
  const st = p.add("shape-table", [3, 0], { drive: 6, edge: "Wrap", out: -7, quality: "4x" }, { data: SINE });
  const v = gated(p, [2, 0], osc, seq, "out", "pitch", { env: { attack: 0.2, decay: 0.4, sustain: 0.9, release: 0.8 } });
  p.cable(l, "out", st, "drive", 0.5).cable(v.amp, "l", st, "l");
  finish(p, [4, 0], st, ["l", "r"], -3, { decay: 3, mix: 0.3 });
  return p;
}

function crushedDrums() {
  const p = patch("Shape Table: Crushed Drums", {
    module: "shape-table", tempo: 120,
    description: "A drum loop through the Stairs curve mixed back under the dry kit: eight steps give a crunchy, digital grain on every hit without losing the punch. Turn Mix up for more grit, down for a subtle bite.",
    tags: ["drums", "stairs", "crunch", "parallel"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -5 });
  const st = p.add("shape-table", [3, 0], { drive: 6, mix: 0.55, out: -3, quality: "2x" }, { data: STAIRS });
  p.cable(d, "outl", st, "l").cable(d, "outr", st, "r");
  direct(p, [4, 0], st, ["l", "r"], -2);
  return p;
}

function functionCurve() {
  const p = patch("Shape Table: Function Curve", {
    module: "shape-table", tempo: 100,
    description: "A slow triangle LFO goes through the drawn curve (Func In to Func Out) and the result opens the cutoff of a filter on a saw riff: a custom-shaped sweep. Redraw the curve to reshape the sweep.",
    tags: ["function", "modulation", "filter", "curve"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 0, 12, 7, 0, 0, 5, 0, 3, 5, 7, 0], { rate: "1/8", shape: 1, root: "A", scale: "Natural Minor", gatelength: 0.6, octave: -1, env: { decay: 0.2, sustain: 0.5 } });
  const l = p.add("lfo", [0, 3], { wave: "Triangle", sync: "2 bars", polarity: "Bipolar" }, { name: "Sweep" });
  const st = p.add("shape-table", [1, 3], { drive: 0 }, { data: ASYM });
  const f = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.4, mode: "LP" });
  p.cable(l, "out", st, "func").cable(m.amp, "l", f, "l").cable(st, "func", f, "cutoff", 0.55);
  finish(p, [4, 0], f, ["l", "l"], -4, { mix: 0.2 });
  return p;
}

export default [softBass, foldLead, wrapTable, crushedDrums, functionCurve];
