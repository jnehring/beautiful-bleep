// SPDX-License-Identifier: MIT
// Index: five demo patches. Each plays by itself with the transport. In each one the Index sends a whole-number step to a
// dropdown or a toggle of another module (a cable on a setting sets its value).
import { patch, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

const NOTES = [0, ".", 7, ".", 3, ".", 10, 7, 12, ".", 10, ".", 7, 3, 0, "."];

/// Melody (+ optional drums) → Audio Mixer → reverb → Out. `src` is the mono audio to hear as [node, jack].
function finish(p, at, src, style = "half", level = 0) {
  const mix = p.add("audio-mixer", at, { level1: level, level2: -4, master: -2 });
  p.cable(src[0], src[1], mix, "in1l").cable(src[0], src[1], mix, "in1r");
  if (style) {
    const drums = beat(p, [at[0] - 2, at[1] + 4], { style, level: -8 });
    p.stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  }
  const v = p.add("reverb", [at[0] + 1, at[1]], { size: 0.5, decay: 2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function octaveWalk() {
  const p = patch("Index: Octave Walk", {
    module: "index", tempo: 100,
    description: "With nothing patched into Up, the Index follows the song: every half bar it moves one step in Ping-Pong order over 7 steps, and the step goes to the Oscillator's Octave dropdown, so the melody climbs and falls through seven octaves. Change Order or Rate.",
    tags: ["transport", "ping-pong", "octave", "dropdown"],
  });
  const m = melody(p, [0, 0], NOTES, { rate: "1/8", shape: 0.6, octave: 2, gatelength: 0.4, env: { decay: 0.3, sustain: 0.1 } });
  const idx = p.add("index", [1, 2], { mode: "Count", steps: 7, order: "Ping-Pong", rate: "1/2" }, { name: "Octave" });
  p.cable(idx, "out", m.osc, "octave");
  finish(p, [4, 0], [m.amp, "l"], "half", 2);
  return p;
}

function chorusFlip() {
  const p = patch("Index: Chorus or Flanger", {
    module: "index", tempo: 108,
    description: "A square LFO is one bar low, one bar high. The Index with 2 steps turns that into 0 or 1, and 0 or 1 picks the Chorus or the Flanger mode. Two steps make any gate or square wave an on/off switch for a toggle.",
    tags: ["gate", "toggle", "chorus", "flanger"],
  });
  const m = melody(p, [0, 0], NOTES, { rate: "1/8", shape: 0.8, octave: 1, env: { decay: 0.35, sustain: 0.25 } });
  const lfo = p.add("lfo", [1, 3], { wave: "Square", sync: "Tempo", division: "1/1", polarity: "Unipolar" }, { name: "Bar" });
  const idx = p.add("index", [2, 3], { mode: "CV", steps: 2 }, { name: "Mode" });
  const ch = p.add("chorus", [3, 0], { rate: 0.4, depth: 0.7, mix: 0.6 });
  p.cable(lfo, "out", idx, "in").cable(idx, "out", ch, "mode").cable(m.amp, "l", ch, "l");
  finish(p, [5, 0], [ch, "l"], "four", 6);
  return p;
}

function filterTypes() {
  const p = patch("Index: Sweeping the Filter Types", {
    module: "index", tempo: 96,
    description: "A very slow triangle LFO crosses the 32 bands of the Index, and the step goes to the Filter's Type dropdown, so every few seconds the same riff goes through another kind of filter. Set Steps to the number of choices of whatever you drive.",
    tags: ["lfo", "filter", "cv", "sweep"],
  });
  const m = melody(p, [0, 0], NOTES, { rate: "1/8", shape: 0.9, octave: 1, env: { decay: 0.3, sustain: 0.3 } });
  const lfo = p.add("lfo", [1, 3], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "Slow Sweep" });
  const idx = p.add("index", [2, 3], { mode: "CV", steps: 32 }, { name: "Type" });
  const f = p.add("filter", [3, 0], { cutoff: 1800, resonance: 0.25 });
  p.cable(lfo, "out", idx, "in").cable(idx, "out", f, "type").cable(m.amp, "l", f, "l");
  finish(p, [5, 0], [f, "l"], "half", 2);
  return p;
}

function binaryCounter() {
  const p = patch("Index: Three Switches, Seven Waves", {
    module: "index", tempo: 112,
    description: "Three square LFOs at one, two and four bars act as three switches. The Index in Binary mode adds them up (1, 2, 4), and the sum picks the wave of a vibrato LFO that wobbles the filter. A counter in four lines of patch.",
    tags: ["binary", "gates", "lfo", "counter"],
  });
  const m = melody(p, [0, 0], NOTES, { rate: "1/8", shape: 0.9, octave: 1, env: { decay: 0.3, sustain: 0.3 } });
  const bits = [["1/4", "Bit 1"], ["1/2", "Bit 2"], ["1/1", "Bit 3"]].map(([division, name], i) =>
    p.add("lfo", [1, 3 + i], { wave: "Square", sync: "Tempo", division, polarity: "Unipolar" }, { name }));
  const idx = p.add("index", [2, 3], { mode: "Binary", steps: 7, gates: 3 }, { name: "Wave" });
  const wob = p.add("lfo", [3, 3], { rate: 5, polarity: "Bipolar" }, { name: "Wobble" });
  const f = p.add("filter", [3, 0], { cutoff: 1200, resonance: 0.3 });
  bits.forEach((b, i) => p.cable(b, "out", idx, "gate" + (i + 1)));
  p.cable(idx, "out", wob, "wave").cable(wob, "out", f, "cutoff", 0.35).cable(m.amp, "l", f, "l");
  finish(p, [5, 0], [f, "l"], "broken", -2);
  return p;
}

function drumsPickOctave() {
  const p = patch("Index: Hits Pick the Octave", {
    module: "index", tempo: 104,
    description: "The kick, snare and hat of the drum grid are three gates into the Index in Gates mode: a kick drops the next notes three octaves, a snare two, a hat one, and with none high the Default Step 3 is the octave you wrote. Try another Default Step.",
    tags: ["gates", "drums", "octave", "dropdown"],
  });
  const m = melody(p, [0, 0], NOTES, { rate: "1/8", shape: 0.7, octave: 2, gatelength: 0.4, env: { decay: 0.3, sustain: 0.15 } });
  const grid = p.add("drum-grid", [0, 5], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Tom", "Tom 2", "Perc"],
    [pattern("Beat", ["X..x..x...X..x..", "....X..x....X...", "x.xxx...x.xxx...", ""])]) });
  const kick = p.add("punch-kick", [1, 5], { level: 0.8 });
  const snare = p.add("punch-snare", [1, 6], { level: 0.6 });
  const hats = p.add("punch-hats", [1, 7], { level: 0.5 });
  const dm = p.add("audio-mixer", [2, 5], { level1: -3, level2: -6, level3: -12, master: -8 }, { name: "Drum Mix" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity").cable(grid, "gate2", snare, "trig")
    .cable(grid, "velocity2", snare, "velocity").cable(grid, "gate3", hats, "closed").cable(grid, "velocity3", hats, "velocity")
    .cable(kick, "out", dm, "in1l").cable(snare, "out", dm, "in2l").cable(hats, "out", dm, "in3l");
  const idx = p.add("index", [2, 3], { mode: "Gates", steps: 7, gates: 3, default: 3 }, { name: "Octave" });
  p.cable(grid, "gate1", idx, "gate1").cable(grid, "gate2", idx, "gate2").cable(grid, "gate3", idx, "gate3").cable(idx, "out", m.osc, "octave");
  finish(p, [4, 0], [m.amp, "l"], null, -2);
  p.cable(dm, "outl", p.out, "l").cable(dm, "outr", p.out, "r");
  return p;
}

export default [octaveWalk, chorusFlip, filterTypes, binaryCounter, drumsPickOctave];
