// SPDX-License-Identifier: MIT
// Modal Voice: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// A sequencer driving pitch, gate and trigger of a Modal Voice; returns { seq, mv }.
function played(p, notes, seqOpts, mvOpts, seqAt = [0, 0], mvAt = [2, 0]) {
  const seq = p.add("step-sequencer", seqAt, { length: Math.min(32, notes.length), ...seqOpts }, { data: steps(notes) });
  const mv = p.add("modal-voice", mvAt, mvOpts);
  p.cable(seq, "pitch", mv, "pitch").cable(seq, "gate", mv, "gate").cable(seq, "trigger", mv, "strike");
  return { seq, mv };
}

// Modal Voice L/R -> a mixer (gain in dB) -> Out 1/2.
function toOut(p, mv, db) {
  const m = p.add("audio-mixer", [3, 0], { level1: db, pan1: -0.8, level2: db, pan2: 0.8 }, { name: "Output" });
  p.cable(mv, "l", m, "in1l").cable(mv, "r", m, "in2l").stereo(m, p.out, { from: ["outl", "outr"] });
}

function malletMarimba() {
  const p = patch("Modal Voice: Mallet Bars", {
    module: "modal-voice", tempo: 108,
    description: "Mallet strikes on a wooden bar: a quick pentatonic phrase played by the Strike input, with Geometry at the bar setting and a short, damped ring. Strike Timbre changes the mallet from soft to hard, Position moves where on the bar it lands.",
    tags: ["mallet", "marimba", "strike", "melodic"],
  });
  const { mv } = played(p, [0, 7, 4, 12, 7, 9, 4, 7, 0, 5, 9, 12, 9, 7, 4, 2], { rate: "1/16", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.3 },
    { strike: 0.9, strikeTimbre: 0.35, contour: 0.2, geometry: 0.3, brightness: 0.5, damping: 0.6, position: 0.3, size: 0.45, space: 0.25 });
  toOut(p, mv, -4);
  return p;
}

function bowedDrone() {
  const p = patch("Modal Voice: Bowed Strings", {
    module: "modal-voice", tempo: 60,
    description: "Long held gates with Bow turned up make the string sing continuously, with a slow rise of bow pressure from a Triangle LFO. Lower Bow Timbre for a softer scrape, or raise Damping to shorten the sustain.",
    tags: ["bow", "drone", "string", "sustained"],
  });
  const { mv } = played(p, [0, "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_", 5], { rate: "1/4", root: "D", scale: "Natural Minor", octave: -1, gatelength: 1 },
    { bow: 0.7, bowTimbre: 0.5, strike: 0, contour: 0.5, geometry: 0.15, brightness: 0.5, damping: 0.3, position: 0.35, size: 0.6, space: 0.5 });
  const lfo = p.add("lfo", [1, 1], { rate: 0.09, wave: "Triangle" }, { name: "Bow Pressure" });
  p.cable(lfo, "out", mv, "bowTimbre", 0.25);
  toOut(p, mv, -12);
  return p;
}

function breathFlute() {
  const p = patch("Modal Voice: Breath Tube", {
    module: "modal-voice", tempo: 76,
    description: "Blow, not bow or strike: breath noise excites a tube-like body and a slow melody speaks out of it with a soft, airy attack. Blow Timbre sets the colour of the air, Geometry the shape of the body.",
    tags: ["breath", "wind", "airy", "melody"],
  });
  const { mv } = played(p, [0, "_", 4, "_", 7, "_", "_", 5, "_", 4, "_", "_", 2, "_", "_", "_"], { rate: "1/8", root: "A", scale: "Major Pentatonic", octave: 0, gatelength: 0.9 },
    { bow: 0, blow: 0.8, blowTimbre: 0.45, strike: 0, contour: 0.4, geometry: 0.55, brightness: 0.6, damping: 0.35, position: 0.4, size: 0.5, space: 0.45 });
  const lfo = p.add("lfo", [1, 1], { rate: 4.5, wave: "Sine", fade: 3 }, { name: "Vibrato" });
  p.cable(lfo, "out", mv, "fine", 0.04);
  toOut(p, mv, 5);
  return p;
}

function plateGroove() {
  const p = patch("Modal Voice: Metal Plate Groove", {
    module: "modal-voice", tempo: 118,
    description: "Hits on a big metal plate in a rhythmic pattern, with slow LFOs morphing Geometry between string, plate and bell and sweeping Brightness. Try Size, Damping and Space for a tighter or a more cavernous plate.",
    tags: ["plate", "rhythm", "geometry", "metallic"],
  });
  const { mv } = played(p, [0, ".", 0, ".", 7, ".", 0, 3, 0, ".", ".", 0, 10, ".", 7, "."], { rate: "1/16", root: "E", scale: "Phrygian", octave: -1, gatelength: 0.2 },
    { strike: 0.85, strikeTimbre: 0.6, contour: 0.25, geometry: 0.6, brightness: 0.6, damping: 0.5, position: 0.4, size: 0.7, space: 0.35 });
  const g = p.add("lfo", [1, 1], { rate: 0.1, wave: "Triangle", polarity: "Unipolar" }, { name: "Geometry LFO" });
  const b = p.add("lfo", [1, 2], { rate: 0.17 }, { name: "Brightness LFO" });
  p.cable(g, "out", mv, "geometry", 0.5).cable(b, "out", mv, "brightness", 0.25);
  toOut(p, mv, -12);
  return p;
}

function resonantDrums() {
  const p = patch("Modal Voice: Drums Through a Body", {
    module: "modal-voice", tempo: 96,
    description: "A drum beat enters the Ext input and excites the modal body, so the kit rings like it is played on a tuned bell with a bass line from the sequencer's pitch. Ext Level is the amount of beat in the body; Coarse retunes the whole thing.",
    tags: ["external", "drums", "exciter", "hybrid"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -6 });
  const seq = p.add("step-sequencer", [3, 1], { length: 4, rate: "1/2", root: "A", scale: "Minor Pentatonic", octave: -1, gatelength: 1 },
    { data: steps([0, 3, 5, 7]) });
  const mv = p.add("modal-voice", [3, 0], { strike: 0, extLevel: 1, contour: 0.4, geometry: 0.35, brightness: 0.5, damping: 0.5, position: 0.3, size: 0.5, space: 0.3 });
  const o = p.add("audio-mixer", [4, 0], { level1: 6, level2: 6, level3: -8 }, { name: "Output" });
  p.cable(mix, "outl", mv, "ext").cable(seq, "pitch", mv, "pitch").cable(seq, "gate", mv, "gate")
    .cable(mv, "l", o, "in1l").cable(mv, "r", o, "in2l").cable(mix, "outl", o, "in3l").stereo(o, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [malletMarimba, bowedDrone, breathFlute, plateGroove, resonantDrums];
