// SPDX-License-Identifier: MIT
// Chorus: factory presets (see ../build-modules.mjs).
export default [
  ["Classic Chorus", { rate: 0.6, depth: 0.5, delay: 9, spread: 0.5, mode: "Chorus", mix: 0.5 }, "Lush, general-purpose stereo chorus."],
  ["Subtle Thicken", { rate: 0.4, depth: 0.25, delay: 12, spread: 0.4, mix: 0.35 }, "Barely there doubling for synths and guitars."],
  ["Wide Ensemble", { rate: 0.8, depth: 0.7, delay: 14, spread: 1, mix: 0.55 }, "Big, spread string-machine style width."],
  ["Slow Wash", { rate: 0.15, depth: 0.8, delay: 18, spread: 0.8, mix: 0.5 }, "Very slow, deep movement for pads."],
  ["Shimmer Fast", { rate: 4, depth: 0.2, delay: 6, spread: 0.6, mix: 0.45 }, "Quick, shallow wobble."],
  ["Vibrato", { rate: 5, depth: 0.45, delay: 5, spread: 0, mix: 1 }, "Fully wet: pure pitch vibrato."],
  ["Tape Warble", { rate: 1.5, depth: 0.55, delay: 10, spread: 0.2, mix: 0.7 }, "Seasick, wobbly detune."],
  ["Soft Flanger", { mode: "Flanger", rate: 0.3, depth: 0.5, delay: 3, feedback: 0.4, spread: 0.5, mix: 0.5 }, "Gentle sweeping comb filter."],
  ["Jet Flanger", { mode: "Flanger", rate: 0.2, depth: 0.8, delay: 2, feedback: 0.75, spread: 0.6, mix: 0.6 }, "Intense jet-plane sweep."],
  ["Negative Flange", { mode: "Flanger", rate: 0.25, depth: 0.6, delay: 4, feedback: -0.7, spread: 0.5, mix: 0.55 }, "Negative feedback: hollow, nasal flanging."],
  ["Metallic Ring", { mode: "Flanger", rate: 0.05, depth: 0.1, delay: 1, feedback: 0.85, spread: 0.3, mix: 0.5 }, "Almost static comb that rings with a pitch."],
  ["Deep Doubler", { rate: 0.3, depth: 0.35, delay: 24, spread: 0.7, mix: 0.4 }, "Long delay times give a slapback-like double."],
];
