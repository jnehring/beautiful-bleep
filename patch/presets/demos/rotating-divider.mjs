// SPDX-License-Identifier: MIT
// Rotating Div: five demo patches. Each plays by itself with the transport.
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

/// A kick, snare, hats, clap and cowbell on five rotating-divider outputs. Returns the stereo mix.
function perc(p, rd, at, jacks, o = {}) {
  const [c, r] = at;
  const kick = p.add("punch-kick", [c, r], { level: 0.85, ...(o.kick || {}) });
  const snare = p.add("punch-snare", [c, r + 1], { level: 0.6, ...(o.snare || {}) });
  const hats = p.add("punch-hats", [c, r + 2], { level: 0.42, closed: 0.04, ...(o.hats || {}) });
  const clap = p.add("punch-clap", [c, r + 3], { level: 0.5, ...(o.clap || {}) });
  const bell = p.add("ring-cowbell", [c + 1, r], { level: 0.4, decay: 0.25, ...(o.bell || {}) });
  p.cable(rd, jacks[0], kick, "trig").cable(rd, jacks[1], snare, "trig").cable(rd, jacks[2], hats, "closed").cable(rd, jacks[3], clap, "trig").cable(rd, jacks[4], bell, "trig");
  return bus(p, [c + 3, r], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -13, pan: 0.3 },
    { node: clap, level: -10, pan: -0.15 }, { node: bell, level: -13, pan: -0.4 }], o.master ?? 0, "Kit");
}

function shiftingDrums() {
  const p = patch("Rotating Div: Shifting Drum Roles", {
    module: "rotating-divider", tempo: 112,
    description: "A slow stepped LFO turns Rotate, so the same set of divisions moves from output to output: the part that was the kick becomes the hats, then the clap, and the groove reshapes every few bars. Turn Rotate by hand to hear one fixed arrangement, or set Rotate Sync to Next Bar to move on the downbeat.",
    tags: ["rotate", "drums", "shifting", "divisions"],
  });
  const rd = p.add("rotating-divider", [0, 0], { set: "Integers", rotate: 0, sync: "Next Bar", base: "1/16", output: "Trigger", rotatemode: "Wrap" });
  const lfo = p.add("lfo", [0, 3], { wave: "Random Step", sync: "2 bars", polarity: "Unipolar", seed: 9 }, { name: "Rotate LFO" });
  p.cable(lfo, "out", rd, "rotate", 0.4);
  const mix = perc(p, rd, [2, 0], ["out4", "out8", "out1", "out6", "out5"]);
  finish(p, mix, [6, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

function primeBells() {
  const p = patch("Rotating Div: Prime Bells", {
    module: "rotating-divider", tempo: 80,
    description: "The Primes set (2, 3, 5, 7, 11, 13 and on) rings eight soft bell tones, each on its own division, so they only coincide rarely and the texture keeps shifting. Change Rotate to give each bell a different, slower or faster clock without touching the tuning.",
    tags: ["primes", "bells", "ambient", "texture"],
  });
  const rd = p.add("rotating-divider", [0, 0], { set: "Primes", rotate: 0, base: "1/16", output: "Gate", width: 0.15 });
  const tones = [0, 4, 7, 12, -5, 9, 2, 11];
  const vs = tones.map((n, i) => voice(p, [2 + (i % 4) * 2, Math.floor(i / 4) * 2], null, [rd, `out${i + 1}`], { name: `Bell ${i + 1}`, shape: 0,
    osc: { coarse: n }, octave: i < 4 ? 1 : 0, env: { attack: 0.003, decay: 1.6, sustain: 0, release: 1.4 } }));
  const mix = bus(p, [11, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: -9, pan: -0.7 + i * 0.2 })), 1, "Bells");
  const v = p.add("reverb", [12, 0], { size: 0.85, decay: 7, mix: 0.4 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function powers() {
  const p = patch("Rotating Div: Powers of Two Groove", {
    module: "rotating-divider", tempo: 124,
    description: "With the Powers of 2 set (1, 2, 4, 8, 16, 32...) every output lands on a regular beat, giving a tidy four-to-the-floor skeleton of kick, claps and hats. Raise Rotate by one and each part jumps to the next division for an instant half-time or double-time feel.",
    tags: ["powers of two", "regular", "four on the floor", "rotate"],
  });
  const rd = p.add("rotating-divider", [0, 0], { set: "Powers of 2", rotate: 2, sync: "Next Bar", base: "1/16", output: "Trigger" });
  const mix = perc(p, rd, [2, 0], ["out1", "out2", "out5", "out4", "out7"], { hats: { tone: 0.6 }, snare: { level: 0.55 } });
  const bass = voice(p, [2, 5], null, [rd, "out3"], { name: "Bass", shape: 0.25, octave: -2, osc: { coarse: -5 }, env: { decay: 0.3, sustain: 0.2 },
    filter: { cutoff: 500, resonance: 0.3 } });
  const fin = p.add("audio-mixer", [6, 0], { level1: 0, level2: -8, master: 0 }, { name: "Final" });
  p.stereo(mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  both(p, bass.out, "l", fin, "in2l", "in2r");
  finish(p, fin, [7, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function staircase() {
  const p = patch("Rotating Div: Fibonacci Staircase", {
    module: "rotating-divider", tempo: 92,
    description: "The Stair output reads all eight gates as one binary number, a jumpy staircase that repeats with the pattern, and a Quantizer snaps it to a scale so the Fibonacci set (1, 2, 3, 5, 8...) writes a melody. Change the Quantizer's Scale, or Rotate, for a different tune from the same clocks.",
    tags: ["fibonacci", "stair", "melody", "quantizer"],
  });
  const rd = p.add("rotating-divider", [0, 0], { set: "Fibonacci", rotate: 0, base: "1/8", output: "Gate", width: 0.5 });
  const q = p.add("quantizer", [1, 0], { root: "D", scale: "Dorian", range: 1 });
  p.cable(rd, "stair", q, "in", 0.9);
  const lead = voice(p, [2, 0], [q, "out"], [rd, "out2"], { name: "Lead", shape: 0.4, octave: 0, env: { decay: 0.35, sustain: 0.1, release: 0.3 } });
  const lead2 = voice(p, [2, 3], [q, "out"], [rd, "out4"], { name: "Echo Voice", shape: 0.2, octave: -1, env: { decay: 0.5, sustain: 0.15, release: 0.5 } });
  const kick = p.add("punch-kick", [2, 6], { level: 0.7 });
  p.cable(rd, "out1", kick, "trig");
  const mix = bus(p, [5, 0], [{ node: lead.out, jack: "l", level: -2, pan: 0.2 }, { node: lead2.out, jack: "l", level: -3, pan: -0.25 }, { node: kick, level: -7 }], 1, "Mix");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.35, mix: 0.25, highcut: 6000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.5, decay: 2.2, mix: 0.2 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

function extended() {
  const p = patch("Rotating Div: Extending Evens", {
    module: "rotating-divider", tempo: 106,
    description: "In Extend mode, Rotate does not wrap around the set but continues it, so with the Evens set each turn of the knob brings in longer divisions (2, 4, 6... then 18, 20 and beyond). A slow sawtooth LFO turns Rotate up through the bars, thinning the hats and claps out as it climbs.",
    tags: ["evens", "extend", "sweep", "thinning"],
  });
  const rd = p.add("rotating-divider", [0, 0], { set: "Evens", rotatemode: "Extend", sync: "Next Bar", rotate: 0, base: "1/16", output: "Trigger" });
  const lfo = p.add("lfo", [0, 3], { wave: "Saw Up", sync: "8 bars", polarity: "Unipolar" }, { name: "Climb" });
  p.cable(lfo, "out", rd, "rotate", 0.5);
  const mix = perc(p, rd, [2, 0], ["out4", "out8", "out1", "out3", "out2"], { master: 0 });
  finish(p, mix, [6, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

export default [shiftingDrums, primeBells, powers, staircase, extended];
