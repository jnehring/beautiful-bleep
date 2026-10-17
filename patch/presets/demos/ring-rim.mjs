// SPDX-License-Identifier: MIT
// Ring Rim: five demo patches. Each plays by itself with the transport.
import { patch, drumGrid, pattern } from "../kit.mjs";

const NAMES = ["Track 1", "Track 2", "Track 3", "Track 4", "Track 5", "Track 6", "Track 7", "Track 8"];

// A Drum Grid ("rows" per track) triggers up to four voices into a Drum Mix; optional modulation, delay and reverb follow.
function drums(p, rows, voices, o = {}) {
  const g = p.add("drum-grid", [0, 0], {}, { data: drumGrid(NAMES, [pattern("Groove", rows)]) });
  const vals = { master: Math.min(6, (o.master ?? -4) + (o.gain || 0)) };
  const extra = Math.max(0, (o.master ?? -4) + (o.gain || 0) - 6);
  const made = voices.map((v, i) => {
    const n = p.add(v.t, [1, i], v.v, { name: v.name });
    if (v.open) {
      p.cable(g, `gate${v.tr}`, n, "closed").cable(g, `gate${v.open}`, n, "open").cable(g, `velocity${v.tr}`, n, "velocity");
    } else p.cable(g, `gate${v.tr}`, n, "trig").cable(g, `velocity${v.tr}`, n, "velocity");
    vals[`level${i + 1}`] = v.db ?? -6;
    vals[`pan${i + 1}`] = v.pan ?? 0;
    return n;
  });
  const mix = p.add("audio-mixer", [3, 0], vals, { name: "Drum Mix" });
  made.forEach((n, i) => p.cable(n, "out", mix, `in${i + 1}l`).cable(n, "out", mix, `in${i + 1}r`));
  (o.mods || []).forEach((m, k) => {
    const lfo = p.add("lfo", [0, 1 + k], m.lfo, { name: m.name || "Movement" });
    p.cable(lfo, "out", made[m.to], m.knob, m.amt);
  });
  let src = mix, a = ["outl", "outr"], col = 4;
  if (o.delay) {
    const d = p.add("delay", [col++, 0], o.delay);
    p.stereo(src, d, { from: a }); src = d; a = ["l", "r"];
  }
  if (o.verb) {
    const r = p.add("reverb", [col++, 0], o.verb);
    p.stereo(src, r, { from: a }); src = r; a = ["l", "r"];
  }
  p.stereo(src, p.out, { from: a });
  return p;
}

function demo1() {
  const p = patch("Ring Rim: Rim Shot Backbeat", {
    module: "ring-rim", tempo: 98,
    description: "A rim shot on the backbeat in place of a snare, over a soft kick and hat. Tune moves the pitch up or down by an octave.",
    tags: ["rim","rim shot","backbeat","kit"],
  });
  return drums(p, ["X.....x...X..x..","....X.......X..x","x.x.x.x.x.x.x.x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-rim","v":{"level":0.8,"voice":"Rim","decay":1},"tr":2,"name":"Rim","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"verb":{"size":0.4,"decay":1.2,"mix":0.12}});
}

function demo2() {
  const p = patch("Ring Rim: Son Clave Pattern", {
    module: "ring-rim", tempo: 112,
    description: "Voice on Clave plays a five-hit son pattern over a steady pulse. Try Rim for a different tone, and Decay for longer or drier hits.",
    tags: ["rim","clave","latin","pattern"],
  });
  return drums(p, ["X..x..x...x.x...","X...............","x.x.x.x.x.x.x.x.",""], [{"t":"ring-rim","v":{"level":0.8,"voice":"Clave","decay":1.2},"tr":1,"name":"Clave","db":-6,"pan":0.2},{"t":"ring-kick","v":{"level":0.8,"tune":50,"decay":0.45},"tr":2,"name":"Kick","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"gain":5.4});
}

function demo3() {
  const p = patch("Ring Rim: Two Woodblocks", {
    module: "ring-rim", tempo: 108,
    description: "Two rims tuned a fifth apart answer each other like a pair of woodblocks. Use the two Tune knobs to find other intervals.",
    tags: ["rim","wood","tuned","percussion"],
  });
  return drums(p, ["x..x..x...x.x...","..x...x.x...x..x","",""], [{"t":"ring-rim","v":{"level":0.8,"voice":"Clave","tune":-5,"decay":1.2},"tr":1,"name":"Low Block","db":-6,"pan":-0.3},{"t":"ring-rim","v":{"level":0.8,"voice":"Clave","tune":5,"decay":1.2},"tr":2,"name":"High Block","db":-7,"pan":0.3},{"t":"ring-kick","v":{"level":0.8,"tune":50},"tr":3,"name":"Kick","db":-6,"pan":0}], {"delay":{"sync":"Tempo","ratel":"1/8.","rater":"1/8","feedback":0.35,"highcut":5000,"mix":0.2},"gain":9.8});
}

function demo4() {
  const p = patch("Ring Rim: Long Ringing Rim", {
    module: "ring-rim", tempo: 74,
    description: "A long Decay lets each rim ring out like a struck metal tube, then a big reverb carries it away. Shorten Decay to hear the click inside the ring.",
    tags: ["rim","ringing","ambient","space"],
  });
  return drums(p, ["X.......x.x.....","........X.......","",""], [{"t":"ring-rim","v":{"level":0.8,"voice":"Rim","tune":-4,"decay":3.5},"tr":1,"name":"Ring A","db":-8,"pan":-0.3},{"t":"ring-rim","v":{"level":0.8,"voice":"Rim","tune":4,"decay":3},"tr":2,"name":"Ring B","db":-9,"pan":0.3}], {"verb":{"size":0.8,"decay":4,"mix":0.3},"master":-2,"gain":13.5});
}

function demo5() {
  const p = patch("Ring Rim: Pitch Wobble Rim", {
    module: "ring-rim", tempo: 120,
    description: "An LFO slowly wobbles the rim's Tune over a driving groove so every hit is a slightly different pitch. Try turning the LFO off by lowering Tune modulation or play the pitch by hand.",
    tags: ["rim","lfo","tune","groove"],
  });
  return drums(p, ["X...x...X...x...","x.xxx.xxx.xxx.xx","..x...x...x...x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-rim","v":{"level":0.7,"voice":"Rim","decay":0.6},"tr":2,"name":"Rim","db":-9,"pan":0.2},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":-0.2}], {"mods":[{"lfo":{"rate":0.4,"wave":"Triangle","polarity":"Bipolar"},"to":1,"knob":"tune","amt":0.5,"name":"Pitch Wobble"}]});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
