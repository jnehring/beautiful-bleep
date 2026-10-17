// SPDX-License-Identifier: MIT
// Ring Kick: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Kick: Sub Boom", {
    module: "ring-kick", tempo: 72,
    description: "A very low Tune and a long Decay make a round sub kick that rings into the next hit, with a soft hat on top. Push Decay up or Tone down and watch the thump turn into a long boom.",
    tags: ["kick","sub","slow","deep"],
  });
  return drums(p, ["X.......x..x....","","..x...x...x...x.",""], [{"t":"ring-kick","v":{"tune":36,"decay":1.6,"sweep":0.2,"tone":0.15,"level":0.9},"tr":1,"name":"Sub Kick","db":-4},{"t":"ring-hats","v":{"level":0.5},"tr":3,"open":4,"name":"Hats","db":-16,"pan":0.3}], {"mods":[{"lfo":{"rate":0.05,"wave":"Triangle","polarity":"Unipolar"},"to":0,"knob":"decay","amt":0.3,"name":"Decay Drift"}],"verb":{"size":0.5,"decay":1.8,"mix":0.12}});
}

function demo2() {
  const p = patch("Ring Kick: Four On The Floor", {
    module: "ring-kick", tempo: 124,
    description: "A tight, punchy kick on every beat with off-beat open hats and a clap on two and four. A slow Movement LFO sweeps the kick's Tone; also try Sweep for more or less pitch drop.",
    tags: ["kick","house","dance","four on the floor"],
  });
  return drums(p, ["X...X...X...X...","","....x.......x...","..X...X...X...X."], [{"t":"ring-kick","v":{"tune":54,"decay":0.4,"sweep":0.5,"tone":0.35,"level":0.85},"tr":1,"name":"Floor Kick","db":-4},{"t":"ring-snare","v":{"tune":260,"tone":0.7,"snappy":0.9,"decay":0.15,"level":0.5},"tr":3,"name":"Snap","db":-10,"pan":-0.1},{"t":"ring-hats","v":{"level":0.5,"closed":0.04},"tr":2,"open":4,"name":"Hats","db":-14,"pan":0.3}], {"mods":[{"lfo":{"rate":0.12,"wave":"Triangle","polarity":"Unipolar"},"to":0,"knob":"tone","amt":0.5,"name":"Tone Sweep"}]});
}

function demo3() {
  const p = patch("Ring Kick: Driven Break", {
    module: "ring-kick", tempo: 94,
    description: "Drive adds a gritty edge and a hard Tone makes the kick cut through a broken-beat groove. An LFO breathes the Drive up and down; try setting it to zero for the clean version.",
    tags: ["kick","drive","breakbeat","gritty"],
  });
  return drums(p, ["X..x..x...X..x..","....X..x....X...","x.xxx...x.xxx...",""], [{"t":"ring-kick","v":{"tune":58,"decay":0.3,"sweep":0.6,"tone":0.65,"drive":0.6,"level":0.75},"tr":1,"name":"Gritty Kick","db":-5},{"t":"ring-snare","v":{"level":0.6},"tr":2,"name":"Snare","db":-8,"pan":0.05},{"t":"ring-hats","v":{"level":0.45},"tr":3,"open":4,"name":"Hats","db":-14,"pan":0.3}], {"mods":[{"lfo":{"rate":0.2,"wave":"Triangle","polarity":"Unipolar"},"to":0,"knob":"drive","amt":0.4,"name":"Drive Breath"}]});
}

function demo4() {
  const p = patch("Ring Kick: Tuned Kick Trio", {
    module: "ring-kick", tempo: 100,
    description: "Three Ring Kicks at different Tunes play a bass-drum line like a bass instrument: low, middle and high notes of the same family. Change the Tune knobs to retune the whole line.",
    tags: ["kick","tuned","bass","pattern"],
  });
  return drums(p, ["X.......X.......","..x...x...x...x.",".......x..x..x..",""], [{"t":"ring-kick","v":{"tune":40,"decay":0.9,"sweep":0.25,"tone":0.2},"tr":1,"name":"Low","db":-5},{"t":"ring-kick","v":{"tune":52,"decay":0.5,"sweep":0.35,"tone":0.3},"tr":2,"name":"Mid","db":-7},{"t":"ring-kick","v":{"tune":70,"decay":0.3,"sweep":0.5,"tone":0.4},"tr":3,"name":"High","db":-9},{"t":"ring-hats","v":{"level":0.4},"tr":4,"open":4,"name":"Hats","db":-18,"pan":0.3}], {"delay":{"timel":250,"timer":375,"feedback":0.3,"highcut":4000,"mix":0.15},"gain":3.3});
}

function demo5() {
  const p = patch("Ring Kick: Dub Echo Room", {
    module: "ring-kick", tempo: 82,
    description: "A sparse kick with a soft Tone is thrown into a feedback delay and a roomy reverb, so every hit leaves a trail. Change the delay Feedback or the kick's Decay to fill or empty the space.",
    tags: ["kick","dub","echo","space"],
  });
  return drums(p, ["X.......x.......","","....X.......X...",""], [{"t":"ring-kick","v":{"tune":46,"decay":0.7,"sweep":0.35,"tone":0.25,"level":0.8},"tr":1,"name":"Dub Kick","db":-4},{"t":"ring-clap","v":{"tone":900,"decay":0.4,"level":0.6},"tr":3,"name":"Clap","db":-10,"pan":0.1}], {"delay":{"sync":"Tempo","ratel":"1/8.","rater":"1/4","feedback":0.55,"highcut":3000,"lowcut":120,"mix":0.3},"verb":{"size":0.6,"decay":3,"mix":0.2},"gain":7.8});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
