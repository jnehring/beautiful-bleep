// SPDX-License-Identifier: MIT
// Noise: five demo patches. Each plays by itself with the transport.
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


function hatWash() {
  const p = patch("Noise: Blue Hat Patterns", {
    module: "noise", tempo: 124,
    description: "Blue noise, cut short by an envelope and high-passed, is played as hi-hats from a drum grid pattern over a soft kick. Slide Colour toward white for a duller tick, or toward blue for a thinner, brighter sizzle.",
    tags: ["hi-hat", "blue noise", "percussion", "drums"],
  });
  const grid = beat(p, [0, 4], { style: "four", level: -3 });
  const seq = seqOf(p, [0, 0], [0, ".", 0, 0, 0, ".", 0, ".", 0, ".", 0, 0, 0, ".", 0, 0], { rate: "1/16", gate: 0.25 });
  const n = p.add("noise", [1, 0], { colour: 0.9, level: 0.8 });
  const env = p.add("adsr", [2, 1], { attack: 0.001, decay: 0.07, sustain: 0, release: 0.05 }, { name: "Tick Env" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  const hp = p.add("filter", [3, 0], { cutoff: 6500, resonance: 0.2, mode: 1 }, { name: "High-pass" });
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain").cable(n, "out", amp, "l")
    .cable(amp, "l", hp, "l").cable(hp, "l", hp, "r");
  withDrums(p, [4, 0], hp, ["l", "r"], grid, { l1: 5, l2: -3 });
  return p;
}

function surf() {
  const p = patch("Noise: Ocean Surf", {
    module: "noise", tempo: 60,
    description: "Brown noise swells and recedes as two slow LFOs open a low-pass filter and the level together, like waves washing in. Raise Colour for foam and hiss, or speed up the LFO for a stormier sea.",
    tags: ["ambient", "sound effect", "brown noise", "lfo"],
  });
  const n = p.add("noise", [0, 0], { colour: -0.6, level: 0.4 });
  const wave = p.add("lfo", [1, 1], { rate: 0.11, wave: "Sine", polarity: "Unipolar" }, { name: "Wave" });
  const foam = p.add("lfo", [1, 2], { rate: 0.17, wave: "Triangle", polarity: "Unipolar" }, { name: "Foam" });
  const lp = p.add("filter", [1, 0], { cutoff: 500, resonance: 0.15 });
  const amp = p.add("vca", [2, 0], { gain: 0.1 }, { name: "Swell" });
  p.cable(n, "out", lp, "l").cable(n, "out", lp, "r").cable(wave, "out", lp, "cutoff", 0.55).cable(lp, "l", amp, "l").cable(lp, "r", amp, "r")
    .cable(wave, "out", amp, "gain", 0.9).cable(foam, "out", lp, "cutoff", 0.15);
  const t = p.add("audio-mixer", [3, 0], { level1: 3, master: 0 }, { name: "Trim" });
  p.stereo(amp, t, { to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return p;
}

function whistle() {
  const p = patch("Noise: Wind Whistle Melody", {
    module: "noise", tempo: 84,
    description: "White noise through a very resonant band-pass filter that follows the sequencer's pitch: a breathy, whistling tune with no oscillator at all. Lower Resonance for a wind that only hints at pitch.",
    tags: ["breath", "whistle", "melody", "resonant filter"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", 7, "_", 5, "_", 3, 0, 7, "_", 12, "_", 10, "_", 7, "."], { root: "D", scale: "Major Pentatonic", octave: 1, rate: "1/8", gate: 0.9 });
  const n = p.add("noise", [1, 0], { colour: 0, level: 1 });
  const f = p.add("filter", [2, 0], { cutoff: 800, resonance: 0.93, keytrack: 1, type: "SVF Bandpass (unit gain)" }, { name: "Whistle" });
  const env = p.add("adsr", [2, 1], { attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.3 }, { name: "Breath" });
  const amp = p.add("vca", [3, 0], {}, { name: "VCA" });
  p.cable(seq, "pitch", f, "pitch").cable(n, "out", f, "l").cable(n, "out", f, "r").cable(seq, "gate", env, "gate").cable(env, "env", amp, "gain")
    .stereo(f, amp);
  finish(p, [4, 0], amp, ["l", "r"], 6, { size: 0.7, decay: 4, mix: 0.35 }, 6);
  return p;
}

function riser() {
  const p = patch("Noise: Colour Riser", {
    module: "noise", tempo: 120,
    description: "Every four bars a ramp sweeps Colour from dark brown to bright violet while a filter opens, building tension over a steady beat before it drops back. Change the LFO's Sync to lengthen or shorten the build.",
    tags: ["riser", "sweep", "build-up", "colour"],
  });
  const drums = beat(p, [0, 4], { style: "broken", level: -7 });
  const n = p.add("noise", [0, 0], { colour: -1, level: 0.8 });
  const ramp = p.add("lfo", [0, 2], { wave: "Saw Up", sync: "4 bars", polarity: "Unipolar" }, { name: "Build" });
  const f = p.add("filter", [1, 0], { cutoff: 300, resonance: 0.35 });
  const amp = p.add("vca", [2, 0], { gain: 0.1 }, { name: "Swell" });
  p.cable(ramp, "out", n, "colour", 0.9).cable(ramp, "out", f, "cutoff", 0.8).cable(ramp, "out", amp, "gain", 0.8)
    .cable(n, "out", f, "l").cable(n, "out", f, "r").stereo(f, amp);
  withDrums(p, [3, 0], amp, ["l", "r"], drums, { l1: -4, l2: -6 });
  return p;
}

function fourColours() {
  const p = patch("Noise: Four Colours", {
    module: "noise", tempo: 72,
    description: "The white, pink, brown and blue outputs go to four mixer channels whose pans drift on slow LFOs, then through a gently resonant filter into a hall. Mute channels on the mixer to hear each colour alone.",
    tags: ["texture", "colours", "stereo", "ambient"],
  });
  const n = p.add("noise", [0, 0], { level: 0.9 });
  const mix = p.add("audio-mixer", [1, 0], { level1: -16, level2: -9, level3: -5, level4: -14, pan1: -0.6, pan2: 0.4, pan3: -0.2, pan4: 0.7, master: 0 }, { name: "Colours" });
  p.cable(n, "white", mix, "in1l").cable(n, "pink", mix, "in2l").cable(n, "brown", mix, "in3l").cable(n, "blue", mix, "in4l");
  [["pan1", 0.07], ["pan2", 0.05], ["pan3", 0.09], ["pan4", 0.06]].forEach(([k, r], i) => {
    const l = p.add("lfo", [1, 2 + i], { rate: r }, { name: `Drift ${i + 1}` });
    p.cable(l, "out", mix, k, 0.8);
  });
  const f = p.add("filter", [2, 0], { cutoff: 1200, resonance: 0.55, type: "SVF Bandpass (unit gain)" });
  const sweep = p.add("lfo", [2, 2], { rate: 0.04, wave: "Triangle" }, { name: "Cutoff" });
  p.stereo(mix, f, { from: ["outl", "outr"] }).cable(sweep, "out", f, "cutoff", 0.5);
  finish(p, [3, 0], f, ["l", "r"], 6, { size: 0.9, decay: 8, mix: 0.4 });
  return p;
}

export default [hatWash, surf, whistle, riser, fourColours];
