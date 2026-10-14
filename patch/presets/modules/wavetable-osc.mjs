// SPDX-License-Identifier: MIT
// Wavetable Osc: factory presets (see ../build-modules.mjs).
export default [
  ["Analog Saw", { bank: "Analog", x: 0.5, y: 1 }, "A bright analog saw from the first bank."],
  ["Soft Sine Tri", { bank: "Analog", x: 0.15, y: 0.2, subLevel: 0.3 }, "A round sine-to-triangle blend with a little sub."],
  ["Analog Sweep", { bank: "Analog", path: "Rows", scan: 0.35, y: 0.6 }, "Scan the path across the shapes: modulate Scan for a sweeping tone."],
  ["Warm Organ", { bank: "Organ", x: 0.4, y: 0.1, stereo: 0.1 }, "A drawbar-style registration with light stereo width."],
  ["Vowel Voice", { bank: "Vowel", x: 0.25, y: 0.4 }, "A sung vowel: sweep X to change a-e-i-o-u."],
  ["Harmonic Glass", { bank: "Harmonic", x: 0.2, y: 0.5, stereo: 0.2 }, "Odd harmonics around a spectral centre: glassy and pure."],
  ["Pulse Width", { bank: "Pulse", x: 0.3, y: 0, subLevel: 0.2 }, "A pulse table: move X to change the width."],
  ["Sync Sweep", { bank: "Sync", x: 0.4, y: 0.2 }, "Synced saw ratios inside the table: sweep X for a classic sync lead."],
  ["FM Table", { bank: "FM", x: 0.35, y: 0.3 }, "Stored FM spectra: X is index, Y is ratio."],
  ["Folded Wave", { bank: "Fold", x: 0.5, y: 0.4 }, "Wavefolded cycles: bright, moving harmonics."],
  ["Bell Table", { bank: "Bell", x: 0.4, y: 0.3, stereo: 0.15 }, "Stretched partials: a glassy, bell-like tone."],
  ["Spectra Cloud", { bank: "Spectra", x: 0.5, y: 0.5, stereo: 0.4 }, "Random seeded spectra with wide stereo: a textural pad."],
  ["Bent Analog", { bank: "Analog", x: 0.6, y: 0.5, warp: 0.5, warpMode: "Bend" }, "Warp bends the cycle: a brighter, resonant tone."],
  ["Squashed PWM", { bank: "Analog", x: 0.5, y: 1, warp: 0.5, warpMode: "Squash" }, "Squash gives pulse-width movement to any wave; modulate Warp."],
  ["Mirror Fold", { bank: "Harmonic", x: 0.6, y: 0.6, warp: 0.6, warpMode: "Mirror" }, "A mirrored read: a new even/odd balance."],
  ["Digital Crush", { bank: "Digital", x: 0.5, y: 0.5, blend: "Step", read: "Linear" }, "Bit-reduced stepped cycles: lo-fi and gritty."],
];
