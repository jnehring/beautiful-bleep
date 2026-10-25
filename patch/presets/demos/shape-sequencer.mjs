// SPDX-License-Identifier: MIT
// Shape Sequencer: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Slot node data: defs[i] = [type, start, end, curve]; type "ramp" | "curve" | "tri" | "plat" | "pulse" | "empty".
function slotData(defs) {
  return { slots: defs.map(([t, a, b, c]) => ({ t, a: a ?? 0, b: b ?? a ?? 0, c: c ?? 0 })) };
}
const up = (a = 0, b = 1, c = 0) => ["ramp", a, b, c];
const down = (a = 1, b = 0, c = 0) => ["ramp", a, b, c];
const plat = (a) => ["plat", a, a, 0];
const curve = (a = 0, b = 1, c = 0.4) => ["curve", a, b, c];
const tri = (a = 0, b = 1, c = 0) => ["tri", a, b, c];
const pulse = (a = 1, b = 0) => ["pulse", a, b, 0];

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2, damping: 0.5, mix: 0.2, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function pump() {
  const p = patch("Shape Sequencer: Sidechain Pump", {
    module: "shape-sequencer", tempo: 118,
    description: "Four saw-up shapes, one per beat, are the gain of a held pad: each beat the sound ducks and swells back, like a sidechained compressor you can draw. Select a slot and drag its bend dot to change how quickly the pad recovers, or its start square to change how deep the duck goes.",
    tags: ["sidechain", "pump", "volume", "four on the floor"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"],
    { rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: -1, gatelength: 1, shape: 0.7, env: { attack: 0.05, decay: 0.2, sustain: 1, release: 0.4 } });
  const ss = p.add("shape-sequencer", [1, 2], { length: "1 bar", grid: "1/4", sync: "Transport", depth: 1 },
    { data: slotData([up(0.05, 1, -0.4), up(0.05, 1, -0.4), up(0.05, 1, -0.4), up(0.05, 1, -0.4)]) });
  const vca = p.add("vca", [4, 0], {});
  p.cable(m.amp, "l", vca, "l").cable(ss, "out", vca, "gain");
  const drums = beat(p, [0, 4], { style: "four", level: -8 });
  const out = p.add("audio-mixer", [5, 0], { level1: -2, level2: 0, master: 0 }, { name: "Mix" });
  p.cable(vca, "l", out, "in1l").cable(vca, "l", out, "in1r")
    .cable(drums, "outl", out, "in2l").cable(drums, "outl", out, "in2r");
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 1.8, mix: 0.15, quality: "Eco (8 lines)" });
  p.stereo(out, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function steps() {
  const p = patch("Shape Sequencer: Filter Steps", {
    module: "shape-sequencer", tempo: 104,
    description: "A bar cut into eight slots mixes saws, plateaus, a pulse and a triangle, and moves a filter over an arpeggio so every eighth note opens differently. Switch the Grid to 1/16 for sixteen smaller slots, or drag the yellow squares to change how high each slot lifts the cutoff.",
    tags: ["filter", "rhythm", "arpeggio", "shapes"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10], { rate: "1/8", shape: 0.95, root: "E", scale: "Natural Minor", gatelength: 0.9,
    env: { attack: 0.003, decay: 0.3, sustain: 0.8, release: 0.1 } });
  const ss = p.add("shape-sequencer", [1, 2], { length: "1 bar", grid: "1/8", sync: "Transport" },
    { data: slotData([up(0, 1, 0.3), down(1, 0.1), plat(0.7), pulse(1, 0.15), up(0.1, 0.9), tri(0.1, 1), plat(0.35), down(0.9, 0, 0.4)]) });
  const f = p.add("filter", [3, 0], { cutoff: 300, resonance: 0.35, type: "Ladder Tanh" });
  p.cable(m.amp, "l", f, "l").cable(ss, "out", f, "cutoff", 0.65);
  finish(p, [4, 0], f, "l", -10);
  return p;
}

function pan() {
  const p = patch("Shape Sequencer: Auto-Pan", {
    module: "shape-sequencer", tempo: 92,
    description: "Set to Bipolar, two bars of triangles and plateaus swing a bell-like melody left and right: the shape's centre is the middle of the stereo field. Change the Length to 4 bars for a slower drift, or raise Slew to round the corners.",
    tags: ["pan", "bipolar", "stereo", "movement"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 12, 11, 7, 4], { rate: "1/8", shape: 0.2, root: "D", scale: "Major Pentatonic", octave: 0, gatelength: 0.5,
    env: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.4 } });
  const ss = p.add("shape-sequencer", [1, 2], { length: "2 bars", grid: "1/2", polarity: "Bipolar", slew: 0.25, depth: 0.9 },
    { data: slotData([tri(0.5, 1), tri(0.5, 0), plat(0.5), up(0.5, 1, 0.2), down(0.5, 0), tri(0.5, 1), pulse(1, 0), plat(0.5)]) });
  const mix = p.add("audio-mixer", [3, 0], { level1: 2, pan1: 0, master: 0 });
  p.cable(m.amp, "l", mix, "in1l").cable(m.amp, "l", mix, "in1r").cable(ss, "out", mix, "pan1", 0.5);
  const v = p.add("reverb", [4, 0], { size: 0.6, decay: 3, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function swell() {
  const p = patch("Shape Sequencer: One-Shot Swell", {
    module: "shape-sequencer", tempo: 90,
    description: "A note every four bars triggers a four-bar shape, played once: a slow curve up, a peak and a long fall, which opens a filter and lifts a drone's volume together. Try Playback on Loop to hear it repeat on its own, or change Length to shorten the swell.",
    tags: ["trigger", "once", "swell", "one-shot"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", "."], { rate: "1/1", root: "A", scale: "Natural Minor", octave: -1, gatelength: 0.5, shape: 0.6,
    env: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.1 } });
  const ss = p.add("shape-sequencer", [1, 2], { length: "4 bars", grid: "1/1", sync: "Trigger", playback: "Once" },
    { data: slotData([curve(0.05, 0.7, 0.4), curve(0.7, 1, 0.2), down(1, 0.3, 0.3), down(0.3, 0, 0.4)]) });
  const f = p.add("filter", [3, 0], { cutoff: 250, resonance: 0.12, type: "SVF Multimode" });
  const vca = p.add("vca", [4, 0], {});
  p.cable(m.seq, "gate", ss, "trig").cable(m.osc, "out", f, "l").cable(ss, "out", f, "cutoff", 0.6).cable(f, "l", vca, "l").cable(ss, "out", vca, "gain");
  finish(p, [5, 0], vca, "l", -5, { decay: 4, mix: 0.3 });
  return p;
}

function triggers() {
  const p = patch("Shape Sequencer: Slots as Triggers", {
    module: "shape-sequencer", tempo: 124,
    description: "The Slot output pulses at the start of every slot and Cycle once per loop, so the grid itself plays drums: Slot is the kick, Cycle the snare, while the shape swells the hats. Change Grid to 1/8 to double the kick pattern.",
    tags: ["slot output", "cycle output", "drums", "clock"],
  });
  const ss = p.add("shape-sequencer", [0, 0], { length: "1 bar", grid: "1/4", sync: "Transport" },
    { data: slotData([up(0.1, 1), tri(0.1, 0.8), up(0.1, 1, 0.3), tri(0.1, 1)]) });
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.55 });
  const hats = p.add("punch-hats", [1, 2], { level: 0.35 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -3, level2: -6, level3: -12, pan3: 0.2, master: -5 });
  p.cable(ss, "slot", kick, "trig").cable(ss, "cycle", snare, "trig").cable(ss, "out", hats, "closed")
    .cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hats, "out", mix, "in3l")
    .cable(kick, "out", mix, "in1r").cable(snare, "out", mix, "in2r").cable(hats, "out", mix, "in3r");
  const m = melody(p, [0, 4], [0, 3, 7, 10, 7, 3, 5, 2], { rate: "1/8", shape: 0.5, root: "G", scale: "Dorian", gatelength: 0.4,
    env: { decay: 0.2, sustain: 0, release: 0.15 } });
  p.cable(m.amp, "l", mix, "in4l").cable(m.amp, "l", mix, "in4r");
  const v = p.add("reverb", [3, 0], { size: 0.4, decay: 1.6, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [pump, steps, pan, swell, triggers];
