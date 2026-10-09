// SPDX-License-Identifier: MIT
// Six Slopes: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// Six oscillators (semitone offsets from C3 + `fine`) each through a VCA whose gain is slope i.
/// Returns the two mixers' final stage: mixer `mix` with outl/outr. Slope jack names: out1..out6.
function sixVoices(p, slopes, notes, opts = {}) {
  const mixA = p.add("audio-mixer", [3, 0], { level1: -9, level2: -9, level3: -9, level4: -9, pan1: -0.7, pan2: -0.35, pan3: 0, pan4: 0.35, master: opts.master ?? -2 }, { name: "Voices 1-4" });
  const mixB = p.add("audio-mixer", [3, 4], { level1: -9, level2: -9, level3: 0, pan1: 0.7, pan2: -0.1, master: 0 }, { name: "Voices 5-6" });
  notes.forEach((n, i) => {
    const oct = Math.round(n / 12), co = n - 12 * oct;
    const o = p.add("oscillator", [1, i], { shape: opts.shape ?? 0.3, coarse: co, octave: (oct > 0 ? "+" : "") + oct, ...(opts.osc || {}) }, { name: `Voice ${i + 1}` });
    const v = p.add("vca", [2, i], {}, { name: `Gain ${i + 1}` });
    p.cable(o, "out", v, "l").cable(slopes, `out${i + 1}`, v, "gain");
    if (i < 4) p.cable(v, "l", mixA, `in${i + 1}l`); else p.cable(v, "l", mixB, `in${i - 3}l`);
  });
  p.cable(mixB, "outl", mixA, "in4r");   // spare: keeps both mixers audible
  return { mixA, mixB };
}
function finish(p, at, mixes, verb = {}) {
  const v = p.add("reverb", at, { size: 0.5, decay: 3, damping: 0.5, mix: 0.3, quality: "Eco (8 lines)", ...verb });
  mixes.forEach((m) => p.stereo(m, v, { from: ["outl", "outr"] }));
  p.stereo(v, p.out);
}

function strummedChord() {
  const p = patch("Six Slopes: Strummed Chord", {
    module: "six-slopes", tempo: 72,
    description: "One trigger per bar fires all six slopes, but Harmonics spreads their rates so each note of a six-note chord opens a moment after the last: a strum. Turn Harmonics down to bring the notes together, Skew for plucks or swells.",
    tags: ["strum", "chord", "harmonics", "envelope"],
  });
  const clk = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/4", root: "C", scale: "Chromatic", gatelength: 0.2 },
    { data: steps([0, ".", 0, "."]) });
  const s = p.add("six-slopes", [0, 2], { rate: 3, harmonics: 0.6, skew: 0.05, curve: 0.3, mode: "AR", level: 1 });
  p.cable(clk, "gate", s, "trig1");
  // Amaj9-ish voicing in D mixolydian-free open fifths: D A E B F# C# (semitones from D2)
  const v = sixVoices(p, s, [-10, -3, 2, 7, 11, 16], { shape: 0.35, master: 6 });
  finish(p, [4, 0], [v.mixA, v.mixB], { size: 0.65, decay: 4, mix: 0.35 });
  return p;
}

function phasingChord() {
  const p = patch("Six Slopes: Phasing Pulses", {
    module: "six-slopes", tempo: 80,
    description: "In Loop mode six slopes run slightly apart (Harmonics 0.13), each swelling one chord tone, so the chord's colour drifts as the pulses phase against each other. Nudge Harmonics, Rate or Skew to change the pattern.",
    tags: ["loop", "phasing", "drift", "ambient"],
  });
  const s = p.add("six-slopes", [0, 0], { rate: 0.35, harmonics: 0.13, skew: 0.5, curve: -0.2, mode: "Loop", level: 1 });
  const drift = p.add("lfo", [0, 3], { rate: 0.03 }, { name: "Drift" });
  p.cable(drift, "out", s, "harmonics", 0.08);
  const v = sixVoices(p, s, [-12, -5, 0, 4, 7, 11], { shape: 0.5, osc: { fine: 5 } });
  finish(p, [4, 0], [v.mixA, v.mixB], { size: 0.7, decay: 5, mix: 0.4 });
  return p;
}

function polyrhythmGrid() {
  const p = patch("Six Slopes: Bar Polyrhythm", {
    module: "six-slopes", tempo: 100,
    description: "Loop mode with Sync on one bar and Snap on Integer runs six slopes at one to six cycles per bar, locked to the song: six pentatonic notes pulsing in a polyrhythm. Try Skew for short blips and Curve for sharper decays.",
    tags: ["polyrhythm", "sync", "snap", "rhythm"],
  });
  const s = p.add("six-slopes", [0, 0], { rate: 1, harmonics: 1, skew: 0.08, curve: 0.5, mode: "Loop", sync: "1/1", snap: "Integer", level: 1 });
  const v = sixVoices(p, s, [-5, 0, 3, 7, 10, 12], { shape: 0.1, master: 2 });
  finish(p, [4, 0], [v.mixA, v.mixB], { size: 0.4, decay: 2, mix: 0.25 });
  return p;
}

function slopePercussion() {
  const p = patch("Six Slopes: Six-Part Percussion", {
    module: "six-slopes", tempo: 112,
    description: "A six-track grid fires six slopes, one per drum trigger, and each shapes a different sine tone into a synthetic toms-and-blips kit. One set of Skew and Curve knobs shapes all six decays at once.",
    tags: ["percussion", "triggers", "toms", "envelopes"],
  });
  const rows = ["X...x...X..x....", "..x...x...x..x..", "....X.......X...", ".x.x...x.x.x....", "x...x...x...x..x", "....x..x........"];
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["1", "2", "3", "4", "5", "6", "", ""], [pattern("Six", rows)]) });
  const s = p.add("six-slopes", [0, 3], { skew: 0, curve: 0.6, rate: 6, mode: "AR", level: 1 });
  for (let i = 1; i <= 6; i++) p.cable(grid, `gate${i}`, s, `trig${i}`);
  const v = sixVoices(p, s, [-24, -17, -12, -5, 2, 9], { shape: 0, master: 2 });
  finish(p, [4, 0], [v.mixA, v.mixB], { size: 0.3, decay: 1.2, mix: 0.15 });
  return p;
}

function justDrone() {
  const p = patch("Six Slopes: Just Drone", {
    module: "six-slopes", tempo: 60,
    description: "In Sound mode the six slopes become audio oscillators locked to the sequencer's pitch with Snap on Just: a six-note chord in pure ratios whose spread you change with Harmonics, moved slowly by an LFO.",
    tags: ["sound mode", "just intonation", "drone", "chord"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "D", scale: "Major Pentatonic", octave: -1, gatelength: 1 },
    { data: steps([0, 7, 4, 9]) });
  const s = p.add("six-slopes", [1, 0], { rate: 100, harmonics: 0.5, tilt: -0.4, mode: "Sound", snap: "Just", level: 0.9 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.04 }, { name: "Chord Shape" });
  const vca = p.add("vca", [2, 0], { gain: 0.8 });
  p.cable(seq, "pitch", s, "pitch").cable(lfo, "out", s, "harmonics", 0.3).cable(s, "sum", vca, "l").cable(vca, "l", p.out, "l").cable(vca, "l", p.out, "r");
  return p;
}

export default [strummedChord, phasingChord, polyrhythmGrid, slopePercussion, justDrone];
