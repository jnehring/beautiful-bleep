// XY Pad: five demo patches. Each plays by itself with the transport.
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

function filterPlane() {
  const p = patch("XY Pad: Filter Plane", {
    module: "xy-pad", tempo: 112,
    description: "The pad's X axis drives the cutoff and its Y axis the resonance of a saw bass, so dragging across the pad goes from dull to bright and up from smooth to squelchy. Drag the dot around while the groove runs.",
    tags: ["filter", "resonance", "bass", "two axes"],
  });
  const s = sq(p, [0, 0], [0, 0, ".", 12, 0, ".", 10, 7], { rate: "1/16", root: "F", scale: "Dorian", octave: -2, gatelength: 0.5 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.95 }, env: { decay: 0.2, sustain: 0.4, release: 0.08 }, filter: { cutoff: 250, resonance: 0.2 } });
  const xy = p.add("xy-pad", [1, 2], { x: 0.45, y: 0.3, smooth: 0.05 }, { name: "Filter Pad" });
  p.cable(xy, "x", v.filter, "cutoff", 0.6).cable(xy, "y", v.filter, "resonance", 0.5);
  withBeat(p, [3, 0], v.out, "l", "four", { lead: -5 });
  return p;
}

function echoRoom() {
  const p = patch("XY Pad: Echo Room", {
    module: "xy-pad", tempo: 96,
    description: "X sets how much echo you hear and Y how many repeats it feeds back on a bell melody, so the bottom left is dry and the top right is a cloud of repeating notes. Try dragging along the edges to change only one thing at a time.",
    tags: ["delay", "feedback", "mix", "bells"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 9, 4, 7, "."], { rate: "1/8", shape: 0.2, root: "G", scale: "Major Pentatonic", env: { decay: 0.4, sustain: 0, release: 0.3 }, gatelength: 0.3 });
  const d = p.add("zone-delay", [3, 0], { zone: 3, time: 0.45, feedback: 0.4, mix: 0.3, tone: -0.2 });
  const v = p.add("reverb", [4, 0], { size: 0.5, decay: 2.4, mix: 0.2 });
  const xy = p.add("xy-pad", [3, 2], { x: 0.4, y: 0.4, smooth: 0.1 }, { name: "Echo Pad" });
  p.cable(m.amp, "l", d, "l").cable(m.amp, "l", d, "r").stereo(d, v).stereo(v, p.out)
    .cable(xy, "x", d, "mix", 0.7).cable(xy, "y", d, "feedback", 0.7);
  return p;
}

function timbreMap() {
  const p = patch("XY Pad: Timbre Map", {
    module: "xy-pad", tempo: 88,
    description: "X morphs the oscillator through its waveforms and Y changes its pulse width, so each corner of the pad is a different voice for the same slow tune. Park the dot in a corner or move it while the notes sound.",
    tags: ["timbre", "oscillator", "shape", "morph"],
  });
  const s = sq(p, [0, 0], [0, 3, 7, 10, 12, 10, 7, 3], { rate: "1/8", root: "B", scale: "Natural Minor", octave: -1, gatelength: 0.7 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.3, pw: 0.5 }, env: { attack: 0.02, decay: 0.4, sustain: 0.5, release: 0.3 }, filter: { cutoff: 3200 } });
  const xy = p.add("xy-pad", [1, 2], { x: 0.4, y: 0.5, smooth: 0.08 }, { name: "Timbre Pad" });
  p.cable(xy, "x", v.osc, "shape", 0.8).cable(xy, "y", v.osc, "pw", 0.6);
  space(p, [4, 0], v.out, "l", { delay: { zone: 3, time: 0.4, feedback: 0.35, mix: 0.25 }, verb: { size: 0.5, decay: 2.5, mix: 0.25 } });
  return p;
}

function variationField() {
  const p = patch("XY Pad: Variation Field", {
    module: "xy-pad", tempo: 118,
    description: "X controls the sequencer's Variation, the chance that notes are shifted away from the programmed ones, and Y its Gate Length, so you can shake up the tune and make it shorter or smoother at the same time. Park the pad low-left for the plain tune.",
    tags: ["variation", "gate length", "sequencer", "generative"],
  });
  const s = sq(p, [0, 0], [0, 3, 7, 3, 12, 7, 3, 5], { rate: "1/16", root: "A", scale: "Minor Pentatonic", varrange: 12, gatelength: 0.4 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.75 }, env: { decay: 0.2, sustain: 0.3, release: 0.15 }, filter: { cutoff: 2000, resonance: 0.2 } });
  const xy = p.add("xy-pad", [0, 2], { x: 0.2, y: 0.3, smooth: 0.05 }, { name: "Variation Pad" });
  p.cable(xy, "x", s, "variation", 0.7).cable(xy, "y", s, "gatelength", 0.6);
  withBeat(p, [3, 0], v.out, "l", "broken", { lead: 3 });
  return p;
}

function bipolarRange() {
  const p = patch("XY Pad: Bipolar Range", {
    module: "xy-pad", tempo: 84,
    description: "Min and Max are set to -1 and +1, so the pad's centre is zero: X bends the pitch a little either way and Y pushes the filter above or below its starting point. Narrow Min and Max for gentler moves.",
    tags: ["bipolar", "pitch", "min max", "centre"],
  });
  const s = sq(p, [0, 0], [0, ".", 7, ".", 3, ".", 10, 5], { rate: "1/8", root: "E", scale: "Natural Minor", octave: -1, gatelength: 0.8 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.7 }, env: { attack: 0.02, decay: 0.5, sustain: 0.4, release: 0.4 }, filter: { cutoff: 900, resonance: 0.25 } });
  const xy = p.add("xy-pad", [1, 2], { x: 0.5, y: 0.5, min: -1, max: 1, smooth: 0.1 }, { name: "Centre Pad" });
  p.cable(xy, "x", v.osc, "fine", 0.25).cable(xy, "y", v.filter, "cutoff", 0.35);
  space(p, [4, 0], v.out, "l", { delay: { zone: 3, time: 0.5, feedback: 0.4, mix: 0.25 }, verb: { size: 0.55, decay: 3, mix: 0.3 } });
  return p;
}

export default [filterPlane, echoRoom, timbreMap, variationField, bipolarRange];
