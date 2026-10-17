// SPDX-License-Identifier: MIT
// Ring Cymbal: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Cymbal: Crash Accents", {
    module: "ring-cymbal", tempo: 108,
    description: "A crash on the first beat of every second bar carries the groove forward. Decay sets how long it rings; Tone moves the brightness.",
    tags: ["cymbal","crash","accent","kit"],
  });
  return drums(p, ["X.......x.......","....x.......x...","x.x.x.x.x.x.x.x.","X..............."], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"level":0.6},"tr":2,"name":"Snare","db":-9,"pan":0.05},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":3,"name":"Hats","db":-16,"pan":0.3},{"t":"ring-cymbal","v":{"level":0.7,"decay":2.5,"tone":0.5},"tr":4,"name":"Cymbal","db":-9,"pan":0.1}], {"gain":3.8});
}

function demo2() {
  const p = patch("Ring Cymbal: Ride Pattern", {
    module: "ring-cymbal", tempo: 130,
    description: "Short Decay and a higher Tone give a ride-like ping in a swinging pattern. Stretch Decay for a washy ride, shorten it for a stick-on-metal feel.",
    tags: ["cymbal","ride","jazz","short"],
  });
  return drums(p, ["X.......x.......","","x..xx..xx..xx..x",""], [{"t":"ring-kick","v":{"level":0.6,"tune":56,"decay":0.3},"tr":1,"name":"Kick","db":-9,"pan":0},{"t":"ring-cymbal","v":{"level":0.7,"decay":0.5,"tone":0.7,"tune":3},"tr":3,"name":"Ride","db":-7,"pan":0.25}], {"verb":{"size":0.4,"decay":1.2,"mix":0.1},"gain":13.6});
}

function demo3() {
  const p = patch("Ring Cymbal: Long Wash Swell", {
    module: "ring-cymbal", tempo: 66,
    description: "A very long Decay and a huge reverb let a single cymbal bloom into an ambient wash. Shorten Decay or the reverb to hear its hit.",
    tags: ["cymbal","wash","ambient","reverb"],
  });
  return drums(p, ["X...............","","",""], [{"t":"ring-cymbal","v":{"level":0.8,"decay":7,"tone":0.45},"tr":1,"name":"Wash","db":-7,"pan":0},{"t":"ring-kick","v":{"level":0.8,"tune":42,"decay":1.2},"tr":2,"name":"Kick","db":-8,"pan":0}], {"verb":{"size":0.9,"decay":6,"mix":0.3},"gain":15.5});
}

function demo4() {
  const p = patch("Ring Cymbal: Dark Gong Crash", {
    module: "ring-cymbal", tempo: 84,
    description: "Tune and Tone low give a gong-like clang with a slow shimmer. Raise either to move toward a bright crash.",
    tags: ["cymbal","dark","gong","cinematic"],
  });
  return drums(p, ["X.......x.......","........X.......","",""], [{"t":"ring-cymbal","v":{"level":0.8,"tune":-9,"decay":5,"tone":0.1},"tr":1,"name":"Gong","db":-7,"pan":0.1},{"t":"ring-kick","v":{"level":0.9,"tune":40,"decay":1.2},"tr":2,"name":"Kick","db":-6,"pan":0}], {"verb":{"size":0.8,"decay":4,"mix":0.25},"gain":5.5});
}

function demo5() {
  const p = patch("Ring Cymbal: Swelling Cymbal Drive", {
    module: "ring-cymbal", tempo: 122,
    description: "A steady dance beat with a cymbal on the off-beat whose Decay breathes in and out with an LFO. Open it up for a washy build, close it for tight tics.",
    tags: ["cymbal","lfo","build","dance"],
  });
  return drums(p, ["X...X...X...X...","","..x...x...x...x.","..x...x...x...x."], [{"t":"ring-kick","v":{"level":0.8,"tune":54,"decay":0.4},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-clap","v":{"level":0.6},"tr":2,"name":"Clap","db":-11,"pan":-0.1},{"t":"ring-cymbal","v":{"level":0.7,"decay":0.8,"tone":0.55},"tr":4,"name":"Cymbal","db":-10,"pan":0.1}], {"mods":[{"lfo":{"rate":0.1,"wave":"Triangle","polarity":"Unipolar"},"to":2,"knob":"decay","amt":0.7,"name":"Decay Breath"}]});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
