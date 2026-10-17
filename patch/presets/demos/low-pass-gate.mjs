// SPDX-License-Identifier: MIT
// Low Pass Gate (low-pass-gate): five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// src (stereo jacks) → trim mixer → reverb → Out.
function finish(p, at, src, trim = 0, verb = {}, jacks = ["l", "r"]) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}
/// Mono jack of a node into both inputs of a stereo module.
function mono(p, from, jack, to, l = "l", r = "r") { p.cable(from, jack, to, l).cable(from, jack, to, r); }
/// Two stereo sources blended into Out.
function blend(p, at, a, b, la = -3, lb = -6, aj = ["l", "r"], bj = ["outl", "outr"]) {
  const mix = p.add("audio-mixer", at, { level1: la, level2: lb, master: -1 });
  p.stereo(a, mix, { from: aj, to: ["in1l", "in1r"] }).stereo(b, mix, { from: bj, to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function pluckRun() {
  const p = patch("Low Pass Gate: Wooden Pluck", {
    module: "low-pass-gate", tempo: 100,
    description: "A bright saw is silent until each sequencer trigger pings the gate: it snaps open and then darkens as it closes, like a plucked string. Raise Response for longer notes, Ping for harder hits, or switch Cell to Fast.",
    tags: ["pluck", "ping", "vactrol", "melody", "classic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 0.4 },
    { data: steps([0, 4, 7, 12, 9, 7, 4, 2, 0, 4, 9, 7, 12, 9, 7, 4], [110, 80, 90, 100, 85, 70, 90, 80, 110, 80, 95, 85, 105, 90, 75, 85]) });
  const osc = p.add("oscillator", [1, 0], { shape: 1 });
  const g = p.add("low-pass-gate", [2, 0], { level: 0, response: 0.45, ping: 0.85, resonance: 0.2, brightness: 0.8, cell: "Classic", mode: "Both" });
  p.cable(seq, "pitch", osc, "pitch").cable(osc, "out", g, "l").cable(osc, "out", g, "r").cable(seq, "trigger", g, "ping").cable(seq, "velocity", g, "velocity");
  finish(p, [3, 0], g, 5, { size: 0.6, decay: 3, mix: 0.3 });
  return p;
}

function bongos() {
  const p = patch("Low Pass Gate: Skin Drums", {
    module: "low-pass-gate", tempo: 108,
    description: "Low, sine-like tones pinged by the drum grid through the Fast cell sound like tuned skin drums, with a short, sharp attack and a quick roll-off. Try Resonance for a ringing pitch, or change Response to tighten or loosen the hits.",
    tags: ["percussion", "fast", "drums", "ping", "tom"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Tom", "Tom 2", "Perc"], [pattern("Skins", [
    "X..x..x.x..x..x.", "..x.....x...x...", "", "", "", "", "", ""])]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0, octave: "-1", coarse: 0 }, { name: "Low Skin" });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.2, coarse: 5, octave: "0" }, { name: "High Skin" });
  const g1 = p.add("low-pass-gate", [2, 0], { level: 0, response: 0.3, ping: 0.9, resonance: 0.5, brightness: 0.7, cell: "Fast" }, { name: "LPG Low" });
  const g2 = p.add("low-pass-gate", [2, 1], { level: 0, response: 0.25, ping: 0.9, resonance: 0.4, brightness: 0.8, cell: "Fast" }, { name: "LPG High" });
  p.cable(o1, "out", g1, "l").cable(o1, "out", g1, "r").cable(grid, "gate1", g1, "ping").cable(grid, "velocity1", g1, "velocity")
    .cable(o2, "out", g2, "l").cable(o2, "out", g2, "r").cable(grid, "gate2", g2, "ping").cable(grid, "velocity2", g2, "velocity");
  const mix = p.add("audio-mixer", [3, 0], { level1: -1, level2: -3, pan1: -0.3, pan2: 0.4, master: 0 });
  p.stereo(g1, mix, { to: ["in1l", "in1r"] }).stereo(g2, mix, { to: ["in2l", "in2r"] });
  finish(p, [4, 0], mix, 2, { size: 0.45, decay: 1.8, mix: 0.2 }, ["outl", "outr"]);
  return p;
}

function slowPad() {
  const p = patch("Low Pass Gate: Slow Breath", {
    module: "low-pass-gate", tempo: 72,
    description: "With the Slow memory cell and a slow LFO on the CV input, the gate opens and closes like breathing over a held two-voice chord, getting brighter as it swells. Change the LFO rate or the Response to alter the pace.",
    tags: ["slow memory", "pad", "cv", "lfo", "ambient"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], {
    rate: "1/4", root: "F", scale: "Lydian", octave: -1, shape: 1, gatelength: 1, env: { attack: 0.01, decay: 0.2, sustain: 1, release: 0.3 } });
  const o2 = p.add("oscillator", [1, 2], { shape: 0.8, coarse: 7, fine: 8 }, { name: "Fifth" });
  const mx = p.add("audio-mixer", [2, 2], { level1: -2, level2: -6, master: 0 }, { name: "Blend" });
  p.cable(m.seq, "pitch", o2, "pitch").cable(m.amp, "l", mx, "in1l").cable(o2, "out", mx, "in2l");
  const lfo = p.add("lfo", [3, 2], { sync: "2 bars", wave: "Sine", polarity: "Unipolar" }, { name: "Breath" });
  const g = p.add("low-pass-gate", [3, 0], { level: 0.05, response: 0.6, brightness: 0.7, resonance: 0.15, cell: "Slow memory", mode: "Both" });
  p.cable(mx, "outl", g, "l").cable(mx, "outl", g, "r").cable(lfo, "out", g, "cv", 0.9);
  finish(p, [4, 0], g, -8, { size: 0.75, decay: 4.5, mix: 0.3 });
  return p;
}

function lpOnly() {
  const p = patch("Low Pass Gate: Filter Mode Bass", {
    module: "low-pass-gate", tempo: 112,
    description: "Mode is set to LP, so the gate only acts as a filter on a steady buzzing bass: every ping opens the cutoff and it dulls again, while a Level of about a quarter keeps the note audible between hits. Switch Mode to VCA to hear only the volume change.",
    tags: ["mode", "lp", "bass", "filter", "level"],
  });
  const m = melody(p, [0, 0], [0, 0, ".", 7, 0, ".", 5, ".", 0, 0, ".", 3, 10, ".", 7, 5], {
    rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -2, shape: 1, gatelength: 0.9, env: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.05 } });
  const g = p.add("low-pass-gate", [3, 0], { level: 0.2, response: 0.4, ping: 0.9, resonance: 0.35, brightness: 0.7, drive: 0.2, cell: "Classic", mode: "LP" });
  mono(p, m.amp, "l", g);
  p.cable(m.seq, "trigger", g, "ping");
  const d = beat(p, [0, 4], { style: "half", level: -8 });
  blend(p, [4, 0], g, d, -14, -6);
  return p;
}

function bleedPercLoop() {
  const p = patch("Low Pass Gate: Leaky Marimba", {
    module: "low-pass-gate", tempo: 92,
    description: "A softly pinged triangle wave with some Bleed lets a little signal through even when the gate is shut, so each note sits on a quiet bed of sound. Raise Bleed to blur the gaps, or lower Brightness for a more muffled wooden tone.",
    tags: ["bleed", "mallet", "brightness", "ping", "melody"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Major Pentatonic", octave: 0, gatelength: 0.3 },
    { data: steps([0, ".", 7, 4, ".", 9, 7, ".", 12, ".", 9, 7, 4, ".", 2, "."], [100, 0, 80, 90, 0, 85, 70, 0, 110, 0, 85, 75, 95, 0, 80, 0].map((v) => (v || 90) + 25)) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.5 });
  const g = p.add("low-pass-gate", [2, 0], { level: 0, response: 0.6, ping: 1, resonance: 0.3, brightness: 0.8, bleed: 0.2, cell: "Fast", mode: "Both" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.1 }, { name: "Tone" });
  p.cable(seq, "pitch", osc, "pitch").cable(osc, "out", g, "l").cable(osc, "out", g, "r").cable(seq, "trigger", g, "ping").cable(seq, "velocity", g, "velocity")
    .cable(lfo, "out", g, "response", 0.15);
  finish(p, [3, 0], g, 3, { size: 0.55, decay: 2.5, mix: 0.25 });
  return p;
}

export default [pluckRun, bongos, slowPad, lpOnly, bleedPercLoop];
