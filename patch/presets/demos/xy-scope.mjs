// xy-scope: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A mono voice: Oscillator -> VCA with its own ADSR. src: {n, pitch, gate, trig} (trig: false = no retrigger).
/// o: shape, osc (extra knobs), env, cutoff/res (adds a low-pass), name. Returns {osc, env, amp, out: {n, j}}.
function voice(p, at, src, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.7, ...(o.osc || {}) }, { name: o.name || "Source" });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.25, ...(o.env || {}) }, { name: o.envName || "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (src.pitch !== null) p.cable(src.pn || src.n, src.pitch || "pitch", osc, "pitch");
  p.cable(src.n, src.gate || "gate", env, "gate");
  if (src.trig !== false) p.cable(src.n, src.trig || "trigger", env, "retrig");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  let out = { n: amp, j: "l" }, flt;
  if (o.cutoff) {
    flt = p.add("filter", [c + 2, r], { cutoff: o.cutoff, resonance: o.res ?? 0.2, ...(o.flt || {}) }, { name: "Filter" });
    p.cable(amp, "l", flt, "l");
    out = { n: flt, j: "l" };
  }
  return { osc, env, amp, flt, out };
}

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
    for (const [n, j] of c.also || []) p.cable(n, j, mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

const slowRoot = (p, at, notes, o = {}) => p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/1", root: o.root || "A", scale: o.scale || "Natural Minor", octave: o.octave ?? -1, gatelength: 1 },
  { data: steps(notes) }, { name: o.name || "Root" });

function lockedFifth() {
  const p = patch("XY Scope: Locked Fifth Knot", {
    module: "xy-scope", tempo: 80,
    description: "Two sines a fifth apart draw a slow-turning knot on the scope; each time the pattern stands still enough, the Still gate fires a bell. Change Still Tolerance to Loose and the bells come more often, or tune the Y oscillator by ear to lock them.",
    tags: ["lissajous", "fifth", "still gate", "bells"],
  });
  const seq = slowRoot(p, [0, 0], [0, 0, 5, 3], { root: "D", octave: 0 });
  const x = p.add("oscillator", [1, 0], { shape: 0, octave: "-1" }, { name: "X Sine" });
  const y = p.add("oscillator", [1, 1], { shape: 0, octave: "-1", coarse: 7 }, { name: "Y Sine" });
  p.cable(seq, "pitch", x, "pitch").cable(seq, "pitch", y, "pitch");
  const sc = p.add("xy-scope", [2, 0], { phosphor: "Green", persistence: 0.5, timebase: 0.02, tolerance: "Loose", xgain: 1, ygain: 1 });
  p.cable(x, "out", sc, "x").cable(y, "out", sc, "y");
  const env = p.add("adsr", [3, 3], { attack: 0.003, decay: 1.6, sustain: 0, release: 0.8 }, { name: "Bell Env" });
  const bell = p.add("oscillator", [3, 2], { shape: 0, octave: "+1", coarse: 12 }, { name: "Bell" });
  const bamp = p.add("vca", [4, 2], {}, { name: "Bell VCA" });
  p.cable(seq, "pitch", bell, "pitch").cable(sc, "still", env, "gate").cable(sc, "still", env, "retrig").cable(bell, "out", bamp, "l").cable(env, "env", bamp, "gain");
  const pad = p.add("audio-mixer", [3, 0], { level1: -20, level2: -22, pan1: -0.5, pan2: 0.5, master: -3 }, { name: "Sine Pad" });
  p.cable(sc, "outx", pad, "in1l").cable(sc, "outx", pad, "in1r").cable(sc, "outy", pad, "in2l").cable(sc, "outy", pad, "in2r");
  const drone = p.add("oscillator", [3, 4], { shape: 0.1, octave: "-2" }, { name: "Drone" });
  const dv = p.add("vca", [4, 4], { gain: 0.4 }, { name: "Drone Level" });
  p.cable(seq, "pitch", drone, "pitch").cable(drone, "out", dv, "l");
  finish(p, [5, 0], [{ n: pad, l: "outl", r: "outr", level: 0 }, { n: bamp, level: -16, pan: 0.2 }, { n: dv, level: -20 }], { vmix: 0.4, decay: 4, master: 0 });
  return p;
}

function stereoWidth() {
  const p = patch("XY Scope: Stereo Width Pad", {
    module: "xy-scope", tempo: 70,
    description: "A pad's left and right channels go into X and Y, so the scope shows the stereo image: a diagonal line means near-mono, a round cloud means wide. The Correlation output opens the reverb when the image narrows. Turn the Chorus's Spread down and watch the cloud pinch.",
    tags: ["stereo", "correlation", "chorus", "width"],
  });
  const seq = slowRoot(p, [0, 0], [0, 3, 5, 7], { root: "E", scale: "Minor Pentatonic", octave: -1 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, level2: -6, master: -3 }, { name: "Pad Mix" });
  [0, 1].forEach((i) => {
    const o = p.add("oscillator", [1, i], { shape: 0.6, fine: i ? 7 : -7, octave: i ? "0" : "-1" }, { name: `Pad ${i + 1}` });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const flt = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.2 });
  p.stereo(mix, flt, { from: ["outl", "outr"] });
  const ch = p.add("chorus", [4, 0], { rate: 0.35, depth: 0.7, delay: 14, spread: 0.9, mix: 0.7 });
  p.stereo(flt, ch);
  const sc = p.add("xy-scope", [5, 0], { phosphor: "Blue-White", persistence: 0.3, timebase: 0.02, character: "Clean", intensity: 0.7 });
  p.cable(ch, "l", sc, "x").cable(ch, "r", sc, "y");
  const verb = p.add("reverb", [6, 0], { size: 0.7, decay: 4, mix: 0.2, quality: "Eco (8 lines)" });
  p.cable(sc, "outx", verb, "l").cable(sc, "outy", verb, "r").cable(sc, "corr", verb, "mix", 0.3).stereo(verb, p.out);
  return p;
}

function waveformView() {
  const p = patch("XY Scope: Bass Waveform", {
    module: "xy-scope", tempo: 100,
    description: "In Y-T mode the scope is an ordinary oscilloscope: a bass line's waveform stands still on screen, triggered on every rising edge. Shorten Timebase to see single cycles, or turn the Oscillator's Shape and watch the wave change under the sound.",
    tags: ["oscilloscope", "y-t", "waveform", "bass"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 0, ".", 7, ".", 5, 0, ".", 0, 3, ".", 5, 7, 5], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -2, shape: 0.5, gatelength: 0.8, env: { decay: 0.2, sustain: 0.7, release: 0.1 } });
  const lfo = p.add("lfo", [1, 3], { rate: 0.1, wave: "Triangle", polarity: "Unipolar" }, { name: "Shape Drift" });
  p.cable(lfo, "out", m.osc, "shape", 0.5);
  const sc = p.add("xy-scope", [4, 0], { mode: "Y-T", phosphor: "Amber", timebase: 0.01, trigger: "Y Rising", persistence: 0.2 });
  p.cable(m.amp, "l", sc, "y").cable(m.amp, "l", sc, "x");
  const drums = beat(p, [0, 4], { style: "four", level: -10 });
  finish(p, [6, 0], [{ n: sc, l: "outy", level: 4 }, drumsOf(drums, 0)], { vmix: 0.12, decay: 1.2, master: -3 });
  return p;
}

function fmKnots() {
  const p = patch("XY Scope: FM Knots", {
    module: "xy-scope", tempo: 88,
    description: "A bell-like FM pair plays a pentatonic line; the carrier goes to X and the modulated tone to Y, so each note draws a tangled knot that unwinds as it decays. Raise the Oscillator's FM Depth for a busier knot, or X Gain to stretch the figure.",
    tags: ["fm", "knot", "bells", "figure"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "C", scale: "Major Pentatonic", octave: 1, gatelength: 0.3 }, { data: steps([0, 4, 7, 4, 9, 7, 4, 2]) });
  const car = p.add("oscillator", [1, 0], { shape: 0, octave: "0" }, { name: "Carrier" });
  const mod = p.add("oscillator", [1, 1], { shape: 0, octave: "0", coarse: 7, fm: 0.35 }, { name: "Modulated" });
  p.cable(seq, "pitch", car, "pitch").cable(seq, "pitch", mod, "pitch").cable(car, "out", mod, "fm");
  const env = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.9, sustain: 0, release: 0.5 }, { name: "Bell Env" });
  const vx = p.add("vca", [2, 0], {}, { name: "X VCA" });
  const vy = p.add("vca", [2, 1], {}, { name: "Y VCA" });
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(car, "out", vx, "l").cable(mod, "out", vy, "l").cable(env, "env", vx, "gain").cable(env, "env", vy, "gain");
  const sc = p.add("xy-scope", [3, 0], { phosphor: "Green", persistence: 0.8, timebase: 0.02, intensity: 0.7 });
  p.cable(vx, "l", sc, "x").cable(vy, "l", sc, "y");
  const dl = p.add("delay", [4, 0], { timel: 375, timer: 500, feedback: 0.4, highcut: 6000, mix: 0.3 });
  p.cable(sc, "outx", dl, "l").cable(sc, "outy", dl, "r");
  finish(p, [5, 0], [{ n: dl, l: "l", r: "r", level: 6 }], { vmix: 0.35, decay: 4, master: -3 });
  return p;
}

function ratioVoice() {
  const p = patch("XY Scope: Ratio Plays a Voice", {
    module: "xy-scope", tempo: 92,
    description: "A fixed sine on X and a sweeping sine on Y: the scope measures their ratio and its Ratio output, as a pitch, plays a third voice that follows the interval between them. Change the sweep rate and the follower glides along; try Timebase for a clearer picture.",
    tags: ["ratio", "interval", "follower", "sweep"],
  });
  const x = p.add("oscillator", [0, 0], { shape: 0, octave: "-1" }, { name: "X Sine" });
  const y = p.add("oscillator", [0, 1], { shape: 0, octave: "-1", coarse: 5 }, { name: "Y Sine" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.08, wave: "Triangle" }, { name: "Sweep" });
  p.cable(lfo, "out", y, "pitch", 0.25);
  const sc = p.add("xy-scope", [1, 0], { phosphor: "Amber", persistence: 0.4, timebase: 0.02, tolerance: "Normal" });
  p.cable(x, "out", sc, "x").cable(y, "out", sc, "y");
  const f = p.add("oscillator", [2, 0], { shape: 0.55, octave: "0" }, { name: "Follower" });
  const env = p.add("adsr", [2, 1], { attack: 0.2, decay: 0.5, sustain: 0.7, release: 0.8 }, { name: "Follower Env" });
  const fv = p.add("vca", [3, 0], {}, { name: "Follower VCA" });
  const lfo2 = p.add("lfo", [2, 2], { wave: "Square", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Follower Gate" });
  p.cable(sc, "ratio", f, "pitch").cable(lfo2, "out", env, "gate").cable(f, "out", fv, "l").cable(env, "env", fv, "gain");
  const drums = beat(p, [0, 5], { style: "sparse", level: -12 });
  finish(p, [4, 0], [{ n: sc, l: "outx", level: -20, pan: -0.3 }, { n: sc, l: "outy", level: -22, pan: 0.3 }, { n: fv, level: -8 }, drumsOf(drums, 0)], { vmix: 0.3, decay: 3, master: 0 });
  return p;
}

export default [lockedFifth, stereoWidth, waveformView, fmKnots, ratioVoice];
