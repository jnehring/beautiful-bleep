// SPDX-License-Identifier: MIT
// Punch Clap: five demo patches. Each plays by itself with the transport.
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

function classicBackbeat() {
  const p = patch("Punch Clap: Classic Backbeat", {
    module: "punch-clap", tempo: 118,
    description: "A hand clap on two and four over a steady kick and hats. Bursts sets how many hands you hear, Spread how loosely they land, and Tone how bright they sound.",
    tags: ["clap", "backbeat", "groove", "drums"],
  });
  kit(p, [
    KICK("X...X...X...X..x", { tune: 52, decay: 0.4 }, -4),
    CLAP("....X.......X...", { tone: 1500, decay: 0.35, spread: 0.008, bursts: 4 }, -6),
    HAT("x.x.x.x.x.x.x.x.", "......x.......x.", { closed: 0.04, open: 0.25 }, -17),
  ]);
  return p;
}

function wideCrowd() {
  const p = patch("Punch Clap: Wide Crowd", {
    module: "punch-clap", tempo: 90,
    description: "Six slow, widely spread bursts with a long Decay sound like a crowd clapping together in a hall. Narrow Spread and lower Bursts to bring it back to a single pair of hands.",
    tags: ["clap", "crowd", "wide", "reverb"],
  });
  kit(p, [
    KICK("X.......X.x.....", { tune: 48, decay: 0.55 }, -4),
    CLAP("........X.......", { tone: 1800, decay: 1, spread: 0.03, bursts: 6 }, -8, { send: -8 }),
    CLAP("....x.......x...", { tone: 2500, decay: 0.4, spread: 0.02, bursts: 5 }, -16, { pan: 0.3, name: "Clap 2" }),
  ], { verb: { size: 0.8, decay: 3.5, damping: 0.5 } });
  return p;
}

function singleSnap() {
  const p = patch("Punch Clap: Single Snaps", {
    module: "punch-clap", tempo: 124,
    description: "With Bursts at 1 and a short Decay the clap becomes a tight snap, played as a busy sixteenth pattern like a percussion loop. Raise Bursts one at a time to hear the snap turn back into a clap.",
    tags: ["clap", "snap", "percussion", "tight"],
  });
  kit(p, [
    KICK("X...X...X...X...", { tune: 54, decay: 0.35 }, -4),
    CLAP("..x.xx.x..x.x.xx", { tone: 3200, decay: 0.08, spread: 0.005, bursts: 1 }, -9, { pan: -0.3 }),
    CLAP("....X.......X...", { tone: 1400, decay: 0.3, bursts: 4 }, -9, { name: "Clap 2" }),
    HAT("..x...x...x...x.", "", { closed: 0.03 }, -18),
  ]);
  return p;
}

function darkRoom() {
  const p = patch("Punch Clap: Dark Room", {
    module: "punch-clap", tempo: 72,
    description: "A low-toned clap with a long tail plays slow, spacious beats under a soft melody. Raise Tone to open it up, or shorten Decay to get a dry thump.",
    tags: ["clap", "dark", "slow", "ambient", "melody"],
  });
  const m = melody(p, [0, 6], [0, ".", ".", 7, ".", ".", 3, ".", 5, ".", ".", ".", 10, ".", ".", "."], { rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: -1, shape: 0.2,
    env: { attack: 0.02, decay: 0.7, sustain: 0.2, release: 0.5 } });
  kit(p, [
    KICK("X.......X.....x.", { tune: 44, decay: 0.8 }, -4),
    CLAP("....X.......X...", { tone: 700, decay: 0.8, spread: 0.014, bursts: 3 }, -5, { send: -8 }),
    { src: m.amp, jack: "l", level: -12, pan: -0.1, send: -10 },
  ], { verb: { size: 0.75, decay: 4, damping: 0.65, tone: -0.2 } });
  return p;
}

function rollingApplause() {
  const p = patch("Punch Clap: Rolling Applause", {
    module: "punch-clap", tempo: 132,
    description: "Three claps at different tones and Bursts roll over each other in an off-beat pattern, like a small audience losing the beat. Change Tone on each to separate the voices, or Spread to blur them.",
    tags: ["clap", "layers", "polyrhythm", "dance"],
  });
  kit(p, [
    KICK("X...X...X...X...", { tune: 50, decay: 0.38 }, -4),
    CLAP("..x..x..x..x..x.", { tone: 1100, decay: 0.2, bursts: 3 }, -10, { pan: -0.3 }),
    CLAP("....x..x..x.....", { tone: 2000, decay: 0.3, bursts: 5 }, -10, { name: "Clap 2" }),
    CLAP(".x..x...x..x...x", { tone: 3500, decay: 0.12, bursts: 2 }, -12, { pan: 0.3, name: "Clap 3" }),
  ]);
  return p;
}

export default [classicBackbeat, wideCrowd, singleSnap, darkRoom, rollingApplause];
