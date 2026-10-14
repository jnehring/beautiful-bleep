// SPDX-License-Identifier: MIT
// ADSR: factory presets (see ../build-modules.mjs).
export default [
  ["Classic Synth", { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.4 }, "All-round envelope for lead and bass."],
  ["Pluck", { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 }, "Instant attack, decays to nothing."],
  ["Short Stab", { attack: 0.002, decay: 0.12, sustain: 0.2, release: 0.1 }, "Tight stab with a little tail."],
  ["Slow Pad", { attack: 1.2, decay: 1, sustain: 0.8, release: 2.5 }, "Gradual fade-in and long release."],
  ["Soft Swell", { attack: 0.6, decay: 0.5, sustain: 1, release: 0.8 }, "Smooth swell that stays at full level."],
  ["Organ Gate", { attack: 0.003, decay: 0.01, sustain: 1, release: 0.03 }, "On-off gating with tiny declick ramps."],
  ["Bass Punch", { attack: 0.001, decay: 0.18, sustain: 0.5, release: 0.15, velamount: 0.8 }, "Punchy bass with strong velocity response."],
  ["Strings", { attack: 0.35, decay: 0.4, sustain: 0.85, release: 0.9 }, "Bowed-style onset and soft release."],
  ["Long Bell", { attack: 0.001, decay: 3, sustain: 0, release: 4 }, "Ringing decay for bells and mallets."],
  ["Reverse Pad", { attack: 3, decay: 0.2, sustain: 0.6, release: 0.5 }, "Very slow rise, quick fall-off."],
  ["Plucky Filter", { attack: 0.001, decay: 0.45, sustain: 0.1, release: 0.3, velamount: 0.6 }, "Good for cutoff: a snappy sweep per note."],
  ["Velocity Dynamic", { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.35, velamount: 1 }, "Full velocity sensitivity for expressive playing."],
  ["Drone Hold", { attack: 2, decay: 0.1, sustain: 1, release: 8 }, "Slow in, very long ghostly release."],
  ["Staccato Click", { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02, velamount: 0.3 }, "Ultra-short blip for percussive clicks."],
];
