// SPDX-License-Identifier: MIT
// Endless Tone (endless-tone): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
const seqOf = (p, at, notes, o = {}) => p.add("step-sequencer", at, {
  length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
  octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
}, { data: steps(notes) });

/// `src`'s pitch from the sequencer (jack `pitch`, or none), its output (`jack`) through an ADSR-driven VCA.
function gated(p, at, src, seq, jack, pitch, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(seq, "pitch", src, pitch);
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(src, jack, amp, "l").cable(env, "env", amp, "gain");
  return { amp, env };
}

/// Mono or stereo source → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.22, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// Mono or stereo source → trim mixer → Out 1/2 (no reverb).
function direct(p, at, src, jacks, trim = 0, master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

/// A voice and a drum loop into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function risingPad() {
  const p = patch("Endless Tone: Rising Pad", {
    module: "endless-tone", tempo: 70,
    description: "A pad that rises for ever and never gets higher: octave-spaced partials slide up under a fixed window. Change Rate for a faster climb, Width for fewer or more clear partials, or flip Direction to fall.",
    tags: ["riser", "pad", "illusion", "ambient"],
  });
  const t = p.add("endless-tone", [0, 0], { rate: 0.2, width: 0.4, count: 10, spread: 0.5, level: 1 });
  finish(p, [1, 0], t, ["l", "r"], 0, { decay: 3.5, mix: 0.3 });
  return p;
}

function fallingDrone() {
  const p = patch("Endless Tone: Falling Drone", {
    module: "endless-tone", tempo: 60,
    description: "A low, saw-edged tone that keeps sinking, with a slow LFO on Width so the cloud thickens and thins as it falls. Try a faster Rate for a descent that feels like an alarm.",
    tags: ["drone", "falling", "dark", "evolving"],
  });
  const l = p.add("lfo", [0, 2], { wave: "Sine", rate: 0.04, polarity: "Unipolar" }, { name: "Width" });
  const t = p.add("endless-tone", [1, 0], { coarse: -24, direction: -0.5, rate: 0.3, timbre: 0.5, width: 0.4, count: 11, level: 1 });
  p.cable(l, "out", t, "width", 0.5);
  finish(p, [2, 0], t, ["l", "r"], 2, { decay: 4, mix: 0.3 });
  return p;
}

function loopClock() {
  const p = patch("Endless Tone: Loop Clock", {
    module: "endless-tone", tempo: 120,
    description: "Wrap gives a trigger every time the tone has climbed an octave: here it plays a kick, and the Loop ramp opens a filter on a saw so the whole patch spins with the tone. Change Rate to change the tempo of the spin.",
    tags: ["loop", "clock", "modulation", "rhythm"],
  });
  const t = p.add("endless-tone", [0, 0], { rate: 2, width: 0.3, count: 8, level: 0.4 });
  const kick = p.add("punch-kick", [1, 0], { level: 0.9 });
  p.cable(t, "wrap", kick, "trig");
  const m = melody(p, [0, 3], [0, 0, 7, 0, 3, 0, 10, 5], { rate: "1/8", shape: 1, root: "E", scale: "Minor Pentatonic", octave: -1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.3 } });
  const f = p.add("filter", [3, 3], { cutoff: 600, resonance: 0.4, mode: "LP" });
  p.cable(m.amp, "l", f, "l").cable(t, "loop", f, "cutoff", 0.5);
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -5, level3: -9, master: -2 }, { name: "Mix" });
  p.cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(f, "l", mix, "in2l").cable(f, "l", mix, "in2r")
    .cable(t, "l", mix, "in3l").cable(t, "r", mix, "in3r").stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function wideSwirl() {
  const p = patch("Endless Tone: Wide Swirl", {
    module: "endless-tone", tempo: 90,
    description: "Twelve bright partials spread across the stereo field while a slow LFO swings Direction between rising and falling, so the swirl climbs, hangs and sinks. Narrow Width for a clearer, thinner voice.",
    tags: ["stereo", "swirl", "lfo", "wide"],
  });
  const l = p.add("lfo", [0, 2], { wave: "Sine", sync: "8 bars", polarity: "Bipolar" }, { name: "Direction" });
  const t = p.add("endless-tone", [1, 0], { rate: 0.5, width: 1, count: 12, timbre: 0.7, spread: 1, level: 1 });
  p.cable(l, "out", t, "direction", 1);
  finish(p, [2, 0], t, ["l", "r"], 2, { decay: 3, mix: 0.25 });
  return p;
}

function chordRiser() {
  const p = patch("Endless Tone: Chord Riser", {
    module: "endless-tone", tempo: 76,
    description: "Three tones a fifth and an octave apart rise together at slightly different rates, a chord that climbs without end and slowly rotates through its own beating. Change the Pitch of each tone for another chord.",
    tags: ["chord", "riser", "layers", "pad"],
  });
  const a = p.add("endless-tone", [0, 0], { rate: 0.18, width: 0.35, count: 9, timbre: 0.2, spread: 0.3, level: 1 }, { name: "Root" });
  const b = p.add("endless-tone", [0, 2], { coarse: 7, rate: 0.18, width: 0.35, count: 9, timbre: 0.2, spread: 0.3, level: 1 }, { name: "Fifth" });
  const c = p.add("endless-tone", [0, 4], { coarse: 12, rate: 0.19, width: 0.35, count: 9, timbre: 0.2, spread: 0.6, level: 1 }, { name: "Octave" });
  const mix = p.add("audio-mixer", [1, 0], { level1: 0, level2: -3, level3: -5, pan1: -0.3, pan3: 0.3, master: 0 }, { name: "Mix" });
  p.cable(a, "l", mix, "in1l").cable(a, "r", mix, "in1r").cable(b, "l", mix, "in2l").cable(b, "r", mix, "in2r").cable(c, "l", mix, "in3l").cable(c, "r", mix, "in3r");
  const v = p.add("reverb", [2, 0], { size: 0.6, decay: 3.5, damping: 0.5, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [risingPad, fallingDrone, loopClock, wideSwirl, chordRiser];
