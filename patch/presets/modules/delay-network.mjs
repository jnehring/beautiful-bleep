// SPDX-License-Identifier: MIT
// Delay Net: factory presets.
export default [
  ["Soft Ring", { time: 0.4, taps: 4, feedback: 0.4, character: 0.2, mix: 0.35, routing: "Ring" }, "A modest four-line ring that blooms into a cloud."],
  ["Parallel Taps", { time: 0.5, taps: 4, scatter: 0.4, feedback: 0.3, width: 0.8, mix: 0.35, routing: "Parallel" }, "Four separate scattered echoes."],
  ["Chain Cascade", { time: 0.3, taps: 6, feedback: 0.4, character: 0.2, mix: 0.4, routing: "Chain" }, "Each line feeds the next: cascading repeats."],
  ["Mesh Cloud", { time: 0.25, taps: 8, scatter: 0.5, feedback: 0.6, character: 0.3, tone: -0.2, mix: 0.45, routing: "Mesh" }, "Every line feeds every other: a dense, reverb-like cloud."],
  ["Tempo Scatter", { sync: "1/8", taps: 5, scatter: 0.7, feedback: 0.5, mix: 0.35, routing: "Parallel" }, "Eighth-note grid with uneven tap spacing."],
  ["Wobbly Tape", { time: 0.7, taps: 3, jitter: 0.5, feedback: 0.5, character: 0.5, tone: -0.3, mix: 0.4, routing: "Ring" }, "Jittered times and a worn character."],
  ["Reverse Bloom", { time: 0.6, taps: 4, reverse: 0.8, feedback: 0.5, character: 0.2, mix: 0.4, routing: "Ring" }, "Mostly reversed repeats."],
  ["Dark Tunnel", { time: 1.2, taps: 4, feedback: 0.7, character: 0.4, tone: -0.7, width: 0.9, mix: 0.4, routing: "Chain" }, "Long, dark repeats receding into the distance."],
  ["Bright Glimmer", { time: 0.12, taps: 6, scatter: 0.3, feedback: 0.55, tone: 0.6, width: 1, mix: 0.3, routing: "Mesh" }, "Short bright taps shimmer around the signal."],
  ["Slow Drift", { time: 3, taps: 4, scatter: -0.4, jitter: 0.3, feedback: 0.6, character: 0.3, mix: 0.4, routing: "Ring" }, "Multi-second delay lines for ambient layering."],
  ["Dirty Loop", { time: 0.9, taps: 2, feedback: 0.85, character: 0.8, tone: -0.2, mix: 0.45, routing: "Ring" }, "Saturated feedback that builds a gritty loop."],
  ["Granular Smear", { time: 0.08, taps: 8, scatter: 0.8, jitter: 0.7, reverse: 0.3, feedback: 0.6, character: 0.4, mix: 0.5, routing: "Mesh" }, "Tiny jittered lines smear into textures."],
  ["Mono Pulse", { time: 0.35, taps: 1, feedback: 0.45, width: 0, mix: 0.3, routing: "Parallel" }, "A single plain echo line in mono."],
  ["Swell Cathedral", { time: 0.5, taps: 8, scatter: 0.6, feedback: 0.92, character: 0.5, tone: -0.4, width: 1, mix: 0.5, routing: "Mesh" }, "Near-unity feedback: swells for ages; turn the mix down first."],
];
