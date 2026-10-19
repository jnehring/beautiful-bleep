// SPDX-License-Identifier: MIT
// Strange Osc (strange-osc): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
const seqOf = (p, at, notes, o = {}) => p.add("step-sequencer", at, {
  length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
  octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
}, { data: steps(notes) });

/// `src`'s pitch from the sequencer (jack `pitch`, or none), its output (`jack`) through an ADSR-driven VCA.
function gated(p, at, src, seq, jack, pitch, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(seq, "pitch", src, pitch);
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(src, jack, amp, "l").cable(env, "env", amp, "gain");
  return { amp, env };
}

/// Mono or stereo source → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.22, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// A voice and a drum loop into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function tamedLead() {
  const p = patch("Strange Osc: Tamed Lead", {
    module: "strange-osc", tempo: 104,
    description: "A lead played by a chaotic orbit that has been tamed almost all the way: a clear pitch whose timbre never quite repeats. Lower Tame to roughen the note, or switch Attractor for a different grain.",
    tags: ["lead", "chaos", "tame", "pitched"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 10, 7, 3, 5, ".", 0, 3, 7, 12, 10, 7, 5, 3], { root: "D", gate: 0.6 });
  const osc = p.add("strange-osc", [1, 0], { attractor: "Rossler", tame: 0.85, tone: 7000, level: 0.8 });
  const v = gated(p, [2, 0], osc, seq, "out", "pitch", { env: { decay: 0.3, sustain: 0.5, release: 0.3 } });
  finish(p, [3, 0], v.amp, ["l", "l"], -6, { mix: 0.25 });
  return p;
}

function chaosPercussion() {
  const p = patch("Strange Osc: Chaos Percussion", {
    module: "strange-osc", tempo: 118,
    description: "Fully chaotic Lorenz noise, cut into short hits by an envelope, fills in between a kick and snare. Change the Seed for a different texture, or Tame to make the hits more tonal.",
    tags: ["percussion", "chaos", "noise", "drums"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 0, ".", 0, ".", 0, 0, ".", 0, ".", 0, 0, 0, "."], { rate: "1/16", gate: 0.2, octave: 1 });
  const osc = p.add("strange-osc", [1, 0], { attractor: "Lorenz", tame: 0, coarse: 24, tone: 12000, level: 0.8 });
  const v = gated(p, [2, 0], osc, seq, "out", null, { env: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.05 } });
  const d = beat(p, [0, 4], { style: "broken", level: -6 });
  withDrums(p, [4, 0], v.amp, ["l", "l"], d, { l1: -6, l2: -3 });
  return p;
}

function tameSweep() {
  const p = patch("Strange Osc: Tame Sweep", {
    module: "strange-osc", tempo: 70,
    description: "One long note while a slow LFO sweeps Tame over its whole range: the voice drifts from an almost clean tone, through rough, multiplying orbits, to open chaos and back. Try another Attractor to hear where each one breaks up.",
    tags: ["drone", "sweep", "bifurcation", "evolving"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/2", gate: 1, octave: -1, root: "E" });
  const l = p.add("lfo", [1, 2], { wave: "Triangle", sync: "4 bars", polarity: "Unipolar" }, { name: "Tame Sweep" });
  const osc = p.add("strange-osc", [1, 0], { attractor: "Rossler", tame: 0.5, tone: 4500, level: 0.9 });
  p.cable(l, "out", osc, "tame", 0.9);
  const v = gated(p, [2, 0], osc, seq, "out", "pitch", { env: { attack: 0.4, decay: 0.5, sustain: 0.9, release: 1.2 } });
  finish(p, [3, 0], v.amp, ["l", "l"], -6, { decay: 3.2, mix: 0.3 });
  return p;
}

function chaoticModulator() {
  const p = patch("Strange Osc: Chaotic Modulator", {
    module: "strange-osc", tempo: 96,
    description: "A saw riff through a filter whose cutoff and resonance are moved by the X and Y outputs of a slow Strange Osc: a modulation that wanders and never repeats. Use Tame to make it more regular or switch Attractor for a different gait.",
    tags: ["modulation", "filter", "chaos", "control rate"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 0, 12, 7, 0, 0, 5, 0, 3, 5, 7, 0],
    { rate: "1/8", shape: 1, root: "A", scale: "Natural Minor", gatelength: 0.6, octave: -1, env: { attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.1 } });
  const chaos = p.add("strange-osc", [0, 3], { attractor: "Lorenz", tame: 0.15, range: "Slow", coarse: 12 }, { name: "Wanderer" });
  const f = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.45, mode: "LP" });
  p.cable(m.amp, "l", f, "l").cable(chaos, "x", f, "cutoff", 0.5).cable(chaos, "y", f, "resonance", 0.25);
  finish(p, [4, 0], f, ["l", "l"], -4, { mix: 0.2 });
  return p;
}

function forcedOrbit() {
  const p = patch("Strange Osc: Forced Orbit", {
    module: "strange-osc", tempo: 90,
    description: "A saw riff pushes a half-tamed orbit through Force In, so the orbit follows the riff's rhythm but keeps its own colour. Raise Force for tighter lock, or lower Tame to let it run away.",
    tags: ["force", "input", "chaos", "bass"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 3, ".", 5, 7, "."], { rate: "1/8", shape: 1, root: "G", gatelength: 0.5, octave: -1, env: { decay: 0.25, sustain: 0.5 } });
  const osc = p.add("strange-osc", [3, 0], { attractor: "Rossler", tame: 0.55, force: 0.6, coarse: -12, tone: 5000, level: 0.8 });
  p.cable(m.seq, "pitch", osc, "pitch").cable(m.amp, "l", osc, "forcein");
  const env = p.add("adsr", [3, 1], { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 }, { name: "Amp Env" });
  const amp = p.add("vca", [4, 0], {}, { name: "VCA" });
  p.cable(m.seq, "gate", env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  finish(p, [5, 0], amp, ["l", "l"], -5, { mix: 0.2 });
  return p;
}

export default [tamedLead, chaosPercussion, tameSweep, chaoticModulator, forcedOrbit];
