// SPDX-License-Identifier: MIT
// Drum Map: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

/// Kick, snare and hats modules wired to a Drum Map's triggers and velocities, into a mixer (stereo out "outl"/"outr").
/// kit: "punch" or "ring".
function drums(p, dm, at, kit = "punch", opts = {}) {
  const [c, r] = at;
  const kick = p.add(`${kit}-kick`, [c, r], opts.kick || { level: 0.8 });
  const snare = p.add(`${kit}-snare`, [c, r + 1], opts.snare || { level: 0.6 });
  const hats = p.add(`${kit}-hats`, [c, r + 2], opts.hats || { level: 0.5 });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: -2, level2: -5, pan2: 0.1, level3: -10, pan3: 0.3, master: opts.master ?? -3,
    send2: opts.send ?? -60, send3: opts.send ?? -60 }, { name: "Drum Mix" });
  p.cable(dm, "kick", kick, "trig").cable(dm, "kickvel", kick, "velocity")
    .cable(dm, "snare", snare, "trig").cable(dm, "snarevel", snare, "velocity")
    .cable(dm, "hats", hats, "closed").cable(dm, "hatsvel", hats, "velocity")
    .cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hats, "out", mix, "in3l");
  return { mix, kick, snare, hats };
}

/// A bass voice (Step Sequencer → Oscillator → VCA through a low-pass filter) as a mono audio source on `amp` "l".
function bass(p, at, notes, opts = {}) {
  const m = melody(p, at, notes, { rate: "1/8", shape: 0.9, octave: -1, gatelength: 0.55, env: { decay: 0.2, sustain: 0.5, release: 0.1 }, ...opts });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: opts.cutoff ?? 400, resonance: 0.3, type: "Ladder Tanh" });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r");
  return { ...m, flt };
}

/// Mixes (source, left jack, right jack, level dB) rows into Out 1/2.
function mixOut(p, at, parts, master = 0) {
  const lv = {};
  parts.forEach(([, , , l], i) => { lv[`level${i + 1}`] = l; });
  const mx = p.add("audio-mixer", at, { ...lv, master });
  parts.forEach(([src, jl, jr], i) => p.cable(src, jl, mx, `in${i + 1}l`).cable(src, jr, mx, `in${i + 1}r`));
  p.stereo(mx, p.out, { from: ["outl", "outr"] });
  return mx;
}

function straightFour() {
  const p = patch("Drum Map: Straight Four", {
    module: "drum-map", tempo: 124,
    description: "In the straight corner of the map (low X, low Y) the Drum Map plays a steady kick on every beat, a backbeat snare and eighth-note hats, under a pulsing bass. Move X toward broken or Y toward busy, or turn the Density knobs to thin and fill each drum.",
    tags: ["four on the floor", "house", "beat", "dance"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.0, y: 0.35, kickdensity: 0.6, snaredensity: 0.5, hatsdensity: 0.55, accent: 0.8, seed: 4 });
  const d = drums(p, dm, [1, 0], "punch");
  const b = bass(p, [1, 3], [0, ".", 0, 0, ".", 0, 12, "."], { rate: "1/8", root: "A", scale: "Natural Minor" });
  mixOut(p, [5, 0], [[d.mix, "outl", "outr", 0], [b.flt, "l", "r", -3]], 0);
  return p;
}

function brokenWanderer() {
  const p = patch("Drum Map: Wandering Groove", {
    module: "drum-map", tempo: 96,
    description: "A slow LFO on X and a seeded Random on Y make the beat travel the whole map, from straight to broken and from sparse to busy, with Chaos adding ghost notes that come back identically every time. Try replacing the LFO with your own X and Y moves.",
    tags: ["generative", "groove", "evolving", "broken beat"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.5, y: 0.5, kickdensity: 0.6, snaredensity: 0.6, hatsdensity: 0.6, chaos: 0.3, chaosrate: "Every 2 bars", seed: 9 });
  const lx = p.add("lfo", [0, 1], { rate: 0.04, wave: "Triangle", polarity: "Unipolar" }, { name: "X Drift" });
  const ry = p.add("random", [0, 2], { rate: 0.2, sync: "Free", smooth: 0.7, spread: 0.6, seed: 5 }, { name: "Y Wander" });
  p.cable(lx, "out", dm, "x", 0.5).cable(ry, "out", dm, "y", 0.5);
  const d = drums(p, dm, [1, 0], "punch", { master: 0 });
  const m = melody(p, [1, 3], [0, ".", 7, ".", 3, ".", ".", 5], { rate: "1/8", root: "D", scale: "Dorian", octave: -1, shape: 0.5 });
  const v = p.add("reverb", [5, 1], { size: 0.5, decay: 1.8, mix: 0.25 });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r");
  mixOut(p, [6, 0], [[d.mix, "outl", "outr", 0], [v, "l", "r", -8]], 0);
  return p;
}

function fillEveryFour() {
  const p = patch("Drum Map: Fill Every Four", {
    module: "drum-map", tempo: 108,
    description: "A square LFO pulses the Fill gate for one bar in every four, adding Fill Amount to every Density so extra kicks, snares and sixteenth hats appear before the loop turns round. Raise Fill Amount for bigger fills, or make the LFO faster for constant fills.",
    tags: ["fill", "rock", "gate", "variation"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.2, y: 0.45, kickdensity: 0.45, snaredensity: 0.4, hatsdensity: 0.35, fillamount: 0.5, seed: 2 });
  const gate = p.add("lfo", [0, 1], { wave: "Square", sync: "4 bars", pw: 0.25, polarity: "Unipolar", phase: 270 }, { name: "Fill Bar" });
  p.cable(gate, "out", dm, "fill");
  const d = drums(p, dm, [1, 0], "ring", { snare: { level: 0.75 }, kick: { level: 0.8 }, hats: { level: 0.5 } });
  const b = bass(p, [1, 3], [0, 0, ".", 0, 0, ".", 5, 7], { rate: "1/8", root: "E", scale: "Minor Pentatonic", cutoff: 600 });
  mixOut(p, [5, 0], [[d.mix, "outl", "outr", 0], [b.flt, "l", "r", -3]], 0);
  return p;
}

function halfTimeDub() {
  const p = patch("Drum Map: Half-Time Dub", {
    module: "drum-map", tempo: 140,
    description: "Rate 1/8 stretches the two-bar map to four bars and X sits at the half-time edge: a sparse kick, a heavy snare on beat 3 and a few hats. The snare and hats feed a long delay through the mixer sends. Try Swing and Chaos for a looser feel.",
    tags: ["half-time", "dub", "echo", "slow"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.5, y: 0.1, rate: "1/8", kickdensity: 0.55, snaredensity: 0.7, hatsdensity: 0.5, swing: 0.56, seed: 6 });
  const d = drums(p, dm, [1, 0], "punch", { send: -8, master: -2, kick: { level: 0.85, decay: 0.9, tune: 45 }, snare: { level: 0.7, decay: 0.35 } });
  const dl = p.add("delay-network", [3, 1], { time: 0.43, taps: 3, feedback: 0.55, character: 0.5, tone: -0.3, mix: 1, width: 0.9 });
  p.cable(d.mix, "sendl", dl, "l").cable(d.mix, "sendr", dl, "r");
  const b = bass(p, [1, 3], ["0", "_", "_", "_", ".", ".", 3, "_"], { rate: "1/4", root: "G", scale: "Natural Minor", cutoff: 250, octave: -2, shape: 0.6 });
  mixOut(p, [5, 0], [[d.mix, "outl", "outr", 0], [dl, "l", "r", -6], [b.flt, "l", "r", -2]], 0);
  return p;
}

function chaosShuffle() {
  const p = patch("Drum Map: Chaos Shuffle", {
    module: "drum-map", tempo: 100,
    description: "Rate 1/16T and a high Swing give a rolling shuffle, and Chaos at 60 % with a fresh nudge every bar keeps adding and dropping ghost notes around the steady backbone. Turn Chaos down for a rigid groove or set Chaos Rate to Frozen to fix one version.",
    tags: ["shuffle", "chaos", "swing", "ghost notes"],
  });
  const dm = p.add("drum-map", [0, 0], { x: 0.75, y: 0.7, rate: "1/16T", chaos: 0.6, chaosrate: "Every bar", swing: 0.6, kickdensity: 0.5, snaredensity: 0.45, hatsdensity: 0.7, seed: 17 });
  const d = drums(p, dm, [1, 0], "ring", { hats: { level: 0.45, tone: 0.6 } });
  const m = melody(p, [1, 3], [0, ".", ".", 7, ".", 5, ".", ".", 3, ".", 7, "."], { rate: "1/8T", root: "C", scale: "Blues", octave: -1, shape: 0.6, cutoff: 700 });
  mixOut(p, [5, 0], [[d.mix, "outl", "outr", 0], [m.amp, "l", "l", -9]], 0);
  return p;
}

export default [straightFour, brokenWanderer, fillEveryFour, halfTimeDub, chaosShuffle];
