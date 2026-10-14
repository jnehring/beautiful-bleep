// SPDX-License-Identifier: MIT
// Noise: factory presets (see ../build-modules.mjs). Colour: -1 brown, 0 white, +1 violet.
export default [
  ["White Noise", { colour: 0, level: 0.8 }, "Flat, full-spectrum noise: the all-round source for hats and snares."],
  ["Pink Noise", { colour: -0.35, level: 0.8 }, "Equal energy per octave: natural, balanced, like rain."],
  ["Brown Rumble", { colour: -1, level: 0.9 }, "Dark, deep noise: thunder, wind and engine rumble."],
  ["Soft Hiss", { colour: 0.3, level: 0.4 }, "A quiet, slightly bright hiss for tape or room atmosphere."],
  ["Bright Air", { colour: 0.7, level: 0.6 }, "Bright, airy noise for breaths, cymbals and shimmer."],
  ["Violet Fizz", { colour: 1, level: 0.6 }, "Only the top end: fizzy, icy noise for hats and sprays."],
  ["Wind", { colour: -0.6, level: 0.7 }, "Darkened noise: run it through a band-pass and sweep for wind."],
  ["Ocean", { colour: -0.8, level: 0.6 }, "Deep, rolling noise: modulate Level slowly for waves."],
  ["Snare Noise", { colour: 0.1, level: 1 }, "Full-level near-white noise: gate it with a fast envelope."],
  ["Hat Noise", { colour: 0.85, level: 0.9 }, "Very bright noise for closed and open hats."],
  ["Vinyl Bed", { colour: -0.2, level: 0.15 }, "A very quiet noise floor to add some grit under a mix."],
  ["Half Level", { colour: 0, level: 0.5 }, "White noise at half level: a safe starting point for mixing."],
];
