// rate-counter: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

/// A small band: melody + drums on a mixer. Returns {mix, flt, drums, m}.
function band(p, at, o = {}) {
  const m = melody(p, [at[0], at[1]], o.notes || [0, ".", 3, 5, 7, ".", 5, 3, 10, ".", 7, 5, 3, ".", 0, "."], {
    rate: "1/8", root: o.root || "E", scale: "Minor Pentatonic", octave: o.octave ?? 0, shape: o.shape ?? 0.8, gatelength: 0.5,
    env: { decay: 0.25, sustain: 0.1, release: 0.2 },
  });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: o.cutoff ?? 2400, resonance: 0.25 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  const drums = beat(p, [at[0], at[1] + 3], { style: o.style || "half", level: -8 });
  const mix = p.add("audio-mixer", [at[0] + 4, at[1]], { level1: o.lead ?? 2, level2: o.drum ?? 0, master: o.master ?? 0 }, { name: "Band" });
  p.cable(flt, "l", mix, "in1l").cable(flt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { mix, flt, drums, m };
}
/// A one-lane gate pattern (notes: 0 = hit, "_" = tie, "." = rest).
const gateSeq = (p, at, pat, rate, name, o = {}) => p.add("step-sequencer", at, { length: pat.length, rate, root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: o.gatelength ?? 0.9 }, { data: steps(pat) }, { name });
function waveTuner() {
  const p = patch("Rate Counter: Wave Tuner", {
    module: "rate-counter", tempo: 80,
    description: "A slow drone changes pitch and the Rate Counter, in Wave mode, counts its cycles; its Rate output, a pitch signal, plays a sine a fifth and an octave above the drone. Change Input Is to Pulse Train to see it lose the wave, or lower Average Of.",
    tags: ["wave", "frequency", "tuner", "pitch out"],
  });
  const seq = gateSeq(p, [0, 0], [0, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_"], "1/2", "Drone Notes");
  const osc = p.add("oscillator", [1, 0], { shape: 0.5, octave: "-1" }, { name: "Drone" });
  const rc = p.add("rate-counter", [2, 0], { mode: "Wave", perbeat: "1", average: 4 });
  const dv = p.add("vca", [3, 0], { gain: 0.5 }, { name: "Drone Level" });
  p.cable(seq, "pitch", osc, "pitch").cable(osc, "out", rc, "in").cable(osc, "out", dv, "l");
  const fol = p.add("oscillator", [3, 1], { shape: 0, octave: "+1", coarse: 7 }, { name: "Rate Follower" });
  const fv = p.add("vca", [4, 1], { gain: 0.35 }, { name: "Follower Level" });
  p.cable(rc, "hz", fol, "pitch").cable(fol, "out", fv, "l");
  const drums = beat(p, [0, 4], { style: "sparse", level: -9 });
  finish(p, [5, 0], [{ n: dv, level: 3 }, { n: fv, level: 3, pan: 0.25 }, drumsOf(drums, 3)], { vmix: 0.35, decay: 3, master: 3 });
  return p;
}

function clockBrightness() {
  const p = patch("Rate Counter: Tempo Brightens the Lead", {
    module: "rate-counter", tempo: 120,
    description: "The lead's own gate is a clock that the Rate Counter measures in Pulse Train mode, two edges to a beat; its Average BPM output, about 0.5 at 120 BPM, lifts the lead's filter cutoff. Change the song tempo and the brightness follows.",
    tags: ["pulse train", "average bpm", "tempo", "filter"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, ".", 5, 3, 0, ".", 10, 7, ".", 5, 3, 0, 5, "."], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 1, gatelength: 0.5, env: { decay: 0.2, sustain: 0.3, release: 0.12 } });
  const rc = p.add("rate-counter", [3, 0], { mode: "Pulse Train", perbeat: "2", average: 8, tolerance: 0.1 });
  p.cable(m.seq, "gate", rc, "in");
  const flt = p.add("filter", [3, 1], { cutoff: 300, resonance: 0.35, type: "Ladder Tanh" }, { name: "Tempo Filter" });
  p.cable(m.amp, "l", flt, "l").cable(rc, "average", flt, "cutoff", 1);
  const drums = beat(p, [0, 4], { style: "four", level: -8 });
  finish(p, [5, 0], [{ n: flt, level: 0 }, drumsOf(drums, -1)], { vmix: 0.2, master: 1 });
  return p;
}

function sixteenths() {
  const p = patch("Rate Counter: Sixteenths Per Beat 4", {
    module: "rate-counter", tempo: 126,
    description: "A run of sixteenth notes is counted four edges to the beat, so the Rate Counter reads the true tempo, and its Average BPM bends the pitch of a low drone a little. Change Per Beat to 2 to see the reading double and the drone jump.",
    tags: ["per beat", "sixteenth", "bpm", "drone"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12], { rate: "1/16", root: "F", scale: "Natural Minor", octave: 0, shape: 0.8, gatelength: 0.45, env: { decay: 0.1, sustain: 0, release: 0.08 } });
  const rc = p.add("rate-counter", [3, 0], { mode: "Pulse Train", perbeat: "4", average: 12 });
  p.cable(m.seq, "trigger", rc, "in");
  const drone = p.add("oscillator", [3, 1], { shape: 0.3, octave: "-2" }, { name: "Tempo Drone" });
  const dv = p.add("vca", [4, 1], { gain: 0.45 }, { name: "Drone Level" });
  p.cable(rc, "average", drone, "pitch", 1).cable(drone, "out", dv, "l");
  const drums = beat(p, [0, 4], { style: "shuffle", level: -8 });
  finish(p, [5, 0], [{ n: m.amp, level: 0, pan: -0.2 }, { n: dv, level: 0 }, drumsOf(drums, 2)], { vmix: 0.2, master: 3 });
  return p;
}

function steadyPad() {
  const p = patch("Rate Counter: Steady Opens the Pad", {
    module: "rate-counter", tempo: 120,
    description: "Four bars of even eighth notes are followed by four bars of uneven ones; the Steady gate of the Rate Counter is high only while the beat is even, and it swells a pad in and out. Make Steady Within wider and the pad stays open longer.",
    tags: ["steady", "gate out", "rhythm", "pad"],
  });
  const even = [0, 3, 5, 3, 0, 3, 5, 7];
  const uneven = [0, ".", ".", 3, ".", 5, ".", ".", ".", 7, ".", ".", 5, ".", 3, "."];
  const m = melody(p, [0, 0], [...even, ...even, ...uneven], { rate: "1/8", root: "D", scale: "Minor Pentatonic", octave: 0, shape: 0.3, gatelength: 0.5, env: { decay: 0.25, sustain: 0, release: 0.15 } });
  const rc = p.add("rate-counter", [3, 0], { mode: "Pulse Train", perbeat: "2", average: 4, tolerance: 0.05 });
  p.cable(m.seq, "gate", rc, "in");
  const env = p.add("adsr", [3, 1], { attack: 0.4, decay: 0.5, sustain: 0.8, release: 1.2 }, { name: "Pad Swell" });
  p.cable(rc, "stable", env, "gate");
  const mix = p.add("audio-mixer", [4, 1], { level1: -7, level2: -7, level3: -7, master: -2, pan1: -0.4, pan2: 0.4 }, { name: "Pad Mix" });
  [0, 7, 9].forEach((s, i) => {
    const o = p.add("oscillator", [1, 2 + i], { shape: 0.7, coarse: s + 3, fine: (i - 1) * 7, octave: "-1" }, { name: `Pad ${i + 1}` });
    p.cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const amp = p.add("vca", [5, 1], { gain: 0 }, { name: "Pad VCA" });
  p.stereo(mix, amp, { from: ["outl", "outr"] }).cable(env, "env", amp, "gain");
  const drums = beat(p, [0, 6], { style: "half", level: -9 });
  finish(p, [6, 0], [{ n: m.amp, level: -3, pan: 0.2 }, { n: amp, l: "l", r: "r", level: 0 }, drumsOf(drums, 0)], { vmix: 0.3, decay: 3, master: 3 });
  return p;
}

function edgeEcho() {
  const p = patch("Rate Counter: Edge Echo", {
    module: "rate-counter", tempo: 98,
    description: "A sparse melody is read by the Rate Counter, and its Edge trigger, one pulse per counted note, plays a rim click and a high bell a moment after each note. The long gaps clear the count, so the count starts fresh with each phrase. Shorten Start Over After to clear it sooner.",
    tags: ["edge out", "trigger", "start over", "echo"],
  });
  const m = melody(p, [0, 0], [0, ".", 3, ".", ".", ".", 5, ".", ".", ".", ".", ".", ".", ".", ".", ".", 7, ".", 5, 3, ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "."], { rate: "1/8", root: "G", scale: "Minor Pentatonic", octave: 0, shape: 0.9, gatelength: 0.4, env: { decay: 0.3, sustain: 0.1, release: 0.2 } });
  const rc = p.add("rate-counter", [3, 0], { mode: "Pulse Train", perbeat: "2", average: 3, timeout: 1.5 });
  p.cable(m.seq, "gate", rc, "in");
  const rim = p.add("punch-rim", [4, 0], { level: 0.6 });
  p.cable(rc, "pulse", rim, "trig");
  const bell = p.add("oscillator", [4, 1], { shape: 0, octave: "+2" }, { name: "Echo Bell" });
  const env = p.add("adsr", [4, 2], { attack: 0.003, decay: 0.7, sustain: 0, release: 0.5 }, { name: "Echo Env" });
  const bv = p.add("vca", [5, 1], {}, { name: "Echo VCA" });
  p.cable(m.seq, "pitch", bell, "pitch").cable(rc, "pulse", env, "gate").cable(rc, "pulse", env, "retrig").cable(bell, "out", bv, "l").cable(env, "env", bv, "gain");
  const drums = beat(p, [0, 4], { style: "half", level: -9 });
  finish(p, [6, 0], [{ n: m.amp, level: 0 }, { n: rim, l: "out", level: -3, pan: -0.3 }, { n: bv, level: -6, pan: 0.3 }, drumsOf(drums, 0)], { vmix: 0.3, master: 4 });
  return p;
}

export default [waveTuner, clockBrightness, sixteenths, steadyPad, edgeEcho];
