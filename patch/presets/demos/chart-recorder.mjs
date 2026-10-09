// SPDX-License-Identifier: MIT
// Chart Recorder: five demo patches. Each plays by itself with the transport.
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






/// A quantised voice: pitch source → Quantizer → Oscillator → ADSR-driven VCA (the quantizer's trigger/gate play it).
function qvoice(p, at, src, jack, o = {}) {
  const [c, r] = at;
  const q = p.add("quantizer", [c, r], { root: o.root || "D", scale: o.scale || "Minor Pentatonic", range: o.range ?? 1, glide: o.glide ?? 0, ...(o.q || {}) }, { name: o.name ? o.name + " Scale" : undefined });
  const osc = p.add("oscillator", [c + 1, r], { shape: o.shape ?? 0.6, ...(o.osc || {}) }, { name: o.name || "Voice" });
  const env = p.add("adsr", [c + 1, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.3, ...(o.env || {}) });
  const amp = p.add("vca", [c + 2, r], {});
  p.cable(src, jack, q, "in").cable(q, "out", osc, "pitch").cable(q, "gate", env, "gate").cable(q, "trigger", env, "retrig")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return { q, osc, env, amp };
}

/// A strip of paper as saved node data: u in 0…1 per point (bipolar DC: u = (value + 1) / 2).
function paperData(n, fn, marks = []) {
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.min(1, Math.max(0, fn(i / n))) * 32767), i * 2);
  return { v: 1, n, pcm16: b.toString("base64"), marks };
}

function momentum() {
  const p = patch("Chart Recorder: Pen with Momentum", {
    module: "chart-recorder", tempo: 108,
    description: "An envelope that follows a bass line is drawn by a slow pen with little damping, so the pen overshoots and wobbles around each level: that wobble sweeps the filter. Turn Writing Speed up for a tight envelope, Damping up for a lazy one, and watch the pen on the paper.",
    tags: ["pen", "envelope", "damping", "filter"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -1, gatelength: 0.5 },
    { data: steps([0, 0, 7, 0, 3, 0, 5, 7]) });
  const osc = p.add("oscillator", [1, 0], { shape: 1 });
  const env = p.add("adsr", [1, 1], { attack: 0.005, decay: 0.25, sustain: 0.3, release: 0.2 }, { name: "Amp Env" });
  const cenv = p.add("adsr", [0, 1], { attack: 0.01, decay: 0.5, sustain: 0.1, release: 0.3 }, { name: "Gesture" });
  const cr = p.add("chart-recorder", [2, 1], { detector: "DC", writingspeed: 28, damping: 0.18, record: "Always", response: 0.05 });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(seq, "gate", cenv, "gate").cable(seq, "trigger", cenv, "retrig").cable(cenv, "env", cr, "in");
  const flt = p.add("filter", [2, 0], { cutoff: 350, resonance: 0.5, drive: 0.2 });
  const amp = p.add("vca", [3, 0], {});
  p.cable(osc, "out", flt, "l").cable(cr, "pen", flt, "cutoff", 0.45).cable(flt, "l", amp, "l").cable(env, "env", amp, "gain");
  const lead = melody(p, [0, 2], [12, ".", 7, ".", 10, ".", 15, 12], { rate: "1/4", root: "E", scale: "Minor Pentatonic", octave: 0, shape: 0.5, env: { decay: 0.5 } });
  finish(p, [4, 0], [{ n: amp, l: "l", level: 0 }, { n: lead.amp, l: "l", level: 0, pan: 0.3 }], { vmix: 0.2, master: -6 });
  return p;
}

function sticky() {
  const p = patch("Chart Recorder: Sticky Steps", {
    module: "chart-recorder", tempo: 90,
    description: "A smooth slow LFO is drawn with a pen that sticks: it only moves once the change has built up, so Pen becomes irregular little steps that a Quantizer turns into a wandering pentatonic melody. Lower Friction for a smoother line and more notes, raise it for fewer, bigger leaps.",
    tags: ["friction", "steps", "generative", "melody"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.31, wave: "Sine" }, { name: "Wander" });
  const lfo2 = p.add("lfo", [0, 1], { rate: 0.113, wave: "Triangle" }, { name: "Drift" });
  const sum = p.add("utility", [1, 0], { scalex: 0.7, scaley: 0.5 }, { name: "Mix" });
  p.cable(lfo, "out", sum, "x").cable(lfo2, "out", sum, "y");
  const cr = p.add("chart-recorder", [2, 0], { detector: "DC", friction: 0.7, writingspeed: 50, damping: 0.6, record: "Always" });
  p.cable(sum, "out", cr, "in");
  const v = qvoice(p, [3, 0], cr, "pen", { root: "D", scale: "Dorian", range: 1.5, shape: 0.5, env: { decay: 0.5, sustain: 0.1 }, name: "Walker" });
  const bass = melody(p, [0, 2], [0, "_", "_", "_", 7, "_", 5, "_"], { rate: "1/4", root: "D", scale: "Dorian", octave: -2, shape: 0.3, gatelength: 0.95, env: { sustain: 0.7, release: 0.5 } });
  finish(p, [6, 0], [{ n: v.amp, l: "l", level: 4, pan: 0.2 }, { n: bass.amp, l: "l", level: 2, pan: -0.2 }], { vmix: 0.3, decay: 3, master: -6 });
  return p;
}

function backwards() {
  const p = patch("Chart Recorder: Backwards Gesture", {
    module: "chart-recorder", tempo: 100,
    description: "A smooth random walk is drawn live on a four-bar strip: one voice plays the live pen, and a second plays what the paper replays backwards, so the melody answers itself in reverse. Try Replay Speed 0.5 or 2, or switch Interpolation to Step.",
    tags: ["record", "replay", "reverse", "answer"],
  });
  const rnd = p.add("random", [0, 0], { rate: 1, smooth: 0.8, spread: 0.8, sync: "1/4", seed: 17 }, { name: "Walk" });
  const cr = p.add("chart-recorder", [1, 0], { detector: "DC", record: "Always", paper: "Transport", lengthbars: "4 bars", replayspeed: -1, replaysync: "Song",
    interp: "Linear", writingspeed: 80, damping: 0.7 });
  p.cable(rnd, "out", cr, "in");
  const live = qvoice(p, [2, 0], cr, "pen", { root: "A", scale: "Minor Pentatonic", range: 1.5, shape: 0.9, name: "Live", env: { decay: 0.35 } });
  const back = qvoice(p, [2, 2], cr, "replay", { root: "A", scale: "Minor Pentatonic", range: 1.5, shape: 0.3, name: "Reverse", osc: { octave: "-1" }, env: { decay: 0.6 } });
  const bt = beat(p, [0, 3], { style: "half", level: -10 });
  finish(p, [5, 0], [{ n: live.amp, l: "l", level: 2, pan: -0.3 }, { n: back.amp, l: "l", level: 4, pan: 0.3 }, { n: bt, l: "outl", r: "outr", level: -4 }], { vmix: 0.3, master: -6 });
  return p;
}

function contour() {
  const p = patch("Chart Recorder: Loudness Contour", {
    module: "chart-recorder", tempo: 120,
    description: "The drum bus is drawn as a level trace (Log dB, Response 100 ms), and an inverted Pen pumps a chord pad so it ducks on every kick. Change Detector or Response, or use the Replay output for a duck that arrives a loop later.",
    tags: ["follower", "ducking", "log db", "pad"],
  });
  const bt = beat(p, [0, 0], { style: "four", level: -6 });
  const cr = p.add("chart-recorder", [3, 0], { detector: "Log dB", logrange: "25 dB", response: 0.1, record: "Always", lengthbars: "2 bars", writingspeed: 400, damping: 0.8 });
  p.cable(bt, "outl", cr, "in");
  const mk = (at, name, oct, coarse) => p.add("oscillator", at, { shape: 1, octave: oct, coarse }, { name });
  const a = mk([0, 2], "D", "-1", -9), b = mk([0, 3], "F", "-1", -6), c = mk([0, 4], "A", "-1", -2);
  const mix = p.add("audio-mixer", [1, 3], { level1: -9, level2: -9, level3: -10, pan1: -0.4, pan3: 0.4 }, { name: "Chord" });
  p.cable(a, "out", mix, "in1l").cable(b, "out", mix, "in2l").cable(c, "out", mix, "in3l");
  const flt = p.add("filter", [2, 3], { cutoff: 1800, resonance: 0.2 });
  const duck = p.add("utility", [3, 2], { scalex: -0.85, offset: 0.95 }, { name: "Duck" });
  const pad = p.add("vca", [4, 3], {}, { name: "Pump" });
  p.cable(mix, "outl", flt, "l").cable(mix, "outr", flt, "r").cable(cr, "pen", duck, "x").cable(duck, "out", pad, "gain")
    .cable(flt, "l", pad, "l").cable(flt, "r", pad, "r");
  const lfo = p.add("lfo", [3, 4], { rate: 0.07 }, { name: "Open" });
  p.cable(lfo, "out", flt, "cutoff", 0.15);
  finish(p, [5, 0], [{ n: bt, l: "outl", r: "outr", level: -3 }, { n: pad, l: "l", r: "r", level: 0 }], { vmix: 0.2, master: -6 });
  return p;
}

function table() {
  const p = patch("Chart Recorder: Drawn Table", {
    module: "chart-recorder", tempo: 76,
    description: "A curve drawn on the paper is read as a table: Replay Speed is 0 and a slow LFO on Offset scrubs through it, so the drawn shape becomes a looping melody. Draw on the paper in the view (Shift-drag for lines), or set Interpolation to Step to hear each plateau.",
    tags: ["scrub", "drawn", "table", "offset"],
  });
  const stairs = [0.55, 0.7, 0.62, 0.85, 0.78, 0.92, 0.7, 0.58];
  const curve = (t) => {
    const i = Math.floor(t * 8), f = t * 8 - i;
    const a = stairs[i], b = stairs[(i + 1) % 8];
    return (f < 0.7 ? a : a + (b - a) * (f - 0.7) / 0.3) * 0.6 + 0.2;
  };
  const cr = p.add("chart-recorder", [1, 0], { detector: "DC", record: "Gate", paper: "Transport", lengthbars: "2 bars", replayspeed: 0, replaysync: "Free", interp: "Smooth", offset: 0.5 },
    { data: paperData(960, curve, [0, 480]) });
  const lfo = p.add("lfo", [0, 0], { rate: 0.28, wave: "Saw Up" }, { name: "Scrub" });
  p.cable(lfo, "out", cr, "offset", 0.5);
  const v = qvoice(p, [2, 0], cr, "replay", { root: "C", scale: "Major Pentatonic", range: 2, shape: 0.5, name: "Table Voice", env: { decay: 0.4, sustain: 0.1 } });
  const pad = melody(p, [0, 2], [0, "_", "_", "_", 4, "_", 7, "_"], { rate: "1/4", root: "C", scale: "Major Pentatonic", octave: -1, shape: 0.2, gatelength: 0.95, env: { attack: 0.1, sustain: 0.7, release: 1 } });
  finish(p, [5, 0], [{ n: v.amp, l: "l", level: 4, pan: 0.2 }, { n: pad.amp, l: "l", level: 2, pan: -0.2 }], { vmix: 0.35, decay: 3.5 });
  return p;
}

export default [momentum, sticky, backwards, contour, table];
