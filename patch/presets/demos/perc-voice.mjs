// SPDX-License-Identifier: MIT
// Perc Voice: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";

const NAMES = ["Kick", "Snare", "Hat", "Open", "Perc", "Tom", "Tom 2", "Bell"];

function grid(p, at, rows) {
  return p.add("drum-grid", at, {}, { data: drumGrid(NAMES, [pattern("Beat", rows)]) });
}

// Perc Voice L/R -> a mixer channel pair; returns the mixer. `chans`: [[voice, pan, dB], ...] (up to four).
function mixer(p, at, chans, master = -3) {
  const vals = { master };
  chans.forEach(([, pan, db], i) => { vals[`level${i + 1}`] = db; vals[`pan${i + 1}`] = pan; });
  const m = p.add("audio-mixer", at, vals, { name: "Perc Mix" });
  chans.forEach(([v], i) => p.cable(v, "l", m, `in${i + 1}l`).cable(v, "r", m, `in${i + 1}r`));
  p.stereo(m, p.out, { from: ["outl", "outr"] });
  return m;
}

function fmKit() {
  const p = patch("Perc Voice: FM Kit", {
    module: "perc-voice", tempo: 112,
    description: "Three Perc Voices make a whole kit: an FM kick with a long Sweep, a snappy mid voice with plenty of Click, and a hat from the Noise Bank engine. Change a voice's Tone or Decay to move between boom, tom and metal.",
    tags: ["kit", "fm", "kick", "drums"],
  });
  const g = grid(p, [0, 0], ["X...x..x..X.x...", "....X.......X..x", "x.xxx.xxx.xxx.x.", ""]);
  const kick = p.add("perc-voice", [2, 0], { pitch: 48, tone: 0.1, morph: 0.4, click: 0.35, decay: 0.45, damp: 0.3, sweep: 0.7, level: 0.9, engine: "FM", drive: "Warm" }, { name: "Kick" });
  const snare = p.add("perc-voice", [2, 1], { pitch: 190, tone: 0.55, morph: 0.6, click: 0.8, decay: 0.22, damp: 0.6, sweep: 0.3, spread: 0.4, level: 0.6, engine: "FM" }, { name: "Snap" });
  const hat = p.add("perc-voice", [2, 2], { pitch: 3500, tone: 0.9, morph: 0.7, click: 0.4, decay: 0.07, damp: 0.7, sweep: 0, spread: 0.5, level: 0.4, engine: "Noise Bank" }, { name: "Hat" });
  p.cable(g, "gate1", kick, "trig").cable(g, "velocity1", kick, "accent").cable(g, "gate2", snare, "trig").cable(g, "velocity2", snare, "accent")
    .cable(g, "gate3", hat, "trig").cable(g, "velocity3", hat, "accent");
  mixer(p, [3, 0], [[kick, 0, -3], [snare, -0.2, -6], [hat, 0.35, -12]], -2);
  return p;
}

function tomMelody() {
  const p = patch("Perc Voice: Tuned Toms", {
    module: "perc-voice", tempo: 96,
    description: "With Track on, the sequencer's pitch tunes the Modal engine, so a membrane voice plays a melodic line like a set of tuned toms. Decay and Damp set how much the notes ring into each other; Sweep gives each hit its dive.",
    tags: ["toms", "melodic", "modal", "tracking"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "D", scale: "Minor Pentatonic", octave: -1, gatelength: 0.2 },
    { data: steps([0, ".", 7, 0, ".", 5, ".", 3, 0, ".", 7, ".", 10, 7, ".", 5]) });
  const v = p.add("perc-voice", [2, 0], { pitch: 146, tone: 0.3, morph: 0.5, click: 0.25, decay: 0.7, damp: 0.35, sweep: 0.35, spread: 0.3, level: 0.9, engine: "Modal", track: true });
  const lfo = p.add("lfo", [1, 1], { rate: 0.06, wave: "Triangle", polarity: "Unipolar" }, { name: "Tone Drift" });
  p.cable(seq, "pitch", v, "pitch").cable(seq, "trigger", v, "trig").cable(seq, "velocity", v, "accent").cable(lfo, "out", v, "tone", 0.25);
  mixer(p, [3, 0], [[v, 0, 0]], -3);
  return p;
}

function metalBells() {
  const p = patch("Perc Voice: Metal Bells", {
    module: "perc-voice", tempo: 70,
    description: "Tone near the top of its range and the FM engine turn the voice into a long, inharmonic bell; a slow sparse line plays it, with a second quieter bell an octave higher. Try Morph and Spread for different bell colours.",
    tags: ["bell", "metal", "fm", "sparse"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "F", scale: "Lydian", octave: 0, gatelength: 0.2 },
    { data: steps([0, ".", 7, ".", 4, ".", ".", 11]) });
  const v1 = p.add("perc-voice", [2, 0], { pitch: 349, tone: 0.9, morph: 0.55, click: 0.15, decay: 3.5, damp: 0.15, sweep: 0.05, spread: 0.7, level: 0.7, engine: "FM", track: true }, { name: "Bell" });
  const v2 = p.add("perc-voice", [2, 1], { pitch: 700, tone: 0.85, morph: 0.3, click: 0.1, decay: 2, damp: 0.2, sweep: 0, spread: 0.9, level: 0.4, engine: "FM", track: true }, { name: "High Bell" });
  p.cable(seq, "pitch", v1, "pitch").cable(seq, "trigger", v1, "trig").cable(seq, "velocity", v1, "accent")
    .cable(seq, "pitch", v2, "pitch").cable(seq, "trigger", v2, "trig");
  mixer(p, [3, 0], [[v1, -0.3, -2], [v2, 0.4, -9]], -2);
  return p;
}

function shakerBank() {
  const p = patch("Perc Voice: Noise Bank Shakers", {
    module: "perc-voice", tempo: 124,
    description: "Two Noise Bank voices play off-beat shakers and a rim-like tick, with random accents so no two bars are alike. Pitch sets the colour of the bank, Decay the length of the shake, and Damp how fast the highs die.",
    tags: ["shaker", "noise bank", "groove", "accents"],
  });
  const g = grid(p, [0, 0], ["x.xxx.xxx.x.xxx.", ".x..x..x..x..x..", "", ""]);
  const shk = p.add("perc-voice", [2, 0], { pitch: 2400, tone: 0.8, morph: 0.4, click: 0.2, decay: 0.12, damp: 0.5, sweep: 0, spread: 0.8, level: 0.7, engine: "Noise Bank" }, { name: "Shaker" });
  const tick = p.add("perc-voice", [2, 1], { pitch: 900, tone: 0.6, morph: 0.7, click: 0.6, decay: 0.09, damp: 0.7, sweep: 0.1, spread: 0.3, level: 0.6, engine: "Noise Bank" }, { name: "Tick" });
  const thump = p.add("perc-voice", [2, 2], { pitch: 55, tone: 0.1, morph: 0.4, click: 0.3, decay: 0.35, damp: 0.4, sweep: 0.5, level: 0.8, engine: "Modal" }, { name: "Thump" });
  const acc = p.add("random", [1, 1], { sync: "1/16", spread: 1, seed: 21 }, { name: "Accents" });
  const kg = grid(p, [0, 2], ["X.......X.......", "", "", ""]);
  p.cable(g, "gate1", shk, "trig").cable(acc, "out", shk, "accent").cable(g, "gate2", tick, "trig").cable(kg, "gate1", thump, "trig");
  mixer(p, [3, 0], [[shk, -0.4, 0], [tick, 0.4, -2], [thump, 0, -2]], 0);
  return p;
}

function toneSweep() {
  const p = patch("Perc Voice: Tone Sweep", {
    module: "perc-voice", tempo: 90,
    description: "One voice plays the same rhythm while a slow LFO walks Tone from pure sine through membrane and bar to metal, then back: a single hit becomes a kick, a tom, a wood block and a clang over time. Switch Engine to hear the same sweep three ways.",
    tags: ["tone", "morph", "evolving", "single voice"],
  });
  const g = grid(p, [0, 0], ["X..x..x...X..x..", "", "", ""]);
  const v = p.add("perc-voice", [2, 0], { pitch: 110, tone: 0.5, morph: 0.5, click: 0.35, decay: 0.55, damp: 0.35, sweep: 0.35, spread: 0.4, level: 0.9, engine: "Modal" });
  const tone = p.add("lfo", [1, 1], { rate: 0.055, wave: "Triangle", polarity: "Unipolar" }, { name: "Tone Walk" });
  const mor = p.add("lfo", [2, 1], { rate: 0.13, wave: "Triangle", polarity: "Unipolar" }, { name: "Morph Walk" });
  p.cable(g, "gate1", v, "trig").cable(g, "velocity1", v, "accent").cable(tone, "out", v, "tone", 0.9).cable(mor, "out", v, "morph", 0.5);
  mixer(p, [3, 0], [[v, 0, 0]], 0);
  return p;
}

export default [fmKit, tomMelody, metalBells, shakerBank, toneSweep];
