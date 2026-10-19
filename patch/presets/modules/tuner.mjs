// SPDX-License-Identifier: GPL-3.0-or-later
// Tuner: factory presets (see ../build-modules.mjs).
export default [
  ["Standard", { reference: 440, tolerance: 5, damping: 0.08, low: 40, high: 1400, names: "Sharps", guard: "Light" }, "Concert pitch, A = 440 Hz."],
  ["Baroque 415", { reference: 415, tolerance: 5, damping: 0.1, low: 40, high: 1400, names: "Flats", guard: "Light" }, "A = 415 Hz, a semitone lower, for period instruments."],
  ["Bright 442", { reference: 442, tolerance: 4, damping: 0.08, low: 60, high: 2000, names: "Sharps", guard: "Light" }, "A = 442 Hz, as many orchestras tune."],
  ["Warm 432", { reference: 432, tolerance: 5, damping: 0.1, low: 40, high: 1400, names: "Sharps", guard: "Light" }, "A = 432 Hz."],
  ["Bass Tuner", { reference: 440, tolerance: 4, damping: 0.14, low: 28, high: 400, names: "Sharps", guard: "Firm" }, "Low range for bass strings; slower and steadier."],
  ["Guitar", { reference: 440, tolerance: 3, damping: 0.1, low: 70, high: 1000, names: "Sharps", guard: "Light" }, "Six strings and a tight in-tune window."],
  ["Violin and Voice", { reference: 440, tolerance: 6, damping: 0.08, low: 180, high: 2500, names: "Flats", guard: "Light" }, "High range for strings and singers, with a forgiving window."],
  ["Strict", { reference: 440, tolerance: 2, damping: 0.15, low: 40, high: 1400, names: "Sharps", guard: "Firm" }, "Only within two cents counts as in tune."],
  ["Loose", { reference: 440, tolerance: 12, damping: 0.05, low: 40, high: 1400, names: "Sharps", guard: "Light" }, "A wide window for a quick check of a rough sound."],
  ["Slow Needle", { reference: 440, tolerance: 5, damping: 0.4, low: 40, high: 1400, names: "Sharps", guard: "Firm" }, "The needle takes its time and hardly twitches."],
  ["Fast Needle", { reference: 440, tolerance: 5, damping: 0.02, low: 40, high: 1400, names: "Sharps", guard: "Off" }, "Shows every movement at once, e.g. to watch a vibrato."],
];
