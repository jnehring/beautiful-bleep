// SPDX-License-Identifier: MIT
// Ring Cowbell: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Cowbell: Disco Cowbell", {
    module: "ring-cowbell", tempo: 118,
    description: "A steady eighth-note cowbell on top of a four-on-the-floor kick and an open hat. Tone opens and closes the bell, Decay changes how much it rings.",
    tags: ["cowbell","disco","groove","classic"],
  });
  return drums(p, ["X...X...X...X...","","x.x.x.x.x.x.x.x.","..x...x...x...x."], [{"t":"ring-kick","v":{"level":0.8,"tune":54,"decay":0.4},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-cowbell","v":{"level":0.8,"tune":0,"decay":0.3,"tone":0.5},"tr":3,"name":"Cowbell","db":-9,"pan":0.2},{"t":"ring-hats","v":{"level":0.4},"tr":4,"open":4,"name":"Hats","db":-16,"pan":-0.2}], {});
}

function demo2() {
  const p = patch("Ring Cowbell: Latin Bell Pair", {
    module: "ring-cowbell", tempo: 105,
    description: "A high and a low cowbell play an interlocking Latin pattern. The Tune of each bell sets the interval between them.",
    tags: ["cowbell","latin","two bells","pattern"],
  });
  return drums(p, ["x..x..x...x..x..","..x...x.x...x...","X.......X.......",""], [{"t":"ring-cowbell","v":{"level":0.8,"tune":5,"decay":0.25,"tone":0.55},"tr":1,"name":"High Bell","db":-9,"pan":0.3},{"t":"ring-cowbell","v":{"level":0.8,"tune":-4,"decay":0.3,"tone":0.5},"tr":2,"name":"Low Bell","db":-9,"pan":-0.3},{"t":"ring-kick","v":{"level":0.8,"tune":50},"tr":3,"name":"Kick","db":-5,"pan":0}], {"gain":3.7});
}

function demo3() {
  const p = patch("Ring Cowbell: Dark Bell Toll", {
    module: "ring-cowbell", tempo: 70,
    description: "Low Tune, low Tone and a long Decay turn the cowbell into a muted, tolling bell. Raise Tone for a brighter strike.",
    tags: ["cowbell","dark","toll","slow"],
  });
  return drums(p, ["X.......x.......","......x.........","",""], [{"t":"ring-cowbell","v":{"level":0.85,"tune":-9,"decay":1.5,"tone":0.1},"tr":1,"name":"Toll","db":-6,"pan":-0.1},{"t":"ring-cowbell","v":{"level":0.8,"tune":-2,"decay":1.2,"tone":0.2},"tr":2,"name":"Second Toll","db":-9,"pan":0.2}], {"verb":{"size":0.8,"decay":3.8,"mix":0.3},"gain":9.8});
}

function demo4() {
  const p = patch("Ring Cowbell: Bright Ping Line", {
    module: "ring-cowbell", tempo: 126,
    description: "Tone near the top and a short Decay give a sparkling pinged pulse over a driving kick. An LFO opens and closes Tone slowly.",
    tags: ["cowbell","bright","tone","synthpop"],
  });
  return drums(p, ["X...X...X...X...","x.xxx.x.xx.xxx.x","",""], [{"t":"ring-kick","v":{"level":0.8,"tune":54,"decay":0.4},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-cowbell","v":{"level":0.7,"tune":7,"decay":0.12,"tone":0.9},"tr":2,"name":"Ping","db":-10,"pan":0.2}], {"mods":[{"lfo":{"rate":0.1,"wave":"Triangle","polarity":"Unipolar"},"to":1,"knob":"tone","amt":0.6,"name":"Tone Sweep"}],"delay":{"sync":"Tempo","ratel":"1/8.","rater":"1/8","feedback":0.35,"highcut":5000,"mix":0.2},"gain":3.2});
}

function demo5() {
  const p = patch("Ring Cowbell: Bell And Clap Shuffle", {
    module: "ring-cowbell", tempo: 100,
    description: "A shuffled kit with a cowbell on the triplet-feel offbeats and a clap on two and four. Change the cowbell's Decay to move from dry tick to long clang.",
    tags: ["cowbell","shuffle","groove","kit"],
  });
  return drums(p, ["X.....x...X.....","....x.......x...","..x.....x.....x.","x.xx.xx.xx.xx.x."], [{"t":"ring-kick","v":{"level":0.8,"tune":50},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.7},"tr":2,"name":"Clap","db":-9,"pan":-0.1},{"t":"ring-cowbell","v":{"level":0.8,"tune":2,"decay":0.45,"tone":0.45},"tr":3,"name":"Bell","db":-9,"pan":0.25},{"t":"ring-hats","v":{"level":0.35},"tr":4,"open":4,"name":"Hats","db":-18,"pan":0.3}], {});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
