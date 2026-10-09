// SPDX-License-Identifier: MIT
// Cartesian Seq: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// Cartesian grid data: `rows` are arrays of semitones (number), "." (rest) or "_" (tie); 8 × 8, row-major.
/// `mod(row, col)` gives the Mod value (−100…100); `vel(row, col)` the velocity.
function grid(rows, { vel = (r, c) => (c === 0 ? 112 : 88), mod = (r, c) => Math.round(-100 + ((r * 8 + c) * 200) / 63) } = {}) {
  const cells = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const v = rows[r] ? rows[r][c] : undefined;
      const cell = { g: 0, p: 0, v: vel(r, c), m: mod(r, c), a: 1 };
      if (v === "_") cell.g = 2;
      else if (typeof v === "number") Object.assign(cell, { g: 1, p: v });
      cells.push(cell);
    }
  for (let i = 1; i < cells.length; i++) if (cells[i].g === 2) cells[i].p = cells[i - 1].p;
  return { cells, randomize: { density: 0.6, octaves: 1, skip: 0, velocity: [0.6, 1] } };
}

/// Oscillator → ADSR → VCA, played from a pitch and gate source ({node, pitch, gate, trigger?}).
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger) p.cable(src.node, src.trigger, env, "retrig");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);

/// Mono source → optional delay → reverb → Out 1/2.
function space(p, at, from, jack, { delay, verb } = {}) {
  const [c, r] = at;
  let node = from, stereo = false;
  if (delay) {
    node = p.add("zone-delay", [c, r], delay);
    both(p, from, jack, node);
    stereo = true;
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  if (stereo) p.stereo(node, v); else both(p, from, jack, v);
  p.stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

function latticePluck() {
  const p = patch("Cartesian Seq: Lattice Pluck", {
    module: "cartesian-sequencer", tempo: 104,
    description: "A 4 × 3 corner of the grid in F Lydian: X runs every 16th, Y steps down a row at the end of each pass, so a twelve-step figure of bright broken chords turns against the bar. Change Columns, Rows or a cell's pitch and the figure follows.",
    tags: ["pluck", "lydian", "melodic", "grid"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.4, columns: 4, rows: 3, xrate: "1/16", yrate: "Wrap",
    root: "F", scale: "Lydian" }, {
    data: grid([[0, 7, 11, 16], [2, 9, "_", 14], [4, ".", 11, 19]]),
  });
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger" }, { name: "Pluck", osc: { shape: 0.55 },
    env: { decay: 0.3, sustain: 0.1, release: 0.25 }, filter: { cutoff: 3200, resonance: 0.15 } });
  const mod = p.add("lfo", [1, 2], { rate: 0.07 }, { name: "Brightness" });
  p.cable(mod, "out", v.filter, "cutoff", 0.4);
  space(p, [4, 0], v.out, "l", { delay: { zone: 3, time: 0.45, feedback: 0.4, mix: 0.3, tone: -0.2 }, verb: { size: 0.5, decay: 2.2, mix: 0.3 } });
  return p;
}

function bassRaster() {
  const p = patch("Cartesian Seq: Bass Raster", {
    module: "cartesian-sequencer", tempo: 112,
    description: "Eight columns by two rows of E minor bass under a four-on-the-floor beat. The Mod value of every cell opens the filter, so each row has its own brightness: edit the Mod column of a cell to change the accent.",
    tags: ["bass", "groove", "mod", "minor"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.55, columns: 8, rows: 2, xrate: "1/16", yrate: "Wrap",
    root: "E", scale: "Natural Minor", octave: -2 }, {
    data: grid([
      [0, ".", 0, 12, ".", 0, 7, 0],
      [0, 0, ".", 10, 12, ".", 3, 5],
    ], { vel: (r, c) => ([112, 80, 92, 100][c % 4]),
         mod: (r, c) => ([[-20, -100, 0, 60, -100, 20, 80, -40], [0, -60, -100, 100, 80, -100, 40, 70]][r] || [])[c] ?? 0 }),
  });
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger" }, { name: "Bass", osc: { shape: 0.95 },
    env: { decay: 0.18, sustain: 0.35, release: 0.08 }, filter: { cutoff: 380, resonance: 0.45, drive: 0.2 } });
  p.cable(seq, "mod", v.filter, "cutoff", 0.45);
  const drums = beat(p, [1, 3], { style: "four", level: -9 });
  const mix = p.add("audio-mixer", [5, 0], { level1: -4, level2: -3, master: -3 }, { name: "Mix" });
  p.cable(v.out, "l", mix, "in1l").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [6, 0], { size: 0.3, decay: 1.2, mix: 0.12 });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function crosshairDrift() {
  const p = patch("Cartesian Seq: Crosshair Drift", {
    module: "cartesian-sequencer", tempo: 72,
    description: "Cartesian mode: no clocks, two slow LFOs steer the crosshair across a full 8 × 8 grid of minor pentatonic notes, and a note sounds whenever the crosshair enters a new cell. Move X and Y by hand or change the LFO rates to wander faster or slower.",
    tags: ["cartesian mode", "ambient", "drift", "pentatonic"],
  });
  const pent = [0, 3, 5, 7, 10];
  const rows = [];
  for (let r = 0; r < 8; r++) {
    rows.push([]);
    for (let c = 0; c < 8; c++) { const d = (r * 2 + c) % 10; rows[r].push(pent[d % 5] + 12 * Math.floor(d / 5)); }
  }
  const seq = p.add("cartesian-sequencer", [0, 1], { mode: "Cartesian", sample: "Change", gatelength: 0.9, columns: 8, rows: 8,
    x: 0.5, y: 0.5, root: "D", scale: "Minor Pentatonic" }, { data: grid(rows, { vel: () => 90 }) });
  const lx = p.add("lfo", [0, 0], { rate: 0.045, wave: "Sine" }, { name: "X Drift" });
  const ly = p.add("lfo", [0, 2], { rate: 0.067, wave: "Triangle" }, { name: "Y Drift" });
  p.cable(lx, "out", seq, "x", 0.55).cable(ly, "out", seq, "y", 0.55);
  const v = voice(p, [1, 0], { node: seq }, { name: "Glass", osc: { shape: 0.2 },
    env: { attack: 0.35, decay: 1.2, sustain: 0.35, release: 3 }, filter: { cutoff: 2400, resonance: 0.1, type: "1-Pole Low-pass" } });
  space(p, [4, 0], v.out, "l", { delay: { zone: 4, time: 0.6, feedback: 0.55, character: 0.4, wobble: 0.3, mix: 0.4 }, verb: { size: 0.8, decay: 7, mix: 0.45 } });
  return p;
}

function twoClocks() {
  const p = patch("Cartesian Seq: Two Clocks", {
    module: "cartesian-sequencer", tempo: 100,
    description: "X moves back and forth across five columns on the 8ths while Y steps a row every dotted quarter: the marimba line takes ages to repeat and never lines up with the beat. Row End ticks a hat and Grid End thumps a kick; try other Y Rate values.",
    tags: ["polyrhythm", "marimba", "independent clocks", "row end"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.35, columns: 5, rows: 3, xrate: "1/8", yrate: "1/4.",
    xdirection: "Ping-Pong", root: "A", scale: "Dorian" }, {
    data: grid([[0, 2, 4, 7, 9], [7, 12, 9, 4, 2], [12, 9, 7, 14, 4]]),
  });
  const mallet = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.55, geometry: 0.3, brightness: 0.6, damping: 0.45,
    position: 0.3, size: 0.35, space: 0.25 }, { name: "Marimba" });
  p.cable(seq, "pitch", mallet, "pitch").cable(seq, "trigger", mallet, "strike").cable(seq, "velocity", mallet, "velocity");
  const hat = p.add("punch-hats", [1, 1], { level: 0.45, closed: 0.04 });
  const kick = p.add("punch-kick", [1, 2], { level: 0.75, decay: 0.5 });
  p.cable(seq, "rowend", hat, "closed").cable(seq, "gridend", kick, "trig");
  const mix = p.add("audio-mixer", [3, 0], { level1: -5, level2: -14, pan2: 0.3, level3: -9, send1: -14, return: -4, master: -2 }, { name: "Mix" });
  p.stereo(mallet, mix, { to: ["in1l", "in1r"] }).cable(hat, "out", mix, "in2l").cable(kick, "out", mix, "in3l");
  const verb = p.add("reverb", [4, 1], { size: 0.45, decay: 1.8, mix: 1 });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function randomWalkArp() {
  const p = patch("Cartesian Seq: Random Walk Arp", {
    module: "cartesian-sequencer", tempo: 120,
    description: "Both playheads move at random, so the Hirajoshi arpeggio hops around the grid in a fixed but never-obvious order (the Seed decides it). Mod swings the filter and a slow LFO lifts the whole cutoff; change Seed or the directions to deal a new tune.",
    tags: ["random", "arpeggio", "hirajoshi", "lead"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.4, columns: 6, rows: 4, xrate: "1/16", yrate: "1/16",
    xdirection: "Random", ydirection: "Random", seed: 7, root: "D", scale: "Hirajoshi" }, {
    data: grid([
      [0, 3, 7, 12, 15, 19], [2, 5, 8, 14, 17, 12], [0, 7, 3, 10, 12, 15], [5, 8, 12, 7, 17, 20],
    ].map((r) => r.map((n) => n)), { vel: (r, c) => 70 + ((r * 5 + c * 7) % 5) * 10 }),
  });
  const v = voice(p, [1, 0], { node: seq, trigger: "trigger" }, { name: "Lead", osc: { shape: 0.85 },
    env: { decay: 0.2, sustain: 0.15, release: 0.15 }, filter: { cutoff: 1500, resonance: 0.35 } });
  const sweep = p.add("lfo", [1, 2], { rate: 0.09, polarity: "Unipolar" }, { name: "Cutoff Sweep" });
  p.cable(seq, "mod", v.filter, "cutoff", 0.35).cable(sweep, "out", v.filter, "cutoff", 0.3);
  space(p, [4, 0], v.out, "l", { delay: { zone: 3, time: 0.55, feedback: 0.45, mix: 0.35, tone: -0.2 }, verb: { size: 0.5, decay: 2.5, mix: 0.25 } });
  return p;
}

export default [latticePluck, bassRaster, crosshairDrift, twoClocks, randomWalkArp];
