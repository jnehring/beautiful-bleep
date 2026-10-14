// SPDX-License-Identifier: MIT
// Quad LFO: factory presets (see ../build-modules.mjs).
export default [
  ["Quadrature Sine", { mode: "Quadrature", rate1: 0.5, wave1: "Sine", wave2: "Sine", wave3: "Sine", wave4: "Sine" }, "Four sines 90 degrees apart: circular motion for panning or filters."],
  ["Slow Drift", { mode: "Free", rate1: 0.05, rate2: 0.071, rate3: 0.093, rate4: 0.117, level1: 0.6, level2: 0.6, level3: 0.6, level4: 0.6 }, "Four unrelated very slow sines: gentle, never-repeating drift."],
  ["Vibrato Pair", { mode: "Free", rate1: 5.2, rate2: 5.6, level1: 0.5, level2: 0.5, wave1: "Sine", wave2: "Triangle" }, "Two close vibrato rates: use out1 and out2 on left and right pitch."],
  ["Wide Phase Spread", { mode: "Phase", rate1: 0.8, spread: 120, wave1: "Triangle" }, "One rate, four phases 120 degrees apart: wide stereo movement."],
  ["Triangle Cascade", { mode: "Phase", rate1: 1.5, spread: 45, wave1: "Triangle", wave2: "Triangle", wave3: "Triangle", wave4: "Triangle" }, "Closely staggered triangles for a rolling sweep across four targets."],
  ["Polyrhythm Divide", { mode: "Divide", rate1: 2, divide1: "÷1", divide2: "÷2", divide3: "÷3", divide4: "÷4", wave1: "Square", wave2: "Square", wave3: "Square", wave4: "Square" }, "Square waves divided from one rate: interlocking pulse patterns."],
  ["Synced Quarters", { mode: "Divide", sync: true, clockratio: "4", divide1: "÷1", divide2: "÷2", divide3: "÷4", divide4: "÷8", wave1: "Triangle", wave2: "Sine", wave3: "Sine", wave4: "Sine" }, "Clock-locked divisions from fast to very slow, all in tempo."],
  ["Double Time Rise", { mode: "Divide", sync: true, clockratio: "8", divide1: "×2", divide2: "÷1", divide3: "÷2", divide4: "÷4", wave1: "Saw Up", wave2: "Saw Up", wave3: "Saw Up", wave4: "Saw Up" }, "Tempo-synced rising ramps at related speeds."],
  ["Tremolo Square", { mode: "Free", rate1: 6, wave1: "Square", pw: 0.5, level1: 0.7, polarity: "Unipolar" }, "Hard on/off amplitude chop: patch out1 into a VCA."],
  ["Soft Tremolo", { mode: "Free", rate1: 4.5, wave1: "Sine", level1: 0.5, polarity: "Unipolar" }, "Smooth classic tremolo depth for an amp."],
  ["Sample and Hold Steps", { mode: "Free", rate1: 4, wave1: "Random Step", wave2: "Random Step", rate2: 3, wave3: "Random Step", rate3: 2, wave4: "Random Step", rate4: 1.5, seed: 17 }, "Four random step streams at different speeds."],
  ["Random Glide", { mode: "Free", rate1: 0.7, rate2: 0.5, rate3: 0.9, rate4: 0.4, wave1: "Random Smooth", wave2: "Random Smooth", wave3: "Random Smooth", wave4: "Random Smooth", seed: 42 }, "Smooth random wandering on four outputs: organic pad motion."],
  ["Saw Pulse Mix", { mode: "Free", rate1: 1, rate2: 2, rate3: 3, rate4: 4, wave1: "Saw Down", wave2: "Saw Up", wave3: "Square", wave4: "Triangle", pw: 0.25 }, "Four different shapes at harmonic rates: use the sum for a complex contour."],
  ["Fast Audio-ish Wobble", { mode: "Quadrature", rate1: 30, wave1: "Triangle", level1: 0.4, level2: 0.4, level3: 0.4, level4: 0.4 }, "Very fast quadrature triangles for rough FM-style modulation."],
  ["Inverted Counter-Motion", { mode: "Phase", rate1: 0.6, spread: 180, level1: 1, level2: -1, level3: 0.5, level4: -0.5, wave1: "Sine" }, "Opposed levels and phases: one rises while the other falls."],
];
