// Stage Seq: five demo patches. Each plays by itself with the transport.
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

/// Stage Seq stages: [semitones, pulses, gate, opts]; gate is Rest/First/Every/Hold/Ratchet,
/// opts {r: ratchets, slide, accent, v: velocity}.
const GATES = ["Rest", "First", "Every", "Hold", "Ratchet"];
function stages(list) {
  return {
    stages: list.map(([pitch, n, g, o = {}]) => ({ p: pitch, n, g: GATES.indexOf(g), r: o.r || 2, s: o.slide ? 1 : 0, v: o.v || 100, a: o.accent ? 1 : 0 })),
    randomize: { lanes: ["pitch", "pulses", "gate"], octaves: 1, maxPulses: 4, slide: 0.15, accent: 0.15 },
  };
}

function heldPulses() {
  const p = patch("Stage Seq: Held Pulses", {
    module: "stage-sequencer", tempo: 84,
    description: "Each stage holds its note for a different number of pulses, from one to six, so a slow pad-like line in Eb Lydian lingers on some notes and moves quickly past others. Change a stage's Pulses in the view to stretch or squeeze the phrase.",
    tags: ["pulses", "hold", "pad", "lydian"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.9, stages: 6, rate: "1/8", root: "D#", scale: "Lydian" }, {
    data: stages([[0, 6, "Hold"], [7, 3, "Hold"], [4, 1, "Every"], [11, 4, "Hold"], [9, 2, "Hold"], [7, 6, "Hold"]]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.4 }, env: { attack: 0.08, decay: 0.5, sustain: 0.7, release: 0.8 }, filter: { cutoff: 1800 } });
  space(p, [4, 0], v.out, "l", { level: 4, delay: { zone: 3, time: 0.5, feedback: 0.4, mix: 0.25, tone: -0.2 }, verb: { size: 0.75, decay: 6, mix: 0.4 } });
  return p;
}

function gateModes() {
  const p = patch("Stage Seq: Gate Modes", {
    module: "stage-sequencer", tempo: 112,
    description: "Eight stages that each use a different gate mode: a single First hit, notes that repeat on Every pulse, a long Hold, a Ratchet burst and a Rest, so one riff shows all the ways a stage can fire. Click a stage's gate mode in the view to change it.",
    tags: ["gate modes", "ratchet", "rests", "riff"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.45, stages: 8, rate: "1/16", root: "A", scale: "Minor Pentatonic" }, {
    data: stages([[0, 3, "First"], [0, 3, "Every"], [7, 4, "Hold"], [5, 2, "Rest"], [3, 3, "Ratchet", { r: 3 }], [7, 2, "Every"], [10, 4, "First", { accent: true }], [12, 2, "Ratchet", { r: 4 }]]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.8 }, env: { decay: 0.18, sustain: 0.25, release: 0.12 }, filter: { cutoff: 2200, resonance: 0.25 } });
  withBeat(p, [3, 0], v.out, "l", "broken", { lead: 5 });
  return p;
}

function slideBass() {
  const p = patch("Stage Seq: Slide Bass", {
    module: "stage-sequencer", tempo: 122,
    description: "Stages marked Slide glide into the next pitch over the Slide Time, and the accented stages fire an extra gate that snaps the filter open, giving a squelchy bass over a four-on-the-floor beat. Raise Slide Time for slower glides or Accent for a harder bite.",
    tags: ["slide", "accent", "acid", "bass"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.6, slidetime: 0.09, accent: 0.7, stages: 8, rate: "1/16", root: "C", scale: "Phrygian Dominant", octave: -2 }, {
    data: stages([[0, 2, "Hold", { accent: true, v: 115 }], [0, 1, "Every", { v: 80 }], [7, 2, "Hold", { slide: true }], [12, 1, "Every", { v: 85 }], [10, 2, "Hold", { slide: true, accent: true, v: 110 }], [8, 1, "Every", { v: 80 }], [7, 3, "Hold", { slide: true }], [3, 1, "Every", { v: 90 }]]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.97 }, env: { decay: 0.2, sustain: 0.6, release: 0.07 }, filter: { cutoff: 350, resonance: 0.45, drive: 0.25 } });
  const ae = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.2, sustain: 0, release: 0.1 }, { name: "Accent Env" });
  p.cable(seq, "accentgate", ae, "gate").cable(ae, "env", v.filter, "cutoff", 0.5);
  withBeat(p, [3, 0], v.out, "l", "four", { lead: -4 });
  return p;
}

function pendulumBells() {
  const p = patch("Stage Seq: Pendulum Bells", {
    module: "stage-sequencer", tempo: 90,
    description: "Twelve stages are played in Pendulum mode: forward to the last stage and back again, with the Phrase length marking the repeat. Switch Mode to Forward, Reverse, Random or Brownian to hear the same stages in other orders.",
    tags: ["pendulum", "mode", "bells", "order"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.4, stages: 12, rate: "1/8", mode: "Pendulum", phrase: "4 bars", root: "G", scale: "Major Pentatonic" }, {
    data: stages([[0, 1, "Every"], [2, 1, "Every"], [4, 2, "First"], [7, 1, "Every"], [9, 1, "Every"], [12, 2, "First"], [14, 1, "Every"], [16, 1, "Every"], [19, 2, "First"], [16, 1, "Every"], [14, 1, "Every"], [12, 2, "First"]]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.1 }, env: { decay: 0.7, sustain: 0, release: 0.6 } });
  space(p, [4, 0], v.out, "l", { level: 4, delay: { zone: 3, time: 0.5, feedback: 0.45, mix: 0.3, tone: -0.2 }, verb: { size: 0.7, decay: 5, mix: 0.35 } });
  return p;
}

function brownianWalk() {
  const p = patch("Stage Seq: Brownian Walk", {
    module: "stage-sequencer", tempo: 98,
    description: "In Brownian mode the playhead takes a random step to a neighbouring stage each time, so a Dorian melody wanders without jumping, and the Stage Start output ticks a hat on every new stage. Change Seed to take another walk, or Stages to widen the range.",
    tags: ["brownian", "random walk", "generative", "stage start"],
  });
  const seq = p.add("stage-sequencer", [0, 0], { gatelength: 0.5, stages: 10, rate: "1/8", mode: "Brownian", seed: 14, root: "E", scale: "Dorian" }, {
    data: stages([[0, 1, "Every"], [2, 1, "Every"], [4, 2, "First"], [5, 1, "Every"], [7, 2, "First"], [9, 1, "Every"], [11, 1, "Every"], [12, 2, "First"], [14, 1, "Every"], [16, 2, "First"]]),
  });
  const v = voice(p, [1, 0], { node: seq, velocity: "velocity" }, { osc: { shape: 0.6 }, env: { decay: 0.3, sustain: 0.15, release: 0.2 }, filter: { cutoff: 2600, resonance: 0.2 } });
  const hat = p.add("punch-hats", [1, 3], { level: 0.4, closed: 0.04 });
  p.cable(seq, "stagestart", hat, "closed");
  const mix = p.add("audio-mixer", [4, 0], { level1: 3, level2: -8, pan2: 0.25, master: 0 }, { name: "Mix" });
  p.cable(v.out, "l", mix, "in1l").cable(v.out, "l", mix, "in1r").cable(hat, "out", mix, "in2l");
  const d = p.add("zone-delay", [5, 0], { zone: 3, time: 0.45, feedback: 0.4, mix: 0.25, tone: -0.2 });
  const verb = p.add("reverb", [6, 0], { size: 0.55, decay: 2.8, mix: 0.3 });
  p.stereo(mix, d, { from: ["outl", "outr"] }).stereo(d, verb).stereo(verb, p.out);
  return p;
}

export default [heldPulses, gateModes, slideBass, pendulumBells, brownianWalk];
