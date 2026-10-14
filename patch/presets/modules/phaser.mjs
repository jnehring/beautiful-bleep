// SPDX-License-Identifier: MIT
// Phaser: factory presets (see ../build-modules.mjs).
export default [
  ["Classic Phase", { rate: 0.3, depth: 0.6, centre: 700, feedback: 0.4, stages: "4", spread: 0.5, mix: 0.5 }, "Warm four-stage phaser."],
  ["Gentle Swirl", { rate: 0.15, depth: 0.4, centre: 900, feedback: 0.2, stages: "4", mix: 0.4 }, "Slow, subtle movement on pads and keys."],
  ["Deep Sweep", { rate: 0.2, depth: 0.9, centre: 600, feedback: 0.6, stages: "8", spread: 0.6, mix: 0.55 }, "Wide, dramatic sweep."],
  ["Two-Stage Wobble", { rate: 0.5, depth: 0.5, centre: 1200, feedback: 0.3, stages: "2", mix: 0.5 }, "Light, airy phase with one notch."],
  ["Twelve Stage Glass", { rate: 0.25, depth: 0.7, centre: 1000, feedback: 0.5, stages: "12", spread: 0.7, mix: 0.5 }, "Dense, glassy notches."],
  ["Stereo Spin", { rate: 0.4, depth: 0.7, centre: 800, feedback: 0.45, stages: "6", spread: 1, mix: 0.5 }, "Left and right sweep out of phase."],
  ["Mono Pulse", { rate: 1.2, depth: 0.8, centre: 900, feedback: 0.4, stages: "4", spread: 0, mix: 0.5 }, "Faster, centred throb."],
  ["Resonant Peaks", { rate: 0.3, depth: 0.6, centre: 800, feedback: 0.85, stages: "8", spread: 0.5, mix: 0.5 }, "Strong positive feedback: ringing, vocal peaks."],
  ["Hollow Negative", { rate: 0.3, depth: 0.6, centre: 700, feedback: -0.8, stages: "6", spread: 0.5, mix: 0.5 }, "Negative feedback: a hollow, nasal tone."],
  ["Low Rumble Phase", { rate: 0.1, depth: 0.5, centre: 150, feedback: 0.5, stages: "6", mix: 0.5 }, "Centred low: moves bass and drums."],
  ["High Shimmer", { rate: 0.6, depth: 0.5, centre: 3500, feedback: 0.4, stages: "8", spread: 0.8, mix: 0.45 }, "Bright, airy sweep over the top end."],
  ["Fast Leslie-ish", { rate: 6, depth: 0.4, centre: 1000, feedback: 0.2, stages: "4", spread: 0.9, mix: 0.6 }, "Quick, shimmering rotary-like movement."],
];
