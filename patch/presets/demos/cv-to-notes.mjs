// cv-to-notes: five demo patches. Each plays by itself with the transport.
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

function octaveRuns() {
  const p = patch("CV to Notes: Octave Runs", {
    module: "cv-to-notes", tempo: 100,
    description: "A slow sequencer line becomes notes through CV to Notes, and the Arpeggiator turns each one into a three-octave run. Change the Arpeggiator's pattern, or raise Velocity on CV to Notes to hit the voice harder.",
    tags: ["converter", "arpeggiator", "notes", "sequencer"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "D", scale: "Minor Pentatonic", octave: -1, gatelength: 0.95 },
    { data: steps([0, 3, 5, 7, 5, 3, 7, 10]) });
  const c2n = p.add("cv-to-notes", [1, 0], { velocity: 0.8 });
  const arp = p.add("arpeggiator", [2, 0], { rate: "1/16", pattern: "Up-Down", octaves: 3, gatelength: 0.5 });
  p.cable(seq, "pitch", c2n, "pitch").cable(seq, "gate", c2n, "gate").cable(c2n, "notes", arp, "notes");
  const v = voice(p, [3, 0], { n: arp }, { shape: 0.75, env: { decay: 0.2, sustain: 0.1, release: 0.15 }, cutoff: 3000, res: 0.2 });
  finish(p, [6, 0], [{ n: v.out.n, level: 6, pan: 0 }], { vmix: 0.25, master: 0 });
  return p;
}

function gateDrums() {
  const p = patch("CV to Notes: Gates Become Drums", {
    module: "cv-to-notes", tempo: 112,
    description: "Plain gates from a Drum Grid carry no pitch, so CV to Notes sends its fixed Note: 36 is the kick and 38 the snare to a Drum Notes module that turns General MIDI notes back into hits. Change a Note setting to 42 and the snare becomes a hat.",
    tags: ["gate", "drums", "general midi", "note setting"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid8() });
  const k = p.add("cv-to-notes", [1, 0], { note: 36, velocity: 0.9 }, { name: "Kick Note" });
  const s = p.add("cv-to-notes", [1, 1], { note: 38, velocity: 0.7 }, { name: "Snare Note" });
  const h = p.add("cv-to-notes", [1, 2], { note: 42, velocity: 0.5 }, { name: "Hat Note" });
  p.cable(grid, "gate1", k, "gate").cable(grid, "gate2", s, "gate").cable(grid, "gate3", h, "gate");
  const dn = p.add("drum-notes", [2, 0], {}, { name: "Kick Router" });
  const dn2 = p.add("drum-notes", [2, 1], {}, { name: "Snare Router" });
  const dn3 = p.add("drum-notes", [2, 2], {}, { name: "Hat Router" });
  p.cable(k, "notes", dn, "notes").cable(s, "notes", dn2, "notes").cable(h, "notes", dn3, "notes");
  const kick = p.add("punch-kick", [3, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [3, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [3, 2], { level: 0.5 });
  p.cable(dn, "kick", kick, "trig").cable(dn2, "snare", snare, "trig").cable(dn3, "hat", hats, "closed").cable(dn3, "velocity", hats, "velocity");
  finish(p, [4, 0], [{ n: kick, l: "out", level: -4 }, { n: snare, l: "out", level: -7 }, { n: hats, l: "out", level: -13, pan: 0.2 }], { vmix: 0.12, decay: 1.2 });
  return p;
}

function lfoMelody() {
  const p = patch("CV to Notes: Self-Playing Triangle", {
    module: "cv-to-notes", tempo: 90,
    description: "A slow LFO sweeps a Quantizer, whose pitch and gate pass through CV to Notes and out as notes to a Notes to CV voice: nothing sequenced, yet a melody. Change the LFO rate for faster runs, or the Quantizer's scale for another colour.",
    tags: ["lfo", "quantizer", "generative", "melody"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.16, wave: "Triangle" }, { name: "Sweep" });
  const q = p.add("quantizer", [1, 0], { root: "E", scale: "Minor Pentatonic", range: 2, hysteresis: 0.2 });
  p.cable(lfo, "out", q, "in", 0.6);
  const c2n = p.add("cv-to-notes", [2, 0], { velocity: 0.8 });
  p.cable(q, "out", c2n, "pitch").cable(q, "gate", c2n, "gate");
  const n2c = p.add("notes-to-cv", [3, 0], { retrigger: "On" });
  p.cable(c2n, "notes", n2c, "notes");
  const v = voice(p, [4, 0], { n: n2c }, { shape: 0.4, env: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 0.4 }, osc: { octave: "0" } });
  const dl = p.add("delay", [6, 0], { timel: 375, timer: 500, feedback: 0.4, highcut: 5000, mix: 0.3 });
  p.cable(v.amp, "l", dl, "l").cable(v.amp, "l", dl, "r");
  finish(p, [7, 0], [{ n: dl, level: 3 }, { n: v.amp, level: -1 }], { vmix: 0.3, decay: 3 });
  return p;
}

function chordsFromLine() {
  const p = patch("CV to Notes: Harmony Listens", {
    module: "cv-to-notes", tempo: 84,
    description: "A bass line from a sequencer is sent as notes by CV to Notes into a Harmony Master, which follows the line and holds a chord around it; four oscillators play its chord tones above. Change the Harmony Master's Quality to dress the same line differently.",
    tags: ["harmony", "chords", "bass line", "detect"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "C", scale: "Natural Minor", octave: -1, gatelength: 0.97 },
    { data: steps([0, 0, 8, 8, 5, 5, 7, 7]) });
  const c2n = p.add("cv-to-notes", [1, 0], { velocity: 0.8 });
  p.cable(seq, "pitch", c2n, "pitch").cable(seq, "gate", c2n, "gate");
  const hm = p.add("harmony-master", [2, 0], { source: "Detect", quality: "Minor 7", octave: 0 });
  p.cable(c2n, "notes", hm, "notes");
  const chans = [];
  for (let i = 0; i < 4; i++) {
    const osc = p.add("oscillator", [3, i], { shape: 0.6, fine: (i - 1.5) * 7 }, { name: `Tone ${i + 1}` });
    p.cable(hm, `tone${i + 1}`, osc, "pitch");
    if (i < 2) { if (i === 0) chans.push({ n: osc, l: "out", level: -14, pan: -0.4, also: [] }); else chans[0].also.push([osc, "out"]); }
    else { if (i === 2) chans.push({ n: osc, l: "out", level: -14, pan: 0.4, also: [] }); else chans[1].also.push([osc, "out"]); }
  }
  const bass = p.add("oscillator", [3, 4], { shape: 0.1, octave: "-1" }, { name: "Bass" });
  p.cable(seq, "pitch", bass, "pitch");
  const bamp = p.add("vca", [4, 4], { gain: 0.6 }, { name: "Bass Level" });
  p.cable(bass, "out", bamp, "l");
  chans.push({ n: bamp, level: -6 });
  finish(p, [5, 0], chans, { vmix: 0.3, decay: 3.5, master: -4 });
  return p;
}

function velocityTouch() {
  const p = patch("CV to Notes: Soft and Hard Touch", {
    module: "cv-to-notes", tempo: 108,
    description: "The notes leave CV to Notes with a fixed Velocity, and Notes to CV passes it on to open the filter: a low Velocity gives a mellow pluck, a high one a bright bite. Move the Velocity knob while the line plays.",
    tags: ["velocity", "filter", "pluck", "dynamics"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Dorian", octave: 0, gatelength: 0.4 },
    { data: steps([0, ".", 3, 5, 7, ".", 5, 3, 0, 2, 3, ".", 7, 10, 7, 5]) });
  const c2n = p.add("cv-to-notes", [1, 0], { velocity: 0.55 });
  p.cable(seq, "pitch", c2n, "pitch").cable(seq, "gate", c2n, "gate");
  const n2c = p.add("notes-to-cv", [2, 0], {});
  p.cable(c2n, "notes", n2c, "notes");
  const v = voice(p, [3, 0], { n: n2c }, { shape: 0.85, env: { decay: 0.22, sustain: 0.05, release: 0.15 }, cutoff: 700, res: 0.3 });
  p.cable(n2c, "velocity", v.flt, "cutoff", 0.6);
  const drums = beat(p, [0, 4], { style: "sparse", level: -10 });
  finish(p, [6, 0], [{ n: v.out.n, level: 6 }, drumsOf(drums, 4)], { vmix: 0.2 });
  return p;
}

function drumGrid8() {
  return drumGrid(["Kick", "Snare", "Hat", "", "", "", "", ""],
    [pattern("Beat", ["X...x...X...x...", "....X.......X...", "x.x.x.x.x.x.x.x.", "", "", "", "", ""])]);
}

export default [octaveRuns, gateDrums, lfoMelody, chordsFromLine, velocityTouch];
