// SPDX-License-Identifier: MIT
// Uncertainty: factory presets (see ../build-modules.mjs).
export default [
  ["Slow Random Drift", { f1rate: 0.2, f2rate: 0.07, f1spread: 0.6, f2spread: 0.6 }, "Two lazy fluctuating curves: gentle analogue-style drift."],
  ["Lively Fluctuation", { f1rate: 3, f2rate: 1.7, f1spread: 1, f2spread: 1 }, "Faster, wider random curves for obvious movement."],
  ["Synced Fluctuation", { fsync: "1/2", f1spread: 0.8, f2spread: 0.5 }, "Fluctuations that move in step with the tempo."],
  ["Eighth Note Steps", { qsync: "1/8", q1bits: 3, q2bits: 2, q2divide: "/2" }, "Two random step sequences: eighths and quarters."],
  ["Sixteenth Chaos", { qsync: "1/16", q1bits: 4, q2bits: 3, q2divide: "/1" }, "Dense sixteenth-note random steps with many levels."],
  ["Octave Jumps", { qsync: "1/8", q1bits: 2, q1interval: "12 st", q2interval: "12 st" }, "Random steps in octave leaps: wild but tonal pitch jumps."],
  ["Fifths and Fourths", { qsync: "1/8", q1bits: 3, q1interval: "7 st", q2bits: 2, q2interval: "5 st" }, "Random steps in fifths and fourths: open, melodic."],
  ["Whole-Tone Walk", { qsync: "1/16", q1bits: 3, q1interval: "2 st", q2interval: "2 st" }, "Whole-tone random steps for a floating melody."],
  ["Bell Distribution", { qsync: "1/8", distribution: 0, shape: "Bell", f1spread: 0.7 }, "Values cluster near the middle, with rare extremes."],
  ["Edge Seeker", { qsync: "1/8", shape: "Edges", distribution: 0, q1bits: 2 }, "Values favour the extremes: dramatic jumps."],
  ["Biased High", { qsync: "1/8", distribution: 0.7, storesync: "1/4" }, "Stored value skewed upward: mostly high, occasionally low."],
  ["Correlated Walk", { storesync: "1/8", correlation: 0.85, integrate: 1 }, "Each stored value resembles the last: a gradual random walk."],
  ["Anti-Correlated", { storesync: "1/8", correlation: -0.8 }, "Stored values alternate high and low: a zigzag."],
  ["Integrator Wander", { storesync: "1/4", correlation: 0, integrate: 3 }, "The integrated output smooths the stored value into slow glides."],
  ["Slow Store", { storesync: "2 bars", qsync: "1 bar", f1rate: 0.1, f2rate: 0.05, integrate: 4 }, "Everything stretched over bars for evolving ambient control."],
  ["Free Clocked Chaos", { fsync: "Free", qsync: "Free", storesync: "Free", qrate: 7, storerate: 3, f1rate: 5, f2rate: 2.3, seed: 77 }, "All generators unsynced and fast: loose, jittery movement."],
];
