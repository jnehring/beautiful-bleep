// SPDX-License-Identifier: MIT
// Route: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A plucked voice: pitch → Oscillator → VCA with an ADSR from gate/retrigger. Returns the VCA ("l").
function pluck(p, at, pitch, gate, retrig, osc = {}, env = {}, name = "Voice") {
  const o = p.add("oscillator", [at[0], at[1]], { shape: 0.7, ...osc }, { name });
  const e = p.add("adsr", [at[0], at[1] + 1], { attack: 0.005, decay: 0.25, sustain: 0, release: 0.2, ...env }, { name: name + " Env" });
  const a = p.add("vca", [at[0] + 1, at[1]], {}, { name: name + " VCA" });
  p.cable(pitch[0], pitch[1], o, "pitch").cable(gate[0], gate[1], e, "gate").cable(retrig[0], retrig[1], e, "retrig")
    .cable(o, "out", a, "l").cable(e, "env", a, "gain");
  return a;
}

function melodyToThree() {
  const p = patch("Route: One Melody, Three Voices", {
    module: "route", tempo: 100,
    description: "One wandering melody is quantized once and sent to three different voices in turn by the Route: a bright saw, a hollow pulse and a soft sine, each for one bar. Set Idle Outputs to Hold and a voice keeps its last note while it waits.",
    tags: ["voices", "trigger", "quantizer", "bar by bar"],
  });
  const clk = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", gatelength: 0.5 }, { data: steps([0, 0, 0, ".", 0, 0, ".", 0]) }, { name: "Clock" });
  const rnd = p.add("random", [0, 2], { rate: 4, sync: "1/8", spread: 0.7, bias: 0, smooth: 0, seed: 7 }, { name: "Wander" });
  const bar = p.add("lfo", [0, 4], { wave: "Square", sync: "Tempo", division: "1/1", polarity: "Unipolar", pw: 0.1 }, { name: "Bar Clock" });
  const q = p.add("quantizer", [1, 0], { root: "E", scale: "Natural Minor", range: 1.5, hysteresis: 0 });
  p.cable(rnd, "out", q, "in", 0.8).cable(clk, "trigger", q, "clock");
  const rt = p.add("route", [2, 0], { outputs: 3, fade: 0.01 });
  p.cable(q, "out", rt, "in").cable(bar, "out", rt, "next");
  const shapes = [{ shape: 0.9 }, { shape: 0.5, pw: 0.25 }, { shape: 0 }];
  const amps = shapes.map((s, i) => pluck(p, [3, i * 2], [rt, "out" + (i + 1)], [q, "gate"], [clk, "trigger"], s, {}, "Voice " + (i + 1)));
  const drums = beat(p, [0, 8], { style: "half", level: -10 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -2, level3: -2, level4: 0, master: -4 });
  amps.forEach((a, i) => p.cable(a, "l", mix, `in${i + 1}l`).cable(a, "l", mix, `in${i + 1}r`));
  p.stereo(drums, mix, { from: ["outl", "outr"], to: ["in4l", "in4r"] });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function sweptEffects() {
  const p = patch("Route: A Slow LFO Sends the Riff Around", {
    module: "route", tempo: 96,
    description: "A slow triangle LFO on the Select knob moves one riff between four treatments: dry, a long echo, a low-pass filter and a big reverb. The 120 ms Fade blends from one to the next; at 0 it cuts, at 1 s it morphs.",
    tags: ["lfo", "cv", "effects", "sweep"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 10, 12, 10, 7, 3], { rate: "1/8", shape: 0.8, root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 });
  const rt = p.add("route", [3, 0], { outputs: 4, fade: 0.12 });
  const lfo = p.add("lfo", [3, 2], { rate: 0.07, wave: "Triangle", polarity: "Unipolar" }, { name: "Sweep" });
  p.cable(m.amp, "l", rt, "in").cable(lfo, "out", rt, "select");
  const dl = p.add("delay", [4, 1], { timel: 375, timer: 500, feedback: 0.55, highcut: 4500, mix: 1 });
  const lp = p.add("filter", [4, 2], { cutoff: 700, resonance: 0.3, type: "SVF Multimode" });
  const rv = p.add("reverb", [4, 3], { size: 0.9, decay: 6, mix: 1, quality: "Eco (8 lines)" });
  p.cable(rt, "out2", dl, "l").cable(rt, "out2", dl, "r").cable(rt, "out3", lp, "l").cable(rt, "out4", rv, "l").cable(rt, "out4", rv, "r");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -2, level3: -3, level4: -6, master: -2 });
  p.cable(rt, "out1", mix, "in1l").cable(rt, "out1", mix, "in1r")
    .stereo(dl, mix, { from: ["l", "r"], to: ["in2l", "in2r"] }).cable(lp, "l", mix, "in3l").cable(lp, "l", mix, "in3r")
    .stereo(rv, mix, { from: ["l", "r"], to: ["in4l", "in4r"] });
  const drums = beat(p, [0, 6], { style: "half", level: -8 });
  const dm = p.add("audio-mixer", [6, 0], { level1: 0, level2: 0, master: 0 });
  p.stereo(mix, dm, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(drums, dm, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(dm, p.out, { from: ["outl", "outr"] });
  return p;
}

function laneTriggers() {
  const p = patch("Route: Slot Triggers Aim the Hit", {
    module: "route", tempo: 118,
    description: "Slot Triggers is set to 3: a trigger on Trig 1, 2 or 3 aims the Route at that output. One snare hit is sent to a dry output, a short room or a long hall depending on which Drum Grid lane fired just before it.",
    tags: ["slot triggers", "drums", "reverb", "jump"],
  });
  const g = p.add("drum-grid", [0, 0], {}, { name: "Groove", data: drumGrid(["Hit", "Kick", "Aim 1", "Aim 2", "Aim 3", "", "", ""],
    [pattern("Groove", ["....x.......x...", "x..x..x..x.x..x.", "x...............", "....x...........", "............x..."])]) });
  const snare = p.add("punch-snare", [1, 0], { level: 0.75 });
  const kick = p.add("punch-kick", [1, 3], { level: 0.8 });
  const rt = p.add("route", [2, 0], { outputs: 3, fade: 0, trigs: 3 });
  p.cable(g, "gate1", snare, "trig").cable(snare, "out", rt, "in").cable(g, "gate3", rt, "trig1").cable(g, "gate4", rt, "trig2").cable(g, "gate5", rt, "trig3");
  const room = p.add("reverb", [3, 1], { size: 0.25, decay: 0.6, mix: 1, quality: "Eco (8 lines)" }, { name: "Room" });
  const hall = p.add("reverb", [3, 2], { size: 0.9, decay: 5, mix: 1, quality: "Eco (8 lines)" }, { name: "Hall" });
  p.cable(rt, "out2", room, "l").cable(rt, "out2", room, "r").cable(rt, "out3", hall, "l").cable(rt, "out3", hall, "r");
  p.cable(g, "gate2", kick, "trig");
  const hats = p.add("punch-hats", [1, 5], { level: 0.4 });
  p.cable(g, "gate2", hats, "closed");
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -4, level3: -6, level4: -2, level5: -12, master: -3 });
  p.cable(rt, "out1", mix, "in1l").cable(rt, "out1", mix, "in1r").stereo(room, mix, { from: ["l", "r"], to: ["in2l", "in2r"] })
    .stereo(hall, mix, { from: ["l", "r"], to: ["in3l", "in3r"] }).cable(kick, "out", mix, "in4l").cable(kick, "out", mix, "in4r")
    .cable(hats, "out", mix, "in5l").cable(hats, "out", mix, "in5r");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function heldNotes() {
  const p = patch("Route: Hold Keeps Every Voice Singing", {
    module: "route", tempo: 76,
    description: "Idle Outputs is Hold: a new note goes to the next of four drones every bar, and each drone keeps the pitch it last got until its turn comes again. The result is a four-note chord that rolls forward one note at a time.",
    tags: ["hold", "chord", "drone", "ambient"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "D", scale: "Dorian", octave: -1, gatelength: 1 },
    { data: steps([0, 7, 3, 10]) }, { name: "Notes" });
  const bar = p.add("lfo", [0, 2], { wave: "Square", sync: "Tempo", division: "1/1", polarity: "Unipolar", pw: 0.1 }, { name: "Bar Clock" });
  const rt = p.add("route", [1, 0], { outputs: 4, idle: "Hold", fade: 0.4 });
  p.cable(seq, "pitch", rt, "in").cable(bar, "out", rt, "next");
  const mix = p.add("audio-mixer", [3, 0], { level1: -12, level2: -12, level3: -12, level4: -12, master: 0 });
  for (let i = 0; i < 4; i++) {
    const o = p.add("oscillator", [2, i], { shape: i % 2 ? 0.15 : 0.45, fine: (i - 1.5) * 5, octave: i < 2 ? "0" : "+1" }, { name: "Drone " + (i + 1) });
    p.cable(rt, "out" + (i + 1), o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  }
  const f = p.add("filter", [4, 0], { cutoff: 1800, resonance: 0.1, type: "SVF Multimode" });
  p.cable(mix, "outl", f, "l");
  const v = p.add("reverb", [5, 0], { size: 0.8, decay: 6, mix: 0.4, quality: "Eco (8 lines)" });
  p.cable(f, "l", v, "l").cable(f, "l", v, "r").stereo(v, p.out);
  return p;
}

function randomPan() {
  const p = patch("Route: Random Hits Around Four Voices", {
    module: "route", tempo: 124,
    description: "One hi-hat pattern is dealt out at random to four differently tuned percussion filters, one step at a time, by a Route that follows the song at 1/8 (nothing is patched into Next). Change Seed for another order, or Order to Forward for a fixed rotation.",
    tags: ["random", "transport", "percussion", "seed"],
  });
  const g = p.add("drum-grid", [0, 0], {}, { name: "Pulse", data: drumGrid(["Hit", "", "", "", "", "", "", ""], [pattern("Pulse", ["xxxxxxxxxxxxxxxx"])]) });
  const hats = p.add("punch-hats", [1, 0], { level: 0.6 });
  p.cable(g, "gate1", hats, "closed");
  const rt = p.add("route", [2, 0], { outputs: 4, rate: "1/8", order: "Random", seed: 3, fade: 0 });
  p.cable(hats, "out", rt, "in");
  const mix = p.add("audio-mixer", [4, 0], { level1: 0, level2: 0, level3: 0, level4: 0, level5: -4, master: 0 });
  const cutoffs = [600, 1500, 3200, 6500];
  cutoffs.forEach((c, i) => {
    const f = p.add("filter", [3, i], { cutoff: c, resonance: 0.55, type: "SVF Bandpass (unit gain)" }, { name: "Band " + (i + 1) });
    p.cable(rt, "out" + (i + 1), f, "l").cable(f, "l", mix, `in${i + 1}l`).cable(f, "l", mix, `in${i + 1}r`);
  });
  const drums = beat(p, [0, 6], { style: "four", level: -8 });
  p.stereo(drums, mix, { from: ["outl", "outr"], to: ["in5l", "in5r"] });
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.4, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [melodyToThree, sweptEffects, laneTriggers, heldNotes, randomPan];
