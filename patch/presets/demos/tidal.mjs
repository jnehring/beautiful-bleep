// SPDX-License-Identifier: MIT
// Tidal: five demo patches. Each plays by itself with the transport.
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

function slowTide() {
  const p = patch("Tidal: Slow Tide", {
    module: "tidal", tempo: 80,
    description: "On the Slow range the Tidal loops over many seconds and its four outputs trail one another through Phase: the filter opens, the resonance swells and the tone shape drifts, in turn. Move Skew to make the tide rise slowly and fall fast, or switch Relation to Ratio.",
    tags: ["loop", "slow", "phase", "evolving"],
  });
  const v = voice(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/8", shape: 0.6, root: "E", scale: "Natural Minor", env: { decay: 0.4, sustain: 0.3 }, filter: { cutoff: 600, resonance: 0.15, drive: 0 } });
  const t = p.add("tidal", [3, 1], { freq: 0.4, skew: 0.35, curve: 0.2, spread: 0.5, mode: "Loop", range: "Slow", relation: "Phase" });
  p.cable(t, "a", v.filt, "cutoff", 0.5).cable(t, "b", v.filt, "resonance", 0.15).cable(t, "c", v.osc, "shape", 0.4);
  finish(p, [4, 0], v.filt, { stereo: true, trim: 3, verb: { size: 0.6, decay: 3.5, mix: 0.3 } });
  return p;
}

function audioRate() {
  const p = patch("Tidal: Audio-Rate Voice", {
    module: "tidal", tempo: 98,
    description: "With Range on Audio and the sequencer's pitch patched in, the Tidal becomes an oscillator: A is the main tone while B, C and D add related shapes. Skew, Curve and Smooth change the waveform, Spread changes how the other outputs differ.",
    tags: ["audio range", "oscillator", "pitch", "waveform"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -1, gatelength: 0.5 },
    { data: steps([0, ".", 3, 0, ".", 7, 5, ".", 0, ".", 10, 7, ".", 5, 3, 0]) });
  const t = p.add("tidal", [1, 0], { freq: 1, skew: 0.3, curve: 0.4, smooth: 0.2, spread: 0.3, mode: "Loop", range: "Audio", relation: "Harmonic" });
  const env = p.add("adsr", [2, 2], { attack: 0.004, decay: 0.3, sustain: 0.4, release: 0.2 }, { name: "Amp Env" });
  const amp = p.add("vca", [3, 0], {});
  const f = p.add("filter", [4, 0], { cutoff: 1800, resonance: 0.2 }, { name: "Filter" });
  p.cable(seq, "pitch", t, "pitch").cable(t, "a", amp, "l").cable(t, "b", amp, "r").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain")
    .stereo(amp, f).cable(env, "env", f, "cutoff", 0.25);
  finish(p, [5, 0], f, { stereo: true, trim: -1 });
  return p;
}

function groove() {
  const p = patch("Tidal: Synced Groove", {
    module: "tidal", tempo: 116,
    description: "Sync locks the looping Tidal to the beat, so its slopes pulse a bass line in time: A makes the volume duck and bounce, B opens the filter on the off-beats. Change Sync or Skew to move the bounce, or Polarity to flip it.",
    tags: ["sync", "groove", "bass", "tremolo"],
  });
  const v = voice(p, [0, 0], [0, "_", 0, ".", 7, "_", 5, ".", 0, "_", 0, ".", 10, 7, 5, 3], { rate: "1/8", shape: 0.95, root: "F", scale: "Natural Minor", octave: -2, gatelength: 0.9, env: { attack: 0.01, decay: 0.2, sustain: 0.9 }, filter: { cutoff: 500, resonance: 0.35 } });
  const t = p.add("tidal", [3, 1], { freq: 1, skew: 0.2, curve: 0.3, spread: 0.4, mode: "Loop", range: "Medium", sync: "1/8", polarity: "Unipolar" });
  const duck = p.add("vca", [4, 0], { gain: 0 }, { name: "Bounce" });
  p.stereo(v.filt, duck).cable(t, "b", v.filt, "cutoff", 0.4).cable(t, "a", duck, "gain", 0.8);
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  const mix = p.add("audio-mixer", [5, 0], { level1: -4, level2: -9, master: 0 });
  const verb = p.add("reverb", [6, 0], { size: 0.4, decay: 1.8, mix: 0.12, quality: "Eco (8 lines)" });
  p.stereo(duck, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function decays() {
  const p = patch("Tidal: Triggered Decays", {
    module: "tidal", tempo: 102,
    description: "In AD mode each sequencer gate fires one quick rise-and-fall: A shapes the volume of a bright pluck, while B, with Spread, opens the filter for a vowel-like wah on every note. Increase Frequency to shorten the whole shape or Skew to move its peak.",
    tags: ["ad", "envelope", "trigger", "pluck"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "C", scale: "Dorian", octave: 0, gatelength: 0.3 },
    { data: steps([0, 7, ".", 10, 12, ".", 7, 3, 0, ".", 5, 7, ".", 10, 7, ".",]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.9 }, { name: "Source" });
  const t = p.add("tidal", [1, 1], { freq: 3, skew: 0.1, curve: -0.3, spread: 0.5, mode: "AD", range: "Medium", polarity: "Unipolar" });
  const amp = p.add("vca", [2, 0], {});
  const f = p.add("filter", [3, 0], { cutoff: 300, resonance: 0.4 }, { name: "Filter" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", t, "trig").cable(osc, "out", amp, "l").cable(t, "a", amp, "gain")
    .cable(amp, "l", f, "l").cable(amp, "l", f, "r").cable(t, "b", f, "cutoff", 0.5);
  finish(p, [4, 0], f, { stereo: true, trim: -5 });
  return p;
}

function splash() {
  const p = patch("Tidal: Swell and Splash", {
    module: "tidal", tempo: 88,
    description: "In AR mode a held gate makes the Tidal rise, and when it finishes falling its End output fires a snare: a pad swells in, fades, and the drum answers. Change Frequency to stretch the swell, or Skew to move where it peaks.",
    tags: ["ar", "gate", "end trigger", "pad"],
  });
  const pd = pad(p, [0, 0], [0, 3, 5, 3], { rate: "1/1", root: "D", scale: "Natural Minor", gain: 0, filter: { cutoff: 1600 }, gate: 0.6 });
  const t = p.add("tidal", [2, 2], { freq: 0.5, skew: 0.5, curve: 0.2, mode: "AR", range: "Medium", polarity: "Unipolar" });
  const sn = p.add("punch-snare", [3, 2], { level: 0.7 });
  p.cable(pd.seq, "gate", t, "trig").cable(t, "a", pd.amp, "gain", 0.8).cable(t, "end", sn, "trig");
  const mix = p.add("audio-mixer", [5, 0], { level1: -3, level2: -9, master: 0 });
  const verb = p.add("reverb", [6, 0], { size: 0.65, decay: 4, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(pd.filt, mix, { to: ["in1l", "in1r"] }).cable(sn, "out", mix, "in2l").cable(sn, "out", mix, "in2r")
    .stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [slowTide, audioRate, groove, decays, splash];
