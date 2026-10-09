// SPDX-License-Identifier: MIT
// Beat Oscillator: five demo patches. Each plays by itself with the transport.
import { patch, steps, semis } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Channels → Audio Mixer → Verb → Out 1/2. chans: {n, l (jack), r (optional jack), level, pan}
function finish(p, at, chans, o = {}) {
  const lv = {};
  chans.forEach((c, i) => { lv[`level${i + 1}`] = c.level ?? -6; lv[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, { ...lv, master: o.master ?? -3 });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "out", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.25, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return mix;
}

function theremin() {
  const p = patch("Beat Oscillator: Heterodyne Theremin", {
    module: "beat-oscillator", tempo: 72,
    description: "Two 10 kHz carriers beat against each other; a slow LFO sweeps Beat from a pulse to a whistle and back, and the detector plucks only the difference tone. Try the Mixer setting (Diode or Overdriven) for a buzzier beat, or raise Drift.",
    tags: ["theremin", "heterodyne", "sweep", "lead"],
  });
  const bo = p.add("beat-oscillator", [0, 0], { carrier: 10000, beat: 0.42, range: "±2 kHz", mixer: "Ideal", drift: 0.3, warmup: "Off" });
  const lfo = p.add("lfo", [0, 1], { rate: 0.09, wave: "Sine" }, { name: "Hand" });
  const lfo2 = p.add("lfo", [1, 1], { rate: 0.6, wave: "Sine" }, { name: "Vibrato" });
  p.cable(lfo, "out", bo, "beat", 0.2).cable(lfo2, "out", bo, "beat", 0.012);
  const flt = p.add("filter", [1, 0], { cutoff: 2500, resonance: 0.25 });
  p.cable(bo, "out", flt, "l");
  finish(p, [2, 0], [{ n: flt, l: "l", level: -3 }], { vmix: 0.35, decay: 3.5, size: 0.7 });
  return p;
}

function lurch() {
  const p = patch("Beat Oscillator: Lurching Thump", {
    module: "beat-oscillator", tempo: 100,
    description: "With Pull up, the two carriers hold each other near lock, so the beat does not run steadily: it lurches in single sub-bass blips that bunch up and stall as Drift pushes the pair across the lock edge. Try nudging Beat or Drift.",
    tags: ["pull", "lock", "bass", "rhythm"],
  });
  const bo = p.add("beat-oscillator", [0, 0], { carrier: 8000, beat: 0.53, range: "±200 Hz", pull: 0.5, drift: 0.35, coupling: "AC", detector: 0, seed: 7 });
  const drift = p.add("lfo", [0, 1], { rate: 0.13 }, { name: "Edge" });
  p.cable(drift, "out", bo, "beat", 0.03);
  const flt = p.add("filter", [1, 0], { cutoff: 300, resonance: 0.3, drive: 0.5 });
  p.cable(bo, "out", flt, "l");
  const bt = beat(p, [0, 2], { style: "sparse", level: -8 });
  const pad = melody(p, [3, 2], [0, "_", "_", "_", 7, "_", 5, "_"], { rate: "1/4", shape: 0.4, root: "D", scale: "Natural Minor", octave: 1,
    env: { attack: 0.05, decay: 0.5, sustain: 0.5, release: 0.8 }, gatelength: 0.95 });
  finish(p, [4, 0], [{ n: flt, l: "l", level: -2 }, { n: bt, l: "outl", r: "outr", level: -3 }, { n: pad.amp, l: "l", level: -12 }]);
  return p;
}

function lockedMelody() {
  const p = patch("Beat Oscillator: Locked Melody", {
    module: "beat-oscillator", tempo: 96,
    description: "The Lock output is a gate: it goes high whenever the carriers pull into step. A slow wobble on Detune drives the pair in and out of lock, and a melody is only allowed to play while it is locked. Change Pull or Detune Range to change how often it happens.",
    tags: ["lock", "gate", "generative", "melody"],
  });
  const bo = p.add("beat-oscillator", [0, 0], { carrier: 6000, beat: 0.62, range: "±200 Hz", pull: 0.75, detuneRange: 40, drift: 0.2, seed: 11 });
  const wob = p.add("lfo", [0, 1], { rate: 0.17, wave: "Triangle" }, { name: "Detune" });
  p.cable(wob, "out", bo, "detune", 0.9);
  const m = melody(p, [2, 1], [0, 3, 7, 10, 7, 12, 10, 7], { rate: "1/8", root: "A", scale: "Minor Pentatonic", shape: 0.6, env: { sustain: 0.15 } });
  const gate = p.add("adsr", [2, 0], { attack: 0.02, decay: 0.2, sustain: 1, release: 0.5 }, { name: "Lock Env" });
  const vca = p.add("vca", [5, 0], {}, { name: "Lock VCA" });
  p.cable(bo, "lock", gate, "gate").cable(m.amp, "l", vca, "l").cable(gate, "env", vca, "gain");
  const flt = p.add("filter", [3, 0], { cutoff: 700, resonance: 0.2 });
  p.cable(bo, "out", flt, "l");
  finish(p, [4, 2], [{ n: vca, l: "l", level: 4 }, { n: flt, l: "l", level: -10 }], { vmix: 0.3, decay: 3, master: -3 });
  return p;
}

function warmWhistle() {
  const p = patch("Beat Oscillator: Warm-up Whistle", {
    module: "beat-oscillator", tempo: 66,
    description: "Low carriers with the Detector opened let the sum tone whistle on top of the beat, and Warm-up makes both start flat and slide into tune while the transport runs. The Overdriven mixer turns the beat into a soft triangle. Try Detector at 0 to hear the whistle vanish.",
    tags: ["whistle", "warm-up", "drone", "overdriven"],
  });
  const bo = p.add("beat-oscillator", [0, 0], { carrier: 2600, beat: 0.37, range: "±200 Hz", detector: 0.9, mixer: "Overdriven", drift: 0.5, warmup: "30 s", seed: 3 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.05 }, { name: "Slow Beat" });
  p.cable(lfo, "out", bo, "beat", 0.1);
  const flt = p.add("filter", [1, 0], { cutoff: 1800, resonance: 0.3 });
  const lp = p.add("lfo", [1, 1], { rate: 0.08, wave: "Triangle" }, { name: "Breath" });
  p.cable(bo, "out", flt, "l").cable(lp, "out", flt, "cutoff", 0.15);
  const sub = p.add("oscillator", [2, 1], { shape: 0, octave: "-2" });
  const sl = p.add("lfo", [2, 2], { rate: 0.03, wave: "Square", polarity: "Unipolar" }, { name: "Sub Gate" });
  const sv = p.add("vca", [3, 1], {});
  p.cable(sub, "out", sv, "l").cable(sl, "out", sv, "gain", 0.8);
  finish(p, [3, 0], [{ n: flt, l: "l", level: -6 }, { n: sv, l: "l", level: -14 }], { vmix: 0.4, decay: 4, size: 0.8 });
  return p;
}

function follower() {
  const p = patch("Beat Oscillator: Beat Follower", {
    module: "beat-oscillator", tempo: 108,
    description: "A sequencer drives Pitch, transposing both carriers so the difference tone plays the tune. The Beat output measures that tone and feeds an oscillator an octave up, so a second voice follows the heterodyne melody. Try Mixer Diode for more bite.",
    tags: ["melody", "pitch", "tracking", "diode"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "C", scale: "Dorian", octave: 0, gatelength: 0.6 },
    { data: steps([0, 3, 7, 5, 10, 7, 3, 2]) });
  const bo = p.add("beat-oscillator", [1, 0], { carrier: 3000, beat: 0.4, range: "±2 kHz", mixer: "Diode", drift: 0.1, coupling: "AC" });
  p.cable(seq, "pitch", bo, "pitch", 0.5);
  const env = p.add("adsr", [1, 1], { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.25 });
  const amp = p.add("vca", [2, 0], {});
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(bo, "out", amp, "l").cable(env, "env", amp, "gain");
  const fo = p.add("oscillator", [2, 1], { shape: 0.2, octave: "+1" });
  const fa = p.add("vca", [3, 1], {});
  p.cable(bo, "beat", fo, "pitch").cable(fo, "out", fa, "l").cable(env, "env", fa, "gain");
  const bt = beat(p, [0, 3], { style: "half", level: -10 });
  finish(p, [4, 0], [{ n: amp, l: "l", level: 4 }, { n: fa, l: "l", level: -6, pan: 0.3 }, { n: bt, l: "outl", r: "outr", level: -9 }], { vmix: 0.2 });
  return p;
}

export default [theremin, lurch, lockedMelody, warmWhistle, follower];
