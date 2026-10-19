// SPDX-License-Identifier: MIT
// Shape Table (shape-table): factory presets. Each carries its curve as data (65 points).
const N = 65;
const curves = {
  linear: (x) => x,
  soft: (x) => Math.tanh(2.2 * x) / Math.tanh(2.2),
  hard: (x) => Math.max(-1, Math.min(1, 2 * x)),
  fold: (x) => Math.sin(2 * Math.PI * x),
  stairs: (x) => {
    const s = (x + 1) * 4, k = Math.floor(s), f = s - k;
    const m = f < 0.7 ? 0 : (f - 0.7) / 0.3;
    return Math.max(-1, Math.min(1, (k + m * m * (3 - 2 * m)) / 4 - 1 + 0.125));
  },
  asym: (x) => (x >= 0 ? Math.tanh(1.8 * x) / Math.tanh(1.8) : Math.max(-0.85, 1.3 * x)),
  rectify: (x) => Math.abs(x) * 2 - 1,
  sine: (x) => Math.sin(0.5 * Math.PI * x),
};
const data = (name) => ({
  curve: Array.from({ length: N }, (_, i) => Math.round(Math.max(-1, Math.min(1, curves[name](-1 + 2 * i / (N - 1)))) * 1000) / 1000),
});

export default [
  ["Soft Warmth", { drive: 6, mix: 0.6 }, "Gentle saturation blended under the dry sound.", data("soft")],
  ["Hard Clip", { drive: 10 }, "A hard limit with bright, odd harmonics.", data("hard")],
  ["Fold Over", { drive: 12 }, "A sine folded into a rich, vocal tone.", data("fold")],
  ["Staircase", { drive: 3 }, "Eight steps: a digital, quantised edge.", data("stairs")],
  ["Lopsided", { drive: 9, bias: 0.1 }, "Soft on one side, harder on the other: even harmonics.", data("asym")],
  ["Rectifier", { drive: 0, out: -3 }, "Full-wave rectification: the octave jumps up.", data("rectify")],
  ["Sine Table Wrap", { drive: 12, edge: "Wrap" }, "The curve repeats beyond the edges: a wavetable of one sine.", data("sine")],
  ["Mirror Fold", { drive: 9, edge: "Fold" }, "The curve mirrors at the edges: folding with a smooth bend.", data("fold")],
  ["Gentle Saturator", { drive: 3, mix: 0.5, quality: "4x" }, "Subtle warmth for a full mix.", data("soft")],
  ["Octave Up", { drive: 6, mix: 0.7 }, "Rectifier blended with the dry signal.", data("rectify")],
  ["Bias Growl", { drive: 14, bias: 0.35 }, "A biased soft curve: growly and asymmetric.", data("soft")],
  ["Wrap Chaos", { drive: 20, edge: "Wrap" }, "Extreme drive with wrapping: dense and metallic.", data("fold")],
  ["Crunch Eco", { drive: 18, quality: "Off" }, "No oversampling: raw, aliased crunch.", data("hard")],
  ["Linear Pass", { drive: 0 }, "A straight line: the sound passes unchanged. Draw on it.", data("linear")],
];
