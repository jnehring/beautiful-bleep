// SPDX-License-Identifier: MIT
// Coin Toss: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Drum Grid with the given rows (one 16-step string per track); gate n is track n.
function grid(p, at, rows, name = "Gates") {
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  return p.add("drum-grid", at, {}, { name, data: drumGrid(names, [pattern("Pattern", rows)]) });
}

function toReverb(p, at, src, jacks = ["outl", "outr"], verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.8, mix: 0.18, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, v, { from: jacks }).stereo(v, p.out);
}

function kickOrSnare() {
  const p = patch("Coin Toss: Kick or Snare", {
    module: "coin-toss", tempo: 110,
    description: "Every eighth-note gate is sent either to a kick or to a snare by a fair coin, so the backbeat is never the same twice, over a fixed hat and bass line. Push Probability 1 up for more kicks, or change Seed for a different run of luck.",
    tags: ["probability", "drums", "random", "kick snare"],
  });
  const g = grid(p, [0, 0], ["x.x.x.x.x.x.x.x.", "x.xxx.xxx.xxx.xx", "", ""], "Eighths");
  const c = p.add("coin-toss", [1, 0], { prob1: 0.5, seed: 8 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.7 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.5 });
  p.cable(g, "gate1", c, "in1").cable(c, "a1", kick, "trig").cable(c, "b1", snare, "trig").cable(g, "gate2", hats, "closed");
  const m = melody(p, [0, 4], [0, ".", 0, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.3, root: "G", scale: "Natural Minor", octave: -2, gatelength: 0.7,
    env: { decay: 0.25, sustain: 0.4, release: 0.1 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -5, level3: -12, level4: -2, pan2: 0.1, pan3: 0.3, master: -6 });
  p.cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(snare, "out", mix, "in2l").cable(snare, "out", mix, "in2r")
    .cable(hats, "out", mix, "in3l").cable(hats, "out", mix, "in3r").cable(m.amp, "l", mix, "in4l").cable(m.amp, "l", mix, "in4r");
  toReverb(p, [5, 0], mix);
  return p;
}

function hats() {
  const p = patch("Coin Toss: Weighted Hats", {
    module: "coin-toss", tempo: 124,
    description: "A steady sixteenth-note stream is split by a loaded coin: four tosses in five give a closed hat and the rest an open one, over a plain kick and clap. Move Probability 1 toward 0.5 for a busier, more open hat line.",
    tags: ["probability", "weighted", "hi-hat", "groove"],
  });
  const g = grid(p, [0, 0], ["xxxxxxxxxxxxxxxx", "", "", ""], "Sixteenths");
  const c = p.add("coin-toss", [1, 0], { prob1: 0.8, seed: 21, loop: "16 tosses" });
  const hat = p.add("punch-hats", [2, 0], { level: 0.5, open: 0.25 });
  p.cable(g, "gate1", c, "in1").cable(c, "a1", hat, "closed").cable(c, "b1", hat, "open");
  const drums = p.add("drum-grid", [0, 3], {}, { name: "Backbone", data: drumGrid(["Kick", "Clap", "", "", "", "", "", ""],
    [pattern("Backbone", ["X...X...X...X...", "....x.......x..."])]) });
  const kick = p.add("punch-kick", [2, 3], { level: 0.8 });
  const clap = p.add("punch-clap", [2, 4], { level: 0.6 });
  p.cable(drums, "gate1", kick, "trig").cable(drums, "gate2", clap, "trig");
  const m = melody(p, [0, 6], [0, ".", ".", 7, ".", 3, ".", "."], { rate: "1/8", shape: 0.5, root: "A", scale: "Minor Pentatonic", octave: -1, gatelength: 0.5,
    env: { decay: 0.3, sustain: 0.2, release: 0.1 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -9, level2: -3, level3: -6, level4: -3, pan1: 0.2, master: -5 });
  p.cable(hat, "out", mix, "in1l").cable(hat, "out", mix, "in1r").cable(kick, "out", mix, "in2l").cable(kick, "out", mix, "in2r")
    .cable(clap, "out", mix, "in3l").cable(clap, "out", mix, "in3r").cable(m.amp, "l", mix, "in4l").cable(m.amp, "l", mix, "in4r");
  toReverb(p, [5, 0], mix);
  return p;
}

function fate() {
  const p = patch("Coin Toss: Looped Fate", {
    module: "coin-toss", tempo: 96,
    description: "Eight eighth-note tosses decide whether a low note or a high note sounds, and Loop makes the same eight outcomes repeat, so a tune made by chance settles into a pattern you can hum. Set Loop to Off and it never repeats; change Seed for another tune.",
    tags: ["loop", "seed", "generative", "melody"],
  });
  const g = grid(p, [0, 0], ["x.x.x.x.x.x.x.x.", "", "", ""], "Eighths");
  const c = p.add("coin-toss", [1, 0], { prob1: 0.55, loop: "8 tosses", seed: 17 });
  const oA = p.add("oscillator", [2, 0], { shape: 0.8, coarse: -3, octave: "-1" }, { name: "Low Note" });
  const oB = p.add("oscillator", [2, 1], { shape: 0.5, coarse: 4 }, { name: "High Note" });
  const eA = p.add("adsr", [3, 0], { attack: 0.004, decay: 0.3, sustain: 0.2, release: 0.2 }, { name: "Low Env" });
  const eB = p.add("adsr", [3, 1], { attack: 0.004, decay: 0.25, sustain: 0.1, release: 0.2 }, { name: "High Env" });
  const vA = p.add("vca", [4, 0], {});
  const vB = p.add("vca", [4, 1], {});
  p.cable(g, "gate1", c, "in1").cable(c, "a1", eA, "gate").cable(c, "b1", eB, "gate").cable(oA, "out", vA, "l").cable(oB, "out", vB, "l")
    .cable(eA, "env", vA, "gain").cable(eB, "env", vB, "gain");
  const d = beat(p, [0, 4], { style: "sparse", level: -8 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 4, level2: 3, level3: -2, pan1: -0.3, pan2: 0.3, master: 0 });
  p.cable(vA, "l", mix, "in1l").cable(vA, "l", mix, "in1r").cable(vB, "l", mix, "in2l").cable(vB, "l", mix, "in2r")
    .stereo(d, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  toReverb(p, [6, 0], mix, ["outl", "outr"], { size: 0.5, decay: 2.4, mix: 0.25 });
  return p;
}

function roulette() {
  const p = patch("Coin Toss: Chord Roulette", {
    module: "coin-toss", tempo: 68,
    description: "Once a bar the coin picks one of two pads, an A minor chord or an F major chord; in Latch mode the chosen side stays on until the next toss, so one chord always sounds. Raise Memory 1 and the coin tends to repeat the last result.",
    tags: ["latch", "memory", "chords", "pads", "generative"],
  });
  const bar = p.add("lfo", [0, 0], { wave: "Square", sync: "1 bar", polarity: "Unipolar", pw: 0.2 }, { name: "Bar" });
  const c = p.add("coin-toss", [1, 0], { prob1: 0.5, mode1: "Latch", memory1: 0.25, seed: 5 });
  const mk = (row, coarses, name) => coarses.map((cs, i) => p.add("oscillator", [2, row + i * 0.5], { shape: 0.65, coarse: cs, fine: (i - 1) * 6 }, { name: `${name} ${i + 1}` }));
  const a = mk(0, [-3, 0, 4], "Am");
  const f = mk(2, [-7, -3, 0], "F");
  const mx = (nodes, row) => {
    const m = p.add("audio-mixer", [3, row], { level1: -10, level2: -12, level3: -12, pan1: -0.4, pan3: 0.4, master: 0 });
    nodes.forEach((o, i) => p.cable(o, "out", m, `in${i + 1}l`).cable(o, "out", m, `in${i + 1}r`));
    return m;
  };
  const ma = mx(a, 0), mf = mx(f, 2);
  const ea = p.add("adsr", [4, 0], { attack: 0.8, decay: 0.5, sustain: 1, release: 1.4 }, { name: "Am Env" });
  const ef = p.add("adsr", [4, 2], { attack: 0.8, decay: 0.5, sustain: 1, release: 1.4 }, { name: "F Env" });
  const va = p.add("vca", [5, 0], {});
  const vf = p.add("vca", [5, 2], {});
  p.cable(bar, "out", c, "in1").cable(c, "a1", ea, "gate").cable(c, "b1", ef, "gate")
    .stereo(ma, va, { from: ["outl", "outr"] }).stereo(mf, vf, { from: ["outl", "outr"] }).cable(ea, "env", va, "gain").cable(ef, "env", vf, "gain");
  const sum = p.add("audio-mixer", [6, 0], { level1: 0, level2: 0, master: -9 });
  p.stereo(va, sum, { to: ["in1l", "in1r"] }).stereo(vf, sum, { to: ["in2l", "in2r"] });
  const flt = p.add("filter", [7, 0], { cutoff: 1500, resonance: 0.1, type: "SVF Multimode" });
  p.stereo(sum, flt, { from: ["outl", "outr"] });
  const v = p.add("reverb", [8, 0], { size: 0.75, decay: 5.5, mix: 0.33, quality: "Eco (8 lines)" });
  p.stereo(flt, v).stereo(v, p.out);
  return p;
}

function opposed() {
  const p = patch("Coin Toss: Opposed Channels", {
    module: "coin-toss", tempo: 118,
    description: "With Link set to Opposed, channel 2 always chooses the other side from channel 1: when the first coin sends a gate to the kick, the second sends its gate to the hat, and the other way round. Try Shared to make both coins land together.",
    tags: ["opposed", "link", "two channels", "drums"],
  });
  const g = grid(p, [0, 0], ["x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "", ""], "Eighths");
  const c = p.add("coin-toss", [1, 0], { prob1: 0.5, prob2: 0.5, link: "Opposed", seed: 12 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const tom = p.add("punch-tom", [2, 2], { tune: 140, decay: 0.3 });
  const hat = p.add("punch-hats", [2, 3], { level: 0.5 });
  p.cable(g, "gate1", c, "in1").cable(g, "gate2", c, "in2").cable(c, "a1", kick, "trig").cable(c, "b1", snare, "trig")
    .cable(c, "a2", tom, "trig").cable(c, "b2", hat, "closed");
  const m = melody(p, [0, 5], [0, 7, 3, 10, 12, 10, 7, 3], { rate: "1/8", shape: 0.8, root: "C", scale: "Dorian", gatelength: 0.4, env: { decay: 0.18, sustain: 0.1, release: 0.1 } });
  const f = p.add("filter", [3, 5], { cutoff: 500, resonance: 0.3, type: "Ladder Tanh" });
  p.cable(m.amp, "l", f, "l").cable(c, "coin1", f, "cutoff", 0.3);
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -6, level3: -6, level4: -12, pan3: -0.3, pan4: 0.3, master: -3 });
  p.cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(snare, "out", mix, "in2l").cable(snare, "out", mix, "in2r")
    .cable(tom, "out", mix, "in3l").cable(tom, "out", mix, "in3r").cable(hat, "out", mix, "in4l").cable(hat, "out", mix, "in4r");
  const out = p.add("audio-mixer", [5, 0], { level1: 0, level2: -5, master: 0 });
  p.stereo(mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(f, "l", out, "in2l").cable(f, "l", out, "in2r");
  toReverb(p, [6, 0], out);
  return p;
}

export default [kickOrSnare, hats, fate, roulette, opposed];
