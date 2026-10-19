// Melody Mirror: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A Step Sequencer playing a phrase and then resting: `notes` as in steps(), padded with rests to 32 steps.
function phrase(p, at, notes, knobs = {}, vel) {
  const all = notes.concat(new Array(Math.max(0, 32 - notes.length)).fill("."));
  return p.add("step-sequencer", at, { length: 32, rate: "1/8", gatelength: 0.55, root: "A", scale: "Minor Pentatonic", octave: 0, ...knobs },
    { data: steps(all, vel) });
}

/// Notes in → pitch/gate/velocity → Oscillator → ADSR → VCA (→ Filter). Returns {out, ntc, osc, env, amp}.
function mono(p, at, src, o = {}) {
  const [c, r] = at;
  const ntc = p.add("notes-to-cv", [c, r], { retrigger: "On", ...(o.ntc || {}) });
  const osc = p.add("oscillator", [c + 1, r], { shape: 0.8, ...(o.osc || {}) }, { name: o.name || "Voice" });
  const env = p.add("adsr", [c + 1, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.25, ...(o.env || {}) }, { name: "Voice Env" });
  const amp = p.add("vca", [c + 2, r], {}, { name: "Voice VCA" });
  p.cable(src.node, src.jack || "notes", ntc, "notes").cable(ntc, "pitch", osc, "pitch").cable(ntc, "gate", env, "gate")
    .cable(ntc, "trigger", env, "retrig").cable(ntc, "velocity", env, "velocity").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  let out = amp, jack = "l";
  if (o.filter) {
    out = p.add("filter", [c + 3, r], o.filter, { name: "Voice Filter" });
    p.cable(amp, "l", out, "l");
  }
  return { out, jack: o.filter ? "l" : jack, ntc, osc, env, amp };
}

/// Mono audio → Level → (Delay) → Reverb → Out 1/2.
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

function backwardsTune() {
  const p = patch("Melody Mirror: Backwards Tune", {
    module: "melody-mirror", tempo: 100,
    description: "A pentatonic phrase plays once every four bars; a beat after its last note the Mirror answers with the same notes played backwards, rhythm included. Change Length to turn more or fewer notes around, or Speed to play the reply slower.",
    tags: ["reverse", "retrograde", "phrase", "reply"],
  });
  const s = phrase(p, [0, 0], [0, 3, 5, 7, 5, 10, 7, 12]);
  const m = p.add("melody-mirror", [2, 0], { mode: "Reverse", length: 8, start: "After Gap", gap: "1 beat" });
  p.cable(s, "notes", m, "notes");
  const v = mono(p, [4, 0], { node: m }, { osc: { shape: 0.55 }, env: { decay: 0.35, sustain: 0.1, release: 0.3 }, filter: { cutoff: 2800, resonance: 0.15 } });
  withBeat(p, [8, 0], v.out, v.jack, "sparse", { lead: 1, verb: { size: 0.5, decay: 2.5, mix: 0.25 } });
  return p;
}

function upsideDown() {
  const p = patch("Melody Mirror: Upside Down", {
    module: "melody-mirror", tempo: 108,
    description: "The phrase is mirrored in pitch around its first note and pulled into A minor pentatonic, so the reply climbs where the original fell. Turn Axis to Mean or Fixed to move the mirror, and Transpose to lift the reply.",
    tags: ["invert", "axis", "scale", "counter-melody"],
  });
  const s = phrase(p, [0, 0], [12, 10, 7, 5, 7, 3, 0, 3], { rate: "1/8" });
  const m = p.add("melody-mirror", [2, 0], { mode: "Invert", length: 8, axismode: "First Note", gap: "1 beat", snap: "On", root: "A", scale: "Minor Pentatonic", transpose: 12 });
  p.cable(s, "notes", m, "notes");
  const v = mono(p, [4, 0], { node: m }, { osc: { shape: 0.2 }, env: { decay: 0.5, sustain: 0.05, release: 0.5 } });
  space(p, [8, 0], v.out, v.jack, { level: 4, delay: { zone: 3, time: 0.375, feedback: 0.4, mix: 0.3 }, verb: { size: 0.6, decay: 3, mix: 0.3 } });
  return p;
}

function callAndResponse() {
  const p = patch("Melody Mirror: Call And Response", {
    module: "melody-mirror", tempo: 112,
    description: "Answer mode: the module listens to the phrase, waits for the pause, plays the mirror image as a reply and listens again, ignoring itself while it answers. Try Reply Invert or Rotate, or a longer Gap.",
    tags: ["answer", "call and response", "mirror", "groove"],
  });
  const s = phrase(p, [0, 0], [0, 7, 5, 3, 7, 5, 3, 0], { rate: "1/8", octave: 0 });
  const m = p.add("melody-mirror", [2, 0], { mode: "Answer", reply: "Mirror", length: 8, gap: "1 beat" });
  p.cable(s, "notes", m, "notes");
  const v = mono(p, [4, 0], { node: m }, { osc: { shape: 0.85 }, env: { decay: 0.2, sustain: 0.3, release: 0.1 }, filter: { cutoff: 1500, resonance: 0.3 } });
  withBeat(p, [8, 0], v.out, v.jack, "half", { lead: -1, verb: { size: 0.4, decay: 1.5, mix: 0.15 } });
  return p;
}

function turnedMotif() {
  const p = patch("Melody Mirror: Turned Motif", {
    module: "melody-mirror", tempo: 92,
    description: "A four-note motif comes back with its pitches rotated two places along the same rhythm, so it sounds related but different. Change Rotate, or Mode to Mirror, to turn it another way.",
    tags: ["rotate", "motif", "variation", "pluck"],
  });
  const s = phrase(p, [0, 0], [0, 7, 3, 5], { rate: "1/4", octave: 0 });
  const m = p.add("melody-mirror", [2, 0], { mode: "Rotate", length: 4, rotate: 2, gap: "1/2 beat" });
  p.cable(s, "notes", m, "notes");
  const v = mono(p, [4, 0], { node: m }, { osc: { shape: 0.4 }, env: { decay: 0.6, sustain: 0, release: 0.5 }, filter: { cutoff: 3200 } });
  space(p, [8, 0], v.out, v.jack, { level: 5, delay: { zone: 4, time: 0.5, feedback: 0.45, mix: 0.3, tone: -0.2 }, verb: { size: 0.8, decay: 5, mix: 0.35 } });
  return p;
}

function wanderingTurns() {
  const p = patch("Melody Mirror: Wandering Turns", {
    module: "melody-mirror", tempo: 104,
    description: "A slow LFO sweeps the Mode knob, so each reply is a different turn of the phrase: reversed, inverted, rotated or mirrored. Patch your own modulation into Mode, or set Start to Trigger to play replies by hand.",
    tags: ["modulation", "mode", "generative", "variation"],
  });
  const s = phrase(p, [0, 0], [0, 5, 7, 12, 10, 7, 3, 5], { rate: "1/8" });
  const lfo = p.add("lfo", [1, 2], { rate: 0.04, wave: "Triangle", polarity: "Unipolar" }, { name: "Mode LFO" });
  const m = p.add("melody-mirror", [2, 0], { mode: "Reverse", length: 8, gap: "1 beat", snap: "On", root: "A", scale: "Minor Pentatonic" });
  p.cable(s, "notes", m, "notes").cable(lfo, "out", m, "mode", 0.8);
  const v = mono(p, [4, 0], { node: m }, { osc: { shape: 0.7 }, env: { decay: 0.3, sustain: 0.15, release: 0.2 }, filter: { cutoff: 2200, resonance: 0.2 } });
  withBeat(p, [8, 0], v.out, v.jack, "shuffle", { lead: 0, verb: { size: 0.5, decay: 2.2, mix: 0.2 } });
  return p;
}

export default [backwardsTune, upsideDown, callAndResponse, turnedMotif, wanderingTurns];
