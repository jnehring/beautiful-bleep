// level-meter: five demo patches. Each plays by itself with the transport.
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

/// A small band: melody + drums on a mixer. Returns {mix, m}.
function band(p, at, o = {}) {
  const m = melody(p, [at[0], at[1]], o.notes || [0, ".", 3, 5, 7, ".", 5, 3, 10, ".", 7, 5, 3, ".", 0, "."], {
    rate: "1/8", root: o.root || "E", scale: "Minor Pentatonic", octave: o.octave ?? 0, shape: o.shape ?? 0.8, gatelength: 0.5,
    env: { decay: 0.25, sustain: 0.1, release: 0.2 },
  });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: o.cutoff ?? 2400, resonance: 0.25 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  const drums = beat(p, [at[0], at[1] + 3], { style: o.style || "half", level: -8 });
  const mix = p.add("audio-mixer", [at[0] + 4, at[1]], { level1: o.lead ?? 2, level2: o.drum ?? 0, master: o.master ?? 0 }, { name: "Band" });
  p.cable(flt, "l", mix, "in1l").cable(flt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { mix, flt, drums, m };
}
const toOut = (p, from, jacks = ["outl", "outr"]) => p.stereo(from, p.out, { from: jacks });

function masterCheck() {
  const p = patch("Level Meter: Master Check", {
    module: "level-meter", tempo: 108,
    description: "A small band passes through a Level Meter on its way to the output: watch the RMS bars dance and the peak marks stop at the top of each hit, with the clip lights staying dark. Turn the band's mixer up until a clip light shows, then back off.",
    tags: ["metering", "peak", "rms", "headroom"],
  });
  const b = band(p, [0, 0], { master: 3 });
  const lm = p.add("level-meter", [5, 0], { response: 0.3, floor: "-48 dB", detector: "RMS", hold: "3 s" });
  p.stereo(b.mix, lm, { from: ["outl", "outr"] });
  const verb = p.add("reverb", [6, 0], { size: 0.5, decay: 2, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(lm, verb).stereo(verb, p.out);
  return p;
}

function duckedPad() {
  const p = patch("Level Meter: Level Ducks the Pad", {
    module: "level-meter", tempo: 118,
    description: "The drums run through a Level Meter whose Level output, inverted, pulls the pad's volume down on every kick: a sidechain pump made from a meter. Raise Response for slower, wider pumping, or turn the cable amount down for a gentler duck.",
    tags: ["sidechain", "ducking", "pump", "level out"],
  });
  const drums = beat(p, [0, 0], { style: "four", level: -6 });
  const lm = p.add("level-meter", [3, 0], { response: 0.12, floor: "-36 dB", detector: "Peak" });
  p.stereo(drums, lm, { from: ["outl", "outr"] });
  const seq = p.add("step-sequencer", [0, 4], { length: 4, rate: "1/1", root: "F", scale: "Major", octave: -1, gatelength: 1 }, { data: steps([0, 4, 5, 7]) }, { name: "Pad Chords" });
  const mix = p.add("audio-mixer", [3, 4], { level1: -6, level2: -6, level3: -6, master: -3, pan1: -0.4, pan2: 0.4 }, { name: "Pad Mix" });
  [0, 7, 12].forEach((s, i) => {
    const o = p.add("oscillator", [1, 4 + i], { shape: 0.55, coarse: s, fine: (i - 1) * 8 }, { name: `Pad ${i + 1}` });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const amp = p.add("vca", [4, 4], { gain: 1 }, { name: "Duck VCA" });
  p.stereo(mix, amp, { from: ["outl", "outr"] }).cable(lm, "level", amp, "gain", -0.9);
  const flt = p.add("filter", [5, 4], { cutoff: 1800, resonance: 0.1 });
  p.stereo(amp, flt);
  const out = p.add("audio-mixer", [6, 0], { level1: -3, level2: -5, master: -3 }, { name: "Out Mix" });
  p.stereo(lm, out, { to: ["in1l", "in1r"] }).stereo(flt, out, { to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [7, 0], { size: 0.6, decay: 3, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function loudnessFilter() {
  const p = patch("Level Meter: Loudness Opens the Filter", {
    module: "level-meter", tempo: 100,
    description: "The loudness of a drum loop, read by the Level Meter's Level output, opens the filter of a saw bass: loud passages sound bright, quiet ones muffled, like an envelope follower. Change Response for smoother or twitchier brightness.",
    tags: ["follower", "level out", "filter", "control"],
  });
  const drums = beat(p, [0, 0], { style: "broken", level: -8 });
  const lm = p.add("level-meter", [3, 0], { response: 0.25, floor: "-36 dB", detector: "RMS" });
  p.stereo(drums, lm, { from: ["outl", "outr"] });
  const m = melody(p, [0, 4], [0, 0, ".", 0, 7, ".", 0, 5, 0, ".", 0, 10, ".", 7, 5, 3], { rate: "1/8", root: "D", scale: "Natural Minor", octave: -2, shape: 1, gatelength: 0.6, env: { decay: 0.2, sustain: 0.5, release: 0.1 } });
  const flt = p.add("filter", [3, 4], { cutoff: 250, resonance: 0.45, type: "Ladder Tanh", drive: 0.2 }, { name: "Follower Filter" });
  p.cable(m.amp, "l", flt, "l").cable(lm, "level", flt, "cutoff", 0.7);
  const out = p.add("audio-mixer", [5, 0], { level1: -6, level2: -2, master: -3 }, { name: "Out Mix" });
  p.stereo(lm, out, { to: ["in1l", "in1r"] }).cable(flt, "l", out, "in2l").cable(flt, "l", out, "in2r");
  toOut(p, out);
  return p;
}

function beforeAfter() {
  const p = patch("Level Meter: Before and After", {
    module: "level-meter", tempo: 112,
    description: "Two Level Meters sit either side of a Compressor: the first shows the raw band, the second what is left after the squeeze, so you can see the dynamics shrink. Drop the Compressor's Threshold and watch the second meter's peaks come down.",
    tags: ["compressor", "before and after", "dynamics", "metering"],
  });
  const b = band(p, [0, 0], { style: "four", master: -1, drum: 3 });
  const pre = p.add("level-meter", [5, 0], { response: 0.25, floor: "-36 dB", detector: "Peak", hold: "3 s" }, { name: "Before" });
  const comp = p.add("compressor", [6, 0], { threshold: -26, ratio: 6, attack: 10, release: 160, makeup: 4, knee: 6 });
  const post = p.add("level-meter", [7, 0], { response: 0.25, floor: "-36 dB", detector: "Peak", hold: "3 s" }, { name: "After" });
  p.stereo(b.mix, pre, { from: ["outl", "outr"] }).stereo(pre, comp).stereo(comp, post);
  toOut(p, post, ["l", "r"]);
  return p;
}

function quietTail() {
  const p = patch("Level Meter: Watching a Tail Fade", {
    module: "level-meter", tempo: 66,
    description: "Sparse bell notes ring into a long reverb, and a Level Meter with its Floor at minus 96 dB lets you watch the tail die away to nothing, long after the notes are gone. Change Floor to minus 24 dB to see how much of the tail the meter hides.",
    tags: ["reverb tail", "floor", "decay", "ambient"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", ".", 7, ".", ".", ".", 5, ".", ".", ".", ".", ".", ".", "."], { rate: "1/4", root: "C", scale: "Major Pentatonic", octave: 1, shape: 0, gatelength: 0.2, env: { attack: 0.003, decay: 1.2, sustain: 0, release: 1 } });
  const verb = p.add("reverb", [3, 0], { size: 0.9, decay: 9, damping: 0.4, mix: 0.7, quality: "Eco (8 lines)" });
  p.cable(m.amp, "l", verb, "l").cable(m.amp, "l", verb, "r");
  const lm = p.add("level-meter", [4, 0], { response: 1.2, floor: "-96 dB", detector: "RMS", hold: "Until Reset" });
  const amp = p.add("vca", [5, 0], { gain: 2 }, { name: "Make-up" });
  p.stereo(verb, lm).stereo(lm, amp);
  p.stereo(amp, p.out);
  return p;
}

export default [masterCheck, duckedPad, loudnessFilter, beforeAfter, quietTail];
