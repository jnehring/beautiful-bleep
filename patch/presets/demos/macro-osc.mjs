// SPDX-License-Identifier: MIT
// Macro Osc: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
function seqOf(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, {
    length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
  }, { data: steps(notes) });
}

/// Sequencer pitch → `src`, gate → ADSR → VCA. `jacks`: the source's audio outs (one = mono, two = stereo).
/// Returns {amp, out}: `out` are the VCA jacks to take (l, l for a mono source).
function play(p, at, src, seq, jacks, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  p.cable(seq, "pitch", src, o.pitch || "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain");
  if (jacks.length === 1) { p.cable(src, jacks[0], amp, "l"); return { amp, env, out: ["l", "l"] }; }
  p.stereo(src, amp, { from: jacks });
  return { amp, env, out: ["l", "r"] };
}

/// Source jacks → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// A drum loop and a voice mixed together into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}


function pluck() {
  const p = patch("Macro Osc: Plucked Strings", {
    module: "macro-osc", tempo: 96,
    description: "The Pluck model struck by the sequencer's trigger: its built-in decay and low-pass gate shape every note, so no envelope or VCA is needed. Turn Decay for longer strings, Tone for brightness and Shape for how hard the string is hit.",
    tags: ["pluck", "string", "model", "trigger"],
  });
  const seq = seqOf(p, [0, 0], [0, 7, 12, 7, 3, 7, 10, 7, 0, 5, 12, 5, 2, 7, 10, 14], { root: "D", scale: "Minor Pentatonic", rate: "1/8", gate: 0.4 });
  const m = p.add("macro-osc", [1, 0], { model: "Pluck", tone: 0.55, shape: 0.5, blend: 0.3, decay: 1.2, gateColour: 0.55, level: 0.8 });
  p.cable(seq, "pitch", m, "pitch").cable(seq, "trigger", m, "trig");
  finish(p, [2, 0], m, ["out", "out"], -1, { size: 0.55, decay: 3, mix: 0.25 });
  return p;
}

function vowelChoir() {
  const p = patch("Macro Osc: Vowel Choir", {
    module: "macro-osc", tempo: 70,
    description: "The Vowel model holds slow notes while a slow LFO walks Tone through the vowels, so the choir seems to sing a different syllable on every phrase. Turn Blend to change the voice or Shape for brightness.",
    tags: ["vowel", "choir", "pad", "model"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"], { root: "A", scale: "Natural Minor", octave: -1, rate: "1/4", gate: 1 });
  const m = p.add("macro-osc", [1, 0], { model: "Vowel", tone: 0.4, shape: 0.5, blend: 0.3, level: 0.8 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.09, wave: "Triangle" }, { name: "Vowel" });
  const env = p.add("adsr", [2, 1], { attack: 1.2, decay: 1, sustain: 0.85, release: 2.2 }, { name: "Pad Env" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  p.cable(seq, "pitch", m, "pitch").cable(seq, "gate", env, "gate").cable(env, "env", amp, "gain").cable(lfo, "out", m, "tone", 0.4)
    .cable(m, "out", amp, "l").cable(m, "aux", amp, "r");
  finish(p, [3, 0], amp, ["l", "r"], -9, { size: 0.85, decay: 6.5, mix: 0.4 });
  return p;
}

function fmKeys() {
  const p = patch("Macro Osc: FM Electric Keys", {
    module: "macro-osc", tempo: 100,
    description: "The FM model as a tine-and-bell keyboard sound: Tone sets the modulator ratio and an envelope on Shape gives each key a sparkle that fades. Change Tone to hop between ratios, or raise Blend for more of the second voice.",
    tags: ["fm", "keys", "electric piano", "model"],
  });
  const seq = seqOf(p, [0, 0], [0, 4, 7, 11, 7, 4, 0, 4, 2, 5, 9, 12, 9, 5, 2, 5], { root: "F", scale: "Major", octave: 0, rate: "1/8", gate: 0.5 });
  const m = p.add("macro-osc", [1, 0], { model: "FM", tone: 0.3, shape: 0.25, blend: 0.2, level: 0.8 });
  const fe = p.add("adsr", [1, 2], { attack: 0.002, decay: 0.5, sustain: 0.05, release: 0.3 }, { name: "Sparkle" });
  const v = play(p, [2, 0], m, seq, ["out", "aux"], { env: { attack: 0.003, decay: 0.7, sustain: 0.15, release: 0.4 } });
  p.cable(seq, "gate", fe, "gate").cable(seq, "trigger", fe, "retrig").cable(fe, "env", m, "shape", 0.4);
  finish(p, [3, 0], v.amp, v.out, 0, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

function drumKit() {
  const p = patch("Macro Osc: Synth Drum Kit", {
    module: "macro-osc", tempo: 112,
    description: "Three Macro Oscs on the Kick, Snare and Metal models are struck by a drum grid: a whole beat from one module type. Change each model's Decay and Tone to tune the kit, or switch a model for other percussion.",
    tags: ["drums", "kick", "snare", "metal", "percussion"],
  });
  const dg = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Tom", "Tom 2", "Perc"],
    [pattern("Kit", ["X..x..x...X..x..", "....X..x....X...", "x.xxx.x.x.xxx.xx", ""])]) });
  const k = p.add("macro-osc", [1, 0], { model: "Kick", tone: 0.35, shape: 0.5, decay: 0.45, level: 0.9 }, { name: "Kick" });
  const s = p.add("macro-osc", [1, 1], { model: "Snare", tone: 0.5, shape: 0.5, decay: 0.3, level: 0.7 }, { name: "Snare" });
  const h = p.add("macro-osc", [1, 2], { model: "Metal", tone: 0.7, shape: 0.5, decay: 0.08, level: 0.5, octave: 1 }, { name: "Hat" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -2, level2: -6, level3: -14, pan2: 0.1, pan3: 0.3, master: 0 }, { name: "Kit" });
  p.cable(dg, "gate1", k, "trig").cable(dg, "velocity1", k, "accent").cable(dg, "gate2", s, "trig").cable(dg, "velocity2", s, "accent")
    .cable(dg, "gate3", h, "trig").cable(dg, "velocity3", h, "accent")
    .cable(k, "out", mix, "in1l").cable(s, "out", mix, "in2l").cable(h, "out", mix, "in3l");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function modalMarimba() {
  const p = patch("Macro Osc: Modal Marimba", {
    module: "macro-osc", tempo: 88,
    description: "The Modal model struck by a trigger rings like a wooden bar. Tone moves from soft wood to bright metal, Decay lengthens the ring, and Accent from the velocity gives the loud and soft notes.",
    tags: ["modal", "marimba", "mallet", "trigger"],
  });
  const seq = seqOf(p, [0, 0], [0, 4, 7, 4, 12, 7, 4, 7, 2, 5, 9, 5, 14, 9, 5, 9], { root: "G", scale: "Major Pentatonic", octave: 0, rate: "1/8", gate: 0.3 });
  const m = p.add("macro-osc", [1, 0], { model: "Modal", tone: 0.35, shape: 0.4, blend: 0.2, decay: 1.4, gateColour: 0.6, level: 0.8 });
  p.cable(seq, "pitch", m, "pitch").cable(seq, "trigger", m, "trig").cable(seq, "velocity", m, "accent");
  finish(p, [2, 0], m, ["out", "aux"], -12, { size: 0.55, decay: 3, mix: 0.25 });
  return p;
}

export default [pluck, vowelChoir, fmKeys, drumKit, modalMarimba];
