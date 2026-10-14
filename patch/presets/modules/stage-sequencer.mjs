// SPDX-License-Identifier: MIT
// Stage Seq: factory presets (stage count, rate, mode, phrase length, scale, slide/accent).
export default [
  ["Eight Stages", { stages: 8, rate: "1/16", mode: "Forward", scale: "Major" }, "Eight stages played forward: the neutral setup."],
  ["Sixteen Stages", { stages: 16, rate: "1/16", mode: "Forward", scale: "Minor Pentatonic" }, "All sixteen stages for a long phrase."],
  ["Short Four", { stages: 4, rate: "1/8", mode: "Forward", gatelength: 0.6, scale: "Natural Minor" }, "A four-stage loop: tight and repetitive."],
  ["Reverse", { stages: 8, rate: "1/16", mode: "Reverse", scale: "Dorian" }, "Stages play backward."],
  ["Slow Pendulum", { stages: 8, rate: "1/8", mode: "Pendulum", gatelength: 0.8, scale: "Lydian" }, "Swings forward and back through the stages."],
  ["Random Stages", { stages: 8, rate: "1/16", mode: "Random", scale: "Minor Pentatonic" }, "Stages in random order."],
  ["Brownian Wander", { stages: 12, rate: "1/16", mode: "Brownian", gatelength: 0.5, scale: "Dorian" }, "Each step moves one stage up or down: a drifting melody."],
  ["Slidey Lead", { stages: 8, rate: "1/16", slidetime: 0.25, gatelength: 0.9, scale: "Minor Pentatonic" }, "Long slide times make marked stages glide."],
  ["Snappy Slide", { stages: 8, rate: "1/16", slidetime: 0.02, gatelength: 0.5, scale: "Phrygian" }, "Very short slides: a quick portamento snap."],
  ["Hard Accents", { stages: 8, rate: "1/16", accent: 1, gatelength: 0.4, scale: "Minor Pentatonic" }, "Accented stages hit at full strength."],
  ["Soft Accents", { stages: 8, rate: "1/8", accent: 0.15, gatelength: 0.7, scale: "Major Pentatonic" }, "Accents barely stand out: an even, gentle line."],
  ["Swung Stages", { stages: 8, rate: "1/16", swing: 0.62, gatelength: 0.45, scale: "Mixolydian" }, "A shuffle across the stages."],
  ["Triplet Phrase", { stages: 6, rate: "1/8T", phrase: "2 bars", scale: "Blues", root: "A" }, "Triplets over a two-bar phrase."],
  ["Long Phrase Bass", { stages: 16, rate: "1/8", phrase: "8 bars", octave: -2, gatelength: 0.8, scale: "Natural Minor", root: "E" }, "A long eight-bar phrase an octave pair down."],
];
