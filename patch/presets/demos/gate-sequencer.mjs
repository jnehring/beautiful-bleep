// SPDX-License-Identifier: MIT
// Gate Sequencer: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// Gate Sequencer data: up to four 32-step tracks as strings. `.` off, `x` hit, `X` accent, `o` ghost,
/// `?` coin-flip hit, `2`/`3` ratchets (3 speeds up), `~` hit on the first of every two passes (1:2),
/// `!` hit only while Fill is held, `-` hit only while Fill is NOT held, `_` a tie from the previous hit.
function gateTracks(rows, nudges = []) {
  const step = (ch) => {
    const s = { on: 0, p: 100, l: 50, t: 0, r: 1, rs: 0, n: 0, c: [0, 0], v: 100 };
    switch (ch) {
      case "x": Object.assign(s, { on: 1, v: 96 }); break;
      case "X": Object.assign(s, { on: 1, v: 124 }); break;
      case "o": Object.assign(s, { on: 1, v: 48 }); break;
      case "?": Object.assign(s, { on: 1, p: 45, v: 80 }); break;
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
  const tracks = [];
  for (let t = 0; t < 4; t++) {
    const row = (rows[t] || "").padEnd(32, ".");
    const steps = [...row].slice(0, 32).map(step);
    for (const [i, n] of Object.entries(nudges[t] || {})) steps[i].n = n;
    tracks.push({ mute: false, steps });
  }
  return { tracks };
}

/// Oscillator → ADSR → VCA from a pitch and gate source, optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger) p.cable(src.node, src.trigger, env, "retrig");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);

// ------------------------------------------------------------ patches

function brokenBeat() {
  const p = patch("Gate Sequencer: Broken Beat", {
    module: "gate-sequencer", tempo: 88,
    description: "Four tracks play a kick, snare, hats and a rim: ghost notes, coin-flip hits, ratchets and a little Swing make a loose, breathing beat that changes a bit every loop. Lower a track's Chance, or pick Dice = Fixed, to tighten it.",
    tags: ["drums", "probability", "ratchet", "swing"],
  });
  const seq = p.add("gate-sequencer", [0, 1], { swing: 0.57, ratchetdecay: 0.35, chance3: 1, dice: "Repeat every 4", seed: 12 }, {
    data: gateTracks([
      "X.....o.....x?..X......o..x.....",
      "....X.......X..o....X......o.X.?.",
      "x.xox.x2x.xox.x3x.xox.x2x.xox.x3",
      "..?...........?.....~.?.....o...",
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 52, decay: 0.55, level: 0.85 });
  const snare = p.add("punch-snare", [1, 1], { tune: 190, snappy: 0.55, level: 0.7 });
  const hats = p.add("punch-hats", [1, 2], { closed: 0.04, crunch: 0.25, level: 0.6 });
  const rim = p.add("ring-rim", [1, 3], { level: 0.55 });
  p.cable(seq, "trig1", kick, "trig").cable(seq, "vel1", kick, "velocity")
    .cable(seq, "trig2", snare, "trig").cable(seq, "vel2", snare, "velocity")
    .cable(seq, "trig3", hats, "closed").cable(seq, "vel3", hats, "velocity")
    .cable(seq, "trig4", rim, "trig").cable(seq, "vel4", rim, "velocity");
  const mix = p.add("audio-mixer", [3, 1], { level1: -3, level2: -5, pan2: 0.1, level3: -11, pan3: 0.3, level4: -9, pan4: -0.3,
    send2: -14, send4: -10, return: -5, master: -4 }, { name: "Kit" });
  p.cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hats, "out", mix, "in3l").cable(rim, "out", mix, "in4l");
  const room = p.add("reverb", [4, 2], { size: 0.3, decay: 0.9, damping: 0.6, mix: 1 });
  p.cable(mix, "sendl", room, "l").cable(mix, "sendr", room, "r").stereo(room, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function bellCycles() {
  const p = patch("Gate Sequencer: Bell Cycles", {
    module: "gate-sequencer", tempo: 84,
    description: "Four tracks of different Lengths (5, 7, 9 and 11 steps) each strike their own bell in A minor pentatonic, so the chord of bells slowly rearranges itself. Change a Length by one step and the whole weave shifts.",
    tags: ["polyrhythm", "bells", "lengths", "ambient"],
  });
  const seq = p.add("gate-sequencer", [0, 1], { length1: 5, length2: 7, length3: 9, length4: 11,
    rate1: "1/8", rate2: "1/8", rate3: "1/8", rate4: "1/8", dice: "Fixed" }, {
    data: gateTracks(["x..x.", "X....o.", "x..o..x..", "o...x..?...."]),
  });
  const mix = p.add("audio-mixer", [3, 1], { level1: -6, pan1: -0.5, level2: -7, pan2: -0.15, level3: -7, pan3: 0.2, level4: -8, pan4: 0.55,
    send1: -9, send2: -9, send3: -9, send4: -9, return: -3, master: -8 }, { name: "Bells" });
  [-3, 4, 9, 12].forEach((coarse, i) => {
    const bell = p.add("modal-voice", [1, i], { strike: 1, strikeTimbre: 0.7, geometry: 0.8, brightness: 0.65, damping: 0.2, position: 0.3,
      size: 0.35, space: 0.2, coarse }, { name: `Bell ${i + 1}` });
    p.cable(seq, `trig${i + 1}`, bell, "strike").cable(seq, `vel${i + 1}`, bell, "velocity").stereo(bell, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const verb = p.add("reverb", [4, 2], { size: 0.8, decay: 6, damping: 0.35, modDepth: 0.35, mix: 1 });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function fourNoteBass() {
  const p = patch("Gate Sequencer: Four-Note Bass", {
    module: "gate-sequencer", tempo: 118,
    description: "Each track owns a Note (A1, C2, E2, G2) and its own rhythm of hits, ties and ratchets; the Notes output merges them into one bass line that drives a mono voice. Change a track's Note setting to re-tune its part of the line.",
    tags: ["bass", "notes", "ratchet", "groove"],
  });
  const seq = p.add("gate-sequencer", [0, 1], { note1: 33, note2: 36, note3: 40, note4: 43, ratchetdecay: 0.25, swing: 0.54, dice: "Fixed" }, {
    data: gateTracks([
      "X__.x...x.x.....X__.x...x..x.x..",
      "......x.......X.......x.....2...",
      "..........x.......x.........x...",
      "..............x.........x....3..",
    ]),
  });
  const cv = p.add("notes-to-cv", [1, 1], { glide: 0.04 });
  p.cable(seq, "notes", cv, "notes");
  const bass = voice(p, [2, 0], { node: cv, trigger: "trigger" }, { name: "Bass", osc: { shape: 0.9, octave: "0" },
    env: { decay: 0.2, sustain: 0.5, release: 0.1 }, filter: { cutoff: 420, resonance: 0.35, drive: 0.15 } });
  const fenv = p.add("adsr", [2, 2], { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.15 }, { name: "Filter Env" });
  p.cable(cv, "gate", fenv, "gate").cable(cv, "trigger", fenv, "retrig").cable(fenv, "env", bass.filter, "cutoff", 0.5);
  const drums = beat(p, [0, 3], { style: "half", level: -10 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 0, level2: -2, master: 0 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function chanceRain() {
  const p = patch("Gate Sequencer: Chance Rain", {
    module: "gate-sequencer", tempo: 76,
    description: "Every step of four tracks is armed, and slow LFOs on the Chance knobs decide how many of them fire: glassy D-minor drops thicken into a downpour and thin out again, each track on its own cycle. Turn a Chance knob by hand to hear one track's density.",
    tags: ["chance", "generative", "ambient", "glass"],
  });
  const seq = p.add("gate-sequencer", [0, 1], { rate1: "1/8", rate2: "1/16", rate3: "1/8.", rate4: "1/4", length1: 16, length2: 16, length3: 12, length4: 8,
    chance1: 0.55, chance2: 0.3, chance3: 0.5, chance4: 0.6, dice: "New every loop", seed: 31 }, {
    data: gateTracks(["xxxxxxxxxxxxxxxx", "oooooooooooooooo", "xxxxxxxxxxxx", "xxxxxxxx"]),
  });
  const mix = p.add("audio-mixer", [3, 1], { level1: -7, pan1: -0.45, level2: -12, pan2: 0.4, level3: -8, pan3: 0.1, level4: -7, pan4: 0.6,
    send1: -8, send2: -8, send3: -8, send4: -8, return: -3, master: -11 }, { name: "Drops" });
  const rates = [0.031, 0.047, 0.023, 0.037];
  [2, 9, 4, 14].forEach((coarse, i) => {
    const drop = p.add("modal-voice", [1, i], { strike: 1, strikeTimbre: 0.8, geometry: 0.9 - i * 0.1, brightness: 0.75, damping: 0.1, position: 0.4,
      size: 0.3, space: 0.3, coarse: coarse + (i === 1 ? 12 : 0) }, { name: `Drop ${i + 1}` });
    const lfo = p.add("lfo", [0, 3 + i], { rate: rates[i], phase: i * 90 }, { name: `Rain ${i + 1}` });
    p.cable(seq, `trig${i + 1}`, drop, "strike").cable(seq, `vel${i + 1}`, drop, "velocity").cable(lfo, "out", seq, `chance${i + 1}`, 0.45)
      .stereo(drop, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const delay = p.add("zone-delay", [4, 1], { zone: 3, time: 0.5, feedback: 0.5, character: 0.3, tone: -0.3, mix: 1 });
  const verb = p.add("reverb", [4, 2], { size: 0.85, decay: 8, damping: 0.35, modDepth: 0.4, mix: 1 });
  p.cable(mix, "sendl", delay, "l").cable(mix, "sendr", delay, "r").stereo(delay, verb).stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function fillAndDrop() {
  const p = patch("Gate Sequencer: Fill and Drop", {
    module: "gate-sequencer", tempo: 126,
    description: "A four-on-the-floor groove where a slow square LFO holds Fill for the last bar of every four, switching in extra hits and ratchets, and another LFO on Mute 4 drops the percussion for a while. Hold the Fill button yourself, or mute tracks, to arrange it live.",
    tags: ["techno", "fill", "mute", "arrangement"],
  });
  const seq = p.add("gate-sequencer", [0, 1], { swing: 0.52, ratchetdecay: 0.2, dice: "Fixed" }, {
    data: gateTracks([
      "X...x...X...x...X...x...X...x..!",
      "....X.......X.......X.......X..!!",
      "..x...x.-.x...x.-.x...x.-.x...3!",
      "x..o..x.o..x..o.x..o..x.o..x.o.2",
    ]),
  });
  const fill = p.add("lfo", [0, 0], { wave: "Square", sync: "4 bars", pw: 0.25, phase: 270, polarity: "Unipolar" }, { name: "Fill Gate" });
  const drop = p.add("lfo", [0, 3], { wave: "Square", sync: "8 bars", pw: 0.5, phase: 180, polarity: "Unipolar" }, { name: "Percussion Mute" });
  p.cable(fill, "out", seq, "fill").cable(drop, "out", seq, "mute4");
  const kick = p.add("punch-kick", [1, 0], { tune: 48, decay: 0.45, drive: 0.3, level: 0.85 });
  const clap = p.add("punch-clap", [1, 1], { level: 0.55, decay: 0.3 });
  const hats = p.add("punch-hats", [1, 2], { closed: 0.035, tone: 0.6, level: 0.5 });
  const bell = p.add("ring-cowbell", [1, 3], { tune: 3, decay: 0.12, level: 0.35 });
  p.cable(seq, "trig1", kick, "trig").cable(seq, "vel1", kick, "velocity")
    .cable(seq, "trig2", clap, "trig").cable(seq, "vel2", clap, "velocity")
    .cable(seq, "trig3", hats, "closed").cable(seq, "vel3", hats, "velocity")
    .cable(seq, "trig4", bell, "trig").cable(seq, "vel4", bell, "velocity");
  const mix = p.add("audio-mixer", [3, 1], { level1: -3, level2: -8, pan2: 0.1, level3: -12, pan3: 0.3, level4: -14, pan4: -0.3,
    send2: -12, send4: -8, return: -6, master: -4 }, { name: "Kit" });
  p.cable(kick, "out", mix, "in1l").cable(clap, "out", mix, "in2l").cable(hats, "out", mix, "in3l").cable(bell, "out", mix, "in4l");
  const room = p.add("reverb", [4, 2], { size: 0.4, decay: 1.4, damping: 0.5, mix: 1 });
  p.cable(mix, "sendl", room, "l").cable(mix, "sendr", room, "r").stereo(room, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [brokenBeat, bellCycles, fourNoteBass, chanceRain, fillAndDrop];
