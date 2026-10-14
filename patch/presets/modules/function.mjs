// SPDX-License-Identifier: MIT
// Function: factory presets (see ../build-modules.mjs).
export default [
  ["Slow Triangle LFO", { rise: 2, fall: 2, cycle: true }, "A gentle 0.25 Hz triangle sweep for filters and pans."],
  ["Pluck Envelope", { rise: 0.002, fall: 0.35, shape: 0.6, cycle: false }, "Snappy one-shot decay: patch a gate into Trig and A onto a cutoff or level."],
  ["Soft Swell", { rise: 1.2, fall: 1.8, shape: -0.3, cycle: false }, "A slow one-shot swell and fade for pads."],
  ["Ramp Down Beat", { rise: 0.01, fall: 1, shape: 0.3, cycle: true, sync: "1/4" }, "Tempo-synced saw falling on every beat: instant pumping."],
  ["Ramp Up Bar", { rise: 1, fall: 0.02, cycle: true, sync: "1 bar" }, "Rising ramp that resets every bar, for risers and builds."],
  ["Vibrato Wobble", { rise: 0.08, fall: 0.08, cycle: true }, "About 6 Hz triangle: patch to pitch with a small amount."],
  ["Quarter-Phase Quad", { rise: 1, fall: 1, spread: 1, cycle: true }, "Four outputs a quarter cycle apart for coordinated movement."],
  ["Growing Echoes", { rise: 0.005, fall: 0.15, shape: 0.5, spread: 1, cycle: false }, "A through D are one-shot decays of 1x, 2x, 4x and 8x length."],
  ["Eighth Pulse", { rise: 0.05, fall: 0.5, shape: 0.7, cycle: true, sync: "1/8" }, "Short percussive curve on every eighth note."],
  ["Lazy Drift", { rise: 8, fall: 6, shape: -0.4, spread: 0.5, cycle: true }, "Very slow, uneven wave with offset outputs for evolving textures."],
  ["Bouncy Curve", { rise: 0.3, fall: 0.3, shape: 1, cycle: true }, "Exponential bounce, like a ball losing energy each beat."],
  ["Reverse Swell", { rise: 0.6, fall: 0.01, shape: 0.8, cycle: false }, "Slow-start rise that cuts off: a reverse-style swell."],
  ["Half-Bar Staggered", { rise: 1, fall: 1, shape: 0.2, spread: 0.6, cycle: true, sync: "1/2" }, "Synced slope with phase-shifted outputs for rolling motion."],
  ["Audio-Rate Buzz", { rise: 0.002, fall: 0.002, cycle: true }, "Fast triangle in the audible range: a FM or ring-style source."],
  ["Eight-Bar Rise", { rise: 1, fall: 0.05, shape: 0.6, cycle: true, sync: "8 bars" }, "Huge synced build-up that restarts every eight bars."],
];
