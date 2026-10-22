// Roll: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, voice, ampEnvelope } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

const T = 96;
/// A note: [start, length, pitch, velocity, chance, ratchet], start and length in beats.
const n = (b, l, p, v = 100, pr = 100, r = 1) => [Math.round(b * T), Math.max(1, Math.round(l * T)), p, v, pr, r];
const slot = (bars, notes, loop) => ({ bars, loop: loop || [0, bars * 4 * T], notes });
const rollData = (slots, extra = {}) => {
  const all = [...slots];
  while (all.length < 8) all.push(slot(2, []));
  return { slot: 0, grid: 24, ghost: true, slots: all, ...extra };
};
const chord = (beat0, len, pitches, vel = 90) => pitches.map((p, i) => n(beat0, len, p, vel - i * 4));

/// A polyphonic Voice Cell: two detuned oscillators through a low-pass, an amp envelope. `o` shapes it.
function polyVoice(name, o = {}) {
  const p = voice(name, {
    description: "Two detuned oscillators through a low-pass filter with an amp envelope: a simple polyphonic voice for the Roll demos.",
    tags: ["poly", "demo", "simple"],
    help: "A Dual Osc feeds a low-pass Filter and an amp envelope. The voice keeps its Filter open to the key, so higher notes stay bright.\n\n" +
      "Notes in, Out L/R. It is only a plain voice to hear the Roll's chords with.\n\nTip: raise the release for pads, shorten it for plucks.",
  }).settings({ voices: 8, spread: 0.35 });
  const osc = p.add("dual-osc", [0, 0], { shapeA: o.shapeA ?? 0.67, shapeB: o.shapeB ?? 0.67, fineB: 7, balance: 0.5, drift: 0.15, ...(o.osc || {}) });
  const flt = p.add("filter", [1, 0], { cutoff: o.cutoff ?? 1800, resonance: 0.15, keytrack: 0.5, type: "Ladder Tanh", ...(o.filter || {}) });
  p.cable(p.vin, "pitch", osc, "pitch").stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], o.env || { attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.5 });
  return p;
}

/// Puts a finished Voice Cell preset on the patch; `prefix` keeps the ids of two voices apart. Returns its node.
function putVoice(p, inner, at, name, prefix) {
  const doc = inner.build("");
  const map = new Map(doc.nodes.map((x) => [x.id, prefix + x.id]));
  for (const x of JSON.parse(JSON.stringify(doc.nodes))) {
    const isRoot = x.id === doc.root;
    x.id = map.get(x.id);
    x.parent = isRoot ? "" : map.get(x.parent);
    if (isRoot) { x.x = 40 + (at[0] + 1) * 300; x.y = 40 + at[1] * 220; x.name = name; }
    p.ids.add(x.id);
    p.nodes.push(x);
  }
  for (const c of doc.cables) p.cables.push({ ...c, id: prefix + c.id, from: { ...c.from, node: map.get(c.from.node) }, to: { ...c.to, node: map.get(c.to.node) } });
  return p.nodes.find((x) => x.id === map.get(doc.root));
}

/// Oscillator → ADSR → VCA from a pitch and gate source ({node, pitch, gate, trigger, velocity}), optional filter after.
function mono(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch, osc, "pitch").cable(src.node, src.gate, env, "gate");
  if (src.trigger) p.cable(src.node, src.trigger, env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Stereo sources (nodes with l/r or outl/outr) and mono sources into one mixer → reverb → Out 1/2.
function finish(p, at, { stereo = [], monos = [], levels = [], verb = {}, master = -2 } = {}) {
  const [c, r] = at;
  if (stereo.length + monos.length > 4) {  // more than four channels: the mono voices go through a mixer of their own first
    const sub = p.add("audio-mixer", [c - 1, r + 1], { master: 0, limiter: true, ...Object.fromEntries(monos.map((m, i) => ["level" + (i + 1), levels[stereo.length + i] ?? -3])) }, { name: "Voices" });
    monos.forEach((m, i) => p.cable(m.node, m.jack || "l", sub, "in" + (i + 1) + "l").cable(m.node, m.jack || "l", sub, "in" + (i + 1) + "r"));
    stereo = [...stereo, { node: sub, from: ["outl", "outr"] }];
    levels = [...levels.slice(0, stereo.length - 1), 0];
    monos = [];
  }
  const values = { master, limiter: true };
  stereo.forEach((s, i) => (values["level" + (i + 1)] = levels[i] ?? -3));
  monos.forEach((m, i) => (values["level" + (stereo.length + i + 1)] = levels[stereo.length + i] ?? -3));
  const mix = p.add("audio-mixer", [c, r], values, { name: "Mix" });
  stereo.forEach((s, i) => p.stereo(s.node, mix, { from: s.from || ["l", "r"], to: ["in" + (i + 1) + "l", "in" + (i + 1) + "r"] }));
  monos.forEach((m, i) => {
    const k = stereo.length + i + 1;
    p.cable(m.node, m.jack || "l", mix, "in" + k + "l").cable(m.node, m.jack || "l", mix, "in" + k + "r");
  });
  const v = p.add("reverb", [c + 1, r], { size: 0.5, decay: 1.8, mix: 0.22, ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return { mix, verb: v };
}

// ------------------------------------------------------------ patches

const progression = [
  chord(0, 3.8, [57, 60, 64, 67]),
  chord(4, 3.8, [53, 57, 60, 64]),
  chord(8, 3.8, [48, 52, 55, 59]),
  chord(12, 3.8, [55, 59, 62, 65]),
].flat();

function chordStack() {
  const p = patch("Roll: Chord Stack", {
    module: "roll", tempo: 84,
    description: "Four overlapping chords drawn on a four-bar roll play a Voice Cell as a pad, while the Low Pitch and Low Gate outputs pick out the lowest note of each chord for a bass. Open the roll and drag a note to change a chord.",
    tags: ["chords", "polyphonic", "bass", "low output"],
  });
  const roll = p.add("roll", [0, 0], { humanise: 0.2, scale: "Natural Minor", root: "A" }, { data: rollData([slot(4, progression)]) });
  const pad = putVoice(p, polyVoice("Stack Pad", { cutoff: 1500, env: { attack: 0.08, decay: 0.5, sustain: 0.7, release: 0.9 } }), [1, 0], "Pad", "pd_");
  p.cable(roll, "notes", pad, "notes");
  const bass = mono(p, [1, 2], { node: roll, pitch: "lowpitch", gate: "lowgate", velocity: "velocity" }, { name: "Bass", osc: { shape: 0.4, octave: -1 }, env: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.3 }, filter: { cutoff: 420, resonance: 0.2 } });
  const d = beat(p, [4, 2], { style: "half", level: -10 });
  finish(p, [4, 0], { stereo: [{ node: pad }, { node: d, from: ["outl", "outr"] }], monos: [{ node: bass.out }], levels: [-6, -4, -4], master: 4, verb: { size: 0.6, decay: 2.4, mix: 0.25 } });
  return p;
}

const callA = [], callB = [];
{
  const a = [69, 72, 76, 81, 76, 72, 69, 64], b = [67, 71, 74, 79, 74, 71, 67, 62];
  a.forEach((x, i) => callA.push(n(i * 0.5, 0.42, x, i % 4 === 0 ? 105 : 80)));
  b.forEach((x, i) => callB.push(n(i * 0.5 + 0.25, 0.3, x + 5, i % 2 ? 90 : 75)));
  callB.push(n(0, 0.2, 40, 70), n(2, 0.2, 43, 70));
}

function morphDrift() {
  const p = patch("Roll: Morph Drift", {
    module: "roll", tempo: 108,
    description: "Slot 1 is a steady eighth-note arp, slot 2 an offbeat line with a few extra notes. A slow LFO turns Morph so the arp bends note by note into the other pattern and back; the spare notes fade in and out. Set Morph by hand to freeze a blend.",
    tags: ["morph", "slots", "lfo", "arpeggio"],
  });
  const roll = p.add("roll", [1, 0], { morph: 0.5, morphto: 2, length: 0.8, scale: "Minor Pentatonic", root: "A", seed: 5 }, { data: rollData([slot(1, callA), slot(1, callB)]) });
  const lfo = p.add("lfo", [0, 0], { rate: 0.06, wave: "Triangle" }, { name: "Morph LFO" });
  p.cable(lfo, "out", roll, "morph", 0.5);
  const v = putVoice(p, polyVoice("Pluck", { shapeA: 0.4, shapeB: 0.9, cutoff: 2600, env: { attack: 0.003, decay: 0.28, sustain: 0.1, release: 0.25 } }), [2, 0], "Pluck", "pl_");
  p.cable(roll, "notes", v, "notes");
  const d = beat(p, [2, 2], { style: "broken", level: -9 });
  const { verb } = finish(p, [4, 0], { stereo: [{ node: v }, { node: d, from: ["outl", "outr"] }], levels: [-2, -3], master: 6, verb: { mix: 0.2 } });
  return p;
}

const ratchets = [
  n(0, 0.5, 69, 100, 100, 3), n(0.5, 0.5, 72, 80, 70), n(1, 0.5, 76, 95, 100, 2), n(1.5, 0.5, 74, 70, 50), n(2, 1, 72, 100, 100, 4),
  n(3, 0.5, 69, 85, 80, 2), n(3.5, 0.5, 67, 75, 60),
  n(4, 0.5, 64, 100, 100, 2), n(4.5, 0.5, 67, 80, 60), n(5, 0.5, 69, 95, 100, 3), n(5.5, 0.5, 72, 70, 40), n(6, 1, 76, 100, 100, 6),
  n(7, 0.5, 74, 80, 70, 2), n(7.5, 0.5, 72, 75, 50),
];

function ratchetChance() {
  const p = patch("Roll: Ratchet and Chance", {
    module: "roll", tempo: 118,
    description: "Every note of this two-bar line has its own ratchet count and chance, so some notes split into quick repeats and others play only now and then. Seed changes which ones sound; Humanise adds a loose feel.",
    tags: ["ratchet", "chance", "seed", "lead"],
  });
  const roll = p.add("roll", [0, 0], { length: 0.9, humanise: 0.3, seed: 11, scale: "Minor Pentatonic", root: "A" }, { data: rollData([slot(2, ratchets)]) });
  const lead = mono(p, [1, 0], { node: roll, pitch: "lastpitch", gate: "lastgate", trigger: "trigger", velocity: "velocity" }, { name: "Lead", osc: { shape: 0.85 }, env: { decay: 0.16, sustain: 0.1, release: 0.12 }, filter: { cutoff: 2800, resonance: 0.25 } });
  const d = beat(p, [1, 3], { style: "broken", level: -9 });
  const dly = p.add("zone-delay", [3, 0], { zone: 3, time: 0.32, feedback: 0.35, mix: 0.25 });
  const m = p.add("audio-mixer", [2, 0], { level1: 0, master: 0, limiter: true }, { name: "Level" });
  p.cable(lead.out, "l", m, "in1l");
  p.stereo(m, dly, { from: ["outl", "outr"] });
  const { mix } = finish(p, [5, 0], { stereo: [{ node: dly }, { node: d, from: ["outl", "outr"] }], levels: [0, -4], master: 5, verb: { size: 0.4, decay: 1.4, mix: 0.15 } });
  return p;
}

const twoLines = [];
{
  const low = [45, 45, 52, 48, 43, 43, 50, 47], high = [76, 79, 81, 79, 74, 77, 79, 77];
  low.forEach((x, i) => twoLines.push(n(i * 1, 1.0, x, 100)));
  high.forEach((x, i) => twoLines.push(n(i * 1 + 0.5, 0.45, x, 85)));
  twoLines.push(n(0, 8, 64, 55), n(8, 8, 62, 55));
}

function lowAndHigh() {
  const p = patch("Roll: Low and High", {
    module: "roll", tempo: 100,
    description: "One pattern with a bass line, a lead above it and a long held note between: the Low outputs play a bass voice and the High outputs a lead, while Notes plays a soft pad with all of it. Move a note across and it changes hands.",
    tags: ["low", "high", "split", "polyphonic"],
  });
  const roll = p.add("roll", [0, 0], { scale: "Natural Minor", root: "A", length: 0.9 }, { data: rollData([slot(4, twoLines.concat(twoLines.map((x) => [x[0] + 8 * T, x[1], x[2], x[3], x[4], x[5]])))]) });
  const bass = mono(p, [1, 0], { node: roll, pitch: "lowpitch", gate: "lowgate", velocity: "velocity" }, { name: "Bass", osc: { shape: 0.3, octave: -1 }, env: { decay: 0.25, sustain: 0.5, release: 0.15 }, filter: { cutoff: 380, resonance: 0.3 } });
  const lead = mono(p, [1, 3], { node: roll, pitch: "highpitch", gate: "highgate", velocity: "velocity" }, { name: "Lead", osc: { shape: 0.7 }, env: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.3 }, filter: { cutoff: 3000 } });
  const pad = putVoice(p, polyVoice("Soft Pad", { cutoff: 900, env: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 1.2 } }), [1, 5], "Soft Pad", "sp_");
  p.cable(roll, "notes", pad, "notes");
  finish(p, [4, 1], { stereo: [{ node: pad }], monos: [{ node: bass.out }, { node: lead.out }], levels: [-12, -3, -9], master: 3, verb: { size: 0.5, decay: 2, mix: 0.25 } });
  return p;
}

const longPad = [
  chord(0, 7.6, [52, 59, 64, 67]), n(1.5, 6, 71, 60), n(3, 5, 74, 55),
  chord(8, 7.6, [48, 55, 60, 64]), n(9.5, 6, 67, 60), n(11, 5, 71, 55),
  chord(16, 7.6, [45, 52, 57, 60]), n(17.5, 6, 64, 60), n(19, 5, 69, 55),
  chord(24, 7.6, [47, 54, 59, 62]), n(25.5, 6, 66, 60), n(27, 5, 71, 55),
].flat();
{
  // a slow shimmer over the top: sparse notes with a low chance
  [76, 79, 83, 79, 74, 78, 81, 78].forEach((x, i) => longPad.push(n(i * 4 + 2, 1.5, x, 45, 60, 2)));
}

function eightBars() {
  const p = patch("Roll: Slow Eight Bars", {
    module: "roll", tempo: 72,
    description: "Long overlapping notes make an eight-bar drone chord progression, and a few quiet notes with ratchets and a chance of sounding sparkle on top. Everything starts a little apart thanks to Humanise. Draw a note to add your own.",
    tags: ["ambient", "long", "drone", "humanise"],
  });
  const roll = p.add("roll", [0, 0], { humanise: 0.6, length: 1, scale: "Natural Minor", root: "E", seed: 4 }, { data: rollData([slot(8, longPad)]) });
  const pad = putVoice(p, polyVoice("Wide Pad", { shapeA: 0.5, shapeB: 0.8, cutoff: 1100, env: { attack: 1.2, decay: 1, sustain: 0.85, release: 2.4 } }), [1, 0], "Wide Pad", "wp_");
  p.cable(roll, "notes", pad, "notes");
  finish(p, [3, 0], { stereo: [{ node: pad }], levels: [-1], master: 6, verb: { size: 0.85, decay: 6, mix: 0.4 } });
  return p;
}

export default [chordStack(), morphDrift(), ratchetChance(), lowAndHigh(), eightBars()];
