// SPDX-License-Identifier: MIT
// Attenuverter: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function opposite() {
  const p = patch("Attenuverter: Opposite Sweeps", {
    module: "attenuverter", tempo: 104,
    description: "One slow LFO enters two rows of the Attenuverter, one scaled +1 and one -1, and they open the left filter while closing the right one, so the arpeggio seems to travel across the stereo field. Change the scale of either row to unbalance the sweep.",
    tags: ["invert", "stereo", "filter sweep", "arpeggio"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10], { rate: "1/8", shape: 0.9, root: "F", scale: "Natural Minor", gatelength: 0.45,
    env: { attack: 0.003, decay: 0.2, sustain: 0.2, release: 0.15 } });
  const lfo = p.add("lfo", [0, 2], { rate: 0.18 }, { name: "Slow Sweep" });
  const a = p.add("attenuverter", [1, 2], { scale1: 1, scale2: -1 });
  const fl = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.3, type: "Ladder Tanh" }, { name: "Left Filter" });
  const fr = p.add("filter", [3, 1], { cutoff: 700, resonance: 0.3, type: "Ladder Tanh" }, { name: "Right Filter" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -2, pan1: -0.85, pan2: 0.85, master: 5 });
  p.cable(lfo, "out", a, "in1").cable(lfo, "out", a, "in2").cable(a, "out1", fl, "cutoff", 0.3).cable(a, "out2", fr, "cutoff", 0.3)
    .cable(m.amp, "l", fl, "l").cable(m.amp, "l", fr, "l").cable(fl, "l", mix, "in1l").cable(fl, "l", mix, "in1r")
    .cable(fr, "l", mix, "in2l").cable(fr, "l", mix, "in2r");
  const v = p.add("reverb", [5, 0], { size: 0.5, decay: 2.2, mix: 0.22, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function offsets() {
  const p = patch("Attenuverter: Manual Offsets", {
    module: "attenuverter", tempo: 92,
    description: "With nothing patched in, each Attenuverter row is a constant set by its Offset: row 1 transposes the sequencer up a fourth and row 2 holds the filter at a fixed opening. Turn Offset 1 to change key while the music plays.",
    tags: ["offset", "constant", "transpose", "manual control"],
  });
  const a = p.add("attenuverter", [0, 2], { offset1: 0.4167, offset2: 0.3 });
  const m = melody(p, [0, 0], [0, 3, 7, 3, 10, 7, 3, 5], { rate: "1/8", shape: 0.7, root: "C", scale: "Minor Pentatonic", gatelength: 0.5,
    env: { decay: 0.3, sustain: 0.3, release: 0.2 } });
  const f = p.add("filter", [3, 0], { cutoff: 300, resonance: 0.3, type: "Ladder Tanh" });
  p.cable(a, "out1", m.seq, "transpose").cable(a, "out2", f, "cutoff", 0.5).cable(m.amp, "l", f, "l");
  const drums = beat(p, [0, 4], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 3, level2: -6, master: 0 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [5, 0], { size: 0.5, decay: 2.2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function summed() {
  const p = patch("Attenuverter: Wandering Sum", {
    module: "attenuverter", tempo: 98,
    description: "Three unrelated modulators, a slow sine, a triangle and a smooth random line, go into three rows and meet at the Sum output, which sweeps the filter along a path that rarely repeats. Change a row's scale to give one modulator more say.",
    tags: ["sum", "modulation mix", "wandering", "filter"],
  });
  const m = melody(p, [0, 0], [0, 12, 7, 12, 3, 15, 10, 7], { rate: "1/8", shape: 0.85, root: "D", scale: "Dorian", gatelength: 0.5,
    env: { attack: 0.003, decay: 0.25, sustain: 0.2, release: 0.15 } });
  const l1 = p.add("lfo", [0, 2], { rate: 0.11 }, { name: "Sine" });
  const l2 = p.add("lfo", [0, 3], { wave: "Triangle", rate: 0.29 }, { name: "Triangle" });
  const r = p.add("random", [0, 4], { rate: 0.7, smooth: 0.9, sync: "Free" }, { name: "Drift" });
  const a = p.add("attenuverter", [1, 2], { scale1: 0.8, scale2: 0.5, scale3: 0.6 });
  const f = p.add("filter", [3, 0], { cutoff: 600, resonance: 0.35, type: "Ladder Tanh" });
  p.cable(l1, "out", a, "in1").cable(l2, "out", a, "in2").cable(r, "out", a, "in3").cable(a, "sum", f, "cutoff", 0.35).cable(m.amp, "l", f, "l");
  finish(p, [4, 0], f, "l", 6, { decay: 2.5 });
  return p;
}

function clipped() {
  const p = patch("Attenuverter: Hard-Clipped Sweep", {
    module: "attenuverter", tempo: 110,
    description: "A triangle LFO is doubled by the row's Scale and hard-clipped, so the filter spends most of the time fully open or fully closed and only moves quickly in between. Set Clip to Off or Soft to round the sweep, or lower Scale to reduce the effect.",
    tags: ["clip", "gain", "filter", "shaped modulation"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 0, 7, 12], { rate: "1/16", shape: 0.95, root: "E", scale: "Natural Minor", octave: -1, gatelength: 0.5,
    env: { attack: 0.003, decay: 0.12, sustain: 0.5, release: 0.08 } });
  const lfo = p.add("lfo", [0, 2], { wave: "Triangle", sync: "Tempo", division: "2 bars" }, { name: "Triangle" });
  const a = p.add("attenuverter", [1, 2], { scale1: 2, offset1: 0, clip: "Hard" });
  const f = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.4, type: "Ladder Tanh", drive: 0.2 });
  p.cable(lfo, "out", a, "in1").cable(a, "out1", f, "cutoff", 0.3).cable(m.amp, "l", f, "l");
  const drums = beat(p, [0, 4], { style: "four", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, level2: -6, master: -1 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function ducking() {
  const p = patch("Attenuverter: Kick Ducking", {
    module: "attenuverter", tempo: 122,
    description: "A kick's envelope goes through a row set to scale -1 with offset +1, turning a short burst into a short dip, and that dip pumps the volume of a chord pad on every beat. Lower the negative Scale for a gentler duck.",
    tags: ["ducking", "sidechain", "invert", "pad", "dance"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "A", scale: "Natural Minor", octave: 0, gatelength: 1 },
    { data: steps([0, 8, 5, 7]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.8, fine: -6 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.8, fine: 6, coarse: 7 });
  const o3 = p.add("oscillator", [1, 2], { shape: 0.8, coarse: 4, octave: "+1" });
  const pm = p.add("audio-mixer", [2, 0], { level1: -7, level2: -9, level3: -12, pan1: -0.4, pan3: 0.4, master: 0 });
  const f = p.add("filter", [3, 0], { cutoff: 1800, resonance: 0.1, type: "SVF Multimode" });
  const vca = p.add("vca", [4, 0], {});
  const drums = beat(p, [0, 4], { style: "four", level: -6 });
  const grid = p.nodes.find((n) => n.type === "drum-grid");
  const kickEnv = p.add("adsr", [1, 4], { attack: 0.005, decay: 0.28, sustain: 0, release: 0.2 }, { name: "Kick Envelope" });
  const a = p.add("attenuverter", [2, 4], { scale1: -0.9, offset1: 1 });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(seq, "pitch", o3, "pitch")
    .cable(o1, "out", pm, "in1l").cable(o1, "out", pm, "in1r").cable(o2, "out", pm, "in2l").cable(o2, "out", pm, "in2r")
    .cable(o3, "out", pm, "in3l").cable(o3, "out", pm, "in3r").stereo(pm, f, { from: ["outl", "outr"] }).stereo(f, vca);
  p.cable(grid, "gate1", kickEnv, "gate").cable(kickEnv, "env", a, "in1").cable(a, "out1", vca, "gain");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -3, master: 0 });
  p.stereo(vca, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [opposite, offsets, summed, clipped, ducking];
