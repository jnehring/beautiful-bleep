// cv-to-midi: five demo patches. Each plays by itself with the transport.
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

function lead(p, at, o = {}) {
  const m = melody(p, at, o.notes || [0, 3, 7, 3, 10, 7, 5, 3, 0, 5, 7, 12, 10, 7, 3, 5], {
    rate: "1/8", root: o.root || "D", scale: "Minor Pentatonic", octave: o.octave ?? 0, shape: o.shape ?? 0.8, gatelength: 0.5,
    env: { decay: 0.3, sustain: 0.15, release: 0.2 }, osc: o.osc,
  });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: o.cutoff || 1200, resonance: o.res ?? 0.3, ...(o.flt || {}) }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  m.flt = flt;
  return m;
}
function monitored(p, at, c2m) {
  const mon = p.add("monitor", at, {}, { name: "CC Table" });
  p.cable(c2m, "notes", mon, "notes");
  return mon;
}
function tail(p, at, m, drums, master = 0) {
  const chans = [{ n: m.flt, level: 4 }];
  if (drums) chans.push(drumsOf(drums, 0));
  return finish(p, at, chans, { vmix: 0.22, master });
}

function filterSweep() {
  const p = patch("CV to MIDI: Filter Sweep Out", {
    module: "cv-to-midi", tempo: 110,
    description: "A slow LFO opens and closes the filter of a plucked line, and the same cable also feeds lane 1 of CV to MIDI, which sends the sweep out as CC 74 (open the Monitor to watch the messages). Change CC 1 to send it as another controller, or narrow Min 1 and Max 1.",
    tags: ["cc", "filter", "lfo", "automation"],
  });
  const m = lead(p, [0, 0], { cutoff: 900, res: 0.4 });
  const lfo = p.add("lfo", [0, 3], { rate: 0.2, wave: "Sine", polarity: "Unipolar" }, { name: "Sweep" });
  const c2m = p.add("cv-to-midi", [4, 0], { cc1: 74, channel1: 1, min1: 10, max1: 120, range: "0 … +1" });
  p.cable(lfo, "out", m.flt, "cutoff", 0.5).cable(lfo, "out", c2m, "in1");
  monitored(p, [5, 0], c2m);
  const drums = beat(p, [0, 5], { style: "half", level: -12 });
  tail(p, [6, 1], m, drums, 3);
  return p;
}

function envelopeCc() {
  const p = patch("CV to MIDI: Envelope as Expression", {
    module: "cv-to-midi", tempo: 100,
    description: "Each note's envelope shapes the filter and is also sent as CC 11 through lane 1, so a hardware synth could breathe with the same contour. Lower Max Rate to thin out the messages, or stretch the envelope's Decay and watch the table fill.",
    tags: ["cc", "envelope", "expression", "max rate"],
  });
  const m = lead(p, [0, 0], { cutoff: 500, res: 0.35 });
  const c2m = p.add("cv-to-midi", [4, 0], { cc1: 11, min1: 0, max1: 127, rate: 100 });
  p.cable(m.env, "env", m.flt, "cutoff", 0.6).cable(m.env, "env", c2m, "in1");
  monitored(p, [5, 0], c2m);
  tail(p, [6, 1], m, null, 5);
  return p;
}

function bipolar14() {
  const p = patch("CV to MIDI: Vibrato in 14 Bit", {
    module: "cv-to-midi", tempo: 84,
    description: "A bipolar LFO bends the pitch a few cents and goes out as CC 1 at 14-bit resolution, so slow movement stays smooth instead of stepping. Switch Resolution back to 7 bit, or Input Range to 0 to +1, and compare the table.",
    tags: ["14 bit", "bipolar", "vibrato", "resolution"],
  });
  const m = lead(p, [0, 0], { notes: [0, "_", "_", 7, "_", 5, "_", "_", 3, "_", 5, 7, "_", "_", 10, "_"], shape: 0.5, cutoff: 2500, osc: { shape: 0.4 } });
  m.env.params; // envelope stays as set by lead()
  const lfo = p.add("lfo", [0, 3], { rate: 5, wave: "Sine", fade: 1.5 }, { name: "Vibrato" });
  const c2m = p.add("cv-to-midi", [4, 0], { cc1: 1, range: "−1 … +1", resolution: "14 bit (CC 0–31)", rate: 200 });
  p.cable(lfo, "out", m.osc, "fine", 0.35).cable(lfo, "out", c2m, "in1");
  monitored(p, [5, 0], c2m);
  tail(p, [6, 1], m, null, 2);
  return p;
}

function fourLanes() {
  const p = patch("CV to MIDI: Four Moving Controls", {
    module: "cv-to-midi", tempo: 106,
    description: "Four LFOs at different speeds move cutoff, resonance, tone and the reverb, and each is sent on its own lane as CC 74, 71, 91 and 93 on separate channels with their own Min and Max. Drag a lane's Max down to squeeze its range.",
    tags: ["four lanes", "channels", "cc", "modulation"],
  });
  const m = lead(p, [0, 0], { cutoff: 1100, res: 0.35, shape: 0.6 });
  const l1 = p.add("lfo", [0, 3], { rate: 0.13, wave: "Sine", polarity: "Unipolar" }, { name: "Cutoff" });
  const l2 = p.add("lfo", [1, 3], { rate: 0.21, wave: "Triangle", polarity: "Unipolar" }, { name: "Resonance" });
  const l3 = p.add("lfo", [2, 3], { rate: 0.09, wave: "Sine", polarity: "Unipolar" }, { name: "Tone" });
  const l4 = p.add("lfo", [3, 3], { rate: 0.05, wave: "Triangle", polarity: "Unipolar" }, { name: "Space" });
  const c2m = p.add("cv-to-midi", [4, 0], { cc1: 74, channel1: 1, cc2: 71, channel2: 2, cc3: 91, channel3: 3, min3: 20, max3: 100,
    cc4: 93, channel4: 4, min4: 0, max4: 90 });
  p.cable(l1, "out", m.flt, "cutoff", 0.45).cable(l2, "out", m.flt, "resonance", 0.3).cable(l3, "out", m.osc, "shape", 0.3)
    .cable(l1, "out", c2m, "in1").cable(l2, "out", c2m, "in2").cable(l3, "out", c2m, "in3").cable(l4, "out", c2m, "in4");
  monitored(p, [5, 0], c2m);
  const fin = tail(p, [6, 1], m);
  p.cable(l4, "out", fin.verb, "mix", 0.4);
  return p;
}

function randomSteps() {
  const p = patch("CV to MIDI: Random Steps", {
    module: "cv-to-midi", tempo: 120,
    description: "A stepped Random changes the filter on every eighth note and CV to MIDI sends each new level as CC 74: only values that moved are sent, so the table shows one message per step. Turn Smooth up on the Random and the messages arrive in streams.",
    tags: ["random", "stepped", "sample and hold", "cc"],
  });
  const m = lead(p, [0, 0], { cutoff: 600, res: 0.4, shape: 0.9 });
  const rnd = p.add("random", [0, 3], { rate: 4, sync: "1/8", spread: 0.9, smooth: 0, seed: 7 }, { name: "Stepper" });
  const c2m = p.add("cv-to-midi", [4, 0], { cc1: 74, range: "−1 … +1", min1: 0, max1: 127, rate: 60 });
  p.cable(rnd, "out", m.flt, "cutoff", 0.6).cable(rnd, "out", c2m, "in1");
  monitored(p, [5, 0], c2m);
  const drums = beat(p, [0, 5], { style: "four", level: -12 });
  tail(p, [6, 1], m, drums, -3);
  return p;
}

export default [filterSweep, envelopeCc, bipolar14, fourLanes, randomSteps];
