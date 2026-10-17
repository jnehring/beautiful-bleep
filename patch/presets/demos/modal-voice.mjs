// SPDX-License-Identifier: MIT
// Modal Voice: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: o.rate || "1/8", root: o.root || "A",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.5 }, { data: steps(notes, o.vel), name: o.name || "Notes" });
}
/// Trim mixer (stereo) → Verb → Out 1/2.
function room(p, at, src, o = {}) {
  const m = p.add("audio-mixer", [at[0] - 1, at[1]], { level1: o.trim ?? 0, pan1: -1, level2: o.trim ?? 0, pan2: 1, master: 0 }, { name: "Level" });
  p.cable(src, (o.from || ["l", "r"])[0], m, "in1l").cable(src, (o.from || ["l", "r"])[1], m, "in2r");
  const v = p.add("reverb", at, { size: 0.6, decay: 3, damping: 0.45, mix: o.mix ?? 0.25, quality: "Eco (8 lines)", ...o.v });
  p.stereo(m, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

function marimba() {
  const p = patch("Modal Voice: Wooden Bars", {
    module: "modal-voice", tempo: 112,
    description: "A mallet strikes a bar-shaped body on every step of a looping pentatonic pattern. Geometry sits at 50 % (a bar), Damping and Strike Timbre keep it woody. Try Geometry towards 0 for a string, towards 100 % for a bell, or Position at 50 % to cancel the even partials.",
    tags: ["marimba", "mallet", "strike", "bar"],
  });
  const s = seq(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 7, 5, 9, 12, 14, 12, 9, 7, 4], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, gate: 0.4, vel: [110, 80, 95, 85] });
  const v = p.add("modal-voice", [1, 0], { strike: 0.8, strikeTimbre: 0.4, geometry: 0.5, brightness: 0.55, damping: 0.42, position: 0.22, size: 0.45, space: 0.25 });
  p.cable(s, "pitch", v, "pitch").cable(s, "trigger", v, "strike").cable(s, "velocity", v, "velocity");
  room(p, [3, 0], v, { trim: -2, mix: 0.2 });
  return p;
}

function bowedBell() {
  const p = patch("Modal Voice: Bowed Bells", {
    module: "modal-voice", tempo: 56,
    description: "No mallet at all: a Bow sings a bell-shaped body for as long as each gate is held. Contour at a low value gives a slow swell and long release, so the chords of the sequence bloom into each other. Lower Bow Timbre for a light, airy bow, or raise Damping to hear the bell become wood.",
    tags: ["bow", "bell", "drone", "swell"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", ".", 5, "_", "_", "_", "_", "_", "_", ".", 3, "_", "_", "_", "_", "_", "_", ".", 7, "_", "_", "_", "_", "_", "_", "."], { rate: "1/4", root: "D", scale: "Natural Minor", octave: -1, gate: 1 });
  const v = p.add("modal-voice", [1, 0], { strike: 0, bow: 0.65, bowTimbre: 0.35, contour: 0.12, geometry: 0.9, brightness: 0.5, damping: 0.3, size: 0.8, space: 0.6 });
  const v2 = p.add("modal-voice", [1, 1], { strike: 0, bow: 0.55, bowTimbre: 0.3, contour: 0.15, geometry: 0.9, brightness: 0.45, damping: 0.3, size: 0.8, space: 0.6, coarse: 7 }, { name: "Fifth" });
  p.cable(s, "pitch", v, "pitch").cable(s, "gate", v, "gate").cable(s, "pitch", v2, "pitch").cable(s, "gate", v2, "gate");
  const mix = p.add("audio-mixer", [2, 0], { level1: 0, pan1: -0.6, level2: -5, pan2: 0.6, master: 0 }, { name: "Mix" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in1r").cable(v2, "l", mix, "in2l").cable(v2, "r", mix, "in2r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.35, trim: 0, v: { size: 0.85, decay: 7 } });
  return p;
}

function windFlute() {
  const p = patch("Modal Voice: Breath Flute", {
    module: "modal-voice", tempo: 84,
    description: "A string-like body (Geometry 0 %) is excited only by Blow with a high Blow Timbre: above 60 % the breath couples with the body like an air jet and it sings on its own, with a little breath noise on top. Move Blow Timbre across 60 % to hear the voice appear, or add Strike for a tongued start.",
    tags: ["flute", "breath", "blow", "melody"],
  });
  const s = seq(p, [0, 0], [0, "_", 4, 7, "_", "_", 9, 7, 4, "_", 2, "_", 0, "_", "_", "."], { rate: "1/8", root: "D", scale: "Major Pentatonic", octave: 0, gate: 0.9 });
  const v = p.add("modal-voice", [1, 0], { strike: 0, blow: 0.7, blowTimbre: 0.78, contour: 0.45, geometry: 0, brightness: 0.6, damping: 0.5, position: 0.3, size: 0.5, space: 0.35 });
  const vib = p.add("lfo", [1, 1], { rate: 5, fade: 1.2 }, { name: "Breath Vibrato" });
  p.cable(s, "pitch", v, "pitch").cable(s, "gate", v, "gate").cable(vib, "out", v, "fine", 0.07);
  room(p, [3, 0], v, { trim: -9, mix: 0.3 });
  return p;
}

function plateResonator() {
  const p = patch("Modal Voice: Plate Resonator", {
    module: "modal-voice", tempo: 100,
    description: "Audio from a drum beat goes into Ext In with every built-in exciter at 0, so the module is a resonator in a room: the drums ring a tuned plate. Change Coarse to retune the plate, Geometry to move from string to plate to bell, Damping for how long it keeps ringing.",
    tags: ["resonator", "external input", "plate", "drums"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -6 });
  const v = p.add("modal-voice", [3, 0], { strike: 0, bow: 0, blow: 0, extLevel: 0.9, coarse: -5, geometry: 0.75, brightness: 0.55, damping: 0.5, position: 0.3, size: 0.55, space: 0.4 });
  p.cable(d, "outl", v, "ext");
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -1, pan2: -0.5, level3: -1, pan3: 0.5, master: 0 }, { name: "Mix" });
  p.cable(d, "outl", mix, "in1l").cable(d, "outr", mix, "in1r").cable(v, "l", mix, "in2l").cable(v, "r", mix, "in3r");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function stiffString() {
  const p = patch("Modal Voice: Plucked Strings", {
    module: "modal-voice", tempo: 96,
    description: "A hard, bright strike on a stiff string (Geometry 25 %) is a plucked-string sound, played as a broken chord in an open room. Position sets where the string is plucked and Strike Timbre how hard the pick is. Lengthen Damping for a harp, or shorten it for a muted pluck.",
    tags: ["pluck", "string", "arpeggio", "guitar"],
  });
  const s = seq(p, [0, 0], [0, 7, 12, 16, 12, 7, 0, 7, -5, 2, 7, 11, 7, 2, -5, 2], { rate: "1/8", root: "E", scale: "Major", octave: -1, gate: 0.4, vel: [120, 85, 95, 80] });
  const v = p.add("modal-voice", [1, 0], { strike: 0.9, strikeTimbre: 0.75, geometry: 0.22, brightness: 0.6, damping: 0.4, position: 0.18, size: 0.5, space: 0.3 });
  p.cable(s, "pitch", v, "pitch").cable(s, "trigger", v, "strike").cable(s, "velocity", v, "velocity");
  room(p, [3, 0], v, { trim: -8, mix: 0.22 });
  return p;
}

export default [marimba, bowedBell, windFlute, plateResonator, stiffString];
