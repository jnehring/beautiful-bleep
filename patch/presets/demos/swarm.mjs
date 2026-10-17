// SPDX-License-Identifier: MIT
// Swarm: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: o.rate || "1/4", root: o.root || "A",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.9 }, { data: steps(notes, o.vel), name: o.name || "Notes" });
}
/// Stereo source → VCA with an ADSR from the sequencer gate. Returns the VCA.
function amp(p, at, s, src, adsr, from = ["l", "r"]) {
  const env = p.add("adsr", at, adsr, { name: "Amp Env" });
  const v = p.add("vca", [at[0] + 1, at[1]], {}, { name: "VCA" });
  p.cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(env, "env", v, "gain");
  p.stereo(src, v, { from });
  return v;
}
/// Optional trim, then a Verb to Out 1/2.
function room(p, at, src, o = {}) {
  if (o.trim !== undefined) {
    const m = p.add("audio-mixer", [at[0] - 1, at[1] + 2], { level1: o.trim, pan1: -1, level2: o.trim, pan2: 1, master: 0 }, { name: "Trim" });
    p.cable(src, (o.from || ["l", "r"])[0], m, "in1l").cable(src, (o.from || ["l", "r"])[1], m, "in2r");
    src = m; o = { ...o, from: ["outl", "outr"] };
  }
  const v = p.add("reverb", at, { size: 0.6, decay: 3, damping: 0.45, mix: o.mix ?? 0.3, quality: "Eco (8 lines)", ...o.v });
  p.stereo(src, v, { from: o.from || ["l", "r"] }).stereo(v, p.out);
  return v;
}

function bloomingPad() {
  const p = patch("Swarm: Blooming Pad", {
    module: "swarm", tempo: 70,
    description: "A slow LFO moves Spread between 0 and 100 %: the eight oscillators sit on the root, then leave it one after another and slide up into a minor ninth stack, and fold back again. Glide sets how lazily they move. Try Chord, Count and Width, or press Reshuffle for a new set of glide times.",
    tags: ["pad", "bloom", "spread", "glide"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", root: "D", octave: -1, scale: "Natural Minor" });
  const sw = p.add("swarm", [1, 0], { chord: "Minor 9", count: 9, range: 2, spread: 0.5, glide: 1.4, detune: 10, drift: 0.3, width: 0.8, warp: 0.35 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.06, wave: "Triangle", polarity: "Unipolar" }, { name: "Bloom" });
  p.cable(s, "pitch", sw, "pitch").cable(lfo, "out", sw, "spread", 0.9);
  const lp = p.add("filter", [3, 0], { cutoff: 1800, resonance: 0.12 }, { name: "Soften" });
  p.cable(sw, "spread", lp, "cutoff", 0.35).stereo(sw, lp);
  const v = amp(p, [1, 1], s, lp, { attack: 1.6, decay: 1, sustain: 0.9, release: 2.5 });
  room(p, [4, 0], v, { trim: -10, v: { size: 0.8, decay: 6, mix: 0.4 } });
  return p;
}

function supersaw() {
  const p = patch("Swarm: Supersaw Lead", {
    module: "swarm", tempo: 128,
    description: "With Spread at 0 every oscillator plays the same note, so the swarm becomes a fat unison lead: seven bright saws, Detune in a Fan pattern, a little Width. A filter envelope closes after each note. Raise Spread a touch to hear the lead turn into a chord, or change Pattern to Alternate or Outer.",
    tags: ["lead", "supersaw", "unison", "detune"],
  });
  const s = seq(p, [0, 0], [0, ".", 7, 5, ".", 3, 5, ".", 0, ".", 10, 7, ".", 5, 3, 7], { rate: "1/8", root: "A", octave: 0, scale: "Minor Pentatonic", gate: 0.6 });
  const sw = p.add("swarm", [1, 0], { chord: "Minor 7", count: 7, spread: 0, warp: 1, detune: 22, pattern: "Fan", drift: 0.2, width: 0.7, glide: 0.05 });
  const fenv = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.3, sustain: 0.2, release: 0.2 }, { name: "Filter Env" });
  const lp = p.add("filter", [2, 0], { cutoff: 700, resonance: 0.3, type: "Ladder Tanh" }, { name: "Filter" });
  p.cable(s, "pitch", sw, "pitch").cable(s, "gate", fenv, "gate").cable(s, "trigger", fenv, "retrig").cable(fenv, "env", lp, "cutoff", 0.5).stereo(sw, lp);
  const v = amp(p, [2, 1], s, lp, { attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.2 });
  const d = beat(p, [0, 3], { style: "four", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -5, pan1: -1, level2: -5, pan2: 1, level3: -3, level4: -3, master: 0 }, { name: "Mix" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in2r").cable(d, "outl", mix, "in3l").cable(d, "outr", mix, "in3r");
  room(p, [5, 0], mix, { from: ["outl", "outr"], mix: 0.18 });
  return p;
}

function hirajoshiShimmer() {
  const p = patch("Swarm: Hirajoshi Shimmer", {
    module: "swarm", tempo: 60,
    description: "Set to a whole scale instead of a chord: sixteen oscillators across four octaves of Hirajoshi, fully spread, with high Drift and Width so the notes shimmer and wander. Soft sine-like Warp keeps it glassy. Change Chord to another scale, lower Range for a narrower cloud, or sweep Drift by hand.",
    tags: ["shimmer", "scale", "drift", "ambient"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_"], { rate: "1/2", root: "E", octave: -1, scale: "Hirajoshi" });
  const sw = p.add("swarm", [1, 0], { chord: "Hirajoshi", count: 16, range: 4, spread: 1, warp: 0.05, detune: 14, drift: 0.8, width: 1, glide: 2.5, pattern: "Random", quality: "High (2×)" });
  const lfo = p.add("lfo", [1, 2], { rate: 0.03, wave: "Triangle", polarity: "Unipolar" }, { name: "Breath" });
  p.cable(s, "pitch", sw, "pitch").cable(lfo, "out", sw, "drift", 0.2);
  const v = amp(p, [1, 1], s, sw, { attack: 2.5, decay: 1, sustain: 1, release: 4 });
  room(p, [3, 0], v, { trim: -17, v: { size: 0.9, decay: 10, mix: 0.5 } });
  return p;
}

function metalCloud() {
  const p = patch("Swarm: Metal Cloud", {
    module: "swarm", tempo: 90,
    description: "Cross FM pushes each oscillator's phase with its neighbour's, turning a Cluster chord into dense, bell-like metal. A trigger at the start of every bar reshuffles the detune pattern and glide times, so each bar is a new cloud, and an envelope on every beat strikes it. Lower Cross FM for gritty chords, or raise it for noise.",
    tags: ["cross fm", "metal", "reshuffle", "percussive"],
  });
  const s = seq(p, [0, 0], [0, ".", ".", 0, ".", 0, ".", ".", 3, ".", ".", 3, ".", ".", 5, "."], { rate: "1/8", root: "C", octave: 0, scale: "Phrygian", gate: 0.3 });
  const bar = p.add("step-sequencer", [0, 1], { length: 8, rate: "1/2", gatelength: 0.1 }, { data: steps([0, ".", ".", "."]), name: "Bar Pulse" });
  const sw = p.add("swarm", [1, 0], { chord: "Cluster", count: 6, range: 2, spread: 0.7, crossfm: 0.28, warp: 0.1, detune: 18, glide: 0.05, drift: 0.4, width: 0.9, octave: 0 });
  p.cable(s, "pitch", sw, "pitch").cable(bar, "trigger", sw, "reshuffle");
  const lp = p.add("filter", [2, 0], { cutoff: 6000, resonance: 0.1, mode: 0 }, { name: "Tone" });
  p.stereo(sw, lp);
  const v = amp(p, [2, 1], s, lp, { attack: 0.002, decay: 0.45, sustain: 0.0, release: 0.4 });
  room(p, [4, 0], v, { trim: 4, v: { size: 0.6, decay: 3.5, mix: 0.35 } });
  return p;
}

function rootAndUpper() {
  const p = patch("Swarm: Root and Upper", {
    module: "swarm", tempo: 100,
    description: "Swarm's Root output is a clean anchor and Upper carries only the oscillators above the root octave. Here the Root goes through a low-pass for the bassline, while Upper is filtered brighter and swept by an LFO for the chord. Use two different filters, or one effect on only one of them.",
    tags: ["outputs", "bass", "filtering", "split"],
  });
  const s = seq(p, [0, 0], [0, 0, ".", 0, 3, ".", 0, 5, 0, 0, ".", 7, 5, ".", 3, "."], { rate: "1/8", root: "G", octave: -1, scale: "Natural Minor", gate: 0.55 });
  const sw = p.add("swarm", [1, 0], { chord: "Minor 7", count: 8, range: 2, spread: 1, warp: 0.6, detune: 12, drift: 0.25, width: 0.9, glide: 0.1 });
  p.cable(s, "pitch", sw, "pitch");
  const bf = p.add("filter", [2, 0], { cutoff: 260, resonance: 0.25, type: "Ladder Tanh", drive: 0.25 }, { name: "Root Filter" });
  const benv = p.add("adsr", [2, 1], { attack: 0.004, decay: 0.2, sustain: 0.6, release: 0.1 }, { name: "Bass Env" });
  const bv = p.add("vca", [3, 0], {}, { name: "Bass VCA" });
  p.cable(sw, "root", bf, "l").cable(s, "gate", benv, "gate").cable(s, "trigger", benv, "retrig").cable(bf, "l", bv, "l").cable(benv, "env", bv, "gain");
  const uf = p.add("filter", [2, 2], { cutoff: 2200, resonance: 0.3, mode: 0.5, type: "SVF Multimode" }, { name: "Upper Filter" });
  const lfo = p.add("lfo", [1, 2], { rate: 0.2, wave: "Triangle" }, { name: "Sweep" });
  const uenv = p.add("adsr", [3, 2], { attack: 0.01, decay: 0.15, sustain: 0.0, release: 0.1 }, { name: "Pluck Env" });
  const uv = p.add("vca", [4, 2], {}, { name: "Upper VCA" });
  p.cable(sw, "upper", uf, "l").cable(lfo, "out", uf, "cutoff", 0.4).cable(s, "gate", uenv, "gate").cable(s, "trigger", uenv, "retrig")
    .cable(uf, "l", uv, "l").cable(uenv, "env", uv, "gain");
  const d = beat(p, [0, 3], { style: "broken", level: -9 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -8, pan2: 0.3, level3: -3, master: 4 }, { name: "Mix" });
  p.cable(bv, "l", mix, "in1l").cable(uv, "l", mix, "in2l").cable(d, "outl", mix, "in3l").cable(d, "outr", mix, "in3r");
  room(p, [6, 0], mix, { from: ["outl", "outr"], mix: 0.2 });
  return p;
}

export default [bloomingPad, supersaw, hirajoshiShimmer, metalCloud, rootAndUpper];
