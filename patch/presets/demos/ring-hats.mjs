// SPDX-License-Identifier: MIT
// Ring Hats: five demo patches. Each plays by itself with the transport.
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
  const p = patch("Ring Hats: Open And Closed Groove", {
    module: "ring-hats", tempo: 110,
    description: "Closed hats on eighths with an open hat on the off-beat, which the next closed hat cuts off. Lengthen Open Decay to hear the wash, or shorten Closed Decay for a tighter tick.",
    tags: ["hats","open","closed","groove"],
  });
  return drums(p, ["X.......X.......","....x.......x...","x.xxx.xxx.xxx.xx","..x...x...x...x."], [{"t":"ring-kick","v":{"level":0.8,"tune":52},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"level":0.6},"tr":2,"name":"Snare","db":-9,"pan":0.05},{"t":"ring-hats","v":{"level":0.7,"closed":0.05,"open":0.5},"tr":3,"open":4,"name":"Hats","db":-8,"pan":0.2}], {"gain":2.7});
}

function demo2() {
  const p = patch("Ring Hats: Sixteenth Shimmer", {
    module: "ring-hats", tempo: 128,
    description: "Fast sixteenths with accents give a shimmering, rolling hat line. Raise Tone for a thinner, brighter sound or lower it for a darker one.",
    tags: ["hats","sixteenths","velocity","techno"],
  });
  return drums(p, ["X...X...X...X...","","XxxxXxxxXxxxXxxx","..x...x...x...x."], [{"t":"ring-kick","v":{"level":0.8,"tune":54,"decay":0.4},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-hats","v":{"level":0.7,"closed":0.04,"open":0.35,"tone":0.65},"tr":3,"open":4,"name":"Hats","db":-9,"pan":0.2}], {"mods":[{"lfo":{"rate":0.1,"wave":"Triangle","polarity":"Unipolar"},"to":1,"knob":"tone","amt":0.5,"name":"Tone Sweep"}]});
}

function demo3() {
  const p = patch("Ring Hats: Open Hat Wash", {
    module: "ring-hats", tempo: 90,
    description: "Only open hats with a very long Open Decay ring over a slow groove and a reverb. Pull Open Decay down to get back to a short sizzle.",
    tags: ["hats","open","wash","reverb"],
  });
  return drums(p, ["X.......X.......","........x.......","","..x...x...x...x."], [{"t":"ring-kick","v":{"level":0.8,"tune":48,"decay":0.6},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"level":0.55,"decay":0.3},"tr":2,"name":"Snare","db":-10,"pan":0.05},{"t":"ring-hats","v":{"level":0.7,"closed":0.04,"open":2.5,"tone":0.4},"tr":3,"open":4,"name":"Hats","db":-10,"pan":0.2}], {"verb":{"size":0.7,"decay":2.8,"mix":0.2},"gain":5.2});
}

function demo4() {
  const p = patch("Ring Hats: Two Tuned Hats", {
    module: "ring-hats", tempo: 120,
    description: "Two hats tuned a fourth apart interlock like a high and a low metal pair. Move each Tune to change the character from tinny to dark.",
    tags: ["hats","tune","layers","interlock"],
  });
  return drums(p, ["X...X...X...X...","x..x..x..x..x..x","..x.x...x.x...x.","x.xx.x.xx.x.xx.x"], [{"t":"ring-kick","v":{"level":0.8,"tune":54,"decay":0.4},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-hats","v":{"level":0.7,"tune":5,"closed":0.04,"open":0.3,"tone":0.6},"tr":2,"open":3,"name":"High Hat","db":-10,"pan":0.35},{"t":"ring-hats","v":{"level":0.7,"tune":-4,"closed":0.06,"open":0.4,"tone":0.4},"tr":4,"open":3,"name":"Low Hat","db":-10,"pan":-0.35}], {});
}

function demo5() {
  const p = patch("Ring Hats: Swung Hat Sweep", {
    module: "ring-hats", tempo: 96,
    description: "A lazy hat pattern with an LFO sweeping Tone, with a delay behind it. Change the Closed Decay for a looser or snappier feel.",
    tags: ["hats","swing","lfo","tone"],
  });
  return drums(p, ["X..x.x..X..x.x..","....X.......X...","x.xxx.xxx.xxx.xx","......x.......x."], [{"t":"ring-kick","v":{"level":0.8,"tune":50},"tr":1,"name":"Kick","db":-4,"pan":0},{"t":"ring-snare","v":{"level":0.6},"tr":2,"name":"Snare","db":-9,"pan":0.05},{"t":"ring-hats","v":{"level":0.7,"closed":0.08,"open":0.6},"tr":3,"open":4,"name":"Hats","db":-8,"pan":0.2}], {"mods":[{"lfo":{"rate":0.08,"wave":"Triangle","polarity":"Unipolar"},"to":2,"knob":"tone","amt":0.8,"name":"Tone Sweep"}],"delay":{"sync":"Tempo","ratel":"1/8.","rater":"1/16.","feedback":0.3,"highcut":7000,"mix":0.12}});
}

export default [demo1(), demo2(), demo3(), demo4(), demo5()];
