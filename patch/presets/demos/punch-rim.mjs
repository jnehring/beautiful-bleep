// SPDX-License-Identifier: MIT
// Punch Rim: five demo patches. Each plays by itself with the transport.
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

function dryClick() {
  const p = patch("Punch Rim: Dry Click Groove", {
    module: "punch-rim", tempo: 106,
    description: "A hard, bright rim crack answers a soft kick in a syncopated pattern. Tune moves the crack up or down in pitch, and Decay lets it ring out or stops it dead.",
    tags: ["rim", "rimshot", "click", "groove"],
  });
  kit(p, [
    KICK("X.....x...x.....", { tune: 52, decay: 0.35 }, -4),
    RIM("..x..x..x...x.x.", { tune: 0, decay: 0.5 }, -8),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.03 }, -18),
  ]);
  return p;
}

function rimLadder() {
  const p = patch("Punch Rim: Tuned Ladder", {
    module: "punch-rim", tempo: 120,
    description: "Three rims tuned a fifth apart climb up and down like a small percussion ladder. Change Tune on any rim to bend the intervals, or lengthen Decay to let them overlap.",
    tags: ["rim", "tuned", "ladder", "percussion"],
  });
  kit(p, [
    RIM("x...x...x...x...", { tune: -7, decay: 0.8 }, -9, { pan: -0.3, name: "Rim Low" }),
    RIM("..x...x...x...x.", { tune: 0, decay: 0.7 }, -9, { name: "Rim Mid" }),
    RIM(".x.x...x.x.x.x..", { tune: 7, decay: 0.6 }, -10, { pan: 0.3, name: "Rim High" }),
    KICK("X.......X.......", { tune: 48, decay: 0.45 }, -4),
  ]);
  return p;
}

function longRing() {
  const p = patch("Punch Rim: Long Ring", {
    module: "punch-rim", tempo: 80,
    description: "A low-tuned rim with the longest Decay rings through a roomy reverb in a sparse pattern, like a woodblock in a church. Raise Tune for a sharper tick.",
    tags: ["rim", "ring", "sparse", "reverb", "ambient"],
  });
  kit(p, [
    RIM("X.....x.....x...", { tune: -5, decay: 3.5 }, -7, { send: -8 }),
    KICK("X...............", { tune: 42, decay: 0.9 }, -6),
    HAT("........x.......", "", { closed: 0.03 }, -22),
  ], { master: 5, verb: { size: 0.8, decay: 4, damping: 0.5 } });
  return p;
}

function bossa() {
  const p = patch("Punch Rim: Bossa Clave", {
    module: "punch-rim", tempo: 128,
    description: "The rim plays a five-hit clave over a gentle kick and hats, with a mellow bass line moving underneath. Raise Tune for a woodier tick, shorten Decay for dry crispness.",
    tags: ["rim", "clave", "bossa", "latin", "melody"],
  });
  const m = melody(p, [0, 6], [0, ".", ".", 7, ".", ".", 5, ".", ".", 3, ".", ".", 2, ".", ".", "."], { rate: "1/8", root: "G", scale: "Dorian", octave: -1, shape: 0.25,
    env: { decay: 0.3, sustain: 0.1, release: 0.15 } });
  kit(p, [
    RIM("X..x..x...x..x..", { tune: 2, decay: 0.45 }, -6),
    KICK("X..x.X..x..x.X..", { tune: 55, decay: 0.3, sweep: 0.3 }, -7),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.03, tone: 0.4 }, -19),
    { src: m.amp, jack: "l", level: -9 },
  ], { master: 2 });
  return p;
}

function rimEcho() {
  const p = patch("Punch Rim: Ping-Pong Echo", {
    module: "punch-rim", tempo: 100,
    description: "A sparse rim pattern bounces left and right through a tempo-synced delay, so a few hits fill the whole bar. Change the rim's Tune and Decay, and watch how the echoes follow.",
    tags: ["rim", "delay", "ping-pong", "stereo", "sparse"],
  });
  kit(p, [
    RIM("x..x..x....x..x.", { tune: 3, decay: 0.5 }, -4),
    KICK("X.......X.......", { tune: 50, decay: 0.4 }, -5),
    HAT("..x...x...x...x.", "", { closed: 0.03 }, -20),
  ], { master: 6, post: (pp, mix) => {
    const d = pp.add("delay", [5, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/8", mode: "Ping-Pong", feedback: 0.5, highcut: 6000, lowcut: 200, mix: 0.4 });
    pp.cable(mix, "outl", d, "l").cable(mix, "outr", d, "r");
    return d;
  } });
  return p;
}

export default [dryClick, rimLadder, longRing, bossa, rimEcho];
