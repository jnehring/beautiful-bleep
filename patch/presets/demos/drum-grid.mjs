// SPDX-License-Identifier: MIT
// Drum Grid: five demo patches. Each plays by itself with the transport.
import { patch, drumGrid, pattern } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator -> ADSR -> VCA (optional filter), played by a pitch jack and a gate jack: [node, jack] pairs.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.6, octave: oct(o.octave ?? 0), ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.004, decay: 0.3, sustain: 0, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  if (pitch) p.cable(pitch[0], pitch[1], osc, "pitch", pitch[2] ?? 1);
  p.cable(gate[0], gate[1], env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (o.retrig) p.cable(o.retrig[0], o.retrig[1], env, "retrig");
  if (!o.filter) return { osc, env, amp, out: amp, jack: "l" };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter, jack: "l" };
}
/// Up to eight mono sources into one stereo mix. list: {node, jack, level, pan}.
function bus(p, at, list, master = -3, name = "Mix") {
  const [c, r] = at;
  const mk = (items, col, row, nm, m) => {
    const vals = { master: m };
    items.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -6; vals[`pan${i + 1}`] = x.pan ?? 0; });
    const mx = p.add("audio-mixer", [col, row], vals, { name: nm });
    items.forEach((x, i) => p.cable(x.node, x.jack || "out", mx, `in${i + 1}l`));
    return mx;
  };
  if (list.length <= 4) return mk(list, c, r, name, master);
  const a = mk(list.slice(0, 4), c, r, `${name} A`, 0), b = mk(list.slice(4), c, r + 1, `${name} B`, 0);
  const fin = p.add("audio-mixer", [c + 1, r], { level1: 0, level2: 0, master }, { name });
  p.stereo(a, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(b, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return fin;
}
/// Mono jack to both sides of a stereo input pair.
const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);
/// A reverb after a stereo mixer (outl/outr) and then the patch output.
function finish(p, mixer, at, verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.4, mix: 0.15, ...verb });
  p.stereo(mixer, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

const NAMES = ["Kick", "Clap", "Closed Hat", "Open Hat", "Rim", "Tom", "Tom 2", "Perc"];
const grid = (rows, len = 16) => rows.map((r) => r.padEnd(len, ".").slice(0, len));

function fourOnTheFloor() {
  const p = patch("Drum Grid: Four on the Floor", {
    module: "drum-grid", tempo: 124,
    description: "A house groove from five of the eight tracks: kick on every beat, clap on two and four, hats on the off-beats. Capital X steps are accents and play louder than x steps; click a step in the grid to cycle off, on and accent.",
    tags: ["house", "four on the floor", "accent", "drums"],
  });
  const g = p.add("drum-grid", [0, 0], { velocity: 0.7, gatelength: 0.2 }, { data: drumGrid(NAMES, [pattern("Four", grid([
    "X...X...X...X...", "....x.......x...", "x.x.x.x.x.x.x.x.", "..X...X...X...X.", ".......x........"]))]) });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, decay: 0.5 });
  const clap = p.add("punch-clap", [2, 1], { level: 0.6, decay: 0.3 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.45, closed: 0.04, open: 0.25 });
  const rim = p.add("punch-rim", [2, 3], { level: 0.4, tune: 4 });
  p.cable(g, "gate1", kick, "trig").cable(g, "velocity1", kick, "velocity").cable(g, "gate2", clap, "trig").cable(g, "velocity2", clap, "velocity")
    .cable(g, "gate3", hats, "closed").cable(g, "gate4", hats, "open").cable(g, "velocity3", hats, "velocity").cable(g, "gate5", rim, "trig");
  const m = melody(p, [0, 4], [0, ".", 0, 7, ".", 0, 3, "."], { rate: "1/8", root: "F", octave: -1, shape: 0.3, env: { decay: 0.18, sustain: 0 } });
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: clap, level: -7, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 },
    { node: rim, level: -14, pan: -0.3 }], -3, "Drums");
  const out = bus(p, [5, 2], [{ node: m.amp, jack: "l", level: -9 }], 0, "Bass");
  const fin = p.add("audio-mixer", [6, 0], { level1: 0, level2: 0, master: -2 }, { name: "Final" });
  p.stereo(mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(out, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, fin, [7, 0], { size: 0.3, decay: 1, mix: 0.1 });
  return p;
}

function patternChain() {
  const p = patch("Drum Grid: Pattern Chain", {
    module: "drum-grid", tempo: 98,
    description: "An LFO sweeping once every four bars feeds the Pattern input, so the grid plays a groove twice, then a busier variation, then a fill with toms, and starts over. Set Switch to Immediate to hear it change mid-bar, or take the cable out and pick slots by hand.",
    tags: ["pattern", "chain", "fill", "arrangement"],
  });
  const names = ["Kick", "Snare", "Closed Hat", "Open Hat", "Tom", "Tom 2", "Perc", "Clap"];
  const a = pattern("Groove", grid(["X.......x.X.....", "....X.......X...", "x.x.x.x.x.x.x.x.", "..............x."]));
  const b = pattern("Variation", grid(["X..x....x.X..x..", "....X.......X..x", "xxxxxxxxxxxxxxxx", "......x.......x.", "", "", "", ""]));
  const c = pattern("Fill", grid(["X.......x.......", "....X...x.x.XxXx", "x.x.x.x.........", "", "........x.x.....", ".............x.x"]));
  const g = p.add("drum-grid", [0, 0], { switch: "At End", velocity: 0.75 }, { data: drumGrid(names, [a, b, c]) });
  const lfo = p.add("lfo", [0, 3], { wave: "Saw Up", sync: "Tempo", division: "4 bars", polarity: "Unipolar" }, { name: "Chain" });
  p.cable(lfo, "out", g, "pattern", 0.25);
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6, snappy: 0.7 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.45 });
  const tom = p.add("punch-tom", [2, 3], { level: 0.7, tune: 130 });
  const tom2 = p.add("punch-tom", [2, 4], { level: 0.7, tune: 95 });
  p.cable(g, "gate1", kick, "trig").cable(g, "velocity1", kick, "velocity").cable(g, "gate2", snare, "trig").cable(g, "velocity2", snare, "velocity")
    .cable(g, "gate3", hats, "closed").cable(g, "gate4", hats, "open").cable(g, "velocity3", hats, "velocity")
    .cable(g, "gate5", tom, "trig").cable(g, "gate6", tom2, "trig");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: snare, level: -6, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 },
    { node: tom, level: -8, pan: -0.25 }, { node: tom2, level: -8, pan: 0.35 }], -3, "Kit");
  finish(p, mix, [6, 0], { size: 0.35, decay: 1.1, mix: 0.12 });
  return p;
}

function waltz() {
  const p = patch("Drum Grid: Twelve-Step Waltz", {
    module: "drum-grid", tempo: 110,
    description: "The pattern is only 12 steps long, so the grid wraps after three beats and the groove counts in three, with Swing leaning on the off-steps. Each pattern keeps its own Length: stretch it to 16 in the grid view and the waltz turns into a march.",
    tags: ["waltz", "length", "swing", "three"],
  });
  const g = p.add("drum-grid", [0, 0], { swing: 0.59, velocity: 0.7 }, { data: drumGrid(NAMES, [pattern("Waltz", grid([
    "X...........", "", "x.x.x.x.x.x.", "...........x", "....x...x...", "", "", ""], 12), 12)]) });
  const kick = p.add("ring-kick", [2, 0], { level: 0.8, decay: 0.7, tone: 0.45 });
  const hats = p.add("ring-hats", [2, 2], { level: 0.4, tone: 0.4 });
  const rim = p.add("ring-rim", [2, 4], { level: 0.6, voice: "Clave", tune: -2 });
  p.cable(g, "gate1", kick, "trig").cable(g, "velocity1", kick, "velocity").cable(g, "gate3", hats, "closed").cable(g, "gate4", hats, "open")
    .cable(g, "gate5", rim, "trig").cable(g, "velocity5", rim, "velocity");
  const m = melody(p, [0, 3], [0, 4, 7, 4, 9, 7], { rate: "1/8", root: "G", scale: "Major Pentatonic", octave: 0, shape: 0.35,
    env: { decay: 0.4, sustain: 0.05, release: 0.4 }, gatelength: 0.6 });
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: hats, level: -13, pan: 0.3 }, { node: rim, level: -9, pan: -0.2 },
    { node: m.amp, jack: "l", level: -10, pan: 0.1 }], 2, "Kit");
  finish(p, mix, [6, 0], { size: 0.5, decay: 2.2, mix: 0.25 });
  return p;
}

function accentDynamics() {
  const p = patch("Drum Grid: Accent Pump", {
    module: "drum-grid", tempo: 108,
    description: "The grid's Accent output, high only when an X step plays, fires an envelope that opens a filter on a low drone, so every accented hit pumps the pad while the quiet x steps leave it closed. Change the grid's Velocity knob to scale the soft hits.",
    tags: ["accent", "velocity", "pump", "drone"],
  });
  const g = p.add("drum-grid", [0, 0], { velocity: 0.5, gatelength: 0.3 }, { data: drumGrid(NAMES, [pattern("Accents", grid([
    "X..x..x.X..x.x..", "....x..x....X..x", "x.x.x.x.x.x.x.x."]))]) });
  const kick = p.add("punch-kick", [2, 0], { level: 0.8, decay: 0.45 });
  const clap = p.add("punch-clap", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.45, closed: 0.04 });
  p.cable(g, "gate1", kick, "trig").cable(g, "velocity1", kick, "velocity").cable(g, "gate2", clap, "trig").cable(g, "velocity2", clap, "velocity")
    .cable(g, "gate3", hats, "closed").cable(g, "velocity3", hats, "velocity");
  const drone = p.add("oscillator", [0, 3], { shape: 0.9, octave: "-2", coarse: -5 }, { name: "Drone" });
  const drone2 = p.add("oscillator", [0, 4], { shape: 0.9, octave: "-2", coarse: -4.8 }, { name: "Drone 2" });
  const pump = p.add("adsr", [1, 4], { attack: 0.01, decay: 0.45, sustain: 0.15, release: 0.3, velamount: 0 }, { name: "Pump" });
  const filt = p.add("filter", [2, 3], { cutoff: 140, resonance: 0.3, type: "Ladder Tanh", drive: 0.2 }, { name: "Drone Filter" });
  p.cable(g, "accent", pump, "gate").cable(pump, "env", filt, "cutoff", 0.6).cable(drone, "out", filt, "l").cable(drone2, "out", filt, "r");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: clap, level: -8, pan: 0.1 }, { node: hats, level: -13, pan: 0.3 },
    { node: filt, jack: "l", level: -4, pan: -0.6 }, { node: filt, jack: "r", level: -4, pan: 0.6 }], -9, "Mix");
  finish(p, mix, [6, 0], { size: 0.4, decay: 1.5, mix: 0.15 });
  return p;
}

function eightTracks() {
  const p = patch("Drum Grid: Eight-Track Rolling Percussion", {
    module: "drum-grid", tempo: 96,
    description: "All eight tracks work across two bars of 12/8 (Rate 1/8T, 24 steps): a kick, two toms, a clave, a cowbell, a clap, shaker hats and a distant cymbal. Mute a track in the grid view to hear how the parts interlock.",
    tags: ["percussion", "triplet", "polyrhythm", "all tracks"],
  });
  const n = 24;
  const g = p.add("drum-grid", [0, 0], { rate: "1/8T", velocity: 0.65, gatelength: 0.3 }, {
    data: drumGrid(["Kick", "Tom", "Tom 2", "Clave", "Cowbell", "Clap", "Shaker", "Cymbal"], [pattern("Rolling", [
      "X.....x.....X..x..x.....", "........x.....x...x.....", "..x.....x...x.....x..x..", "x..x..x..x..x..x..x..x..",
      "......x.....x.....x.....", "............x...........", ".x.x.x.x.x.x.x.x.x.x.x.x", "X......................."], n)]) });
  const kick = p.add("ring-kick", [2, 0], { level: 0.8 });
  const tom = p.add("ring-tom", [2, 1], { level: 0.7, tune: 150 });
  const tom2 = p.add("ring-tom", [2, 2], { level: 0.7, tune: 100, bend: 0.4 });
  const clave = p.add("ring-rim", [2, 3], { level: 0.55, voice: "Clave" });
  const bell = p.add("ring-cowbell", [2, 4], { level: 0.45, decay: 0.25, tune: 3 });
  const clap = p.add("ring-clap", [3, 0], { level: 0.5, tone: 1400 });
  const shk = p.add("ring-hats", [3, 1], { level: 0.35, closed: 0.03, tone: 0.6 });
  const cym = p.add("ring-cymbal", [3, 2], { level: 0.3, decay: 3 });
  p.cable(g, "gate1", kick, "trig").cable(g, "gate2", tom, "trig").cable(g, "gate3", tom2, "trig").cable(g, "gate4", clave, "trig")
    .cable(g, "gate5", bell, "trig").cable(g, "gate6", clap, "trig").cable(g, "gate7", shk, "closed").cable(g, "gate8", cym, "trig");
  for (const [i, v] of [[1, kick], [2, tom], [3, tom2], [4, clave], [5, bell], [6, clap]]) p.cable(g, `velocity${i}`, v, "velocity");
  p.cable(g, "velocity7", shk, "velocity");
  const mix = bus(p, [5, 0], [{ node: kick, level: -4 }, { node: tom, level: -8, pan: -0.3 }, { node: tom2, level: -8, pan: 0.3 },
    { node: clave, level: -9, pan: 0.5 }, { node: bell, level: -13, pan: -0.5 }, { node: clap, level: -9, pan: 0.1 },
    { node: shk, level: -15, pan: 0.4 }, { node: cym, level: -16, pan: -0.2 }], 3, "Percussion");
  finish(p, mix, [7, 0], { size: 0.5, decay: 1.8, mix: 0.18 });
  return p;
}

export default [fourOnTheFloor, patternChain, waltz, accentDynamics, eightTracks];
