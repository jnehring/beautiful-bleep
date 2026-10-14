// SPDX-License-Identifier: MIT
// Saturator: factory presets.
export default [
  ["Subtle Warmth", { drive: 0.2, bias: 0.2, sag: 0.3, age: 0.2, character: "Tube", level: 1 }, "A hint of even harmonics on anything."],
  ["Bus Glue", { drive: 0.35, bias: 0.1, sag: 0.5, age: 0.15, character: "Tape", color: -0.15, level: 1 }, "Soft, compressed tape-like cohesion for a mix bus."],
  ["Tape Drums", { drive: 0.5, sag: 0.55, age: 0.2, character: "Tape", color: -0.2, tone: 11000, level: 0.95 }, "Rounded transients and a fatter body for drum loops."],
  ["Tube Crunch", { drive: 0.7, bias: 0.25, sag: 0.4, age: 0.25, character: "Tube", color: 0.4, tone: 6000, level: 0.85 }, "Amp-like crunch with edge in the upper mids."],
  ["Fat Bass", { drive: 0.55, bias: 0.2, sag: 0.35, age: 0.1, character: "Tube", color: -0.6, tone: 3000, level: 0.9, mix: 0.75 }, "Thick low end that stays smooth on top."],
  ["Sub Weight", { drive: 0.4, bias: 0.5, sag: 0.2, age: 0.1, character: "Tube", color: -0.8, tone: 1800, level: 0.9, mix: 0.6 }, "Even-harmonic weight under a sub."],
  ["Diode Bite", { drive: 0.45, sag: 0.3, age: 0.2, character: "Diode", color: 0.3, tone: 8000, level: 0.9 }, "Edgy, vocal asymmetry."],
  ["Vocal Heat", { drive: 0.3, bias: 0.15, sag: 0.4, age: 0.3, character: "Diode", color: 0.15, tone: 12000, level: 1 }, "Gentle presence and density for a voice."],
  ["Breathing Pad", { drive: 0.35, bias: 0.3, sag: 0.4, age: 0.85, character: "Tape", tone: 9000, level: 1 }, "Slow drift makes a held chord shimmer and breathe."],
  ["Loose Gear", { drive: 0.5, bias: 0.2, sag: 0.6, age: 1, character: "Tube", tone: 10000, level: 0.9 }, "Everything wanders a little, like old hardware."],
  ["Sagging Supply", { drive: 0.6, bias: 0.3, sag: 1, age: 0.3, character: "Tube", color: 0.1, level: 0.9 }, "Hard hits squash and bloom."],
  ["Fuzz Wall", { drive: 1, bias: 0.4, sag: 0.7, age: 0.3, character: "Diode", color: 0.2, tone: 3500, level: 0.6 }, "Thick, compressed, anti-aliased fuzz."],
  ["Parallel Grit", { drive: 0.8, bias: 0.3, sag: 0.4, age: 0.2, character: "Tube", color: 0.3, tone: 7000, level: 1, mix: 0.35 }, "Hard-driven copy blended under the clean signal."],
  ["Eco Warmth", { drive: 0.3, bias: 0.15, sag: 0.3, age: 0.2, character: "Tube", quality: "Eco (2×)", level: 1 }, "Light on CPU for many instances."],
];
