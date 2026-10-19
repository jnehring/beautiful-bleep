// scope: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

/// A small band: melody + drums on a mixer. Returns {mix, flt, drums, m}.
function band(p, at, o = {}) {
  const m = melody(p, [at[0], at[1]], o.notes || [0, ".", 3, 5, 7, ".", 5, 3, 10, ".", 7, 5, 3, ".", 0, "."], {
    rate: "1/8", root: o.root || "E", scale: "Minor Pentatonic", octave: o.octave ?? 0, shape: o.shape ?? 0.8, gatelength: 0.5,
    env: { decay: 0.25, sustain: 0.1, release: 0.2 },
  });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: o.cutoff ?? 2400, resonance: 0.25 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  const drums = beat(p, [at[0], at[1] + 3], { style: o.style || "half", level: -8 });
  const mix = p.add("audio-mixer", [at[0] + 4, at[1]], { level1: o.lead ?? 2, level2: o.drum ?? 0, master: o.master ?? 0 }, { name: "Band" });
  p.cable(flt, "l", mix, "in1l").cable(flt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { mix, flt, drums, m };
}
/// A one-lane gate pattern (notes: 0 = hit, "_" = tie, "." = rest).
const gateSeq = (p, at, pat, rate, name, o = {}) => p.add("step-sequencer", at, { length: pat.length, rate, root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: o.gatelength ?? 0.9 }, { data: steps(pat) }, { name });
function plainWave() {
  const p = patch("Scope: A Wave Standing Still", {
    module: "scope", tempo: 100,
    description: "A saw lead passes through the Scope, which holds each wave still on the screen; the Frequency and Amplitude readouts follow the notes. Turn Time / Div up to see more cycles or down to see one, and change the Edge to Falling to flip the picture.",
    tags: ["waveform", "trigger", "time base", "oscilloscope"],
  });
  const b = band(p, [0, 0], { style: "four", cutoff: 5000, shape: 1 });
  const sc = p.add("scope", [5, 0], { timebase: 2, level: 0, edge: "Rising", mode: "Auto", channels: 2, cursors: true });
  p.cable(b.flt, "l", sc, "in1");
  const mix = p.add("audio-mixer", [6, 0], { level1: -1, level2: -1, master: -3 }, { name: "Out Mix" });
  p.cable(sc, "out1", mix, "in1l").cable(sc, "out1", mix, "in1r").stereo(b.drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function filterInOut() {
  const p = patch("Scope: Filter In and Out", {
    module: "scope", tempo: 96,
    description: "A saw riff is drawn twice: raw on the first trace, after a swept resonant low-pass on the second. Watch the corners round off as the cutoff sinks. Change Measure to Trace 1 to read the raw pitch, or raise the filter's Resonance.",
    tags: ["filter", "two traces", "compare", "sweep"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, ".", 5, 3, 0, ".", 10, ".", 7, 5, 3, ".", 5, 7], { rate: "1/8", root: "G", scale: "Natural Minor", octave: -1, shape: 1, gatelength: 0.8, env: { decay: 0.3, sustain: 0.6, release: 0.15 } });
  const lfo = p.add("lfo", [0, 3], { rate: 0.12, wave: "Triangle" }, { name: "Cutoff Sweep" });
  const flt = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.45, type: "Ladder Tanh", drive: 0.1 }, { name: "Sweep Filter" });
  p.cable(m.amp, "l", flt, "l").cable(lfo, "out", flt, "cutoff", 0.45);
  const sc = p.add("scope", [4, 0], { timebase: 3, channels: 2, measure: "Trace 2", source: "Trace 1", cursors: false });
  p.cable(m.amp, "l", sc, "in1").cable(flt, "l", sc, "in2");
  const drums = beat(p, [0, 4], { style: "half", level: -8 });
  finish(p, [6, 0], [{ n: sc, l: "out2", level: -2 }, drumsOf(drums, -4)], { vmix: 0.2 });
  return p;
}

function envNormal() {
  const p = patch("Scope: Envelope in Normal Mode", {
    module: "scope", tempo: 90,
    description: "The first trace shows the envelope of each note, caught by a trigger set just above zero in Normal mode, so every sweep starts exactly when a note starts and the picture waits between notes. Raise Trigger Level to start later on the rise, or change Mode to Auto.",
    tags: ["envelope", "normal mode", "trigger level", "slow sweep"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", 5, ".", ".", 7, ".", 3, ".", ".", 5, ".", ".", 10, "."], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 0.6, gatelength: 0.6, env: { attack: 0.03, decay: 0.5, sustain: 0.3, release: 0.4 } });
  const sc = p.add("scope", [3, 0], { timebase: 100, level: 0.2, mode: "Normal", edge: "Rising", source: "Trace 1", channels: 2, scale1: 3, scale2: 1, measure: "Trace 2" });
  p.cable(m.env, "env", sc, "in1").cable(m.amp, "l", sc, "in2");
  const drums = beat(p, [0, 4], { style: "sparse", level: -8 });
  finish(p, [5, 0], [{ n: sc, l: "out2", level: 4 }, drumsOf(drums, 2)], { vmix: 0.3, decay: 3 });
  return p;
}

function frequencyFollower() {
  const p = patch("Scope: Frequency Plays Along", {
    module: "scope", tempo: 104,
    description: "The Scope measures the pitch of a bass line and its Frequency output, snapped to a scale by a Quantizer, plays a bell an octave and a fifth above, gated by Valid: a harmony made by measuring. Change the Quantizer's Scale or Root, or turn the follower up to hear its small delay.",
    tags: ["frequency out", "pitch follower", "quantizer", "harmony"],
  });
  const m = melody(p, [0, 0], [0, ".", 3, ".", 5, 7, ".", 5, 3, ".", 0, ".", 10, ".", 7, 5], { rate: "1/8", root: "D", scale: "Natural Minor", octave: -1, shape: 0.9, gatelength: 0.6, env: { decay: 0.25, sustain: 0.5, release: 0.12 } });
  const sc = p.add("scope", [3, 0], { timebase: 4, channels: 2, measure: "Trace 1", cursors: false });
  p.cable(m.amp, "l", sc, "in1");
  const q = p.add("quantizer", [4, 0], { root: "D", scale: "Natural Minor", glide: 0, hysteresis: 0.2 });
  p.cable(sc, "freq", q, "in");
  const bell = p.add("oscillator", [5, 0], { shape: 0, octave: "+1", coarse: 7 }, { name: "Follower" });
  const env = p.add("adsr", [5, 1], { attack: 0.004, decay: 0.5, sustain: 0.1, release: 0.5 }, { name: "Follower Env" });
  const amp = p.add("vca", [6, 0], {}, { name: "Follower VCA" });
  p.cable(q, "out", bell, "pitch").cable(sc, "valid", env, "gate").cable(sc, "valid", env, "retrig").cable(bell, "out", amp, "l").cable(env, "env", amp, "gain");
  const drums = beat(p, [0, 4], { style: "half", level: -8 });
  finish(p, [7, 0], [{ n: sc, l: "out1", level: -2, pan: -0.2 }, { n: amp, level: -8, pan: 0.3 }, drumsOf(drums, -5)], { vmix: 0.3 });
  return p;
}

function amplitudeFollower() {
  const p = patch("Scope: Amplitude Opens the Bass", {
    module: "scope", tempo: 112,
    description: "A drum loop is drawn on the Scope and its Amplitude output, the size of the wave, opens the filter of a saw bass: each hit brightens the bass for a moment. Change the cable amount into Cutoff, or move the bass filter's base Cutoff.",
    tags: ["amplitude out", "follower", "filter", "drums"],
  });
  const drums = beat(p, [0, 0], { style: "broken", level: -6 });
  const sc = p.add("scope", [3, 0], { timebase: 20, channels: 2, measure: "Trace 1", scale1: 2, scale2: 2, cursors: false });
  p.cable(drums, "outl", sc, "in1").cable(drums, "outr", sc, "in2");
  const m = melody(p, [0, 4], [0, 0, ".", 0, 7, ".", 0, 5, 0, ".", 0, 10, ".", 7, 5, 3], { rate: "1/8", root: "E", scale: "Natural Minor", octave: -2, shape: 1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.6, release: 0.1 } });
  const flt = p.add("filter", [3, 4], { cutoff: 180, resonance: 0.4, type: "Ladder Tanh", drive: 0.2 }, { name: "Follower Filter" });
  p.cable(m.amp, "l", flt, "l").cable(sc, "amp", flt, "cutoff", 0.8);
  finish(p, [5, 0], [{ n: sc, l: "out1", r: "out2", level: -3 }, { n: flt, level: -5 }], { vmix: 0.15 });
  return p;
}

export default [plainWave, filterInOut, envNormal, frequencyFollower, amplitudeFollower];
