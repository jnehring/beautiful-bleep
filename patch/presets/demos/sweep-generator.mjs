// SPDX-License-Identifier: MIT
// Sweep Generator: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Sources → Audio Mixer → Verb → Out 1/2. chans: {n, l (jack), r (jack, optional), level, pan}
function finish(p, at, chans, o = {}) {
  const lv = {};
  chans.forEach((c, i) => { lv[`level${i + 1}`] = c.level ?? -6; lv[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, { ...lv, master: o.master ?? 0 });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "out", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.25, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return mix;
}

function riser() {
  const p = patch("Sweep Generator: Eight-Bar Riser", {
    module: "sweep-generator", tempo: 124,
    description: "A saw tone climbs from 80 Hz to 6 kHz over eight bars while its Sweep output opens a filter on a bed of noise; at the top, the End trigger fires a crash. Edit Start, Stop and Sweep Sync for a shorter or lower riser, or switch Law to Lin to hear it rush through the bass.",
    tags: ["riser", "build-up", "sweep", "transition"],
  });
  const drums = beat(p, [0, 1], { style: "four", level: -6 });
  const sw = p.add("sweep-generator", [0, 0], { start: 80, stop: 6000, sweepsync: "8 bars", waveform: "Ramp Up", mode: "Continuous", law: "Log", retrace: "Instant", level: 0.5, drift: 0 }, { name: "Riser" });
  const lp = p.add("filter", [1, 0], { cutoff: 4000, resonance: 0.25, mode: 0 }, { name: "Tone Filter" });
  const noise = p.add("noise", [0, 2], { colour: 0.4, level: 0.5 });
  const nf = p.add("filter", [1, 1], { cutoff: 300, resonance: 0.45, mode: 0.5, type: "SVF Multimode" }, { name: "Noise Filter" });
  const crash = p.add("punch-cymbal", [1, 2], { decay: 3, tone: 0.55 });
  p.cable(sw, "out", lp, "l").cable(sw, "freq", lp, "pitch").cable(noise, "out", nf, "l").cable(sw, "sweep", nf, "cutoff", 0.95).cable(sw, "end", crash, "trig");
  const mix = finish(p, [3, 0], [{ n: lp, l: "l", level: -9 }, { n: nf, l: "l", level: -4, pan: 0.1 }, { n: crash, l: "out", level: -8, pan: -0.2 }], { vmix: 0.2, size: 0.6 });
  const dm = p.add("audio-mixer", [2, 1], { level1: -3, master: -3 }, { name: "Drums" });
  p.cable(drums, "outl", dm, "in1l").cable(dm, "outl", mix, "in4l").cable(dm, "outl", mix, "in4r");
  return p;
}

function siren() {
  const p = patch("Sweep Generator: Harbour Siren", {
    module: "sweep-generator", tempo: 80,
    description: "A triangle wave glides up and down between 300 Hz and 1.2 kHz, two bars each way, on a linear law like an old air-raid horn, with Drift keeping the pitch slightly alive. Change Direction, Waveform or Retrace to turn the siren into a whooping alarm, and let the delay ring behind it.",
    tags: ["siren", "up-down", "triangle", "effect"],
  });
  const sw = p.add("sweep-generator", [0, 0], { start: 300, stop: 1200, sweepsync: "4 bars", direction: "Up-Down", law: "Lin", waveform: "Triangle", symmetry: 0.2, level: 0.5, drift: 0.35 }, { name: "Siren" });
  const lp = p.add("filter", [1, 0], { cutoff: 2600, resonance: 0.15 }, { name: "Soften" });
  const dly = p.add("delay", [2, 0], { sync: "Tempo", ratel: "1/4.", rater: "1/4", mode: "Ping-Pong", feedback: 0.45, mix: 0.35, highcut: 3500 });
  const bass = melody(p, [0, 1], [0, ".", ".", ".", 0, ".", 7, "."], { rate: "1/4", root: "D", scale: "Natural Minor", octave: -2, shape: 0.2, env: { decay: 0.5, sustain: 0.4, release: 0.3 }, gatelength: 0.8 });
  p.cable(sw, "out", lp, "l").cable(lp, "l", dly, "l").cable(lp, "l", dly, "r");
  finish(p, [3, 0], [{ n: dly, l: "l", r: "r", level: -2 }, { n: bass.amp, l: "l", level: -4 }], { vmix: 0.3, decay: 3, master: -8 });
  return p;
}

function blips() {
  const p = patch("Sweep Generator: Climbing Blips", {
    module: "sweep-generator", tempo: 118,
    description: "In Burst mode the tone is silent until a trigger, and each trigger plays three clean cycles at the frequency the sweep has reached, so a steady sixteenth pulse becomes blips that climb through the band and start over every two bars. Raise Burst Count for longer blips, or change Stop to widen the climb.",
    tags: ["burst", "blips", "arpeggio", "trigger"],
  });
  const clk = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", root: "C", gatelength: 0.2 },
    { data: steps([0, 0, 0, ".", 0, 0, ".", 0, 0, 0, 0, ".", 0, ".", 0, 0]) });
  const sw = p.add("sweep-generator", [1, 0], { start: 200, stop: 3200, sweepsync: "2 bars", mode: "Burst", burstcount: 3, waveform: "Triangle", law: "Log", level: 0.6, drift: 0 }, { name: "Blips" });
  const env = p.add("adsr", [1, 1], { attack: 0.002, decay: 0.06, sustain: 0, release: 0.05 }, { name: "Pluck" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  p.cable(clk, "trigger", sw, "trigger").cable(clk, "gate", env, "gate").cable(clk, "trigger", env, "retrig").cable(sw, "out", amp, "l").cable(env, "env", amp, "gain");
  const dly = p.add("delay", [2, 1], { sync: "Tempo", ratel: "1/8.", rater: "1/16", mode: "Ping-Pong", feedback: 0.4, mix: 0.35 });
  p.cable(amp, "l", dly, "l").cable(amp, "l", dly, "r");
  const bass = melody(p, [0, 2], [0, ".", ".", 0, ".", ".", 7, ".", 5, ".", ".", 3, ".", ".", ".", "."], { rate: "1/16", root: "C", scale: "Natural Minor", octave: -2, shape: 0.15, gatelength: 0.5, env: { decay: 0.25, sustain: 0.2, release: 0.1 } });
  finish(p, [3, 0], [{ n: dly, l: "l", r: "r", level: 2 }, { n: bass.amp, l: "l", level: -2 }], { vmix: 0.2, master: 5 });
  return p;
}

function markerDrums() {
  const p = patch("Sweep Generator: Marker Drums", {
    module: "sweep-generator", tempo: 110,
    description: "A slow sweep from 100 Hz to 8 kHz crosses three Markers, and each crossing, in both directions, fires a kick and a hat, while the End trigger calls the snare once per cycle. Move a Marker to shift the rhythm, change Sweep Sync for a faster or slower pulse, or set Markers to 1 for a sparse beat.",
    tags: ["markers", "triggers", "drums", "generative"],
  });
  const sw = p.add("sweep-generator", [0, 0], { start: 100, stop: 8000, sweepsync: "1 bar", direction: "Up-Down", law: "Log", markers: 3, marker1: 250, marker2: 1000, marker3: 4000, level: 0.0, drift: 0 }, { name: "Timeline" });
  const kick = p.add("punch-kick", [1, 0], { level: 0.8, tune: 48 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.7 });
  const hat = p.add("punch-hats", [1, 2], {});
  p.cable(sw, "marker", kick, "trig").cable(sw, "end", snare, "trig").cable(sw, "marker", hat, "closed");
  const bass = melody(p, [2, 1], [0, ".", ".", 7, ".", 5, ".", ".", 3, ".", ".", 5, ".", 10, 7, "."], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -2, shape: 0.3, gatelength: 0.6, env: { decay: 0.3, sustain: 0.3, release: 0.15 } });
  const mix = p.add("audio-mixer", [2, 0], { level1: -2, level2: -6, pan2: 0.1, level3: -12, pan3: 0.3, level4: 0, master: -4 }, { name: "Mix" });
  p.cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hat, "out", mix, "in3l").cable(bass.amp, "l", mix, "in4l");
  const verb = p.add("reverb", [3, 0], { size: 0.4, decay: 1.8, mix: 0.18, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return p;
}

function zaps() {
  const p = patch("Sweep Generator: Laser Zaps", {
    module: "sweep-generator", tempo: 126,
    description: "In Triggered mode each sequencer note fires one quick downward sweep that begins on its own pitch (the Pitch input), so a bassline of zaps shoots across the speakers. Change Sweep Time for longer or shorter zaps, Waveform for a different edge, or Direction to make them rise.",
    tags: ["zap", "triggered", "pitch", "fx"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Phrygian", octave: 1, gatelength: 0.4 },
    { data: steps([0, ".", 0, 5, ".", 0, 3, ".", 0, ".", 7, ".", 5, 3, ".", 0]) });
  const sw = p.add("sweep-generator", [1, 0], { start: 2400, stop: 90, time: 0.16, mode: "Triggered", law: "Log", waveform: "Square", symmetry: -0.2, level: 0.35, drift: 0, phasereset: true }, { name: "Zap" });
  const env = p.add("adsr", [1, 1], { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.1 }, { name: "Zap Env" });
  const amp = p.add("vca", [2, 0], {}, { name: "VCA" });
  const lp = p.add("filter", [2, 1], { cutoff: 3500, resonance: 0.2 }, { name: "Tame" });
  p.cable(seq, "trigger", sw, "trigger").cable(seq, "pitch", sw, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(sw, "out", amp, "l").cable(env, "env", amp, "gain").cable(amp, "l", lp, "l");
  const drums = beat(p, [0, 2], { style: "half", level: -8 });
  const mix = finish(p, [3, 0], [{ n: lp, l: "l", level: 4 }], { vmix: 0.2, master: 3 });
  p.cable(drums, "outl", mix, "in2l").cable(drums, "outr", mix, "in2r");
  return p;
}

export default [riser, siren, blips, markerDrums, zaps];
