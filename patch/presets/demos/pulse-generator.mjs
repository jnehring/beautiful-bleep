// SPDX-License-Identifier: MIT
// Pulse Generator: five demo patches. Each plays by itself with the transport.
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

function clockHats() {
  const p = patch("Pulse Generator: Humanised Clock", {
    module: "pulse-generator", tempo: 112,
    description: "A Pulse Generator synced to 1/16 is the clock for a melody, while a second one rings a short pulse into hi-hat ticks. Jitter on the first one loosens the groove; try it at 0 for a rigid machine and at 40 % for a drunk one.",
    tags: ["clock", "jitter", "hats", "sync"],
  });
  const clk = p.add("pulse-generator", [0, 0], { mode: "Free Run", sync: "1/8", widthpct: 0.1, units: "% of Period", jitter: 0.12, seed: 4 }, { name: "Clock" });
  const m = melody(p, [2, 0], [0, 7, 3, 5, 0, 10, 7, 3], { rate: "1/8", root: "F", scale: "Dorian", shape: 0.5, osc: { octave: "-1" } });
  p.cable(clk, "gate", m.seq, "clock");
  const tick = p.add("pulse-generator", [0, 1], { mode: "Free Run", sync: "1/16", width: 0.00025, ring: 1, ringfreq: 7500, damping: 0.78, jitter: 0.06, seed: 9 }, { name: "Hat Ticks" });
  const tick2 = p.add("pulse-generator", [1, 1], { mode: "Free Run", sync: "1/4", width: 0.0003, ring: 1, ringfreq: 220, damping: 0.45, amplitude: 1 }, { name: "Thump" });
  const ho = p.add("filter", [1, 0], { cutoff: 5000, mode: 1, resonance: 0.1 }, { name: "Hat Filter" });
  p.cable(tick, "ring", ho, "l");
  finish(p, [3, 1], [{ n: m.amp, l: "l", level: 4, pan: -0.2 }, { n: ho, l: "l", level: -6, pan: 0.35 }, { n: tick2, l: "ring", level: -6 }], { vmix: 0.2 });
  return p;
}

function pingMelody() {
  const p = patch("Pulse Generator: Ringing Pings", {
    module: "pulse-generator", tempo: 84,
    description: "A very short pulse struck once per note makes the Ring resonance ping, and the sequencer's pitch moves Ring Freq, so each note is a glassy, metallic chime. Turn Damping to change how long they ring, or Width to change their colour.",
    tags: ["ring", "chime", "pitch", "triggered"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", root: "E", scale: "Minor Pentatonic", octave: 1, gatelength: 0.3 },
    { data: steps([0, 7, 3, ".", 12, 7, 5, ".", 3, ".", 10, 7, 12, ".", 15, 7]) });
  const ping = p.add("pulse-generator", [1, 0], { mode: "Triggered", period: 0.05, width: 0.0002, ring: 1, ringfreq: 880, damping: 0.2, amplitude: 1 }, { name: "Ping" });
  const ping2 = p.add("pulse-generator", [1, 1], { mode: "Triggered", period: 0.05, width: 0.0004, ring: 1, ringfreq: 1760, damping: 0.15 }, { name: "Ping Octave" });
  p.cable(seq, "trigger", ping, "trigger").cable(seq, "pitch", ping, "pitch").cable(seq, "trigger", ping2, "trigger").cable(seq, "pitch", ping2, "pitch");
  const drift = p.add("lfo", [0, 1], { rate: 0.07 }, { name: "Colour" });
  p.cable(drift, "out", ping, "damping", 0.2);
  finish(p, [3, 0], [{ n: ping, l: "ring", level: 6, pan: -0.25 }, { n: ping2, l: "ring", level: 2, pan: 0.3 }], { decay: 4, size: 0.75, master: 6, vmix: 0.5 });
  return p;
}

function drums() {
  const p = patch("Pulse Generator: Pulse Drums", {
    module: "pulse-generator", tempo: 98,
    description: "Four Pulse Generators in Triggered mode, each struck by a Drum Grid track: Ring Freq and Damping turn the same circuit into a deep thump, a tom, a rim click and a hat. Change their Ring Freq and Damping for a whole new kit.",
    tags: ["drums", "ring", "percussion", "triggered"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Thump", "Tom", "Click", "Tick", "", "", "", ""],
    [pattern("Kit", ["X..x..x...X..x..", "....x.......x.x.", "x.x.x.xxx.x.x.x.", "..x...x...x...x."])]) });
  const defs = [
    ["Thump", { ringfreq: 62, damping: 0.25, width: 0.004, level: 1 }, "ring", 0],
    ["Tom", { ringfreq: 170, damping: 0.4, width: 0.003 }, "ring", -0.3],
    ["Click", { ringfreq: 2400, damping: 0.8, width: 0.0002 }, "ring", 0.3],
    ["Tick", { ringfreq: 9000, damping: 0.85, width: 0.0001 }, "ring", 0.5],
  ];
  const chans = defs.map(([name, v, jack, pan], i) => {
    const { level, ...vals } = v;
    const n = p.add("pulse-generator", [1, i], { mode: "Triggered", period: 0.05, ring: 1, ...vals }, { name });
    p.cable(grid, `gate${i + 1}`, n, "trigger");
    return { n, l: jack, level: [-1, -5, -9, -11][i], pan };
  });
  const m = melody(p, [2, 0], [0, ".", ".", 7, ".", 5, ".", "."], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 0.1, env: { decay: 0.5 }, osc: { octave: "-1" } });
  const kit = chans.slice(0, 2), hi = chans.slice(2);
  finish(p, [3, 1], [kit[0], kit[1], { ...hi[0], also: [[hi[1].n, "ring"]] }, { n: m.amp, l: "l", level: 2 }], { vmix: 0.18 });
  return p;
}

function rolls() {
  const p = patch("Pulse Generator: Rolls and Flams", {
    module: "pulse-generator", tempo: 120,
    description: "Burst fires four to eight pulses 30 ms apart for a drum roll, and Double adds a second pulse for a flam. A sparse beat triggers them, so the kit rolls in at the ends of phrases. Try Burst 16 or a longer Period.",
    tags: ["burst", "roll", "flam", "double"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Roll", "Flam", "Ping", "", "", "", ""],
    [pattern("Fills", ["X.......X.......", "............x...", "....x.......x...", "..x...x.x.x....."])]) });
  const k = p.add("pulse-generator", [1, 0], { mode: "Triggered", period: 0.05, width: 0.005, ring: 1, ringfreq: 55, damping: 0.22 }, { name: "Kick" });
  const roll = p.add("pulse-generator", [1, 1], { mode: "Triggered", period: 0.032, burst: 6, width: 0.0003, ring: 1, ringfreq: 950, damping: 0.7 }, { name: "Roll" });
  const flam = p.add("pulse-generator", [1, 2], { mode: "Triggered", period: 0.08, width: 0.0004, delay: 0.035, double: true, ring: 1, ringfreq: 330, damping: 0.5 }, { name: "Flam" });
  const png = p.add("pulse-generator", [1, 3], { mode: "Triggered", period: 0.2, burst: 3, width: 0.0002, ring: 1, ringfreq: 4400, damping: 0.85 }, { name: "Ping Burst" });
  p.cable(grid, "gate1", k, "trigger").cable(grid, "gate2", roll, "trigger").cable(grid, "gate3", flam, "trigger").cable(grid, "gate4", png, "trigger");
  const m = melody(p, [2, 0], [0, 0, 7, 0, 10, 0, 5, 3], { rate: "1/8", root: "G", scale: "Natural Minor", octave: -1, shape: 0.7, osc: { octave: "-1" } });
  finish(p, [3, 1], [{ n: k, l: "ring", level: 0, also: [[png, "ring"]] }, { n: roll, l: "ring", level: -4, pan: -0.3 }, { n: flam, l: "ring", level: -4, pan: 0.3 },
    { n: m.amp, l: "l", level: 4 }], { vmix: 0.2 });
  return p;
}

function gateEcho() {
  const p = patch("Pulse Generator: Gate Echo", {
    module: "pulse-generator", tempo: 90,
    description: "In External Width mode the Pulse Generator is a gate delay: each gate of a slow melody comes out 330 ms later, as long as it went in, and opens a second voice an octave up. Change Delay to move the echo, and Width to see the gate length.",
    tags: ["external width", "gate delay", "echo", "melody"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 4, 7, ".", 9, 7, 4, "."]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.3 });
  const e1 = p.add("adsr", [1, 1], { attack: 0.005, decay: 0.4, sustain: 0.3, release: 0.4 });
  const a1 = p.add("vca", [2, 0], {});
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "gate", e1, "gate").cable(seq, "trigger", e1, "retrig").cable(o1, "out", a1, "l").cable(e1, "env", a1, "gain");
  const dly = p.add("pulse-generator", [0, 2], { mode: "External Width", delay: 0.33, width: 0.05, jitter: 0 }, { name: "Gate Delay" });
  p.cable(seq, "gate", dly, "gate");
  const o2 = p.add("oscillator", [1, 2], { shape: 0.6, octave: "+1" });
  const e2 = p.add("adsr", [1, 3], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.5 });
  const a2 = p.add("vca", [2, 2], {});
  p.cable(seq, "pitch", o2, "pitch").cable(dly, "gate", e2, "gate").cable(dly, "sync", e2, "retrig").cable(o2, "out", a2, "l").cable(e2, "env", a2, "gain");
  const bt = beat(p, [3, 2], { style: "half", level: -10 });
  finish(p, [4, 0], [{ n: a1, l: "l", level: 4, pan: -0.3 }, { n: a2, l: "l", level: 0, pan: 0.4 }, { n: bt, l: "outl", r: "outr", level: -6 }], { vmix: 0.3 });
  return p;
}

export default [clockHats, pingMelody, drums, rolls, gateEcho];
