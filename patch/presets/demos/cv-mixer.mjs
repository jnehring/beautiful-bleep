// SPDX-License-Identifier: MIT
// CV Mixer: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function summed() {
  const p = patch("CV Mixer: Three Waves Summed", {
    module: "cv-mixer", tempo: 100,
    description: "A sine, a triangle and a stepped random line are added by the CV Mixer in Sum mode, and the result sweeps the arpeggio's filter in a pattern that takes a long time to come round. Pull a channel's Level to zero to hear its share disappear.",
    tags: ["sum", "modulation", "filter sweep", "layered lfos"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 10, 12, 7, 15, 10], { rate: "1/8", shape: 0.85, root: "G", scale: "Minor Pentatonic", gatelength: 0.45,
    env: { attack: 0.003, decay: 0.22, sustain: 0.15, release: 0.15 } });
  const l1 = p.add("lfo", [0, 2], { rate: 0.17 }, { name: "Sine" });
  const l2 = p.add("lfo", [0, 3], { wave: "Triangle", rate: 0.41 }, { name: "Triangle" });
  const l3 = p.add("lfo", [0, 4], { wave: "Random Step", sync: "Tempo", division: "1/2" }, { name: "Steps" });
  const cv = p.add("cv-mixer", [1, 2], { mode: "Sum", level1: 0.7, level2: 0.5, level3: 0.4, clip: "Soft" });
  const f = p.add("filter", [3, 0], { cutoff: 600, resonance: 0.35, type: "Ladder Tanh" });
  p.cable(l1, "out", cv, "in1").cable(l2, "out", cv, "in2").cable(l3, "out", cv, "in3").cable(cv, "out", f, "cutoff", 0.35).cable(m.amp, "l", f, "l");
  finish(p, [4, 0], f, "l", 5, { decay: 2.4 });
  return p;
}

function average() {
  const p = patch("CV Mixer: Averaged Drift", {
    module: "cv-mixer", tempo: 72,
    description: "Four smooth random lines are averaged into one gentle, never-settling signal that detunes a two-voice pad, so the chord drifts in and out of tune with itself. Change Mode to Sum for a wilder drift, or raise Master to deepen it.",
    tags: ["average", "drift", "detune", "pad", "random"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "C", scale: "Major", octave: 0, gatelength: 1 },
    { data: steps([0, 5, 7, 4]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.75 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.75, coarse: 7, octave: "0" });
  const rs = [0, 1, 2, 3].map((i) => p.add("random", [0, 2 + i], { rate: 0.4 + 0.17 * i, smooth: 1, sync: "Free", seed: 3 + i, spread: 1 }, { name: `Drift ${i + 1}` }));
  const cv = p.add("cv-mixer", [1, 3], { mode: "Average", level1: 1, level2: 1, level3: 1, level4: 1, master: 1 });
  rs.forEach((r, i) => p.cable(r, "out", cv, "in" + (i + 1)));
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, level2: -9, pan1: -0.3, pan2: 0.3, master: 2 });
  const f = p.add("filter", [3, 0], { cutoff: 1500, resonance: 0.1, type: "SVF Multimode" });
  const env = p.add("adsr", [2, 3], { attack: 0.9, decay: 0.5, sustain: 0.8, release: 1.5 });
  const vca = p.add("vca", [4, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(cv, "out", o1, "pitch", 0.03).cable(cv, "out", o2, "pitch", -0.03)
    .cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r").cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r")
    .stereo(mix, f, { from: ["outl", "outr"] }).stereo(f, vca).cable(seq, "gate", env, "gate").cable(env, "env", vca, "gain");
  const v = p.add("reverb", [5, 0], { size: 0.7, decay: 5, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(vca, v).stereo(v, p.out);
  return p;
}

function maxSwell() {
  const p = patch("CV Mixer: Max Swells", {
    module: "cv-mixer", tempo: 84,
    description: "Two unipolar LFOs at different speeds go into Max mode, which always passes the larger one, so the pad swells whenever either wave rises and the volume rarely falls to silence. Switch to Min to hear it only when both are high.",
    tags: ["max", "swell", "tremolo", "pad"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "A", scale: "Dorian", octave: 0, gatelength: 1 },
    { data: steps([0, 3, 7, 5]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.7, fine: -5 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.7, fine: 5, coarse: 7 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, level2: -9, pan1: -0.4, pan2: 0.4, master: 2 });
  const l1 = p.add("lfo", [0, 3], { sync: "Tempo", division: "2 bars", polarity: "Unipolar" }, { name: "Slow" });
  const l2 = p.add("lfo", [0, 4], { wave: "Triangle", sync: "Tempo", division: "1/1", polarity: "Unipolar", phase: 90 }, { name: "Faster" });
  const cv = p.add("cv-mixer", [1, 3], { mode: "Max", level1: 1, level2: 0.8 });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r")
    .cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r").stereo(mix, vca, { from: ["outl", "outr"] })
    .cable(l1, "out", cv, "in1").cable(l2, "out", cv, "in2").cable(cv, "out", vca, "gain");
  const v = p.add("reverb", [4, 0], { size: 0.65, decay: 4, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(vca, v).stereo(v, p.out);
  return p;
}

function minGate() {
  const p = patch("CV Mixer: Min as a Gate Maker", {
    module: "cv-mixer", tempo: 116,
    description: "Two square LFOs of different lengths go into Min mode, which only stays high while both are high, an AND of the two, and the result opens the envelope on a held chord to cut it into a shifting rhythm. Change either LFO's sync to rewrite the pattern.",
    tags: ["min", "gate", "rhythm", "polyrhythm"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 2, rate: "1/1", root: "D", scale: "Natural Minor", octave: 0, gatelength: 1 },
    { data: steps([0, 5]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.7 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.7, coarse: 7 });
  const o3 = p.add("oscillator", [1, 2], { shape: 0.7, coarse: 3, octave: "+1" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -10, level3: -13, pan1: -0.3, pan3: 0.3, master: 0 });
  const a = p.add("lfo", [0, 4], { wave: "Square", sync: "Tempo", division: "1/8", polarity: "Unipolar", pw: 0.7 }, { name: "Eighths" });
  const b = p.add("lfo", [0, 5], { wave: "Square", sync: "Tempo", division: "1/4", polarity: "Unipolar", pw: 0.6, phase: 40 }, { name: "Quarters" });
  const cv = p.add("cv-mixer", [1, 4], { mode: "Min", level1: 1, level2: 1, clip: "Hard" });
  const env = p.add("adsr", [2, 4], { attack: 0.004, decay: 0.15, sustain: 0.6, release: 0.1 });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(seq, "pitch", o3, "pitch")
    .cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r").cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r")
    .cable(o3, "out", mix, "in3l").cable(o3, "out", mix, "in3r").stereo(mix, vca, { from: ["outl", "outr"] })
    .cable(a, "out", cv, "in1").cable(b, "out", cv, "in2").cable(cv, "out", env, "gate").cable(env, "env", vca, "gain");
  const drums = beat(p, [0, 7], { style: "sparse", level: -8 });
  const fm = p.add("audio-mixer", [4, 0], { level1: 0, level2: -4, master: 0 });
  p.stereo(vca, fm, { to: ["in1l", "in1r"] }).stereo(drums, fm, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.8, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(fm, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function scan() {
  const p = patch("CV Mixer: Scanning Four Notes", {
    module: "cv-mixer", tempo: 106,
    description: "Four stepped random lines sit in the four channels and Scan, swept by a slow triangle, fades from one to the next; the result is snapped to a scale to play the oscillator, so the tune walks between four moving lines. Move Scan by hand to pick which channel you hear.",
    tags: ["scan", "crossfade", "generative", "melody"],
  });
  const clock = p.add("lfo", [0, 0], { wave: "Square", sync: "Tempo", division: "1/8", polarity: "Unipolar", pw: 0.5 }, { name: "Clock" });
  const rs = [0, 1, 2, 3].map((i) => p.add("random", [0, 1 + i], { rate: 1, sync: "1/2", seed: 11 + i * 7, spread: 1 }, { name: `Line ${i + 1}` }));
  const cv = p.add("cv-mixer", [1, 2], { mode: "Scan", scan: 0.5, master: 1 });
  rs.forEach((r, i) => p.cable(r, "out", cv, "in" + (i + 1)));
  const sweep = p.add("lfo", [1, 5], { wave: "Triangle", rate: 0.07, polarity: "Unipolar" }, { name: "Scan Sweep" });
  p.cable(sweep, "out", cv, "scan");
  const q = p.add("quantizer", [2, 0], { root: "A", scale: "Minor Pentatonic", range: 1.2 });
  const osc = p.add("oscillator", [3, 0], { shape: 0.65 });
  const env = p.add("adsr", [3, 1], { attack: 0.004, decay: 0.25, sustain: 0.15, release: 0.2 });
  const f = p.add("filter", [4, 0], { cutoff: 1800, resonance: 0.2, type: "Ladder Tanh" });
  const vca = p.add("vca", [5, 0], {});
  p.cable(cv, "out", q, "in").cable(clock, "out", q, "clock").cable(q, "out", osc, "pitch").cable(clock, "out", env, "gate")
    .cable(osc, "out", f, "l").cable(f, "l", vca, "l").cable(env, "env", vca, "gain");
  finish(p, [6, 0], vca, "l", 3, { decay: 2.5 });
  return p;
}

export default [summed, average, maxSwell, minGate, scan];
