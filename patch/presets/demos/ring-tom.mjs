// SPDX-License-Identifier: MIT
// Ring Tom: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Tom: Rolling Toms", {
    module: "ring-tom", tempo: 104,
    description: "Three toms from low to high roll around the kit over a steady kick and snare. Retune each with Tune; more Bend gives each hit a longer dive.",
    tags: ["tom","fill","kit","rock"],
  });
  return drums(p, ["X.......X.......","....x.......x...",".......x..xx....",".....x..x...xxx."], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-tom","v":{"level":0.8,"tune":90,"decay":0.5},"tr":3,"name":"Floor Tom","db":-6,"pan":-0.3},{"t":"ring-tom","v":{"level":0.8,"tune":130,"decay":0.4},"tr":4,"name":"Mid Tom","db":-6,"pan":0.3},{"t":"ring-snare","v":{"level":0.6},"tr":2,"name":"Snare","db":-9,"pan":0.05}], {});
}

function demo2() {
  const p = patch("Ring Tom: Conga Groove", {
    module: "ring-tom", tempo: 100,
    description: "High Tune, short Decay and almost no Bend make a hand-drum pair. Raise Noise for more slap, or lower Tune for a bigger drum.",
    tags: ["tom","conga","latin","hand drum"],
  });
  return drums(p, ["x..x..x.x..x..x.","..x..x.x..x.x.x.","X.......x...x...",""], [{"t":"ring-tom","v":{"level":0.8,"tune":280,"decay":0.18,"bend":0.1,"noise":0.35},"tr":1,"name":"High Conga","db":-6,"pan":0.3},{"t":"ring-tom","v":{"level":0.8,"tune":200,"decay":0.22,"bend":0.12,"noise":0.3},"tr":2,"name":"Low Conga","db":-6,"pan":-0.3},{"t":"ring-hats","v":{"level":0.4},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"verb":{"size":0.4,"decay":1.2,"mix":0.12},"gain":7});
}

function demo3() {
  const p = patch("Ring Tom: Deep Floor Tom", {
    module: "ring-tom", tempo: 76,
    description: "A huge slow floor tom with lots of Bend and a long Decay carries a tribal pulse. Bend sets how far the pitch falls on each hit; try pulling it to zero.",
    tags: ["tom","tribal","deep","slow"],
  });
  return drums(p, ["X.....x.X.......","........x.x.....","",""], [{"t":"ring-tom","v":{"level":0.8,"tune":66,"decay":1.3,"bend":0.7,"noise":0.2},"tr":1,"name":"Floor Tom","db":-4,"pan":0},{"t":"ring-tom","v":{"level":0.8,"tune":98,"decay":0.8,"bend":0.5,"noise":0.2},"tr":2,"name":"Rack Tom","db":-7,"pan":0.2}], {"verb":{"size":0.7,"decay":2.8,"mix":0.25},"mods":[{"lfo":{"rate":0.05,"wave":"Triangle","polarity":"Unipolar"},"to":0,"knob":"bend","amt":0.3,"name":"Bend Drift"}]});
}

function demo4() {
  const p = patch("Ring Tom: Electro Tom Zaps", {
    module: "ring-tom", tempo: 118,
    description: "Full Bend and no Noise turn the toms into pitch-diving electronic zaps. An LFO moves the Bend amount; try more or less Noise to put the drum back in.",
    tags: ["tom","electro","zap","bend"],
  });
  return drums(p, ["X...x..x..X.x...","..x.....x.x...xx","....X.......X...",""], [{"t":"ring-kick","v":{"level":0.8,"tune":56},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-tom","v":{"level":0.8,"tune":300,"decay":0.35,"bend":0.9,"noise":0},"tr":2,"name":"Zap","db":-7,"pan":0.3},{"t":"ring-tom","v":{"level":0.8,"tune":180,"decay":0.3,"bend":0.8,"noise":0.05},"tr":3,"name":"Lower Zap","db":-7,"pan":-0.3}], {"mods":[{"lfo":{"rate":0.15,"wave":"Triangle","polarity":"Unipolar"},"to":1,"knob":"bend","amt":0.4,"name":"Bend Sweep"}],"delay":{"timel":240,"timer":360,"feedback":0.3,"highcut":5000,"mix":0.15}});
}

function demo5() {
  const p = patch("Ring Tom: Tuned Tom Melody", {
    module: "ring-tom", tempo: 92,
    description: "Four toms tuned to a pentatonic scale play a pattern that sounds like a marimba made of drums. Retune any of them with Tune to change the scale.",
    tags: ["tom","melodic","tuned","pentatonic"],
  });
  return drums(p, ["x.x...x.x...x...","..x.x...x.x...x.","....x.x...x.x...","x.....x.....x.x."], [{"t":"ring-tom","v":{"level":0.8,"tune":147,"decay":0.45,"bend":0.15,"noise":0.15},"tr":1,"name":"Tom A","db":-7,"pan":-0.4},{"t":"ring-tom","v":{"level":0.8,"tune":165,"decay":0.45,"bend":0.15,"noise":0.15},"tr":2,"name":"Tom B","db":-7,"pan":-0.1},{"t":"ring-tom","v":{"level":0.8,"tune":196,"decay":0.45,"bend":0.15,"noise":0.15},"tr":3,"name":"Tom C","db":-7,"pan":0.2},{"t":"ring-tom","v":{"level":0.8,"tune":220,"decay":0.45,"bend":0.15,"noise":0.15},"tr":4,"name":"Tom D","db":-7,"pan":0.4}], {"verb":{"size":0.6,"decay":2.2,"mix":0.2},"gain":3.2});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
