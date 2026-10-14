// SPDX-License-Identifier: MIT
// Arpeggiator: factory presets (pattern, rate, octaves, gate, swing, latch).
export default [
  ["Classic Up", { pattern: "Up", rate: "1/16", octaves: 1, gatelength: 0.5 }, "Held notes climb in sixteenths: the standard arpeggio."],
  ["Down Run", { pattern: "Down", rate: "1/16", octaves: 2, gatelength: 0.5 }, "Falls from the top note down across two octaves."],
  ["Up-Down Two Octaves", { pattern: "Up-Down", rate: "1/16", octaves: 2, gatelength: 0.6 }, "Climbs and falls over two octaves without repeating the end notes."],
  ["Up and Down Repeat", { pattern: "Up & Down", rate: "1/8", octaves: 1, gatelength: 0.5 }, "Climbs and falls, repeating the top and bottom notes."],
  ["Played Order", { pattern: "Played", rate: "1/16", octaves: 1, gatelength: 0.5 }, "Plays notes in the order you pressed them."],
  ["Staccato Pluck", { pattern: "Up", rate: "1/16", octaves: 2, gatelength: 0.12 }, "Very short gates for plucked, bouncy arpeggios."],
  ["Legato Flow", { pattern: "Up-Down", rate: "1/8", octaves: 3, gatelength: 1 }, "Notes join up across three octaves: a smooth, flowing line."],
  ["Swung Sixteenths", { pattern: "Up", rate: "1/16", octaves: 1, gatelength: 0.45, swing: 0.62 }, "Shuffled sixteenths for a groovy house-style arp."],
  ["Triplet Gallop", { pattern: "Up", rate: "1/8T", octaves: 2, gatelength: 0.5 }, "Eighth-note triplets that gallop upward."],
  ["Converge", { pattern: "Converge", rate: "1/16", octaves: 2, gatelength: 0.5 }, "Alternates from the outside in, meeting in the middle."],
  ["Diverge", { pattern: "Diverge", rate: "1/16", octaves: 2, gatelength: 0.5 }, "Starts at the middle and spreads outward."],
  ["Random Sparkle", { pattern: "Random", rate: "1/16", octaves: 4, gatelength: 0.3 }, "Random notes over four octaves: glittery and unpredictable."],
  ["Latched Pad Arp", { pattern: "Up-Down", rate: "1/8", octaves: 2, gatelength: 0.8, latch: "On" }, "Latch keeps the arp going after you let go."],
  ["Fast Trance", { pattern: "Up", rate: "1/32", octaves: 3, gatelength: 0.4 }, "Thirty-second notes over three octaves for a fast trance run."],
  ["Slow Quarter Walk", { pattern: "Down-Up", rate: "1/4", octaves: 1, gatelength: 0.9 }, "A slow, spacious quarter-note walk down and up."],
];
