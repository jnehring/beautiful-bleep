// SPDX-License-Identifier: MIT
// Starters: empty cells to build your own instrument or effect from, in Bleep Instrument or Bleep FX.
import { voice, cell, category } from "./kit.mjs";

// A Voice Cell with nothing inside: the voice stays alive while the key is held, and is silent.
function emptyInstrument() {
  const p = voice("Empty Instrument", {
    description: "A blank Voice Cell: notes in, nothing inside yet. Open the board and patch your own voice between Voice In and Voice Out.",
    tags: ["starter", "empty"], empty: true,
    help: "A Voice Cell with nothing inside except a cable that keeps the voice alive while a key is held, so it is silent.\n\n" +
      "Open the cell, add your modules, and cable Voice In (pitch, gate, trigger, velocity) into them and into Voice Out. " +
      "Patch Notes in and take Out L/R.\n\n" +
      "Tip: an Oscillator from the pitch jack, into a VCA opened by an ADSR, is the smallest voice.",
  });
  p.cable(p.vin, "gate", p.vout, "active");
  return p;
}

// A cell that passes the audio straight through.
function emptyFx() {
  const p = cell("Empty FX", {
    description: "A blank effect: the audio passes straight through. Open the board and put your own modules between In and Out.",
    tags: ["starter", "empty"],
    help: "A stereo effect cell with nothing inside: In L/R are cabled straight to Out L/R, so audio passes unchanged.\n\n" +
      "Patch audio into In L/R and take Out L/R. Open the cell and put your own modules between In and Out.\n\n" +
      "Tip: remove the straight pass-through cables once your own chain is cabled in.",
  }).stereoIn().stereoOut();
  p.stereo(p.cin, p.cout);
  return p;
}

export default category("Starters", "Empty cells to start your own instrument or effect from.", [emptyInstrument, emptyFx]);
