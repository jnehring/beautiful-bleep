// SPDX-License-Identifier: MIT
// Folder (wavefolder): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Folder (l/r) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function complexVoice() {
  const p = patch("Folder: Complex Voice", {
    module: "wavefolder", tempo: 100,
    description: "The Folder's internal sine, played from a sequencer's pitch, is folded harder as an envelope opens Fold: every note starts bright and metallic, then relaxes toward a pure tone. Change Fold, Symmetry or Tap for other timbres.",
    tags: ["complex oscillator", "internal oscillator", "envelope", "lead"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 3, 7, 3, 10, 7, 3, 0, 5, 7, 12, 10, 7, 5, 3, 7]) });
  const env = p.add("adsr", [1, 1], { attack: 0.003, decay: 0.35, sustain: 0.1, release: 0.3 }, { name: "Fold Env" });
  const amp = p.add("adsr", [2, 1], { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.25 }, { name: "Amp Env" });
  const f = p.add("wavefolder", [1, 0], { wave: 0, fold: 0.1, symmetry: 0.15, tap: 6, level: 0.9, source: "Internal" });
  const vca = p.add("vca", [2, 0], {});
  p.cable(seq, "pitch", f, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", f, "fold", 0.7)
    .cable(seq, "gate", amp, "gate").cable(seq, "trigger", amp, "retrig").cable(amp, "env", vca, "gain").stereo(f, vca);
  finish(p, [3, 0], vca, -4, { decay: 3, mix: 0.25 });
  return p;
}

function wobbleBass() {
  const p = patch("Folder: Moving Bass", {
    module: "wavefolder", tempo: 92,
    description: "A low sine from the Folder's own oscillator, with slow LFOs on Symmetry and Tap, turns from hollow to buzzy and back. Raise Fold for more teeth, or turn Octave up for a lead.",
    tags: ["bass", "symmetry", "tap", "lfo"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "F", scale: "Natural Minor", octave: -2, gatelength: 0.8 },
    { data: steps([0, "_", 0, ".", 3, "_", ".", 5, 0, "_", 0, ".", 7, "_", 5, 3]) });
  const f = p.add("wavefolder", [1, 0], { fold: 0.45, symmetry: 0.3, tap: 4, level: 0.8, source: "Internal", wave: 0.15 });
  const env = p.add("adsr", [2, 1], { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.12 }, { name: "Amp Env" });
  const vca = p.add("vca", [2, 0], {});
  const l1 = p.add("lfo", [1, 1], { rate: 0.2, wave: "Sine" }, { name: "Symmetry" });
  const l2 = p.add("lfo", [1, 2], { wave: "Triangle", sync: "2 bars" }, { name: "Tap" });
  p.cable(seq, "pitch", f, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", vca, "gain")
    .cable(l1, "out", f, "symmetry", 0.6).cable(l2, "out", f, "tap", 0.4).stereo(f, vca);
  const drums = beat(p, [0, 4], { style: "half", level: -5 });
  const mix = p.add("audio-mixer", [3, 0], { level1: -4, level2: -7, master: -1 });
  p.stereo(vca, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function fmBells() {
  const p = patch("Folder: Fold Bells", {
    module: "wavefolder", tempo: 80,
    description: "An Oscillator patched into the Folder's input frequency-modulates its internal sine through FM Depth, then the result is folded: sparkling, bell-like tones with a quick decay. Raise FM Depth or Fold to turn bells to glass.",
    tags: ["fm", "bells", "metallic", "pluck"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "C", scale: "Major Pentatonic", octave: 1, gatelength: 0.3 },
    { data: steps([0, 7, 4, 9, 2, 7, 12, 9]) });
  const mod = p.add("oscillator", [1, 1], { shape: 0, coarse: 7, octave: "+1" }, { name: "Modulator" });
  const f = p.add("wavefolder", [2, 0], { wave: 0, fold: 0.35, fm: 0.28, symmetry: 0, tap: 5, level: 0.8, source: "Internal" });
  const env = p.add("adsr", [2, 1], { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 }, { name: "Bell Env" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", mod, "pitch").cable(seq, "pitch", f, "pitch").cable(mod, "out", f, "l")
    .cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", f, "fold", 0.3).cable(env, "env", vca, "gain").stereo(f, vca);
  finish(p, [4, 0], vca, 0, { size: 0.65, decay: 4.5, mix: 0.35 });
  return p;
}

function brightenPluck() {
  const p = patch("Folder: Stereo Brightener", {
    module: "wavefolder", tempo: 108,
    description: "An external plucked saw goes into the Folder with a gentle Fold and Mix at half: the folds add upper harmonics to the dry sound, and Spread opens it into stereo. Move Fold and Level to see how far into the folds the signal reaches.",
    tags: ["external input", "brighten", "stereo", "mix"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 12, 7, 4, 9, 5, 0, 5, 9, 12, 9, 5, 7, 4], { rate: "1/8", shape: 0.5, root: "G", scale: "Major Pentatonic", gatelength: 0.4, env: { decay: 0.3, sustain: 0, release: 0.2 } });
  const f = p.add("wavefolder", [3, 0], { fold: 0.35, symmetry: 0.1, tap: 6, level: 0.7, spread: 0.55, mix: 0.55, source: "Input" });
  const lfo = p.add("lfo", [3, 1], { rate: 0.1 }, { name: "Fold Drift" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r").cable(lfo, "out", f, "fold", 0.25);
  finish(p, [4, 0], f, -2, { size: 0.5, decay: 2.5, mix: 0.25 });
  return p;
}

function foldedBeat() {
  const p = patch("Folder: Folded Beat", {
    module: "wavefolder", tempo: 118,
    description: "A whole drum loop passes through the Folder: kicks gain harmonics and snare and hats turn crunchy as Fold rises with a slow LFO. Pull Mix back for parallel crunch.",
    tags: ["drums", "distortion", "crunch", "beat"],
  });
  const drums = beat(p, [0, 0], { style: "shuffle", level: -8 });
  const f = p.add("wavefolder", [3, 0], { fold: 0.3, symmetry: 0.2, tap: 5, level: 0.5, mix: 0.7, source: "Input" });
  const lfo = p.add("lfo", [3, 1], { wave: "Triangle", sync: "4 bars" }, { name: "Fold" });
  p.stereo(drums, f, { from: ["outl", "outr"] }).cable(lfo, "out", f, "fold", 0.3);
  const bass = p.add("oscillator", [3, 3], { octave: "-2", shape: 0.1 }, { name: "Sub" });
  const seq = p.add("step-sequencer", [2, 3], { length: 16, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -1, gatelength: 0.6 },
    { data: steps([0, "_", ".", 0, ".", 3, ".", 5, 0, "_", ".", 0, ".", 7, ".", 5]) });
  const env = p.add("adsr", [4, 3], { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 }, { name: "Sub Env" });
  const vca = p.add("vca", [5, 3], {});
  p.cable(seq, "pitch", bass, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(bass, "out", vca, "l").cable(env, "env", vca, "gain");
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -9, master: -1 });
  p.stereo(f, mix, { to: ["in1l", "in1r"] }).cable(vca, "l", mix, "in2l").cable(vca, "l", mix, "in2r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [complexVoice, wobbleBass, fmBells, brightenPluck, foldedBeat];
