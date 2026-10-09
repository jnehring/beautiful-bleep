// SPDX-License-Identifier: MIT
// Low Pass Gate: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// Mixer (outl/outr) → reverb (100 % wet via the mixer's return would be heavier): mixer → reverb → Out.
function finish(p, at, mix, verb = {}) {
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.3, quality: "Eco (8 lines)", ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function pentatonicPings() {
  const p = patch("Low Pass Gate: Pentatonic Pings", {
    module: "low-pass-gate", tempo: 96,
    description: "A saw oscillator is pinged by a pentatonic sequence through the gate's Classic cell: each note opens fast and darkens as it dies, like a struck wooden bar. Turn Response for shorter or longer plucks and Resonance for more ring.",
    tags: ["pluck", "ping", "pentatonic", "vactrol"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "D", scale: "Major Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, 4, 7, 4, 9, 7, 4, 2, 0, 4, 9, 12, 9, 7, 4, 7]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.9 });
  const g = p.add("low-pass-gate", [2, 0], { response: 0.45, ping: 0.9, resonance: 0.3, brightness: 0.6, cell: "Classic", mode: "Both" });
  const mix = p.add("audio-mixer", [3, 0], { level1: 5, master: 3 });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "trigger", g, "ping").cable(osc, "out", g, "l")
    .stereo(g, mix, { to: ["in1l", "in1r"] });
  finish(p, [4, 0], mix, { size: 0.55, decay: 3, mix: 0.3 });
  return p;
}

function slowMemoryBass() {
  const p = patch("Low Pass Gate: Slow Memory Bass", {
    module: "low-pass-gate", tempo: 82,
    description: "The Slow memory cell remembers earlier pings, so a sub-heavy bass line opens a little more with each note that follows another quickly. Switch Cell to Fast to hear it forget.",
    tags: ["bass", "slow memory", "sub", "organic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "A", scale: "Natural Minor", octave: -2, gatelength: 0.3 },
    { data: steps([0, ".", 0, 0, ".", 7, ".", 5, 0, ".", 0, 0, 3, ".", 5, 7], [127, 90, 90, 110]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.35 });
  const g = p.add("low-pass-gate", [2, 0], { response: 0.65, ping: 1, resonance: 0.15, brightness: 0.5, drive: 0.3, cell: "Slow memory" });
  const mix = p.add("audio-mixer", [3, 0], { level1: 4, master: 2 });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "trigger", g, "ping").cable(seq, "velocity", g, "velocity")
    .cable(osc, "out", g, "l").stereo(g, mix, { to: ["in1l", "in1r"] });
  finish(p, [4, 0], mix, { size: 0.35, decay: 1.4, mix: 0.15 });
  return p;
}

function vactrolDrums() {
  const p = patch("Low Pass Gate: Vactrol Drums", {
    module: "low-pass-gate", tempo: 108,
    description: "Three gates ping from a Drum Grid: a low sine for the kick, noise for the snare and a bright square for the ticks. Everything is the gate's own pluck envelope; Response sets how tight the drums are.",
    tags: ["drums", "noise", "percussion", "west coast"],
  });
  const rows = ["X...X...X..X....", "....X.......X..x", "..x.x.xx..x.x.x."];
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Tick", "", "", "", "", ""], [pattern("Pings", rows)]) });
  const sine = p.add("oscillator", [1, 0], { octave: "-2", shape: 0, coarse: -5 }, { name: "Kick Osc" });
  const noise = p.add("noise", [1, 1], { colour: 0.2 });
  const sq = p.add("oscillator", [1, 2], { octave: "+2", shape: 0.95, coarse: 3 }, { name: "Tick Osc" });
  const kick = p.add("low-pass-gate", [2, 0], { response: 0.35, ping: 1, resonance: 0.2, brightness: 0.35, drive: 0.2 }, { name: "Kick Gate" });
  const snare = p.add("low-pass-gate", [2, 1], { response: 0.4, ping: 0.9, brightness: 0.8 }, { name: "Snare Gate" });
  const tick = p.add("low-pass-gate", [2, 2], { response: 0.12, ping: 0.8, resonance: 0.4, brightness: 0.85 }, { name: "Tick Gate" });
  const mix = p.add("audio-mixer", [3, 0], { level1: 2, level2: -3, level3: -7, pan2: 0.1, pan3: 0.35, master: 2 });
  p.cable(grid, "gate1", kick, "ping").cable(sine, "out", kick, "l").cable(kick, "l", mix, "in1l")
    .cable(grid, "gate2", snare, "ping").cable(noise, "out", snare, "l").cable(snare, "l", mix, "in2l")
    .cable(grid, "gate3", tick, "ping").cable(sq, "out", tick, "l").cable(tick, "l", mix, "in3l");
  finish(p, [4, 0], mix, { size: 0.3, decay: 1.2, mix: 0.15 });
  return p;
}

function lightFollower() {
  const p = patch("Low Pass Gate: Light Follower", {
    module: "low-pass-gate", tempo: 90,
    description: "The gate's Light output, a ready-made pluck envelope, opens a Multi Filter on a drone, so a quiet saw pad brightens with each ping and dims again. Change Response to stretch the glow.",
    tags: ["light", "modulation", "drone", "envelope"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", ".", 7, ".", ".", ".", 5, ".", ".", ".", 3, ".", 2, "."],
    { rate: "1/4", shape: 0.4, root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.3 });
  const g = p.add("low-pass-gate", [3, 0], { response: 0.6, ping: 0.9, resonance: 0.25, brightness: 0.7 });
  const drone = p.add("oscillator", [0, 2], { shape: 1, octave: "-1", fine: 6 }, { name: "Drone" });
  const drone2 = p.add("oscillator", [0, 3], { shape: 1, octave: "-1", fine: -7 }, { name: "Drone 2" });
  const dm = p.add("audio-mixer", [1, 2], { level1: -8, level2: -8, pan1: -0.4, pan2: 0.4, master: -4 }, { name: "Drone Mix" });
  const flt = p.add("filter", [2, 2], { cutoff: 250, resonance: 0.35 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -4, level2: -4, master: -2 });
  p.cable(m.seq, "trigger", g, "ping").cable(m.osc, "out", g, "l")
    .cable(drone, "out", dm, "in1l").cable(drone2, "out", dm, "in2l").stereo(dm, flt, { from: ["outl", "outr"] })
    .cable(g, "light", flt, "cutoff", 0.5)
    .stereo(g, mix, { to: ["in1l", "in1r"] }).stereo(flt, mix, { to: ["in2l", "in2r"] });
  finish(p, [5, 0], mix, { size: 0.6, decay: 3.5, mix: 0.3 });
  return p;
}

function breathingGate() {
  const p = patch("Low Pass Gate: Breathing Chord", {
    module: "low-pass-gate", tempo: 66,
    description: "A slow LFO on the CV input opens and closes the gate over a held saw chord, with the Slow memory cell smoothing every swell into a breathing, darker-as-it-closes pad. Lower Brightness or add Resonance to change the colour.",
    tags: ["pad", "cv", "swell", "chord"],
  });
  const mixOsc = p.add("audio-mixer", [1, 0], { level1: -9, level2: -9, level3: -9, pan1: -0.5, pan3: 0.5, master: -3 }, { name: "Chord" });
  [0, 3, 7].forEach((n, i) => {
    const o = p.add("oscillator", [0, i], { shape: 0.9, coarse: n - 12, fine: (i - 1) * 8 }, { name: `Note ${i + 1}` });
    p.cable(o, "out", mixOsc, `in${i + 1}l`);
  });
  const g = p.add("low-pass-gate", [2, 0], { response: 0.8, resonance: 0.3, brightness: 0.55, cell: "Slow memory", mode: "Both", level: 0 });
  const lfo = p.add("lfo", [2, 2], { wave: "Sine", sync: "2 bars", polarity: "Unipolar" }, { name: "Breath" });
  const lfo2 = p.add("lfo", [3, 2], { wave: "Triangle", rate: 0.07 }, { name: "Colour" });
  const mix = p.add("audio-mixer", [3, 0], { level1: 2, master: -2 });
  p.stereo(mixOsc, g, { from: ["outl", "outr"] }).cable(lfo, "out", g, "cv").cable(lfo2, "out", g, "brightness", 0.2)
    .stereo(g, mix, { to: ["in1l", "in1r"] });
  finish(p, [4, 0], mix, { size: 0.7, decay: 5, mix: 0.35 });
  return p;
}

export default [pentatonicPings, slowMemoryBass, vactrolDrums, lightFollower, breathingGate];
