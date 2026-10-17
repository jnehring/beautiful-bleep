// Step Sequencer: five demo patches. Each plays by itself with the transport.
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

function pentatonicPluck() {
  const p = patch("Step Sequencer: Pentatonic Pluck", {
    module: "step-sequencer", tempo: 108,
    description: "Sixteen steps of C major pentatonic, with rests and a few quieter steps, played as short plucks: every note you edit snaps to the scale. Try Scale, Root or Length to reshape the tune, or Gate Length to go from staccato to legato.",
    tags: ["melody", "pentatonic", "pluck", "scale"],
  });
  const s = sq(p, [0, 0], [0, 4, 7, 9, ".", 12, 9, 7, 4, ".", 2, 4, 7, ".", 9, 12], { rate: "1/16", root: "C", scale: "Major Pentatonic", gatelength: 0.4 },
    [110, 80, 90, 80, 100, 85, 80, 90, 80, 100, 80, 85, 90, 100, 80, 95]);
  const v = voice(p, [1, 0], { node: s, velocity: "velocity" }, { osc: { shape: 0.55 }, env: { decay: 0.25, sustain: 0.05, release: 0.2 }, filter: { cutoff: 3200, resonance: 0.15 } });
  space(p, [4, 0], v.out, "l", { level: 6, delay: { zone: 3, time: 0.4, feedback: 0.4, mix: 0.3 }, verb: { size: 0.5, decay: 2, mix: 0.25 } });
  return p;
}

function acidTies() {
  const p = patch("Step Sequencer: Acid Ties", {
    module: "step-sequencer", tempo: 124,
    description: "A bass line with tied steps, which hold the previous pitch into the next step so the notes run together, and a little Swing for a rolling feel, over a four-on-the-floor beat. Try more Swing, or shorten Gate Length to hear the ties disappear.",
    tags: ["bass", "ties", "swing", "acid"],
  });
  const s = sq(p, [0, 0], [0, 0, 12, "_", 0, ".", 10, 0, 7, "_", 0, 3, ".", 0, 12, 10], { rate: "1/16", root: "E", scale: "Phrygian", octave: -2, gatelength: 0.55, swing: 0.56 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.97 }, env: { decay: 0.16, sustain: 0.6, release: 0.06 }, filter: { cutoff: 420, resonance: 0.5, drive: 0.25 } });
  const fe = p.add("adsr", [1, 2], { attack: 0.002, decay: 0.2, sustain: 0.1, release: 0.1 }, { name: "Filter Env" });
  p.cable(s, "gate", fe, "gate").cable(s, "trigger", fe, "retrig").cable(fe, "env", v.filter, "cutoff", 0.5);
  withBeat(p, [3, 0], v.out, "l", "four", { lead: -6 });
  return p;
}

function pingPongBells() {
  const p = patch("Step Sequencer: Ping-Pong Bells", {
    module: "step-sequencer", tempo: 84,
    description: "Twelve steps of D Dorian run forward and then backward, in triplet eighths, so the bell line rises and falls without repeating the end notes. Switch Direction to Forward, Backward or Random, or change Length to move the turning points.",
    tags: ["direction", "ping-pong", "triplets", "bells"],
  });
  const s = sq(p, [0, 0], [0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21, 24], { rate: "1/8T", root: "D", scale: "Dorian", direction: "Ping-Pong", gatelength: 0.35 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.1 }, env: { decay: 0.6, sustain: 0, release: 0.5 } });
  space(p, [4, 0], v.out, "l", { level: 3, delay: { zone: 3, time: 0.5, feedback: 0.45, mix: 0.3, tone: -0.2 }, verb: { size: 0.7, decay: 4.5, mix: 0.35 } });
  return p;
}

function shakenTune() {
  const p = patch("Step Sequencer: Shaken Tune", {
    module: "step-sequencer", tempo: 116,
    description: "Variation is set to about half, so around every other step may jump up to a fifth away from its programmed note, and a slow LFO swells and fades that chance. Change Var. Range for bigger leaps, or Seed to deal a different set of surprises.",
    tags: ["variation", "random", "generative", "lead"],
  });
  const s = sq(p, [0, 0], [0, 3, 7, 3, 10, 7, 3, 5], { rate: "1/16", root: "A", scale: "Minor Pentatonic", variation: 0.45, varrange: 7, seed: 12, gatelength: 0.4 });
  const l = p.add("lfo", [0, 2], { rate: 0.07, polarity: "Unipolar" }, { name: "Chance Swell" });
  p.cable(l, "out", s, "variation", 0.4);
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.8 }, env: { decay: 0.2, sustain: 0.25, release: 0.15 }, filter: { cutoff: 2200, resonance: 0.25 } });
  withBeat(p, [3, 0], v.out, "l", "broken", { lead: 3 });
  return p;
}

function chordWalker() {
  const p = patch("Step Sequencer: Chord Walker", {
    module: "step-sequencer", tempo: 100,
    description: "A second, slow Step Sequencer walks a four-bar progression and its Pitch goes into the first one's Transpose input, so the same eight-step figure is carried to a new root each bar. The slow one also plays the sub bass. Edit either sequence to change the harmony or the figure.",
    tags: ["transpose", "chord progression", "two sequencers", "arpeggio"],
  });
  const slow = sq(p, [0, 2], [0, 5, 3, 7], { rate: "1/1", root: "A", scale: "Chromatic", octave: -2, gatelength: 0.95 });
  const fig = sq(p, [0, 0], [0, 3, 7, 12, 7, 3, 10, 7], { rate: "1/8", root: "A", scale: "Natural Minor", octave: 0, gatelength: 0.5 });
  p.cable(slow, "pitch", fig, "transpose");
  const lead = voice(p, [1, 0], { node: fig }, { name: "Figure", osc: { shape: 0.6 }, env: { decay: 0.3, sustain: 0.1, release: 0.25 }, filter: { cutoff: 2600, resonance: 0.15 } });
  const sub = voice(p, [1, 3], { node: slow }, { name: "Sub", osc: { shape: 0.3 }, env: { attack: 0.02, decay: 0.5, sustain: 0.8, release: 0.3 }, filter: { cutoff: 500 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -9, master: 0 }, { name: "Mix" });
  p.cable(lead.out, "l", mix, "in1l").cable(lead.out, "l", mix, "in1r").cable(sub.out, "l", mix, "in2l").cable(sub.out, "l", mix, "in2r");
  const d = p.add("zone-delay", [5, 0], { zone: 3, time: 0.4, feedback: 0.35, mix: 0.2, tone: -0.2 });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2.4, mix: 0.25 });
  p.stereo(mix, d, { from: ["outl", "outr"] }).stereo(d, v).stereo(v, p.out);
  return p;
}

export default [pentatonicPluck, acidTies, pingPongBells, shakenTune, chordWalker];
