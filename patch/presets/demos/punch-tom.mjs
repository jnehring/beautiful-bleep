// SPDX-License-Identifier: MIT
// Punch Tom: five demo patches. Each plays by itself with the transport.
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

function tribalToms() {
  const p = patch("Punch Tom: Tribal Toms", {
    module: "punch-tom", tempo: 112,
    description: "Three toms tuned low, middle and high chase each other around a steady kick. Tune each tom to change the melody of the pattern, Bend to set how far the pitch falls on every hit.",
    tags: ["tom", "tribal", "toms", "tuned"],
  });
  kit(p, [
    TOM("x..x..x...x.x...", { tune: 85, decay: 0.55, bend: 0.5, noise: 0.15 }, -6, { pan: -0.3, name: "Low Tom" }),
    TOM("..x...x.x...x.x.", { tune: 125, decay: 0.45, bend: 0.5, noise: 0.15 }, -7, { name: "Mid Tom" }),
    TOM(".x...x...x.x...x", { tune: 185, decay: 0.35, bend: 0.5, noise: 0.15 }, -8, { pan: 0.3, name: "High Tom" }),
    KICK("X.......X.......", { tune: 48, decay: 0.5 }, -4),
  ]);
  return p;
}

function electroDrops() {
  const p = patch("Punch Tom: Electro Drops", {
    module: "punch-tom", tempo: 120,
    description: "High toms with the Bend turned all the way up zap downward like laser drops over a bouncy kick and snare. Pull Bend back to hear them settle into real toms.",
    tags: ["tom", "electro", "zap", "bend", "synthetic"],
  });
  kit(p, [
    TOM("x.x.x..xx.x.x..x", { tune: 300, decay: 0.2, bend: 1, noise: 0 }, -8, { pan: -0.2 }),
    TOM("..x...x...x..x..", { tune: 170, decay: 0.3, bend: 0.9, noise: 0.05 }, -8, { pan: 0.25, name: "Tom 2" }),
    KICK("X..x..X...x.X...", { tune: 52, decay: 0.35 }, -4),
    SNARE("....X.......X...", { tune: 210, decay: 0.2 }, -8),
  ]);
  return p;
}

function floorBoom() {
  const p = patch("Punch Tom: Floor Boom", {
    module: "punch-tom", tempo: 66,
    description: "A very low floor tom with a long Decay booms through a big room in a slow, ceremonial pattern. Raise Tune to bring it toward a conga, add Noise for a rougher skin.",
    tags: ["tom", "floor", "boom", "cinematic", "reverb"],
  });
  kit(p, [
    TOM("X.......X.x.....", { tune: 62, decay: 1.8, bend: 0.3, noise: 0.05 }, -4, { send: -8, name: "Floor Tom" }),
    TOM("....x.......x.x.", { tune: 90, decay: 1.0, bend: 0.35, noise: 0.1 }, -9, { send: -8, pan: 0.25 }),
    HAT("......x.......x.", "", { closed: 0.03 }, -22),
  ], { verb: { size: 0.9, decay: 5, damping: 0.55, preDelay: 0.04 } });
  return p;
}

function rototom() {
  const p = patch("Punch Tom: Pitched Melody", {
    module: "punch-tom", tempo: 100,
    description: "Four toms with little Bend and no Noise are tuned to notes of a minor pentatonic scale, so the groove turns into a tuned melody. Change Tune on any tom to re-write the tune.",
    tags: ["tom", "melodic", "tuned", "pentatonic", "marimba"],
  });
  kit(p, [
    TOM("x...x...x...x...", { tune: 110, decay: 0.4, bend: 0.1, noise: 0 }, -6, { pan: -0.3, name: "Tom A" }),
    TOM("..x...x...x...x.", { tune: 131, decay: 0.35, bend: 0.1, noise: 0 }, -6, { pan: -0.1, name: "Tom C" }),
    TOM(".x..x..x..x..x..", { tune: 147, decay: 0.3, bend: 0.1, noise: 0 }, -7, { pan: 0.1, name: "Tom D" }),
    TOM("...x.x....x.x.x.", { tune: 165, decay: 0.3, bend: 0.1, noise: 0 }, -7, { pan: 0.3, name: "Tom E" }),
  ], { master: 3 });
  return p;
}

function noisySkins() {
  const p = patch("Punch Tom: Noisy Skins", {
    module: "punch-tom", tempo: 138,
    description: "A fast fill of toms with plenty of Noise sounds like stretched, rattly skins, dropping a quick pitch on each hit. Lower Noise to clean them up, or raise Decay to let them ring over the kick.",
    tags: ["tom", "noise", "fill", "rough", "fast"],
  });
  kit(p, [
    TOM("xxx.xxx.xxx.xx.x", { tune: 140, decay: 0.22, bend: 0.6, noise: 0.9 }, -8, { pan: -0.2 }),
    TOM("...xx..x...x..xx", { tune: 210, decay: 0.18, bend: 0.5, noise: 0.8 }, -9, { pan: 0.25, name: "Tom 2" }),
    KICK("X...X...X...X...", { tune: 50, decay: 0.35 }, -4),
    SNARE("....x.......X...", { decay: 0.2 }, -8),
  ]);
  return p;
}

export default [tribalToms, electroDrops, floorBoom, rototom, noisySkins];
