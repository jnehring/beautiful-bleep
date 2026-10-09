// SPDX-License-Identifier: MIT
// Wave Analyzer: five demo patches. Each plays by itself with the transport.
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




function harmonics() {
  const p = patch("Wave Analyzer: Harmonic Series", {
    module: "wave-analyzer", tempo: 100,
    description: "A narrow band sweeps up five octaves through a low saw drone, lighting up each harmonic in turn: the Band output plays the overtone series as a rising melody, and every harmonic it finds fires Peak, which plays the hats. Try Bandwidth 100 Hz or a faster Sync.",
    tags: ["sweep", "harmonics", "peak", "spectrum"],
  });
  const o = p.add("oscillator", [0, 0], { shape: 1, octave: "-2" }, { name: "Saw Drone" });
  const wa = p.add("wave-analyzer", [1, 0], { mode: "Sweep", frequency: 65.4, span: 5, sync: "2 bars", bandwidth: "10 Hz", gain: 22, threshold: 0.45, drift: 0.05 });
  p.cable(o, "out", wa, "in");
  const hats = p.add("punch-hats", [2, 1], { level: 0.5 });
  const kick = p.add("punch-kick", [2, 2], { level: 0.7 });
  p.cable(wa, "peak", hats, "closed");
  const grid = p.add("drum-grid", [0, 2], {}, { data: drumGrid(["Kick", "", "", "", "", "", "", ""], [pattern("Pulse", ["X...x...X...x...", "", "", ""])]) });
  p.cable(grid, "gate1", kick, "trig");
  finish(p, [3, 0], [{ n: wa, l: "band", level: -2 }, { n: o, l: "out", level: -22 }, { n: hats, l: "out", level: -8, pan: 0.3, also: [[kick, "out"]] }], { vmix: 0.3, decay: 3 });
  return p;
}

function onePitch() {
  const p = patch("Wave Analyzer: One Pitch from Everything", {
    module: "wave-analyzer", tempo: 90,
    description: "A wide-open sweep drifts through a plucked saw melody while Shifted moves whatever partial it finds to the Listen frequency: the tune becomes a stream of changing timbres all at one pitch. Move Listen to change that pitch, or Bandwidth to 3 Hz for purer tones.",
    tags: ["shifted", "listen", "timbre", "sweep"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 10, 5, 12, 7, 3], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 1, env: { decay: 0.4, sustain: 0.3 } });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Sweep", frequency: 110, span: 4, sync: "1 bar", sweepdir: "Up-Down", bandwidth: "30 Hz", listen: 440, gain: 22 });
  p.cable(m.amp, "l", wa, "in");
  finish(p, [4, 0], [{ n: wa, l: "shifted", level: -2, pan: -0.2 }, { n: wa, l: "band", level: -8, pan: 0.3 }, { n: m.amp, l: "l", level: -14 }], { vmix: 0.3 });
  return p;
}

function tracker() {
  const p = patch("Wave Analyzer: Pitch Tracker", {
    module: "wave-analyzer", tempo: 104,
    description: "In Lock mode the analyser hunts for the loudest partial within Capture of the dial, locks on and follows it: Track drives a square voice an octave below that doubles the melody, and Locked gates it. Widen Capture or move Frequency to change what it grabs.",
    tags: ["lock", "tracking", "pitch", "follower"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 10, 7, 12, 10, 7], { rate: "1/4", root: "D", scale: "Dorian", octave: 0, shape: 0.9, gatelength: 0.9, env: { decay: 0.5, sustain: 0.6 } });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Lock", frequency: 400, capture: 14, gain: 20, bandwidth: "30 Hz", drift: 0.1 });
  p.cable(m.amp, "l", wa, "in");
  const o = p.add("oscillator", [4, 1], { shape: 0.5, octave: "-1" }, { name: "Follower" });
  const env = p.add("adsr", [4, 2], { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.2 });
  const a = p.add("vca", [5, 1], {});
  p.cable(wa, "track", o, "pitch").cable(wa, "locked", env, "gate").cable(o, "out", a, "l").cable(env, "env", a, "gain");
  finish(p, [6, 0], [{ n: m.amp, l: "l", level: 2, pan: -0.3 }, { n: a, l: "l", level: -2, pan: 0.3 }, { n: wa, l: "band", level: -8 }], { vmix: 0.25 });
  return p;
}

function spectrum() {
  const p = patch("Wave Analyzer: Spectrum Pad", {
    module: "wave-analyzer", tempo: 80,
    description: "A slow synced sweep reads a three-saw chord from 20 Hz up through the whole spectrum in four bars; the Band output sings each partial as it passes and the plotter draws the spectrum. Try Hold on a slow LFO to freeze a partial, or Sync Free for a looser sweep.",
    tags: ["spectrum", "pad", "chord", "slow sweep"],
  });
  const mk = (at, name, oct, coarse) => p.add("oscillator", at, { shape: 1, octave: oct, coarse }, { name });
  const a = mk([0, 0], "A2", "-1", -3), b = mk([0, 1], "E3", "-1", 4), c = mk([0, 2], "A3", "0", -3);
  const mix = p.add("audio-mixer", [1, 1], { level1: -6, level2: -8, level3: -10 }, { name: "Chord" });
  p.cable(a, "out", mix, "in1l").cable(b, "out", mix, "in2l").cable(c, "out", mix, "in3l");
  const wa = p.add("wave-analyzer", [2, 0], { mode: "Sweep", frequency: 20, span: 10, sync: "4 bars", bandwidth: "30 Hz", gain: 24, drift: 0.1 });
  p.cable(mix, "outl", wa, "in");
  const lfo = p.add("lfo", [2, 2], { rate: 0.06 }, { name: "Width" });
  p.cable(lfo, "out", wa, "listen", 0.1);
  finish(p, [3, 0], [{ n: wa, l: "band", level: -6 }, { n: wa, l: "shifted", level: -14, pan: 0.3 }, { n: mix, l: "outl", r: "outr", level: -18 }], { vmix: 0.4, decay: 4.5, size: 0.8, master: -5 });
  return p;
}

function held() {
  const p = patch("Wave Analyzer: Held Partial", {
    module: "wave-analyzer", tempo: 112,
    description: "The sweep moves through a bass-and-lead sequence, but a square LFO on Hold freezes it on one partial for a bar at a time, then lets it run again; the wide 1/3-octave Bandwidth makes the band whistle and talk. Change the Hold rate or Bandwidth to taste.",
    tags: ["hold", "band", "talking", "sweep"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, 5, ".", 10, 7, 12], { rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -1, shape: 1, env: { decay: 0.3 } });
  const wa = p.add("wave-analyzer", [3, 0], { mode: "Sweep", frequency: 80, span: 5, sync: "2 bars", sweepdir: "Up-Down", bandwidth: "1/3 octave", listen: 700, gain: 18 });
  const hold = p.add("lfo", [3, 1], { wave: "Square", sync: "1 bar", polarity: "Unipolar", pw: 0.4 }, { name: "Hold Gate" });
  p.cable(m.amp, "l", wa, "in").cable(hold, "out", wa, "hold");
  const bt = beat(p, [0, 2], { style: "half", level: -10 });
  finish(p, [4, 0], [{ n: wa, l: "band", level: -2, pan: -0.2 }, { n: m.amp, l: "l", level: 0, pan: 0.3 }, { n: bt, l: "outl", r: "outr", level: -4 }], { vmix: 0.25 });
  return p;
}

export default [harmonics, onePitch, tracker, spectrum, held];
