// drum-notes: five demo patches. Each plays by itself with the transport.
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

// General MIDI drum notes as semitones above the sequencer's C (octave -2 puts the root on note 36, the kick).
const GM = { kick: 0, rim: 1, snare: 2, clap: 3, tom: 9, hat: 6, open: 10, crash: 13, ride: 15, bell: 20 };
const lane = (p, at, name, notes, vel, o = {}) => {
  const seq = p.add("step-sequencer", at, { length: 16, rate: o.rate || "1/16", root: "C", scale: "Chromatic", octave: -2, gatelength: 0.3, swing: o.swing ?? 0.5 },
    { data: steps(notes, vel) }, { name });
  const dn = p.add("drum-notes", [at[0] + 1, at[1]], {}, { name: `${name} Router` });
  p.cable(seq, "notes", dn, "notes");
  return dn;
};
const hit = (k) => GM[k];
const R = null;

function backbeat() {
  const p = patch("Drum Notes: Backbeat Kit", {
    module: "drum-notes", tempo: 108,
    description: "One sequencer plays kick and snare as General MIDI note numbers, another plays closed and open hats; Drum Notes turns each note into a trigger for the right drum. Edit a step's pitch in the sequencer to move a hit to another drum.",
    tags: ["general midi", "kit", "backbeat", "router"],
  });
  const lo = lane(p, [0, 0], "Low Drums", [hit("kick"), R, R, R, hit("snare"), R, R, hit("kick"), R, hit("kick"), R, R, hit("snare"), R, R, R]);
  const hi = lane(p, [0, 2], "Hat Drums", [hit("hat"), R, hit("hat"), R, hit("hat"), R, hit("hat"), R, hit("hat"), R, hit("hat"), R, hit("hat"), R, hit("open"), R]);
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.5 });
  p.cable(lo, "kick", kick, "trig").cable(lo, "snare", snare, "trig").cable(hi, "hat", hats, "closed").cable(hi, "open", hats, "open");
  const bass = melody(p, [0, 4], [0, R, R, 0, R, R, 7, R, 0, R, R, 0, R, 10, 7, R], { rate: "1/16", root: "E", scale: "Minor Pentatonic", octave: -2, shape: 0.9,
    gatelength: 0.5, env: { decay: 0.2, sustain: 0.3, release: 0.1 } });
  finish(p, [4, 0], [{ n: kick, l: "out", level: -4 }, { n: snare, l: "out", level: -6 }, { n: hats, l: "out", level: -12, pan: 0.2 }, { n: bass.amp, level: -6 }], { vmix: 0.12, decay: 1.2, master: 0 });
  return p;
}

function ringKit() {
  const p = patch("Drum Notes: Ring Kit Shuffle", {
    module: "drum-notes", tempo: 96,
    description: "The same note-to-drum routing drives a softer, rounder kit of resonant drums on a swung sixteenth grid, with claps on the backbeat. Change the Swing on the sequencers, or swap a kit voice's Tune, and the pattern keeps its feel.",
    tags: ["swing", "resonant drums", "clap", "shuffle"],
  });
  const lo = lane(p, [0, 0], "Low Drums", [hit("kick"), R, R, R, hit("snare"), R, R, R, R, hit("kick"), hit("kick"), R, hit("snare"), R, R, hit("snare")], [120, 0, 0, 0, 110, 0, 0, 0, 0, 90, 100, 0, 120, 0, 0, 50], { swing: 0.6 });
  const hi = lane(p, [0, 2], "Top Drums", [hit("hat"), R, hit("hat"), hit("hat"), hit("clap"), R, hit("hat"), R, hit("hat"), R, hit("hat"), hit("open"), hit("clap"), R, hit("hat"), R], null, { swing: 0.6 });
  const kick = p.add("ring-kick", [2, 0], { level: 0.8 });
  const snare = p.add("ring-snare", [2, 1], { level: 0.6 });
  const clap = p.add("ring-clap", [2, 2], { level: 0.5 });
  const hats = p.add("ring-hats", [2, 3], { level: 0.5 });
  p.cable(lo, "kick", kick, "trig").cable(lo, "velocity", kick, "velocity").cable(lo, "snare", snare, "trig").cable(lo, "velocity", snare, "velocity")
    .cable(hi, "clap", clap, "trig").cable(hi, "hat", hats, "closed").cable(hi, "open", hats, "open");
  const pad = melody(p, [0, 5], [0, "_", "_", "_", "_", "_", "_", "_", 3, "_", "_", "_", 5, "_", "_", "_"], { rate: "1/4", root: "D", scale: "Dorian", octave: -1, shape: 0.5,
    gatelength: 1, env: { attack: 0.2, decay: 0.5, sustain: 0.6, release: 0.8 } });
  finish(p, [4, 0], [{ n: kick, l: "out", level: -4 }, { n: snare, l: "out", level: -6, also: [[clap, "out"]] }, { n: hats, l: "out", level: -11, pan: 0.25 }, { n: pad.amp, level: -12, pan: -0.2 }], { vmix: 0.18, decay: 1.8, master: 2 });
  return p;
}

function percussionCircle() {
  const p = patch("Drum Notes: Percussion Circle", {
    module: "drum-notes", tempo: 100,
    description: "Toms, a woody rim click, a cowbell and a clap are all played from note numbers: Drum Notes has an output for each. Mute one of the sequencers' steps, or tune the toms down, to open up the groove.",
    tags: ["percussion", "toms", "cowbell", "rim"],
  });
  const lo = lane(p, [0, 0], "Skin Drums", [hit("tom"), R, R, hit("tom"), R, R, hit("tom"), R, R, hit("kick"), R, hit("tom"), R, R, hit("tom"), R]);
  const hi = lane(p, [0, 2], "Metal and Wood", [hit("rim"), R, R, hit("rim"), R, hit("bell"), R, R, hit("rim"), R, hit("clap"), R, R, hit("bell"), R, hit("rim")]);
  const tom = p.add("punch-tom", [2, 0], { tune: 120, decay: 0.45, level: 0.8 });
  const kick = p.add("ring-kick", [2, 1], { level: 0.7 });
  const rim = p.add("ring-rim", [2, 2], { level: 0.6 });
  const bell = p.add("ring-cowbell", [2, 3], { level: 0.5, tone: 0.4 });
  const clap = p.add("punch-clap", [2, 4], { level: 0.5 });
  p.cable(lo, "tom", tom, "trig").cable(lo, "kick", kick, "trig").cable(hi, "rim", rim, "trig").cable(hi, "bell", bell, "trig").cable(hi, "clap", clap, "trig");
  finish(p, [4, 0], [{ n: tom, l: "out", level: -4, pan: -0.3, also: [[kick, "out"]] }, { n: rim, l: "out", level: -8, pan: 0.2 }, { n: bell, l: "out", level: -14, pan: 0.35 }, { n: clap, l: "out", level: -12, pan: -0.15 }], { vmix: 0.2, decay: 2, master: 0 });
  return p;
}

function rideAndCrash() {
  const p = patch("Drum Notes: Ride and Crash", {
    module: "drum-notes", tempo: 130,
    description: "A lazy jazz feel: the ride pattern, a pedal hi-hat, a feathered kick and one crash at the top of the bar, all as note numbers. Try the Cymbal's Voice or Decay, or lengthen the ride's pattern.",
    tags: ["cymbal", "ride", "crash", "jazz"],
  });
  const lo = lane(p, [0, 0], "Time", [hit("ride"), R, R, hit("ride"), R, hit("ride"), hit("ride"), R, R, hit("ride"), R, hit("ride"), hit("ride"), R, hit("ride"), R], [100, 0, 0, 60, 0, 90, 60, 0, 0, 100, 0, 60, 70, 0, 90, 0], { swing: 0.62 });
  const mid = lane(p, [0, 2], "Feet", [hit("kick"), R, R, R, hit("hat"), R, R, R, hit("kick"), R, R, hit("rim"), hit("hat"), R, R, R], [40, 0, 0, 0, 100, 0, 0, 0, 40, 0, 0, 60, 100, 0, 0, 0], { swing: 0.62 });
  const top = lane(p, [0, 4], "Accent", [hit("crash"), R, R, R, R, R, R, R, R, R, R, R, R, R, R, R], [105]);
  const ride = p.add("punch-cymbal", [2, 0], { voice: "Ride", decay: 2.5, tone: 0.5, crunch: 0.1, level: 0.6 }, { name: "Ride" });
  const crash = p.add("punch-cymbal", [2, 4], { voice: "Crash", decay: 4, tone: 0.45, crunch: 0.15, level: 0.5 }, { name: "Crash" });
  const kick = p.add("ring-kick", [2, 1], { level: 0.6, decay: 0.5 });
  const hats = p.add("ring-hats", [2, 2], { level: 0.5 });
  const rim = p.add("ring-rim", [2, 3], { level: 0.5, voice: "Clave" });
  p.cable(lo, "ride", ride, "trig").cable(lo, "velocity", ride, "velocity").cable(mid, "kick", kick, "trig").cable(mid, "velocity", kick, "velocity")
    .cable(mid, "hat", hats, "closed").cable(mid, "rim", rim, "trig").cable(top, "crash", crash, "trig");
  const bass = melody(p, [0, 6], [0, R, 5, R, 7, R, 5, R, 3, R, 5, R, 7, R, 10, R], { rate: "1/4", root: "F", scale: "Dorian", octave: -2, shape: 0.15, gatelength: 0.8, env: { decay: 0.4, sustain: 0.4, release: 0.2 } });
  finish(p, [4, 0], [{ n: ride, l: "out", level: -8, pan: 0.3 }, { n: crash, l: "out", level: -9, pan: -0.3 }, { n: kick, l: "out", level: -6, also: [[hats, "out"], [rim, "out"]] }, { n: bass.amp, level: -3 }], { vmix: 0.2, decay: 2.2, master: 4 });
  return p;
}

function velocityGhosts() {
  const p = patch("Drum Notes: Ghost Notes", {
    module: "drum-notes", tempo: 92,
    description: "Drum Notes also passes each hit's velocity, so the quiet ghost snares between the backbeats really are quiet while the accents bite. Raise or lower a step's velocity in the sequencer and hear the dynamics change.",
    tags: ["velocity", "ghost notes", "dynamics", "snare"],
  });
  const lo = lane(p, [0, 0], "Drummer", [hit("kick"), R, hit("snare"), hit("snare"), hit("snare"), R, hit("snare"), R, hit("kick"), hit("kick"), hit("snare"), R, hit("snare"), hit("snare"), R, hit("snare")],
    [127, 0, 30, 35, 120, 0, 28, 0, 110, 90, 30, 0, 127, 32, 0, 40]);
  const hi = lane(p, [0, 2], "Hat Hand", [hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("open"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat"), hit("hat")],
    [110, 45, 80, 45, 110, 45, 80, 70, 110, 45, 80, 45, 110, 45, 80, 45]);
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.8, snappy: 0.7 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.7 });
  p.cable(lo, "kick", kick, "trig").cable(lo, "velocity", kick, "velocity").cable(lo, "snare", snare, "trig").cable(lo, "velocity", snare, "velocity")
    .cable(hi, "hat", hats, "closed").cable(hi, "open", hats, "open").cable(hi, "velocity", hats, "velocity");
  const keys = melody(p, [0, 5], [0, R, R, R, 3, R, R, R, 7, R, R, R, 5, R, R, R], { rate: "1/4", root: "A", scale: "Minor Pentatonic", octave: 0, shape: 0.2,
    gatelength: 0.7, env: { attack: 0.01, decay: 0.8, sustain: 0.1, release: 0.4 } });
  finish(p, [4, 0], [{ n: kick, l: "out", level: -5 }, { n: snare, l: "out", level: -6 }, { n: hats, l: "out", level: -10, pan: 0.25 }, { n: keys.amp, level: -3, pan: -0.2 }], { vmix: 0.2, decay: 2, master: 0 });
  return p;
}

export default [backbeat, ringKit, percussionCircle, rideAndCrash, velocityGhosts];
