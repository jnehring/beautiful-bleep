// SPDX-License-Identifier: MIT
// Punch Cymbal: five demo patches. Each plays by itself with the transport.
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

function crashAccents() {
  const p = patch("Punch Cymbal: Crash Accents", {
    module: "punch-cymbal", tempo: 120,
    description: "A crash lands on the first beat of every two bars over a straight rock groove. Decay sets how long the wash lasts, Tone how bright it is, and Crunch how gritty.",
    tags: ["cymbal", "crash", "accent", "rock"],
  });
  kit(p, [
    CYM("X...............................".slice(0, 16), { voice: "Crash", decay: 2.5, tone: 0.55, crunch: 0.3 }, -12),
    KICK("X.....x.X.x...x.", { tune: 52, decay: 0.4 }, -4),
    SNARE("....X.......X...", { decay: 0.25 }, -8),
    HAT("x.x.x.x.x.x.x.x.", "", { closed: 0.04 }, -18),
  ]);
  return p;
}

function ridePattern() {
  const p = patch("Punch Cymbal: Swung Ride", {
    module: "punch-cymbal", tempo: 138,
    description: "The cymbal set to Ride plays a swung pattern over a light kick and brushed snare, jazz-style. Shorten Decay for a tighter ping, raise Tone for more bell.",
    tags: ["cymbal", "ride", "jazz", "swing"],
  });
  kit(p, [
    CYM("x..xx..xx..xx..x", { voice: "Ride", decay: 1.2, tone: 0.6, crunch: 0.1 }, -14),
    KICK("X.........x.....", { tune: 56, decay: 0.3 }, -8),
    SNARE("......x.....x...", { tune: 220, tone: 0.4, snappy: 0.4, decay: 0.15 }, -14),
    HAT("....x.......x...", "", { closed: 0.05, tone: 0.4 }, -18),
  ], { swing: 0.64, master: 6 });
  return p;
}

function slowSwell() {
  const p = patch("Punch Cymbal: Slow Swell", {
    module: "punch-cymbal", tempo: 62,
    description: "A crash with a very long Decay and a darker Tone is sent into a huge reverb, so a few hits stack up into a slowly breathing wash. Raise Tone or shorten Decay to hear it become a normal crash.",
    tags: ["cymbal", "swell", "wash", "ambient", "reverb"],
  });
  kit(p, [
    CYM("X.......x.......", { voice: "Crash", decay: 8, tone: 0.25, crunch: 0.1 }, -12, { send: -10 }),
    KICK("X...............", { tune: 40, decay: 1.2 }, -6),
    TOM("........x...x...", { tune: 80, decay: 1.2 }, -14, { send: -8 }),
  ], { master: 3, verb: { size: 0.95, decay: 10, damping: 0.5 } });
  return p;
}

function brightWash() {
  const p = patch("Punch Cymbal: Bright Punk Wash", {
    module: "punch-cymbal", tempo: 168,
    description: "A fast punk beat with a bright, crunchy crash splashing on every other beat. Turn Crunch down to polish it, or Tune up for a smaller splash.",
    tags: ["cymbal", "crash", "punk", "bright", "crunch"],
  });
  kit(p, [
    CYM("x.......x.......", { voice: "Crash", tune: 3, decay: 1.4, tone: 0.9, crunch: 0.8 }, -14),
    KICK("X..xX..xX..xX.x.", { tune: 55, decay: 0.3 }, -4),
    SNARE("..x.X.x.x.X.X.xx", { tune: 230, snappy: 0.7, decay: 0.15 }, -7),
  ]);
  return p;
}

function crashAndRide() {
  const p = patch("Punch Cymbal: Crash and Ride", {
    module: "punch-cymbal", tempo: 110,
    description: "A crash and a ride, each its own Cymbal, share a groove: the ride keeps time on the offbeats while the crash marks the phrase. Change Voice on either to swap the roles.",
    tags: ["cymbal", "crash", "ride", "layers", "groove"],
  });
  kit(p, [
    CYM("x.x.x.x.x.x.x.x.", { voice: "Ride", tune: 0, decay: 1.5, tone: 0.5, crunch: 0.2 }, -17, { pan: 0.3, name: "Ride" }),
    CYM("X...............", { voice: "Crash", tune: -2, decay: 4, tone: 0.5, crunch: 0.3 }, -13, { pan: -0.3, name: "Crash" }),
    KICK("X..x..x.X..x....", { tune: 52, decay: 0.4 }, -4),
    SNARE("....X.......X...", { decay: 0.25 }, -8),
  ]);
  return p;
}

export default [crashAccents, ridePattern, slowSwell, brightWash, crashAndRide];
