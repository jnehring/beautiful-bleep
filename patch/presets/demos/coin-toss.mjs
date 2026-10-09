// SPDX-License-Identifier: MIT
// Coin Toss: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern, semis } from "../kit.mjs";

/// A step-sequencer used as a plain clock: a gate on every step (or the given steps).
function clock(p, at, rate, name = "Clock", notes = null) {
  return p.add("step-sequencer", at, { length: 16, rate, gatelength: 0.5 },
    { data: steps(notes || new Array(16).fill(0)) }, { name });
}
const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator → ADSR-driven VCA, gated by a gate jack. Returns {osc, env, amp}.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.5, octave: oct(o.octave ?? 0), fine: o.fine ?? 0, coarse: o.coarse ?? 0 }, { name: o.name || "Voice" });
  const env = p.add("adsr", [c, r + 1], { attack: o.attack ?? 0.004, decay: o.decay ?? 0.3, sustain: o.sustain ?? 0, release: o.release ?? 0.2 }, { name: "Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(pitch.node, pitch.jack, osc, "pitch");
  p.cable(gate.node, gate.jack, env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return { osc, env, amp };
}
function sum(p, at, list, master = -3, name = "Mix") {
  const vals = { master };
  list.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -3; vals[`pan${i + 1}`] = x.pan ?? 0; });
  const m = p.add("audio-mixer", at, vals, { name });
  list.forEach((x, i) => p.cable(x.node, x.jack || "l", m, `in${i + 1}l`));
  return m;
}

function headsOrTails() {
  const p = patch("Coin Toss: Heads or Tails Drums", {
    module: "coin-toss", tempo: 112,
    description: "A steady sixteenth-note gate is tossed twice: channel 1 sends each step to a closed hat or a quiet snare ghost note, channel 2 (with some Memory, so it comes in runs) occasionally turns it into an open hat. The kick and backbeat stay fixed, the rest never repeats. Move Probability 1 and 2.",
    tags: ["drums", "probability", "ghost notes", "hats"],
  });
  const clk = clock(p, [0, 0], "1/16", "16th Gates");
  const coin = p.add("coin-toss", [1, 0], { prob1: 0.22, prob2: 0.12, memory1: 0.2, memory2: 0.45, mode1: "Trigger", mode2: "Trigger", link: "Independent", seed: 14 });
  p.cable(clk, "gate", coin, "in1");
  const grid = p.add("drum-grid", [0, 3], {}, { data: drumGrid(["Kick", "Snare", "Clap"], [pattern("Backbone",
    ["X.....x...X.....", "....X.......X...", "................"])]) });
  const kick = p.add("punch-kick", [2, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.7 });
  const ghost = p.add("punch-snare", [2, 2], { level: 0.3, snappy: 0.9, decay: 0.12, tune: 260 }, { name: "Ghost Snare" });
  const hats = p.add("punch-hats", [2, 3], { level: 0.55, closed: 0.04, open: 0.35 });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity").cable(grid, "gate2", snare, "trig")
    .cable(grid, "velocity2", snare, "velocity")
    .cable(coin, "b1", ghost, "trig").cable(coin, "a1", hats, "closed").cable(coin, "b2", hats, "open");
  const bseq = p.add("step-sequencer", [0, 5], { length: 16, rate: "1/8", root: "F", scale: "Minor Pentatonic", octave: -1, gatelength: 0.6 },
    { data: steps([0, ".", 0, ".", 3, ".", 0, 5, 0, ".", 0, ".", 7, ".", 5, 3]) }, { name: "Bass Line" });
  const bass = voice(p, [1, 5], { node: bseq, jack: "pitch" }, { node: bseq, jack: "gate" }, { shape: 0.55, decay: 0.3, sustain: 0.2, name: "Bass" });
  const mix = sum(p, [4, 0], [{ node: kick, jack: "out", level: -2 }, { node: snare, jack: "out", level: -3, pan: 0.1 },
    { node: ghost, jack: "out", level: -4, pan: -0.25 }, { node: hats, jack: "out", level: -3, pan: 0.3 }], -2, "Drums");
  const out = p.add("audio-mixer", [5, 1], { level1: -1, level2: -3, master: -3 }, { name: "Final" });
  p.cable(bass.amp, "l", out, "in2l").cable(bass.amp, "l", out, "in2r").stereo(mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  const verb = p.add("reverb", [6, 0], { size: 0.3, decay: 1.2, mix: 0.15 });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function tradingVoices() {
  const p = patch("Coin Toss: Trading Voices", {
    module: "coin-toss", tempo: 100,
    description: "One pentatonic melody is dealt note by note to two different instruments: a round low pluck on A and a bright high one on B, panned apart. Memory makes them trade in runs instead of strictly alternating. Raise Memory 1 for longer runs, move Probability 1 towards one side.",
    tags: ["melody", "split", "memory", "pentatonic"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "G", scale: "Major Pentatonic", gatelength: 0.55 },
    { data: steps([0, 2, 4, 7, 4, 2, 0, "_", 9, 7, 4, 2, 4, 7, 9, 12]) });
  const coin = p.add("coin-toss", [1, 0], { prob1: 0.5, memory1: 0.45, mode1: "Trigger", seed: 5 });
  p.cable(seq, "gate", coin, "in1");
  const low = voice(p, [2, 0], { node: seq, jack: "pitch" }, { node: coin, jack: "a1" }, { shape: 0.2, octave: -1, decay: 0.45, name: "Low Pluck" });
  const high = voice(p, [2, 3], { node: seq, jack: "pitch" }, { node: coin, jack: "b1" }, { shape: 0.85, octave: 1, decay: 0.22, name: "High Pluck" });
  const mix = sum(p, [4, 0], [{ node: low.amp, level: -2, pan: -0.45 }, { node: high.amp, level: -8, pan: 0.45 }], 6);
  const flt = p.add("filter", [5, 0], { cutoff: 3500, resonance: 0.15, type: "SVF Multimode" });
  const dly = p.add("delay-network", [6, 0], { sync: "1/8.", taps: 3, feedback: 0.4, tone: -0.3, width: 1, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [7, 0], { size: 0.6, decay: 3, mix: 0.25 });
  p.stereo(mix, flt, { from: ["outl", "outr"] }).stereo(flt, dly).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

function latchLayers() {
  const p = patch("Coin Toss: Latch Layers", {
    module: "coin-toss", tempo: 96,
    description: "Both channels are in Latch mode, so A and B are always opposite. Channel 1 tosses once a bar and decides whether the pad or the arpeggio is muted; channel 2 independently switches the drums on or off. The song re-arranges itself. Change Mode to Trigger or Toggle, or the Seed.",
    tags: ["latch", "arrangement", "mute", "layers"],
  });
  const bar = p.add("lfo", [0, 0], { wave: "Square", sync: "1 bar", pw: 0.5, polarity: "Unipolar" }, { name: "Bar Gate" });
  const two = p.add("lfo", [0, 1], { wave: "Square", sync: "2 bars", pw: 0.5, polarity: "Unipolar" }, { name: "Two-bar Gate" });
  const coin = p.add("coin-toss", [1, 0], { prob1: 0.5, prob2: 0.4, memory1: 0.3, memory2: 0.3, mode1: "Latch", mode2: "Latch", link: "Independent", seed: 3 });
  p.cable(bar, "out", coin, "in1").cable(two, "out", coin, "in2");
  // Layer 1: a pad on the chord roots.
  const prog = p.add("step-sequencer", [0, 3], { length: 4, rate: "1/1", root: "D", scale: "Natural Minor", gatelength: 0.98 },
    { data: steps([0, 8, 5, 7]) }, { name: "Chords" });
  const padEnv = p.add("adsr", [2, 4], { attack: 0.5, decay: 1, sustain: 0.8, release: 1.5 }, { name: "Pad Env" });
  const padVca = p.add("vca", [3, 3], {}, { name: "Pad VCA" });
  const padOscs = [0, 3, 7].map((semi, i) => {
    const o = p.add("oscillator", [2, 3 + i * 0], { shape: 0.65, coarse: semi, fine: (i - 1) * 8 }, { name: `Pad ${i + 1}` });
    p.cable(prog, "pitch", o, "pitch");
    return { node: o, jack: "out", level: -9, pan: (i - 1) * 0.5 };
  });
  const padMix = sum(p, [2, 6], padOscs, -2, "Pad Sum");
  p.cable(prog, "gate", padEnv, "gate").stereo(padMix, padVca, { from: ["outl", "outr"] }).cable(padEnv, "env", padVca, "gain");
  // Layer 2: an arpeggio.
  const arp = p.add("step-sequencer", [0, 8], { length: 16, rate: "1/16", root: "D", scale: "Natural Minor", octave: 1, gatelength: 0.4 },
    { data: steps([0, 4, 7, 11, 7, 4, 0, 4, 2, 5, 9, 12, 9, 5, 2, 5]) }, { name: "Arpeggio" });
  const av = voice(p, [3, 8], { node: arp, jack: "pitch" }, { node: arp, jack: "gate" }, { shape: 0.4, decay: 0.2, name: "Arp Voice" });
  // Layer 3: drums.
  const grid = p.add("drum-grid", [0, 10], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat"], [pattern("Pulse",
    ["X...x...X...x...", "....X.......X...", "x.x.x.x.x.x.x.x."])]) });
  const kick = p.add("punch-kick", [2, 10], { level: 0.8 });
  const snare = p.add("punch-snare", [2, 11], { level: 0.5 });
  const hat = p.add("punch-hats", [2, 12], { level: 0.4 });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "gate2", snare, "trig").cable(grid, "gate3", hat, "closed");
  const drumMix = sum(p, [4, 10], [{ node: kick, jack: "out", level: -2 }, { node: snare, jack: "out", level: -4 }, { node: hat, jack: "out", level: -7, pan: 0.2 }], -2, "Drum Sum");
  const mix = p.add("audio-mixer", [5, 3], { level1: -3, level2: -5, level3: -6, master: 4 }, { name: "Layers" });
  p.stereo(padVca, mix, { to: ["in1l", "in1r"] }).cable(av.amp, "l", mix, "in2l").cable(av.amp, "l", mix, "in2r")
    .stereo(drumMix, mix, { from: ["outl", "outr"], to: ["in3l", "in3r"] });
  p.cable(coin, "a1", mix, "mute1in").cable(coin, "b1", mix, "mute2in").cable(coin, "a2", mix, "mute3in");
  const verb = p.add("reverb", [6, 3], { size: 0.8, decay: 4.5, mix: 0.3 });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function fixedRandomGroove() {
  const p = patch("Coin Toss: Looped Groove", {
    module: "coin-toss", tempo: 124,
    description: "Link is Shared and Loop is 16 tosses: one coin decides a nested pattern, a 30 % clap and a 70 % closed hat that always contains it, and the whole random figure repeats every bar over a steady kick and bass. Change the Seed for another groove, or Loop to Off to let it wander.",
    tags: ["loop", "shared", "nested", "techno"],
  });
  const clk = clock(p, [0, 0], "1/16", "16th Gates");
  const coin = p.add("coin-toss", [1, 0], { prob1: 0.3, prob2: 0.7, mode1: "Trigger", mode2: "Trigger", link: "Shared", loop: "16 tosses", seed: 27 });
  p.cable(clk, "gate", coin, "in1");
  const grid = p.add("drum-grid", [0, 3], {}, { data: drumGrid(["Kick"], [pattern("Four", ["X...X...X...X..."])]) });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, tune: 48, decay: 0.45 });
  const clap = p.add("punch-clap", [2, 1], { tone: 1800, decay: 0.3 });
  const hat = p.add("punch-hats", [2, 2], { level: 0.5, closed: 0.035 });
  const tick = p.add("perc-voice", [2, 3], { pitch: 900, tone: 0.8, decay: 0.07, level: 0.4, engine: "FM" }, { name: "Tick" });
  p.cable(grid, "gate1", kick, "trig").cable(coin, "b1", clap, "trig").cable(coin, "b2", hat, "closed").cable(coin, "a2", tick, "trig");
  const bseq = p.add("step-sequencer", [0, 5], { length: 16, rate: "1/16", root: "A", scale: "Minor Pentatonic", octave: -1, gatelength: 0.5 },
    { data: steps([".", ".", 0, ".", ".", ".", 0, ".", ".", ".", 3, ".", ".", ".", 0, "."]) }, { name: "Offbeat Bass" });
  const bass = voice(p, [1, 5], { node: bseq, jack: "pitch" }, { node: bseq, jack: "gate" }, { shape: 0.8, decay: 0.2, sustain: 0.1, name: "Bass" });
  const flt = p.add("filter", [3, 5], { cutoff: 600, resonance: 0.4, type: "Ladder Tanh" });
  const lfo = p.add("lfo", [3, 6], { rate: 0.08 }, { name: "Sweep" });
  p.cable(bass.amp, "l", flt, "l").cable(bass.amp, "l", flt, "r").cable(lfo, "out", flt, "cutoff", 0.25);
  const mix = sum(p, [4, 0], [{ node: kick, jack: "out", level: -2 }, { node: clap, jack: "out", level: -6, pan: -0.1 },
    { node: hat, jack: "out", level: -5, pan: 0.3 }, { node: tick, jack: "l", level: -9, pan: -0.3 }], -3, "Drums");
  const out = p.add("audio-mixer", [5, 1], { level1: -2, level2: -2, master: -1 }, { name: "Final" });
  p.stereo(mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(flt, out, { to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [6, 0], { size: 0.4, decay: 1.5, mix: 0.12 });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function coinPitch() {
  const p = patch("Coin Toss: Coin on the Pitch", {
    module: "coin-toss", tempo: 88,
    description: "The Coin outputs are control voltages: channel 1 in Toggle mode occasionally flips a switch that lifts a bell melody up a fifth, channel 2 in Latch mode opens or closes a low-pass filter on a drone with each toss. Nothing is gated; the coin steers the sound. Change Probability 1 to flip more often.",
    tags: ["control", "toggle", "modulation", "bells"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "E", scale: "Minor Pentatonic", gatelength: 0.5 },
    { data: steps([0, 3, 7, 3, 5, 3, 7, 10]) });
  const coin = p.add("coin-toss", [1, 0], { prob1: 0.2, prob2: 0.5, memory2: 0.4, mode1: "Toggle", mode2: "Latch", link: "Independent", seed: 9 });
  const slow = p.add("step-sequencer", [0, 2], { length: 1, rate: "1/2", gatelength: 0.5 }, { data: steps([0]) }, { name: "Toss Clock" });
  p.cable(seq, "gate", coin, "in1").cable(slow, "gate", coin, "in2");
  const bell = voice(p, [2, 0], null, { node: seq, jack: "gate" }, { shape: 0.05, decay: 0.7, release: 0.5, name: "Bell" });
  p.cable(seq, "pitch", bell.osc, "pitch").cable(coin, "coin1", bell.osc, "pitch", semis(7));
  const fm = p.add("oscillator", [2, 2], { shape: 0.05, octave: "+1", fine: 3 }, { name: "Bell Overtone" });
  p.cable(seq, "pitch", fm, "pitch").cable(coin, "coin1", fm, "pitch", semis(7));
  const fvca = p.add("vca", [3, 2], {}, { name: "Overtone VCA" });
  p.cable(fm, "out", fvca, "l").cable(bell.env, "env", fvca, "gain");
  // Drone with a coin-driven filter.
  const d1 = p.add("oscillator", [2, 4], { shape: 0.7, octave: "-2", fine: -6 }, { name: "Drone 1" });
  const d2 = p.add("oscillator", [2, 5], { shape: 0.7, octave: "-1", coarse: 7, fine: 6 }, { name: "Drone 2" });
  const dm = sum(p, [3, 4], [{ node: d1, jack: "out", level: -6, pan: -0.3 }, { node: d2, jack: "out", level: -9, pan: 0.3 }], -1, "Drone Sum");
  const dflt = p.add("filter", [4, 4], { cutoff: 180, resonance: 0.3, type: "Ladder Tanh" });
  p.stereo(dm, dflt, { from: ["outl", "outr"] }).cable(coin, "coin2", dflt, "cutoff", 0.5);
  const mix = p.add("audio-mixer", [5, 0], { level1: -3, level2: -9, level3: -2, pan1: -0.2, pan2: 0.3, master: -1 }, { name: "Mix" });
  p.cable(bell.amp, "l", mix, "in1l").cable(fvca, "l", mix, "in2l").stereo(dflt, mix, { to: ["in3l", "in3r"] });
  const dly = p.add("delay-network", [6, 0], { sync: "1/4.", taps: 3, feedback: 0.45, tone: -0.2, width: 1, mix: 0.35, routing: "Ring" });
  const verb = p.add("reverb", [7, 0], { size: 0.8, decay: 5, mix: 0.35 });
  p.stereo(mix, dly, { from: ["outl", "outr"] }).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

export default [headsOrTails, tradingVoices, latchLayers, fixedRandomGroove, coinPitch];
