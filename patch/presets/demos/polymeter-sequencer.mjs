// Polymeter Seq: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A Step Sequencer: `notes` as in steps(); `knobs` are its settings; `vel` the velocities.
function sq(p, at, notes, knobs = {}, vel) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: "1/8", gatelength: 0.45, ...knobs }, { data: steps(notes, vel) });
}

/// Oscillator → ADSR → VCA from a pitch and gate source ({node, pitch, gate, trigger, velocity}), optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger !== false) p.cable(src.node, src.trigger || "trigger", env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Mono source → optional delay → reverb → Out 1/2. Returns the reverb.
function space(p, at, from, jack, { level = 3, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: true }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    node = p.add("zone-delay", [c, r], delay);
    p.stereo(m, node, { from: out });
    out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

/// Mono voice + drums → mixer → short reverb → Out 1/2.
function withBeat(p, at, from, jack, style, { lead = -2, drums = -4, level = -9, verb = {} } = {}) {
  const [c, r] = at;
  const d = beat(p, [c, r + 1], { style, level });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: lead, level2: drums, master: -2 }, { name: "Mix" });
  p.cable(from, jack, mix, "in1l").cable(from, jack, mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [c + 2, r], { size: 0.3, decay: 1.2, mix: 0.12, ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

const NEUTRAL = { trig: 1, note: 0, oct: 0, gate: 50, prob: 100, ratch: 1 };

/// One Polymeter Seq track as sanitiseData writes it. `values` are the steps (ratchets: a count or [count, shape]),
/// `div` one of x4 x3 x2 1 /2 /3 /4 /5 /6 /7 /8 /16 and `dir` one of fwd bwd pp rnd.
function track(key, values, div = "1", dir = "fwd") {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const v = i < values.length ? values[i] : NEUTRAL[key];
    out.push(key === "ratch" ? (Array.isArray(v) ? v : [v, 0]) : v);
  }
  return { len: values.length, lo: 0, hi: values.length - 1, div, dir, mute: false, steps: out };
}
/// A pattern slot: `t` maps track keys to track(...) results; missing tracks are one neutral step.
const slot = (t) => ({ tracks: Object.fromEntries(["trig", "note", "oct", "gate", "prob", "ratch"].map((k) => [k, t[k] || track(k, [NEUTRAL[k]])])) });
const data = (slots) => ({ slot: 0, slots, randomize: { density: 0.5, degrees: [0, 7], stepwise: true, ratchet: 0.1 } });

function fiveAgainstSeven() {
  const p = patch("Polymeter Seq: Five Against Seven", {
    module: "polymeter-sequencer", tempo: 100,
    description: "The trigger track is five steps long and the note track seven, so each rhythm cycle meets a different pitch and the tune only repeats after thirty-five steps. Change the length of either track in the view to find another cycle.",
    tags: ["polymeter", "pentatonic", "pluck", "cycles"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/8", root: "A", scale: "Minor Pentatonic", gatescale: 0.8, velocity: 0.8, spread: 0.25 }, {
    data: data([slot({ trig: track("trig", [2, 1, 0, 1, 1]), note: track("note", [0, 2, 1, 3, 4, 2, 1]), oct: track("oct", [0, 0, 0, 1, 0, 0, 0]) })]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.5 }, env: { decay: 0.35, sustain: 0.1, release: 0.3 }, filter: { cutoff: 3000, resonance: 0.15 } });
  space(p, [4, 0], v.out, "l", { level: 5, delay: { zone: 3, time: 0.4, feedback: 0.45, mix: 0.3, tone: -0.2 }, verb: { size: 0.6, decay: 3.5, mix: 0.3 } });
  return p;
}

function sevenStepGroove() {
  const p = patch("Polymeter Seq: Seven-Step Groove", {
    module: "polymeter-sequencer", tempo: 118,
    description: "A bass line built on a seven-step trigger track plays against a half-time beat, so the groove keeps leaning forward and landing again. The Track Ends output rings a hat whenever a track wraps around; try dragging Swing or Gate Scale.",
    tags: ["bass", "odd length", "groove", "track ends"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/16", root: "D", scale: "Natural Minor", octave: -2, gatescale: 0.9, velocity: 0.85, swing: 0.54 }, {
    data: data([slot({ trig: track("trig", [2, 0, 1, 1, 0, 1, 0]), note: track("note", [0, 0, 3, 0, 4]), oct: track("oct", [0, 1, 0]), gate: track("gate", [60, 40, 40, 80, 40, 50, 40]) })]),
  });
  const bass = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { name: "Bass", osc: { shape: 0.95 }, env: { decay: 0.18, sustain: 0.4, release: 0.08 }, filter: { cutoff: 450, resonance: 0.35, drive: 0.2 } });
  const hat = p.add("punch-hats", [1, 3], { level: 0.45 });
  p.cable(seq, "trackends", hat, "closed");
  const drums = beat(p, [0, 4], { style: "half", level: -9 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -3, level2: -4, level3: -8, pan3: 0.25, master: -2 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").cable(bass.out, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).cable(hat, "out", mix, "in3l");
  const verb = p.add("reverb", [4, 0], { size: 0.3, decay: 1.2, mix: 0.12 });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function probabilityGarden() {
  const p = patch("Polymeter Seq: Probability Garden", {
    module: "polymeter-sequencer", tempo: 90,
    description: "The probability track gives each step a chance of sounding, so a Dorian marimba tune keeps thinning out and filling in. Push Prob. Bias up for a dense, almost fixed tune or down towards silence; change Seed to grow a different garden.",
    tags: ["probability", "generative", "marimba", "dorian"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/8", root: "E", scale: "Dorian", gatescale: 0.6, velocity: 0.8, spread: 0.4, probbias: 0, seed: 5 }, {
    data: data([slot({
      trig: track("trig", [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      note: track("note", [0, 2, 4, 1, 3, 5, 2, 4, 6]),
      oct: track("oct", [0, 0, 1, 0, 0, 1, 0]),
      prob: track("prob", [100, 60, 80, 40, 70, 50, 90, 30]),
    })]),
  });
  const mal = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.55, geometry: 0.3, brightness: 0.6, damping: 0.5, position: 0.3, size: 0.35, space: 0.25 }, { name: "Marimba" });
  p.cable(seq, "pitch", mal, "pitch").cable(seq, "trigger", mal, "strike").cable(seq, "velocity", mal, "velocity");
  const lvl = p.add("audio-mixer", [2, 0], { level1: -5, master: 0 }, { name: "Level" });
  const verb = p.add("reverb", [3, 0], { size: 0.55, decay: 2.8, mix: 0.3 });
  p.stereo(mal, lvl, { to: ["in1l", "in1r"] }).stereo(lvl, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function ratchetRolls() {
  const p = patch("Polymeter Seq: Ratchet Rolls", {
    module: "polymeter-sequencer", tempo: 108,
    description: "Some steps of the ratchet track split into two, three or four quick repeats, so a simple lead line stutters and rolls at odd places. Ratchet Amt scales how far the repeats go: bring it to 0 for a plain line, or leave it up for rolls.",
    tags: ["ratchet", "stutter", "lead", "rolls"],
  });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/16", root: "C", scale: "Major Pentatonic", gatescale: 0.5, velocity: 0.8, ratchetamt: 1 }, {
    data: data([slot({
      trig: track("trig", [2, 0, 1, 0, 1, 1, 0, 1]),
      note: track("note", [0, 2, 4, 3, 1, 4]),
      oct: track("oct", [0, 0, 0, 1]),
      ratch: track("ratch", [1, 1, [2, 0], 1, [3, 1], 1, 1, [4, 0]]),
    })]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.75 }, env: { decay: 0.14, sustain: 0.05, release: 0.1 }, filter: { cutoff: 2800, resonance: 0.2 } });
  withBeat(p, [3, 0], v.out, "l", "sparse", { lead: 6 });
  return p;
}

function patternSlots() {
  const p = patch("Polymeter Seq: Pattern Slots", {
    module: "polymeter-sequencer", tempo: 100,
    description: "Two stored patterns, a calm one and a busy one, share a voice, and a slow ramp on the Pattern input moves from one to the other at the next bar. Click a slot in the view to play it alone, or change Pattern Change to switch immediately.",
    tags: ["pattern slots", "arrangement", "pattern change", "lead"],
  });
  const calm = slot({ trig: track("trig", [2, 0, 1, 0, 0, 1, 0, 0]), note: track("note", [0, 2, 4]), oct: track("oct", [0]), gate: track("gate", [90, 60]) });
  const busy = slot({ trig: track("trig", [2, 1, 1, 0, 1, 1, 1, 0, 1]), note: track("note", [0, 4, 2, 5, 3, 1, 4, 6]), oct: track("oct", [0, 0, 1, 0, 0]), gate: track("gate", [40, 30, 30, 50]) });
  const seq = p.add("polymeter-sequencer", [0, 0], { rate: "1/8", root: "D", scale: "Dorian", slots: 2, patternchange: "Next bar", gatescale: 0.8, velocity: 0.8 }, { data: data([calm, busy]) });
  const ramp = p.add("lfo", [0, 2], { wave: "Square", sync: "8 bars", polarity: "Unipolar", pw: 0.5 }, { name: "Slot Switch" });
  p.cable(ramp, "out", seq, "pattern");
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.4 }, env: { decay: 0.4, sustain: 0.1, release: 0.3 }, filter: { cutoff: 2800, resonance: 0.15 } });
  space(p, [4, 0], v.out, "l", { level: 5, delay: { zone: 3, time: 0.45, feedback: 0.4, mix: 0.25 }, verb: { size: 0.55, decay: 2.8, mix: 0.3 } });
  return p;
}

export default [fiveAgainstSeven, sevenStepGroove, probabilityGarden, ratchetRolls, patternSlots];
