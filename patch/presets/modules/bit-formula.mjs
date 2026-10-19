// SPDX-License-Identifier: MIT
// Bit Formula (bit-formula): factory presets.
export default [
  ["Ramp Saw", { formula: "Ramp", a: 64, rate: 8000 }, "The counter itself: a rising saw that wraps."],
  ["Pulse Width", { formula: "Pulse", a: 64 }, "A pulse; A sets its width."],
  ["Stair Climb", { formula: "Stairs", a: 128, b: 160, c: 96 }, "Stepped ramps that climb in shifting groups."],
  ["Sierpinski Bass", { formula: "Sierpinski", a: 40, rate: 4000 }, "A hollow bass pattern from a shifted mask."],
  ["Sieve Melody", { formula: "Sieve", rate: 8000, c: 200 }, "A tune from the overlap of two shifted counters."],
  ["Crawl", { formula: "Crawl", rate: 11025, a: 120, b: 190 }, "A slow, creeping melody with a sparse rhythm."],
  ["Chirp Drops", { formula: "Chirp", a: 70, b: 50, rate: 12000 }, "Falling squeals: the counter squared."],
  ["Warble Pad", { formula: "Warble", smooth: 0.6, rate: 6000, level: 0.5 }, "Smoothed, wavering steps."],
  ["Mask Rhythm", { formula: "Mask", rate: 5000, a: 150, b: 90, c: 230 }, "A rhythm of masked bit patterns."],
  ["Counting Noise", { formula: "Counting", rate: 16000, a: 40 }, "Bit-counting noise with a ragged pitch."],
  ["Echo Ramp Soft", { formula: "Echo Ramp", smooth: 0.5 }, "Two ramps averaged: a soft buzz."],
  ["Grid Buzz", { formula: "Grid", a: 200, b: 100, c: 50 }, "An angular, buzzy grid of three masks."],
  ["Mirror Tone", { formula: "Mirror", a: 130, rate: 9000 }, "A triangle-like tone folded by the top bit."],
  ["Parity Pulse", { formula: "Parity", bits: 5, c: 80 }, "Parity of two shifted counters: pulsing and crunchy."],
  ["Crush Input", { formula: "Input Crush", rate: 12000, a: 100 }, "Patch audio into In: it is cut to a few bits and crossed with the counter."],
  ["Lo-Fi 4 Bit", { formula: "Ramp", bits: 4, rate: 4000, a: 200 }, "A coarse four-bit staircase saw."],
  ["Custom Hat", { formula: "Custom", b: 40, c: 255, rate: 22000 }, "Your own formula slot, filled with a noisy hat-like one.", { formula: "((t*13)^(t>>3)) & (b|c)" }],
];
