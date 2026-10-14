// SPDX-License-Identifier: MIT
// Ring Rim: factory presets (see ../build-modules.mjs).
export default [
  ["Rim Shot", { voice: "Rim", tune: 0, decay: 1 }, "A standard woody rim click."],
  ["Clave", { voice: "Clave", tune: 0, decay: 1 }, "Classic wooden clave."],
  ["Tight Rim", { voice: "Rim", tune: 3, decay: 0.4 }, "Short, dry click for tight grooves."],
  ["Deep Rim", { voice: "Rim", tune: -7, decay: 1.5 }, "Low, hollow rim that rings a little."],
  ["Bright Click", { voice: "Rim", tune: 8, decay: 0.6 }, "High and sharp, a clicky metronome tick."],
  ["Long Clave", { voice: "Clave", tune: -2, decay: 2.5 }, "A clave with a long, glassy ring."],
  ["High Clave", { voice: "Clave", tune: 7, decay: 0.5 }, "Bright, short clave for latin patterns."],
  ["Low Block", { voice: "Clave", tune: -9, decay: 0.8 }, "A low wood block."],
  ["Dub Rim", { voice: "Rim", tune: -3, decay: 2.2 }, "Rim with a long tail to catch in the echo."],
  ["Tiny Tick", { voice: "Clave", tune: 12, decay: 0.25 }, "The smallest, highest tick for hi-hat-like patterns."],
];
