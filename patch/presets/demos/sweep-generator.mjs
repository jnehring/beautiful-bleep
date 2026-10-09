// SPDX-License-Identifier: MIT
// Sweep Generator: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Channels → Audio Mixer → Verb → Out 1/2. chans: {n, l (jack), r (optional jack), level, pan}
function finish(p, at, chans, o = {}) {
  const lv = {};
  chans.forEach((c, i) => { lv[`level${i + 1}`] = c.level ?? -6; lv[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, { ...lv, master: o.master ?? -3 });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "out", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
    for (const [n, j] of c.also || []) p.cable(n, j, mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.25, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return mix;
}


function riser() {
  const p = patch("Sweep Generator: Four-Bar Riser", {
    module: "sweep-generator", tempo: 124,
    description: "A ramp wave sweeps from 100 Hz to 8 kHz in exactly four bars, locked to the song, through a low-pass that opens with it, and End fires a noise crash as it flies back. Change Start, Stop, Law or Sweep Sync to reshape the build.",
    tags: ["riser", "build-up", "sync", "sweep"],
  });
  const sw = p.add("sweep-generator", [0, 0], { start: 100, stop: 8000, sweepsync: "4 bars", mode: "Continuous", law: "Log", waveform: "Ramp Up", retrace: "Glide", level: 0.5, drift: 0.05 });
  const flt = p.add("filter", [1, 0], { cutoff: 400, resonance: 0.45, drive: 0.2 });
  p.cable(sw, "out", flt, "l").cable(sw, "sweep", flt, "cutoff", 0.55);
  const n = p.add("noise", [1, 1], { colour: 0.3, level: 0.7 });
  const env = p.add("adsr", [2, 1], { attack: 0.005, decay: 1.2, sustain: 0, release: 0.8 });
  const nv = p.add("vca", [3, 1], {});
  p.cable(sw, "end", env, "gate").cable(n, "out", nv, "l").cable(env, "env", nv, "gain");
  const bt = beat(p, [0, 2], { style: "four", level: -6 });
  finish(p, [4, 0], [{ n: flt, l: "l", level: 0 }, { n: nv, l: "l", level: -8 }, { n: bt, l: "outl", r: "outr", level: -3 }], { vmix: 0.25 });
  return p;
}

function sirens() {
  const p = patch("Sweep Generator: Lab Sirens", {
    module: "sweep-generator", tempo: 78,
    description: "Two Up-Down triangle sweeps of different lengths, panned apart, wail over a slow bass and drift in and out of phase. Try Law Log for an even siren, Waveform Pulse for a harsher one, or a shorter Sweep Time.",
    tags: ["siren", "up-down", "triangle", "stereo"],
  });
  const a = p.add("sweep-generator", [0, 0], { start: 300, stop: 1100, time: 3.1, direction: "Up-Down", law: "Lin", waveform: "Triangle", level: 0.45 }, { name: "Siren A" });
  const b = p.add("sweep-generator", [0, 1], { start: 500, stop: 1500, time: 4.7, direction: "Up-Down", law: "Log", waveform: "Sine", level: 0.4, symmetry: 0.3 }, { name: "Siren B" });
  const m = melody(p, [2, 0], [0, ".", ".", 0, ".", 7, ".", "."], { rate: "1/4", root: "D", scale: "Natural Minor", octave: -2, shape: 0.3, env: { decay: 0.8 }, osc: { octave: "-1" } });
  finish(p, [3, 1], [{ n: a, l: "out", level: -6, pan: -0.6 }, { n: b, l: "out", level: -7, pan: 0.6 }, { n: m.amp, l: "l", level: 4 }], { vmix: 0.35, decay: 3.2, size: 0.65 });
  return p;
}

function bursts() {
  const p = patch("Sweep Generator: Climbing Bursts", {
    module: "sweep-generator", tempo: 100,
    description: "In Burst mode the sweep climbs slowly in silence, and each step of a sequencer plays a short tone burst at whatever frequency it has reached. Over eight bars they rise from 200 Hz to 4 kHz, like a stepped frequency measurement. Try Burst Count or a different Waveform.",
    tags: ["burst", "blips", "climb", "rhythm"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", gatelength: 0.4 },
    { data: steps([0, 0, ".", 0, 0, ".", 0, ".", 0, 0, ".", 0, ".", 0, 0, 0]) });
  const sw = p.add("sweep-generator", [1, 0], { start: 200, stop: 4000, sweepsync: "8 bars", mode: "Burst", burstcount: 5, law: "Log", waveform: "Sine", level: 0.9, retrace: "Instant" });
  p.cable(seq, "trigger", sw, "trigger");
  const m = melody(p, [2, 1], [0, ".", 7, ".", 5, ".", 3, "."], { rate: "1/4", root: "G", scale: "Minor Pentatonic", octave: -2, shape: 0.4, osc: { octave: "-1" }, env: { decay: 0.6 } });
  const bt = beat(p, [0, 2], { style: "sparse", level: -8 });
  finish(p, [4, 0], [{ n: sw, l: "out", level: 0, pan: 0.2 }, { n: m.amp, l: "l", level: 4 }, { n: bt, l: "outl", r: "outr", level: -4 }], { vmix: 0.3 });
  return p;
}

function markers() {
  const p = patch("Sweep Generator: Marker Drums", {
    module: "sweep-generator", tempo: 110,
    description: "Three Sweep Generators of different lengths (one bar, two bars, half a note) each fire a Marker when their Up-Down sweep crosses a set frequency, striking a kick, a snare and a hat: the sweeps play a drifting polyrhythm. Change a Marker frequency or Sweep Sync to move the hits.",
    tags: ["markers", "triggers", "drums", "polyrhythm"],
  });
  const mk = (at, name, sync, m1, extra = {}) => p.add("sweep-generator", at, { start: 100, stop: 1000, sweepsync: sync, direction: "Up-Down", law: "Log",
    markers: 1, marker1: m1, markerwidth: "10 ms", waveform: "Sine", level: 0.3, ...extra }, { name });
  const a = mk([0, 0], "Kick Sweep", "1 bar", 280);
  const b = mk([0, 1], "Snare Sweep", "2 bars", 520);
  const c = mk([0, 2], "Hat Sweep", "1/2", 400);
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.6 });
  const hat = p.add("punch-hats", [1, 2], { level: 0.5 });
  p.cable(a, "marker", kick, "trig").cable(b, "marker", snare, "trig").cable(c, "marker", hat, "closed");
  const m = melody(p, [2, 0], [0, 7, 5, 3, 7, 5, 3, 2], { rate: "1/8", root: "A", scale: "Minor Pentatonic", shape: 0.3, env: { decay: 0.2 } });
  finish(p, [3, 1], [{ n: kick, l: "out", level: -1 }, { n: snare, l: "out", level: -8, pan: 0.1, also: [[hat, "out"]] }, { n: a, l: "out", level: -10, pan: -0.3 }, { n: m.amp, l: "l", level: 2 }], { vmix: 0.2 });
  return p;
}

function lasers() {
  const p = patch("Sweep Generator: Laser Plucks", {
    module: "sweep-generator", tempo: 116,
    description: "Triggered mode with a falling sweep: each note of the sequencer fires one fast zap from high to low, and the note's pitch (the Pitch input) shifts where the sweep starts and ends. Lengthen Sweep Time for slower sirens, or switch Law to Lin.",
    tags: ["zap", "triggered", "pluck", "pitch"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, ".", 7, 3, ".", 12, 7, "."]) });
  const sw = p.add("sweep-generator", [1, 0], { start: 3000, stop: 180, time: 0.22, mode: "Triggered", waveform: "Square", symmetry: -0.3, law: "Log", level: 0.4, phasereset: true });
  p.cable(seq, "trigger", sw, "trigger").cable(seq, "pitch", sw, "pitch", 0.25);
  const flt = p.add("filter", [2, 0], { cutoff: 4000, resonance: 0.2 });
  p.cable(sw, "out", flt, "l");
  const m = melody(p, [2, 1], [0, "_", "_", "_", 7, "_", 5, "_"], { rate: "1/4", root: "E", scale: "Minor Pentatonic", octave: -2, shape: 0.2, env: { attack: 0.05, release: 0.8, sustain: 0.6 }, gatelength: 0.95, osc: { octave: "-1" } });
  finish(p, [4, 0], [{ n: flt, l: "l", level: 2 }, { n: m.amp, l: "l", level: 4 }], { vmix: 0.3, decay: 2.2, master: -8 });
  return p;
}

export default [riser, sirens, bursts, markers, lasers];
