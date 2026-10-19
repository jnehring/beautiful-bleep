// SPDX-License-Identifier: GPL-3.0-or-later
// Pitch Snap: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A deliberately sloppy mono line: Step Sequencer -> Oscillator (pitch also wobbled by a slow Random and a vibrato LFO) -> VCA.
/// o: wander (random amount), vib (vibrato amount), vibRate (Hz), shape, rate, root, scale, octave, env, osc.
function sloppy(p, at, notes, o = {}) {
  const [c, r] = at;
  const m = melody(p, at, notes, { rate: o.rate || "1/4", root: o.root || "A", scale: o.scale || "Chromatic", octave: o.octave ?? 0,
    shape: o.shape ?? 0.85, gatelength: o.gatelength ?? 0.95, osc: o.osc, env: o.env || { attack: 0.02, decay: 0.2, sustain: 0.85, release: 0.12 } });
  if (o.wander !== 0) {
    const w = p.add("random", [c, r + 2], { rate: o.wanderRate ?? 0.7, spread: 1, smooth: 0.9, seed: o.seed ?? 11 }, { name: "Drunk Detune" });
    p.cable(w, "out", m.osc, "pitch", o.wander ?? 0.03);
  }
  if (o.vib) {
    const v = p.add("lfo", [c + 1, r + 2], { rate: o.vibRate ?? 5.5, wave: "Sine" }, { name: "Vibrato" });
    p.cable(v, "out", m.osc, "pitch", o.vib);
  }
  return m;
}
const snap = (p, at, src, vals = {}, name = "Pitch Snap") => {
  const s = p.add("pitch-snap", at, vals, { name });
  p.cable(src.amp, "l", s, "in");
  return s;
};
/// Mono sources -> panned Audio Mixer -> Verb -> Out. chans: [{n, j, level, pan}]
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? 0 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.j || "out", mix, `in${i + 1}l`);
    p.cable(c.n, c.j || "out", mix, `in${i + 1}r`);
    if (c.also) p.cable(c.also, c.alsoJ || "l", mix, `in${i + 1}l`).cable(c.also, c.alsoJ || "l", mix, `in${i + 1}r`);
  });
  const v = p.add("reverb", [at[0] + 1, at[1]], { size: 0.55, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return mix;
}

function hardTune() {
  const p = patch("Pitch Snap: Hard Retune", {
    module: "pitch-snap", tempo: 100,
    description: "A wobbly saw line with notes that do not belong to the key goes into a Pitch Snap set to hard correction in A minor pentatonic: every note jumps onto the scale with the stepped, robotic sound of a hard retune. Set Amount to 0 to hear the raw out-of-tune line, then bring it back up, or lower Speed for a softer glide.",
    tags: ["hard tune", "retune", "scale", "robotic"],
  });
  const m = sloppy(p, [0, 0], [0, 2, 3, 5, 7, 8, 10, 7, 5, 3, 2, 0, 3, 7, 10, "."], { rate: "1/8", wander: 0.03, vib: 0.008, gatelength: 0.8, octave: 0 });
  const s = snap(p, [3, 0], m, { amount: 1, speed: 1, drift: 0, root: "A", scale: "Minor Pentatonic", formant: true, low: 120, tracking: "Steady" });
  const d = beat(p, [0, 4], { style: "half", level: -10 });
  const mix = finish(p, [4, 0], [{ n: s, level: -4, pan: 0 }], { master: 3, vmix: 0.2 });
  p.stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return p;
}

function driftVibrato() {
  const p = patch("Pitch Snap: Drift Keeps the Vibrato", {
    module: "pitch-snap", tempo: 72,
    description: "A slow line with a 5.5 Hz vibrato and a drunken detune is pulled onto C major by a Pitch Snap with Drift at 100 %, so the average pitch is corrected while the vibrato stays alive. Set Drift to 0 and the vibrato is flattened into a steady tone; try a lower Drift Time for a quicker grip.",
    tags: ["drift", "vibrato", "natural", "voice"],
  });
  const m = sloppy(p, [0, 0], [0, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_", 4, "_", "_", "_", 9, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 2, "_", "_", "_"],
    { rate: "1/4", wander: 0.025, wanderRate: 0.5, vib: 0.02, vibRate: 5.5, shape: 0.6, root: "C", octave: 0, gatelength: 1,
      env: { attack: 0.06, decay: 0.2, sustain: 0.9, release: 0.3 } });
  const s = snap(p, [3, 0], m, { amount: 1, speed: 0.55, drift: 1, drifttime: 0.35, low: 120, root: "C", scale: "Major", tracking: "Steady" });
  const bass = melody(p, [0, 5], [0, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/2", root: "C", scale: "Major", octave: -2, shape: 0.1, gatelength: 0.95, env: { attack: 0.05, decay: 0.3, sustain: 0.8, release: 0.4 } });
  finish(p, [4, 0], [{ n: s, level: -3, pan: -0.15 }, { n: bass.amp, j: "l", level: -12, pan: 0.2 }], { master: -5, vmix: 0.3, decay: 3.5 });
  return p;
}

function harmonyVoices() {
  const p = patch("Pitch Snap: Three-Voice Harmony", {
    module: "pitch-snap", tempo: 92,
    description: "One sloppy lead feeds three Pitch Snaps in parallel: the lead itself, one a fifth above (+7 Offset) and one an octave below (-12), each tuned to C major pentatonic and panned apart. Change an Offset to +4 for a major third or +12 for a bright octave double.",
    tags: ["harmony", "offset", "voices", "stereo"],
  });
  const m = sloppy(p, [0, 0], [0, 2, 4, 7, 9, 7, 4, 2, 0, 4, 7, 9, 12, 9, 7, "."], { rate: "1/8", root: "C", wander: 0.025, vib: 0.01, shape: 0.8, gatelength: 0.85, octave: 0 });
  const base = { low: 200, high: 700, amount: 1, speed: 0.9, drift: 0, root: "C", scale: "Major Pentatonic", tracking: "Steady" };
  const lead = snap(p, [3, 0], m, { ...base, offset: 0 }, "Lead");
  const up = snap(p, [3, 2], m, { ...base, offset: 7 }, "Fifth Up");
  const low = snap(p, [3, 4], m, { ...base, offset: -12 }, "Octave Down");
  const d = beat(p, [0, 6], { style: "four", level: -12 });
  const mix = finish(p, [4, 0], [{ n: lead, level: -5, pan: 0 }, { n: up, level: -9, pan: 0.6 }, { n: low, level: -7, pan: -0.6 }], { master: 0, vmix: 0.25 });
  p.stereo(d, mix, { from: ["outl", "outr"], to: ["in4l", "in4r"] });
  return p;
}

function playAlong() {
  const p = patch("Pitch Snap: Bass Plays Along", {
    module: "pitch-snap", tempo: 84,
    description: "A Harmony Master runs an i-VI-III-VII progression on Bus A; a drunken lead is snapped to the chord tones and the Target output drives a bass oscillator, so the bass always plays the exact note the lead is corrected to. Change the Target setting to Chord + Scale to let passing notes through, or the Harmony Master's key to move everything.",
    tags: ["target", "harmony bus", "chord tones", "bass"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "A", scale: "Natural Minor", advance: "Transport", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-triad", len: 4 }, { deg: 6, q: "diatonic-triad", len: 4 }, { deg: 3, q: "diatonic-triad", len: 4 }, { deg: 7, q: "diatonic-triad", len: 4 }] } });
  const m = sloppy(p, [0, 2], [0, 4, 7, 12, 9, 7, 3, 5, 7, 12, 14, 12, 9, 7, 3, 0], { rate: "1/8", root: "A", wander: 0.03, vib: 0.01, shape: 0.75, octave: 0, gatelength: 0.9 });
  const s = snap(p, [3, 2], m, { amount: 1, speed: 0.8, drift: 0, source: "Bus A", target: "Chord", tracking: "Steady" });
  const bass = p.add("oscillator", [4, 5], { shape: 0.2, octave: "-2" }, { name: "Bass" });
  const bamp = p.add("vca", [5, 5], { gain: 0.6 }, { name: "Bass Level" });
  p.cable(s, "target", bass, "pitch").cable(bass, "out", bamp, "l");
  const pad = [1, 2, 3].map((i) => {
    const o = p.add("oscillator", [1, 8 + i], { shape: 0.4, octave: "-1", fine: (i - 2) * 6 }, { name: `Pad ${i}` });
    p.cable(hm, `tone${i}`, o, "pitch");
    return o;
  });
  const padVca = p.add("vca", [2, 9], { gain: 0.3 }, { name: "Pad Level" });
  pad.forEach((o) => p.cable(o, "out", padVca, "l"));
  const flt = p.add("filter", [3, 9], { cutoff: 1100, resonance: 0.1 });
  p.cable(padVca, "l", flt, "l");
  finish(p, [6, 0], [{ n: s, level: -5, pan: 0.2 }, { n: bamp, j: "l", level: -7, pan: -0.1 }, { n: flt, j: "l", level: -10, pan: -0.3 }], { master: 3, vmix: 0.3, decay: 3.5 });
  return p;
}

function steppedOffset() {
  const p = patch("Pitch Snap: Stepped Offset with Formant", {
    module: "pitch-snap", tempo: 88,
    description: "A formant oscillator sings a steady line while a slow sequencer feeds the Offset jack, transposing the corrected voice in steps of 0, +5, +7 and +3 semitones with its vowel kept in place by Formant Preserve. Switch Formant off and the vowel slides with the pitch like a plain pitch shifter.",
    tags: ["offset", "formant", "transpose", "cv"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "D", scale: "Dorian", octave: 0, gatelength: 0.97 }, { data: steps([0, "_", 3, "_", 5, "_", 3, "_", 7, "_", 5, "_", 3, "_", 2, "_"]) }, { name: "Melody" });
  const fo = p.add("formant-osc", [1, 0], { formant: 0, narrow: 0.4, body: 0.5 }, { name: "Vowel Voice" });
  const env = p.add("adsr", [1, 1], { attack: 0.03, decay: 0.2, sustain: 0.9, release: 0.15 }, { name: "Amp Env" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  const w = p.add("random", [0, 3], { rate: 0.6, spread: 1, smooth: 0.9, seed: 5 }, { name: "Drunk Detune" });
  p.cable(seq, "pitch", fo, "pitch").cable(w, "out", fo, "pitch", 0.025).cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(fo, "outL", amp, "l").cable(env, "env", amp, "gain");
  const off = p.add("step-sequencer", [0, 5], { length: 8, rate: "1/2", root: "C", scale: "Chromatic", octave: 0, gatelength: 1 }, { data: steps([0, "_", "_", "_", 5, "_", 7, "_", "_", "_", 3, "_", "_", "_", 0, "_"].slice(0, 8)) }, { name: "Offset Steps" });
  const s = p.add("pitch-snap", [3, 0], { amount: 1, speed: 0.9, root: "D", scale: "Dorian", formant: true, low: 70, high: 900, tracking: "Steady" }, { name: "Transposer" });
  p.cable(amp, "l", s, "in").cable(off, "pitch", s, "pitchoffset");
  const d = beat(p, [0, 8], { style: "sparse", level: -12 });
  const mix = finish(p, [4, 0], [{ n: s, level: -4, pan: 0.1 }, { n: amp, j: "l", level: -14, pan: -0.5 }], { master: -2, vmix: 0.28 });
  p.stereo(d, mix, { from: ["outl", "outr"], to: ["in4l", "in4r"] });
  return p;
}

export default [hardTune, driftVibrato, harmonyVoices, playAlong, steppedOffset];
