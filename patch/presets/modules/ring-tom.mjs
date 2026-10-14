// SPDX-License-Identifier: MIT
// Ring Tom: factory presets (see ../build-modules.mjs).
export default [
  ["Mid Tom", { tune: 140, decay: 0.4, bend: 0.3, noise: 0.3 }, "A well-rounded rack tom."],
  ["Floor Tom", { tune: 80, decay: 0.8, bend: 0.35, noise: 0.25 }, "Low and resonant, for fills that fall down the kit."],
  ["High Tom", { tune: 220, decay: 0.3, bend: 0.25, noise: 0.3 }, "Small, bright tom for the top of a fill."],
  ["Electro Tom", { tune: 160, decay: 0.45, bend: 0.9, noise: 0.05 }, "Heavy pitch fall with a clean tone: a synthetic tom."],
  ["Conga", { tune: 300, decay: 0.25, bend: 0.1, noise: 0.15 }, "Short and woody hand-drum sound."],
  ["Bongo", { tune: 450, decay: 0.15, bend: 0.1, noise: 0.2 }, "Tight, high hand drum for percussion loops."],
  ["Tribal Boom", { tune: 95, decay: 1.2, bend: 0.2, noise: 0.5 }, "Deep, breathy drum with a long tail."],
  ["Dub Tom", { tune: 110, decay: 1.4, bend: 0.55, noise: 0.1 }, "Long, falling tone that begs for echo."],
  ["Lo-Fi Skin", { tune: 130, decay: 0.35, bend: 0.4, noise: 0.8 }, "Mostly noise on top: a dusty skin hit."],
  ["Sub Drop", { tune: 55, decay: 1.8, bend: 0.8, noise: 0.05 }, "A deep, dropping tone for transitions."],
  ["Tuned Ring", { tune: 260, decay: 1.6, bend: 0, noise: 0 }, "No bend, no noise: a pure, ringing tuned drum."],
];
