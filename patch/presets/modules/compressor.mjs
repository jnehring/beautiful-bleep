// SPDX-License-Identifier: MIT
// Compressor: factory presets (see ../build-modules.mjs).
export default [
  ["Gentle Glue", { threshold: -18, ratio: 2, attack: 20, release: 200, knee: 12, makeup: 2 }, "Light bus compression that holds a mix together."],
  ["Vocal Leveler", { threshold: -22, ratio: 4, attack: 8, release: 150, knee: 8, makeup: 5, detector: "RMS" }, "Even out a voice or lead with smooth RMS detection."],
  ["Drum Punch", { threshold: -20, ratio: 6, attack: 30, release: 80, knee: 3, makeup: 5 }, "Slow attack lets the transient through, then clamps the body."],
  ["Bass Control", { threshold: -24, ratio: 5, attack: 15, release: 250, knee: 6, makeup: 6, detector: "RMS" }, "Keeps a bass line steady and solid."],
  ["Parallel Smash", { threshold: -36, ratio: 12, attack: 1, release: 100, knee: 6, makeup: 10, mix: 0.4 }, "Hard compression blended under the dry signal for density."],
  ["Soft Limiter", { threshold: -6, ratio: 20, attack: 0.5, release: 80, knee: 2, makeup: 3 }, "Catches peaks at the end of a chain."],
  ["Brick Wall", { threshold: -3, ratio: 40, attack: 0.1, release: 50, knee: 0, makeup: 2 }, "Near-hard limiting; nothing gets past the ceiling."],
  ["Slow Opto", { threshold: -20, ratio: 3, attack: 40, release: 800, knee: 18, makeup: 4, detector: "RMS" }, "Slow, smooth levelling with a wide knee."],
  ["Sustain Boost", { threshold: -40, ratio: 8, attack: 5, release: 600, knee: 10, makeup: 14 }, "Pulls up tails: guitars and plucks ring longer."],
  ["Pump Duck", { threshold: -30, ratio: 10, attack: 0.5, release: 350, knee: 2, makeup: 6 }, "Audible pumping on loud material; patch a kick into Key for ducking."],
  ["Transient Tamer", { threshold: -14, ratio: 4, attack: 0.3, release: 60, knee: 4, makeup: 3 }, "Fast attack rounds off clicks and spikes."],
  ["Wide Squash", { threshold: -30, ratio: 20, attack: 3, release: 120, knee: 4, makeup: 12, link: 0.3 }, "Heavy squash with loosely linked channels for a wider image."],
  ["Gain Reduction Source", { threshold: -24, ratio: 4, attack: 5, release: 200, knee: 6, }, "Take the Reduction output as a control signal for pumping other modules."],
];
