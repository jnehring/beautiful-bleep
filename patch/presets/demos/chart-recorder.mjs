// SPDX-License-Identifier: MIT
// Chart Recorder: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// A mixer to Out 1/2: channels are [node, jack, dB, pan] (mono sources).
function toOut(p, at, chans, master = 0) {
  const v = { master };
  chans.forEach(([, , db, pan], i) => { v["level" + (i + 1)] = db; v["pan" + (i + 1)] = pan ?? 0; });
  const g = p.add("audio-mixer", at, v, { name: "Out Mix" });
  chans.forEach(([n, j], i) => p.cable(n, j, g, "in" + (i + 1) + "l"));
  p.stereo(g, p.out, { from: ["outl", "outr"] });
  return g;
}

// Melody into a filter whose cutoff a control cable moves; returns the filter.
function filtered(p, at, notes, mopts, fopts) {
  const m = melody(p, at, notes, mopts);
  const flt = p.add("filter", [at[0] + 3, at[1]], { resonance: 0.4, ...fopts });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r");
  return { m, flt };
}

function backwardsFilter() {
  const p = patch("Chart Recorder: Backwards Filter", {
    module: "chart-recorder", tempo: 100,
    description: "A random wander is drawn onto four bars of paper, and the strip is read backwards to sweep a filter over a bass line, so the sweeps are a reversed memory of the pen's line. Set Replay Speed to 1 for the forward path, or draw on the paper yourself.",
    tags: ["reverse", "replay", "random", "filter"],
  });
  const r = p.add("random", [0, 3], { sync: "1/4", spread: 0.8, smooth: 0.6, seed: 4 }, { name: "Wander" });
  const c = p.add("chart-recorder", [3, 3], { record: "Always", paper: "Transport", lengthbars: "4 bars", replayspeed: -1, interp: "Smooth", detector: "DC", response: 0.1 });
  const { m, flt } = filtered(p, [0, 0], [0, 0, 7, 0, 3, 0, 5, 7], { rate: "1/8", shape: 1, root: "A", octave: -1, scale: "Natural Minor",
    env: { decay: 0.3, sustain: 0.5, release: 0.15 }, gatelength: 0.8 }, { cutoff: 700, resonance: 0.5 });
  p.cable(r, "out", c, "in").cable(c, "replay", flt, "cutoff", 0.6);
  toOut(p, [5, 0], [[flt, "l", -14, -0.2], [flt, "r", -14, 0.2]]);
  return p;
}

function halfSpeedMemory() {
  const p = patch("Chart Recorder: Half-Speed Memory", {
    module: "chart-recorder", tempo: 90,
    description: "Pen and replay run on free paper: the line a random source draws is read back at half speed, so a second voice bends its pitch along a slower, stretched copy of what the first one is doing. Try Replay Speed 2 or Paper Speed to change how the two relate.",
    tags: ["half speed", "free paper", "pitch", "echo of motion"],
  });
  const r = p.add("random", [0, 3], { sync: "1/4", spread: 0.5, quantize: true, smooth: 0.4, seed: 17 }, { name: "Source" });
  const c = p.add("chart-recorder", [1, 3], { record: "Always", paper: "Free", lengthfree: "5 s", replaysync: "Free", replayspeed: 0.5, interp: "Smooth", detector: "DC" });
  const osc = p.add("oscillator", [2, 3], { shape: 0.5, octave: "0" }, { name: "Stretched Voice" });
  const osc2 = p.add("oscillator", [2, 4], { shape: 0.5, octave: "-1" }, { name: "Live Voice" });
  const flt = p.add("filter", [3, 3], { cutoff: 1800, resonance: 0.25 });
  const flt2 = p.add("filter", [3, 4], { cutoff: 900, resonance: 0.25 });
  p.cable(r, "out", c, "in").cable(c, "replay", osc, "pitch", 0.3).cable(r, "out", osc2, "pitch", 0.3)
    .cable(osc, "out", flt, "l").cable(osc2, "out", flt2, "l");
  toOut(p, [5, 3], [[flt, "l", -16, -0.4], [flt2, "l", -16, 0.4]]);
  return p;
}

function heavyPen() {
  const p = patch("Chart Recorder: Heavy Pen", {
    module: "chart-recorder", tempo: 96,
    description: "A square wave goes in, but the sprung pen overshoots and wobbles round every edge, and that ringing line opens and closes a filter on a bass line. Raise Damping to calm the pen, or Friction to make it stick in steps.",
    tags: ["pen", "overshoot", "damping", "wobble"],
  });
  const l = p.add("lfo", [0, 3], { wave: "Square", sync: "Tempo", division: "1/2", polarity: "Unipolar" }, { name: "Edges" });
  const c = p.add("chart-recorder", [1, 3], { record: "Always", writingspeed: 30, damping: 0.1, friction: 0.1, response: 0.05, detector: "DC" });
  const { flt } = filtered(p, [0, 0], [0, ".", 0, 7, ".", 3, 5, "."], { rate: "1/8", shape: 1, root: "D", octave: -1, scale: "Dorian",
    env: { decay: 0.3, sustain: 0.6, release: 0.15 }, gatelength: 0.8 }, { cutoff: 500, resonance: 0.55 });
  p.cable(l, "out", c, "in").cable(c, "pen", flt, "cutoff", 0.5);
  toOut(p, [5, 0], [[flt, "l", -12, -0.2], [flt, "r", -12, 0.2]]);
  return p;
}

function levelRecorder() {
  const p = patch("Chart Recorder: Level Recorder", {
    module: "chart-recorder", tempo: 106,
    description: "The pen records the loudness of a drum loop, as a level recorder would, and the strip replays at double speed to open a filter on a pad twice as often as the drums hit. Change Detector to Peak or Log dB, or put the Replay Speed back to 1.",
    tags: ["level", "loudness", "double speed", "drums"],
  });
  const mix = beat(p, [0, 3], { style: "broken", level: -6 });
  const c = p.add("chart-recorder", [3, 3], { record: "Always", detector: "RMS", response: 0.08, gain: 6, replayspeed: 2, interp: "Linear", lengthbars: "2 bars" });
  const { flt } = filtered(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", shape: 1, root: "F", scale: "Major Pentatonic",
    env: { attack: 0.05, decay: 0.4, sustain: 0.9, release: 0.4 }, gatelength: 1 }, { cutoff: 300, resonance: 0.3 });
  p.cable(mix, "outl", c, "in").cable(c, "replay", flt, "cutoff", 0.8);
  toOut(p, [5, 0], [[mix, "outl", -6, 0], [flt, "l", -20, -0.2], [flt, "r", -20, 0.2]]);
  return p;
}

function markedHits() {
  const p = patch("Chart Recorder: Marked Hits", {
    module: "chart-recorder", tempo: 104,
    description: "Every half bar the LFO puts a mark on the paper, and the replay head, shifted by Offset, fires a snare each time it passes a mark: a rhythm that runs slightly out of step with the beat. Change Offset to slide the hits, or Replay Speed for another pattern.",
    tags: ["marks", "triggers", "offset", "rhythm"],
  });
  const mix = beat(p, [0, 0], { style: "sparse", level: -6 });
  const l = p.add("lfo", [0, 3], { wave: "Square", sync: "Tempo", division: "1/2", polarity: "Unipolar" }, { name: "Marker Clock" });
  const tri = p.add("lfo", [0, 4], { wave: "Triangle", sync: "Tempo", division: "1/1" }, { name: "Drawing" });
  const c = p.add("chart-recorder", [1, 3], { record: "Always", paper: "Transport", lengthbars: "2 bars", replayspeed: 1.5, offset: 0.2, interp: "Linear" });
  const sn = p.add("punch-snare", [2, 3], { level: 0.55 });
  p.cable(tri, "out", c, "in").cable(l, "out", c, "mark").cable(c, "marker", sn, "trig");
  toOut(p, [5, 0], [[mix, "outl", 4, 0], [sn, "out", 0, 0.3]]);
  return p;
}

export default [backwardsFilter, halfSpeedMemory, heavyPen, levelRecorder, markedHits];
