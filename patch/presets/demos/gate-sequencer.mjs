// SPDX-License-Identifier: MIT
// Gate Sequencer: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";

const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator -> ADSR -> VCA (optional filter), played by a pitch jack and a gate jack: [node, jack] pairs.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.6, octave: oct(o.octave ?? 0), ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.004, decay: 0.3, sustain: 0, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  if (pitch) p.cable(pitch[0], pitch[1], osc, "pitch", pitch[2] ?? 1);
  p.cable(gate[0], gate[1], env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (o.retrig) p.cable(o.retrig[0], o.retrig[1], env, "retrig");
  if (!o.filter) return { osc, env, amp, out: amp, jack: "l" };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter, jack: "l" };
}
/// Up to eight mono sources into one stereo mix. list: {node, jack, level, pan}.
function bus(p, at, list, master = -3, name = "Mix") {
  const [c, r] = at;
  const mk = (items, col, row, nm, m) => {
    const vals = { master: m };
    items.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -6; vals[`pan${i + 1}`] = x.pan ?? 0; });
    const mx = p.add("audio-mixer", [col, row], vals, { name: nm });
    items.forEach((x, i) => p.cable(x.node, x.jack || "out", mx, `in${i + 1}l`));
    return mx;
  };
  if (list.length <= 4) return mk(list, c, r, name, master);
  const a = mk(list.slice(0, 4), c, r, `${name} A`, 0), b = mk(list.slice(4), c, r + 1, `${name} B`, 0);
  const fin = p.add("audio-mixer", [c + 1, r], { level1: 0, level2: 0, master }, { name });
  p.stereo(a, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(b, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return fin;
}
/// Mono jack to both sides of a stereo input pair.
const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);
/// A reverb after a stereo mixer (outl/outr) and then the patch output.
function finish(p, mixer, at, verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.4, mix: 0.15, ...verb });
  p.stereo(mixer, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

/// Gate Sequencer data: four 32-step tracks as strings. `.` off, `x` hit, `X` accent, `o` ghost, `?` coin-flip hit,
/// `2`/`3` ratchets (3 runs faster), `~` every other pass, `!` only while Fill is held, `-` only while Fill is not held,
/// `_` tie. `nudges[t]` maps a step index to a nudge in percent of a step.
function gateTracks(rows, nudges = [], len = [50, 50, 50, 50]) {
  const step = (ch, l) => {
    const s = { on: 0, p: 100, l, t: 0, r: 1, rs: 0, n: 0, c: [0, 0], v: 100 };
    switch (ch) {
      case "x": Object.assign(s, { on: 1, v: 96 }); break;
      case "X": Object.assign(s, { on: 1, v: 124 }); break;
      case "o": Object.assign(s, { on: 1, v: 48 }); break;
      case "?": Object.assign(s, { on: 1, p: 50, v: 80 }); break;
      case "2": Object.assign(s, { on: 1, r: 2, v: 90 }); break;
      case "3": Object.assign(s, { on: 1, r: 3, rs: 1, v: 90 }); break;
      case "~": Object.assign(s, { on: 1, v: 90, c: [1, 12] }); break;
      case "!": Object.assign(s, { on: 1, v: 110, c: [4, 0] }); break;
      case "-": Object.assign(s, { on: 1, v: 96, c: [5, 0] }); break;
      case "_": Object.assign(s, { on: 1, t: 1, v: 96 }); break;
      default: break;
    }
    return s;
  };
  return { tracks: [0, 1, 2, 3].map((t) => {
    const steps = [...(rows[t] || "").padEnd(32, ".").slice(0, 32)].map((ch) => step(ch, len[t]));
    for (const [i, n] of Object.entries(nudges[t] || {})) steps[i].n = n;
    return { mute: false, steps };
  }) };
}

/// Four punch drums on the sequencer's trigger/velocity outputs (kick, snare, hats, tom or clap), mixed.
function kit(p, gs, at, o = {}) {
  const [c, r] = at;
  const kick = p.add("punch-kick", [c, r], { level: 0.85, decay: 0.5, ...(o.kick || {}) });
  const snare = p.add("punch-snare", [c, r + 1], { level: 0.65, snappy: 0.65, ...(o.snare || {}) });
  const hats = p.add("punch-hats", [c, r + 2], { level: 0.5, closed: 0.04, ...(o.hats || {}) });
  const fourth = o.fourthType ? p.add(o.fourthType, [c, r + 3], { level: 0.55, ...(o.fourth || {}) }) : null;
  p.cable(gs, "trig1", kick, "trig").cable(gs, "vel1", kick, "velocity").cable(gs, "trig2", snare, "trig").cable(gs, "vel2", snare, "velocity")
    .cable(gs, "trig3", hats, "closed").cable(gs, "vel3", hats, "velocity");
  const list = [{ node: kick, level: -3 }, { node: snare, level: -6, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 }];
  if (fourth) { p.cable(gs, "trig4", fourth, "trig"); list.push({ node: fourth, level: o.fourthLevel ?? -9, pan: -0.3 }); }
  return bus(p, [c + 2, r], list, o.master ?? -1, "Drum Mix");
}

function looseBeat() {
  const p = patch("Gate Sequencer: Loose Probability Beat", {
    module: "gate-sequencer", tempo: 92,
    description: "Coin-flip steps (?) and quiet ghost notes (o) make a drum pattern that breathes differently on every pass; Swing adds a lazy lean. Turn a track's Chance knob down for fewer hits, or set Dice to Fixed to lock one version in.",
    tags: ["probability", "ghost notes", "swing", "drums"],
  });
  const gs = p.add("gate-sequencer", [0, 0], { swing: 0.57, dice: "Repeat every 4", seed: 5, chance3: 0.9 }, { data: gateTracks([
    "X.....?.o.X.....X.....?.o.X..?..", "....X..o....X.?.....X..o....X..?", "x.xox.x?x.xox.x?x.xox.x?x.xox.xo", "..?...........?...?...........?."]) });
  const mix = kit(p, gs, [2, 0], { fourthType: "punch-clap", fourth: { level: 0.4 } });
  finish(p, mix, [4, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function ratchets() {
  const p = patch("Gate Sequencer: Ratchet Rolls", {
    module: "gate-sequencer", tempo: 104,
    description: "Steps marked 2 and 3 fire quick repeats inside one step: two on the snare, a rising run of three on the hats. Ratchet Decay fades each repeat out, so try raising it for a bouncing-ball feel.",
    tags: ["ratchet", "rolls", "repeats", "drums"],
  });
  const gs = p.add("gate-sequencer", [0, 0], { ratchetdecay: 0.45, swing: 0.52 }, { data: gateTracks([
    "X.......X.x.....X.......X..x....", "....X.......X2......X.......X..3", "x.x.x.3.x.x.x.x3x.x.x.3.x.x.x.x2", "......2.........2...........3..."]) });
  const mix = kit(p, gs, [2, 0], { fourthType: "punch-tom", fourth: { tune: 180 }, hats: { crunch: 0.5 } });
  finish(p, mix, [4, 0], { size: 0.25, decay: 0.9, mix: 0.1 });
  return p;
}

function phasing() {
  const p = patch("Gate Sequencer: Phasing Plucks", {
    module: "gate-sequencer", tempo: 100,
    description: "Four tracks of different lengths (3, 4, 5 and 7 steps) each pluck one note of a chord, so the pattern only realigns after 420 steps and keeps shifting shape. Change a Length setting by one to get a different cycle.",
    tags: ["polyrhythm", "lengths", "plucks", "minimalism"],
  });
  const gs = p.add("gate-sequencer", [0, 0], { length1: 3, length2: 4, length3: 5, length4: 7, rate1: "1/8", rate2: "1/8", rate3: "1/8", rate4: "1/8", dice: "Fixed" },
    { data: gateTracks(["x.x", "x...", "x.x..", "x..x..."], [], [60, 60, 60, 60]) });
  const notes = [-12, -5, 0, 4];
  const vs = notes.map((n, i) => voice(p, [2, i * 2], null, [gs, `gate${i + 1}`], { name: `Pluck ${i + 1}`, shape: 0.35 + i * 0.1, osc: { coarse: n },
    env: { attack: 0.01, decay: 0.9, sustain: 0.25, release: 0.7 }, octave: 0 }));
  const mix = bus(p, [5, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: 0, pan: -0.6 + i * 0.4 })), 3, "Plucks");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.4, mix: 0.3, highcut: 5000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.5, decay: 2.5, mix: 0.25 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

function fillSwitch() {
  const p = patch("Gate Sequencer: Fill Switch", {
    module: "gate-sequencer", tempo: 112,
    description: "Steps marked ! only play while the Fill input is high and steps marked - only while it is low, so a square LFO that holds Fill for the last bar of every four swaps the main beat for a busy fill. Some steps are nudged early or late for a human feel; Nudge Depth scales them all.",
    tags: ["fill", "conditions", "nudge", "drums"],
  });
  const gs = p.add("gate-sequencer", [0, 0], { nudgedepth: 0.8, swing: 0.5 }, { data: gateTracks([
    "X.-.-.x.X.-.-.x.X.-.-.x.X.-.-.x.", "....X.......X.......X.......X...", "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.", "......!.!.!!!.!!......!.!.!!!!!!"],
    [{ 6: -15, 14: 12 }, { 12: 15 }, { 3: 8, 11: -10 }, {}]), });
  const lfo = p.add("lfo", [0, 3], { wave: "Square", sync: "4 bars", pw: 0.25, polarity: "Unipolar", phase: 270 }, { name: "Fill Gate" });
  p.cable(lfo, "out", gs, "fill");
  const mix = kit(p, gs, [2, 0], { fourthType: "punch-tom", fourth: { tune: 120 } });
  finish(p, mix, [4, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function arrangement() {
  const p = patch("Gate Sequencer: Mute Arrangement", {
    module: "gate-sequencer", tempo: 120,
    description: "Slow square LFOs patched into the Mute inputs bring the four tracks in and out on their own cycles of 2, 4 and 8 bars, so a simple pattern arranges itself. Patch a different LFO Sync into a mute jack to rewrite the structure.",
    tags: ["mute", "arrangement", "structure", "automation"],
  });
  const gs = p.add("gate-sequencer", [0, 0], { dice: "Fixed" }, { data: gateTracks([
    "X...X...X...X..xX...X...X...X.xx", "....X.......X.......X.......X..o", "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.", "..x..x..x...x..x..x..x..x...x..."]) });
  const l2 = p.add("lfo", [0, 3], { wave: "Square", sync: "4 bars", pw: 0.5, polarity: "Unipolar" }, { name: "Snare Mute" });
  const l3 = p.add("lfo", [0, 4], { wave: "Square", sync: "8 bars", pw: 0.75, polarity: "Unipolar" }, { name: "Hat Mute" });
  const l4 = p.add("lfo", [1, 3], { wave: "Square", sync: "2 bars", pw: 0.5, polarity: "Unipolar" }, { name: "Clap Mute" });
  p.cable(l2, "out", gs, "mute2").cable(l3, "out", gs, "mute3").cable(l4, "out", gs, "mute4");
  const mix = kit(p, gs, [2, 0], { fourthType: "punch-rim", fourth: { tune: 3 }, fourthLevel: -10 });
  finish(p, mix, [4, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

export default [looseBeat, ratchets, phasing, fillSwitch, arrangement];
