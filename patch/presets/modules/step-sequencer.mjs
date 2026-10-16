// SPDX-License-Identifier: MIT
// Step Sequencer: factory presets for the feel and rules (rate, direction, gate, swing, scale, variation) and the
// pattern itself: every preset also sets the gate, pitch and velocity lanes of its steps (the fourth entry).
//
// pat(gates, pitches, vels): one character per step in `gates` ("x" on, "." off, "-" tie), the semitone of each
// step (relative to Root, in the preset's scale) and its velocity (1..127; one number = all steps). Steps past
// the written ones stay off, so the pattern is as long as the preset's Length (16 unless it says otherwise).
const pat = (gates, pitches, vels) => {
  const n = gates.length;
  if (pitches.length !== n) throw new Error(`step-sequencer: ${n} gates but ${pitches.length} pitches`);
  const v = Array.isArray(vels) ? vels : Array(n).fill(vels);
  if (v.length !== n) throw new Error(`step-sequencer: ${n} gates but ${v.length} velocities`);
  const steps = [...gates].map((c, i) => ({ g: c === "x" ? 1 : c === "-" ? 2 : 0, p: pitches[i], v: v[i] || 100 }));
  while (steps.length < 32) steps.push({ g: 0, p: 0, v: 100 });
  return { steps };
};
export default [
  ["Straight Sixteenths", { rate: "1/16", gatelength: 0.5, swing: 0.5, direction: "Forward", scale: "Major" }, "Plain forward sixteenth notes in C major: the neutral starting point.", pat("xxxxxxxxxxxxxxxx", [0,2,4,5,7,5,4,2,0,2,4,7,9,7,4,2], [110,80,90,80,105,80,90,80,110,80,90,85,105,80,90,80])],
  ["Tight Staccato", { rate: "1/16", gatelength: 0.15, direction: "Forward", scale: "Minor Pentatonic" }, "Short, clipped gates in minor pentatonic for plucks and bass.", pat("x.xx.x.xx.x.xx.x", [0,0,3,0,0,5,0,7,0,0,3,0,10,0,0,5], [115,0,90,100,0,85,0,105,100,0,85,0,110,0,0,90])],
  ["Legato Eighths", { rate: "1/8", gatelength: 1, direction: "Forward", scale: "Natural Minor" }, "Full-length gates in eighths so the notes run together.", pat("x-x-x-xxx-x-x-x-", [0,0,3,3,7,7,5,3,2,2,5,5,7,7,3,3], [100,0,85,0,95,0,100,85,90,0,85,0,100,0,80,0])],
  ["Swung Shuffle", { rate: "1/16", gatelength: 0.45, swing: 0.62, scale: "Dorian" }, "Sixteenths with a loose swing in Dorian for a laid-back groove.", pat("x.xx.xx.x.xx.xx.", [0,0,3,5,0,7,9,0,5,0,3,2,0,3,5,0], [110,0,80,95,0,85,100,0,105,0,80,90,0,80,100,0])],
  ["Triplet Roll", { rate: "1/8T", gatelength: 0.5, scale: "Mixolydian", length: 12 }, "Eighth-note triplets for a rolling, rounded feel.", pat("xxxxxxxxxxxx", [0,4,7,12,7,4,0,5,9,12,9,5], [105,75,85,95,75,85,105,75,85,95,75,90])],
  ["Slow Pendulum", { rate: "1/8", direction: "Ping-Pong", gatelength: 0.7, scale: "Lydian", length: 8 }, "Eight steps bouncing back and forth in Lydian: dreamy and floating.", pat("xxxxxxxx", [0,2,6,7,9,7,4,2], [90,70,80,85,100,80,75,70])],
  ["Backward Run", { rate: "1/16", direction: "Backward", gatelength: 0.4, scale: "Natural Minor" }, "Plays the pattern in reverse for a falling line.", pat("xxxxxxxxxxxxxxxx", [12,10,8,7,5,3,2,0,10,8,7,5,3,2,0,-2], [110,80,90,85,100,80,90,85,105,80,90,85,95,80,90,100])],
  ["Short Loop Eight", { rate: "1/16", length: 8, gatelength: 0.5, scale: "Phrygian" }, "A tight eight-step loop in Phrygian for driving basslines.", pat("x.xxx.xx", [0,0,1,0,5,0,8,7], [120,0,90,100,95,0,105,110])],
  ["Odd Five", { rate: "1/16", length: 5, gatelength: 0.4, scale: "Minor Pentatonic" }, "Five steps against a four-beat bar: the pattern keeps shifting.", pat("xx.xx", [0,3,0,7,5], [115,85,0,95,90])],
  ["Dense Random", { rate: "1/32", direction: "Random", gatelength: 0.25, scale: "Chromatic" }, "Thirty-second notes in random order across the whole scale.", pat("xxxxxxxxxxxxxxxx", [0,7,3,10,1,8,5,2,11,4,9,6,0,5,10,3], [100,70,85,95,65,110,75,90,100,70,85,105,60,90,80,95])],
  ["Gentle Drift", { rate: "1/8", variation: 0.35, varrange: 5, gatelength: 0.6, scale: "Major Pentatonic" }, "Notes wander a few semitones from the written pitches.", pat("x.x.x.x.x.x.x.x.", [0,0,2,0,4,0,7,0,9,0,7,0,4,0,2,0], [95,0,80,0,85,0,90,0,100,0,85,0,80,0,75,0])],
  ["Wild Variation", { rate: "1/16", variation: 0.8, varrange: 12, gatelength: 0.35, scale: "Dorian" }, "Heavy variation of up to an octave: the sequence never plays the same twice.", pat("xxxxxxxxxxxxxxxx", [0,4,7,12,2,9,5,11,0,7,4,9,2,12,5,7], [120,70,90,100,75,105,80,95,120,70,90,100,75,105,80,90])],
  ["Blues Walk", { rate: "1/8.", gatelength: 0.55, swing: 0.58, scale: "Blues", root: "A" }, "Dotted eighths in an A blues scale with a little swing.", pat("x.xx.xx.x.xx.xx.", [0,0,3,5,0,6,7,0,10,0,7,6,0,5,3,0], [105,0,85,95,0,80,100,0,110,0,85,80,0,90,100,0])],
  ["Eastern Lines", { rate: "1/16T", gatelength: 0.5, scale: "Phrygian Dominant", root: "D", direction: "Forward" }, "Sixteenth triplets in a Phrygian dominant scale.", pat("xxxxxxxxxxxxxxxx", [0,1,4,5,4,1,0,1,4,5,7,5,4,1,0,1], [110,70,85,90,100,70,85,95,110,75,85,100,90,70,80,95])],
  ["Low Octave Drone", { rate: "1/4", gatelength: 1, octave: -2, scale: "Natural Minor", root: "F", length: 8 }, "Slow, held quarter notes two octaves down for a sub line.", pat("x-x-x-x-", [0,0,0,0,3,3,-2,-2], [110,0,90,0,95,0,100,0])],
];
