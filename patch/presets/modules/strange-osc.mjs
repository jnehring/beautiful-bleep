// SPDX-License-Identifier: MIT
// Strange Osc (strange-osc): factory presets.
export default [
  ["Tamed Spiral", { attractor: "Rossler", tame: 0.9 }, "Almost a clean periodic tone, with a slow grain from the orbit."],
  ["Wobbling Lead", { attractor: "Rossler", tame: 0.65, tone: 6000, level: 0.7 }, "Pitched, with a restless wobble in every cycle."],
  ["Edge of Order", { attractor: "Rossler", tame: 0.45 }, "Between a note and noise: period-doubling roughness."],
  ["Lorenz Grit", { attractor: "Lorenz", tame: 0.2, coarse: -12, tone: 5000 }, "Gritty, irregular low tone from two flipping lobes."],
  ["Lorenz Loop", { attractor: "Lorenz", tame: 1, coarse: -5, mix: 0.5 }, "The tamed Lorenz orbit: a hollow, steady voice."],
  ["Thomas Glass", { attractor: "Thomas", tame: 0.5, coarse: 12, tone: 9000 }, "Smooth, lazy tumbling that rings like glass."],
  ["Halvorsen Star", { attractor: "Halvorsen", tame: 0.75, mix: 0.25 }, "A three-armed orbit with a cool, buzzy character."],
  ["Chaos Noise", { attractor: "Lorenz", tame: 0, coarse: 24, level: 0.5 }, "Full chaos high up: noise with a pitch centre."],
  ["Dark Chaos", { attractor: "Lorenz", tame: 0.1, coarse: -24, tone: 900 }, "Slow, dark rumble for sub layers."],
  ["Y Voice", { attractor: "Rossler", tame: 0.8, mix: 0.5 }, "The Y axis: rounder and less spiky than X."],
  ["Z Spike", { attractor: "Rossler", tame: 0.5, mix: 1 }, "The Z axis: sharp spikes that cut through a mix."],
  ["Forced Orbit", { attractor: "Rossler", tame: 0.3, force: 0.4 }, "Patch an audio signal into Force In to push the orbit."],
  ["Slow Orbit", { attractor: "Lorenz", tame: 0.3, range: "Slow", level: 1 }, "Control-rate chaos: use X, Y and Z as modulation."],
  ["Irregular Clock", { attractor: "Lorenz", tame: 0.1, range: "Low", mix: 0.5 }, "Use the Flip gate as a clock that never quite repeats."],
];
