// SPDX-License-Identifier: GPL-3.0-only
// Tuner: five demo patches. Each plays by itself with the transport.
// The Tuner has no audio output, so every patch also sends the sound it listens to (and what it triggers) to Out 1/2.
import { patch } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

// A mixer to Out 1/2: channels are [node, jack, dB, pan] (mono sources).
function toOut(p, at, chans, master = 0) {
  const v = { master };
  chans.forEach(([, , db, pan], i) => { v["level" + (i + 1)] = db; v["pan" + (i + 1)] = pan ?? 0; });
  const g = p.add("audio-mixer", at, v, { name: "Out Mix" });
  chans.forEach(([n, j], i) => p.cable(n, j, g, "in" + (i + 1) + "l"));
  p.stereo(g, p.out, { from: ["outl", "outr"] });
  return g;
}
const verb = (p, at, src, o = {}, jacks = ["l", "r"]) => {
  const v = p.add("reverb", at, { size: 0.6, decay: 4, damping: 0.5, mix: 0.4, quality: "Eco (8 lines)", ...o });
  p.stereo(src, v, { from: jacks });
  return v;
};

function tuningGame() {
  const p = patch("Tuner: Tuning Game", {
    module: "tuner", tempo: 80,
    description: "A pure tone drifts slowly sharp and flat of a note; each time it slides through the In Tune window the Tuner's gate strikes a soft bell, so you can hear the moment it is right. Widen In Tune for more bells per sweep, or narrow it to catch only the exact centre.",
    tags: ["tuning", "gate", "bell", "drift"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.13, wave: "Triangle" });
  const osc = p.add("oscillator", [1, 0], { shape: 0, octave: "-1", coarse: -3, fine: 0 }, { name: "Drifting Tone" });
  const t = p.add("tuner", [2, 0], { tolerance: 8, damping: 0.05 });
  const bell = p.add("perc-voice", [3, 0], { pitch: 880, tone: 0.9, engine: "Modal", decay: 3, click: 0.1, level: 0.7 }, { name: "Bell" });
  const vb = verb(p, [4, 0], bell, { size: 0.8, decay: 5, mix: 0.4 });
  p.cable(lfo, "out", osc, "pitch", 0.03).cable(osc, "out", t, "in").cable(t, "intune", bell, "trig");
  toOut(p, [5, 0], [[osc, "out", -14, -0.2], [vb, "l", -8, -0.4], [vb, "r", -8, 0.4]], 0);
  return p;
}

function detuneMod() {
  const p = patch("Tuner: Detune Pan", {
    module: "tuner", tempo: 90,
    description: "Two saw voices a fifth apart share a pad; the upper one wanders in pitch and the Tuner's Cents output pans it and opens a filter, so how sharp or flat it is becomes the movement. Try a wider Damping for lazier motion, or invert the cable amounts.",
    tags: ["cents", "modulation", "pan", "filter"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.18, wave: "Sine" });
  const a = p.add("oscillator", [1, 0], { shape: 0.4, octave: "-1", coarse: -5 }, { name: "Root" });
  const b = p.add("oscillator", [1, 1], { shape: 0.4, octave: "-1", coarse: 2 }, { name: "Wanderer" });
  const t = p.add("tuner", [2, 1], { tolerance: 6, damping: 0.1 });
  const flt = p.add("filter", [3, 0], { cutoff: 600, resonance: 0.35, type: "SVF Multimode", mode: "LP" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -8, pan1: -0.6 }, { name: "Pad Mix" });
  p.cable(lfo, "out", b, "pitch", 0.035).cable(b, "out", t, "in")
    .cable(a, "out", mix, "in1l").cable(b, "out", mix, "in2l")
    .stereo(mix, flt, { from: ["outl", "outr"] })
    .cable(t, "cents", mix, "pan2", 0.9).cable(t, "cents", flt, "cutoff", 0.35);
  const v = verb(p, [4, 0], flt, { size: 0.7, decay: 3.5, mix: 0.3 });
  toOut(p, [5, 0], [[v, "l", -4, -0.5], [v, "r", -4, 0.5]], 0);
  return p;
}

function driftChime() {
  const p = patch("Tuner: Drift Chime", {
    module: "tuner", tempo: 66,
    description: "A drone pair floats in pitch, and whenever one voice passes through tune the Tuner strikes a mallet voice that plays the note it is hearing, a fifth up, into a long reverb. Change Reference A to shift where the chime lands, or raise In Tune for a busier shimmer.",
    tags: ["drone", "chime", "pitch cv", "ambient"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.09, wave: "Triangle" });
  const a = p.add("oscillator", [1, 0], { shape: 0.2, octave: "-1", coarse: -5, fine: -4 }, { name: "Drone A" });
  const b = p.add("oscillator", [1, 1], { shape: 0.2, octave: "-1", coarse: -5, fine: 5 }, { name: "Drone B" });
  const t = p.add("tuner", [2, 1], { tolerance: 7, damping: 0.08, low: 60 });
  const mal = p.add("modal-voice", [3, 1], { strike: 1, strikeTimbre: 0.5, geometry: 0.3, brightness: 0.6, damping: 0.4, position: 0.3, size: 0.4, space: 0.25, coarse: 19 }, { name: "Chime" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -9, level2: -9, pan1: -0.4, pan2: 0.4 }, { name: "Drone Mix" });
  p.cable(lfo, "out", b, "pitch", 0.03).cable(b, "out", t, "in")
    .cable(a, "out", mix, "in1l").cable(b, "out", mix, "in2l")
    .cable(t, "pitch", mal, "pitch").cable(t, "intune", mal, "strike");
  const v = verb(p, [4, 0], mal, { size: 0.85, decay: 7, mix: 0.45 });
  toOut(p, [5, 0], [[mix, "outl", 0, 0], [mix, "outr", 0, 0], [v, "l", -4, -0.5], [v, "r", -4, 0.5]], 0);
  return p;
}

function gatedOctave() {
  const p = patch("Tuner: Gated Octave", {
    module: "tuner", tempo: 100,
    description: "A pluck line slowly slips out of tune and back; the Tuner follows its pitch and re-pitches a second voice an octave up, which only sounds while the line is in tune. Make In Tune smaller for shorter, rarer answers, or shorten Damping for a quicker tracker.",
    tags: ["pitch tracker", "gate", "octave", "melody"],
  });
  const lfo = p.add("lfo", [0, 3], { rate: 0.11, wave: "Sine" });
  const m = melody(p, [0, 0], [0, ".", 3, 7, ".", 5, 3, ".", 0, ".", 7, 10, ".", 7, 5, 3],
    { rate: "1/8", shape: 0.3, root: "D", octave: 0, scale: "Natural Minor", gatelength: 0.7, env: { decay: 0.35, sustain: 0.5, release: 0.15 } });
  const t = p.add("tuner", [3, 0], { tolerance: 10, damping: 0.03, low: 80 });
  const up = p.add("oscillator", [4, 0], { shape: 0.1, octave: "+1" }, { name: "Octave Up" });
  const env = p.add("adsr", [4, 1], { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.3 }, { name: "Gate Env" });
  const amp = p.add("vca", [5, 0], {}, { name: "Gated VCA" });
  p.cable(lfo, "out", m.osc, "pitch", 0.03).cable(m.amp, "l", t, "in")
    .cable(t, "pitch", up, "pitch").cable(t, "intune", env, "gate")
    .cable(up, "out", amp, "l").cable(env, "env", amp, "gain");
  const v = verb(p, [6, 0], amp, { size: 0.5, decay: 2.5, mix: 0.25 }, ["l", "l"]);
  toOut(p, [7, 0], [[m.amp, "l", -4, -0.3], [v, "l", -9, 0.4], [v, "r", -9, 0.5]], 0);
  return p;
}

function baroquePitch() {
  const p = patch("Tuner: Baroque Pitch", {
    module: "tuner", tempo: 96,
    description: "A melody is played a semitone low, and the Tuner's Reference A is set to 415 so it reads each note as exactly in tune, ticking a hi-hat on every sure note. Move Reference A away from 415 and the ticks stop; at 440 the whole line reads flat.",
    tags: ["reference pitch", "415", "hi-hat", "melody"],
  });
  const m = melody(p, [0, 0], [0, ".", 3, ".", 7, ".", 5, 3, 2, ".", 3, 5, 7, ".", 0, "."],
    { rate: "1/8", shape: 0.5, root: "A", octave: 0, scale: "Natural Minor", gatelength: 0.8,
      osc: { coarse: -1, fine: -2.3 }, env: { decay: 0.4, sustain: 0.6, release: 0.2 } });
  const t = p.add("tuner", [3, 0], { reference: 415, tolerance: 8, damping: 0.03, names: "Flats" });
  const hat = p.add("punch-hats", [4, 0], { closed: 0.04, level: 0.55 });
  const v = verb(p, [4, 1], m.amp, { size: 0.5, decay: 2.5, mix: 0.25 }, ["l", "l"]);
  p.cable(m.amp, "l", t, "in").cable(t, "intune", hat, "closed");
  toOut(p, [5, 0], [[m.amp, "l", -4, -0.2], [hat, "out", -8, 0.3], [v, "r", -10, 0.5]], 0);
  return p;
}

export default [tuningGame, detuneMod, driftChime, gatedOctave, baroquePitch];
