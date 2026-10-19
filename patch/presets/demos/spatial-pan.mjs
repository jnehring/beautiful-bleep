// SPDX-License-Identifier: MIT
// Spatial Pan (spatial-pan): five demo patches. Each plays by itself with the transport.
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

const lead = (p, at, o = {}) => melody(p, at, o.notes || [0, 3, 7, 10, 7, 3, 5, 7, 12, 10, 7, 3, 5, 3, 0, "."],
  { rate: "1/8", shape: 0.8, root: o.root || "A", scale: "Minor Pentatonic", gatelength: 0.55, octave: o.octave ?? 0, env: { attack: 0.004, decay: 0.3, sustain: 0.3, release: 0.25 } });

function orbitingLead() {
  const p = patch("Spatial Pan: Orbiting Lead", {
    module: "spatial-pan", tempo: 100,
    description: "A plucked melody circles the listener once every five seconds. Wear headphones: the time and level differences, the duller back and the early reflections make the circle. Change Orbit for a faster or reversed spin or Distance to pull it in.",
    tags: ["orbit", "headphones", "melody", "binaural"],
  });
  const m = lead(p, [0, 0]);
  const sp = p.add("spatial-pan", [3, 0], { orbit: 0.2, distance: 0.3, room: 0.3, doppler: 0.2, level: 0.9 });
  p.cable(m.amp, "l", sp, "l");
  direct(p, [4, 0], sp, ["l", "r"], 4);
  return p;
}

function driftingKit() {
  const p = patch("Spatial Pan: Drifting Kit", {
    module: "spatial-pan", tempo: 108,
    description: "A drum loop swings from side to side over four bars with a little room around it. Reduce the Room knob for a drier, closer kit or make Distance bigger for a kit heard from the back of the hall.",
    tags: ["drums", "swing", "headphones", "room"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -4 });
  const l = p.add("lfo", [2, 2], { wave: "Sine", sync: "4 bars", polarity: "Bipolar" }, { name: "Swing" });
  const sp = p.add("spatial-pan", [3, 0], { azimuth: 0, distance: 0.35, room: 0.45, size: 0.6, doppler: 0, level: 0.7 });
  p.cable(d, "outl", sp, "l").cable(d, "outr", sp, "r").cable(l, "out", sp, "azimuth", 0.45);
  direct(p, [4, 0], sp, ["l", "r"], 4);
  return p;
}

function flyBy() {
  const p = patch("Spatial Pan: Fly-By", {
    module: "spatial-pan", tempo: 90,
    description: "A bright riff passes by: it comes from the far left, sweeps close to the middle and leaves to the far right, and its pitch bends the way a passing source does. Lower Doppler to hear the path without the pitch bend.",
    tags: ["doppler", "movement", "distance", "headphones"],
  });
  const m = melody(p, [0, 0], [0, 0, 7, 0, 10, 7, 12, 7, 0, 0, 5, 0, 3, 5, 7, 0], { rate: "1/8", shape: 1, root: "D", scale: "Natural Minor", gatelength: 0.6, env: { decay: 0.2, sustain: 0.4 } });
  const az = p.add("lfo", [2, 2], { wave: "Saw Up", sync: "4 bars", polarity: "Bipolar" }, { name: "Path" });
  const dist = p.add("lfo", [2, 3], { wave: "Triangle", sync: "4 bars", polarity: "Unipolar" }, { name: "Closeness" });
  const sp = p.add("spatial-pan", [3, 0], { azimuth: 0, distance: 0.3, room: 0.25, doppler: 0.9, air: 0.6 });
  p.cable(m.amp, "l", sp, "l").cable(az, "out", sp, "azimuth", 0.5).cable(dist, "out", sp, "distance", 0.6);
  direct(p, [4, 0], sp, ["l", "r"], 3);
  return p;
}

function overheadRain() {
  const p = patch("Spatial Pan: Overhead Rain", {
    module: "spatial-pan", tempo: 80,
    description: "Bell-like plucks high in the scale move up and down in elevation and wander in azimuth under two slow random LFOs, so notes seem to fall around and above the head. Reduce Elevation depth for a flatter field.",
    tags: ["elevation", "random", "bells", "ambient"],
  });
  const m = lead(p, [0, 0], { notes: [12, ".", 7, ".", 15, ".", 10, ".", 19, ".", 12, ".", 7, ".", 14, "."], octave: 1, root: "C" });
  const e = p.add("lfo", [2, 2], { wave: "Random Smooth", rate: 0.3, polarity: "Bipolar" }, { name: "Height" });
  const a = p.add("lfo", [2, 3], { wave: "Random Smooth", rate: 0.17, polarity: "Bipolar" }, { name: "Angle" });
  const sp = p.add("spatial-pan", [3, 0], { distance: 0.35, room: 0.4, size: 0.7, doppler: 0, level: 1 });
  p.cable(m.amp, "l", sp, "l").cable(e, "out", sp, "elevation", 0.6).cable(a, "out", sp, "azimuth", 0.8);
  direct(p, [4, 0], sp, ["l", "r"], 6);
  return p;
}

function twoPlaces() {
  const p = patch("Spatial Pan: Two Places", {
    module: "spatial-pan", tempo: 104,
    description: "The drums sit behind and to the right, the melody in front and to the left, each with its own distance and room. Move Azimuth on either to rearrange the stage.",
    tags: ["mix", "stage", "drums", "melody"],
  });
  const m = lead(p, [0, 0], { root: "F" });
  const d = beat(p, [0, 4], { style: "half", level: -4 });
  const a = p.add("spatial-pan", [3, 0], { azimuth: -50, distance: 0.3, room: 0.25, doppler: 0, level: 0.8 }, { name: "Melody Place" });
  const b = p.add("spatial-pan", [3, 4], { azimuth: 140, distance: 0.45, room: 0.4, doppler: 0, level: 0.8 }, { name: "Drum Place" });
  p.cable(m.amp, "l", a, "l").cable(d, "outl", b, "l").cable(d, "outr", b, "r");
  const mix = p.add("audio-mixer", [4, 0], { level1: 3, level2: 3, master: 0 }, { name: "Mix" });
  p.stereo(a, mix, { from: ["l", "r"], to: ["in1l", "in1r"] }).stereo(b, mix, { from: ["l", "r"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [orbitingLead, driftingKit, flyBy, overheadRain, twoPlaces];
