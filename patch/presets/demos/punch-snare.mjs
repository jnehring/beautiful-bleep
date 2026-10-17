// SPDX-License-Identifier: MIT
// Punch Snare: five demo patches. Each plays by itself with the transport.
import { patch, drumGrid, pattern } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// A drum groove: Drum Grid → voices → Audio Mixer (→ optional Verb on the sends) → Out 1/2.
///   voices: {type, knobs, row, level (dB), pan, send (dB), open (hat row), name} or {src: node, jack, level, pan, send} for any other source.
///   Voices after the third are pre-mixed on a second mixer that feeds channel 4.
function kit(p, voices, opts = {}) {
  const names = [], rows = [];
    const nodes = voices.map((v, i) => {
    if (v.src) return { node: v.src, jack: v.jack || "l", v };
    const g0 = names.length;
    names.push(v.name || v.type); rows.push(v.row);
    if (v.open !== undefined) { names.push("Open"); rows.push(v.open); }
    return { node: null, g0, v };
  });
  while (names.length < 8) { names.push("-"); rows.push(""); }
  const grid = p.add("drum-grid", [0, 0], { swing: opts.swing ?? 0.5, gatelength: 0.25 },
    { data: drumGrid(names, [pattern("Groove", rows)]) });
  let r = 0;
  nodes.forEach((n) => {
    if (n.node) return;
    const v = n.v;
    n.node = p.add(v.type, [1, r++], v.knobs || {});
    if (v.open !== undefined) {
      p.cable(grid, `gate${n.g0 + 1}`, n.node, "closed").cable(grid, `gate${n.g0 + 2}`, n.node, "open");
    } else p.cable(grid, `gate${n.g0 + 1}`, n.node, "trig");
    p.cable(grid, `velocity${n.g0 + 1}`, n.node, "velocity");
    n.jack = "out";
  });
  const mkMix = (at, list, master) => {
    const k = {};
    list.forEach((n, i) => { k[`level${i + 1}`] = n.v.level ?? -6; k[`pan${i + 1}`] = n.v.pan ?? 0; if (n.v.send !== undefined) k[`send${i + 1}`] = n.v.send; });
    const m = p.add("audio-mixer", at, { ...k, master });
    list.forEach((n, i) => { p.cable(n.node, n.jack, m, `in${i + 1}l`); if (n.stereo) p.cable(n.node, n.stereo, m, `in${i + 1}r`); });
    return m;
  };
  let mix;
  if (nodes.length > 4) {
    const sub = mkMix([3, 2], nodes.slice(3), 0);
    const k = { level4: 0, master: opts.master ?? -3 };
    nodes.slice(0, 3).forEach((n, i) => { k[`level${i + 1}`] = n.v.level ?? -6; k[`pan${i + 1}`] = n.v.pan ?? 0; if (n.v.send !== undefined) k[`send${i + 1}`] = n.v.send; });
    mix = p.add("audio-mixer", [4, 0], k, { name: "Drum Mix" });
    nodes.slice(0, 3).forEach((n, i) => p.cable(n.node, n.jack, mix, `in${i + 1}l`));
    p.cable(sub, "outl", mix, "in4l").cable(sub, "outr", mix, "in4r");
  } else {
    mix = mkMix([3, 0], nodes, opts.master ?? -3);
  }
  if (opts.verb) {
    const v = p.add("reverb", [5, 0], { mix: 1, ...opts.verb });
    p.cable(mix, "sendl", v, "l").cable(mix, "sendr", v, "r").cable(v, "l", mix, "returnl").cable(v, "r", mix, "returnr");
  }
  if (opts.post) { const f = opts.post(p, mix); p.stereo(f, p.out); } else p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return { grid, mix };
}

const V = (type, name, row, knobs = {}, level = -6, extra = {}) => ({ type, name, row, knobs, level, ...extra });
const KICK = (row, knobs = {}, level = -4, extra = {}) => V("punch-kick", "Kick", row, { level: 0.8, ...knobs }, level, extra);
const SNARE = (row, knobs = {}, level = -8, extra = {}) => V("punch-snare", "Snare", row, { level: 0.6, ...knobs }, level, { pan: 0.1, ...extra });
const CLAP = (row, knobs = {}, level = -10, extra = {}) => V("punch-clap", "Clap", row, { level: 0.6, ...knobs }, level, { pan: -0.15, ...extra });
const TOM = (row, knobs = {}, level = -8, extra = {}) => V("punch-tom", "Tom", row, { level: 0.7, ...knobs }, level, extra);
const RIM = (row, knobs = {}, level = -10, extra = {}) => V("punch-rim", "Rim", row, { level: 0.6, ...knobs }, level, extra);
const HAT = (row, open = "", knobs = {}, level = -16, extra = {}) => V("punch-hats", "Hat", row, { level: 0.5, ...knobs }, level, { open, pan: 0.25, ...extra });
const CYM = (row, knobs = {}, level = -14, extra = {}) => V("punch-cymbal", "Cymbal", row, { level: 0.5, ...knobs }, level, extra);

function backbeatCrack() {
  const p = patch("Punch Snare: Backbeat Crack", {
    module: "punch-snare", tempo: 110,
    description: "A plain rock backbeat: the snare cracks on two and four over kick and hats. Raise Snappy for more rattle, lower it for a woodier hit, and turn Tone to move the body from hollow to bright.",
    tags: ["snare", "backbeat", "rock", "drums"],
  });
  kit(p, [
    KICK("X.....x.X.x...x.", { tune: 55, decay: 0.4 }, -4),
    SNARE("....X.......X..x", { tune: 200, tone: 0.5, snappy: 0.6, decay: 0.28 }, -6),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.04 }, -17),
  ]);
  return p;
}

function fatAndLoose() {
  const p = patch("Punch Snare: Fat and Loose", {
    module: "punch-snare", tempo: 76,
    description: "A low, loose snare with a long Decay and lots of Snappy, thrown into a medium room so it blooms after each hit. Raise Tune to tighten it up, or cut Decay to dry it out.",
    tags: ["snare", "fat", "room", "half-time", "reverb"],
  });
  kit(p, [
    KICK("X.......x.x.....", { tune: 46, decay: 0.7, sweep: 0.4 }, -3),
    SNARE("........X.......", { tune: 140, tone: 0.4, snappy: 0.85, decay: 0.7 }, -5, { send: -9 }),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.03 }, -19),
  ], { verb: { size: 0.55, decay: 1.8, damping: 0.5, tone: 0.1 } });
  return p;
}

function ghostNotes() {
  const p = patch("Punch Snare: Ghost Notes", {
    module: "punch-snare", tempo: 98,
    description: "A funky groove where soft ghost notes between the loud accents make the snare chatter. Velocity from the grid shapes each hit; try a short Decay and high Tune for a drier, tighter chatter.",
    tags: ["snare", "ghost notes", "funk", "velocity"],
  });
  kit(p, [
    KICK("X..x..x...X..x..", { tune: 52, decay: 0.35 }, -4),
    SNARE(".x..X..x.x.xX..x", { tune: 240, tone: 0.55, snappy: 0.5, decay: 0.14 }, -5),
    HAT("x.xxx.xxx.xxx.xx", "", { closed: 0.03, tone: 0.55 }, -18),
  ]);
  return p;
}

function rollBuild() {
  const p = patch("Punch Snare: Roll Build", {
    module: "punch-snare", tempo: 128,
    description: "Over a four-on-the-floor kick the snare tightens from a few hits into a full sixteenth roll and then stops. Short Decay keeps the roll clean; raise Snappy and Tone for a brighter build.",
    tags: ["snare", "roll", "build", "fill", "dance"],
  });
  kit(p, [
    KICK("X...X...X...X...", { tune: 50, decay: 0.4 }, -4),
    SNARE("........x.x.xxXX", { tune: 220, tone: 0.65, snappy: 0.7, decay: 0.12 }, -7),
    CLAP("....x.......x...", {}, -15),
    HAT("..x...x...x...x.", "", { closed: 0.03 }, -18),
  ]);
  return p;
}

function bodyOnly() {
  const p = patch("Punch Snare: Hollow Wood", {
    module: "punch-snare", tempo: 92,
    description: "Two snares with Snappy at zero play a woody, tuned pair of drum heads under a warm bass line. Raise Snappy on either one and the wires come back; Tune moves the pair like a rototom.",
    tags: ["snare", "tuned", "body", "wood", "bass"],
  });
  const m = melody(p, [0, 6], [0, ".", ".", 0, ".", 5, ".", ".", 3, ".", ".", 7, ".", ".", 5, "."], { rate: "1/8", root: "D", scale: "Minor Pentatonic", octave: -2, shape: 0.3,
    env: { decay: 0.3, sustain: 0.1, release: 0.15 } });
  kit(p, [
    SNARE("x..x....x..x....", { tune: 150, tone: 0.8, snappy: 0, decay: 0.2 }, -5, { pan: -0.2, name: "Low Head" }),
    SNARE("..x...x...x...x.", { tune: 280, tone: 0.8, snappy: 0, decay: 0.12 }, -7, { pan: 0.25, name: "High Head" }),
    KICK("X.......X.......", { tune: 48, decay: 0.5 }, -4),
    { src: m.amp, jack: "l", level: -8 },
  ]);
  return p;
}

export default [backbeatCrack, fatAndLoose, ghostNotes, rollBuild, bodyOnly];
