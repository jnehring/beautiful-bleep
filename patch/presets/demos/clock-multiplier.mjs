// SPDX-License-Identifier: GPL-3.0-only
// Clock Mult: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

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

function ratios() {
  const p = patch("Clock Mult: Drifting Percussion", {
    module: "clock-multiplier", tempo: 112,
    description: "One quarter-note clock becomes a kick on the beat, hats at four per beat, a rim at 3/2 and a cowbell at 5/4: the last two drift against the kick and meet it again every few beats. Change a Ratio knob and the layer re-tunes.",
    tags: ["ratios", "polyrhythm", "percussion", "drums"],
  });
  const cm = p.add("clock-multiplier", [0, 0], { ratio1: "1", ratio2: "4", ratio3: "3/2", ratio4: "5/4", ratio5: "1/2", output: "Trigger" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85 });
  const hats = p.add("punch-hats", [2, 1], { level: 0.4, closed: 0.035 });
  const rim = p.add("punch-rim", [2, 2], { level: 0.5, tune: 2 });
  const bell = p.add("ring-cowbell", [2, 3], { level: 0.4, decay: 0.2 });
  const clap = p.add("punch-clap", [3, 0], { level: 0.55 });
  p.cable(cm, "out1", kick, "trig").cable(cm, "out2", hats, "closed").cable(cm, "out3", rim, "trig").cable(cm, "out4", bell, "trig").cable(cm, "out5", clap, "trig");
  const mix = bus(p, [5, 0], [{ node: kick, level: -3 }, { node: hats, level: -13, pan: 0.3 }, { node: rim, level: -10, pan: -0.3 },
    { node: bell, level: -13, pan: 0.45 }, { node: clap, level: -9, pan: 0.1 }], 0, "Kit");
  finish(p, mix, [7, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

function swungHats() {
  const p = patch("Clock Mult: Swung Hats", {
    module: "clock-multiplier", tempo: 118,
    description: "Swing on a Clock Mult output moves only the in-between ticks: the kick and the snare sit on the beat while the sixteenth hats lean late. Turn Swing up for a harder shuffle, Humanize for a looser hand, or raise Skip 3 for fewer ghost hats.",
    tags: ["swing", "shuffle", "hats", "humanize"],
  });
  const cm = p.add("clock-multiplier", [0, 0], { ratio1: "1", ratio2: "1/2", ratio3: "4", ratio4: "2", swing: 0.6, humanize: 0.15, skip3: 0.2, output: "Trigger", width: 0.3 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.4, closed: 0.03 });
  const open = p.add("punch-hats", [2, 3], { level: 0.35, open: 0.3 }, { name: "Open Hat" });
  p.cable(cm, "out1", kick, "trig").cable(cm, "out2", snare, "trig").cable(cm, "out3", hats, "closed").cable(cm, "out4", open, "open");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 }, { node: open, level: -15, pan: -0.3 }], 0, "Kit");
  finish(p, mix, [6, 0], { size: 0.3, decay: 1.0, mix: 0.1 });
  return p;
}

function arpClock() {
  const p = patch("Clock Mult: Clock for a Line", {
    module: "clock-multiplier", tempo: 100,
    description: "A Step Sequencer has no clock of its own: it takes Out 1 of Clock Mult at four ticks per beat with a late swing, and the bass takes Out 2 at one per beat. Change Ratio 1 to 3 or 3/2 for a different gait; the line follows the multiplier.",
    tags: ["sequencer", "clock", "swing", "bass"],
  });
  const cm = p.add("clock-multiplier", [0, 0], { ratio1: "4", ratio2: "1", ratio3: "1/2", swing: 0.45, humanize: 0.1, output: "Trigger" });
  const lead = melody(p, [2, 0], [0, null, 7, 3, null, 10, 7, null, 12, 7, null, 3, 5, null, 7, 10], { rate: "1/16", octave: 1, shape: 0.6, env: { decay: 0.2, sustain: 0 } });
  const bass = melody(p, [2, 3], [0, null, 0, null, -5, null, -2, null], { rate: "1/8", octave: -1, shape: 0.9, env: { decay: 0.35, sustain: 0.1 } });
  p.cable(cm, "out1", lead.seq, "clock").cable(cm, "out2", bass.seq, "clock");
  const kick = p.add("punch-kick", [5, 3], { level: 0.8 });
  p.cable(cm, "out2", kick, "trig");
  const mix = bus(p, [6, 0], [{ node: lead.amp, jack: "l", level: -9, pan: 0.2 }, { node: bass.amp, jack: "l", level: -6 }, { node: kick, level: -6 }], 0, "Mix");
  finish(p, mix, [8, 0], { size: 0.4, decay: 1.3, mix: 0.14 });
  return p;
}

function bells() {
  const p = patch("Clock Mult: Fractional Bells", {
    module: "clock-multiplier", tempo: 76,
    description: "Four bell tones ring at 2/3, 3/4, 5/4 and 7/4 of the clock with Skip on the busy ones, so a calm pentatonic cloud never quite repeats. Move one Ratio by a step and the whole constellation shifts.",
    tags: ["bells", "ambient", "polyrhythm", "generative"],
  });
  const cm = p.add("clock-multiplier", [0, 0], { ratio1: "2/3", ratio2: "3/4", ratio3: "5/4", ratio4: "7/4", skip3: 0.3, skip4: 0.45, humanize: 0.4, keepbeat: false, output: "Gate", width: 0.2, base: "1/4" });
  const vs = [0, 7, 4, 9].map((n, i) => voice(p, [2, i * 2], null, [cm, `out${i + 1}`], { name: `Bell ${i + 1}`, shape: 0, osc: { coarse: n },
    env: { attack: 0.003, decay: 1.6, sustain: 0, release: 1.2 }, octave: i > 1 ? 1 : 0 }));
  const mix = bus(p, [5, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: -3, pan: -0.6 + i * 0.4 })), 3, "Bells");
  const v = p.add("reverb", [6, 0], { size: 0.8, decay: 6, mix: 0.4 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function chained() {
  const p = patch("Clock Mult: Chained from a Divider", {
    module: "clock-multiplier", tempo: 126,
    description: "Clock Div turns the 16th grid into a slow beat-rate pulse, and Clock Mult's Clock jack counts those pulses and multiplies them back up: tight at full Phase Lock, and a flywheel that keeps going at zero. Try 3 and 5/4 against the divider's own outputs.",
    tags: ["clock", "phase lock", "chain", "drums"],
  });
  const cd = p.add("clock-divider", [0, 0], { div1: 4, base: "1/16", output: "Trigger" });
  const cm = p.add("clock-multiplier", [1, 0], { ratio1: "4", ratio2: "3", ratio3: "1", ratio4: "1/2", ratio5: "8", ratio6: "5/4", skip1: 0.15, skip5: 0.45, humanize: 0.2, swing: 0.3, lock: 0.8, output: "Trigger", syncto: "Clock" });
  p.cable(cd, "out1", cm, "clock");
  const kick = p.add("punch-kick", [3, 0], { level: 0.85 });
  const snare = p.add("punch-snare", [3, 1], { level: 0.55 });
  const hats = p.add("punch-hats", [3, 2], { level: 0.4, closed: 0.03 });
  const rim = p.add("punch-rim", [3, 3], { level: 0.45 });
  const bell = p.add("ring-cowbell", [4, 0], { level: 0.35, decay: 0.18 });
  p.cable(cm, "out3", kick, "trig").cable(cm, "out4", snare, "trig").cable(cm, "out1", hats, "closed").cable(cm, "out2", rim, "trig").cable(cm, "out6", bell, "trig");
  const mix = bus(p, [6, 0], [{ node: kick, level: -3 }, { node: snare, level: -8, pan: 0.1 }, { node: hats, level: -13, pan: 0.3 }, { node: rim, level: -10, pan: -0.3 }, { node: bell, level: -14, pan: 0.4 }], 0, "Kit");
  finish(p, mix, [8, 0], { size: 0.3, decay: 1.0, mix: 0.1 });
  return p;
}

export default [ratios, swungHats, arpClock, bells, chained];
