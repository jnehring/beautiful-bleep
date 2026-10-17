// monitor: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A mono voice: Oscillator -> VCA with its own ADSR. src: {n, pitch, gate, trig} (trig: false = no retrigger).
/// o: shape, osc (extra knobs), env, cutoff/res (adds a low-pass), name. Returns {osc, env, amp, out: {n, j}}.
function voice(p, at, src, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.7, ...(o.osc || {}) }, { name: o.name || "Source" });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.25, ...(o.env || {}) }, { name: o.envName || "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (src.pitch !== null) p.cable(src.pn || src.n, src.pitch || "pitch", osc, "pitch");
  p.cable(src.n, src.gate || "gate", env, "gate");
  if (src.trig !== false) p.cable(src.n, src.trig || "trigger", env, "retrig");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  let out = { n: amp, j: "l" }, flt;
  if (o.cutoff) {
    flt = p.add("filter", [c + 2, r], { cutoff: o.cutoff, resonance: o.res ?? 0.2, ...(o.flt || {}) }, { name: "Filter" });
    p.cable(amp, "l", flt, "l");
    out = { n: flt, j: "l" };
  }
  return { osc, env, amp, flt, out };
}

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
    for (const [n, j] of c.also || []) p.cable(n, j, mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

const line = (p, at, notes, o = {}) => p.add("step-sequencer", at, { length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
  octave: o.octave ?? 0, gatelength: o.gate ?? 0.5 }, { data: steps(notes, o.vel) }, { name: o.name || "Line" });

function noteTable() {
  const p = patch("Monitor: Note Table", {
    module: "monitor", tempo: 104,
    description: "The sequencer's notes pass through a Monitor on their way to a synth voice: its table lists each note on and off with pitch and velocity as it happens. Change a step's note or velocity in the sequencer and read the difference in the table.",
    tags: ["midi", "notes", "event table", "debug"],
  });
  const seq = line(p, [0, 0], [0, ".", 3, 5, 7, ".", 5, 3, 10, 7, ".", 5, 3, ".", 0, "."], { vel: [120, 80, 100, 70, 127, 90, 60, 100] });
  const mon = p.add("monitor", [1, 0], {}, { name: "Note Monitor" });
  p.cable(seq, "notes", mon, "notes");
  const n2c = p.add("notes-to-cv", [2, 0], {});
  p.cable(mon, "notes", n2c, "notes");
  const v = voice(p, [3, 0], { n: n2c }, { shape: 0.8, cutoff: 2600, env: { decay: 0.3, sustain: 0.1, release: 0.2 } });
  p.cable(n2c, "velocity", v.env, "velocity");
  const drums = beat(p, [0, 4], { style: "half", level: -10 });
  finish(p, [6, 0], [{ n: v.out.n, level: 4 }, drumsOf(drums, 3)], { vmix: 0.2, master: 2 });
  return p;
}

function cvReadout() {
  const p = patch("Monitor: Watch a Control Signal", {
    module: "monitor", tempo: 96,
    description: "A slow LFO runs through the Monitor's CV input before it sweeps the filter of a gentle line: the readout shows the value moving between its extremes while you hear the same thing. Change the LFO's rate or wave and watch the shape change.",
    tags: ["cv", "readout", "lfo", "filter"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.25, wave: "Triangle" }, { name: "Slow Sweep" });
  const mon = p.add("monitor", [1, 0], {}, { name: "CV Monitor" });
  p.cable(lfo, "out", mon, "cv");
  const m = melody(p, [0, 3], [0, 3, 7, 3, 5, 3, 7, 10], { rate: "1/8", root: "F", scale: "Dorian", octave: 0, shape: 0.9, gatelength: 0.7, env: { decay: 0.3, sustain: 0.4, release: 0.2 } });
  const flt = p.add("filter", [3, 3], { cutoff: 900, resonance: 0.45 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l").cable(mon, "cv", flt, "cutoff", 0.55);
  const drums = beat(p, [0, 6], { style: "sparse", level: -12 });
  finish(p, [5, 3], [{ n: flt, level: 4 }, drumsOf(drums, 2)], { vmix: 0.25, master: -5 });
  return p;
}

function gateWatch() {
  const p = patch("Monitor: Gate Meter on the Kick", {
    module: "monitor", tempo: 124,
    description: "The kick's gate from the Drum Grid goes through the Monitor's gate meter, which lights on every hit and shows how long the gate lasts, before it triggers the drum. Lengthen the Drum Grid's Gate Length and watch the meter stay lit.",
    tags: ["gate", "kick", "meter", "drum grid"],
  });
  const grid = p.add("drum-grid", [0, 0], { gatelength: 0.4 }, { data: drumGrid(["Kick", "Snare", "Hat", "", "", "", "", ""],
    [pattern("Four", ["X...x...X...x...", "....X.......X..x", "x.x.x.x.x.x.x.x.", "", "", "", "", ""])]) });
  const mon = p.add("monitor", [1, 0], {}, { name: "Gate Monitor" });
  p.cable(grid, "gate1", mon, "gate");
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.5 });
  p.cable(mon, "gate", kick, "trig").cable(grid, "gate2", snare, "trig").cable(grid, "gate3", hats, "closed");
  const bass = melody(p, [0, 4], [0, ".", 0, ".", ".", 0, 7, ".", 0, ".", 0, ".", 10, ".", 7, 5], { rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: -2, shape: 0.9, gatelength: 0.5, env: { decay: 0.2, sustain: 0.3, release: 0.1 } });
  finish(p, [4, 0], [{ n: kick, l: "out", level: -4 }, { n: snare, l: "out", level: -7 }, { n: hats, l: "out", level: -14, pan: 0.2 }, { n: bass.amp, level: 0 }], { vmix: 0.1, decay: 1.2, master: 0 });
  return p;
}

function audioFloor() {
  const p = patch("Monitor: Stereo Meter", {
    module: "monitor", tempo: 90,
    description: "A ping-pong delay bounces a pluck line left and right through the Monitor's audio meters, so you see the two channels take turns. Raise the Floor to see only the loud part, or lower Response to make the bars fall slowly.",
    tags: ["audio", "stereo", "ping-pong", "floor"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", 7, ".", ".", 5, ".", 3, ".", ".", 5, ".", ".", ".", "."], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 1, shape: 0.3, gatelength: 0.3, env: { decay: 0.35, sustain: 0, release: 0.2 } });
  const dl = p.add("delay", [3, 0], { timel: 333, timer: 333, feedback: 0.55, highcut: 4500, mix: 0.6, mode: "Ping-Pong", sync: "Tempo", ratel: "1/8.", rater: "1/8." });
  p.cable(m.amp, "l", dl, "l").cable(m.amp, "l", dl, "r");
  const mon = p.add("monitor", [4, 0], { response: 0.2, floor: "-48 dB" }, { name: "Stereo Monitor" });
  p.stereo(dl, mon);
  const pad = melody(p, [0, 3], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"], { rate: "1/2", root: "C", scale: "Major Pentatonic", octave: -1, shape: 0.5, gatelength: 1, env: { attack: 0.4, sustain: 0.7, release: 0.8 } });
  const out = p.add("audio-mixer", [5, 0], { level1: 0, level2: -8, master: 0 }, { name: "Out Mix" });
  p.stereo(mon, out, { to: ["in1l", "in1r"] }).cable(pad.amp, "l", out, "in2l").cable(pad.amp, "l", out, "in2r");
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function allFour() {
  const p = patch("Monitor: Everything at Once", {
    module: "monitor", tempo: 108,
    description: "One Monitor watches four kinds of signal on a single synth voice: the notes going in, a vibrato CV, the envelope's gate and the stereo audio coming out. Change the vibrato LFO or the sequence and see which panel reacts.",
    tags: ["notes", "cv", "gate", "audio", "overview"],
  });
  const seq = line(p, [0, 0], [0, 3, 5, 7, 5, 3, 7, 10, 12, 10, 7, 5, 3, 5, 3, 0], { root: "D", gate: 0.6 });
  const lfo = p.add("lfo", [0, 2], { rate: 5.5, wave: "Sine", fade: 1 }, { name: "Vibrato" });
  const mon = p.add("monitor", [1, 0], { response: 0.3, floor: "-48 dB" }, { name: "Overview" });
  p.cable(seq, "notes", mon, "notes").cable(lfo, "out", mon, "cv");
  const n2c = p.add("notes-to-cv", [2, 0], {});
  p.cable(mon, "notes", n2c, "notes");
  const v = voice(p, [3, 0], { n: n2c }, { shape: 0.5, env: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3 } });
  p.cable(mon, "cv", v.osc, "fine", 0.25);
  p.cable(n2c, "gate", mon, "gate");
  p.cable(v.amp, "l", mon, "l").cable(v.amp, "l", mon, "r");
  const drums = beat(p, [0, 5], { style: "four", level: -12 });
  finish(p, [6, 0], [{ n: mon, l: "l", r: "r", level: 3 }, drumsOf(drums, 2)], { vmix: 0.22, master: -3 });
  return p;
}

export default [noteTable, cvReadout, gateWatch, audioFloor, allFour];
