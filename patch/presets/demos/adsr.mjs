// SPDX-License-Identifier: MIT
// ADSR: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function pluck() {
  const p = patch("ADSR: Plucked Strings", {
    module: "adsr", tempo: 104,
    description: "Two ADSRs share each note: one shapes the volume, the other sweeps a low-pass filter from open to closed, so every note starts bright and darkens. Shorten Decay for staccato plucks, or raise Sustain to let the notes ring.",
    tags: ["pluck", "filter envelope", "short decay", "melody"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 7, 3, 0, 5, 12, 10, 7, 5, 3, 7], { rate: "1/8", shape: 0.85, root: "D", scale: "Natural Minor",
    env: { attack: 0.003, decay: 0.28, sustain: 0, release: 0.18 } });
  const f = p.add("filter", [3, 0], { cutoff: 350, resonance: 0.3, type: "Ladder Tanh" });
  const fe = p.add("adsr", [3, 1], { attack: 0.002, decay: 0.22, sustain: 0.1, release: 0.15 }, { name: "Filter Env" });
  p.cable(m.seq, "gate", fe, "gate").cable(m.seq, "trigger", fe, "retrig").cable(fe, "env", f, "cutoff", 0.7)
    .cable(m.amp, "l", f, "l");
  finish(p, [4, 0], f, "l", 5, { decay: 2 });
  return p;
}

function swell() {
  const p = patch("ADSR: Slow Pad Swell", {
    module: "adsr", tempo: 72,
    description: "With a long Attack and a long Release, each held note rises out of silence and melts away over the next one, so the chords seem to breathe. Try a shorter Attack to turn the pad into a soft organ.",
    tags: ["pad", "long attack", "long release", "ambient"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "F", scale: "Major", octave: 0, gatelength: 0.9 },
    { data: steps([0, "_", 4, "_", 7, "_", 5, "_"]) });
  const env = p.add("adsr", [1, 2], { attack: 1.4, decay: 1.2, sustain: 0.7, release: 2.5 }, { name: "Swell" });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.8, fine: -7 }, { name: "Saw A" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.8, fine: 7, octave: "+1" }, { name: "Saw B" });
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -11, pan1: -0.4, pan2: 0.4, master: 6 });
  const f = p.add("filter", [3, 0], { cutoff: 1400, resonance: 0.15, type: "SVF Multimode" });
  const vca = p.add("vca", [4, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r")
    .cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r").stereo(mix, f, { from: ["outl", "outr"] })
    .cable(seq, "gate", env, "gate").cable(env, "env", f, "cutoff", 0.35).stereo(f, vca).cable(env, "env", vca, "gain");
  const t = p.add("reverb", [5, 0], { size: 0.7, decay: 6, damping: 0.5, mix: 0.35, quality: "Eco (8 lines)" });
  p.stereo(vca, t).stereo(t, p.out);
  return p;
}

function touch() {
  const p = patch("ADSR: Velocity Touch", {
    module: "adsr", tempo: 96,
    description: "The sequencer sends a different velocity with every note into the ADSR, and Vel Amount decides how much it matters: soft notes are quiet and mellow, accented ones loud and bright. Set Vel Amount to zero and the phrase goes flat.",
    tags: ["velocity", "dynamics", "accent", "expressive"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 3, 7, 10, 7, 3, 12, 10, 0, 3, 7, 12, 10, 7, 3, 5], [127, 45, 70, 35, 110, 40, 85, 30, 120, 50, 65, 100, 40, 90, 35, 60]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.6 });
  const env = p.add("adsr", [1, 1], { attack: 0.004, decay: 0.3, sustain: 0.25, release: 0.25, velamount: 0.6 }, { name: "Touch Env" });
  const f = p.add("filter", [2, 0], { cutoff: 700, resonance: 0.25, type: "SVF Multimode" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(seq, "velocity", env, "velocity")
    .cable(osc, "out", f, "l").cable(env, "env", f, "cutoff", 0.45).cable(f, "l", vca, "l").cable(env, "env", vca, "gain");
  finish(p, [4, 0], vca, "l", 6, { mix: 0.2 });
  return p;
}

function bass() {
  const p = patch("ADSR: Bass Under a Beat", {
    module: "adsr", tempo: 112,
    description: "A fast Attack with a medium Decay and a high Sustain gives the bass a tight thump that then holds its note until the gate closes. Lower Sustain for a plucked bass, lengthen Release to let notes blur into each other.",
    tags: ["bass", "sustain", "drums", "groove"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "A", scale: "Natural Minor", octave: -2, gatelength: 0.75 },
    { data: steps([0, "_", 0, ".", 3, "_", ".", 5, 0, "_", 0, ".", 7, "_", 5, 3]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.3 });
  const env = p.add("adsr", [1, 1], { attack: 0.004, decay: 0.18, sustain: 0.65, release: 0.1 }, { name: "Bass Env" });
  const f = p.add("filter", [2, 0], { cutoff: 600, resonance: 0.2, type: "Ladder Tanh", drive: 0.3 });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(osc, "out", f, "l").cable(env, "env", f, "cutoff", 0.3).cable(f, "l", vca, "l").cable(env, "env", vca, "gain");
  const drums = beat(p, [0, 3], { style: "broken", level: -6 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -6, master: -1 });
  p.cable(vca, "l", mix, "in1l").cable(vca, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function chain() {
  const p = patch("ADSR: End Trigger Echoes", {
    module: "adsr", tempo: 90,
    description: "When each note's envelope finishes, its End output fires a rim shot, so the percussion trails after the melody at a distance set by Decay and Release. Lengthen the Release and the echo hits arrive later.",
    tags: ["end trigger", "chain", "percussion", "release"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 4, 12, 7, 4, 9], { rate: "1/4", shape: 0.4, root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.3,
    env: { attack: 0.004, decay: 0.3, sustain: 0.4, release: 0.5 } });
  const rim = p.add("punch-rim", [3, 1], { tune: 3, decay: 0.8, level: 0.6 });
  const tom = p.add("punch-tom", [3, 2], { tune: 180, decay: 0.3, bend: 0.4 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -3, level3: -5, pan2: -0.3, pan3: 0.3, master: 0 });
  p.cable(m.env, "end", rim, "trig").cable(m.env, "end", tom, "trig")
    .cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").cable(rim, "out", mix, "in2l").cable(rim, "out", mix, "in2r")
    .cable(tom, "out", mix, "in3l").cable(tom, "out", mix, "in3r");
  const v = p.add("reverb", [5, 0], { size: 0.55, decay: 3, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [pluck, swell, touch, bass, chain];
