// SPDX-License-Identifier: MIT
// Crunch: factory presets.
export default [
  ["Warm Saturation", { drive: 0.3, tone: 8000, level: 1 }, "Gentle tube-like warmth on anything."],
  ["Overdrive", { drive: 0.6, tone: 6000, level: 0.8 }, "Classic mid-gain overdrive."],
  ["Fuzz Wall", { drive: 0.95, tone: 3500, level: 0.6 }, "Thick, compressed fuzz with the top rolled off."],
  ["Lo-Fi Bits", { drive: 0.1, bits: 8, tone: 9000, level: 1 }, "8-bit quantisation noise, old sampler style."],
  ["Telephone Crush", { drive: 0.4, bits: 6, rate: 0.6, tone: 3000, level: 0.9 }, "Narrow, crushed and aliased."],
  ["Rate Grinder", { drive: 0.2, rate: 0.8, tone: 12000, level: 1 }, "Sample-rate reduction aliasing without much bit loss."],
  ["Broken Machine", { drive: 0.5, bits: 4, rate: 0.7, tone: 6000, level: 0.7 }, "Harsh digital breakdown."],
  ["Parallel Grit", { drive: 0.7, bits: 10, tone: 5000, level: 1, mix: 0.35 }, "Crunch blended under a clean signal for grit with body."],
  ["Drum Crunch", { drive: 0.55, bits: 12, rate: 0.2, tone: 10000, level: 0.9, mix: 0.6 }, "Adds bite and crackle to drum loops."],
  ["Dark Dirt", { drive: 0.8, tone: 1200, level: 0.9 }, "Heavy drive filtered dark for bass."],
  ["Bit Dust", { bits: 12, rate: 0.15, tone: 14000, drive: 0.05 }, "Subtle degradation, like a worn digital converter."],
  ["Square Wave Mangler", { drive: 0.3, bits: 2, tone: 4000, level: 0.5 }, "Two bits turn everything into buzzing pulses."],
  ["Total Destruction", { drive: 1, bits: 3, rate: 0.9, tone: 8000, level: 0.5 }, "Everything at once; keep the level low."],
];
