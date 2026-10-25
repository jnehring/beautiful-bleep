// SPDX-License-Identifier: MIT
// Select: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

/// A plucked voice: pitch → Oscillator → VCA with an ADSR from gate/retrigger. Returns the VCA ("l").
function pluck(p, at, pitch, gate, retrig, osc = {}, env = {}) {
  const o = p.add("oscillator", [at[0], at[1]], { shape: 0.7, ...osc }, { name: "Voice" });
  const e = p.add("adsr", [at[0], at[1] + 1], { attack: 0.005, decay: 0.25, sustain: 0, release: 0.2, ...env }, { name: "Amp Env" });
  const a = p.add("vca", [at[0] + 1, at[1]], {}, { name: "VCA" });
  p.cable(pitch[0], pitch[1], o, "pitch").cable(gate[0], gate[1], e, "gate").cable(retrig[0], retrig[1], e, "retrig")
    .cable(o, "out", a, "l").cable(e, "env", a, "gain");
  return a;
}

function threeScales() {
  const p = patch("Select: Three Scales in Turn", {
    module: "select", tempo: 104,
    description: "One wandering random value goes into three Quantizers set to different scales; the Select hands the melody to the next scale every bar with a short crossfade. Set Order to Random, or turn the Select knob by hand.",
    tags: ["quantizer", "scale", "trigger", "bar by bar"],
  });
  const clk = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", gatelength: 0.5 }, { data: steps([0, 0, 0, ".", 0, 0, ".", 0]) }, { name: "Clock" });
  const rnd = p.add("random", [0, 2], { rate: 4, sync: "1/8", spread: 0.7, bias: 0, smooth: 0, seed: 21 }, { name: "Wander" });
  const bar = p.add("lfo", [0, 4], { wave: "Square", sync: "Tempo", division: "1/1", polarity: "Unipolar", pw: 0.1 }, { name: "Bar Clock" });
  const scales = [["C", "Major Pentatonic"], ["A", "Minor Pentatonic"], ["D", "Dorian"]];
  const q = scales.map(([root, scale], i) => p.add("quantizer", [1, i], { root, scale, range: 1.5, hysteresis: 0 }, { name: scale }));
  const sel = p.add("select", [2, 1], { inputs: 3, fade: 0.01 });
  q.forEach((x, i) => p.cable(rnd, "out", x, "in", 0.8).cable(clk, "trigger", x, "clock").cable(x, "out", sel, "in" + (i + 1)));
  p.cable(bar, "out", sel, "next");
  const amp = pluck(p, [3, 0], [sel, "out"], [q[0], "gate"], [clk, "trigger"]);
  const drums = beat(p, [0, 6], { style: "broken", level: -10 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 3, level2: 0, master: -3 });
  p.cable(amp, "l", mix, "in1l").cable(amp, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function sweptTimbres() {
  const p = patch("Select: A Slow LFO Sweeps the Sources", {
    module: "select", tempo: 90,
    description: "Four oscillators play the same riff and a slow triangle LFO on the Select knob sweeps through them, so the sound changes shape by itself. The Fade of 80 ms blends neighbours; set it to 0 for hard cuts or 600 ms for a smooth morph.",
    tags: ["lfo", "timbre", "cv", "sweep"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 7, 3, 10, 12, 10, 7, 3]) });
  const env = p.add("adsr", [0, 1], { attack: 0.003, decay: 0.2, sustain: 0.3, release: 0.15 }, { name: "Amp Env" });
  const shapes = [{ shape: 0 }, { shape: 0.5, pw: 0.25 }, { shape: 0.85 }, { shape: 0.9, octave: "+1" }];
  const o = shapes.map((s, i) => p.add("oscillator", [1, i], s, { name: "Source " + (i + 1) }));
  const sel = p.add("select", [2, 0], { inputs: 4, fade: 0.08 });
  const lfo = p.add("lfo", [2, 2], { rate: 0.08, wave: "Triangle", polarity: "Unipolar" }, { name: "Sweep" });
  o.forEach((x, i) => p.cable(seq, "pitch", x, "pitch").cable(x, "out", sel, "in" + (i + 1)));
  p.cable(lfo, "out", sel, "select");
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(sel, "out", vca, "l").cable(env, "env", vca, "gain");
  const f = p.add("filter", [4, 0], { cutoff: 2400, resonance: 0.15, type: "SVF Multimode" });
  p.cable(vca, "l", f, "l");
  const drums = beat(p, [0, 6], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 4, level2: -4, master: -1 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2.2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function alternating() {
  const p = patch("Select: A/B Melodies on a Gate", {
    module: "select", tempo: 112,
    description: "Two different sequences feed a two-input Select, and a square LFO used as a gate on the Select knob flips between them every two bars: low plays the first melody, high the second. With only two inputs, any gate is an A/B switch.",
    tags: ["gate", "ab", "melody", "two inputs"],
  });
  const a = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 }, { data: steps([0, 3, 7, 10, 7, 3, 0, ".",]) }, { name: "Melody A" });
  const b = p.add("step-sequencer", [0, 2], { length: 8, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 1, gatelength: 0.4 }, { data: steps([12, ".", 10, 7, 12, ".", 14, 10]) }, { name: "Melody B" });
  const sel = p.add("select", [1, 0], { inputs: 2, fade: 0 }, { name: "Pitch A/B" });
  const gsel = p.add("select", [1, 2], { inputs: 2, fade: 0 }, { name: "Gate A/B" });
  const flip = p.add("lfo", [1, 4], { wave: "Square", sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Every 2 Bars" });
  p.cable(a, "pitch", sel, "in1").cable(b, "pitch", sel, "in2").cable(a, "gate", gsel, "in1").cable(b, "gate", gsel, "in2")
    .cable(flip, "out", sel, "select").cable(flip, "out", gsel, "select");
  const osc = p.add("oscillator", [2, 0], { shape: 0.75 }, { name: "Voice" });
  const env = p.add("adsr", [2, 1], { attack: 0.004, decay: 0.2, sustain: 0.25, release: 0.15 }, { name: "Amp Env" });
  const amp = p.add("vca", [3, 0], {});
  p.cable(sel, "out", osc, "pitch").cable(gsel, "out", env, "gate").cable(a, "trigger", env, "retrig").cable(b, "trigger", env, "retrig")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  const drums = beat(p, [0, 6], { style: "four", level: -10 });
  const mix = p.add("audio-mixer", [4, 0], { level1: 3, level2: -2, master: -2 });
  p.cable(amp, "l", mix, "in1l").cable(amp, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.6, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function drumPicker() {
  const p = patch("Select: Slot Triggers Pick the Drum", {
    module: "select", tempo: 116,
    description: "Slot Triggers is set to 3: a trigger on Trig 1, 2 or 3 jumps straight to that input. Two lanes of the Drum Grid pick between kick, snare and clap, so the one voice the Select lets through changes with the groove. Remove a cable to hear just one drum.",
    tags: ["slot triggers", "drums", "trigger", "jump"],
  });
  const g = p.add("drum-grid", [0, 0], {}, { name: "Groove", data: drumGrid(["Hit", "Pick 1", "Pick 2", "Pick 3", "", "", "", ""],
    [pattern("Groove", ["x..x..x..x.x..x.", "x...............", "....x.......x...", "..x...x...x...x."])]) });
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.7 });
  const clap = p.add("punch-clap", [1, 2], { level: 0.7 });
  const sel = p.add("select", [2, 1], { inputs: 3, fade: 0, trigs: 3 });
  [kick, snare, clap].forEach((d, i) => p.cable(g, "gate1", d, "trig").cable(d, "out", sel, "in" + (i + 1)));
  p.cable(g, "gate2", sel, "trig1").cable(g, "gate3", sel, "trig2").cable(g, "gate4", sel, "trig3");
  const hats = p.add("punch-hats", [2, 4], { level: 0.45 });
  p.cable(g, "gate1", hats, "closed");
  const m = melody(p, [0, 6], [0, ".", 0, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.3, root: "E", scale: "Natural Minor", octave: -2, gatelength: 0.7,
    env: { decay: 0.25, sustain: 0.4, release: 0.1 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -10, level3: -4, master: -4 });
  p.cable(sel, "out", mix, "in1l").cable(sel, "out", mix, "in1r").cable(hats, "out", mix, "in2l").cable(hats, "out", mix, "in2r")
    .cable(m.amp, "l", mix, "in3l").cable(m.amp, "l", mix, "in3r");
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.6, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function followTheSong() {
  const p = patch("Select: Rotating with the Song", {
    module: "select", tempo: 84,
    description: "With nothing patched into Next, the Select follows the song at its Rate: one new drone every two bars, in Ping-Pong order, with a one-second crossfade. Lengthen Fade for a slow morph, or choose Random and another Seed.",
    tags: ["transport", "rate", "ping-pong", "ambient"],
  });
  const notes = [{ coarse: -5 }, { coarse: 0 }, { coarse: 4 }, { coarse: 7 }];
  const os = notes.map((n, i) => p.add("oscillator", [0, i], { shape: i % 2 ? 0.15 : 0, fine: (i - 1.5) * 4, ...n }, { name: `Drone ${i + 1}` }));
  const sel = p.add("select", [1, 0], { inputs: 4, rate: "2 bars", order: "Ping-Pong", fade: 1.0, curve: "Equal Power" });
  os.forEach((o, i) => p.cable(o, "out", sel, "in" + (i + 1)));
  const f = p.add("filter", [2, 0], { cutoff: 1400, resonance: 0.15, type: "SVF Multimode" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.1 }, { name: "Breath" });
  p.cable(sel, "out", f, "l").cable(lfo, "out", f, "cutoff", 0.1);
  const m = melody(p, [0, 5], [0, ".", ".", 7, ".", ".", 12, ".", 4, ".", ".", 9, ".", ".", ".", "."], { rate: "1/4", shape: 0.1, root: "C", scale: "Major Pentatonic", octave: 1, gatelength: 0.3,
    env: { decay: 0.8, sustain: 0, release: 0.8 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -12, level2: -9, master: 0 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").cable(m.amp, "l", mix, "in2l").cable(m.amp, "l", mix, "in2r");
  const v = p.add("reverb", [5, 0], { size: 0.8, decay: 6, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [threeScales, sweptTimbres, alternating, drumPicker, followTheSong];
