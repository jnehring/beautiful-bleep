// SPDX-License-Identifier: MIT
// Six Slopes: factory presets (see ../build-modules.mjs).
export default [
  ["Overtone Cascade", { mode: "Loop", rate: 1, harmonics: 0.5 }, "Six looping slopes at overtone ratios: rich, related motion."],
  ["Undertone Drift", { mode: "Loop", rate: 4, harmonics: -0.5 }, "Slopes spread downward: slower and slower layers."],
  ["Unison Pulse", { mode: "Loop", rate: 2, harmonics: 0, skew: 0.5 }, "All six at one rate: use the sum or stagger with triggers."],
  ["Six Plucks", { mode: "AR", rate: 8, harmonics: 0.3, skew: 0.05, curve: 0.5 }, "Fast attack decays on each trigger: six different plucks."],
  ["Swell Gates", { mode: "ASR", rate: 1.5, skew: 0.4, curve: -0.2 }, "Rise, hold while gated, fall: six sustained envelopes."],
  ["Slow Breath", { mode: "Loop", rate: 0.1, harmonics: 0.2, skew: 0.5, curve: -0.3 }, "Ten-second cycles: very slow evolving modulation."],
  ["Synced Eighths", { mode: "Loop", sync: "1/8", harmonics: 0.3, skew: 0.5 }, "Tempo-locked slopes with overtone ratios."],
  ["Quarter Note Saws", { mode: "Loop", sync: "1/4", skew: 0.95, harmonics: 0 }, "Rising ramps locked to the beat."],
  ["Just Intervals", { mode: "Loop", rate: 3, harmonics: 0.7, snap: "Just" }, "Rates snapped to just-intonation ratios: consonant polyrhythms."],
  ["Integer Ratios", { mode: "Loop", rate: 2, harmonics: 0.7, snap: "Integer" }, "Whole-number rate ratios: layers that realign cleanly."],
  ["Bipolar Wander", { mode: "Loop", rate: 0.4, harmonics: 0.4, polarity: "Bipolar", curve: 0.2 }, "Bipolar outputs for pitch or pan wandering."],
  ["Tilted Levels", { mode: "Loop", rate: 1, harmonics: 0.4, tilt: 0.6 }, "Higher slopes louder: emphasises the faster layers."],
  ["Audio Rate Slopes", { mode: "Sound", rate: 220, harmonics: 0.5, skew: 0.5 }, "Slopes as audio oscillators at harmonic ratios."],
  ["Sharp Curves", { mode: "Loop", rate: 3, curve: 0.9, skew: 0.2, level: 0.8 }, "Strongly curved spikes: percussive modulation."],
];
