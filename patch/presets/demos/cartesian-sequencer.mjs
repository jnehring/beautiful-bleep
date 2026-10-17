// Cartesian Seq: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A Step Sequencer: `notes` as in steps(); `knobs` are its settings; `vel` the velocities.
function sq(p, at, notes, knobs = {}, vel) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: "1/8", gatelength: 0.45, ...knobs }, { data: steps(notes, vel) });
}

/// Oscillator → ADSR → VCA from a pitch and gate source ({node, pitch, gate, trigger, velocity}), optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger !== false) p.cable(src.node, src.trigger || "trigger", env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Mono source → optional delay → reverb → Out 1/2. Returns the reverb.
function space(p, at, from, jack, { level = 3, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: true }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    node = p.add("zone-delay", [c, r], delay);
    p.stereo(m, node, { from: out });
    out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

/// Mono voice + drums → mixer → short reverb → Out 1/2.
function withBeat(p, at, from, jack, style, { lead = -2, drums = -4, level = -9, verb = {} } = {}) {
  const [c, r] = at;
  const d = beat(p, [c, r + 1], { style, level });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: lead, level2: drums, master: -2 }, { name: "Mix" });
  p.cable(from, jack, mix, "in1l").cable(from, jack, mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [c + 2, r], { size: 0.3, decay: 1.2, mix: 0.12, ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

/// Cartesian grid data: `rows` are arrays of semitones (number), "." (rest) or "_" (tie); 8 × 8, row-major.
/// `mod(row, col)` gives the Mod value (-100…100); `vel(row, col)` the velocity.
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

function twoRowRiff() {
  const p = patch("Cartesian Seq: Two-Row Riff", {
    module: "cartesian-sequencer", tempo: 110,
    description: "A grid of eight columns and two rows: the X playhead runs along a row every sixteenth and Y drops to the second row when it reaches the end, so a sixteen-note riff in G Dorian comes out in order. Change Rows to 1 for a short loop, or edit a cell's pitch in the view.",
    tags: ["riff", "rows", "clocks", "dorian"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.45, columns: 8, rows: 2, xrate: "1/16", yrate: "Wrap", root: "G", scale: "Dorian" }, {
    data: grid([[0, ".", 7, 5, 3, ".", 7, 10], [12, 10, ".", 7, 5, 3, 0, "."]]),
  });
  const v = voice(p, [1, 0], { node: seq }, { osc: { shape: 0.8 }, env: { decay: 0.2, sustain: 0.25, release: 0.15 }, filter: { cutoff: 2400, resonance: 0.25 } });
  withBeat(p, [3, 0], v.out, "l", "broken", { lead: 6 });
  return p;
}

function pingPongMarimba() {
  const p = patch("Cartesian Seq: Ping-Pong Marimba", {
    module: "cartesian-sequencer", tempo: 100,
    description: "Both playheads bounce back and forth over a 6 × 4 patch of the grid, X on the eighths and Y once a bar, so a marimba line keeps reversing and the long path takes ages to repeat. Set the directions to Forward for a plain scan, or Random to lose the pattern.",
    tags: ["ping-pong", "marimba", "directions", "polyrhythm"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.4, columns: 6, rows: 4, xrate: "1/8", yrate: "1/2", xdirection: "Ping-Pong", ydirection: "Ping-Pong", root: "C", scale: "Major Pentatonic" }, {
    data: grid([[0, 2, 4, 7, 9, 12], [4, 7, 9, 12, 14, 16], [2, 4, 7, 9, 7, 4], [9, 7, 4, 2, 0, -3]]),
  });
  const mal = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.55, geometry: 0.3, brightness: 0.6, damping: 0.5, position: 0.3, size: 0.35, space: 0.2 }, { name: "Marimba" });
  p.cable(seq, "pitch", mal, "pitch").cable(seq, "trigger", mal, "strike").cable(seq, "velocity", mal, "velocity");
  const lvl = p.add("audio-mixer", [2, 0], { level1: -6, master: 0 }, { name: "Level" });
  const verb = p.add("reverb", [3, 0], { size: 0.5, decay: 2.2, mix: 0.3 });
  p.stereo(mal, lvl, { to: ["in1l", "in1r"] }).stereo(lvl, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function modBass() {
  const p = patch("Cartesian Seq: Mod Bass", {
    module: "cartesian-sequencer", tempo: 120,
    description: "Every cell also stores a Mod value, and here the Mod output opens the filter of an acid bass, so each step has its own brightness: notes with a high Mod bite, low ones stay dark. Edit the Mod of a cell or turn Mod Slew up to smear the changes.",
    tags: ["mod output", "acid", "filter", "bass"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.55, columns: 8, rows: 1, xrate: "1/16", yrate: "Wrap", root: "F", scale: "Phrygian", octave: -2, modslew: 0.1 }, {
    data: grid([[0, 0, 12, ".", 0, 3, ".", 7]], { vel: (r, c) => [112, 80, 95, 80, 105, 85, 80, 95][c % 8], mod: (r, c) => [-60, -100, 80, 0, -30, 100, 0, 40][c % 8] }),
  });
  const v = voice(p, [1, 0], { node: seq }, { osc: { shape: 0.97 }, env: { decay: 0.16, sustain: 0.5, release: 0.07 }, filter: { cutoff: 300, resonance: 0.45, drive: 0.25 } });
  p.cable(seq, "mod", v.filter, "cutoff", 0.5);
  withBeat(p, [3, 0], v.out, "l", "four", { lead: -5 });
  return p;
}

function slowCrosshair() {
  const p = patch("Cartesian Seq: Slow Crosshair", {
    module: "cartesian-sequencer", tempo: 68,
    description: "Cartesian mode: no clocks, two slow LFOs steer the X and Y inputs across a full 8 × 8 grid of Lydian notes, and a note sounds whenever the crosshair enters a new cell. Move X and Y yourself, or change the LFO rates to wander faster.",
    tags: ["cartesian mode", "ambient", "drift", "lydian"],
  });
  const sc = [0, 2, 4, 6, 7, 9, 11];
  const rows = [];
  for (let r = 0; r < 8; r++) {
    rows.push([]);
    for (let c = 0; c < 8; c++) { const d = (r * 3 + c) % 14; rows[r].push(sc[d % 7] + 12 * Math.floor(d / 7)); }
  }
  const seq = p.add("cartesian-sequencer", [0, 1], { mode: "Cartesian", sample: "Change", gatelength: 0.9, columns: 8, rows: 8, x: 0.5, y: 0.5, root: "F", scale: "Lydian" }, { data: grid(rows, { vel: () => 90 }) });
  const lx = p.add("lfo", [0, 0], { rate: 0.05 }, { name: "X Drift" });
  const ly = p.add("lfo", [0, 2], { rate: 0.073, wave: "Triangle" }, { name: "Y Drift" });
  p.cable(lx, "out", seq, "x", 0.55).cable(ly, "out", seq, "y", 0.55);
  const v = voice(p, [1, 0], { node: seq, trigger: false }, { osc: { shape: 0.2 }, env: { attack: 0.3, decay: 1.2, sustain: 0.35, release: 3 }, filter: { cutoff: 2400, type: "1-Pole Low-pass" } });
  space(p, [4, 0], v.out, "l", { level: 5, delay: { zone: 4, time: 0.6, feedback: 0.55, character: 0.4, wobble: 0.3, mix: 0.4 }, verb: { size: 0.8, decay: 7, mix: 0.45 } });
  return p;
}

function rowEndFills() {
  const p = patch("Cartesian Seq: Row End Fills", {
    module: "cartesian-sequencer", tempo: 104,
    description: "X runs backward through a 5 × 3 grid, and the Row End and Grid End triggers play the drums: a hat each time a row finishes, a kick and clap when the whole grid has been walked. Change Columns or Rows and the drum accents move with the melody.",
    tags: ["row end", "grid end", "triggers", "drums"],
  });
  const seq = p.add("cartesian-sequencer", [0, 0], { gatelength: 0.4, columns: 5, rows: 3, xrate: "1/8", yrate: "Wrap", xdirection: "Backward", root: "A", scale: "Natural Minor" }, {
    data: grid([[0, 3, 7, 10, 12], [12, 10, 7, 5, 3], [7, 5, 3, 0, -2]]),
  });
  const v = voice(p, [1, 0], { node: seq }, { osc: { shape: 0.5 }, env: { decay: 0.3, sustain: 0.1, release: 0.2 }, filter: { cutoff: 2800 } });
  const hat = p.add("punch-hats", [1, 3], { level: 0.5, closed: 0.04 });
  const kick = p.add("punch-kick", [1, 4], { level: 0.8, decay: 0.5 });
  const clap = p.add("punch-clap", [1, 5], { level: 0.6 });
  p.cable(seq, "rowend", hat, "closed").cable(seq, "gridend", kick, "trig").cable(seq, "gridend", clap, "trig");
  const mix = p.add("audio-mixer", [4, 0], { level1: 2, level2: -10, pan2: 0.3, level3: -3, level4: -10, pan4: -0.2, master: -2 }, { name: "Mix" });
  p.cable(v.out, "l", mix, "in1l").cable(v.out, "l", mix, "in1r").cable(hat, "out", mix, "in2l").cable(kick, "out", mix, "in3l").cable(clap, "out", mix, "in4l");
  const verb = p.add("reverb", [5, 0], { size: 0.45, decay: 1.8, mix: 0.2 });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [twoRowRiff, pingPongMarimba, modBass, slowCrosshair, rowEndFills];
