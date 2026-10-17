// SPDX-License-Identifier: MIT
// Punch Hats: five demo patches. Each plays by itself with the transport.
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

function shuffle() {
  const p = patch("Punch Hats: Swung Shuffle", {
    module: "punch-hats", tempo: 96,
    description: "Closed hats shuffle along with swing while an open hat lifts every few beats and cuts the closed ones short. Lengthen Open Decay to hear it ring, or try Closed Decay for a looser, longer tick.",
    tags: ["hats", "shuffle", "swing", "open and closed"],
  });
  kit(p, [
    KICK("X.....x...X.....", { tune: 52, decay: 0.4 }, -4),
    SNARE("....X.......X...", { decay: 0.25 }, -8),
    HAT("x.xxx.xxx.xxx.xx", "..x.....x.....x.", { closed: 0.05, open: 0.35, tone: 0.5, crunch: 0.3 }, -13),
  ], { swing: 0.62 });
  return p;
}

function chokeLesson() {
  const p = patch("Punch Hats: Open and Choked", {
    module: "punch-hats", tempo: 122,
    description: "A long open hat rings on the offbeats and gets cut by the closed hat that follows, the way a real hat pedal behaves. Raise Open Decay for a longer wash, and notice the closed hit always shuts it off.",
    tags: ["hats", "open", "choke", "house"],
  });
  kit(p, [
    KICK("X...X...X...X...", { tune: 51, decay: 0.42 }, -4),
    HAT("x.x.x.x.x.x.x.x.", "..x...x...x...x.", { closed: 0.04, open: 1.2, tone: 0.55, crunch: 0.35 }, -15),
    CLAP("....x.......x...", {}, -12),
  ]);
  return p;
}

function dusty() {
  const p = patch("Punch Hats: Dark and Dusty", {
    module: "punch-hats", tempo: 84,
    description: "Hats with Tone and Crunch low and Tune pulled down sound muted and old, ticking quietly behind a lazy kick and snare. Raise Tone and Crunch to polish them up.",
    tags: ["hats", "dark", "lo-fi", "dusty", "hip-hop"],
  });
  kit(p, [
    KICK("X..x......x.X...", { tune: 54, decay: 0.35, drive: 0.1 }, -4),
    SNARE("....X.......X...", { tune: 175, tone: 0.35, snappy: 0.45, decay: 0.2 }, -8),
    HAT("x.xxx.x.x.xxx.xx", "......x.......x.", { tune: -5, closed: 0.04, open: 0.3, tone: 0.1, crunch: 0 }, -11),
  ], { master: 3 });
  return p;
}

function brightCrunch() {
  const p = patch("Punch Hats: Bright Crunch", {
    module: "punch-hats", tempo: 140,
    description: "Fast sixteenth hats with Tone and Crunch at maximum sizzle over a driving kick. Lower Crunch for a cleaner shimmer, or turn Tune down if it feels too sharp.",
    tags: ["hats", "bright", "crunch", "sixteenths", "driving"],
  });
  kit(p, [
    KICK("X...X...X...X...", { tune: 50, decay: 0.35 }, -4),
    HAT("xxxxxxxxxxxxxxxx", "..x...x...x...x.", { tune: 4, closed: 0.03, open: 0.2, tone: 1, crunch: 1 }, -22),
    SNARE("....X.......X...", { decay: 0.2, tone: 0.6 }, -10),
  ]);
  return p;
}

function twoHats() {
  const p = patch("Punch Hats: Two Hat Interplay", {
    module: "punch-hats", tempo: 108,
    description: "Two hat voices tuned apart sit left and right and interlock into one busy pattern, one slightly darker and one brighter. Change the Tune on each to widen the gap.",
    tags: ["hats", "stereo", "interlock", "layers"],
  });
  kit(p, [
    HAT("x.x.x.x.x.x.x.x.", "......x.......x.", { tune: -4, closed: 0.04, open: 0.3, tone: 0.35, crunch: 0.2 }, -15, { pan: -0.4, name: "Hat Low" }),
    HAT(".xx..x.xx..x.xx.", "..............x.", { tune: 4, closed: 0.03, open: 0.2, tone: 0.75, crunch: 0.5 }, -17, { pan: 0.4, name: "Hat High" }),
    KICK("X.....x...X.....", { tune: 52, decay: 0.4 }, -4),
    SNARE("....X.......X...", { decay: 0.25 }, -8),
  ]);
  return p;
}

export default [shuffle, chokeLesson, dusty, brightCrunch, twoHats];
