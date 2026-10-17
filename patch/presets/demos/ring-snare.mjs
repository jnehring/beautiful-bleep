// SPDX-License-Identifier: MIT
// Ring Snare: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Snare: Backbeat Crack", {
    module: "ring-snare", tempo: 100,
    description: "A plain two-and-four snare with a kick and closed hats. Turn Snappy up for more rattle, down for more drum, and Tone to change how much of the second head you hear.",
    tags: ["snare","backbeat","rock","kit"],
  });
  return drums(p, ["X.....x...X..x..","....X.......X...","x.x.x.x.x.x.x.x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"tune":185,"tone":0.5,"snappy":0.6,"decay":0.25,"level":0.8},"tr":2,"name":"Snare","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.45},"tr":3,"open":4,"name":"Hats","db":-14,"pan":0.3}], {"mods":[{"lfo":{"rate":0.08,"wave":"Triangle","polarity":"Unipolar"},"to":1,"knob":"snappy","amt":0.4,"name":"Snappy Drift"}]});
}

function demo2() {
  const p = patch("Ring Snare: Ghost Note Funk", {
    module: "ring-snare", tempo: 96,
    description: "Soft ghost notes between hard backbeats show how the snare follows velocity: quiet hits are mostly the heads, loud ones add the noise burst. Shorten Decay and raise Snappy for a tighter, drier funk snare.",
    tags: ["snare","ghost notes","funk","dynamics"],
  });
  return drums(p, ["X.....x..x....x.","..o.X..o.o.X..oo","x.x.x.x.x.x.x.xx",""], [{"t":"ring-kick","v":{"level":0.8,"tune":56,"decay":0.35},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"tune":210,"tone":0.6,"snappy":0.8,"decay":0.14,"level":0.8},"tr":2,"name":"Snare","db":-6,"pan":-0.05},{"t":"ring-hats","v":{"level":0.45,"closed":0.05},"tr":3,"open":4,"name":"Hats","db":-14,"pan":0.3}], {"gain":5.8});
}

function demo3() {
  const p = patch("Ring Snare: Deep Room Snare", {
    module: "ring-snare", tempo: 78,
    description: "Tune down low and Decay long give a fat, heavy snare that blooms in a big room. Raise Tune for a tighter pop, or lower Snappy to hear the bare heads.",
    tags: ["snare","low","ballad","reverb"],
  });
  return drums(p, ["X.......x.......","........X.......","..x...x...x...x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":44,"decay":1,"tone":0.25},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"tune":125,"tone":0.35,"snappy":0.35,"decay":0.7,"level":0.85},"tr":2,"name":"Snare","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"verb":{"size":0.8,"decay":3.2,"damping":0.5,"mix":0.3},"gain":4.1});
}

function demo4() {
  const p = patch("Ring Snare: Snare Roll Build", {
    module: "ring-snare", tempo: 120,
    description: "Sixteenth-note snare rolls get tighter and brighter as an LFO raises Tune over four bars, a classic build to the drop. Try slowing the LFO or lowering Decay to change how the roll connects.",
    tags: ["snare","roll","build","fill"],
  });
  return drums(p, ["X...x...X...x...","........x.x.xxxx","x.x.x.x.x.x.x.x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"tune":170,"tone":0.55,"snappy":0.7,"decay":0.12,"level":0.75},"tr":2,"name":"Snare","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"mods":[{"lfo":{"rate":0.12,"wave":"Saw Up","polarity":"Unipolar","sync":"4 bars"},"to":1,"knob":"tune","amt":0.5,"name":"Roll Rise"}]});
}

function demo5() {
  const p = patch("Ring Snare: Electro Tick", {
    module: "ring-snare", tempo: 112,
    description: "A high-tuned, very short snare turns into a crisp electro tick against a bouncy kick pattern. Raise Tone to make it ring more like a drum and less like a click.",
    tags: ["snare","electro","high","tight"],
  });
  return drums(p, ["X..x..x...x..x..","....x..x....x..x","..x...x...x...x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":60,"decay":0.3,"sweep":0.5},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"tune":320,"tone":0.8,"snappy":0.45,"decay":0.09,"level":0.8},"tr":2,"name":"Tick","db":-6,"pan":0.1},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-14,"pan":0.3}], {"delay":{"sync":"Tempo","ratel":"1/16.","rater":"1/8","feedback":0.3,"highcut":6000,"mix":0.15},"gain":6});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
