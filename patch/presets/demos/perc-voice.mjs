// SPDX-License-Identifier: MIT
// Perc Voice: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: o.rate || "1/8", root: o.root || "C",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.4 }, { data: steps(notes, o.vel), name: o.name || "Notes" });
}
/// Mixer → Verb → Out 1/2. chans: {n, l, r (jacks), level, pan}
function finish(p, at, chans, o = {}) {
  const lv = {};
  chans.forEach((c, i) => { lv[`level${i + 1}`] = c.level ?? -6; lv[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, { ...lv, master: o.master ?? 0 });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r !== false) p.cable(c.n, c.r || "r", mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.2, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return mix;
}

function modalKit() {
  const p = patch("Perc Voice: Modal Kit", {
    module: "perc-voice", tempo: 98,
    description: "A whole kit from three Perc Voices in different engines: a Modal kick (Tone 8 %, Sweep high), a Noise Bank snare with a wide Morph and a membrane-toned Modal tom. Velocity from the grid goes into Accent, so soft hits are duller as well as quieter. Try Tone and Decay on each voice, or Drive on the kick.",
    tags: ["drum kit", "modal", "noise bank", "accent"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Tom", "", "", "", "", ""],
    [pattern("Kit", ["X..x..x...X..x..", "....X.......X..x", "........x.....xx", ""])]) });
  const kick = p.add("perc-voice", [1, 0], { engine: "Modal", pitch: 52, tone: 0.08, morph: 0.2, click: 0.35, decay: 0.55, damp: 0.3, sweep: 0.65, level: 0.9, drive: "Warm" }, { name: "Kick" });
  const snare = p.add("perc-voice", [1, 1], { engine: "Noise Bank", pitch: 210, tone: 0.3, morph: 0.85, click: 0.5, decay: 0.28, damp: 0.5, sweep: 0.25, level: 0.7 }, { name: "Snare" });
  const tom = p.add("perc-voice", [1, 2], { engine: "Modal", pitch: 130, tone: 0.3, morph: 0.4, click: 0.2, decay: 0.45, damp: 0.5, sweep: 0.4, level: 0.75 }, { name: "Tom" });
  const hatg = p.add("drum-grid", [0, 2], {}, { data: drumGrid(["Hat", "", "", "", "", "", "", ""], [pattern("Hat", ["x.xxx.xxx.xxx.xx", "", "", ""])]), name: "Hat Grid" });
  const hat = p.add("perc-voice", [1, 3], { engine: "Noise Bank", pitch: 800, tone: 1, morph: 0.9, click: 0.2, decay: 0.07, damp: 0.7, sweep: 0.0, level: 0.5 }, { name: "Hat" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "accent").cable(grid, "gate2", snare, "trig").cable(grid, "velocity2", snare, "accent")
    .cable(grid, "gate3", tom, "trig").cable(grid, "velocity3", tom, "accent").cable(hatg, "gate1", hat, "trig").cable(hatg, "velocity1", hat, "accent");
  finish(p, [2, 0], [{ n: kick, level: -2 }, { n: snare, level: -4, pan: 0.1 }, { n: tom, level: -4, pan: -0.3 }, { n: hat, level: -10, pan: 0.3 }], { vmix: 0.15, size: 0.3, decay: 1.2, master: -5 });
  return p;
}

function fmToms() {
  const p = patch("Perc Voice: FM Tom Melody", {
    module: "perc-voice", tempo: 108,
    description: "In the FM engine the partials modulate one sine carrier, so Morph is the modulation index: bright on the attack, purer in the tail. A sequencer's Pitch tunes the hits, which makes a melody of toms. Raise Morph for metal, lower Decay for wood blocks, or switch Track on to let the pitch follow during the ring.",
    tags: ["fm", "tom", "melodic", "pitch input"],
  });
  const s = seq(p, [0, 0], [0, 3, 7, 3, 10, 7, 12, 7, 0, 5, 8, 5, 12, 8, 15, 12], { rate: "1/8", root: "C", scale: "Natural Minor", octave: -1, gate: 0.4, vel: [120, 70, 90, 70] });
  const v = p.add("perc-voice", [1, 0], { engine: "FM", pitch: 130, tone: 0.28, morph: 0.45, click: 0.15, decay: 0.38, damp: 0.5, sweep: 0.3, spread: 0.4, level: 0.8 });
  p.cable(s, "trigger", v, "trig").cable(s, "pitch", v, "pitch").cable(s, "velocity", v, "accent");
  const b = p.add("perc-voice", [1, 1], { engine: "FM", pitch: 48, tone: 0.0, morph: 0.2, click: 0.3, decay: 0.5, sweep: 0.6, level: 0.9 }, { name: "Kick" });
  const g = p.add("drum-grid", [0, 1], {}, { data: drumGrid(["Kick", "", "", "", "", "", "", ""], [pattern("Pulse", ["X.......X.x.....", "", "", ""])]) });
  p.cable(g, "gate1", b, "trig").cable(g, "velocity1", b, "accent");
  finish(p, [2, 0], [{ n: v, level: -4, pan: -0.2 }, { n: b, level: -3 }], { vmix: 0.25, master: 1 });
  return p;
}

function glassBells() {
  const p = patch("Perc Voice: Glass Bells", {
    module: "perc-voice", tempo: 66,
    description: "The Modal engine with Tone at 85 % and Morph high lets the upper partials of a metallic set ring out like struck glass, with long Decay and low Damp. A slow sequence hits the bell, and a second, lower bell answers on the off-beat. Change Seed to get a different bell, or Tone to walk from bell to bar to drum.",
    tags: ["bell", "glass", "modal", "ambient"],
  });
  const s = seq(p, [0, 0], [0, ".", ".", 7, ".", ".", 12, ".", 9, ".", ".", ".", 5, ".", ".", "."], { rate: "1/4", root: "D", scale: "Dorian", octave: 0, gate: 0.4, vel: [110, 90, 100] });
  const v = p.add("perc-voice", [1, 0], { engine: "Modal", pitch: 587, tone: 0.85, morph: 0.85, click: 0.12, decay: 3.5, damp: 0.15, sweep: 0.0, spread: 0.6, level: 0.8, seed: 3 }, { name: "High Bell" });
  const v2 = p.add("perc-voice", [1, 1], { engine: "Modal", pitch: 293, tone: 0.75, morph: 0.7, click: 0.1, decay: 5, damp: 0.2, sweep: 0.0, spread: 0.5, level: 0.75, seed: 8 }, { name: "Low Bell" });
  const s2 = seq(p, [0, 1], [".", ".", 0, ".", ".", ".", ".", 5], { rate: "1/4", root: "D", scale: "Dorian", octave: -1, gate: 0.4, name: "Answer" });
  p.cable(s, "trigger", v, "trig").cable(s, "pitch", v, "pitch").cable(s, "velocity", v, "accent")
    .cable(s2, "trigger", v2, "trig").cable(s2, "pitch", v2, "pitch").cable(s2, "velocity", v2, "accent");
  finish(p, [2, 0], [{ n: v, level: -4, pan: -0.35 }, { n: v2, level: -4, pan: 0.35 }], { vmix: 0.45, size: 0.85, decay: 7, master: 6 });
  return p;
}

function metalHats() {
  const p = patch("Perc Voice: Hats and Gong", {
    module: "perc-voice", tempo: 120,
    description: "Noise Bank at Tone 100 % is metal: a short one is a closed hat, a long one an open hat, and the closed hat's trigger is patched into the open hat's Choke so it cuts the ring off. A third voice with a very long Decay is a gong that swells in once per phrase. Try Damp, Morph and Pitch on the hats.",
    tags: ["hi-hat", "choke", "gong", "noise bank"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Closed", "Open", "Gong", "Kick", "", "", "", ""],
    [pattern("Hats", ["x.xxx.xxx.xxx.x.", "..x...x...x...x.", "X...............", "X...x...x...x..."])]) });
  const closed = p.add("perc-voice", [1, 0], { engine: "Noise Bank", pitch: 700, tone: 1, morph: 0.9, click: 0.25, decay: 0.06, damp: 0.7, sweep: 0.0, level: 0.55, seed: 4 }, { name: "Closed Hat" });
  const open = p.add("perc-voice", [1, 1], { engine: "Noise Bank", pitch: 700, tone: 1, morph: 0.9, click: 0.15, decay: 0.5, damp: 0.6, sweep: 0.0, level: 0.5, seed: 4 }, { name: "Open Hat" });
  const gong = p.add("perc-voice", [1, 2], { engine: "Noise Bank", pitch: 160, tone: 1, morph: 0.35, click: 0.05, decay: 6, damp: 0.25, sweep: 0.15, spread: 0.8, level: 0.5, seed: 11 }, { name: "Gong" });
  const kick = p.add("perc-voice", [1, 3], { engine: "FM", pitch: 50, tone: 0, morph: 0.15, click: 0.3, decay: 0.45, sweep: 0.65, level: 0.9 }, { name: "Kick" });
  p.cable(grid, "gate1", closed, "trig").cable(grid, "velocity1", closed, "accent").cable(grid, "gate1", open, "choke")
    .cable(grid, "gate2", open, "trig").cable(grid, "velocity2", open, "accent").cable(grid, "gate3", gong, "trig").cable(grid, "gate4", kick, "trig");
  finish(p, [2, 0], [{ n: closed, level: -10, pan: 0.3 }, { n: open, level: -10, pan: -0.25 }, { n: gong, level: -8 }, { n: kick, level: -2 }], { vmix: 0.25, size: 0.6, decay: 3 });
  return p;
}

function steelPan() {
  const p = patch("Perc Voice: Steel Pan", {
    module: "perc-voice", tempo: 104,
    description: "Noise Bank with a narrow Morph rings its band-pass filters almost pitched, the sound of a steel drum or a tuned block. A sequencer plays the pitch and each hit gets a small Spread of stereo width. Raise Morph towards 100 % for a noisier shaker, or change Damp to shorten the shimmer.",
    tags: ["steel drum", "noise bank", "melody", "tuned"],
  });
  const s = seq(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2, 0, 4, 7, 12, 9, 7, 4, 7], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, gate: 0.4, vel: [115, 80, 95, 75] });
  const v = p.add("perc-voice", [1, 0], { engine: "Noise Bank", pitch: 262, tone: 0.2, morph: 0.12, click: 0.3, decay: 0.7, damp: 0.5, sweep: 0.1, spread: 0.55, level: 0.8 });
  p.cable(s, "trigger", v, "trig").cable(s, "pitch", v, "pitch").cable(s, "velocity", v, "accent");
  const bass = seq(p, [0, 1], [0, ".", ".", ".", 0, ".", 7, "."], { rate: "1/4", root: "C", scale: "Major Pentatonic", octave: -2, name: "Bass" });
  const b = p.add("perc-voice", [1, 1], { engine: "Modal", pitch: 65, tone: 0.1, morph: 0.2, click: 0.25, decay: 0.7, damp: 0.4, sweep: 0.2, level: 0.8 }, { name: "Bass Drum" });
  p.cable(bass, "trigger", b, "trig").cable(bass, "pitch", b, "pitch");
  finish(p, [2, 0], [{ n: v, level: -4 }, { n: b, level: -3 }], { vmix: 0.2, master: 2 });
  return p;
}

export default [modalKit, fmToms, glassBells, metalHats, steelPan];
