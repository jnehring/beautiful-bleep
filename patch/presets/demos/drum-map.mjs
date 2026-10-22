// SPDX-License-Identifier: MIT
// Drum Map: five demo patches. Each plays by itself with the transport.
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

/// A punch kit on a Drum Map: kick, snare, hats (accents and velocities patched), mixed. Returns {kick, snare, hats, mix}.
function kit(p, dm, at, o = {}) {
  const [c, r] = at;
  const kick = p.add("punch-kick", [c, r], { level: 0.85, decay: 0.5, ...(o.kick || {}) });
  const snare = p.add("punch-snare", [c, r + 1], { level: 0.65, snappy: 0.65, ...(o.snare || {}) });
  const hats = p.add("punch-hats", [c, r + 2], { level: 0.5, closed: 0.04, ...(o.hats || {}) });
  p.cable(dm, "kick", kick, "trig").cable(dm, "kickvel", kick, "velocity").cable(dm, "snare", snare, "trig").cable(dm, "snarevel", snare, "velocity")
    .cable(dm, "hats", hats, "closed").cable(dm, "hatsvel", hats, "velocity");
  const mix = bus(p, [c + 2, r], [{ node: kick, level: -3 }, { node: snare, level: -6, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 }],
    o.master ?? -2, "Drum Mix");
  return { kick, snare, hats, mix };
}

function wandering() {
  const p = patch("Drum Map: Wandering the Map", {
    module: "drum-map", tempo: 118,
    description: "Two slow LFOs move X and Y through the map, so the beat drifts from sparse to busy and back without ever repeating exactly. Grab the X and Y knobs yourself to park on a pattern you like; the three Density knobs thin out any spot.",
    tags: ["map", "x y", "evolving", "drums"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.5, y: 0.5, seed: 7, kickdensity: 0.6, snaredensity: 0.55, hatsdensity: 0.6 });
  const lx = p.add("lfo", [0, 3], { rate: 0.03, wave: "Triangle", polarity: "Unipolar" }, { name: "X Drift" });
  const ly = p.add("lfo", [1, 3], { rate: 0.021, wave: "Sine", polarity: "Unipolar", phase: 90 }, { name: "Y Drift" });
  p.cable(lx, "out", dm, "x").cable(ly, "out", dm, "y");
  const k = kit(p, dm, [2, 0]);
  const m = melody(p, [2, 4], [0, ".", ".", 7, ".", 5, ".", "."], { rate: "1/8", root: "D", scale: "Dorian", octave: -1, shape: 0.3, env: { decay: 0.2, sustain: 0 } });
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: -9, master: 0 }, { name: "Final" });
  p.stereo(k.mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  both(p, m.amp, "l", fin, "in2l", "in2r");
  finish(p, fin, [6, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

function sparseFill() {
  const p = patch("Drum Map: Sparse with Fills", {
    module: "drum-map", tempo: 90,
    description: "Low Density settings leave a spacious beat with only the strongest hits, and a square LFO holds the Fill input for the last bar of every four. Raise Fill Amount for a bigger fill, or raise a Density knob to bring a drum back in.",
    tags: ["fill", "density", "sparse", "drums"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.3, y: 0.6, seed: 3, kickdensity: 0.3, snaredensity: 0.3, hatsdensity: 0.35, fillamount: 0.75, length: 16 });
  const fill = p.add("lfo", [0, 3], { wave: "Square", sync: "Tempo", division: "4 bars", pw: 0.25, polarity: "Unipolar", phase: 270 }, { name: "Fill Gate" });
  p.cable(fill, "out", dm, "fill");
  const k = kit(p, dm, [2, 0], { master: 0 });
  const pad = voice(p, [2, 4], null, [dm, "kick"], { name: "Low Tone", shape: 0.2, octave: -1, env: { attack: 0.02, decay: 0.8, sustain: 0.0, release: 0.5 }, osc: { coarse: -4 } });
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: -10, master: 1 }, { name: "Final" });
  p.stereo(k.mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  both(p, pad.amp, "l", fin, "in2l", "in2r");
  finish(p, fin, [6, 0], { size: 0.5, decay: 1.8, mix: 0.2 });
  return p;
}

function chaos() {
  const p = patch("Drum Map: Chaos Re-roll", {
    module: "drum-map", tempo: 132,
    description: "Chaos at 55 % swaps in a few random changes every bar, a lively breakbeat that is never quite the same twice. Set Chaos Rate to Frozen, or change the Seed, to lock in a version you like.",
    tags: ["chaos", "random", "breakbeat", "seed"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.8, y: 0.3, chaos: 0.55, chaosrate: "Every bar", seed: 21, swing: 0.54, kickdensity: 0.65, snaredensity: 0.6, hatsdensity: 0.7 });
  const k = kit(p, dm, [2, 0], { kick: { tune: 55 }, snare: { tune: 220, decay: 0.2 }, hats: { crunch: 0.6, tone: 0.65 }, master: 0 });
  finish(p, k.mix, [4, 0], { size: 0.25, decay: 0.8, mix: 0.1 });
  return p;
}

function shuffle() {
  const p = patch("Drum Map: Triplet Shuffle", {
    module: "drum-map", tempo: 96,
    description: "Rate 1/16T and a 24-step Length turn the map into a rolling triplet shuffle, with Swing and Accent adding a lazy push on top. Switch Rate back to 1/16 to hear the same map played straight.",
    tags: ["shuffle", "triplet", "swing", "length"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.65, y: 0.7, seed: 9, rate: "1/16T", length: 24, swing: 0.58, accent: 0.95, kickdensity: 0.6, snaredensity: 0.6, hatsdensity: 0.75 });
  const k = kit(p, dm, [2, 0], { kick: { tune: 48, decay: 0.7 }, snare: { tone: 0.35 }, master: 0 });
  const bass = voice(p, [2, 4], null, [dm, "kick"], { name: "Bass", shape: 0.25, octave: -2, env: { decay: 0.35, sustain: 0.1 }, filter: { cutoff: 500, resonance: 0.3 }, osc: { coarse: 5 } });
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: -9, master: 0 }, { name: "Final" });
  p.stereo(k.mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  both(p, bass.out, "l", fin, "in2l", "in2r");
  finish(p, fin, [6, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function notesOut() {
  const p = patch("Drum Map: Notes to Other Drums", {
    module: "drum-map", tempo: 104,
    description: "The Notes output sends the map as note events (Kick Note, Snare Note, Hats Note), and Drum Notes turns them into triggers for a different kit: a ring kick, a clap on the snare note and a cowbell on the hats note. Change the three note settings to move a part to another drum.",
    tags: ["notes", "midi", "drum notes", "layout"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.45, y: 0.4, seed: 15, snarenote: 39, hatsnote: 56, kickdensity: 0.55, snaredensity: 0.5, hatsdensity: 0.45, notelength: 0.3 });
  const dn = p.add("drum-notes", [1, 0], {});
  p.cable(dm, "notes", dn, "notes");
  const kick = p.add("ring-kick", [2, 0], { level: 0.85, decay: 0.7 });
  const clap = p.add("ring-clap", [2, 1], { level: 0.6 });
  const bell = p.add("ring-cowbell", [2, 2], { level: 0.45, tune: -2, decay: 0.3 });
  p.cable(dn, "kick", kick, "trig").cable(dn, "velocity", kick, "velocity").cable(dn, "clap", clap, "trig").cable(dn, "bell", bell, "trig");
  const mix = bus(p, [4, 0], [{ node: kick, level: -3 }, { node: clap, level: -7, pan: 0.15 }, { node: bell, level: -12, pan: -0.3 }], 0, "Kit");
  finish(p, mix, [5, 0], { size: 0.4, decay: 1.3, mix: 0.15 });
  return p;
}

export default [wandering, sparseFill, chaos, shuffle, notesOut];
