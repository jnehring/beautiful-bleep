// SPDX-License-Identifier: MIT
// Swarm: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

function seq(p, at, notes, o = {}) {
  return p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/8", root: o.root || "A",
    scale: o.scale || "Minor Pentatonic", octave: o.octave ?? 0, gatelength: o.gate ?? 0.5 }, { data: steps(notes, o.vel) });
}
/// Stereo oscillator → VCA with an ADSR from the sequencer gate. Returns the VCA.
function amp(p, at, s, osc, adsr, from = ["outL", "outR"]) {
  const env = p.add("adsr", at, adsr, { name: "Amp Env" });
  const v = p.add("vca", [at[0] + 1, at[1]], {}, { name: "VCA" });
  p.cable(s, "gate", env, "gate").cable(s, "trigger", env, "retrig").cable(env, "env", v, "gain");
  p.stereo(osc, v, { from });
  return v;
}
function room(p, at, src, o = {}) {
  if (o.trim !== undefined) {  // level trim through a mixer first
    const m = p.add("audio-mixer", [at[0] - 1, at[1] + 1], { level1: o.trim, pan1: -1, level2: o.trim, pan2: 1, master: 0 }, { name: "Trim" });
    p.cable(src, (o.from || ["l", "r"])[0], m, "in1l").cable(src, (o.from || ["l", "r"])[1], m, "in2r");
    src = m; o = { ...o, from: ["outl", "outr"] };
  }
  const v = p.add("reverb", at, { size: 0.6, decay: 3, damping: 0.45, mix: o.mix ?? 0.35, quality: "Eco (8 lines)", ...o.v });
  p.stereo(src, v, { from: o.from || ["l", "r"] }).stereo(v, p.out);
  return v;
}


function bloomPad() {
  const p = patch("Swarm: Blooming Pad", {
    module: "swarm", tempo: 64,
    description: "A slow LFO on Spread opens the swarm from a single note into a full Minor 9 chord and closes it again, while the Spread output also opens a filter, so the pad blooms and fades. Try other Chord entries or a higher Count.",
    tags: ["pad", "bloom", "spread", "chord"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", root: "C", octave: -1, scale: "Natural Minor", gate: 1 });
  const o = p.add("swarm", [1, 0], { count: 12, chord: "Minor 9", spread: 0.3, range: 2, detune: 10, drift: 0.3, width: 0.9 });
  const v = amp(p, [1, 1], s, o, { attack: 1.5, decay: 1, sustain: 0.9, release: 3 }, ["l", "r"]);
  const lfo = p.add("lfo", [0, 1], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "Bloom" });
  const f = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.2 }, { name: "Opening" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "spread", 1).stereo(v, f).cable(o, "spread", f, "cutoff", 0.5);
  room(p, [5, 0], f, { trim: -15, mix: 0.4, v: { decay: 5.5 } });
  return p;
}

function darkCluster() {
  const p = patch("Swarm: Dark Cluster", {
    module: "swarm", tempo: 60,
    description: "A low swarm on the Cluster chord with strong Drift and a little Cross FM: dozens of close-packed pitches beat against each other into a restless, ominous drone. Lower Spread to tighten it, or raise Cross FM for a grittier texture.",
    tags: ["drone", "dark", "cluster", "cross fm"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_", "_"], { rate: "1/4", root: "D", octave: -2, scale: "Chromatic", gate: 1 });
  const o = p.add("swarm", [1, 0], { count: 10, chord: "Cluster", spread: 0.5, range: 1, detune: 14, drift: 0.7, crossfm: 0.12, width: 1 });
  const v = amp(p, [1, 1], s, o, { attack: 2.5, decay: 1, sustain: 1, release: 3 }, ["l", "r"]);
  const lfo = p.add("lfo", [0, 1], { rate: 0.04, wave: "Triangle" }, { name: "Tighten" });
  const f = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.3 }, { name: "Murk" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "spread", 0.4).stereo(v, f);
  room(p, [5, 0], f, { trim: -17, mix: 0.35, v: { decay: 6 } });
  return p;
}

function pentaRain() {
  const p = patch("Swarm: Pentatonic Rain", {
    module: "swarm", tempo: 96,
    description: "The swarm spread over a Major Pentatonic scale with a plucky envelope and Reshuffle fired every bar: each bar the notes rearrange themselves, so the same rhythm rains down in a new order. Try Pattern: Random and a larger Spread.",
    tags: ["pentatonic", "reshuffle", "pluck", "random"],
  });
  const s = seq(p, [0, 0], [0, ".", 0, ".", 0, ".", 0, 0, ".", 0, ".", 0, ".", 0, "."], { rate: "1/8", root: "A", octave: 0, scale: "Major Pentatonic", gate: 0.6 });
  const o = p.add("swarm", [1, 0], { count: 6, chord: "Major Pentatonic", spread: 0.7, range: 2, detune: 5, drift: 0.1, width: 1, pattern: "Random", glide: 0.02 });
  const v = amp(p, [1, 1], s, o, { attack: 0.002, decay: 0.7, sustain: 0.15, release: 0.5 }, ["l", "r"]);
  const bar = p.add("random", [0, 1], { rate: 1, sync: "1 bar", spread: 0 }, { name: "Bar Clock" });
  p.cable(s, "pitch", o, "pitch").cable(bar, "trig", o, "reshuffle");
  room(p, [3, 0], v, { trim: -4, mix: 0.45, v: { decay: 3, size: 0.7 } });
  return p;
}

function superBass() {
  const p = patch("Swarm: Octave Super Bass", {
    module: "swarm", tempo: 118,
    description: "Seven oscillators on the Octaves chord with a wide Detune make a huge, thick bass that holds together over the beat. Try Fifths or a bigger Range for more weight, or reduce Detune for a cleaner tone.",
    tags: ["bass", "unison", "detune", "dance"],
  });
  const s = seq(p, [0, 0], [0, 0, ".", 0, 0, ".", 7, ".", 5, 5, ".", 5, 3, ".", 7, "."], { rate: "1/8", root: "F", octave: -2, scale: "Minor Pentatonic", gate: 0.6 });
  const o = p.add("swarm", [1, 0], { count: 7, chord: "Octaves", spread: 0.5, range: 2, detune: 22, drift: 0.2, width: 0.8, glide: 0.05 });
  const v = amp(p, [1, 1], s, o, { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.1 }, ["l", "r"]);
  const f = p.add("filter", [3, 0], { cutoff: 900, resonance: 0.25 }, { name: "Bass Filter" });
  const fe = p.add("adsr", [3, 1], { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.1 }, { name: "Filter Env" });
  p.cable(s, "pitch", o, "pitch").stereo(v, f).cable(s, "gate", fe, "gate").cable(s, "trigger", fe, "retrig").cable(fe, "env", f, "cutoff", 0.5);
  const drums = beat(p, [0, 3], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -8, level2: -8, pan1: -0.3, pan2: 0.3, level3: -2, level4: -2, master: 0 }, { name: "Main" });
  p.cable(f, "l", mix, "in1l").cable(f, "r", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [5, 0], mix, { from: ["outl", "outr"], mix: 0.1, v: { decay: 1.2 } });
  return p;
}

function glitterFifths() {
  const p = patch("Swarm: Glitter Fifths", {
    module: "swarm", tempo: 90,
    description: "A bright swarm of stacked fifths with Warp pushed up and Cross FM on a slow cycle: the oscillators modulate each other into a glittering, bell-like shimmer. Move Warp and Cross FM to taste.",
    tags: ["shimmer", "fifths", "warp", "cross fm"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_", 10, "_", "_", "_"], { rate: "1/4", root: "E", octave: 0, scale: "Minor Pentatonic", gate: 0.9 });
  const o = p.add("swarm", [1, 0], { count: 8, chord: "Fifths", spread: 0.8, range: 3, detune: 6, drift: 0.3, warp: 0.5, crossfm: 0.15, width: 1 });
  const v = amp(p, [1, 1], s, o, { attack: 0.3, decay: 1.2, sustain: 0.4, release: 1.5 }, ["l", "r"]);
  const l1 = p.add("lfo", [0, 1], { rate: 0.08 }, { name: "Warp" });
  const l2 = p.add("lfo", [0, 2], { rate: 0.12, wave: "Triangle" }, { name: "Cross" });
  p.cable(s, "pitch", o, "pitch").cable(l1, "out", o, "warp", 0.4).cable(l2, "out", o, "crossfm", 0.12);
  room(p, [3, 0], v, { trim: 0, mix: 0.4, v: { decay: 4 } });
  return p;
}

export default [bloomPad, darkCluster, pentaRain, superBass, glitterFifths];
