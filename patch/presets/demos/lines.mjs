// Lines: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, voice, ampEnvelope } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A cell: [row, note, velocity, gate, effect, parameter] (effects 1 R, 2 S, 3 P, 4 T, 5 J, 6 K).
const cell = (row, note, vel = 0, gate = 0, fx = 0, fxp = 0) => [row, note, vel, gate, fx, fxp];
const pattern = (rows, tracks) => ({ rows, tracks: [0, 1, 2, 3].map((k) => tracks[k] || []) });
const songData = (patterns, order = [0]) => {
  const all = [...patterns];
  while (all.length < 16) all.push(pattern(16, []));
  return { pattern: 0, octave: 4, edit: 1, order, patterns: all };
};
/// Cells for a list of notes `step` rows apart (null rests).
const line = (notes, step = 1, start = 0, gate = 0, vel = 0) => notes.flatMap((x, i) => (x === null ? [] : [cell(start + i * step, x, vel, gate)]));
/// A track's mono outputs as the source for mono().
const track = (node, k, extra = {}) => ({ node, pitch: "pitch" + k, gate: "gate" + k, velocity: "velocity" + k, ...extra });

/// A polyphonic Voice Cell: two detuned oscillators through a low-pass, an amp envelope. `o` shapes it.
function polyVoice(name, o = {}) {
  const p = voice(name, {
    description: "Two detuned oscillators through a low-pass filter with an amp envelope: a simple polyphonic voice for the Lines demos.",
    tags: ["poly", "demo", "simple"],
    help: "A Dual Osc feeds a low-pass Filter and an amp envelope. The voice keeps its Filter open to the key, so higher notes stay bright.\n\n" +
      "Notes in, Out L/R. It is only a plain voice to hear the Lines chords with.\n\nTip: raise the release for pads, shorten it for plucks.",
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
function finish(p, at, { stereo = [], monos = [], levels = [], verb = {}, master = 4 } = {}) {
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

const bass16 = line([36, null, 36, null, 43, null, 36, 39, 36, null, 36, null, 46, 43, null, 41], 1, 0, 5);
const lead5 = line([72, 75, 79, 77, 74], 1, 0, 6);
const arp7 = line([60, 63, 67, 70, 67, 63, 65], 1, 0, 4);
const stab9 = line([48, null, 51, null, 55, null, null, 53, null], 1, 0, 5);

function driftingFour() {
  const p = patch("Lines: Drifting Four", {
    module: "lines", tempo: 104,
    description: "Four lines of 16, 5, 7 and 9 rows start together and slide against each other, so the bass, a lead, an arp and a stab only meet again after 5040 rows. The drift panel in the view shows each track's place. Change a track's Length or Speed to move the meeting point.",
    tags: ["drift", "polymetric", "four tracks", "minor"],
  });
  const s = p.add("lines", [0, 0], { length1: 16, length2: 5, length3: 7, length4: 9, scale: "Natural Minor", root: "A", octave2: 1, octave4: -1, gate: 0.5 }, { data: songData([pattern(16, [bass16, lead5, arp7, stab9])]) });
  const bass = mono(p, [1, 0], track(s, 1), { name: "Bass", osc: { shape: 0.4, octave: -1 }, env: { decay: 0.2, sustain: 0.4, release: 0.12 }, filter: { cutoff: 480, resonance: 0.25 } });
  const lead = mono(p, [1, 2], track(s, 2), { name: "Lead", osc: { shape: 0.75 }, env: { decay: 0.35, sustain: 0.15, release: 0.3 }, filter: { cutoff: 2600 } });
  const arp = mono(p, [1, 4], track(s, 3), { name: "Arp", osc: { shape: 0.3 }, env: { decay: 0.14, sustain: 0.05, release: 0.12 }, filter: { cutoff: 3500 } });
  const stab = mono(p, [1, 6], track(s, 4), { name: "Stab", osc: { shape: 0.9 }, env: { decay: 0.3, sustain: 0.05, release: 0.25 }, filter: { cutoff: 1200, resonance: 0.3 } });
  const d = beat(p, [4, 4], { style: "sparse", level: -10 });
  finish(p, [5, 0], { stereo: [{ node: d, from: ["outl", "outr"] }], monos: [{ node: bass.out }, { node: lead.out }, { node: arp.out }, { node: stab.out }], levels: [-4, -2, -8, -9, -9], verb: { size: 0.5, decay: 2, mix: 0.2 } });
  return p;
}

function ratchetSlide() {
  const p = patch("Lines: Ratchet and Slide", {
    module: "lines", tempo: 126,
    description: "A bass line that uses the effect column: slide cells tie notes together with a glide and retrigger cells split a row into quick repeats. A second track answers with probability cells, so it never plays quite the same bar. Edit the Fx column in the view.",
    tags: ["effects", "slide", "retrigger", "probability", "bass"],
  });
  const bassCells = [cell(0, 40, 115, 12), cell(2, 43, 0, 12, 2, 120), cell(3, 47, 0, 10, 2, 200), cell(4, 45, 0, 6, 1, 3), cell(6, 40, 0, 12), cell(8, 52, 100, 12, 2, 160),
    cell(10, 47, 0, 8, 2, 90), cell(12, 43, 0, 6, 1, 4), cell(14, 38, 0, 12, 2, 220)];
  const maybe = [1, 3, 5, 7, 9, 11, 13, 15].map((r, i) => cell(r, [76, 79, 83, 79, 76, 74, 79, 71][i], 80, 3, 3, [255, 150, 200, 110, 255, 120, 180, 90][i]));
  const s = p.add("lines", [0, 0], { length1: 16, length2: 16, scale: "Phrygian", root: "E", seed: 6 }, { data: songData([pattern(16, [bassCells, maybe])]) });
  const bass = mono(p, [1, 0], track(s, 1), { name: "Bass", osc: { shape: 0.2, octave: -1 }, env: { decay: 0.2, sustain: 0.6, release: 0.1 }, filter: { cutoff: 700, resonance: 0.35 } });
  const lead = mono(p, [1, 2], track(s, 2, { trigger: false }), { name: "Answer", osc: { shape: 0.85 }, env: { decay: 0.12, sustain: 0.05, release: 0.1 }, filter: { cutoff: 2800 } });
  const d = beat(p, [4, 2], { style: "four", level: -10 });
  finish(p, [5, 0], { stereo: [{ node: d, from: ["outl", "outr"] }], monos: [{ node: bass.out }, { node: lead.out }], levels: [-4, -2, -7], verb: { size: 0.35, decay: 1.2, mix: 0.12 } });
  return p;
}

function oddSpeeds() {
  const p = patch("Lines: Odd Speeds", {
    module: "lines", tempo: 92,
    description: "The same twelve-row length on four tracks, but at speeds of one, two thirds, three halves and three quarters: the tracks stay in a simple ratio and phase slowly against each other, like gears. Change one Speed and the whole weave shifts.",
    tags: ["speed", "ratios", "phasing", "gears"],
  });
  const s = p.add("lines", [0, 0], { speed1: "x1", speed2: "x2/3", speed3: "x3/2", speed4: "x3/4", length1: 12, length2: 12, length3: 12, length4: 12, scale: "Dorian", root: "D", gate: 0.5 },
    { data: songData([pattern(16, [line([50, 57, 53, 60], 3, 0, 8), line([74, 77, 76, 72, 69, 72], 2, 0, 6), line([62, 65, 69, 74, 69, 65], 2, 0, 3), line([86, null, 81, null, 77, null], 2, 0, 3)])]) });
  const a = mono(p, [1, 0], track(s, 1), { name: "Low", osc: { shape: 0.4, octave: -1 }, env: { attack: 0.01, decay: 0.5, sustain: 0.5, release: 0.4 }, filter: { cutoff: 600 } });
  const b = mono(p, [1, 2], track(s, 2), { name: "Mid", osc: { shape: 0.6 }, env: { decay: 0.35, sustain: 0.2, release: 0.3 }, filter: { cutoff: 2000 } });
  const c = mono(p, [1, 4], track(s, 3), { name: "Pluck", osc: { shape: 0.3 }, env: { decay: 0.15, sustain: 0.05, release: 0.15 }, filter: { cutoff: 3200 } });
  const e = mono(p, [1, 6], track(s, 4), { name: "Bell", osc: { shape: 0.1 }, env: { decay: 0.6, sustain: 0, release: 0.5 } });
  finish(p, [4, 2], { monos: [{ node: a.out }, { node: b.out }, { node: c.out }, { node: e.out }], levels: [-3, -4, -6, -10], verb: { size: 0.6, decay: 3, mix: 0.3 } });
  return p;
}

function orderList() {
  const p = patch("Lines: Order of Three", {
    module: "lines", tempo: 112,
    description: "Three patterns of 16, 16 and 32 rows run in an order list: a verse, a verse with a new bass note, and a long answer. Tracks restart with each pattern here (Tracks: Per pattern), so every section begins together; switch it to Free-run and the drift carries on.",
    tags: ["order list", "patterns", "song", "per pattern"],
  });
  const verse = pattern(16, [bass16, lead5, line([60, 63, 67, 63], 4, 0, 6)]);
  const verse2 = pattern(16, [bass16.map((c) => [c[0], c[1] + (c[0] > 7 ? 5 : 0), c[2], c[3], 0, 0]), line([79, 77, 75, 72, 74], 1, 0, 6), line([58, 62, 65, 62], 4, 0, 6)]);
  const answer = pattern(32, [line([34, null, null, null, 41, null, null, null, 39, null, null, null, 36, null, null, null], 2, 0, 12), line([84, 82, 79, 75, 77, 72, 70], 4, 0, 8), line([60, null, 63, null, 67, null, 70, null, 72, null], 3, 0, 6)]);
  const s = p.add("lines", [0, 0], { drift: "Per pattern", length1: 16, length2: 5, length3: 16, scale: "Natural Minor", root: "C" }, { data: songData([verse, verse2, answer], [0, 0, 1, 2]) });
  const bass = mono(p, [1, 0], track(s, 1), { name: "Bass", osc: { shape: 0.4, octave: -1 }, env: { decay: 0.2, sustain: 0.5, release: 0.12 }, filter: { cutoff: 520, resonance: 0.2 } });
  const lead = mono(p, [1, 2], track(s, 2), { name: "Lead", osc: { shape: 0.75 }, env: { decay: 0.3, sustain: 0.15, release: 0.3 }, filter: { cutoff: 2400 } });
  const keys = mono(p, [1, 4], track(s, 3), { name: "Keys", osc: { shape: 0.2 }, env: { decay: 0.4, sustain: 0.2, release: 0.3 }, filter: { cutoff: 2000 } });
  const d = beat(p, [4, 3], { style: "four", level: -10 });
  finish(p, [5, 0], { stereo: [{ node: d, from: ["outl", "outr"] }], monos: [{ node: bass.out }, { node: lead.out }, { node: keys.out }], levels: [-4, -2, -8, -9], verb: { size: 0.4, decay: 1.6, mix: 0.15 } });
  return p;
}

function threeTrackChords() {
  const p = patch("Lines: Chords from Three Tracks", {
    module: "lines", tempo: 80,
    description: "Tracks 1 to 3 each hold one voice of a chord at different lengths and speeds, and all three Notes outputs play one polyphonic Voice Cell: the harmony shifts as the three tracks drift. Track 4 adds a quiet high bell. Try the Quantize setting with another Scale.",
    tags: ["chords", "polyphonic", "notes out", "ambient"],
  });
  const s = p.add("lines", [0, 0], { speed1: "x1/2", speed2: "x1/2", speed3: "x1/3", rate: "1/8", length1: 8, length2: 6, length3: 5, length4: 7, scale: "Natural Minor", root: "F", gate: 1, quantize: "To scale" },
    { data: songData([pattern(16, [line([53, 56, 58, 60, 56, 55, 58, 53], 1, 0, 15), line([60, 63, 65, 67, 68, 65], 1, 0, 15), line([68, 72, 70, 67, 65], 1, 0, 15), line([84, null, 80, null, 77, null, 79], 1, 0, 6)])]) });
  const pad = putVoice(p, polyVoice("Drift Pad", { shapeA: 0.5, shapeB: 0.67, cutoff: 1300, env: { attack: 0.3, decay: 0.6, sustain: 0.8, release: 1.4 } }), [1, 0], "Drift Pad", "dp_");
  for (const k of [1, 2, 3]) p.cable(s, "notes" + k, pad, "notes");
  const bell = mono(p, [1, 3], track(s, 4), { name: "Bell", osc: { shape: 0.1 }, env: { decay: 0.7, sustain: 0, release: 0.6 } });
  finish(p, [4, 0], { stereo: [{ node: pad }], monos: [{ node: bell.out }], levels: [-6, -12], verb: { size: 0.75, decay: 4, mix: 0.35 } });
  return p;
}

export default [driftingFour(), ratchetSlide(), oddSpeeds(), orderList(), threeTrackChords()];
