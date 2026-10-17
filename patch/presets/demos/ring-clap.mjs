// SPDX-License-Identifier: MIT
// Ring Clap: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Clap: Classic Handclap", {
    module: "ring-clap", tempo: 108,
    description: "The default clap on two and four over a steady kick and hat. Raise Bursts for a bigger group, or Spread for looser, more human timing.",
    tags: ["clap","classic","backbeat","kit"],
  });
  return drums(p, ["X...X...X...X...","....x.......x...","x.x.x.x.x.x.x.x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.8},"tr":2,"name":"Clap","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.45},"tr":3,"open":4,"name":"Hats","db":-14,"pan":0.3}], {"mods":[{"lfo":{"rate":0.1,"wave":"Triangle","polarity":"Unipolar"},"to":1,"knob":"spread","amt":0.6,"name":"Loosen"}]});
}

function demo2() {
  const p = patch("Ring Clap: Tight Snap", {
    module: "ring-clap", tempo: 124,
    description: "One burst with very small Spread turns the clap into a short, dry snap that sits on the offbeats. Raise Bursts one at a time to hear it turn back into a clap.",
    tags: ["clap","snap","tight","house"],
  });
  return drums(p, ["X...X...X...X...","....x..x....x...","..x...x...x...x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":54,"decay":0.4},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.8,"bursts":1,"spread":0.003,"decay":0.12,"tone":1800},"tr":2,"name":"Snap","db":-6,"pan":0},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-15,"pan":0.3}], {});
}

function demo3() {
  const p = patch("Ring Clap: Crowd Applause", {
    module: "ring-clap", tempo: 90,
    description: "Many bursts spread wide, a long Decay and a big room make a small crowd clapping along. Lower Bursts and Spread to shrink the crowd back to one pair of hands.",
    tags: ["clap","crowd","ambient","reverb"],
  });
  return drums(p, ["X.......x...x...","....x.......x...","",""], [{"t":"ring-kick","v":{"level":0.8,"tune":48,"decay":0.6},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.7,"bursts":6,"spread":0.03,"decay":0.9,"tone":1000},"tr":2,"name":"Crowd","db":-8,"pan":0}], {"verb":{"size":0.8,"decay":3,"mix":0.3},"gain":5.4});
}

function demo4() {
  const p = patch("Ring Clap: Bright To Dark Clap", {
    module: "ring-clap", tempo: 116,
    description: "A slow LFO sweeps the clap's Tone from dark to bright and back while a steady beat plays underneath. Turn Tone yourself to pick the colour you like.",
    tags: ["clap","tone","filter sweep","lfo"],
  });
  return drums(p, ["X...x..x..X.x...","..x.x...x.x.x..x","",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.8,"decay":0.2,"tone":1500},"tr":2,"name":"Clap","db":-6,"pan":0},{"t":"ring-clap","v":{"level":0.5,"decay":0.1,"bursts":2,"tone":2500},"tr":1,"name":"Second Clap","db":-12,"pan":-0.3}], {"mods":[{"lfo":{"rate":0.1,"wave":"Triangle","polarity":"Unipolar"},"to":1,"knob":"tone","amt":0.9,"name":"Tone Sweep"}]});
}

function demo5() {
  const p = patch("Ring Clap: Clap Echo Roll", {
    module: "ring-clap", tempo: 128,
    description: "A rolling sixteenth-note clap feeds a tempo-synced delay for a swirling, rhythmic texture. Change Bursts and Decay to alter how dense each hit is.",
    tags: ["clap","roll","delay","fill"],
  });
  return drums(p, ["X...X...X...X...","x.x..x.x.x..x.xx","..x...x...x...x.",""], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.7,"bursts":3,"decay":0.14,"tone":1400},"tr":2,"name":"Roll","db":-9,"pan":0},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"delay":{"sync":"Tempo","ratel":"1/8.","rater":"1/8","mode":"Ping-Pong","feedback":0.4,"highcut":5000,"mix":0.25}});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
