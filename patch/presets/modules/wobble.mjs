// SPDX-License-Identifier: MIT
// Wobble: factory presets (see ../build-modules.mjs).
export default [
  ["Gentle Wander", { rate: 0.4, smooth: 0.7, wobble: 0.3, chaos: 0, burst: 0 }, "Slow smooth random movement: gentle, subtle drift."],
  ["Classic Sample and Hold", { rate: 4, smooth: 0, wobble: 0, burst: 0 }, "Use the stepped output for random sample-and-hold steps."],
  ["Lazy Steps", { rate: 0.8, smooth: 0.2, wobble: 0.1 }, "Slow random jumps for evolving filter changes."],
  ["Silky Glide", { rate: 1.5, smooth: 1, wobble: 0.2, burst: 0 }, "Fully smoothed glides between random values."],
  ["Springy Overshoot", { rate: 2, smooth: 0.4, wobble: 0.8 }, "Wobble output overshoots and rings after each jump."],
  ["Jelly Wobble", { rate: 1, smooth: 0.5, wobble: 1, burst: 0.1 }, "Heavy ringing wobble: gelatinous pitch and filter motion."],
  ["Synced Eighths", { sync: "1/8", smooth: 0.3, wobble: 0.5, burst: 0.2 }, "Random steps locked to eighth notes."],
  ["Synced Bars", { sync: "1 bar", smooth: 0.6, wobble: 0.6, burst: 0 }, "One new value per bar: slow, tempo-locked changes."],
  ["Burst Trigger", { rate: 1.5, burst: 0.8, burstsize: 4, smooth: 0.3 }, "Frequently fires bursts of triggers: fills and rolls."],
  ["Rapid Burst Roll", { rate: 3, burst: 1, burstsize: 8, smooth: 0.1, wobble: 0.2 }, "Long fast trigger rolls from the burst output."],
  ["Chaotic Stream", { rate: 2, chaos: 0.8, smooth: 0.3, wobble: 0.6 }, "Chaos adds unpredictable behavior to the stream."],
  ["Fast Jitter", { rate: 25, smooth: 0.2, wobble: 0.4, level: 0.4 }, "Fast small-depth jitter: adds life to pitch or pan."],
  ["Unipolar Level", { rate: 1.2, polarity: "Unipolar", smooth: 0.5, wobble: 0.4 }, "Positive-only random values: for levels and mixes."],
  ["Quiet Shimmer", { rate: 6, smooth: 0.8, wobble: 0.3, level: 0.25 }, "Low-depth random flutter for subtle shimmer."],
  ["Seeded Pattern", { rate: 3, smooth: 0, wobble: 0, seed: 123 }, "Steps from another seed: a different random pattern."],
];
