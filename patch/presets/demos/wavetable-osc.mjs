// SPDX-License-Identifier: MIT
// Wavetable Osc: five demo patches. Each plays by itself with the transport.
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


function morphPad() {
  const p = patch("Wavetable Osc: Morphing Pad", {
    module: "wavetable-osc", tempo: 70,
    description: "A slow triangle LFO on Scan walks the Analog bank along the Snake path, smoothly blending one cycle into the next, with a little Stereo spread. Try another Bank or Path, or switch Frame Blend to Step for stair-stepped changes.",
    tags: ["pad", "scan", "morph", "evolving"],
  });
  const s = seq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "C", octave: -1, scale: "Natural Minor", gate: 1 });
  const o = p.add("wavetable-osc", [1, 0], { bank: "Analog", scan: 0.1, stereo: 0.3, subLevel: 0.2, path: "Snake" });
  const v = amp(p, [1, 1], s, o, { attack: 1.2, decay: 1, sustain: 0.9, release: 2.5 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.045, wave: "Triangle", polarity: "Unipolar" }, { name: "Scan Sweep" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "scan", 0.9);
  room(p, [3, 0], v, { trim: -14, mix: 0.4, v: { decay: 5 } });
  return p;
}

function vowelTalker() {
  const p = patch("Wavetable Osc: Vowel Talker", {
    module: "wavetable-osc", tempo: 98,
    description: "The Vowel bank with X and Y pushed around by two random generators, so a short tune seems to speak in changing vowels. Set X and Y by hand to pick a single vowel, or lock the Random Loop for a repeating phrase.",
    tags: ["vowel", "random", "melody", "voice"],
  });
  const s = seq(p, [0, 0], [0, 3, 7, 3, 5, 7, 10, 7, 12, 10, 7, 5, 3, 5, 0, "."], { rate: "1/8", root: "G", octave: -1, scale: "Minor Pentatonic", gate: 0.75 });
  const o = p.add("wavetable-osc", [1, 0], { bank: "Vowel", x: 0.3, y: 0.3, stereo: 0.2 });
  const v = amp(p, [1, 1], s, o, { attack: 0.02, decay: 0.2, sustain: 0.75, release: 0.25 });
  const rx = p.add("random", [0, 1], { rate: 4, sync: "1/8", spread: 0.9, smooth: 0.5, seed: 5 }, { name: "X Wander" });
  const ry = p.add("random", [0, 2], { rate: 4, sync: "1/4", spread: 0.9, smooth: 0.6, seed: 12 }, { name: "Y Wander" });
  p.cable(s, "pitch", o, "pitch").cable(rx, "out", o, "x", 0.5).cable(ry, "out", o, "y", 0.5);
  room(p, [3, 0], v, { trim: -3, mix: 0.25, v: { decay: 2 } });
  return p;
}

function bellBank() {
  const p = patch("Wavetable Osc: Bell Garden", {
    module: "wavetable-osc", tempo: 82,
    description: "Struck notes from the Bell bank with Y moved by the note envelope: each bell starts bright and metallic and fades toward a plain tone. Try a different X position for other bell colours.",
    tags: ["bell", "pluck", "envelope", "metallic"],
  });
  const s = seq(p, [0, 0], [0, ".", 7, ".", 12, ".", 10, 7, ".", 5, ".", 3, ".", 7, ".", "."], { rate: "1/8", root: "E", octave: 1, scale: "Minor Pentatonic" });
  const o = p.add("wavetable-osc", [1, 0], { bank: "Bell", x: 0.4, y: 0.1, stereo: 0.4, read: "Cubic" });
  const v = amp(p, [1, 1], s, o, { attack: 0.002, decay: 1.8, sustain: 0, release: 1 });
  const ye = p.add("adsr", [0, 1], { attack: 0.002, decay: 0.8, sustain: 0, release: 0.5 }, { name: "Bright Env" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", ye, "gate").cable(s, "trigger", ye, "retrig").cable(ye, "env", o, "y", 0.8);
  room(p, [3, 0], v, { trim: 0, mix: 0.4, v: { decay: 4, size: 0.7 } });
  return p;
}

function warpBass() {
  const p = patch("Wavetable Osc: Warp Bass", {
    module: "wavetable-osc", tempo: 112,
    description: "A Digital bank bass with Warp in Sync mode, opened on every note by an envelope for a tearing, vocal attack that settles into a solid tone, plus a Sub for weight. Try other Warp Modes such as Mirror or Squash.",
    tags: ["bass", "warp", "sub", "dance"],
  });
  const s = seq(p, [0, 0], [0, 0, ".", 0, 0, ".", 7, ".", 5, 5, ".", 5, 3, ".", 7, "."], { rate: "1/8", root: "A", octave: -2, scale: "Minor Pentatonic", gate: 0.6 });
  const o = p.add("wavetable-osc", [1, 0], { bank: "Digital", x: 0.35, y: 0.2, warp: 0.2, subLevel: 0.5, warpMode: "Sync" });
  const v = amp(p, [1, 1], s, o, { attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.1 });
  const we = p.add("adsr", [0, 1], { attack: 0.002, decay: 0.3, sustain: 0.15, release: 0.15 }, { name: "Warp Env" });
  p.cable(s, "pitch", o, "pitch").cable(s, "gate", we, "gate").cable(s, "trigger", we, "retrig").cable(we, "env", o, "warp", 0.7);
  const drums = beat(p, [0, 3], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -6, pan1: -0.2, level2: -6, pan2: 0.2, level3: -2, level4: -2, master: 0 }, { name: "Main" });
  p.cable(v, "l", mix, "in1l").cable(v, "r", mix, "in2r").cable(drums, "outl", mix, "in3l").cable(drums, "outr", mix, "in4r");
  room(p, [4, 0], mix, { from: ["outl", "outr"], mix: 0.1, v: { decay: 1.2 } });
  return p;
}

function spiralCrawl() {
  const p = patch("Wavetable Osc: Spiral Crawl", {
    module: "wavetable-osc", tempo: 90,
    description: "A repeating arpeggio in the Spectra bank while Scan crawls along the Spiral path from the middle outward; the X and Y position outputs open a filter, so the table's movement shapes the whole sound. Try Columns or Diagonal paths.",
    tags: ["spiral", "path", "arpeggio", "position outputs"],
  });
  const s = seq(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 12, 5, 2, 7, 10, 7], { rate: "1/16", root: "D", octave: 0, scale: "Dorian", gate: 0.5 });
  const o = p.add("wavetable-osc", [1, 0], { bank: "Spectra", scan: 0, path: "Spiral", stereo: 0.3, subLevel: 0.1 });
  const v = amp(p, [1, 1], s, o, { attack: 0.003, decay: 0.2, sustain: 0.3, release: 0.15 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.07, wave: "Saw Up", polarity: "Unipolar" }, { name: "Crawl" });
  const f = p.add("filter", [3, 0], { cutoff: 600, resonance: 0.3 }, { name: "Follow" });
  p.cable(s, "pitch", o, "pitch").cable(lfo, "out", o, "scan", 1).stereo(v, f).cable(o, "posX", f, "cutoff", 0.5);
  room(p, [5, 0], f, { trim: 3, mix: 0.3, v: { decay: 2.4 } });
  return p;
}

export default [morphPad, vowelTalker, bellBank, warpBass, spiralCrawl];
