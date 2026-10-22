// SPDX-License-Identifier: MIT
// LFO: factory presets (see ../build-modules.mjs).
export default [
  ["Gentle Sine", { rate: 0.5, wave: "Sine" }, "Slow sine for subtle filter or pitch drift."],
  ["Vibrato", { rate: 5.5, wave: "Sine", fade: 1.5 }, "Classic vibrato speed that fades in after the note starts."],
  ["Tremolo", { rate: 6, wave: "Triangle", polarity: "Unipolar" }, "Unipolar triangle for amplitude tremolo."],
  ["Beat Pump", { wave: "Saw Down", sync: "Tempo", division: "1/4", polarity: "Unipolar" }, "Falling ramp locked to the beat: sidechain-like ducking."],
  ["Eighth Chop", { wave: "Square", sync: "Tempo", division: "1/8", polarity: "Unipolar" }, "Square gate on every eighth for rhythmic chopping."],
  ["Slow Sweep", { rate: 0.05, wave: "Triangle" }, "A 20-second triangle for long filter sweeps."],
  ["Rising Saw", { wave: "Saw Up", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, "Ramp that climbs over two bars and snaps back."],
  ["Sample and Hold", { rate: 4, wave: "Random Step" }, "Random stepped values, a classic sample-and-hold."],
  ["Smooth Random", { rate: 0.8, wave: "Random Smooth" }, "Wandering smooth random for organic movement."],
  ["Narrow Pulse", { rate: 2, wave: "Square", pw: 0.15 }, "Thin pulse for staccato jumps."],
  ["Wide Slow Tide", { wave: "Sine", sync: "Tempo", division: "4 bars", polarity: "Unipolar" }, "A four-bar sine swell locked to the song."],
  ["Triplet Feel Wobble", { wave: "Triangle", sync: "Tempo", division: "1/16" }, "Fast synced triangle for shimmering wobble."],
  ["Offset Sine", { rate: 1, wave: "Sine", phase: 90 }, "Sine starting at its peak: pair with another LFO for quadrature."],
  ["Fast Flutter", { rate: 18, wave: "Sine", fade: 0.5 }, "Tape-like flutter, best used very lightly."],
  ["Wild Random", { rate: 12, wave: "Random Step" }, "Fast random jitter for glitchy modulation."],
  ["Ramp from Triangle", { rate: 1, wave: "Triangle", skew: 0.9 }, "Skew pushes the triangle's peak to the end: a rising ramp."],
  ["Exponential Sine", { rate: 0.7, wave: "Sine", curve: 0.6 }, "Curve bends the sine towards exponential: slow start, fast finish."],
  ["Soft Square", { rate: 2, wave: "Square", morph: 0.8 }, "Morph rounds the edges of the square into a trapezoid."],
  ["Dotted Eighth", { sync: "Tempo", division: "1/8.", wave: "Triangle", polarity: "Unipolar" }, "A triangle locked to a dotted eighth."],
  ["Triplet Pulse", { sync: "Tempo", division: "1/8T", wave: "Square", polarity: "Unipolar" }, "Square gate on eighth-note triplets."],
];
