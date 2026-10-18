// SPDX-License-Identifier: MIT
// Pulse Generator: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// Mono/stereo sources → Audio Mixer → Verb → Out 1/2. chans: {n, l (jack), r (jack, optional), level, pan}
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

function wobblyClock() {
  const p = patch("Pulse Generator: Wobbly Clock", {
    module: "pulse-generator", tempo: 108,
    description: "A Pulse Generator synced to 1/8 is the clock of the melody, and its Jitter nudges every pulse a little early or late, so the tune sways like a human player. Turn Jitter to 0 for a rigid machine, or up to 40 % for a drunk one; the same Seed always gives the same wobble.",
    tags: ["clock", "jitter", "groove", "sync"],
  });
  const clk = p.add("pulse-generator", [0, 0], { mode: "Free Run", sync: "1/8", units: "% of Period", widthpct: 0.1, jitter: 0.18, seed: 4 }, { name: "Clock" });
  const m = melody(p, [1, 0], [0, 7, 3, 5, 0, 10, 7, 3, 0, 7, 12, 10, 7, 5, 3, 5], { rate: "1/8", root: "F", scale: "Dorian", shape: 0.5, osc: { octave: "-1" } });
  p.cable(clk, "gate", m.seq, "clock");
  const tick = p.add("pulse-generator", [0, 1], { mode: "Free Run", sync: "1/16", width: 0.00025, ring: 1, ringfreq: 7500, damping: 0.78, jitter: 0.12, seed: 9, amplitude: 0.6 }, { name: "Hat Ticks" });
  const hp = p.add("filter", [1, 1], { cutoff: 5000, mode: "Notch", resonance: 0.1 }, { name: "Hat Filter" });
  const thump = p.add("pulse-generator", [0, 2], { mode: "Free Run", sync: "1/4", width: 0.0003, ring: 1, ringfreq: 70, damping: 0.4 }, { name: "Thump" });
  p.cable(tick, "ring", hp, "l");
  finish(p, [3, 0], [{ n: m.amp, l: "l", level: 0, pan: -0.2 }, { n: hp, l: "l", level: -4, pan: 0.35 }, { n: thump, l: "ring", level: -6 }], { vmix: 0.2, master: 6 });
  return p;
}

function tinDrums() {
  const p = patch("Pulse Generator: Tin Drums", {
    module: "pulse-generator", tempo: 100,
    description: "A whole kit from triggered pulses: the Ring output of each Pulse Generator is a pitched thump, tick or rattle. The tom fires a Burst of four pulses, a quick roll. Change Ring Freq for the tuning, Damping for how long they ring, Width for the colour.",
    tags: ["drums", "ring", "triggered", "burst"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Hat", "Tom", "", "", "", ""],
    [pattern("Tin", ["X...x...X..x....", "....X.......X..x", "x.x.x.x.x.x.x.xx", "...........x.x.."])]) });
  const kick = p.add("pulse-generator", [1, 0], { mode: "Triggered", period: 0.1, width: 0.004, ring: 1, ringfreq: 62, damping: 0.3 }, { name: "Kick" });
  const snare = p.add("pulse-generator", [1, 1], { mode: "Triggered", burst: 3, period: 0.012, width: 0.0006, ring: 1, ringfreq: 330, damping: 0.45 }, { name: "Snare" });
  const hat = p.add("pulse-generator", [1, 2], { mode: "Triggered", period: 0.1, width: 0.00018, ring: 1, ringfreq: 8200, damping: 0.8, amplitude: 0.6 }, { name: "Hat" });
  const tom = p.add("pulse-generator", [1, 3], { mode: "Triggered", burst: 4, period: 0.045, width: 0.002, ring: 1, ringfreq: 150, damping: 0.35 }, { name: "Tom Roll" });
  p.cable(grid, "gate1", kick, "trigger").cable(grid, "gate2", snare, "trigger").cable(grid, "gate3", hat, "trigger").cable(grid, "gate4", tom, "trigger");
  const hpf = p.add("filter", [2, 2], { cutoff: 6000, mode: "Notch" }, { name: "Hat Filter" });
  p.cable(hat, "ring", hpf, "l");
  finish(p, [3, 0], [{ n: kick, l: "ring", level: -2 }, { n: snare, l: "ring", level: -8, pan: 0.1 }, { n: hpf, l: "l", level: -10, pan: 0.3 }, { n: tom, l: "ring", level: -6, pan: -0.3 }], { vmix: 0.18, size: 0.3, decay: 1.2 });
  return p;
}

function glassChimes() {
  const p = patch("Pulse Generator: Glass Chimes", {
    module: "pulse-generator", tempo: 78,
    description: "One very short pulse per note makes the Ring resonance ping, and the sequencer's pitch tunes Ring Freq (1 V per octave), so each step is a glassy chime. A second, wider pulse a fifth above adds a darker partner. Try Damping for the length of the ring and Width for the brightness.",
    tags: ["chime", "ring", "pitch", "ambient"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, 7, 3, ".", 12, 7, 5, ".", 3, ".", 10, 7, 12, ".", 15, 7]) });
  const ping = p.add("pulse-generator", [1, 0], { mode: "Triggered", period: 0.05, width: 0.0002, ring: 1, ringfreq: 880, damping: 0.22, amplitude: 0.7 }, { name: "Ping" });
  const ping2 = p.add("pulse-generator", [1, 1], { mode: "Triggered", period: 0.05, width: 0.0005, ring: 1, ringfreq: 440, damping: 0.15, amplitude: 0.5 }, { name: "Ping Low" });
  p.cable(seq, "trigger", ping, "trigger").cable(seq, "pitch", ping, "pitch").cable(seq, "trigger", ping2, "trigger").cable(seq, "pitch", ping2, "pitch");
  const lfo = p.add("lfo", [0, 1], { rate: 0.07 }, { name: "Colour" });
  p.cable(lfo, "out", ping, "damping", 0.25);
  finish(p, [2, 0], [{ n: ping, l: "ring", level: 0, pan: -0.3 }, { n: ping2, l: "ring", level: -2, pan: 0.3 }], { vmix: 0.45, size: 0.75, decay: 5, master: 6 });
  return p;
}

function gateEcho() {
  const p = patch("Pulse Generator: Gate Echo", {
    module: "pulse-generator", tempo: 100,
    description: "In External Width mode the Pulse Generator is a gate delay: each note's gate comes out 190 ms later, as long as it went in, and plays a second voice a fifth higher. The result is a hand-made echo of the melody. Change Delay for the spacing, or Rise and Fall to soften the echoed notes.",
    tags: ["delay", "gate", "external width", "echo"],
  });
  const m = melody(p, [0, 0], [0, ".", 3, 7, ".", 5, ".", 10, 12, ".", 7, ".", 3, 5, ".", "."], { rate: "1/8", root: "G", scale: "Minor Pentatonic", shape: 0.4, env: { decay: 0.2, sustain: 0.3, release: 0.15 }, gatelength: 0.4 });
  const dly = p.add("pulse-generator", [0, 1], { mode: "External Width", delay: 0.19, width: 0.1, rise: 0.15, fall: 0.3 }, { name: "Gate Delay" });
  const osc2 = p.add("oscillator", [1, 1], { shape: 0.2, octave: "0" }, { name: "Echo Source" });
  const env2 = p.add("adsr", [1, 2], { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.4 }, { name: "Echo Env" });
  const amp2 = p.add("vca", [2, 1], {}, { name: "Echo VCA" });
  const up = p.add("utility", [0, 2], { scalex: 1, offset: 0.0833 }, { name: "Fifth Up" });
  p.cable(m.seq, "gate", dly, "gate").cable(dly, "gate", env2, "gate").cable(m.seq, "pitch", up, "x").cable(up, "out", osc2, "pitch")
    .cable(osc2, "out", amp2, "l").cable(env2, "env", amp2, "gain");
  finish(p, [3, 0], [{ n: m.amp, l: "l", level: 0, pan: -0.3 }, { n: amp2, l: "l", level: -4, pan: 0.4 }], { vmix: 0.3, decay: 3, master: 6 });
  return p;
}

function pulseChoir() {
  const p = patch("Pulse Generator: Pulse Choir", {
    module: "pulse-generator", tempo: 70,
    description: "At audio rate the Pulse Generator is an oscillator: three of them at 110, 165 and 220 Hz, with slow LFOs on Width for a swaying pulse-width sound and soft Rise and Fall on the edges. Switch Double on for a hollow, comb-like voice, or change the Period to retune a note.",
    tags: ["oscillator", "pwm", "drone", "pad"],
  });
  const periods = [1 / 110, 1 / 165, 1 / 220];
  const rates = [0.05, 0.073, 0.11];
  const nodes = periods.map((per, i) => {
    const g = p.add("pulse-generator", [0, i], { mode: "Free Run", period: per, units: "% of Period", widthpct: 0.3, delaypct: i === 1 ? 0.5 : 0, double: i === 1, rise: 0.4, fall: 0.4, amplitude: 0.7, offset: -0.2 }, { name: `Voice ${i + 1}` });
    const l = p.add("lfo", [1, i], { rate: rates[i], wave: "Triangle", phase: i * 90 }, { name: `Width ${i + 1}` });
    p.cable(l, "out", g, "widthpct", 0.35);
    return g;
  });
  const lp = p.add("filter", [2, 0], { cutoff: 1400, mode: "LP", resonance: 0.15, type: "Ladder Tanh" }, { name: "Warmth" });
  const sum = p.add("audio-mixer", [2, 1], { level1: -6, level2: -6, level3: -8, pan1: -0.5, pan3: 0.5, master: 0 }, { name: "Choir" });
  nodes.forEach((g, i) => p.cable(g, "out", sum, `in${i + 1}l`));
  p.cable(sum, "outl", lp, "l").cable(sum, "outr", lp, "r");
  const sweep = p.add("lfo", [2, 2], { rate: 0.04 }, { name: "Open" });
  p.cable(sweep, "out", lp, "cutoff", 0.25);
  const verb = p.add("reverb", [3, 0], { size: 0.7, decay: 5, mix: 0.35, quality: "Eco (8 lines)" });
  p.stereo(lp, verb).stereo(verb, p.out);
  return p;
}

export default [wobblyClock, tinDrums, glassChimes, gateEcho, pulseChoir];
