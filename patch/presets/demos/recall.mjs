// SPDX-License-Identifier: MIT
// Recall: five demo patches. Each plays by itself with the transport.
import { patch, steps, semis } from "../kit.mjs";

const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator → ADSR-driven VCA, gated by a gate jack. Returns {osc, env, amp}.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.5, octave: oct(o.octave ?? 0), fine: o.fine ?? 0, coarse: o.coarse ?? 0 }, { name: o.name || "Voice" });
  const env = p.add("adsr", [c, r + 1], { attack: o.attack ?? 0.004, decay: o.decay ?? 0.3, sustain: o.sustain ?? 0, release: o.release ?? 0.2 }, { name: "Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(pitch.node, pitch.jack, osc, "pitch", pitch.amount ?? 1);
  p.cable(gate.node, gate.jack, env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return { osc, env, amp };
}
function sum(p, at, list, master = -3, name = "Mix") {
  const vals = { master };
  list.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -3; vals[`pan${i + 1}`] = x.pan ?? 0; });
  const m = p.add("audio-mixer", at, vals, { name });
  list.forEach((x, i) => p.cable(x.node, x.jack || "l", m, `in${i + 1}l`));
  return m;
}
const mono = (p, from, to, a, b) => p.cable(from, "l", to, a).cable(from, "l", to, b);

function randomBackbeat() {
  const p = patch("Recall: Random Backbeat", {
    module: "recall", tempo: 112,
    description: "T Mode Drums turns the T section into a kick (T1) and a snare (T2) that favour beats 1 and 3, 2 and 4, with occasional ghost notes. X, snapped to F minor pentatonic and clocked by the kicks, plays the bass. T Recall at 60 % keeps the figure recognisable while it changes; try 0 % or 100 %.",
    tags: ["drums", "backbeat", "bass", "recall"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Drums", tbias: 0.55, trecall: 0.6, tloop: 16, gatelength: 0.4, xspread: 0.45, xbias: 0.35,
    xsteps: 0.6, xrecall: 0.5, xloop: 8, sync: "1/16", xsource: "T1", xrange: "Unipolar", root: "F", scale: "Minor Pentatonic", seed: 12 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.65 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.45, closed: 0.035 });
  p.cable(rc, "t1", kick, "trig").cable(rc, "t2", snare, "trig").cable(rc, "clock", hats, "closed");
  const bass = voice(p, [2, 4], { node: rc, jack: "x1", amount: 1 }, { node: rc, jack: "t1" }, { shape: 0.6, octave: -2, decay: 0.28, sustain: 0.15, name: "Bass" });
  const drums = sum(p, [4, 0], [{ node: kick, jack: "out", level: -2 }, { node: snare, jack: "out", level: -4, pan: 0.1 }, { node: hats, jack: "out", level: -12, pan: 0.3 }], -2, "Drums");
  const out = p.add("audio-mixer", [5, 1], { level1: -1, level2: -2, master: -3 }, { name: "Final" });
  p.stereo(drums, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  mono(p, bass.amp, out, "in2l", "in2r");
  const verb = p.add("reverb", [6, 0], { size: 0.4, decay: 1.4, mix: 0.12 });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function lockedMelody() {
  const p = patch("Recall: Locked Melody", {
    module: "recall", tempo: 100,
    description: "With T Recall and X Recall at 100 % the random gates and notes are locked into an eight-step loop, a ready-made melody in A minor pentatonic. Because the memory holds raw random numbers, changing the Scale, X Spread or X Bias reshapes the same contour. Lower the Recall knobs to let it mutate again.",
    tags: ["melody", "locked loop", "scale", "pentatonic"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.7, trecall: 1, tloop: 8, gatelength: 0.6, xspread: 0.6, xbias: 0.5,
    xsteps: 0.6, xrecall: 1, xloop: 8, sync: "1/8", xsource: "Tick", xrange: "Unipolar", root: "A", scale: "Minor Pentatonic", seed: 41 });
  const lead = voice(p, [2, 0], { node: rc, jack: "x1", amount: 1 }, { node: rc, jack: "t1" }, { shape: 0.35, octave: 0, decay: 0.3, name: "Lead" });
  const low = voice(p, [2, 3], { node: rc, jack: "x2", amount: 1 }, { node: rc, jack: "t2" }, { shape: 0.15, octave: -1, decay: 0.45, sustain: 0.1, name: "Low Voice" });
  const mix = sum(p, [4, 0], [{ node: lead.amp, level: -3, pan: 0.2 }, { node: low.amp, level: -3, pan: -0.25 }], 4, "Voices");
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.4, tone: -0.3, width: 1, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3, mix: 0.25 });
  p.stereo(mix, dly, { from: ["outl", "outr"] }).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

function ratchetRolls() {
  const p = patch("Recall: Ratchet Rolls", {
    module: "recall", tempo: 122,
    description: "T Mode Ratchet lets every tick fire as divisions or as two to four quick pulses: T1 rattles a hi-hat, T2 a clap, over a steady kick and a pulsing bass. T Bias towards the right gives more ratchets, towards the left sparse divisions. Try Gate Length and T Jitter.",
    tags: ["ratchet", "rolls", "hats", "techno"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Ratchet", tbias: 0.65, tjitter: 0.15, trecall: 0.4, tloop: 16, gatelength: 0.35, sync: "1/8", seed: 6, xsteps: 0.6, xsource: "T2",
    xrange: "Unipolar", root: "D", scale: "Natural Minor", xrecall: 0.2 });
  const kseq = p.add("step-sequencer", [0, 3], { length: 4, rate: "1/4", gatelength: 0.4 }, { data: steps([0, 0, 0, 0]) }, { name: "Four on the Floor" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, tune: 48, decay: 0.5 });
  const hat = p.add("punch-hats", [2, 1], { level: 0.5, closed: 0.03, tone: 0.7 });
  const clap = p.add("punch-clap", [2, 2], { tone: 2200, decay: 0.2, bursts: 3 });
  p.cable(kseq, "trigger", kick, "trig").cable(rc, "t1", hat, "closed").cable(rc, "t2", clap, "trig");
  const bseq = p.add("step-sequencer", [0, 5], { length: 8, rate: "1/8", root: "D", scale: "Natural Minor", octave: -1, gatelength: 0.45 },
    { data: steps([".", 0, ".", 0, ".", 0, ".", 3]) }, { name: "Offbeat Bass" });
  const bass = voice(p, [2, 4], { node: bseq, jack: "pitch" }, { node: bseq, jack: "gate" }, { shape: 0.85, decay: 0.22, sustain: 0.1, name: "Bass" });
  const bflt = p.add("filter", [4, 4], { cutoff: 500, resonance: 0.4, type: "Ladder Tanh" });
  const lfo = p.add("lfo", [4, 5], { rate: 0.1 }, { name: "Sweep" });
  mono(p, bass.amp, bflt, "l", "r");
  p.cable(lfo, "out", bflt, "cutoff", 0.25);
  const drums = sum(p, [4, 0], [{ node: kick, jack: "out", level: -2 }, { node: hat, jack: "out", level: -6, pan: 0.3 }, { node: clap, jack: "out", level: -7, pan: -0.25 }], -3, "Drums");
  const out = p.add("audio-mixer", [5, 1], { level1: -1, level2: -3, master: -1 }, { name: "Final" });
  p.stereo(drums, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(bflt, out, { to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [6, 0], { size: 0.4, decay: 1.5, mix: 0.12 });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function sortedDrift() {
  const p = patch("Recall: Sorted Drift", {
    module: "recall", tempo: 70,
    description: "X Mode Sorted makes X1, X2 and X3 always low, middle and high, so three soft voices drift through a D major pentatonic chord that changes every half note; T chance gates re-swell them. Spread sets how wide the chord is, Bias how high it sits.",
    tags: ["ambient", "sorted", "drift", "chord"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.8, trecall: 0.3, tloop: 4, gatelength: 0.95, xspread: 0.75, xbias: 0.5, xsteps: 0.6,
    xrecall: 0, xloop: 8, sync: "1/2", xsource: "Tick", xmode: "Sorted", xrange: "Unipolar", root: "D", scale: "Major Pentatonic", seed: 3 });
  const env = p.add("adsr", [2, 4], { attack: 0.8, decay: 1, sustain: 0.8, release: 2 }, { name: "Swell" });
  p.cable(rc, "t1", env, "gate");
  const oscs = ["x1", "x2", "x3"].map((j, i) => {
    const o = p.add("oscillator", [2, i], { shape: [0.1, 0.4, 0.2][i], octave: oct(i === 2 ? 0 : -1), fine: (i - 1) * 6 }, { name: `Voice ${i + 1}` });
    p.cable(rc, j, o, "pitch", 1);
    return { node: o, jack: "out", level: -5, pan: (i - 1) * 0.6 };
  });
  const mix = sum(p, [3, 0], oscs, -2, "Voices");
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [5, 0], { cutoff: 1400, resonance: 0.15, type: "Ladder Tanh" });
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain").stereo(vca, flt);
  const verb = p.add("reverb", [6, 0], { size: 0.9, decay: 8, mix: 0.45 });
  p.stereo(flt, verb).stereo(verb, p.out);
  return p;
}

function breathingLoop() {
  const p = patch("Recall: Breathing Memory", {
    module: "recall", tempo: 108,
    description: "A slow LFO moves both Recall knobs from always-new to a locked loop and back, while T Loop is 5 and X Loop 7 so the rhythm and the melody never line up. The D Dorian pluck line crystallises, mutates, and crystallises again; a bass follows the second gate. Try setting the Recall knobs by hand.",
    tags: ["evolving", "polymeter", "memory", "dorian"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Coin", tbias: 0.6, trecall: 0.5, tloop: 5, gatelength: 0.5, xspread: 0.65, xbias: 0.45, xsteps: 0.62,
    xrecall: 0.5, xloop: 7, sync: "1/16", xsource: "T1", xrange: "Unipolar", root: "D", scale: "Dorian", seed: 19 });
  const lfo = p.add("lfo", [0, 2], { rate: 0.03, wave: "Triangle" }, { name: "Memory Tide" });
  const lfo2 = p.add("lfo", [0, 3], { rate: 0.021, wave: "Sine", phase: 90 }, { name: "Melody Tide" });
  p.cable(lfo, "out", rc, "trecall", 0.55).cable(lfo2, "out", rc, "xrecall", 0.55);
  const lead = voice(p, [2, 0], { node: rc, jack: "x1", amount: 1 }, { node: rc, jack: "t1" }, { shape: 0.4, octave: 0, decay: 0.22, name: "Lead" });
  const bass = voice(p, [2, 3], { node: rc, jack: "x2", amount: 0.5 }, { node: rc, jack: "t2" }, { shape: 0.15, octave: -1, decay: 0.35, sustain: 0.1, name: "Bass" });
  const hat = p.add("punch-hats", [2, 6], { level: 0.35, closed: 0.03 });
  const hseq = p.add("step-sequencer", [0, 6], { length: 4, rate: "1/8", gatelength: 0.3 }, { data: steps([0, 0, 0, 0]) }, { name: "Hat Clock" });
  p.cable(hseq, "trigger", hat, "closed");
  const mix = sum(p, [4, 0], [{ node: lead.amp, level: -3, pan: 0.25 }, { node: bass.amp, level: -3, pan: -0.2 }, { node: hat, jack: "out", level: -14, pan: 0.4 }], 4, "Voices");
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.42, tone: -0.3, width: 1, mix: 0.32, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3, mix: 0.25 });
  p.stereo(mix, dly, { from: ["outl", "outr"] }).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

export default [randomBackbeat, lockedMelody, ratchetRolls, sortedDrift, breathingLoop];
