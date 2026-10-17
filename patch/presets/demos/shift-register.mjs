// SPDX-License-Identifier: MIT
// Shift Register: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

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

function lockedMelody() {
  const p = patch("Shift Register: Frozen Eight-Note Loop", {
    module: "shift-register", tempo: 100,
    description: "Lock at its top position freezes the register, so its eight bits recycle forever as a fixed little melody in D minor pentatonic over two octaves. Change the seed or Length to get a different tune; Length 5 or 7 against the drums makes the melody drift against the beat.",
    tags: ["loop", "frozen", "melody", "pentatonic"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 1, length: 8, sync: "1/8", octaves: 2, root: "D", scale: "Minor Pentatonic", seed: 14, gatelength: 0.55, source: "Loop" });
  const lead = voice(p, [2, 0], [sr, "pitch"], [sr, "bit2"], { name: "Lead", shape: 0.4, env: { decay: 0.3, sustain: 0.1, release: 0.25 } });
  const drums = beat(p, [2, 3], { style: "half", level: -6 });
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: -1, pan1: 0.15, master: 0 }, { name: "Final" });
  both(p, lead.out, "l", fin, "in1l", "in1r");
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, fin, [6, 0], { size: 0.45, decay: 1.8, mix: 0.2 });
  return p;
}

function mutating() {
  const p = patch("Shift Register: Slowly Mutating Tune", {
    module: "shift-register", tempo: 92,
    description: "Lock sits just below frozen, so now and then a bit flips and the melody changes by a note or two instead of repeating exactly. A slow LFO nudges Lock between nearly frozen and quite loose; turn it down to hear the tune stay put, up to hear it wander.",
    tags: ["mutate", "evolving", "melody", "lock"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 0.8, length: 16, sync: "1/16", octaves: 2, root: "A", scale: "Dorian", seed: 3, gatelength: 0.45 });
  const lfo = p.add("lfo", [0, 3], { rate: 0.04, wave: "Triangle" }, { name: "Looseness" });
  p.cable(lfo, "out", sr, "lock", 0.12);
  const lead = voice(p, [2, 0], [sr, "pitch"], [sr, "bit1"], { name: "Lead", shape: 0.5, env: { decay: 0.2, sustain: 0.05, release: 0.2 }, filter: { cutoff: 3000, resonance: 0.2 } });
  const low = voice(p, [2, 3], [sr, "pitch", 0], [sr, "bit5"], { name: "Low", shape: 0.2, octave: -2, env: { decay: 0.4, sustain: 0.2, release: 0.3 } });
  const mix = bus(p, [5, 0], [{ node: lead.out, jack: "l", level: -2, pan: 0.2 }, { node: low.out, jack: "l", level: -4, pan: -0.2 }], 5, "Mix");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.4, mix: 0.25, highcut: 6000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.5, decay: 2.2, mix: 0.2 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

function canon() {
  const p = patch("Shift Register: Canon of Drums", {
    module: "shift-register", tempo: 110,
    description: "As the bits travel along the register, each bit output plays the same rhythm one step later than the one before, so a kick, snare, hat and clap echo one rhythm in canon. Change Length to reshape the pattern for all four at once, or Lock below the top to let it mutate.",
    tags: ["canon", "bits", "drums", "rhythm"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 1, length: 12, sync: "1/16", seed: 24, gatelength: 0.3 });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, decay: 0.45 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.55 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.42, closed: 0.035 });
  const clap = p.add("punch-clap", [2, 3], { level: 0.45 });
  p.cable(sr, "bit1", kick, "trig").cable(sr, "bit3", snare, "trig").cable(sr, "bit5", hats, "closed").cable(sr, "bit7", clap, "trig");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -13, pan: 0.3 }, { node: clap, level: -10, pan: -0.2 }], -4, "Kit");
  finish(p, mix, [5, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function dataIn() {
  const p = patch("Shift Register: Bits from a Data Input", {
    module: "shift-register", tempo: 120,
    description: "Source is set to Data, so the register is fed from a gate patched into its Data input, here a pair of square LFOs with different speeds mixed together. The register turns that slow on-off pattern into a lively stepped melody. Switch Source to Data ⊕ Loop to blend the old loop with the new input.",
    tags: ["data", "input", "feed", "generative"],
  });
  const sr = p.add("shift-register", [0, 0], { source: "Data", lock: 0.9, length: 8, sync: "1/16", octaves: 3, root: "G", scale: "Minor Pentatonic", seed: 6, gatelength: 0.5 });
  const a = p.add("lfo", [0, 3], { wave: "Square", rate: 0.9, polarity: "Unipolar" }, { name: "Data A" });
  const b = p.add("lfo", [0, 4], { wave: "Square", rate: 1.37, polarity: "Unipolar" }, { name: "Data B" });
  const xor = p.add("logic", [1, 3], {}, { name: "Data Mix" });
  p.cable(a, "out", xor, "a").cable(b, "out", xor, "b");
  p.cable(xor, "xor", sr, "data");
  const lead = voice(p, [2, 0], [sr, "pitch"], [sr, "bit1"], { name: "Lead", shape: 0.6, env: { decay: 0.2, sustain: 0.05, release: 0.2 }, filter: { cutoff: 2800, resonance: 0.25 } });
  const drums = beat(p, [2, 3], { style: "four", level: -6 });
  const fin = p.add("audio-mixer", [5, 0], { level1: -4, level2: -3, master: 0 }, { name: "Final" });
  both(p, lead.out, "l", fin, "in1l", "in1r");
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, fin, [6, 0], { size: 0.3, decay: 1.1, mix: 0.12 });
  return p;
}

function weighted() {
  const p = patch("Shift Register: Weighted Mix Filter", {
    module: "shift-register", tempo: 106,
    description: "The Mix output adds the bits up with the Weight knobs, here as a stepped voltage that sweeps the cutoff of a filter on a held saw bass, while Voltage plays the pitches. Change Weight 1 to 3 to reshape the sweep, or set a weight negative to flip it.",
    tags: ["weights", "mix", "filter", "bass"],
  });
  const sr = p.add("shift-register", [0, 0], { lock: 1, length: 8, sync: "1/8", octaves: 2, root: "E", scale: "Minor Pentatonic", seed: 19, gatelength: 0.8, w1: 1, w2: 0.5, w3: 0.25, w4: -0.4 });
  const osc = p.add("oscillator", [2, 0], { shape: 0.9, octave: "-2" }, { name: "Bass" });
  p.cable(sr, "pitch", osc, "pitch");
  const env = p.add("adsr", [2, 1], { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.2 }, { name: "Amp Env" });
  const amp = p.add("vca", [3, 0], {}, { name: "VCA" });
  const filt = p.add("filter", [4, 0], { cutoff: 400, resonance: 0.45, type: "Ladder Tanh", drive: 0.2 }, { name: "Swept Filter" });
  p.cable(sr, "bit1", env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain").cable(amp, "l", filt, "l").cable(sr, "mix", filt, "cutoff", 0.5);
  const drums = beat(p, [2, 3], { style: "sparse", level: -7 });
  const fin = p.add("audio-mixer", [6, 0], { level1: -3, level2: -5, master: 0 }, { name: "Final" });
  p.stereo(filt, fin, { to: ["in1l", "in1r"] }).stereo(drums, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, fin, [7, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

export default [lockedMelody, mutating, canon, dataIn, weighted];
