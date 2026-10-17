// SPDX-License-Identifier: MIT
// Folder (wavefolder): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const feed = (p, amp, f) => p.cable(amp, "l", f, "l").cable(amp, "l", f, "r");
function out(p, at, src, trim = 0, jacks = ["l", "r"], master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

function foldedSaw() {
  const p = patch("Folder: Folded Saw Riff", {
    module: "wavefolder", tempo: 112,
    description: "An external saw riff enters the Folder's input and an LFO moves Fold up and down, so each note folds back on itself into a growl that opens and closes. Change Symmetry for a hollower tone or lower Tap for a gentler fold.",
    tags: ["fold", "input", "saw", "growl", "lfo"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 0, 12, 10, 0, 0, 7, 0, 5, 3, 5, 7],
    { rate: "1/8", shape: 1, root: "E", scale: "Natural Minor", gatelength: 0.6, env: { attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.1 } });
  const l = p.add("lfo", [2, 2], { wave: "Triangle", sync: "2 bars", polarity: "Unipolar" }, { name: "Fold Sweep" });
  const f = p.add("wavefolder", [3, 0], { fold: 0.3, symmetry: 0, tap: 6, level: 0.6, source: "Input" });
  feed(p, m.amp, f);
  p.cable(l, "out", f, "fold", 0.6);
  out(p, [4, 0], f, -12);
  return p;
}

function sineDrone() {
  const p = patch("Folder: Evolving Sine Drone", {
    module: "wavefolder", tempo: 60,
    description: "With Source on Internal the Folder is its own voice: a slow sequencer sets the pitch, Wave and Fold drift under two LFOs, and a plain sine turns into a shifting, metallic drone. Try Coarse and Fine for beating pairs of partials.",
    tags: ["drone", "internal oscillator", "evolving", "ambient"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/1", root: "D", scale: "Minor Pentatonic", octave: -1, gatelength: 1 },
    { data: steps([0, "_", 7, "_", 5, "_", 3, "_"]) });
  const l1 = p.add("lfo", [1, 2], { wave: "Sine", sync: "4 bars", polarity: "Unipolar" }, { name: "Fold" });
  const l2 = p.add("lfo", [1, 3], { wave: "Triangle", rate: 0.07, polarity: "Unipolar" }, { name: "Wave" });
  const f = p.add("wavefolder", [3, 0], { fold: 0.35, symmetry: 0.2, tap: 5, wave: 0.2, fine: 6, level: 0.5, source: "Internal" });
  p.cable(seq, "pitch", f, "pitch").cable(l1, "out", f, "fold", 0.5).cable(l2, "out", f, "wave", 0.7);
  out(p, [4, 0], f, -12);
  return p;
}

function lopsidedBass() {
  const p = patch("Folder: Lopsided Bass", {
    module: "wavefolder", tempo: 100,
    description: "A low note from the internal sine is pushed off-centre with Symmetry and folded at Tap 3, giving a bass with strong even harmonics and a nasal, vocal edge. Change Symmetry to the other side or raise Fold for a buzzier note.",
    tags: ["bass", "symmetry", "tap", "internal oscillator"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Natural Minor", octave: -2, gatelength: 0.75 },
    { data: steps([0, "_", 0, ".", 3, "_", ".", 5, 0, "_", 0, ".", 7, "_", 5, 3]) });
  const env = p.add("adsr", [1, 1], { attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.1 }, { name: "Amp Env" });
  const fenv = p.add("adsr", [1, 2], { attack: 0.003, decay: 0.25, sustain: 0.2, release: 0.1 }, { name: "Fold Env" });
  const f = p.add("wavefolder", [2, 0], { fold: 0.25, symmetry: 0.55, tap: 3, level: 0.6, source: "Internal" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", f, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(seq, "gate", fenv, "gate").cable(seq, "trigger", fenv, "retrig").cable(fenv, "env", f, "fold", 0.5)
    .stereo(f, vca).cable(env, "env", vca, "gain");
  const d = beat(p, [0, 4], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -3, master: -3 });
  p.stereo(vca, mix, { to: ["in1l", "in1r"] }).stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function wideChords() {
  const p = patch("Folder: Spread Pad", {
    module: "wavefolder", tempo: 74,
    description: "A slow pad goes through the Folder with Spread turned up, so the left and right channels fold by different amounts and the pad opens into a wide, shimmering stereo image. Pull Spread down to bring it back to the centre.",
    tags: ["stereo", "spread", "pad", "wide"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 7, "_", "_", "_", 3, "_", "_", "_"],
    { rate: "1/4", shape: 0.9, root: "A", scale: "Dorian", gatelength: 0.98, osc: { fine: 8 }, env: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 0.8 } });
  const f = p.add("wavefolder", [3, 0], { fold: 0.45, symmetry: 0.1, tap: 4, spread: 1, shape: 0.6, level: 0.5, source: "Input" });
  feed(p, m.amp, f);
  out(p, [4, 0], f, -13);
  return p;
}

function foldedKit() {
  const p = patch("Folder: Folded Drum Kit", {
    module: "wavefolder", tempo: 100,
    description: "A drum beat passes through the Folder at half Mix: the kick gains a hard, clicky harmonic edge and the hats shimmer, while the dry hits keep their weight. Raise Fold or Mix for a more broken, industrial kit.",
    tags: ["drums", "parallel", "fold", "industrial"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -6 });
  const f = p.add("wavefolder", [3, 0], { fold: 0.4, symmetry: 0.15, tap: 6, level: 0.8, mix: 0.5, source: "Input" });
  p.stereo(d, f, { from: ["outl", "outr"] });
  out(p, [4, 0], f, 1);
  return p;
}

export default [foldedSaw, sineDrone, lopsidedBass, wideChords, foldedKit];
