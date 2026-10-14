// SPDX-License-Identifier: MIT
// Freq Shifter: factory presets (see ../build-modules.mjs). Shift is a fraction of Range.
export default [
  ["Slow Barber Pole", { shift: 0.05, range: "±10 Hz", mix: 0.5 }, "Endless, slow phasing against the dry sound."],
  ["Gentle Detune", { shift: 0.1, range: "±10 Hz", mix: 0.5 }, "Beating, chorus-like shimmer."],
  ["Stereo Widener", { shift: 0.04, range: "±10 Hz", spread: 1, mix: 1 }, "Opposite small shifts left and right for a wide image."],
  ["Down Spiral", { shift: -0.1, range: "±200 Hz", feedback: 0.5, fbDelay: 0.3, mix: 0.6 }, "Feedback makes the sound sink in steps."],
  ["Up Spiral", { shift: 0.1, range: "±200 Hz", feedback: 0.5, fbDelay: 0.3, mix: 0.6 }, "Rising, bell-like spiral."],
  ["Phase Bells", { shift: 0.15, range: "±200 Hz", feedback: 0.7, fbDelay: 0.15, mix: 0.5 }, "Metallic ringing from resonant feedback."],
  ["Inharmonic Bell", { shift: 0.25, range: "±2 kHz", mix: 0.5 }, "Moves partials off the harmonic series: dissonant, bell-like."],
  ["Dissonant Shift", { shift: 0.12, range: "±2 kHz", mix: 1 }, "Fully wet and inharmonic."],
  ["Negative Shift", { shift: -0.2, range: "±2 kHz", mix: 0.7 }, "Pushes downward: reversed-sounding tones."],
  ["Wide Stereo Spread", { shift: 0.08, range: "±200 Hz", spread: 0.8, mix: 0.6 }, "Different shift per channel for a swirling image."],
  ["Negative Feedback Cloud", { shift: 0.06, range: "±200 Hz", feedback: -0.6, fbDelay: 0.4, mix: 0.5 }, "Inverted feedback: a darker, diffuse smear."],
  ["Synced Sweep", { shift: 0.3, range: "±200 Hz", sync: "1/4", feedback: 0.3, mix: 0.5 }, "Tempo-synced shift movement."],
  ["Extreme Warp", { shift: 0.6, range: "±10 kHz", mix: 0.8 }, "Large shift: robotic and alien."],
];
