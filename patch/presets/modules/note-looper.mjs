// SPDX-License-Identifier: MIT
// Note Looper: factory presets (length, mode, speed, quantize, probability).
export default [
  ["Two Bar Loop", { bars: 2, mode: "Play" }, "A two-bar loop in play: set Mode to Record and play it in."],
  ["One Bar Pulse", { bars: 1 }, "A one-bar loop for short, repeating figures."],
  ["Four Bar Phrase", { bars: 4 }, "Four bars: room for a melody that goes somewhere."],
  ["Eight Bar Story", { bars: 8 }, "Eight bars for a whole verse of notes."],
  ["Overdub Layers", { bars: 2, mode: "Overdub" }, "Records on top of what is already looping; Undo takes the last layer off."],
  ["Fresh Take", { bars: 2, mode: "Record" }, "Throws the old loop away and records a new one."],
  ["Half Speed Drift", { bars: 2, speed: "Half" }, "The loop plays at half speed: the same notes, twice as long."],
  ["Double Speed Flurry", { bars: 2, speed: "Double" }, "The loop at double speed."],
  ["Tight Sixteenths", { bars: 2, quantize: "1/16", strength: 1 }, "Notes snap fully to the sixteenth grid."],
  ["Loose Eighths", { bars: 2, quantize: "1/8", strength: 0.5 }, "Notes move halfway to the eighth grid: tidied, but still human."],
  ["Triplet Snap", { bars: 2, quantize: "1/8T", strength: 1 }, "Everything snaps to triplets."],
  ["Ghost Notes", { bars: 2, probability: 0.6 }, "Each pass plays about 60 % of the notes, differently every time."],
  ["Sparse Memory", { bars: 4, probability: 0.3, seed: 7 }, "A handful of notes per pass: the loop hints at the tune."],
  ["Silent Thru", { bars: 2, thru: "Mute" }, "What you play is recorded but not heard until the loop comes round."],
  ["Waltz Loop", { bars: 2, beatsperbar: 3 }, "Bars of three beats."],
];
