// SPDX-License-Identifier: MIT
// Coin Toss: factory presets (probability, memory, mode, link, loop).
export default [
  ["Fair Coin", { prob1: 0.5, prob2: 0.5, link: "Independent" }, "Each gate goes to A or B at random, half and half."],
  ["Mostly A", { prob1: 0.2, prob2: 0.2 }, "Most gates go to A, B only sometimes: an occasional accent."],
  ["Mostly B", { prob1: 0.8, prob2: 0.8 }, "Most gates go to B, A only now and then."],
  ["Rare Fill", { prob1: 0.1, prob2: 0.1 }, "A very rare toss: a fill every so often."],
  ["Sticky Streaks", { prob1: 0.5, memory1: 0.8, prob2: 0.5, memory2: 0.8 }, "High memory repeats the last result: long runs on one side."],
  ["Alternating Feel", { prob1: 0.5, memory1: 0.3, link: "Opposed" }, "Two channels play opposite results for call-and-response."],
  ["Shared Toss", { prob1: 0.5, link: "Shared" }, "One toss decides both channels together."],
  ["Latch Switch", { prob1: 0.3, mode1: "Latch", mode2: "Latch" }, "The chosen output stays on until the next toss."],
  ["Toggle Flip", { prob1: 0.4, mode1: "Toggle", mode2: "Toggle" }, "Each toss can flip the output on or off."],
  ["Loop Four", { prob1: 0.5, loop: "4 tosses", seed: 7 }, "Four tosses repeat in a loop: random but a repeating pattern."],
  ["Loop Sixteen", { prob1: 0.5, prob2: 0.5, loop: "16 tosses", seed: 42 }, "A sixteen-toss pattern that repeats for a bar of variation."],
  ["Loop Three vs Eight", { prob1: 0.5, prob2: 0.5, loop: "3 tosses", seed: 11, mode2: "Toggle" }, "Short loops give a rhythm that keeps shifting."],
];
