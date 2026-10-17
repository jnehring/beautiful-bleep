// Keyboard: five demo patches. Each plays by itself with the transport.
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

function transposingKeys() {
  const p = patch("Keyboard: Transposing Keys", {
    module: "keyboard", tempo: 106,
    description: "A pentatonic riff loops by itself; the Keyboard's Pitch output goes to the sequencer's Transpose input, so playing a key moves the whole riff to that note. Change Octave to shift the range of the keys, or Priority to choose which key wins when you hold several.",
    tags: ["transpose", "pitch", "riff", "play along"],
  });
  const s = sq(p, [0, 0], [0, 3, 7, 12, 10, 7, 3, 5], { rate: "1/16", root: "C", scale: "Minor Pentatonic", gatelength: 0.5 });
  const k = p.add("keyboard", [0, 2], { velocity: 0.8, glide: 0, octave: 0, priority: "Last" }, { name: "Transpose Keys" });
  p.cable(k, "pitch", s, "transpose");
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.85 }, env: { decay: 0.2, sustain: 0.3, release: 0.15 }, filter: { cutoff: 2000, resonance: 0.2 } });
  withBeat(p, [3, 0], v.out, "l", "half", { lead: 2 });
  return p;
}

function glideLead() {
  const p = patch("Keyboard: Glide Lead", {
    module: "keyboard", tempo: 92,
    description: "A soft bell arpeggio plays underneath; the Keyboard's Pitch and Gate drive a separate saw lead, and Glide is set to 0.25 s so notes slide into each other as you play. Raise Glide for slower portamento or bring it to 0 for clean steps.",
    tags: ["glide", "portamento", "mono lead", "layer"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 4, 9, 12, 16], { rate: "1/8", shape: 0.15, root: "A", scale: "Minor Pentatonic", octave: 1, env: { decay: 0.4, sustain: 0.05, release: 0.4 }, gatelength: 0.3 });
  const k = p.add("keyboard", [0, 3], { velocity: 0.8, glide: 0.25, octave: 0, priority: "Last" }, { name: "Lead Keys" });
  const lead = voice(p, [1, 3], { node: k, trigger: false, velocity: "vel" }, { name: "Lead", osc: { shape: 0.85 }, env: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.3 }, filter: { cutoff: 2200, resonance: 0.25 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: 1, level2: -3, master: 0 }, { name: "Mix" });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").cable(lead.out, "l", mix, "in2l").cable(lead.out, "l", mix, "in2r");
  const d = p.add("zone-delay", [5, 0], { zone: 3, time: 0.45, feedback: 0.4, mix: 0.25, tone: -0.2 });
  const v = p.add("reverb", [6, 0], { size: 0.55, decay: 2.8, mix: 0.25 });
  p.stereo(mix, d, { from: ["outl", "outr"] }).stereo(d, v).stereo(v, p.out);
  return p;
}

function malletLayer() {
  const p = patch("Keyboard: Mallet Layer", {
    module: "keyboard", tempo: 98,
    description: "A bass loop plays alone until you press keys: the Keyboard's Pitch, Trigger and Velocity strike a marimba-like Modal Voice, so harder Velocity makes brighter hits. Try the Velocity knob, or play a run down the keys.",
    tags: ["mallet", "velocity", "layer", "marimba"],
  });
  const s = sq(p, [0, 0], [0, ".", 0, 7, ".", 5, 0, "."], { rate: "1/8", root: "G", scale: "Dorian", octave: -2, gatelength: 0.6 });
  const bass = voice(p, [1, 0], { node: s }, { name: "Bass", osc: { shape: 0.5 }, env: { decay: 0.3, sustain: 0.5, release: 0.15 }, filter: { cutoff: 700, resonance: 0.2 } });
  const k = p.add("keyboard", [0, 3], { velocity: 0.8, octave: 0 }, { name: "Mallet Keys" });
  const mal = p.add("modal-voice", [1, 3], { strike: 1, strikeTimbre: 0.55, geometry: 0.3, brightness: 0.6, damping: 0.45, position: 0.3, size: 0.35, space: 0.25 }, { name: "Marimba" });
  p.cable(k, "pitch", mal, "pitch").cable(k, "trigger", mal, "strike").cable(k, "vel", mal, "velocity");
  const mix = p.add("audio-mixer", [3, 0], { level1: 0, level2: -4, master: 0 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").cable(bass.out, "l", mix, "in1r").stereo(mal, mix, { to: ["in2l", "in2r"] });
  const v = p.add("reverb", [4, 0], { size: 0.45, decay: 1.8, mix: 0.2 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function latchedArp() {
  const p = patch("Keyboard: Latched Arp", {
    module: "keyboard", tempo: 120,
    description: "The Keyboard's Notes output feeds an Arpeggiator set to Latch: a bass line and beat run alone until you press a few keys, and when you let go they keep arpeggiating until you press a new chord. Change the Arpeggiator's Pattern or Octaves to hear the same keys differently.",
    tags: ["arpeggio", "latch", "chords", "notes out"],
  });
  const k = p.add("keyboard", [0, 0], { velocity: 0.8, octave: 0 }, { name: "Chord Keys" });
  const a = p.add("arpeggiator", [1, 0], { rate: "1/16", pattern: "Up-Down", octaves: 2, latch: "On", gatelength: 0.4 });
  p.cable(k, "notes", a, "notes");
  const v = voice(p, [2, 0], { node: a, velocity: "velocity" }, { osc: { shape: 0.8 }, env: { decay: 0.2, sustain: 0.2, release: 0.15 }, filter: { cutoff: 2400, resonance: 0.2 } });
  const b = sq(p, [0, 3], [0, 0, ".", 12, 0, ".", 7, 5], { rate: "1/16", root: "A", scale: "Minor Pentatonic", octave: -2, gatelength: 0.5 });
  const bass = voice(p, [1, 3], { node: b }, { name: "Bass", osc: { shape: 0.9 }, env: { decay: 0.18, sustain: 0.35, release: 0.08 }, filter: { cutoff: 500, resonance: 0.25 } });
  const drums = beat(p, [2, 4], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 2, level2: -2, level3: -4, master: -2 }, { name: "Mix" });
  p.cable(v.out, "l", mix, "in1l").cable(v.out, "l", mix, "in1r").cable(bass.out, "l", mix, "in2l").cable(bass.out, "l", mix, "in2r")
    .stereo(drums, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  const r = p.add("reverb", [5, 0], { size: 0.35, decay: 1.4, mix: 0.15 });
  p.stereo(mix, r, { from: ["outl", "outr"] }).stereo(r, p.out);
  return p;
}

function holdDrone() {
  const p = patch("Keyboard: Hold Drone", {
    module: "keyboard", tempo: 70,
    description: "Hold is on and Priority is Lowest, so the keys you click stay down and the lowest one sets a slow drone under a gentle bell melody. Click the same key again to release it, or press All off to clear the keys.",
    tags: ["hold", "drone", "priority", "ambient"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, 2], { rate: "1/4", shape: 0.2, root: "D", scale: "Major Pentatonic", octave: 1, env: { decay: 0.8, sustain: 0.1, release: 0.8 } });
  const k = p.add("keyboard", [0, 3], { velocity: 0.8, octave: -1, priority: "Lowest", hold: true }, { name: "Drone Keys" });
  const dr = voice(p, [1, 3], { node: k, trigger: false }, { name: "Drone", osc: { shape: 0.6 }, env: { attack: 1.5, decay: 0.5, sustain: 1, release: 3 }, filter: { cutoff: 700 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: 2, level2: -3, master: 0 }, { name: "Mix" });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").cable(dr.out, "l", mix, "in2l").cable(dr.out, "l", mix, "in2r");
  const v = p.add("reverb", [5, 0], { size: 0.8, decay: 8, mix: 0.4 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [transposingKeys, glideLead, malletLayer, latchedArp, holdDrone];
