// SPDX-License-Identifier: MIT
// Starters: empty cells to build your own instrument or effect from, in Bleep Instrument or Bleep FX.
import { voice, cell, category } from "./kit.mjs";

// A Voice Cell with nothing inside: the voice stays alive while the key is held, and is silent.
function emptyInstrument() {
  const p = voice("Empty Instrument", {
    description: "A blank Voice Cell: notes in, nothing inside yet. Open the board and patch your own voice between Voice In and Voice Out.",
    tags: ["starter", "empty"], empty: true,
  });
  p.cable(p.vin, "gate", p.vout, "active");
  return p;
}

// A cell that passes the audio straight through.
function emptyFx() {
  const p = cell("Empty FX", {
    description: "A blank effect: the audio passes straight through. Open the board and put your own modules between In and Out.",
    tags: ["starter", "empty"],
  }).stereoIn().stereoOut();
  p.stereo(p.cin, p.cout);
  return p;
}

export default category("Starters", "Empty cells to start your own instrument or effect from.", [emptyInstrument, emptyFx]);
