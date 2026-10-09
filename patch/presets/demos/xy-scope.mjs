// SPDX-License-Identifier: MIT
// XY Scope: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Channels → Audio Mixer → Verb → Out 1/2. chans: {n, l (jack), r (optional jack), level, pan}
function finish(p, at, chans, o = {}) {
  const lv = {};
  chans.forEach((c, i) => { lv[`level${i + 1}`] = c.level ?? -6; lv[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, { ...lv, master: o.master ?? -3 });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "out", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
    for (const [n, j] of c.also || []) p.cable(n, j, mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.25, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return mix;
}





function beating() {
  const p = patch("XY Scope: Beating Lissajous", {
    module: "xy-scope", tempo: 72,
    description: "Two sines a few cents apart draw a figure that slowly turns; Phase turns that rotation into a sawtooth LFO that sweeps the filter of a drifting pad, speeding up as the oscillators drift further apart. Watch the loop open and close while the pad opens with it, and try Persistence for longer trails.",
    tags: ["lissajous", "phase", "beating", "lfo"],
  });
  const x = p.add("oscillator", [0, 0], { shape: 0, octave: "-1" }, { name: "X Osc" });
  const y = p.add("oscillator", [0, 1], { shape: 0, octave: "-1" }, { name: "Y Osc" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.06, wave: "Triangle" }, { name: "Detune" });
  p.cable(lfo, "out", y, "fine", 0.35);
  const sc = p.add("xy-scope", [1, 0], { phosphor: "Green", persistence: 0.4, timebase: 0.02, tolerance: "Normal" });
  p.cable(x, "out", sc, "x").cable(y, "out", sc, "y");
  const m = melody(p, [2, 1], [0, "_", "_", "_", 7, "_", 5, "_"], { rate: "1/4", root: "A", scale: "Natural Minor", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.1, sustain: 0.8, release: 1 } });
  const flt = p.add("filter", [5, 1], { cutoff: 500, resonance: 0.35 });
  p.cable(m.amp, "l", flt, "l").cable(sc, "phase", flt, "cutoff", 0.3);
  finish(p, [4, 0], [{ n: sc, l: "outx", level: -18, pan: -0.4 }, { n: sc, l: "outy", level: -18, pan: 0.4 }, { n: flt, l: "l", level: 0 }], { vmix: 0.35, decay: 3.5, master: -9 });
  return p;
}

function intervals() {
  const p = patch("XY Scope: Interval Figures", {
    module: "xy-scope", tempo: 92,
    description: "A fixed sine on X and a sequenced sine on Y trace the figure of each interval: a line for unison, a figure-eight for the octave, a woven knot for the fifth. Ratio feeds a triangle voice that follows the interval, so the scope also plays the harmony. Try Mode Y-T for the same sound as a waveform.",
    tags: ["intervals", "ratio", "figures", "harmony"],
  });
  const x = p.add("oscillator", [0, 0], { shape: 0, octave: "-1", coarse: 0 }, { name: "X Osc" });
  const seq = p.add("step-sequencer", [0, 1], { length: 8, rate: "1/4", root: "C", scale: "Chromatic", octave: 0, gatelength: 0.9 },
    { data: steps([0, 7, 12, 5, 4, 9, 7, 12]) });
  const y = p.add("oscillator", [1, 1], { shape: 0, octave: "-1" }, { name: "Y Osc" });
  const env = p.add("adsr", [1, 2], { attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.3 });
  p.cable(seq, "pitch", y, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig");
  const sc = p.add("xy-scope", [2, 0], { phosphor: "Blue-White", persistence: 0.3, character: "Clean", tolerance: "Loose" });
  p.cable(x, "out", sc, "x").cable(y, "out", sc, "y");
  const fo = p.add("oscillator", [3, 2], { shape: 0.4, octave: "+1" }, { name: "Follower" });
  const fa = p.add("vca", [4, 2], {});
  p.cable(sc, "ratio", fo, "pitch").cable(fo, "out", fa, "l").cable(env, "env", fa, "gain");
  const ya = p.add("vca", [3, 1], {});
  p.cable(sc, "outy", ya, "l").cable(env, "env", ya, "gain");
  finish(p, [5, 0], [{ n: sc, l: "outx", level: -12, pan: -0.3 }, { n: ya, l: "l", level: -2, pan: 0.2 }, { n: fa, l: "l", level: -10, pan: 0.5 }], { vmix: 0.3 });
  return p;
}

function waiting() {
  const p = patch("XY Scope: Waiting for Lock", {
    module: "xy-scope", tempo: 100,
    description: "Two drifting oscillators wander in and out of tune. Whenever the figure stands still the Still gate goes high and opens a melody, so the tune plays only in the moments they agree. Set Still Tolerance to Tight for rarer windows or Loose for more.",
    tags: ["still", "gate", "generative", "lock"],
  });
  const x = p.add("oscillator", [0, 0], { shape: 0, octave: "-1" }, { name: "X Osc" });
  const y = p.add("oscillator", [0, 1], { shape: 0, octave: "-1" }, { name: "Y Osc" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.2, wave: "Triangle" }, { name: "Wander" });
  const lfo2 = p.add("lfo", [1, 2], { rate: 0.071, wave: "Triangle" }, { name: "Slow Wander" });
  p.cable(lfo, "out", y, "fine", 0.05).cable(lfo2, "out", y, "fine", 0.04);
  const sc = p.add("xy-scope", [1, 0], { phosphor: "Amber", persistence: 0.5, tolerance: "Loose", character: "Vintage" });
  p.cable(x, "out", sc, "x").cable(y, "out", sc, "y");
  const gate = p.add("adsr", [2, 0], { attack: 0.02, decay: 0.2, sustain: 1, release: 0.6 }, { name: "Still Env" });
  p.cable(sc, "still", gate, "gate");
  const m = melody(p, [2, 1], [0, 7, 3, 12, 7, 10, 5, 3], { rate: "1/8", root: "G", scale: "Minor Pentatonic", octave: 1, shape: 0.6, env: { decay: 0.3 } });
  const g = p.add("vca", [5, 1], {}, { name: "Lock Gate" });
  p.cable(m.amp, "l", g, "l").cable(gate, "env", g, "gain");
  finish(p, [4, 0], [{ n: sc, l: "outx", level: -18, pan: -0.4 }, { n: sc, l: "outy", level: -18, pan: 0.4 }, { n: g, l: "l", level: 3 }], { vmix: 0.3 });
  return p;
}

function width() {
  const p = patch("XY Scope: Stereo Width", {
    module: "xy-scope", tempo: 110,
    description: "The left and right sides of a detuned saw pad go to X and Y, so you see the stereo image: a rounder cloud when the sides drift apart. Correlation controls the cutoff of an arpeggio, so the wider the pad swells, the darker the arpeggio. Change the Detune of the pad to change the picture.",
    tags: ["stereo", "correlation", "width", "pad"],
  });
  const l = p.add("oscillator", [0, 0], { shape: 1, octave: "-1", coarse: -3 }, { name: "Pad Left" });
  const r = p.add("oscillator", [0, 1], { shape: 1, octave: "-1", coarse: -3 }, { name: "Pad Right" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.1, wave: "Triangle" }, { name: "Spread" });
  p.cable(lfo, "out", r, "fine", 0.4).cable(lfo, "out", l, "fine", -0.4);
  const sc = p.add("xy-scope", [1, 0], { phosphor: "Green", persistence: 0.3 });
  p.cable(l, "out", sc, "x").cable(r, "out", sc, "y");
  const m = melody(p, [2, 1], [0, 7, 12, 7, 3, 10, 12, 15], { rate: "1/16", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 0.9, env: { decay: 0.12 } });
  const flt = p.add("filter", [5, 1], { cutoff: 1200, resonance: 0.3 });
  p.cable(m.amp, "l", flt, "l").cable(sc, "corr", flt, "cutoff", 0.4);
  const bt = beat(p, [0, 3], { style: "four", level: -10 });
  finish(p, [4, 0], [{ n: sc, l: "outx", level: -14, pan: -0.8 }, { n: sc, l: "outy", level: -14, pan: 0.8 }, { n: flt, l: "l", level: 0 }, { n: bt, l: "outl", r: "outr", level: -4 }], { vmix: 0.2 });
  return p;
}

function drumScope() {
  const p = patch("XY Scope: Drum Scope", {
    module: "xy-scope", tempo: 118,
    description: "Mode Y-T turns the scope into an oscilloscope: the drum loop is drawn as a waveform, one sweep per beat in Trigger Beat, with the bass on X as a second dimmer trace. Try a shorter Timebase, a longer Persistence or Trigger Y Rising.",
    tags: ["y-t", "oscilloscope", "drums", "waveform"],
  });
  const bt = beat(p, [0, 0], { style: "broken", level: -6 });
  const m = melody(p, [0, 3], [0, 0, 7, ".", 5, 0, 3, "."], { rate: "1/8", root: "F", scale: "Natural Minor", octave: -2, shape: 0.4, env: { decay: 0.35 }, osc: { octave: "-1" } });
  const sc = p.add("xy-scope", [3, 0], { mode: "Y-T", trigger: "Beat", timebase: 0.25, persistence: 0.6, phosphor: "Amber", intensity: 0.7 });
  p.cable(bt, "outl", sc, "y").cable(m.amp, "l", sc, "x");
  finish(p, [4, 0], [{ n: sc, l: "outy", level: -3, pan: -0.1 }, { n: sc, l: "outx", level: 3, pan: 0.1 }], { vmix: 0.15 });
  return p;
}

export default [beating, intervals, waiting, width, drumScope];
