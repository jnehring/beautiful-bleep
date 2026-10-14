// SPDX-License-Identifier: MIT
// Pitch Shifter: factory presets (see ../build-modules.mjs).
export default [
  ["Octave Up", { pitch: 12, window: 80, mix: 1 }, "Straight octave up."],
  ["Octave Down", { pitch: -12, window: 100, mix: 1 }, "Straight octave down."],
  ["Octave Blend", { pitch: 12, window: 80, mix: 0.4 }, "Octave up under the dry signal for sparkle."],
  ["Fifth Up", { pitch: 7, window: 70, mix: 0.45 }, "Adds a perfect fifth for power-chord thickness."],
  ["Sub Octave", { pitch: -12, window: 120, mix: 0.5 }, "Dry plus an octave below for weight."],
  ["Detune Double", { pitch: 0, fine: 12, window: 60, mix: 0.5 }, "A slightly sharp copy: classic detune thickening."],
  ["Wide Detune", { pitch: 0, fine: -18, window: 50, drift: 0.2, mix: 0.5 }, "Flat detune with a little drift."],
  ["Tape Flutter", { pitch: 0, fine: 5, window: 90, drift: 0.7, mix: 0.6 }, "Wobbling pitch like worn tape."],
  ["Shimmer Spiral", { pitch: 12, window: 120, feedback: 0.55, mix: 0.4 }, "Climbing octaves: put it before a reverb."],
  ["Dark Descent", { pitch: -7, window: 150, feedback: 0.55, mix: 0.4 }, "Falling spiral that sinks into the dark."],
  ["Minor Third Echo", { pitch: 3, window: 90, feedback: 0.4, mix: 0.45 }, "Feedback stacks minor thirds into a diminished haze."],
  ["Chipmunk", { pitch: 19, window: 40, mix: 1 }, "An octave and a fifth up: cartoon voice."],
  ["Monster", { pitch: -19, window: 200, mix: 1 }, "Dark, slow, huge voice."],
  ["Granular Window", { pitch: 5, window: 25, drift: 0.3, mix: 0.7 }, "Tiny window: choppy, grainy artefacts."],
];
