// SPDX-License-Identifier: MIT
// Melody Mirror: factory presets (mode, length, axis, gap, speed, transpose).
export default [
  ["Backwards Tune", { mode: "Reverse", length: 6, gap: "1 beat" }, "A beat after you stop, the last six notes come back in reverse."],
  ["Upside Down", { mode: "Invert", length: 6, axismode: "First Note" }, "The phrase mirrored in pitch around its first note, same rhythm."],
  ["Rotated Pitches", { mode: "Rotate", length: 5, rotate: 1 }, "The pitches shift one place along the same rhythm."],
  ["Mirror Image", { mode: "Mirror", length: 6 }, "Backwards and upside down together."],
  ["Call And Response", { mode: "Answer", reply: "Mirror", length: 6, gap: "1 beat" }, "Play a phrase; it waits for your pause, answers with the mirror image and listens again."],
  ["Answer Upside Down", { mode: "Answer", reply: "Invert", length: 8, gap: "2 beats" }, "A calm answer: your phrase inverted after two beats of silence."],
  ["Answer In Reverse", { mode: "Answer", reply: "Reverse", length: 4, gap: "1/2 beat" }, "A quick reply that plays your last four notes backwards."],
  ["Slow Retrograde", { mode: "Reverse", length: 6, speed: 0.5 }, "The reversed phrase at half speed."],
  ["Double Time Mirror", { mode: "Mirror", length: 8, speed: 2 }, "The mirror image at double speed, like a tape running fast."],
  ["Octave Up Reverse", { mode: "Reverse", length: 6, transpose: 12 }, "The reversed phrase an octave higher."],
  ["Scale Snapped Inversion", { mode: "Invert", length: 6, snap: "On", root: "C", scale: "Major" }, "The inverted phrase is pulled into C major so it never leaves the key."],
  ["Fixed Axis Flip", { mode: "Invert", length: 6, axismode: "Fixed", axis: 72 }, "Pitches mirrored around C5: low notes become high ones."],
  ["Mean Axis Flip", { mode: "Invert", length: 8, axismode: "Mean" }, "Mirrored around the average pitch of the phrase."],
  ["Triggered Replay", { mode: "Mirror", length: 8, start: "Trigger" }, "Plays only when a trigger arrives or you press Replay."],
  ["Short Motif Turner", { mode: "Rotate", length: 4, rotate: 2, gap: "1/2 beat" }, "A four-note motif comes back with its pitches turned two places."],
  ["Soft Reply", { mode: "Answer", reply: "Mirror", length: 6, velocity: 0.6, gatelength: 0.7 }, "The answer is quieter and shorter than the question."],
];
