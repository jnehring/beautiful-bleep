// SPDX-License-Identifier: MIT
// Recall: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";

const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator -> ADSR -> VCA (optional filter), played by a pitch jack and a gate jack: [node, jack] pairs.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.6, octave: oct(o.octave ?? 0), ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.004, decay: 0.3, sustain: 0, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  if (pitch) p.cable(pitch[0], pitch[1], osc, "pitch", pitch[2] ?? 1);
  p.cable(gate[0], gate[1], env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (o.retrig) p.cable(o.retrig[0], o.retrig[1], env, "retrig");
  if (!o.filter) return { osc, env, amp, out: amp, jack: "l" };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter, jack: "l" };
}
/// Up to eight mono sources into one stereo mix. list: {node, jack, level, pan}.
function bus(p, at, list, master = -3, name = "Mix") {
  const [c, r] = at;
  const mk = (items, col, row, nm, m) => {
    const vals = { master: m };
    items.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -6; vals[`pan${i + 1}`] = x.pan ?? 0; });
    const mx = p.add("audio-mixer", [col, row], vals, { name: nm });
    items.forEach((x, i) => p.cable(x.node, x.jack || "out", mx, `in${i + 1}l`));
    return mx;
  };
  if (list.length <= 4) return mk(list, c, r, name, master);
  const a = mk(list.slice(0, 4), c, r, `${name} A`, 0), b = mk(list.slice(4), c, r + 1, `${name} B`, 0);
  const fin = p.add("audio-mixer", [c + 1, r], { level1: 0, level2: 0, master }, { name });
  p.stereo(a, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(b, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return fin;
}
/// Mono jack to both sides of a stereo input pair.
const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);
/// A reverb after a stereo mixer (outl/outr) and then the patch output.
function finish(p, mixer, at, verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.4, mix: 0.15, ...verb });
  p.stereo(mixer, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

function coinDrums() {
  const p = patch("Recall: Coin-Flip Drums", {
    module: "recall", tempo: 108,
    description: "Every clock step Recall flips a coin for two gates: T1 plays the kick, T2 the snare, and the Clock output drives steady hats. T Bias leans the coin towards or away from firing, T Jitter adds extra randomness; try raising T Recall to repeat the recent past.",
    tags: ["coin", "random", "drums", "gates"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Coin", tbias: 0.4, tjitter: 0.15, trecall: 0.35, tloop: 16, gatelength: 0.25, sync: "1/16", seed: 17 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, decay: 0.45 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.42, closed: 0.035 });
  p.cable(rc, "t1", kick, "trig").cable(rc, "t2", snare, "trig").cable(rc, "clock", hats, "closed");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -14, pan: 0.3 }], 0, "Kit");
  finish(p, mix, [5, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function ratchetBass() {
  const p = patch("Recall: Ratchet Bass Line", {
    module: "recall", tempo: 124,
    description: "T Mode Ratchet turns the random gates into bursts of quick repeats, and each burst plays a bass note chosen by X from F Phrygian dominant. Lower X Spread for a narrower line, or move X Bias to put the bass higher or lower.",
    tags: ["ratchet", "bass", "phrygian", "random melody"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Ratchet", tbias: 0.55, trecall: 0.5, tloop: 8, gatelength: 0.4, xspread: 0.4, xbias: 0.3, xsteps: 0.6, xrecall: 0.5, xloop: 8,
    sync: "1/16", xsource: "T1", xrange: "Unipolar", root: "F", scale: "Phrygian Dominant", seed: 33 });
  const bass = voice(p, [2, 0], [rc, "x1"], [rc, "t1"], { name: "Bass", shape: 0.25, octave: -2, env: { decay: 0.22, sustain: 0.1 },
    filter: { cutoff: 700, resonance: 0.35, type: "Ladder Tanh" } });
  const kick = p.add("punch-kick", [2, 3], { level: 0.75 });
  const hats = p.add("punch-hats", [3, 3], { level: 0.4, closed: 0.035 });
  p.cable(rc, "t2", kick, "trig").cable(rc, "clock", hats, "closed");
  const mix = bus(p, [5, 0], [{ node: bass.out, jack: "l", level: -2 }, { node: kick, level: -5 }, { node: hats, level: -16, pan: 0.3 }], -5, "Mix");
  finish(p, mix, [6, 0], { size: 0.3, decay: 1, mix: 0.1 });
  return p;
}

function settleDown() {
  const p = patch("Recall: Settling Loop", {
    module: "recall", tempo: 96,
    description: "A slow sawtooth LFO raises both Recall knobs from 0 to 100 % over 16 bars: the melody starts out new on every step, gradually repeats itself more and more, and ends up as a locked loop before the cycle begins again. Move T Recall or X Recall yourself to freeze or free it at any time.",
    tags: ["recall", "loop", "evolving", "melody"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.75, trecall: 0, tloop: 8, gatelength: 0.55, xspread: 0.65, xbias: 0.5, xsteps: 0.6, xrecall: 0, xloop: 8,
    sync: "1/8", xsource: "Tick", xrange: "Unipolar", root: "D", scale: "Major Pentatonic", seed: 52 });
  const lfo = p.add("lfo", [0, 3], { wave: "Saw Up", sync: "8 bars", polarity: "Unipolar" }, { name: "Settle" });
  p.cable(lfo, "out", rc, "trecall").cable(lfo, "out", rc, "xrecall");
  const lead = voice(p, [2, 0], [rc, "x1"], [rc, "t1"], { name: "Lead", shape: 0.35, env: { decay: 0.35, sustain: 0.1, release: 0.3 } });
  const low = voice(p, [2, 3], [rc, "x2", 0.5], [rc, "t2"], { name: "Low", shape: 0.15, octave: -1, env: { decay: 0.5, sustain: 0.1, release: 0.4 } });
  const mix = bus(p, [5, 0], [{ node: lead.out, jack: "l", level: -2, pan: 0.2 }, { node: low.out, jack: "l", level: -1, pan: -0.25 }], 5, "Voices");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.4, mix: 0.28, highcut: 5000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.6, decay: 3, mix: 0.25 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

function sortedChords() {
  const p = patch("Recall: Sorted Triad Rising", {
    module: "recall", tempo: 80,
    description: "X Mode Sorted puts the three random voltages in ascending order, so X1, X2 and X3 always form a stack from low to high, and three voices play them as a changing chord. Switch X Mode to Independent and the voices cross over; change Scale for a different colour.",
    tags: ["sorted", "chords", "voicing", "pad"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Coin", tbias: 0.9, tjitter: 0, trecall: 0, gatelength: 0.9, xspread: 0.75, xbias: 0.45, xsteps: 0.6, xrecall: 0,
    xloop: 4, xmode: "Sorted", xrange: "Unipolar", sync: "1/2", xsource: "Tick", root: "E", scale: "Dorian", seed: 8 });
  const vs = ["x1", "x2", "x3"].map((j, i) => voice(p, [2, i * 2], [rc, j], [rc, "t1"], { name: `Chord ${i + 1}`, shape: 0.4 + i * 0.1,
    osc: { fine: (i - 1) * 7 }, env: { attack: 0.3, decay: 1, sustain: 0.6, release: 1.5 }, filter: { cutoff: 2200, resonance: 0.15 } }));
  const mix = bus(p, [5, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: -4, pan: -0.5 + i * 0.5 })), 1, "Chord");
  const ch = p.add("chorus", [6, 0], { rate: 0.35, depth: 0.5, mix: 0.4 });
  const v = p.add("reverb", [7, 0], { size: 0.8, decay: 6, mix: 0.35 });
  p.stereo(mix, ch, { from: ["outl", "outr"] }).stereo(ch, v).stereo(v, p.out);
  return p;
}

function driftingBells() {
  const p = patch("Recall: Free-Running Bells", {
    module: "recall", tempo: 70,
    description: "Sync is set to Free at 1.6 Hz, so Recall ticks on its own clock rather than the song's, and each random T1 gate rings a bell whose pitch is read from X on its own X clock. Change Rate to speed the shimmer up or slow it down.",
    tags: ["free", "bells", "shimmer", "ambient"],
  });
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.3, trecall: 0.2, tloop: 16, gatelength: 0.3, xspread: 0.8, xbias: 0.55, xsteps: 0.4, xrecall: 0.2,
    xloop: 16, sync: "Free", rate: 1.6, xsource: "T1", xrange: "Wide", root: "C", scale: "Major Pentatonic", seed: 71 });
  const a = voice(p, [2, 0], [rc, "x1"], [rc, "t1"], { name: "Bell A", shape: 0, octave: 1, env: { decay: 1.8, sustain: 0, release: 1.5 } });
  const b = voice(p, [2, 2], [rc, "x2"], [rc, "t2"], { name: "Bell B", shape: 0, octave: 0, env: { decay: 2.2, sustain: 0, release: 1.8 } });
  const mix = bus(p, [5, 0], [{ node: a.out, jack: "l", level: -4, pan: 0.4 }, { node: b.out, jack: "l", level: -4, pan: -0.4 }], 3, "Bells");
  const v = p.add("reverb", [6, 0], { size: 0.85, decay: 8, mix: 0.45 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [coinDrums, ratchetBass, settleDown, sortedChords, driftingBells];
