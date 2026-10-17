// SPDX-License-Identifier: MIT
// Punch Kick: five demo patches. Each plays by itself with the transport.
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
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return { grid, mix };
}

const K = (knobs, row, level = -4, extra = {}) => ({ type: "punch-kick", name: "Kick", knobs, row, level, ...extra });
const HAT = (row, open, knobs = {}, level = -14, pan = 0.25) => ({ type: "punch-hats", name: "Hat", knobs: { level: 0.5, ...knobs }, row, open, level, pan });
const CLAP = (row, knobs = {}, level = -10) => ({ type: "punch-clap", name: "Clap", knobs: { level: 0.6, ...knobs }, row, level, pan: -0.15 });
const SNARE = (row, knobs = {}, level = -8) => ({ type: "punch-snare", name: "Snare", knobs: { level: 0.6, ...knobs }, row, level, pan: 0.1 });

function fourOnFloor() {
  const p = patch("Punch Kick: Four on the Floor", {
    module: "punch-kick", tempo: 124,
    description: "A steady kick on every beat with an offbeat open hat and a clap on two and four. Turn Decay down for a tight club thump or up for a boomy tail, and pull Sweep to hear the pitch drop in and out.",
    tags: ["kick", "house", "four on the floor", "drums"],
  });
  kit(p, [
    K({ tune: 52, decay: 0.45, sweep: 0.55, attack: 0.5, drive: 0.3 }, "X...X...X...X...", -3),
    CLAP("....x.......x...", {}, -10),
    HAT("x.x.x.x.x.x.x.x.", "..x...x...x...x.", { closed: 0.04, open: 0.3 }, -15),
  ]);
  return p;
}

function subBoom() {
  const p = patch("Punch Kick: Sub Boom", {
    module: "punch-kick", tempo: 68,
    description: "A slow half-time groove over a very low kick with a long Decay and a gentle Sweep, so each hit rolls like a sub-bass note. Raise Tune to turn the boom into a thump, shorten Decay to hear it tighten.",
    tags: ["kick", "sub", "half-time", "bass", "808"],
  });
  kit(p, [
    K({ tune: 38, decay: 1.5, sweep: 0.3, attack: 0.15, drive: 0.15 }, "X.......x.x.....", -2),
    SNARE("........X.......", { tune: 190, decay: 0.35, snappy: 0.5 }, -8),
    HAT("..x...x...x...xx", "", { closed: 0.03 }, -17),
  ]);
  return p;
}

function twoTunings() {
  const p = patch("Punch Kick: Two Tunings", {
    module: "punch-kick", tempo: 104,
    description: "Two kicks side by side, a low long one and a higher short one, trade phrases like a bass drum and its echo. Change Tune on either to re-pitch the pattern as a little melody.",
    tags: ["kick", "tuned", "pitch", "call and response"],
  });
  kit(p, [
    K({ tune: 44, decay: 0.7, sweep: 0.45, drive: 0.25 }, "X.....x...X.....", -3),
    K({ tune: 72, decay: 0.18, sweep: 0.7, attack: 0.8, drive: 0.1 }, "..x..x..x...x.xx", -8, { pan: 0.15, name: "Kick 2" }),
    SNARE("....x.......x...", { decay: 0.25, snappy: 0.4 }, -10),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.03 }, -17),
  ]);
  return p;
}

function technoRumble() {
  const p = patch("Punch Kick: Techno Rumble", {
    module: "punch-kick", tempo: 134,
    description: "A hard, driven kick with a strong click, and its tail sent into a dark reverb so every hit leaves a low rumble behind it. Push Drive and Attack for more bite, or lower Decay to make the rumble do the work.",
    tags: ["kick", "techno", "rumble", "drive", "reverb"],
  });
  kit(p, [
    K({ tune: 49, decay: 0.38, sweep: 0.7, attack: 0.85, drive: 0.7 }, "X...X...X...X...", -4, { send: -8 }),
    HAT("x.x.x.x.x.x.x.x.", "..x...x...x...x.", { closed: 0.03, open: 0.25, tone: 0.6 }, -17),
  ], { verb: { size: 0.7, decay: 2.2, tone: -0.7, damping: 0.7, diffusion: 0.8 } });
  return p;
}

function softThump() {
  const p = patch("Punch Kick: Soft Thump", {
    module: "punch-kick", tempo: 86,
    description: "A rounded, dull kick with almost no click or Drive sits under a soft plucked melody and quiet hats. Turn Attack and Drive up and the same pattern turns from lo-fi to punchy.",
    tags: ["kick", "soft", "lo-fi", "chill", "melody"],
  });
  const m = melody(p, [0, 6], [0, ".", 7, ".", 3, 5, ".", 7, ".", ".", 10, ".", 7, ".", 5, "."], { rate: "1/8", root: "F", scale: "Natural Minor", octave: 0, shape: 0.15,
    env: { decay: 0.4, sustain: 0, release: 0.3 } });
  kit(p, [
    K({ tune: 58, decay: 0.32, sweep: 0.2, attack: 0.05, drive: 0 }, "X.....x...x..x..", -3),
    SNARE("....x.......x...", { tune: 170, tone: 0.3, snappy: 0.3, decay: 0.2 }, -12),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.04, crunch: 0.2 }, -19),
    { src: m.amp, jack: "l", level: -9, pan: -0.2 },
  ], { master: 3 });
  return p;
}

export default [fourOnFloor, subBoom, twoTunings, technoRumble, softThump];
