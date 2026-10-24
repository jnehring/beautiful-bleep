// SPDX-License-Identifier: GPL-3.0-only
// Spectral Blend: factory presets (see ../build-modules.mjs).
export default [
  ["Cross Synthesis", { magnitude: 0, phase: 1, tilt: 0, blur: 0, smear: 0, freeze: false, size: "2048", law: "Linear", mix: 1 }, "The loudness shape of In A with the phases of In B: A speaks with B's texture."],
  ["Phase Swap", { magnitude: 1, phase: 0, tilt: 0, size: "2048", mix: 1 }, "The reverse: B's shape on A's phases."],
  ["Half and Half", { magnitude: 0.5, phase: 0.5, tilt: 0, law: "Linear", size: "2048" }, "Both magnitudes and phases halfway between the two sounds."],
  ["Geometric Morph", { magnitude: 0.5, phase: 0.5, tilt: 0, law: "Geometric", size: "2048" }, "A morph that follows loudness in dB: partials present in only one sound stay quiet."],
  ["Low A, High B", { magnitude: 0.5, phase: 0.5, tilt: 1, pivot: 1000, law: "Linear", size: "2048" }, "Below 1 kHz it is A, above it is B, with a smooth crossover."],
  ["High A, Low B", { magnitude: 0.5, phase: 0.5, tilt: -1, pivot: 800, law: "Linear", size: "2048" }, "The other way round: B's lows under A's highs."],
  ["Soft Blur", { magnitude: 0, phase: 0, blur: 0.4, smear: 0, size: "2048" }, "A single input made hazy; the blur softens its partials."],
  ["Wash", { magnitude: 0, phase: 0, blur: 0.6, smear: 0.7, size: "4096", mix: 1 }, "Blur and a long smear turn anything into a slowly fading wash."],
  ["Spectral Tail", { magnitude: 0, phase: 0, blur: 0.1, smear: 0.85, size: "2048", mix: 0.5 }, "Half dry, half a lingering ghost of the spectrum."],
  ["Ghost Gate", { magnitude: 0, phase: 0, gatelow: -45, gatemid: -38, gatehigh: -42, size: "2048" }, "A spectral gate removes everything quiet: what is left is a skeleton of the loudest partials."],
  ["Inverse Gate", { magnitude: 0, phase: 0, gatelow: -30, gatemid: -30, gatehigh: -30, invertgate: true, size: "2048" }, "Keeps only what is below the threshold: the sound without its loudest partials."],
  ["Bass Keeper", { magnitude: 0, phase: 1, gatelow: -90, gatemid: -35, gatehigh: -28, splitlow: 300, splithigh: 2500, size: "2048" }, "Lows pass untouched, the mids and highs are gated hard."],
  ["Frozen Moment", { magnitude: 0, phase: 0, freeze: true, size: "4096" }, "Holds the spectrum at the moment of switching on, as a steady drone."],
  ["Crisp Cross", { magnitude: 0, phase: 1, size: "512", law: "Linear" }, "Short frames: tighter timing, rougher pitch resolution."],
  ["Dark Tilt", { magnitude: 0.7, phase: 0.3, tilt: -0.6, pivot: 600, law: "Geometric", size: "2048", level: -2 }, "Mostly B's shape and A's phases, with B's highs pushed back."],
];
