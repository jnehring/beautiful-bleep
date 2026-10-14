// SPDX-License-Identifier: MIT
// Dual Filter: factory presets (see ../build-modules.mjs). Mode 0 LP, 0.33 BP, 0.67 HP, 1 notch.
export default [
  ["Warm Serial LP", { cutoff: 1000, spread: 0.5, res1: 0.2, res2: 0.2, routing: "Serial" }, "Two low-passes in a row: a steep, smooth roll-off."],
  ["Wide Band-Pass", { cutoff: 1200, spread: 1.5, mode1: 0.67, mode2: 0, res1: 0.25, res2: 0.25, routing: "Serial" }, "High-pass into low-pass: an adjustable band you widen with Spread."],
  ["Formant Pair", { cutoff: 900, spread: 1.2, mode1: 0.33, mode2: 0.33, res1: 0.7, res2: 0.7, routing: "Parallel" }, "Two resonant band-passes side by side, like vowel formants."],
  ["Vowel Sweep", { cutoff: 700, spread: 1.6, mode1: 0.33, mode2: 0.33, res1: 0.6, res2: 0.65, routing: "Parallel", keyTrack: 0.4 }, "Sweep Cutoff with an LFO for a talking vowel movement."],
  ["Stereo Split", { cutoff: 1500, spread: 1, res1: 0.35, res2: 0.35, routing: "Stereo" }, "Left and right get different cutoffs for a wide, shifting image."],
  ["Phase Notch", { cutoff: 1400, spread: 1, mode1: 1, mode2: 1, res1: 0.5, res2: 0.5, routing: "Parallel (F2 inverted)" }, "Inverted parallel sum: moving, hollow notches."],
  ["Dark Pad Filter", { cutoff: 450, spread: 0.3, res1: 0.1, res2: 0.1, routing: "Serial" }, "Closed, soft low-pass to tuck a pad behind a mix."],
  ["Thin Radio", { cutoff: 2200, spread: 1.5, mode1: 0.67, mode2: 0.33, res1: 0.3, res2: 0.3, routing: "Serial" }, "Lo-fi band-limited voice."],
  ["Mirror Morph", { cutoff: 1000, spread: 1, mode1: 0.2, res1: 0.4, res2: 0.4, link: "Mirror", routing: "Parallel" }, "Linked modes move opposite ways: sweep Mode 1 to morph."],
  ["Resonant Bass", { cutoff: 220, spread: 0.4, res1: 0.6, res2: 0.4, drive: 0.3, character: "Saturating", keyTrack: 0.6 }, "Round, resonant low end with a bit of drive."],
  ["Acid Twin", { cutoff: 600, spread: 0.8, res1: 0.8, res2: 0.7, drive: 0.5, character: "Saturating", routing: "Serial" }, "Squelchy two-stage low-pass; envelope on Cutoff."],
  ["Crossed Filters", { cutoff: 1500, spread: -2, mode1: 0, mode2: 0.67, res1: 0.5, res2: 0.5, routing: "Parallel" }, "Negative spread swaps the filters: low-pass above, high-pass below."],
  ["Ringing Pair", { cutoff: 1800, spread: 2.5, mode1: 0.33, mode2: 0.33, res1: 0.9, res2: 0.9, routing: "Serial", mix: 0.7 }, "Highly resonant pings: pluck or noise input rings like a bell."],
];
