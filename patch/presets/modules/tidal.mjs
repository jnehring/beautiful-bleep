// SPDX-License-Identifier: MIT
// Tidal: factory presets (see ../build-modules.mjs).
export default [
  ["Gentle Loop", { mode: "Loop", freq: 1, skew: 0.5, range: "Medium" }, "A plain 1 Hz triangle-like loop with four related outputs."],
  ["Slow Tide", { mode: "Loop", freq: 0.05, range: "Slow", skew: 0.5, smooth: 0.5 }, "Minute-long swells: ambient filter and level motion."],
  ["Rising Saw", { mode: "Loop", freq: 2, skew: 0.95, curve: 0 }, "Ramp up then quick drop: repeating risers."],
  ["Falling Saw", { mode: "Loop", freq: 2, skew: 0.05, curve: 0 }, "Instant rise and linear fall: sidechain-like pumping."],
  ["Plucked AD", { mode: "AD", freq: 6, skew: 0.02, curve: 0.7 }, "One-shot attack and decay per trigger: a snappy envelope."],
  ["Pad AR", { mode: "AR", freq: 0.4, skew: 0.4, curve: -0.3, smooth: 0.4 }, "Rise while held, fall on release: a soft pad envelope."],
  ["Synced Quarter", { mode: "Loop", sync: "1/4", skew: 0.5 }, "Locked to the tempo at quarter notes."],
  ["Synced Dotted Eighth", { mode: "Loop", sync: "1/8.", skew: 0.3, curve: 0.4 }, "Dotted-eighth swells for rhythmic filter movement."],
  ["Wide Phase Outputs", { mode: "Loop", freq: 0.8, relation: "Phase", spread: 0.8 }, "Four outputs at different phases: stereo or multi-target motion."],
  ["Harmonic Stack", { mode: "Loop", freq: 1, relation: "Harmonic", spread: 0.7 }, "Outputs carry harmonics of the main rate: complex contours."],
  ["Ratio Cluster", { mode: "Loop", freq: 0.7, relation: "Ratio", ratio: "×3", spread: 0.6 }, "Outputs at related speeds, starting from a triplet ratio."],
  ["Level Fan", { mode: "Loop", freq: 1.2, relation: "Level", spread: 0.8 }, "Same rate, four different depths for scaled modulation."],
  ["Smooth Sine-ish", { mode: "Loop", freq: 3, smooth: 0.9, skew: 0.5 }, "Heavily smoothed slope: nearly a sine for vibrato."],
  ["Bipolar Wobble", { mode: "Loop", freq: 5, polarity: "Bipolar", smooth: 0.3, skew: 0.5 }, "Centred wobble for vibrato and pitch effects."],
  ["Unipolar Pump", { mode: "Loop", freq: 2, polarity: "Unipolar", skew: 0.1, curve: 0.6 }, "Positive-only fast-attack pump for ducking."],
  ["Audio Rate Tone", { mode: "Loop", freq: 20, range: "Audio", skew: 0.5, smooth: 0.2 }, "Slope oscillator at audio rate: a raw, lo-fi tone source."],
];
