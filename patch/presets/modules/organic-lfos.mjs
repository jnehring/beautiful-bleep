// SPDX-License-Identifier: MIT
// Organic LFOs: factory presets (see ../build-modules.mjs).
export default [
  ["Living Group", { rate: 0.2, spread: 0.5, drift: 0.3 }, "Eight related slow movers: a good default for evolving patches."],
  ["Glacial", { rate: 0.02, spread: 0.4, drift: 0.2 }, "Extremely slow drift for long-form changes."],
  ["Gentle Breath", { rate: 0.12, spread: 0.3, drift: 0.5, level: 0.7 }, "Soft, breathing movement at reduced depth."],
  ["Swarm", { rate: 1.5, spread: 0.8, drift: 0.6, scatter: 1 }, "Faster, busier group, like insects."],
  ["Tight Family", { rate: 0.3, spread: 0.1, drift: 0.2, scatter: 0.3 }, "LFOs stay close together: subtle, related motion."],
  ["Wide Spread", { rate: 0.3, spread: 1, drift: 0.3, scatter: 1 }, "Rates spread widely from slow to quick."],
  ["Inverted Spread", { rate: 0.5, spread: -0.7, drift: 0.3 }, "Spread reversed: the order of speeds flips."],
  ["Twisted", { rate: 0.25, spread: 0.5, twist: 0.8, drift: 0.3 }, "Twist skews the phases so the group chases itself."],
  ["Counter Twist", { rate: 0.25, spread: 0.5, twist: -0.8, drift: 0.3 }, "Twist the other way for opposite phase relations."],
  ["Unipolar Drift", { rate: 0.15, spread: 0.5, drift: 0.4, polarity: "Unipolar" }, "Positive-only values, ideal for levels and mix knobs."],
  ["Bar Locked", { rate: 0.5, spread: 0.4, drift: 0.1, lock: "Bars" }, "Locked to the song for repeatable movement."],
  ["Restless Drift", { rate: 0.4, spread: 0.6, drift: 1, scatter: 0.8 }, "Maximum drift: the group wanders and never repeats."],
  ["Free Start", { rate: 0.2, spread: 0.5, drift: 0.3, anchor: false }, "Starts at random positions instead of anchored."],
  ["Different Seed", { rate: 0.2, spread: 0.5, drift: 0.3, seed: 42 }, "Another family of movements from a different seed."],
];
