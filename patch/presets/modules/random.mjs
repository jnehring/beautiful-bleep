// SPDX-License-Identifier: MIT
// Random: factory presets (see ../build-modules.mjs).
export default [
  ["Quarter Steps", { spread: 1, sync: "1/4", length: "8 steps", loop: 0.5 }, "Eight random levels per quarter-note step, mostly repeating."],
  ["Locked Loop", { sync: "1/8", length: "8 steps", loop: 1, seed: 5 }, "A fixed eight-step pattern that repeats exactly."],
  ["Always New", { sync: "1/8", loop: 0 }, "Never repeats: every step is fresh."],
  ["Melody Generator", { sync: "1/8", length: "8 steps", loop: 1, quantize: true, spread: 0.6, seed: 12 }, "Locked steps snapped to semitones: patch to pitch."],
  ["Dark Walk", { sync: "1/4", length: "16 steps", loop: 0.8, bias: -0.6, spread: 0.7, seed: 33 }, "Mostly low values with the occasional jump."],
  ["Bright Sparks", { sync: "1/16", length: "12 steps", loop: 0.7, bias: 0.6, spread: 0.8 }, "High-leaning fast steps for sparkly accents."],
  ["Smooth Wander", { rate: 1, sync: "Free", smooth: 0.8, spread: 0.8 }, "Free-running steps blended into a gliding random curve."],
  ["Slow Drift", { rate: 0.2, sync: "Free", smooth: 0.6, spread: 0.5 }, "Very slow random wander for subtle movement."],
  ["Three Step Cycle", { sync: "1/4", length: "3 steps", loop: 1, spread: 1, seed: 9 }, "A 3-step loop against 4/4 for polymetric feel."],
  ["Five Against Four", { sync: "1/8", length: "5 steps", loop: 1, quantize: true, spread: 0.5, seed: 44 }, "Five-step quantized loop that drifts across the bar."],
  ["Narrow Wobble", { sync: "1/16", length: "16 steps", loop: 0.9, spread: 0.2, smooth: 0.3 }, "Small random variations: gentle humanizing."],
  ["Long Pattern", { sync: "1/16", length: "32 steps", loop: 1, spread: 1, seed: 77 }, "A long locked sequence of 32 steps."],
  ["Slow Bar Changes", { sync: "1 bar", length: "4 steps", loop: 1, spread: 1, quantize: true, seed: 3 }, "One new value per bar for chord or key changes."],
  ["Fast Glitch", { sync: "1/32", length: "8 steps", loop: 0.3, spread: 1 }, "Rapid random steps for glitchy mod."],
];
