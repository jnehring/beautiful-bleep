// SPDX-License-Identifier: MIT
// Rhythm Bank: five demo patches. Each plays by itself with the transport.
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

function evenKit() {
  const p = patch("Rhythm Bank: Even Groove Kit", {
    module: "rhythm-bank", tempo: 110,
    description: "The Even family spreads hits as evenly as it can: four related rhythms of different density drive a kick, snare, hats and a rim. Turn Pattern to change all four grooves at once, or turn Width for longer or shorter gates.",
    tags: ["even", "drums", "pattern", "groove"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { pattern: 14, family: "Even", length: "16", rate: "1/16", rotate2: 4, rotate4: 2, output: "Trigger" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.45, closed: 0.04 });
  const rim = p.add("punch-rim", [2, 3], { level: 0.45, tune: 3 });
  p.cable(rb, "out1", kick, "trig").cable(rb, "out2", snare, "trig").cable(rb, "out3", hats, "closed").cable(rb, "out4", rim, "trig");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 }, { node: rim, level: -12, pan: -0.3 }], -6, "Kit");
  finish(p, mix, [5, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function primes() {
  const p = patch("Rhythm Bank: Prime Cycles", {
    module: "rhythm-bank", tempo: 96,
    description: "Length 15 and the Prime family give four rhythms with uneven, prime-based spacing, each playing a different pluck of an A minor chord. Because the lengths never line up the same way twice, the figure keeps turning; try Family = Poly for a different split.",
    tags: ["prime", "polyrhythm", "plucks", "chord"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { pattern: 20, family: "Prime", length: "15", rate: "1/8", output: "Gate", width: 0.3 });
  const vs = [-12, -5, 0, 7].map((n, i) => voice(p, [2, i * 2], null, [rb, `out${i + 1}`], { name: `Pluck ${i + 1}`, shape: 0.3 + i * 0.12, osc: { coarse: n },
    env: { attack: 0.01, decay: 0.9, sustain: 0.25, release: 0.7 } }));
  const mix = bus(p, [5, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: 0, pan: -0.6 + i * 0.4 })), 6, "Plucks");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.38, mix: 0.28, highcut: 5000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.5, decay: 2.5, mix: 0.25 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

function browsing() {
  const p = patch("Rhythm Bank: Pattern Browser", {
    module: "rhythm-bank", tempo: 118,
    description: "A stepped random LFO picks a new Pattern number every bar, and Change is set to Cycle so each new rhythm waits for the end of the current one: the part develops by itself without a break. Set Change to Step to switch mid-pattern, or turn the LFO cable down to stay near one groove.",
    tags: ["pattern", "browse", "random", "develop"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { pattern: 0, family: "Metric", length: "16", rate: "1/16", change: "Cycle", output: "Trigger" });
  const lfo = p.add("lfo", [0, 3], { wave: "Random Step", sync: "Tempo", division: "1/1", polarity: "Unipolar" }, { name: "Picker" });
  p.cable(lfo, "out", rb, "pattern", 0.5);
  const kick = p.add("ring-kick", [2, 0], { level: 0.85, decay: 0.6 });
  const snare = p.add("ring-snare", [2, 1], { level: 0.55 });
  const hats = p.add("ring-hats", [2, 2], { level: 0.4 });
  const bell = p.add("ring-cowbell", [2, 3], { level: 0.4, decay: 0.25 });
  p.cable(rb, "out1", kick, "trig").cable(rb, "out2", snare, "trig").cable(rb, "out3", hats, "closed").cable(rb, "out4", bell, "trig");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -13, pan: 0.3 }, { node: bell, level: -14, pan: -0.3 }], 2, "Kit");
  finish(p, mix, [5, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

function interlock() {
  const p = patch("Rhythm Bank: Interlocking Pair", {
    module: "rhythm-bank", tempo: 100,
    description: "With Complement set to Pairs, output 2 fills the gaps left by output 1 (and 4 those of 3), so a low and a high voice share one steady line like two hands. Switch Complement to Off to hear the raw rhythms collide, or to Avoid to keep them from landing together.",
    tags: ["complement", "interlock", "call and response", "bass"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { pattern: 37, family: "Interlock", length: "16", rate: "1/16", complement: "Pairs", output: "Gate", width: 0.4 });
  const low = voice(p, [2, 0], null, [rb, "out1"], { name: "Low", shape: 0.25, octave: -2, env: { decay: 0.25, sustain: 0.1 }, filter: { cutoff: 600, resonance: 0.3 } });
  const high = voice(p, [2, 2], null, [rb, "out2"], { name: "High", shape: 0.5, octave: 0, osc: { coarse: 7 }, env: { decay: 0.15, sustain: 0 }, filter: { cutoff: 3500, resonance: 0.2 } });
  const kick = p.add("punch-kick", [2, 4], { level: 0.8 });
  const hats = p.add("punch-hats", [3, 4], { level: 0.4 });
  p.cable(rb, "out3", kick, "trig").cable(rb, "out4", hats, "closed");
  const mix = bus(p, [5, 0], [{ node: low.out, jack: "l", level: -4, pan: -0.2 }, { node: high.out, jack: "l", level: -8, pan: 0.3 },
    { node: kick, level: -6 }, { node: hats, level: -16, pan: 0.4 }], 0, "Mix");
  finish(p, mix, [6, 0], { size: 0.35, decay: 1.2, mix: 0.15 });
  return p;
}

function seeded() {
  const p = patch("Rhythm Bank: Seeded Open Loop", {
    module: "rhythm-bank", tempo: 126,
    description: "Length is Open, so the rhythms never loop, and the Seeded family makes up a fresh but related set from the Pattern number. Rotate nudges each rhythm against the others and Grid Free lets hits sit between steps; set Length back to 16 to hear a plain loop.",
    tags: ["seeded", "open", "rotate", "generative"],
  });
  const rb = p.add("rhythm-bank", [0, 0], { pattern: 63, family: "Seeded", length: "Open", rate: "1/16", rotate1: 1, rotate3: -2, grid: "Free", output: "Trigger" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, tune: 52 });
  const clap = p.add("punch-clap", [2, 1], { level: 0.55 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.45, closed: 0.035, tone: 0.65 });
  const tom = p.add("punch-tom", [2, 3], { level: 0.65, tune: 150 });
  p.cable(rb, "out1", kick, "trig").cable(rb, "out2", clap, "trig").cable(rb, "out3", hats, "closed").cable(rb, "out4", tom, "trig");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: clap, level: -9, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 }, { node: tom, level: -9, pan: -0.3 }], 0, "Kit");
  finish(p, mix, [5, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

export default [evenKit, primes, browsing, interlock, seeded];
