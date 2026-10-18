// SPDX-License-Identifier: MIT
// Compressor: five demo patches. Each plays by itself with the transport.
import { patch, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function pumpingPad() {
  const p = patch("Compressor: Kick-Ducked Pad", {
    module: "compressor", tempo: 118,
    description: "A sustained saw pad runs through the Compressor while the kick drum feeds its Key input: every kick pushes the pad down and it swells back between beats. Lower Threshold or lengthen Release for a deeper, slower pump.",
    tags: ["sidechain", "pumping", "ducking", "dance"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 1, gatelength: 0.98, root: "A", scale: "Natural Minor", env: { attack: 0.1, decay: 0.3, sustain: 0.9, release: 0.4 } });
  const grid = p.add("drum-grid", [0, 3], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Tom", "Tom 2", "Perc"],
    [pattern("Kick", ["X...X...X...X...", "", "..x...x...x...x.", "", "", "", "", ""])]) });
  const kick = p.add("punch-kick", [1, 3], { level: 0.9 });
  const hats = p.add("punch-hats", [1, 4], { level: 0.5 });
  const c = p.add("compressor", [3, 0], { threshold: -40, ratio: 12, attack: 1, release: 220, knee: 2, makeup: 8, detector: "Peak" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity").cable(grid, "gate3", hats, "closed").cable(grid, "velocity3", hats, "velocity");
  feed(p, m.amp, c);
  p.cable(kick, "out", c, "key");
  const mix = p.add("audio-mixer", [4, 0], { level1: -4, level2: -5, level3: -14, master: -2 });
  p.stereo(c, mix, { to: ["in1l", "in1r"] }).cable(kick, "out", mix, "in2l").cable(kick, "out", mix, "in2r")
    .cable(hats, "out", mix, "in3l").cable(hats, "out", mix, "in3r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function drumSquash() {
  const p = patch("Compressor: Parallel Drum Squash", {
    module: "compressor", tempo: 96,
    description: "A broken beat is flattened with a high Ratio, fast Attack and a lot of Makeup, then blended back with Mix at about half: the room and tails come up while the hits keep their punch. Sweep Mix from 0 to 100 % to hear what the squash adds.",
    tags: ["drums", "parallel", "new york", "squash"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -6 });
  const c = p.add("compressor", [3, 0], { threshold: -32, ratio: 20, attack: 0.5, release: 80, knee: 0, makeup: 14, mix: 0.5, detector: "Peak" });
  p.stereo(d, c, { from: ["outl", "outr"] });
  out(p, [4, 0], c, 3);
  return p;
}

function bassLeveller() {
  const p = patch("Compressor: Bass Leveller", {
    module: "compressor", tempo: 104,
    description: "A bass line with wildly different velocities is evened out by an RMS Compressor with a soft Knee, so soft notes sit as firmly as loud ones. Raise Threshold until the quiet notes drop back out again.",
    tags: ["bass", "levelling", "rms", "soft knee"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 7, ".", 0, 5, ".", 0, ".", 3, 0, 7, ".", 5, 3],
    { rate: "1/8", shape: 0.4, octave: -2, gatelength: 0.6, root: "D", scale: "Natural Minor", vel: [127, 35, 90, 25, 110, 45, 70, 30],
      env: { attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.1 } });
  const c = p.add("compressor", [3, 0], { threshold: -30, ratio: 6, attack: 8, release: 150, knee: 18, makeup: 6, detector: "RMS" });
  feed(p, m.amp, c);
  const d = beat(p, [0, 3], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: 0, master: -1 });
  p.stereo(c, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function reductionFilter() {
  const p = patch("Compressor: Reduction Opens the Filter", {
    module: "compressor", tempo: 110,
    description: "The Compressor's Reduction output is a control signal that rises with every kick, and here it also closes a Multi Filter on the pad: the sound ducks and darkens on each hit. Raise the cable amount or lower Threshold for a heavier effect.",
    tags: ["reduction output", "modulation", "sidechain", "filter"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_"],
    { rate: "1/4", shape: 1, gatelength: 0.98, root: "G", scale: "Minor Pentatonic", env: { attack: 0.1, decay: 0.3, sustain: 0.9, release: 0.4 } });
  const grid = p.add("drum-grid", [0, 3], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Tom", "Tom 2", "Perc"],
    [pattern("Kick", ["X..x..X...X.x...", "....X.......X...", "", "", "", "", "", ""])]) });
  const kick = p.add("punch-kick", [1, 3], { level: 0.9 });
  const sn = p.add("punch-snare", [1, 4], { level: 0.5 });
  const f = p.add("filter", [2, 0], { cutoff: 4500, resonance: 0.3, mode: "LP" });
  const c = p.add("compressor", [4, 0], { threshold: -30, ratio: 8, attack: 1, release: 250, knee: 3, makeup: 6 });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity").cable(grid, "gate2", sn, "trig").cable(grid, "velocity2", sn, "velocity");
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r").stereo(f, c);
  p.cable(kick, "out", c, "key").cable(c, "reduction", f, "cutoff", -0.7);
  const mix = p.add("audio-mixer", [5, 0], { level1: -5, level2: -5, level3: -9, master: -2 });
  p.stereo(c, mix, { to: ["in1l", "in1r"] }).cable(kick, "out", mix, "in2l").cable(kick, "out", mix, "in2r")
    .cable(sn, "out", mix, "in3l").cable(sn, "out", mix, "in3r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function pluckSustainer() {
  const p = patch("Compressor: Pluck Sustainer", {
    module: "compressor", tempo: 90,
    description: "Short plucks pass through a very fast, high-ratio Compressor with high Makeup: the tails are pulled up so every note rings on like a held string. Lengthen Release to hear the sustain breathe, or cut Makeup to hear the plain pluck.",
    tags: ["sustain", "pluck", "fast attack", "makeup"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 5, 12, 10, 7, 3, 7, 0, "."],
    { rate: "1/4", shape: 0.5, root: "E", scale: "Minor Pentatonic", gatelength: 0.7, env: { attack: 0.002, decay: 1.0, sustain: 0.15, release: 0.4 } });
  const c = p.add("compressor", [3, 0], { threshold: -30, ratio: 8, attack: 0.3, release: 120, knee: 6, makeup: 12, detector: "Peak" });
  feed(p, m.amp, c);
  out(p, [4, 0], c, 6);
  return p;
}

export default [pumpingPad, drumSquash, bassLeveller, reductionFilter, pluckSustainer];
