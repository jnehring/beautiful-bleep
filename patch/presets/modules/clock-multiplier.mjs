// SPDX-License-Identifier: GPL-3.0-only
// Clock Mult: factory presets (six ratios, skips, swing, humanize, phase lock).
export default [
  ["Ratio Ladder", { ratio1: "2", ratio2: "3", ratio3: "4", ratio4: "3/2", ratio5: "5/4", ratio6: "8" }, "Whole and fractional ratios side by side: 2, 3, 4, 3/2, 5/4 and 8 per clock."],
  ["Straight Doubles", { ratio1: "1", ratio2: "2", ratio3: "4", ratio4: "8", ratio5: "16", ratio6: "1/2" }, "Powers of two up from the clock, plus a half-speed output: everything lines up."],
  ["Triplet Roll", { ratio1: "3", ratio2: "6", ratio3: "12", ratio4: "3/2", ratio5: "3/4", ratio6: "1" }, "Threes in every size, from a lazy 3/4 to a rolling 12 per clock."],
  ["Five Against Four", { ratio1: "5", ratio2: "5/2", ratio3: "5/4", ratio4: "5/3", ratio5: "1", ratio6: "4" }, "Fifths over a four-beat feel: the odd outputs slide against the plain ones."],
  ["Seven Over", { ratio1: "7", ratio2: "7/2", ratio3: "7/4", ratio4: "4", ratio5: "2", ratio6: "1" }, "Septuplets against halves and quarters; the anchors meet on every clock."],
  ["Shuffled Sixteenths", { ratio1: "4", ratio2: "4", ratio3: "2", ratio4: "8", ratio5: "1", ratio6: "2", swing: 0.6 }, "Swing on the in-between ticks only: the beat stays put, the offbeats lean late."],
  ["Loose Hands", { ratio1: "4", ratio2: "2", ratio3: "8", ratio4: "4", ratio5: "1", ratio6: "8", humanize: 0.7 }, "Every in-between tick lands a little late, differently each time round; anchors stay tight."],
  ["Thinning Out", { ratio1: "8", ratio2: "8", ratio3: "8", ratio4: "8", ratio5: "16", ratio6: "16", skip1: 0.1, skip2: 0.25, skip3: 0.4, skip4: 0.55, skip5: 0.7, skip6: 0.85 }, "The same fast clock, each output losing more ticks than the one before."],
  ["Ghost Hats", { ratio1: "8", ratio2: "4", ratio3: "16", ratio4: "2", ratio5: "1", ratio6: "8", skip1: 0.5, skip3: 0.7, humanize: 0.3, swing: 0.2 }, "Half the eighths and most of the sixteenths drop out; what is left feels played."],
  ["Free Skips", { ratio1: "4", ratio2: "4", ratio3: "8", ratio4: "3", ratio5: "6", ratio6: "2", skip1: 0.3, skip2: 0.5, skip3: 0.6, skip4: 0.4, skip5: 0.5, skip6: 0.2, keepbeat: false }, "Keep Beat off: even the ticks on the clock can drop, so the pulse itself gets loose."],
  ["Half-Time Pulses", { ratio1: "1/2", ratio2: "1/4", ratio3: "1/3", ratio4: "2/3", ratio5: "3/4", ratio6: "1/8" }, "Slower than the clock: gates for pads, chord changes and slow modulation."],
  ["Dotted Feel", { ratio1: "3/2", ratio2: "3/4", ratio3: "3", ratio4: "3/2", ratio5: "1", ratio6: "6", swing: 0.35 }, "Ratios of three over two give dotted spacing; a little swing leans the in-betweens."],
  ["Flywheel", { ratio1: "2", ratio2: "4", ratio3: "3", ratio4: "8", ratio5: "1", ratio6: "6", lock: 0 }, "Phase Lock at zero: the outputs keep running on the learned tempo when the clock stops."],
  ["Soft Lock", { ratio1: "2", ratio2: "4", ratio3: "3", ratio4: "8", ratio5: "1", ratio6: "6", lock: 0.4 }, "A partial lock: a wobbly input clock is smoothed instead of followed tick for tick."],
  ["Long Gates", { ratio1: "2", ratio2: "4", ratio3: "1", ratio4: "3", ratio5: "1/2", ratio6: "8", output: "Gate", width: 0.8 }, "Gate output at 80 % of each interval: legato gates for envelopes and holds."],
  ["Swung Everything", { ratio1: "2", ratio2: "4", ratio3: "8", ratio4: "3/2", ratio5: "6", ratio6: "12", swing: 0.9, humanize: 0.15, keepbeat: false, skip3: 0.2 }, "Heavy swing, a hint of humanize and an occasional dropped tick on the busy output."],
];
