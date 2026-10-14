// SPDX-License-Identifier: MIT
// LFO: factory presets (see ../build-modules.mjs).
export default [
  ["Gentle Sine", { rate: 0.5, wave: "Sine" }, "Slow sine for subtle filter or pitch drift."],
  ["Vibrato", { rate: 5.5, wave: "Sine", fade: 1.5 }, "Classic vibrato speed that fades in after the note starts."],
  ["Tremolo", { rate: 6, wave: "Triangle", polarity: "Unipolar" }, "Unipolar triangle for amplitude tremolo."],
  ["Beat Pump", { wave: "Saw Down", sync: "1/4", polarity: "Unipolar" }, "Falling ramp locked to the beat: sidechain-like ducking."],
  ["Eighth Chop", { wave: "Square", sync: "1/8", polarity: "Unipolar" }, "Square gate on every eighth for rhythmic chopping."],
  ["Slow Sweep", { rate: 0.05, wave: "Triangle" }, "A 20-second triangle for long filter sweeps."],
  ["Rising Saw", { wave: "Saw Up", sync: "2 bars", polarity: "Unipolar" }, "Ramp that climbs over two bars and snaps back."],
  ["Sample and Hold", { rate: 4, wave: "Random Step", seed: 7 }, "Random stepped values, a classic sample-and-hold."],
  ["Smooth Random", { rate: 0.8, wave: "Random Smooth", seed: 21 }, "Wandering smooth random for organic movement."],
  ["Narrow Pulse", { rate: 2, wave: "Square", pw: 0.15 }, "Thin pulse for staccato jumps."],
  ["Wide Slow Tide", { wave: "Sine", sync: "4 bars", polarity: "Unipolar" }, "A four-bar sine swell locked to the song."],
  ["Triplet Feel Wobble", { wave: "Triangle", sync: "1/16" }, "Fast synced triangle for shimmering wobble."],
  ["Offset Sine", { rate: 1, wave: "Sine", phase: 90 }, "Sine starting at its peak: pair with another LFO for quadrature."],
  ["Fast Flutter", { rate: 18, wave: "Sine", fade: 0.5 }, "Tape-like flutter, best used very lightly."],
  ["Wild Random", { rate: 12, wave: "Random Step", seed: 113 }, "Fast random jitter for glitchy modulation."],
];
