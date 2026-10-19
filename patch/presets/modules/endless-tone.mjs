// SPDX-License-Identifier: MIT
// Endless Tone (endless-tone): factory presets.
export default [
  ["Endless Riser", { rate: 0.15, width: 0.35, count: 10 }, "A slow glide upward that never arrives."],
  ["Falling Drone", { direction: -0.4, rate: 0.3, timbre: 0.5 }, "A warm tone that falls for ever."],
  ["Slow Cloud", { rate: 0.05, width: 1, count: 12, spread: 1 }, "A wide, dense wash of octaves, barely moving."],
  ["Fast Spin", { rate: 1.5, width: 0.25, count: 7 }, "A quick rising swirl."],
  ["Saw Staircase", { timbre: 1, rate: 0.4, width: 0.3 }, "Bright saw partials in a steady climb."],
  ["Few Clear Partials", { width: 0, count: 6, rate: 0.2 }, "Individual voices passing through the window."],
  ["Frozen Chord", { rate: 0, phase: 0.3, width: 0.2 }, "No glide: a fixed stack of octaves; Phase moves it."],
  ["Low Descent", { coarse: -24, direction: -1, rate: 0.12, timbre: 0.6 }, "A deep, sinking tone."],
  ["High Shimmer", { coarse: 19, width: 0.6, count: 12, rate: 0.3, spread: 0.8 }, "A glittering, wide rise high up."],
  ["Gentle Mono", { spread: 0, rate: 0.1, width: 0.6 }, "Quiet and centred: a calm pad."],
  ["Alarm Rise", { rate: 1, timbre: 1, width: 0.1 }, "Tense, fast and bright."],
  ["Reverse Slow", { direction: -1, rate: 0.08, width: 0.8, count: 11 }, "A slow fall across many octaves."],
];
