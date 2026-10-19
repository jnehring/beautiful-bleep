// SPDX-License-Identifier: MIT
// Bit Formula (bit-formula): five demo patches. Each plays by itself with the transport.
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

function sieveTune() {
  const p = patch("Bit Formula: Sieve Tune", {
    module: "bit-formula", tempo: 100,
    description: "A tune made from the overlap of two shifted counters, played by a sequencer on the clock rate. Move A and B to change which notes appear, or switch Formula to Crawl for a slower creeping line.",
    tags: ["melody", "formula", "chip", "lead"],
  });
  const seq = seqOf(p, [0, 0], [0, 0, 7, ".", 3, 5, 7, ".", 0, 0, 10, ".", 7, 5, 3, 0], { root: "C", gate: 0.7 });
  const osc = p.add("bit-formula", [1, 0], { formula: "Sieve", rate: 6000, a: 90, b: 140, c: 215, smooth: 0.2, level: 0.6 });
  const v = gated(p, [2, 0], osc, seq, "out", "pitch", { env: { attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.1 } });
  finish(p, [3, 0], v.amp, ["l", "l"], -1, { mix: 0.18 });
  return p;
}

function crushTheBeat() {
  const p = patch("Bit Formula: Crush the Beat", {
    module: "bit-formula", tempo: 112,
    description: "A drum loop goes into In and the formula mixes it, bit by bit, with the counter: the beat comes back crunchy and gritted. Turn A down for a cleaner crush or switch to Input Mod for a more tonal mangle.",
    tags: ["input", "crush", "drums", "effect"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -4 });
  const f = p.add("bit-formula", [3, 0], { formula: "Input Crush", rate: 14000, a: 120, b: 255, c: 120, level: 0.8 });
  p.cable(d, "outl", f, "in");
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -9, master: -2 }, { name: "Mix" });
  p.cable(f, "out", mix, "in1l").cable(f, "out", mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function slidingKnobs() {
  const p = patch("Bit Formula: Sliding Knobs", {
    module: "bit-formula", tempo: 84,
    description: "Three slow LFOs move A, B and C through a creeping formula, so the shifts and masks keep re-forming: a texture that is never the same twice. Change the LFO rates, or Smooth for a softer surface.",
    tags: ["texture", "evolving", "lfo", "ambient"],
  });
  const a = p.add("lfo", [0, 0], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "A" });
  const b = p.add("lfo", [0, 1], { rate: 0.037, wave: "Sine", polarity: "Unipolar" }, { name: "B" });
  const c = p.add("lfo", [0, 2], { rate: 0.023, wave: "Triangle", polarity: "Unipolar" }, { name: "C" });
  const f = p.add("bit-formula", [1, 0], { formula: "Crawl", rate: 9000, a: 100, b: 150, c: 200, smooth: 0.45, level: 0.5 });
  p.cable(a, "out", f, "a", 0.5).cable(b, "out", f, "b", 0.5).cable(c, "out", f, "c", 0.4);
  finish(p, [2, 0], f, ["out", "out"], -4, { decay: 3.5, mix: 0.35 });
  return p;
}

function drumVoice() {
  const p = patch("Bit Formula: Drum Voice", {
    module: "bit-formula", tempo: 120,
    description: "The counter is reset by every step and the formula is cut by a short envelope, so a falling squeal becomes a percussive hit. Change the Formula or Rate for a different drum sound.",
    tags: ["drums", "percussion", "reset", "formula"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", ".", 0, ".", ".", 0, ".", 0, ".", 0, ".", ".", 0, ".", 0], { rate: "1/16", gate: 0.2 });
  const f = p.add("bit-formula", [1, 0], { formula: "Chirp", rate: 11000, a: 70, b: 50, smooth: 0.1, level: 0.7 });
  const v = gated(p, [2, 0], f, seq, "out", null, { env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 } });
  p.cable(seq, "trigger", f, "reset");
  const d = beat(p, [0, 4], { style: "half", level: -6 });
  withDrums(p, [4, 0], v.amp, ["l", "l"], d, { l1: 3, l2: -3 });
  return p;
}

function bassMask() {
  const p = patch("Bit Formula: Hollow Bass", {
    module: "bit-formula", tempo: 96,
    description: "A low note on the clock rate of a shifted-mask formula: a hollow, buzzing bass with a built-in sub pattern. A sweeps the harmonic mask; try Bits at 5 for a rawer edge.",
    tags: ["bass", "mask", "bits", "lo-fi"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 3, ".", 5, 7, ".", 0, ".", 10, 7, ".", 5, 3, "."], { root: "E", octave: -2, gate: 0.65 });
  const env = p.add("lfo", [1, 2], { wave: "Triangle", sync: "2 bars", polarity: "Unipolar" }, { name: "Mask Sweep" });
  const f = p.add("bit-formula", [1, 0], { formula: "Sierpinski", rate: 3500, a: 60, b: 180, smooth: 0.35, level: 0.7 });
  p.cable(env, "out", f, "a", 0.4);
  const v = gated(p, [2, 0], f, seq, "out", "pitch", { env: { attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.1 } });
  const d = beat(p, [0, 4], { style: "half", level: -7 });
  withDrums(p, [4, 0], v.amp, ["l", "l"], d, { l1: -1, l2: -4 });
  return p;
}

export default [sieveTune, crushTheBeat, slidingKnobs, drumVoice, bassMask];
