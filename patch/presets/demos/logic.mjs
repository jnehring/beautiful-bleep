// SPDX-License-Identifier: MIT
// Logic: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Drum Grid with the given rows (one 16-step string per track); gate n is track n.
function grid(p, at, rows, name = "Gates") {
  const names = ["A", "B", "C", "D", "Clap", "Tom", "Tom 2", "Perc"];
  return p.add("drum-grid", at, {}, { name, data: drumGrid(names, [pattern("Pattern", rows)]) });
}

/// Drum voices (kick, snare, closed/open hat, clap, rim) with a mixer; returns the voices and the mixer.
function kit(p, at, levels = {}) {
  const [c, r] = at;
  const kick = p.add("punch-kick", [c, r], { level: 0.8 });
  const snare = p.add("punch-snare", [c, r + 1], { level: 0.6 });
  const hats = p.add("punch-hats", [c, r + 2], { level: 0.5 });
  const rim = p.add("punch-rim", [c, r + 3], { level: 0.6, tune: 4 });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: -3, level2: -6, level3: -11, level4: -9, pan2: 0.1, pan3: 0.3, pan4: -0.3, master: 0, ...levels },
    { name: "Drum Mix" });
  p.cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(snare, "out", mix, "in2l").cable(snare, "out", mix, "in2r")
    .cable(hats, "out", mix, "in3l").cable(hats, "out", mix, "in3r").cable(rim, "out", mix, "in4l").cable(rim, "out", mix, "in4r");
  return { kick, snare, hats, rim, mix };
}

function toReverb(p, at, src, verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.8, mix: 0.18, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function lanes() {
  const p = patch("Logic: Two Lanes, Three Drums", {
    module: "logic", tempo: 112,
    description: "Two gate patterns, one irregular and one straight eighths, feed the Logic module: where both hit (And) the kick plays, where only one does (Xor) the snare, and Or adds a soft hat on every hit of either. Change either lane on the Drum Grid and the drums rearrange themselves.",
    tags: ["and", "or", "xor", "gates", "drums"],
  });
  const g2 = grid(p, [0, 0], ["x..x..x...x..x..", "x.x.x.x.x.x.x.x.", "", ""], "Lanes");
  const l = p.add("logic", [1, 0], {});
  const k = kit(p, [2, 0]);
  p.cable(g2, "gate1", l, "a").cable(g2, "gate2", l, "b").cable(l, "and", k.kick, "trig").cable(l, "xor", k.snare, "trig")
    .cable(l, "or", k.hats, "closed");
  const m = melody(p, [0, 4], [0, ".", 0, ".", 3, ".", 5, ".", 0, ".", 0, ".", 7, ".", 5, "."], { rate: "1/8", shape: 0.4, root: "E", scale: "Natural Minor", octave: -2, gatelength: 0.7,
    env: { decay: 0.25, sustain: 0.3, release: 0.1 } });
  const out = p.add("audio-mixer", [5, 0], { level1: 0, level2: -3, master: -4 });
  p.stereo(k.mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(m.amp, "l", out, "in2l").cable(m.amp, "l", out, "in2r");
  toReverb(p, [6, 0], out, {});
  return p;
}

function flipflop() {
  const p = patch("Logic: Flip-Flop Beat Swap", {
    module: "logic", tempo: 108,
    description: "Each kick flips the flip-flop, so its output is high on one beat and low on the next; one arpeggio plays while it is high and a second one while it is low, taken from a chained Logic module that inverts it. Speed up the flips for a stutter, or reset them for a fixed phrase.",
    tags: ["flip-flop", "toggle", "divide", "alternate"],
  });
  const g = grid(p, [0, 4], ["X...X...X...X...", "", "", ""], "Kicks");
  const l = p.add("logic", [1, 3], {}, { name: "Flip-Flop" });
  const inv = p.add("logic", [2, 3], {}, { name: "Inverter" });
  p.cable(g, "gate1", l, "flip").cable(l, "ff", inv, "a");
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 3, 7, 12, 7, 3, 10, 7, 5, 8, 12, 15, 12, 8, 7, 3]) });
  const env = p.add("adsr", [1, 0], { attack: 0.003, decay: 0.2, sustain: 0.1, release: 0.15 }, { name: "Note Env" });
  const oA = p.add("oscillator", [1, 1], { shape: 0.85 }, { name: "Saw Arp" });
  const oB = p.add("oscillator", [1, 2], { shape: 0.1, octave: "+1" }, { name: "Soft Arp" });
  const vA = p.add("vca", [2, 1], {});
  const vB = p.add("vca", [2, 2], {});
  const gA = p.add("adsr", [3, 1], { attack: 0.01, decay: 0.1, sustain: 1, release: 0.05 }, { name: "Layer A" });
  const gB = p.add("adsr", [3, 2], { attack: 0.01, decay: 0.1, sustain: 1, release: 0.05 }, { name: "Layer B" });
  const wA = p.add("vca", [4, 1], {});
  const wB = p.add("vca", [4, 2], {});
  p.cable(seq, "pitch", oA, "pitch").cable(seq, "pitch", oB, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(oA, "out", vA, "l").cable(oB, "out", vB, "l").cable(env, "env", vA, "gain").cable(env, "env", vB, "gain")
    .cable(vA, "l", wA, "l").cable(vB, "l", wB, "l").cable(l, "ff", gA, "gate").cable(inv, "nota", gB, "gate")
    .cable(gA, "env", wA, "gain").cable(gB, "env", wB, "gain");
  const k = p.add("punch-kick", [2, 5], { level: 0.8 });
  const dk = p.add("punch-hats", [3, 5], { level: 0.5 });
  p.cable(g, "gate1", k, "trig").cable(g, "gate2", dk, "closed");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -3, level3: -2, level4: -12, pan1: -0.3, pan2: 0.3, master: -6 });
  p.cable(wA, "l", mix, "in1l").cable(wA, "l", mix, "in1r").cable(wB, "l", mix, "in2l").cable(wB, "l", mix, "in2r")
    .cable(k, "out", mix, "in3l").cable(k, "out", mix, "in3r").cable(dk, "out", mix, "in4l").cable(dk, "out", mix, "in4r");
  toReverb(p, [6, 0], mix, { size: 0.5, decay: 2.2, mix: 0.22 });
  return p;
}

function edges() {
  const p = patch("Logic: Edge Detectors", {
    module: "logic", tempo: 120,
    description: "A square wave is fed into Logic, and its Rise output fires a kick when the wave goes up, Fall a snare when it comes down, and Change a closed hat at either edge. Narrow the square's pulse width and the snare moves away from the kick.",
    tags: ["rise", "fall", "change", "edge", "triggers"],
  });
  const sq = p.add("lfo", [0, 0], { wave: "Square", sync: "1/4", polarity: "Unipolar", pw: 0.3 }, { name: "Square" });
  const l = p.add("logic", [1, 0], {});
  const k = kit(p, [2, 0]);
  p.cable(sq, "out", l, "a").cable(l, "rise", k.kick, "trig").cable(l, "fall", k.snare, "trig").cable(l, "change", k.hats, "closed");
  const m = melody(p, [0, 4], [0, 7, 3, 10, 12, 10, 7, 3], { rate: "1/8", shape: 0.7, root: "G", scale: "Dorian", octave: 0, gatelength: 0.4,
    env: { decay: 0.2, sustain: 0.1, release: 0.15 } });
  const out = p.add("audio-mixer", [5, 0], { level1: 0, level2: -4, master: -5 });
  p.stereo(k.mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(m.amp, "l", out, "in2l").cable(m.amp, "l", out, "in2r");
  toReverb(p, [6, 0], out, {});
  return p;
}

function nands() {
  const p = patch("Logic: Nor, Nand and Not", {
    module: "logic", tempo: 104,
    description: "Three square waves at different speeds are combined three ways: Nor fires the kick when all of them are low, Nand the snare when any one drops, and Not-A a rim on the second half of A's cycle. Change any wave's speed to find new patterns.",
    tags: ["nor", "nand", "not", "gates", "rhythm"],
  });
  const a = p.add("lfo", [0, 0], { wave: "Square", sync: "1/2", polarity: "Unipolar" }, { name: "A (half)" });
  const b = p.add("lfo", [0, 1], { wave: "Square", sync: "1/4", polarity: "Unipolar" }, { name: "B (quarter)" });
  const c = p.add("lfo", [0, 2], { wave: "Square", sync: "1/8", polarity: "Unipolar", pw: 0.4 }, { name: "C (eighth)" });
  const l = p.add("logic", [1, 0], {});
  const k = kit(p, [2, 0]);
  p.cable(a, "out", l, "a").cable(b, "out", l, "b").cable(c, "out", l, "c").cable(l, "nor", k.kick, "trig")
    .cable(l, "nand", k.snare, "trig").cable(l, "nota", k.rim, "trig");
  const m = melody(p, [0, 4], [0, ".", 7, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.5, root: "F", scale: "Natural Minor", octave: -1, gatelength: 0.6,
    env: { decay: 0.3, sustain: 0.3, release: 0.15 } });
  const out = p.add("audio-mixer", [5, 0], { level1: -2, level2: -2, master: -3 });
  p.stereo(k.mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(m.amp, "l", out, "in2l").cable(m.amp, "l", out, "in2r");
  toReverb(p, [6, 0], out, {});
  return p;
}

function poly() {
  const p = patch("Logic: Three Lengths Collide", {
    module: "logic", tempo: 110,
    description: "Three sequencers of three, four and five steps run in parallel and drift in and out of phase; Logic turns their gates into a drum part, with And as a rare accent on the kick, Xor on the rim and Or on the hats. Change a sequencer's Length and the whole rhythm shifts.",
    tags: ["polyrhythm", "and", "xor", "or", "sequencers", "phasing"],
  });
  const mk = (len, pat, row, name) => p.add("step-sequencer", [0, row], { length: len, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.4 },
    { name, data: steps(pat) });
  const s3 = mk(3, [0, 0, "."], 0, "Three");
  const s4 = mk(4, [0, ".", 0, "."], 1, "Four");
  const s5 = mk(5, [0, ".", 0, 0, "."], 2, "Five");
  const l = p.add("logic", [1, 0], {});
  const k = kit(p, [2, 0]);
  p.cable(s3, "gate", l, "a").cable(s4, "gate", l, "b").cable(s5, "gate", l, "c")
    .cable(l, "and", k.kick, "trig").cable(l, "xor", k.rim, "trig").cable(l, "or", k.hats, "closed").cable(l, "nor", k.snare, "trig");
  const lead = p.add("step-sequencer", [0, 4], { length: 15, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.4 },
    { data: steps([0, 3, 7, 3, 12, 7, 3, 0, 5, 7, 10, 7, 12, 10, 7]) });
  const osc = p.add("oscillator", [1, 4], { shape: 0.6 });
  const env = p.add("adsr", [1, 5], { attack: 0.004, decay: 0.2, sustain: 0.1, release: 0.15 });
  const vca = p.add("vca", [2, 4], {});
  p.cable(lead, "pitch", osc, "pitch").cable(lead, "gate", env, "gate").cable(lead, "trigger", env, "retrig").cable(osc, "out", vca, "l").cable(env, "env", vca, "gain");
  const out = p.add("audio-mixer", [5, 0], { level1: -1, level2: -5, master: -3 });
  p.stereo(k.mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(vca, "l", out, "in2l").cable(vca, "l", out, "in2r");
  toReverb(p, [6, 0], out, {});
  return p;
}

export default [lanes, flipflop, edges, nands, poly];
