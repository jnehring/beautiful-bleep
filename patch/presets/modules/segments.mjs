// SPDX-License-Identifier: MIT
// Segments: factory presets (see ../build-modules.mjs).
export default [
  ["Classic Pluck", { count: 2, time1: 0.002, level1: 1, shape1: 0, time2: 0.25, level2: 0, shape2: 0.6 }, "Instant attack, exponential fall: the all-round plucked envelope."],
  ["Soft Pad", { count: 3, time1: 0.9, level1: 1, shape1: -0.3, time2: 0.8, level2: 0.8, shape2: 0, time3: 1.5, level3: 0, shape3: 0.4 }, "Slow swell, a gentle settle and a long fade."],
  ["Organ Gate", { count: 2, time1: 0.005, level1: 1, shape1: 0, time2: 0.08, level2: 0.9, shape2: 0 }, "Fast on, sustain high, short release: organ-style keying."],
  ["Piano Decay", { count: 3, time1: 0.003, level1: 1, shape1: 0, time2: 0.4, level2: 0.35, shape2: 0.6, time3: 3, level3: 0, shape3: 0.5 }, "Strong hit, quick drop, then a long tail."],
  ["Reverse Swell", { count: 2, time1: 1.2, level1: 1, shape1: 0.7, time2: 0.01, level2: 0, shape2: 0 }, "Builds slowly and cuts off: for reversed-style hits."],
  ["Bowed Strings", { count: 3, time1: 0.35, level1: 0.9, shape1: -0.4, time2: 0.2, level2: 1, shape2: 0, time3: 0.6, level3: 0, shape3: 0.2 }, "Bow attack with a slight bloom and a soft release."],
  ["Kick Pitch Drop", { count: 2, time1: 0.001, level1: 1, shape1: 0, time2: 0.12, level2: 0, shape2: 0.8, timescale: 1 }, "Very fast pitch-drop curve: patch to oscillator pitch for kicks."],
  ["Double Hit", { count: 4, time1: 0.002, level1: 1, shape1: 0, time2: 0.05, level2: 0.1, shape2: 0.5, time3: 0.002, level3: 0.8, shape3: 0, time4: 0.3, level4: 0, shape4: 0.6 }, "Two quick strikes in a row: flams and clap-like bursts."],
  ["Triple Stutter", { count: 6, time1: 0.002, level1: 1, time2: 0.06, level2: 0, time3: 0.002, level3: 0.8, time4: 0.06, level4: 0, time5: 0.002, level5: 0.6, time6: 0.2, level6: 0, shape2: 0.5, shape4: 0.5, shape6: 0.5 }, "Three decaying hits: a rhythmic stutter from one gate."],
  ["Triangle Loop LFO", { count: 2, run: "Free", time1: 0.5, level1: 1, shape1: 0, time2: 0.5, level2: -1, shape2: 0 }, "Free-running up-and-down triangle LFO at about 1 Hz."],
  ["Staircase Up", { count: 5, run: "Free", time1: 0.01, level1: 0.2, time2: 0.24, level2: 0.2, time3: 0.01, level3: 0.5, time4: 0.24, level4: 0.5, time5: 0.01, level5: 1, shape1: 0, shape2: 0, shape3: 0, shape4: 0, shape5: 0 }, "Stepped rise of held plateaus: a rough step sequencer for pitch."],
  ["Wobble Loop", { count: 4, run: "Free", time1: 0.12, level1: 1, shape1: 0.5, time2: 0.12, level2: -0.2, shape2: -0.5, time3: 0.12, level3: 0.7, shape3: 0.5, time4: 0.12, level4: -0.6, shape4: -0.5 }, "Irregular free-running wobble for filter or pitch."],
  ["Long Evolve", { count: 4, time1: 6, level1: 0.4, shape1: 0, time2: 8, level2: 1, shape2: 0.3, time3: 10, level3: 0.5, shape3: -0.3, time4: 12, level4: 0, shape4: 0.4 }, "Multi-stage slow movement over half a minute for ambient textures."],
  ["Velocity Snap", { count: 2, time1: 0.003, level1: 1, time2: 0.2, level2: 0, shape2: 0.6, velamount: 0.8 }, "Pluck whose level follows the played velocity."],
  ["Finish Tail", { count: 3, release: "Finish", time1: 0.01, level1: 1, time2: 0.3, level2: 0.5, shape2: 0.4, time3: 0.8, level3: 0, shape3: 0.5 }, "Plays through all stages even on a short note: one-shot percussion."],
];
