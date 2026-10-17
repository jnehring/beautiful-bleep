// SPDX-License-Identifier: MIT
// Crossfader (crossfader): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// src (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
/// Mono jack of a node into both inputs of a stereo module.
function mono(p, from, jack, to, l = "l", r = "r") { p.cable(from, jack, to, l).cable(from, jack, to, r); }
/// Two stereo sources blended into Out.
function blend(p, at, a, b, la = -3, lb = -6, aj = ["l", "r"], bj = ["outl", "outr"]) {
  const mix = p.add("audio-mixer", at, { level1: la, level2: lb, master: -1 });
  p.stereo(a, mix, { from: aj, to: ["in1l", "in1r"] }).stereo(b, mix, { from: bj, to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function morphMelodies() {
  const p = patch("Crossfader: Two Voices Morph", {
    module: "crossfader", tempo: 96,
    description: "A soft sine arpeggio on side A and a bright buzzy line on side B share one Crossfader; a slow LFO on Fade moves between them. Drag Fade by hand, or try the Linear curve and listen for the dip at the middle.",
    tags: ["morph", "blend", "equal power", "lfo", "two sources"],
  });
  const a = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 5, 0, 4, 7, 12, 9, 7, 4, 2], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, shape: 0, gatelength: 0.45, env: { decay: 0.3, sustain: 0.1 } });
  const b = melody(p, [0, 3], [0, 4, 7, 12, 7, 4, 9, 5, 0, 4, 7, 12, 9, 7, 4, 2], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: -1, shape: 1, gatelength: 0.8, env: { decay: 0.2, sustain: 0.5 } });
  const x = p.add("crossfader", [4, 0], { fade: 0.5, curve: "Equal Power" });
  const lfo = p.add("lfo", [4, 1], { rate: 0.1, wave: "Sine", polarity: "Unipolar" }, { name: "Fade" });
  p.cable(a.amp, "l", x, "al").cable(a.amp, "l", x, "ar").cable(b.amp, "l", x, "bl").cable(b.amp, "l", x, "br").cable(lfo, "out", x, "fade", 0.5);
  finish(p, [5, 0], x, -5, { size: 0.5, decay: 2.5, mix: 0.2 }, ["outl", "outr"]);
  return p;
}

function drumSwap() {
  const p = patch("Crossfader: Beat Swap", {
    module: "crossfader", tempo: 118,
    description: "Two different drum loops run at once, a steady four-on-the-floor and a broken pattern, and a square LFO flips the Crossfader between them every two bars. Change the LFO's Sync for faster swaps, or move Fade by hand to blend both beats.",
    tags: ["drums", "switch", "square lfo", "swap", "arrangement"],
  });
  const a = beat(p, [0, 0], { style: "four", level: -6 });
  const b = beat(p, [0, 4], { style: "broken", level: -6 });
  const x = p.add("crossfader", [4, 0], { fade: 0.5, curve: "Equal Power" });
  const lfo = p.add("lfo", [4, 1], { wave: "Square", sync: "2 bars", polarity: "Unipolar" }, { name: "Swap" });
  p.stereo(a, x, { from: ["outl", "outr"], to: ["al", "ar"] }).stereo(b, x, { from: ["outl", "outr"], to: ["bl", "br"] }).cable(lfo, "out", x, "fade", 0.5);
  const bass = melody(p, [3, 3], [0, "_", ".", 0, ".", 3, ".", 5, 0, "_", ".", 0, ".", 7, ".", 5], { rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -2, shape: 0.2, gatelength: 0.7, env: { decay: 0.2, sustain: 0.6 }, oscName: "Sub" });
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -9, master: -1 });
  p.stereo(x, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(bass.amp, "l", mix, "in2l").cable(bass.amp, "l", mix, "in2r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function dryWet() {
  const p = patch("Crossfader: Dry Wet Blend", {
    module: "crossfader", tempo: 84,
    description: "A plucked line is split: side A is the dry signal and side B goes through a long, fully wet reverb. Random values on Fade walk the blend between a close, dry sound and a distant, washed one. Turn Fade by hand to set your own mix.",
    tags: ["dry wet", "reverb", "random", "blend", "pluck"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 9, 4, 7, 2, 5, 0, 7, 12, 14, 9, 7, 4, 2], { rate: "1/8", root: "F", scale: "Major Pentatonic", octave: 0, shape: 0.6, gatelength: 0.4, env: { decay: 0.3, sustain: 0 } });
  const verb = p.add("reverb", [3, 1], { size: 0.85, decay: 7, damping: 0.4, mix: 1, quality: "Eco (8 lines)" });
  p.cable(m.amp, "l", verb, "l").cable(m.amp, "l", verb, "r");
  const x = p.add("crossfader", [4, 0], { fade: 0.4 });
  const rnd = p.add("random", [4, 1], { sync: "1 bar", smooth: 0.8, spread: 0.5, bias: 0, seed: 3 }, { name: "Fade" });
  p.cable(m.amp, "l", x, "al").cable(m.amp, "l", x, "ar").stereo(verb, x, { from: ["l", "r"], to: ["bl", "br"] }).cable(rnd, "out", x, "fade", 0.5);
  p.stereo(x, p.out, { from: ["outl", "outr"] });
  return p;
}

function filterColours() {
  const p = patch("Crossfader: Dark to Bright", {
    module: "crossfader", tempo: 102,
    description: "The same saw line goes through a dark low-pass on A and a bright, resonant high-pass on B, and an envelope on Fade sweeps from one colour to the other on each note. Change either filter's Cutoff to retune the two colours, or the envelope's Decay for a slower change.",
    tags: ["filter", "timbre", "envelope", "colour", "bass"],
  });
  const m = melody(p, [0, 0], [0, 0, ".", 7, 0, ".", 5, 3, 0, 0, ".", 10, 12, ".", 7, 5], { rate: "1/8", root: "D", scale: "Natural Minor", octave: -1, shape: 1, gatelength: 0.55, env: { decay: 0.25, sustain: 0.5, release: 0.1 } });
  const dark = p.add("filter", [3, 0], { type: "Ladder Tanh", cutoff: 400, resonance: 0.2 }, { name: "Dark" });
  const bright = p.add("filter", [3, 1], { type: "SVF Multimode", mode: 1, cutoff: 2500, resonance: 0.5 }, { name: "Bright" });
  p.cable(m.amp, "l", dark, "l").cable(m.amp, "l", dark, "r").cable(m.amp, "l", bright, "l").cable(m.amp, "l", bright, "r");
  const env = p.add("adsr", [3, 2], { attack: 0.003, decay: 0.35, sustain: 0.1, release: 0.2 }, { name: "Colour Env" });
  p.cable(m.seq, "gate", env, "gate").cable(m.seq, "trigger", env, "retrig");
  const x = p.add("crossfader", [4, 0], { fade: 0.15 });
  p.stereo(dark, x, { to: ["al", "ar"] }).stereo(bright, x, { to: ["bl", "br"] }).cable(env, "env", x, "fade", 0.8);
  const d = beat(p, [0, 4], { style: "half", level: -8 });
  blend(p, [5, 0], x, d, -4, -6, ["outl", "outr"]);
  return p;
}

function linearDip() {
  const p = patch("Crossfader: Linear Curve", {
    module: "crossfader", tempo: 110,
    description: "Curve is set to Linear: two similar sustained chords are cross-faded back and forth by a triangle LFO, and the sum dips slightly in the middle where an equal-power fade would stay full. Switch Curve to Equal Power to hear the dip disappear.",
    tags: ["linear", "curve", "chords", "crossfade", "dip"],
  });
  const a = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", root: "A", scale: "Dorian", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.1, sustain: 1, release: 0.5 } });
  const b = melody(p, [0, 3], [7, "_", "_", "_", "_", "_", "_", "_", 12, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", root: "A", scale: "Dorian", octave: -1, shape: 0.4, gatelength: 1, env: { attack: 0.1, sustain: 1, release: 0.5 } });
  const x = p.add("crossfader", [4, 0], { fade: 0.5, curve: "Linear" });
  const lfo = p.add("lfo", [4, 1], { wave: "Triangle", sync: "2 bars", polarity: "Unipolar" }, { name: "Fade" });
  p.cable(a.amp, "l", x, "al").cable(a.amp, "l", x, "ar").cable(b.amp, "l", x, "bl").cable(b.amp, "l", x, "br").cable(lfo, "out", x, "fade", 0.5);
  const d = beat(p, [0, 6], { style: "four", level: -9 });
  blend(p, [5, 0], x, d, -9, -8, ["outl", "outr"]);
  return p;
}

export default [morphMelodies, drumSwap, dryWet, filterColours, linearDip];
