// SPDX-License-Identifier: MIT
// Grains: factory presets.
export default [
  ["Soft Cloud", { position: 0.3, size: 0.15, density: 0.6, texture: 0.5, spread: 0.5, mix: 0.7 }, "A gentle grain cloud over the recent input."],
  ["Shimmer Up", { size: 0.2, pitch: 12, density: 0.7, texture: 0.6, spread: 0.6, feedback: 0.35, blur: 0.3, mix: 0.5, pitchquant: "Octaves" }, "Octave-up grains with feedback for a shimmering halo."],
  ["Deep Down", { size: 0.25, pitch: -12, density: 0.6, texture: 0.6, spread: 0.5, mix: 0.6, pitchquant: "Octaves" }, "An octave below, smoothed into a pad."],
  ["Fifth Harmonies", { size: 0.2, pitch: 7, pitchjitter: 7, density: 0.6, texture: 0.5, mix: 0.5, pitchquant: "Octaves + fifths" }, "Random octaves and fifths stacked on the source."],
  ["Frozen Pad", { position: 0.5, size: 0.4, density: 0.8, texture: 0.7, spread: 0.8, blur: 0.4, mix: 1, freeze: true }, "Holds what was playing and sustains it as a pad."],
  ["Glitch Stutter", { size: 0.04, density: 0.4, texture: 0.1, spread: 0.2, mix: 0.8, mode: "Triggered", sync: "1/16" }, "Short clicks of audio on the 16th grid; works well on drums."],
  ["Reverse Wash", { size: 0.3, density: 0.6, reverse: 1, texture: 0.5, spread: 0.7, mix: 0.7 }, "All grains play backwards."],
  ["Granular Dust", { size: 0.02, density: 0.9, texture: 0.8, spread: 1, pitchjitter: 3, mix: 0.6 }, "Tiny grains: crackling, textural dust."],
  ["Slow Smear", { size: 0.8, density: 0.5, texture: 0.8, spread: 0.6, blur: 0.7, feedback: 0.3, mix: 0.7 }, "Long overlapping grains blur transients away."],
  ["Chromatic Scatter", { size: 0.1, pitchjitter: 12, density: 0.5, texture: 0.4, spread: 0.7, mix: 0.6, pitchquant: "Semitones" }, "Random semitone-quantised pitches."],
  ["Endless Tail", { size: 0.35, density: 0.7, texture: 0.6, spread: 0.7, feedback: 0.7, blur: 0.5, mix: 0.6 }, "Feedback turns the input into an ever-growing texture."],
  ["Half-Time Drift", { position: 0.7, size: 0.25, pitch: -5, density: 0.5, texture: 0.3, spread: 0.4, mix: 0.7, buffer: "16 s" }, "Reads far back in a long buffer for slow, drifting echoes."],
  ["Rhythmic Gate", { size: 0.06, density: 0.5, texture: 0.2, spread: 0.3, mix: 0.8, mode: "Triggered", sync: "1/8" }, "Triggered grains on eighths for a chopped, gated feel."],
  ["Alien Choir", { size: 0.18, pitch: 5, pitchjitter: 5, density: 0.8, texture: 0.7, spread: 1, blur: 0.5, feedback: 0.4, mix: 0.6, seed: 42 }, "Dense detuned grains with feedback: an eerie vocal-like cluster."],
];
