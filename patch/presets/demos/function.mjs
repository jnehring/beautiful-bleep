// SPDX-License-Identifier: MIT
// Function: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono/stereo source (`src`, jacks l/r) → trim → reverb → Out.
function finish(p, at, src, o = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: o.trim ?? 0, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...(o.verb || {}) });
  const [jl, jr] = o.jacks || ["l", "r"];
  p.cable(src, jl, t, "in1l").cable(src, o.stereo ? jr : jl, t, "in1r");
  p.stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

/// Plucked melody into a Multi Filter (returns the filter, stereo out).
function voice(p, at, notes, o = {}) {
  const m = melody(p, at, notes, o);
  const f = p.add("filter", [at[0] + 3, at[1]], { cutoff: 1200, resonance: 0.25, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r");
  return { ...m, filt: f };
}

/// Two detuned oscillators (left / right) held by a sequencer → VCA (gain left to the caller) → Multi Filter.
function pad(p, at, notes, o = {}) {
  const [c, r] = at;
  const seq = p.add("step-sequencer", [c, r], { length: notes.length, rate: o.rate || "1/2", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? -1, gatelength: o.gate ?? 0.95 }, { data: steps(notes) });
  const o1 = p.add("oscillator", [c + 1, r], { shape: o.shape ?? 0.5, fine: -9 }, { name: "Osc L" });
  const o2 = p.add("oscillator", [c + 1, r + 1], { shape: o.shape ?? 0.5, fine: 9 }, { name: "Osc R" });
  const amp = p.add("vca", [c + 2, r], { gain: o.gain ?? 1 }, { name: "VCA" });
  const f = p.add("filter", [c + 3, r], { cutoff: 1400, resonance: 0.2, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", amp, "l").cable(o2, "out", amp, "r")
    .stereo(amp, f);
  return { seq, o1, o2, amp, filt: f };
}

function sweeper() {
  const p = patch("Function: Filter Sweeper", {
    module: "function", tempo: 104,
    description: "With Cycle on, the Function is a free-running rise-and-fall LFO: its A output opens and closes the filter on a plucked line. Change Rise and Fall for a lopsided sweep, or Shape to bend the slopes.",
    tags: ["lfo", "cycle", "filter sweep", "slope"],
  });
  const v = voice(p, [0, 0], [0, 7, 3, 10, 0, 7, 12, 10, 5, 7, 3, 0, 7, 10, 12, 7], { shape: 0.85, env: { decay: 0.3, sustain: 0.25 }, filter: { cutoff: 500, resonance: 0.45 } });
  const f = p.add("function", [3, 1], { rise: 1.6, fall: 2.8, shape: 0.2, cycle: true });
  p.cable(f, "a", v.filt, "cutoff", 0.55);
  finish(p, [4, 0], v.filt, { stereo: true, trim: 0 });
  return p;
}

function pluckEnv() {
  const p = patch("Function: Plucked Envelope", {
    module: "function", tempo: 96,
    description: "Cycle is off, so every sequencer gate triggers one rise-and-fall: the A output shapes the volume and the B output, lagging behind through Spread, opens the filter slightly later. Try a slower Rise for swells or a longer Fall for ringing notes.",
    tags: ["envelope", "trigger", "pluck", "spread"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "D", scale: "Dorian", octave: 0, gatelength: 0.3 },
    { data: steps([0, ".", 7, 3, ".", 10, 7, ".", 5, 3, ".", 7, 12, ".", 10, 7]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.9 }, { name: "Source" });
  const amp = p.add("vca", [2, 0], {});
  const f = p.add("function", [1, 1], { rise: 0.004, fall: 0.5, shape: -0.3, spread: 0.55, cycle: false });
  const flt = p.add("filter", [3, 0], { cutoff: 350, resonance: 0.3 }, { name: "Filter" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", f, "trig").cable(osc, "out", amp, "l").cable(f, "a", amp, "gain")
    .cable(amp, "l", flt, "l").cable(amp, "l", flt, "r").cable(f, "b", flt, "cutoff", 0.45);
  finish(p, [4, 0], flt, { stereo: true, trim: -9, verb: { mix: 0.22 } });
  return p;
}

function fourLags() {
  const p = patch("Function: Four Related Curves", {
    module: "function", tempo: 90,
    description: "A, B, C and D are the same slow cycle at different delays, set by Spread, and here each one moves something else: filter cutoff, resonance, oscillator shape and reverb size. Raise Spread to pull them further apart, or lower it to make them move as one.",
    tags: ["four outputs", "spread", "multi-destination", "evolving"],
  });
  const v = voice(p, [0, 0], [0, 3, 7, 3, 10, 7, 3, 7, 0, 5, 8, 5, 12, 8, 5, 3], { rate: "1/8", shape: 0.5, root: "C", scale: "Natural Minor", env: { decay: 0.35, sustain: 0.3 }, filter: { cutoff: 700, resonance: 0.3 } });
  const f = p.add("function", [3, 1], { rise: 3.5, fall: 4.5, spread: 0.7, shape: 0, cycle: true });
  const verb = finish(p, [4, 0], v.filt, { stereo: true, trim: -3, verb: { size: 0.4, decay: 3.5, mix: 0.35 } });
  p.cable(f, "a", v.filt, "cutoff", 0.5).cable(f, "b", v.filt, "resonance", 0.4).cable(f, "c", v.osc, "shape", 0.4).cable(f, "d", verb, "size", 0.5);
  return p;
}

function bouncingPad() {
  const p = patch("Function: Bouncing Pad", {
    module: "function", tempo: 112,
    description: "Locked to the beat with Sync, the Function acts as a rhythmic pump on a held pad: Fall sets how fast the volume swells back after each bounce. Change Sync for a faster or slower pulse, or Shape for a softer curve.",
    tags: ["sync", "pump", "tremolo", "pad"],
  });
  const pd = pad(p, [0, 0], [0, 3, 5, 7], { rate: "1/1", gain: 0, filter: { cutoff: 1800 } });
  const f = p.add("function", [2, 1], { rise: 0.12, fall: 0.35, shape: 0.35, cycle: true, sync: "1/4" });
  p.cable(f, "a", pd.amp, "gain", 0.9);
  const drums = beat(p, [0, 3], { style: "half", level: -6 });
  const mix = p.add("audio-mixer", [5, 0], { level1: -4, level2: -7, master: 0 });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2.5, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(pd.filt, mix, { to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function chain() {
  const p = patch("Function: Swell and Chime", {
    module: "function", tempo: 84,
    description: "One trigger per bar starts a long swell that fades a pad in and out; when it finishes, its End output triggers a second Function that plays a short chime. Lengthen the first Fall to push the chimes later.",
    tags: ["end of cycle", "chain", "swell", "ambient"],
  });
  const trig = p.add("step-sequencer", [0, 2], { length: 4, rate: "1/1", root: "F", scale: "Major Pentatonic", octave: 0, gatelength: 0.05 },
    { data: steps([0, 4, 7, 2]) });
  const pd = pad(p, [0, 0], [0, 4, 2, 7], { rate: "1/1", root: "F", scale: "Major Pentatonic", gain: 0, filter: { cutoff: 1500 } });
  const f1 = p.add("function", [1, 2], { rise: 1.8, fall: 2.4, cycle: false });
  const f2 = p.add("function", [2, 2], { rise: 0.003, fall: 0.9, shape: -0.4, cycle: false });
  const bell = p.add("oscillator", [3, 2], { shape: 0, octave: "+2" }, { name: "Chime" });
  const bva = p.add("vca", [4, 2], {});
  p.cable(trig, "gate", f1, "trig").cable(f1, "a", pd.amp, "gain", 0.8).cable(f1, "eoc", f2, "trig")
    .cable(trig, "pitch", bell, "pitch").cable(bell, "out", bva, "l").cable(f2, "a", bva, "gain", 0.5);
  const mix = p.add("audio-mixer", [5, 0], { level1: -3, level2: -9, master: 0 });
  const v = p.add("reverb", [6, 0], { size: 0.6, decay: 4, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(pd.filt, mix, { to: ["in1l", "in1r"] }).cable(bva, "l", mix, "in2l").cable(bva, "l", mix, "in2r")
    .stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [sweeper, pluckEnv, fourLags, bouncingPad, chain];
