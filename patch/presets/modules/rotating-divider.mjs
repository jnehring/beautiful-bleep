// SPDX-License-Identifier: MIT
// Rotating Div: factory presets (division set, rotation, width, base).
export default [
  ["Integer Set", { set: "Integers", rotate: 0 }, "Divisions 1 to 8 across the outputs: the plain starting point."],
  ["Integers Rotated", { set: "Integers", rotate: 3, rotatemode: "Wrap" }, "The same set shifted three outputs along, wrapping round."],
  ["Odd Divisions", { set: "Odds", rotate: 0, width: 0.4 }, "Divisions 1, 3, 5, 7 and so on: off-kilter, interlocking pulses."],
  ["Even Divisions", { set: "Evens", rotate: 0, width: 0.5 }, "Divisions 2, 4, 6 and so on: steady, related pulses."],
  ["Prime Rotation", { set: "Primes", rotate: 2, width: 0.3 }, "Prime divisions shifted by two: very slow to repeat."],
  ["Binary Ladder", { set: "Powers of 2", rotate: 0 }, "Powers of two: classic halving for kick, snare and hats."],
  ["Fibonacci Spiral", { set: "Fibonacci", rotate: 0, width: 0.35 }, "Fibonacci divisions for organic cross-rhythms."],
  ["Extending Rotate", { set: "Integers", rotate: 8, rotatemode: "Extend" }, "Rotate extends the set upward instead of wrapping."],
  ["Triggers Instant", { set: "Evens", rotate: 4, output: "Trigger", sync: "Immediate" }, "Triggers for drums; rotation changes take effect at once."],
  ["Bar-Locked Rotation", { set: "Odds", rotate: 5, sync: "Next Bar", realign: "1 bar" }, "Rotation moves only at the bar line, resyncing each bar."],
  ["Eighth Base Pulses", { set: "Powers of 2", rotate: 1, base: "1/8", width: 0.7 }, "A slower base clock with long gates."],
  ["Triplet Fibonacci", { set: "Fibonacci", rotate: 2, base: "1/16T", gatelength: "Base Step" }, "Triplet base with base-step gates for skittering hits."],
];
