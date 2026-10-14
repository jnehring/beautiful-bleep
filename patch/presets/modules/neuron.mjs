// SPDX-License-Identifier: MIT
// Neuron: factory presets (see ../build-modules.mjs).
export default [
  ["Default Rhythm", { }, "Two neurons that answer each other: a rhythm with no cables."],
  ["Steady Pulse", { aw1: 0.9, athreshold: 0.5, aleak: 0.5, bw1: 0.5, bw3: 0, bthreshold: 0.5, bleak: 0.5 }, "Two independent steady pulse trains, no cross talk."],
  ["Slow Heartbeat", { aw1: 0.7, aw3: 0, aleak: 1.5, apulse: 0.1, bw1: 0.7, bw3: 0.5, bleak: 2, bpulse: 0.1 }, "Low, slow double-thump patterns."],
  ["Fast Chatter", { aw1: 1.5, aleak: 0.1, apulse: 0.01, bw1: 1.3, bleak: 0.15, bpulse: 0.01 }, "Rapid spikes for glitchy triggers."],
  ["Call and Response", { aw1: 0.8, aw3: 0, aleak: 0.4, bw1: 0, bw3: 1.2, bleak: 0.2, bthreshold: 0.4 }, "B only fires after A: a delayed answer."],
  ["Mutual Silence", { aw1: 1.2, aw3: -0.8, aleak: 0.3, bw1: 1.2, bw3: -0.8, bleak: 0.4 }, "Each neuron inhibits the other for alternating bursts."],
  ["Compare Gates", { amode: "Compare", bmode: "Compare", aw1: 0.7, aw3: 0.5, aleak: 1, bw1: 0.6, bw3: -1, bleak: 1.5, ahysteresis: 0.2, bhysteresis: 0.2 }, "Self-switching gates that settle into slow on-off patterns."],
  ["Smooth Out", { amode: "Compare", bmode: "Compare", aw1: 0.8, athreshold: 0.2, asharp: 2, bw1: 0.8, bthreshold: 0.3, bsharp: 2, aleak: 2, bleak: 3 }, "Gentle control outputs with soft slopes for modulation."],
  ["Logic Mix", { aw1: 0.9, aw3: 0.3, aleak: 0.3, bw1: 1.1, bw3: -0.5, bleak: 0.5, apulse: 0.12, bpulse: 0.12 }, "Long pulses so the AND, OR and XOR outputs show overlaps."],
  ["Gate Cross", { cross: "Gate", aw1: 0.8, aw3: 0.8, aleak: 0.3, bw1: 0.6, bw3: -0.7, bleak: 0.4 }, "Neurons listen to each other's gates instead of their outputs."],
  ["Independent Pair", { cross: "Off", aw1: 0.8, aleak: 0.3, bw1: 0.65, bleak: 0.45 }, "No cross talk: two polyrhythmic pulses of different speeds."],
  ["Sparse Triggers", { aw1: 0.55, athreshold: 0.5, aleak: 1, bw1: 0.5, bw3: 0, bleak: 1.2, bthreshold: 0.5, apulse: 0.02, bpulse: 0.02 }, "Barely above threshold: occasional, slow triggers."],
  ["Chaotic Pair", { aw1: 1.1, aw3: 1.4, aleak: 0.2, bw1: 1.4, bw3: -1.6, bleak: 0.3, asharp: 20, bsharp: 20 }, "Strong coupling creates unpredictable patterns."],
];
