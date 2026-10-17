// SPDX-License-Identifier: MIT
// Pitch Shifter: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}
const verb = (p, at, src, o = {}) => {
  const v = p.add("reverb", at, { size: 0.6, decay: 4, damping: 0.5, mix: 0.4, quality: "Eco (8 lines)", ...o });
  p.stereo(src, v);
  return v;
};
const pluck = (p, o = {}) => melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 5, 12, 10, 7, 3, 7, 0, "."],
  { rate: "1/4", shape: 0.5, root: "A", scale: "Minor Pentatonic", gatelength: 0.5, env: { attack: 0.003, decay: 0.8, sustain: 0.1, release: 0.5 }, ...o });

function shimmer() {
  const p = patch("Pitch Shifter: Octave Shimmer", {
    module: "pitch-shifter", tempo: 72,
    description: "A pluck melody goes up an octave into a Pitch Shifter with Feedback and then a big reverb: each tail climbs in octaves into a glassy shimmer. Lower Feedback for a single octave halo or try +7 for a fifth.",
    tags: ["shimmer", "octave up", "feedback", "reverb"],
  });
  const m = pluck(p);
  const s = p.add("pitch-shifter", [3, 0], { pitch: 12, fine: 0, window: 100, drift: 0.2, feedback: 0.5, mix: 0.6 });
  feed(p, m.amp, s);
  const v = verb(p, [4, 0], s, { size: 0.8, decay: 6, mix: 0.45 });
  out(p, [5, 0], v, 0, ["l", "r"], 1);
  return p;
}

function subOctave() {
  const p = patch("Pitch Shifter: Octave Down Weight", {
    module: "pitch-shifter", tempo: 98,
    description: "A bass riff is blended with a copy an octave lower, doubling its depth at half Mix. Try -5 or -7 for a thick parallel line or raise Window for smoother, less grainy low notes.",
    tags: ["octave down", "bass", "thickening", "sub"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 7, ".", 5, 3],
    { rate: "1/8", shape: 0.7, octave: -1, root: "E", scale: "Minor Pentatonic", gatelength: 0.7, env: { attack: 0.004, decay: 0.2, sustain: 0.6, release: 0.1 } });
  const s = p.add("pitch-shifter", [3, 0], { pitch: -12, window: 160, drift: 0, feedback: 0, mix: 0.5 });
  feed(p, m.amp, s);
  const d = beat(p, [0, 3], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -3, master: 2 });
  p.stereo(s, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function harmony() {
  const p = patch("Pitch Shifter: Parallel Fifth", {
    module: "pitch-shifter", tempo: 106,
    description: "The Shifter adds a line a fifth above the melody at half Mix, so every note is paired with a power-chord partner. Change Pitch to +4 for a major third, +3 for a minor third or -5 for a fourth below.",
    tags: ["harmony", "interval", "fifth", "parallel"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 12, 10, 7, 3, 7, 5, 8, 12, 15, 12, 8, 5, 3],
    { rate: "1/8", shape: 0.8, root: "D", scale: "Natural Minor", gatelength: 0.7, env: { attack: 0.004, decay: 0.3, sustain: 0.5, release: 0.15 } });
  const s = p.add("pitch-shifter", [3, 0], { pitch: 7, window: 60, mix: 0.5 });
  feed(p, m.amp, s);
  out(p, [4, 0], s, 3, ["l", "r"], 3);
  return p;
}

function detuneThick() {
  const p = patch("Pitch Shifter: Fine Detune Doubler", {
    module: "pitch-shifter", tempo: 80,
    description: "With Pitch at zero and just 12 cents of Fine plus a little Drift, a held pad is doubled by a slightly out-of-tune, wavering copy, which thickens it like an ensemble. Increase Drift for tape-like flutter or Fine for a wider detune.",
    tags: ["detune", "drift", "pad", "doubling"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 1, root: "G", scale: "Dorian", gatelength: 0.98, env: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 0.9 } });
  const s = p.add("pitch-shifter", [3, 0], { pitch: 0, fine: 12, window: 120, drift: 0.55, mix: 0.5 });
  feed(p, m.amp, s);
  out(p, [4, 0], s, -14);
  return p;
}

function climbingSpiral() {
  const p = patch("Pitch Shifter: Climbing Spiral", {
    module: "pitch-shifter", tempo: 84,
    description: "Sparse notes enter a Pitch Shifter set a few semitones up with high Feedback: each echo is shifted again and spirals upward until it fades. Make Pitch negative and the spiral falls instead; add Drift for flutter.",
    tags: ["feedback", "spiral", "echo", "rising"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", ".", 7, ".", ".", ".", 3, ".", ".", ".", 5, ".", ".", "."],
    { rate: "1/4", shape: 0.4, octave: 0, root: "E", scale: "Minor Pentatonic", gatelength: 0.4, env: { attack: 0.003, decay: 0.5, sustain: 0.1, release: 0.4 } });
  const s = p.add("pitch-shifter", [3, 0], { pitch: 4, window: 90, drift: 0.1, feedback: 0.72, mix: 0.7 });
  feed(p, m.amp, s);
  const v = verb(p, [4, 0], s, { size: 0.6, decay: 3, mix: 0.3 });
  out(p, [5, 0], v, 0, ["l", "r"], 5);
  return p;
}

export default [shimmer, subOctave, harmony, detuneThick, climbingSpiral];
