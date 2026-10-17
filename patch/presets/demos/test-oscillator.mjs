// SPDX-License-Identifier: MIT
// Test Oscillator: five demo patches. Each plays by itself with the transport.
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


function warmHum() {
  const p = patch("Test Oscillator: Warm Hum", {
    module: "test-oscillator", tempo: 60,
    description: "A lamp-stabilised sine on its own: it warms up, bounces slightly in level and carries a faint mains hum, a slowly breathing drone in a big room. Raise Drift for more wander, or change Mains to Off for a perfectly clean tone.",
    tags: ["drone", "sine", "warm-up", "hum"],
  });
  const t = p.add("test-oscillator", [0, 0], { freq: 3.2, range: "×100", drift: 0.5, mains: "50 Hz", loopgain: 1.2, settle: 0.5 });
  const amp = p.add("vca", [1, 0], { gain: 1 }, { name: "VCA" });
  p.cable(t, "sine", amp, "l").cable(t, "sine", amp, "r");
  finish(p, [2, 0], amp, ["l", "r"], -12, { size: 0.8, decay: 6, mix: 0.4 });
  return p;
}

function kickedRing() {
  const p = patch("Test Oscillator: Kicked Bell", {
    module: "test-oscillator", tempo: 84,
    description: "With Loop Gain below 100 % the oscillator dies away on its own, and a trigger on Kick makes it ring like a struck tuning fork. Change Loop Gain for longer or shorter rings, and Kick for how hard it is hit.",
    tags: ["kick", "ring", "pluck", "loop gain"],
  });
  const seq = seqOf(p, [0, 0], [0, ".", 0, ".", 7, ".", ".", 5, 0, ".", ".", 0, 3, ".", 5, "."], { root: "A", rate: "1/8", gate: 0.3 });
  const t = p.add("test-oscillator", [1, 0], { freq: 4.4, range: "×100", loopgain: 0.97, kick: 0.9, drift: 0.1, settle: 0.05 });
  const amp = p.add("vca", [2, 0], { gain: 1 }, { name: "VCA" });
  p.cable(seq, "pitch", t, "pitch").cable(seq, "trigger", t, "kick").cable(t, "sine", amp, "l").cable(t, "sine", amp, "r");
  finish(p, [3, 0], amp, ["l", "r"], 1, { size: 0.65, decay: 4, mix: 0.3 });
  return p;
}

function sineMelody() {
  const p = patch("Test Oscillator: Pure Sine Tune", {
    module: "test-oscillator", tempo: 100,
    description: "A plain sine melody from the Test Oscillator's Pitch input with a short envelope, about as clean a tone as exists. Add Fm from the LFO for vibrato or raise Drift to hear a warmer, wobblier note.",
    tags: ["sine", "melody", "pitch", "clean"],
  });
  const seq = seqOf(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 7, 5, 9, 12, 16, 12, 9, 7, 4], { root: "C", scale: "Major", rate: "1/8", gate: 0.55 });
  const t = p.add("test-oscillator", [1, 0], { freq: 4.4, range: "×100", loopgain: 1.2, drift: 0.2, fm: 0.1 });
  const lfo = p.add("lfo", [1, 2], { rate: 5.5 }, { name: "Vibrato" });
  const v = play(p, [2, 0], t, seq, ["sine"], { env: { decay: 0.3, sustain: 0.5, release: 0.3 } });
  p.cable(lfo, "out", t, "fm", 0.2);
  finish(p, [3, 0], v.amp, v.out, 2, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

function squareBass() {
  const p = patch("Test Oscillator: Square Bass", {
    module: "test-oscillator", tempo: 100,
    description: "The square output at the lowest range plays a rounded bass line through a low-pass filter, over a simple beat. Change Range to jump the whole line by decades or move Freq for a different key.",
    tags: ["square", "bass", "range", "drums"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 0, ".", 3, ".", 0, 5, 0, "_", 0, ".", 7, ".", 5, 3], { root: "E", octave: -1, rate: "1/8", gate: 0.7 });
  const t = p.add("test-oscillator", [1, 0], { freq: 4.4, range: "×10", loopgain: 1.2, drift: 0.1, level: 0.7 });
  const v = play(p, [2, 0], t, seq, ["square"], { env: { decay: 0.2, sustain: 0.6, release: 0.12 } });
  const lp = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.3 });
  p.stereo(v.amp, lp, { from: v.out });
  const drums = beat(p, [0, 4], { style: "four", level: -7 });
  withDrums(p, [4, 0], lp, ["l", "r"], drums, { l1: -3, l2: -6 });
  return p;
}

function lampFilter() {
  const p = patch("Test Oscillator: Lamp Drives Filter", {
    module: "test-oscillator", tempo: 70,
    description: "The Lamp output, a slow signal showing the oscillator's amplitude loop breathing, opens a filter on a held chord of Oscillators. Raise Settle for slower swings, or Loop Gain for harder bounces.",
    tags: ["lamp", "modulation", "filter", "pad"],
  });
  const t = p.add("test-oscillator", [0, 0], { freq: 1.5, range: "×1", loopgain: 1.1, settle: 1.2, drift: 0.7, level: 0.01 });
  const seq = seqOf(p, [0, 2], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], { root: "A", scale: "Natural Minor", octave: -1, rate: "1/4", gate: 1 });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.85, fine: -8 }, { name: "Voice 1" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.85, fine: 8, coarse: 7 }, { name: "Voice 2" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -10, pan1: -0.4, pan2: 0.4, master: 0 }, { name: "Voices" });
  const f = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.35 });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", mix, "in1l").cable(o2, "out", mix, "in2l")
    .stereo(mix, f, { from: ["outl", "outr"] }).cable(t, "lamp", f, "cutoff", 0.7);
  finish(p, [4, 0], f, ["l", "r"], 0, { size: 0.8, decay: 5, mix: 0.35 });
  return p;
}

export default [warmHum, kickedRing, sineMelody, squareBass, lampFilter];
