// SPDX-License-Identifier: MIT
// Six Slopes: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono/stereo source (`src`, jacks l/r) → trim → reverb → Out.
function finish(p, at, src, o = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: o.trim ?? 0, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...(o.verb || {}) });
  const [jl, jr] = o.jacks || ["l", "r"];
  p.cable(src, jl, t, "in1l").cable(src, o.stereo ? jr : jl, t, "in1r");
  p.stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

/// Plucked melody into a Multi Filter (returns the filter, stereo out).
function voice(p, at, notes, o = {}) {
  const m = melody(p, at, notes, o);
  const f = p.add("filter", [at[0] + 3, at[1]], { cutoff: 1200, resonance: 0.25, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r");
  return { ...m, filt: f };
}

/// Two detuned oscillators (left / right) held by a sequencer → VCA (gain left to the caller) → Multi Filter.
function pad(p, at, notes, o = {}) {
  const [c, r] = at;
  const seq = p.add("step-sequencer", [c, r], { length: notes.length, rate: o.rate || "1/2", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? -1, gatelength: o.gate ?? 0.95 }, { data: steps(notes) });
  const o1 = p.add("oscillator", [c + 1, r], { shape: o.shape ?? 0.5, fine: -9 }, { name: "Osc L" });
  const o2 = p.add("oscillator", [c + 1, r + 1], { shape: o.shape ?? 0.5, fine: 9 }, { name: "Osc R" });
  const amp = p.add("vca", [c + 2, r], { gain: o.gain ?? 1 }, { name: "VCA" });
  const f = p.add("filter", [c + 3, r], { cutoff: 1400, resonance: 0.2, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", amp, "l").cable(o2, "out", amp, "r")
    .stereo(amp, f);
  return { seq, o1, o2, amp, filt: f };
}

/// Six oscillators → six VCAs → two small mixers → a master mixer. Each tone is [semitones, octave]. Gains come from the caller.
function sixVoices(p, at, tones, o = {}) {
  const [c, r] = at;
  const vcas = [], oscs = [];
  const mixA = p.add("audio-mixer", [c + 2, r], { level1: o.lvl ?? -10, level2: o.lvl ?? -10, level3: o.lvl ?? -10, pan1: -0.7, pan2: 0, pan3: 0.7, master: 0 }, { name: "Mix 1-3" });
  const mixB = p.add("audio-mixer", [c + 2, r + 3], { level1: o.lvl ?? -10, level2: o.lvl ?? -10, level3: o.lvl ?? -10, pan1: 0.5, pan2: -0.4, pan3: 0.2, master: 0 }, { name: "Mix 4-6" });
  tones.forEach((t, i) => {
    const osc = p.add("oscillator", [c, r + i], { shape: o.shape ?? 0, coarse: t[0], octave: t[1] }, { name: `Tone ${i + 1}` });
    const vca = p.add("vca", [c + 1, r + i], {}, { name: `Slope ${i + 1}` });
    p.cable(osc, "out", vca, "l");
    if (o.pitch) p.cable(o.pitch, "pitch", osc, "pitch");
    const m = i < 3 ? mixA : mixB, k = (i % 3) + 1;
    p.cable(vca, "l", m, `in${k}l`).cable(vca, "l", m, `in${k}r`);
    vcas.push(vca); oscs.push(osc);
  });
  const master = p.add("audio-mixer", [c + 3, r], { level1: 0, level2: 0, master: o.master ?? 0 }, { name: "Master" });
  p.stereo(mixA, master, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(mixB, master, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { vcas, oscs, master };
}

function loopingHarmonics() {
  const p = patch("Six Slopes: Looping Chord", {
    module: "six-slopes", tempo: 90,
    description: "In Loop mode six slopes breathe at related rates, and each one swells a different note of a chord, so the harmony slowly rearranges itself. Move Harmonics to change how far apart the rates are and Skew to shift each swell between rise and fall.",
    tags: ["loop", "harmonics", "chord", "drone"],
  });
  const s = p.add("six-slopes", [0, 0], { rate: 0.35, harmonics: 0.55, skew: 0.5, curve: 0.2, mode: "Loop" });
  const v = sixVoices(p, [1, 0], [[0, "-1"], [7, "-1"], [4, "0"], [11, "0"], [2, "+1"], [7, "0"]], { master: -4 });
  for (let i = 0; i < 6; i++) p.cable(s, `out${i + 1}`, v.vcas[i], "gain", 1);
  finish(p, [5, 0], v.master, { jacks: ["outl", "outr"], stereo: true, trim: 2, verb: { size: 0.6, decay: 4, mix: 0.35 } });
  return p;
}

function harmonicBell() {
  const p = patch("Six Slopes: Harmonic Bell", {
    module: "six-slopes", tempo: 78,
    description: "One trigger starts all six slopes in AR mode; with Harmonics up, the higher slopes die away faster, so each note sparkles then settles into its lower partials. Move Harmonics down for a darker, longer ring or change Rate to stretch the whole decay.",
    tags: ["ar", "triggered", "bell", "partials"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "D", scale: "Major Pentatonic", octave: 0, gatelength: 0.2 },
    { data: steps([0, 4, 7, ".", 9, 7, 4, "."]) });
  const s = p.add("six-slopes", [1, 0], { rate: 1.6, harmonics: 0.5, skew: 0.02, curve: -0.3, mode: "AR" });
  const v = sixVoices(p, [2, 0], [[0, "0"], [0, "+1"], [7, "+1"], [4, "+2"], [0, "+2"], [7, "+2"]], { pitch: seq, master: -2, lvl: -14 });
  for (let i = 0; i < 6; i++) p.cable(seq, "gate", s, `trig${i + 1}`).cable(s, `out${i + 1}`, v.vcas[i], "gain", 1);
  finish(p, [6, 0], v.master, { jacks: ["outl", "outr"], stereo: true, trim: 0, verb: { size: 0.65, decay: 4.5, mix: 0.35 } });
  return p;
}

function soundMode() {
  const p = patch("Six Slopes: Sound Mode Voice", {
    module: "six-slopes", tempo: 100,
    description: "In Sound mode the slopes run at audio rate and follow the sequencer's pitch, so the Six Slopes is the oscillator itself; the Sum output is a rich, buzzy tone. Try Snap on Integer or Just for harmonic spacing, or Curve and Skew for different timbres.",
    tags: ["sound mode", "audio rate", "oscillator", "pitch"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -1, gatelength: 0.55 },
    { data: steps([0, ".", 0, 7, ".", 3, 5, ".", 0, ".", 10, 7, ".", 5, 3, 0]) });
  const s = p.add("six-slopes", [1, 0], { rate: 110, harmonics: 0.3, skew: 0.5, curve: 0.3, level: 0.35, tilt: -0.2, mode: "Sound", snap: "Integer", polarity: "Bipolar" });
  const env = p.add("adsr", [2, 1], { attack: 0.004, decay: 0.3, sustain: 0.35, release: 0.2 }, { name: "Amp Env" });
  const amp = p.add("vca", [2, 0], {});
  const f = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.2 }, { name: "Filter" });
  p.cable(seq, "pitch", s, "pitch").cable(seq, "gate", s, "trig1").cable(s, "sum", amp, "l").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(env, "env", amp, "gain").cable(amp, "l", f, "l").cable(amp, "l", f, "r").cable(env, "env", f, "cutoff", 0.3);
  finish(p, [4, 0], f, { stereo: true, trim: 6 });
  return p;
}

function lockedMotion() {
  const p = patch("Six Slopes: Locked Motion", {
    module: "six-slopes", tempo: 118,
    description: "Sync ties the Loop mode to the tempo and Snap on Integer keeps every rate an exact multiple, so six slopes move filter, tone, pulse and volume in polyrhythm that never drifts. Change Sync or Harmonics and listen to the grooves reshuffle.",
    tags: ["sync", "snap", "polyrhythm", "groove"],
  });
  const v = voice(p, [0, 0], [0, 0, 7, 0, 10, 0, 7, 5, 0, 0, 7, 0, 12, 10, 7, 5], { rate: "1/16", shape: 0.9, root: "G", octave: -1, env: { decay: 0.18, sustain: 0.4 }, filter: { cutoff: 600, resonance: 0.4 } });
  const s = p.add("six-slopes", [3, 1], { rate: 1, harmonics: 0.4, skew: 0.5, curve: 0, mode: "Loop", sync: "1/2", snap: "Integer" });
  p.cable(s, "out1", v.filt, "cutoff", 0.5).cable(s, "out2", v.osc, "shape", 0.3).cable(s, "out3", v.filt, "resonance", 0.35);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -8, level2: -12, master: 0 });
  const verb = p.add("reverb", [5, 0], { size: 0.4, decay: 1.8, mix: 0.15, quality: "Eco (8 lines)" });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function unfolding() {
  const p = patch("Six Slopes: Chord Unfolds", {
    module: "six-slopes", tempo: 72,
    description: "In ASR mode each of six slopes rises while a gate is held and falls when it ends; with Harmonics below zero the lower notes of the chord arrive first and the top ones drift in last. Change Harmonics, Rate or the sequencer's gate length to alter the unfolding.",
    tags: ["asr", "gate", "chord", "undertone"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "A", scale: "Natural Minor", octave: 0, gatelength: 0.8 },
    { data: steps([0, 5, 3, 7]) });
  const s = p.add("six-slopes", [1, 0], { rate: 0.7, harmonics: -0.6, skew: 0.5, curve: 0.2, mode: "ASR" });
  const v = sixVoices(p, [2, 0], [[0, "-1"], [7, "-1"], [0, "0"], [3, "0"], [7, "0"], [10, "0"]], { pitch: seq, master: -13 });
  for (let i = 0; i < 6; i++) p.cable(seq, "gate", s, `trig${i + 1}`).cable(s, `out${i + 1}`, v.vcas[i], "gain", 1);
  finish(p, [6, 0], v.master, { jacks: ["outl", "outr"], stereo: true, trim: 0, verb: { size: 0.7, decay: 5, mix: 0.4 } });
  return p;
}

export default [loopingHarmonics, harmonicBell, soundMode, lockedMotion, unfolding];
