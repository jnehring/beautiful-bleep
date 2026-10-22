// SPDX-License-Identifier: MIT
// LFO: five demo patches. Each plays by itself with the transport.
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

function vibrato() {
  const p = patch("LFO: Vibrato and Tremolo", {
    module: "lfo", tempo: 80,
    description: "One slow LFO gently bends the pitch of a held lead and a second one swells its volume; Fade lets the vibrato arrive only after the note has settled. Raise the vibrato Rate or the cable amounts, or move Fade to zero.",
    tags: ["vibrato", "tremolo", "fade", "pitch"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "G", scale: "Major Pentatonic", octave: 0, gatelength: 1 },
    { data: steps([0, "_", 4, 7, "_", 9, 7, 4]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.55 }, { name: "Lead" });
  const env = p.add("adsr", [1, 1], { attack: 0.06, decay: 0.3, sustain: 0.8, release: 0.5 }, { name: "Amp Env" });
  const amp = p.add("vca", [2, 0], {});
  const vib = p.add("lfo", [0, 2], { rate: 5.2, wave: "Sine", fade: 2.5 }, { name: "Vibrato" });
  const trem = p.add("lfo", [1, 2], { rate: 0.6, wave: "Triangle", polarity: "Unipolar" }, { name: "Tremolo" });
  const f = p.add("filter", [3, 0], { cutoff: 2500, resonance: 0.1 }, { name: "Filter" });
  p.cable(seq, "pitch", osc, "pitch").cable(vib, "out", osc, "pitch", 0.04).cable(seq, "gate", env, "gate").cable(osc, "out", amp, "l")
    .cable(env, "env", amp, "gain", 0.7).cable(trem, "out", amp, "gain", 0.3)
    .cable(amp, "l", f, "l").cable(amp, "l", f, "r");
  finish(p, [4, 0], f, { stereo: true, trim: 0, verb: { size: 0.55, decay: 3, mix: 0.3 } });
  return p;
}

function wobbleBass() {
  const p = patch("LFO: Synced Wobble", {
    module: "lfo", tempo: 100,
    description: "A triangle LFO locked to eighth notes sweeps the low-pass filter of a bass line, a classic wobble that stays in time with the drums. Change Rate for a slower or faster wobble, switch Wave from Triangle to Square, or raise Resonance.",
    tags: ["sync", "wobble", "bass", "filter"],
  });
  const v = voice(p, [0, 0], [0, "_", "_", "_", 0, "_", 3, "_", 5, "_", "_", "_", 7, "_", 5, 3], { rate: "1/8", shape: 0.95, root: "E", scale: "Natural Minor", octave: -2, gatelength: 0.95,
    env: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.1 }, filter: { cutoff: 300, resonance: 0.35 } });
  const l = p.add("lfo", [3, 1], { wave: "Triangle", sync: "Tempo", division: "1/8", polarity: "Unipolar" }, { name: "Wobble" });
  p.cable(l, "out", v.filt, "cutoff", 0.55);
  const drums = beat(p, [0, 4], { style: "half", level: -6 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -12, level2: -10, master: 0 });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function randomStep() {
  const p = patch("LFO: Random Steps", {
    module: "lfo", tempo: 112,
    description: "The LFO's Random Step wave picks a new level every sixteenth and sends it to the filter, so a repeating line is coloured differently on each step, always the same way. Switch Wave to Random Smooth for a gliding version.",
    tags: ["random", "stepped", "seed", "sample and hold"],
  });
  const v = voice(p, [0, 0], [0, 0, 7, 0, 12, 0, 7, 10, 0, 0, 7, 0, 12, 7, 5, 3], { rate: "1/16", shape: 0.9, root: "A", octave: -1, env: { decay: 0.15, sustain: 0.3 }, filter: { cutoff: 400, resonance: 0.4 } });
  const l = p.add("lfo", [3, 1], { wave: "Random Step", sync: "Tempo", division: "1/16", polarity: "Unipolar" }, { name: "Random" });
  p.cable(l, "out", v.filt, "cutoff", 0.6);
  finish(p, [4, 0], v.filt, { stereo: true, trim: -5, verb: { mix: 0.2, size: 0.4, decay: 1.8 } });
  return p;
}

function autoPan() {
  const p = patch("LFO: Auto Pan", {
    module: "lfo", tempo: 90,
    description: "Two LFOs, half a cycle apart through Phase, raise and lower the left and right volume of a pad in opposite directions, so it travels across the stereo field. Change Rate, or set both Phase values the same to hear it collapse to a plain tremolo.",
    tags: ["auto pan", "phase", "stereo", "pad"],
  });
  const pd = pad(p, [0, 0], [0, 4, 7, 4, 0, 5, 9, 5], { rate: "1/2", root: "C", scale: "Major Pentatonic", gain: 1, filter: { cutoff: 2200 } });
  const a = p.add("lfo", [2, 2], { rate: 0.25, wave: "Sine", polarity: "Unipolar", phase: 0 }, { name: "Left" });
  const b = p.add("lfo", [3, 2], { rate: 0.25, wave: "Sine", polarity: "Unipolar", phase: 180 }, { name: "Right" });
  const vl = p.add("vca", [5, 0], { gain: 0 }, { name: "Pan L" });
  const vr = p.add("vca", [5, 1], { gain: 0 }, { name: "Pan R" });
  p.cable(pd.filt, "l", vl, "l").cable(pd.filt, "r", vr, "l").cable(a, "out", vl, "gain", 1).cable(b, "out", vr, "gain", 1);
  const t = p.add("audio-mixer", [6, 0], { level1: -9, level2: -9, pan1: -1, pan2: 1, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", [7, 0], { size: 0.6, decay: 3.5, mix: 0.3, quality: "Eco (8 lines)" });
  p.cable(vl, "l", t, "in1l").cable(vr, "l", t, "in2r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function trance() {
  const p = patch("LFO: Gate Chopper", {
    module: "lfo", tempo: 124,
    description: "A square LFO locked to sixteenths chops a held pad into a rhythmic gate, and its rising edge also triggers the hi-hat on every pulse. Move Width to make the chops shorter or longer, or change Rate for another pattern.",
    tags: ["gate", "square", "pulse width", "cycle trigger"],
  });
  const pd = pad(p, [0, 0], [0, 3, 7, 5], { rate: "1/1", root: "D", scale: "Natural Minor", octave: 0, shape: 0.8, gain: 0, filter: { cutoff: 2600 } });
  const l = p.add("lfo", [2, 2], { wave: "Square", sync: "Tempo", division: "1/16", polarity: "Unipolar", pw: 0.35 }, { name: "Chopper" });
  const hats = p.add("punch-hats", [3, 2], { level: 0.45 });
  const kick = p.add("punch-kick", [3, 3], { level: 0.7 });
  const kl = p.add("lfo", [2, 3], { wave: "Square", sync: "Tempo", division: "1/4", polarity: "Unipolar", pw: 0.1 }, { name: "Kick" });
  p.cable(l, "out", pd.amp, "gain", 0.9).cable(l, "out", hats, "closed").cable(kl, "out", kick, "trig");
  const mix = p.add("audio-mixer", [5, 0], { level1: -4, level2: -9, level3: -8, master: 0 });
  const v = p.add("reverb", [6, 0], { size: 0.4, decay: 1.8, mix: 0.15, quality: "Eco (8 lines)" });
  p.stereo(pd.filt, mix, { to: ["in1l", "in1r"] }).cable(hats, "out", mix, "in2l").cable(hats, "out", mix, "in2r")
    .cable(kick, "out", mix, "in3l").cable(kick, "out", mix, "in3r").stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [vibrato, wobbleBass, randomStep, autoPan, trance];
