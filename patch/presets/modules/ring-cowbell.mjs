// SPDX-License-Identifier: MIT
// Ring Cowbell: factory presets (see ../build-modules.mjs).
export default [
  ["Cowbell", { tune: 0, decay: 0.4, tone: 0.5 }, "The classic cowbell: sharp hit, short tail."],
  ["Tight Bell", { tune: 2, decay: 0.15, tone: 0.55 }, "Very short and clipped for fast patterns."],
  ["Long Clang", { tune: 0, decay: 1.2, tone: 0.5 }, "Open, ringing bell with a long tail."],
  ["Low Bell", { tune: -7, decay: 0.5, tone: 0.3 }, "Large, dull cowbell with a low pitch."],
  ["High Agogo", { tune: 7, decay: 0.3, tone: 0.65 }, "Higher, thinner bell, like an agogo."],
  ["Bright Ping", { tune: 4, decay: 0.6, tone: 1 }, "Fully open band-pass: shiny and metallic."],
  ["Muted Bell", { tune: -2, decay: 0.1, tone: 0 }, "Hand-muffled, dark and woody."],
  ["Dub Bell", { tune: -4, decay: 1.6, tone: 0.4 }, "Slow, hollow ring for echo trails."],
  ["Disco Bell", { tune: 3, decay: 0.3, tone: 0.8 }, "Bright and upbeat for off-beat accents."],
  ["Metal Block", { tune: 10, decay: 0.2, tone: 0.2 }, "Small, dull metallic block."],
];
