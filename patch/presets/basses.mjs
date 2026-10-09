// SPDX-License-Identifier: MIT
// Basses: mostly monophonic Voice Cells for low lines. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Saw into a resonant diode ladder; velocity pushes the cutoff like an accent.
function diodeSquelch() {
  const p = voice("Diode Squelch", {
    description: "Saw through a screaming diode ladder with a snappy filter envelope; harder notes open it further like a 303 accent, and legato notes slide. Shared input Cutoff.",
    tags: ["mono", "acid", "303", "squelch"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.06, glidemode: "Legato only" }).input("cut", "Cutoff");
  const osc = p.add("oscillator", [0, 0], { shape: 0.67 });
  const envf = envelope(p, [0, 1], { attack: 0.001, decay: 0.18, sustain: 0, release: 0.12, velamount: 0.8 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 220, resonance: 0.82, drive: 0.35, keytrack: 0.3, type: "Diode Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(osc, "out", flt, "l").cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.4).cable(p.vin, "velocity", flt, "cutoff", 0.15)
    .cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 0.3, sustain: 0.8, release: 0.06, velamount: 0.3 });
  return p;
}

// Sine an octave down plus a hint of triangle: pure sub weight.
function abyssSub() {
  const p = voice("Abyss Sub", {
    description: "A sine an octave below the key with a whisper of triangle for audibility on small speakers, softly saturated: deep, clean sub bass.",
    tags: ["mono", "sub", "808", "deep"],
  }).settings({ voices: 1, mode: "Mono", glide: 0.03 });
  const osc = p.add("oscillator", [0, 0], { octave: "-1", shape: 0 });
  const flt = p.add("filter", [1, 0], { cutoff: 900, resonance: 0, drive: 0.25, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(osc, "sine", flt, "l", 0.8).cable(osc, "triangle", flt, "l", 0.15)
    .cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.6, sustain: 0.9, release: 0.12, velamount: 0.4 });
  return p;
}

// Two detuned saws beating against each other, a slow LFO breathing on the ladder.
function reesePressure() {
  const p = voice("Reese Pressure", {
    description: "Dual Osc saws detuned 14 cents apart into a ladder whose cutoff drifts on a slow LFO and opens with aftertouch: the rolling drum-and-bass reese. Shared input Cutoff.",
    tags: ["mono", "reese", "dnb", "detuned", "dark"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.08 }).input("cut", "Cutoff");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, shapeB: 0.67, octaveB: 0, fineA: -7, fineB: 7, balance: 0.5, drift: 0.3, width: 0.6 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.18 }, { name: "Drift LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 420, resonance: 0.3, drive: 0.4, keytrack: 0.3, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch")
    .cable(lfo, "sine", flt, "cutoff", 0.12).cable(p.vin, "pressure", flt, "cutoff", 0.25)
    .cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.004, decay: 0.5, sustain: 0.9, release: 0.15 });
  return p;
}

// Two-operator FM with a fast-decaying index: the punchy digital FM bass.
function ratioThump() {
  const p = voice("Ratio Thump", {
    description: "Macro Osc in FM mode: a 1:1 modulator whose index snaps down after each attack, with a little feedback grit. Punchy, woody digital bass. Shared input Index.",
    tags: ["mono", "fm", "digital", "punchy"],
  }).settings({ voices: 1, mode: "Mono", glide: 0 }).input("idx", "Index");
  const fm = p.add("macro-osc", [0, 0], { model: "FM", tone: 0.15, shape: 0.15, blend: 0.2, level: 0.8 });
  const envi = envelope(p, [0, 1], { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.1, velamount: 0.7 }, "Index Env");
  p.cable(p.vin, "pitch", fm, "pitch").cable(envi, "env", fm, "shape", 0.45).cable(p.cin, "idx", fm, "shape", 0.4);
  ampEnvelope(p, { node: fm }, [1, 1], { attack: 0.001, decay: 0.4, sustain: 0.6, release: 0.08, velamount: 0.5 });
  return p;
}

// The Folder's own oscillator folded by an envelope, then a ladder to tame it.
function foldGrowl() {
  const p = voice("Fold Growl", {
    description: "The Folder's internal sine folded hard on every attack and by aftertouch, rounded off by a ladder: a snarling, West Coast growl bass. Shared input Fold.",
    tags: ["mono", "wavefolder", "growl", "west coast"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.05 }).input("fold", "Fold");
  const wf = p.add("wavefolder", [0, 0], { fold: 0.25, symmetry: 0.15, wave: 0.2, spread: 0.2, source: "Internal", level: 0.8 });
  const envw = envelope(p, [0, 1], { attack: 0.002, decay: 0.35, sustain: 0.3, release: 0.2, velamount: 0.6 }, "Fold Env");
  const flt = p.add("filter", [1, 0], { cutoff: 1400, resonance: 0.15, keytrack: 0.4, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", wf, "pitch").cable(envw, "env", wf, "fold", 0.45).cable(p.vin, "pressure", wf, "fold", 0.2)
    .cable(p.cin, "fold", wf, "fold", 0.4).stereo(wf, flt).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 0.4, sustain: 0.85, release: 0.12 });
  return p;
}

// Square and sub, a short decay on a 2-pole: the round, plucked analog bass.
function pocketPluck() {
  const p = voice("Pocket Pluck", {
    description: "Narrow pulse and sub square through a saturating state-variable low-pass with a short, velocity-sensitive pluck: a round funk and house bass.",
    tags: ["mono", "analog", "pluck", "funk", "house"],
  }).settings({ voices: 1, mode: "Mono" }).input("cut", "Cutoff");
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.3 });
  const envf = envelope(p, [0, 1], { attack: 0.001, decay: 0.22, sustain: 0.05, release: 0.1, velamount: 0.7 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 260, resonance: 0.35, keytrack: 0.5, type: "SVF Saturating (Rough)" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(osc, "out", flt, "l", 0.5).cable(osc, "sub", flt, "l", 0.5)
    .cable(p.vin, "pitch", flt, "pitch").cable(envf, "env", flt, "cutoff", 0.35).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.001, decay: 0.35, sustain: 0.25, release: 0.09, velamount: 0.6 });
  return p;
}

// Wavetable bass under a tempo-locked LFO on the cutoff: dubstep wobble.
function eighthWobble() {
  const p = voice("Eighth Wobble", {
    description: "Wavetable Osc on the FM bank with a sub, through a resonant ladder whose cutoff wobbles in eighth notes with the transport. Shared inputs Cutoff and Table.",
    tags: ["mono", "wobble", "dubstep", "wavetable", "tempo"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.04 }).input("cut", "Cutoff").input("tbl", "Table");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "FM", x: 0.35, y: 0.4, subLevel: 0.5, stereo: 0.1 });
  const lfo = p.add("lfo", [0, 1], { rate: 4, sync: "1/8", wave: "Triangle" }, { name: "Wobble LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 180, resonance: 0.55, drive: 0.45, keytrack: 0.3, type: "Ladder Hyperbolic" });
  p.cable(p.vin, "pitch", wt, "pitch").cable(p.cin, "tbl", wt, "x", 0.4).stereo(wt, flt, { from: ["outL", "outR"] })
    .cable(p.vin, "pitch", flt, "pitch").cable(lfo, "triangle", flt, "cutoff", 0.25).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.3, sustain: 1, release: 0.1, velamount: 0.3 });
  return p;
}

// A formant oscillator whose peak sweeps per note: a talking, yapping bass.
function talkboxLow() {
  const p = voice("Talkbox Low", {
    description: "Formant Osc an octave down with its resonant peak swept by an envelope and pressure, so each note says \"yow\": a talking, vocal bass. Shared input Formant.",
    tags: ["mono", "formant", "talking", "vocal", "funk"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.07 }).input("fmt", "Formant");
  const fo = p.add("formant-osc", [0, 0], { octave: -1, formant: 0.5, narrow: 0.6, body: 0.8, spread: 0.2 });
  const envf = envelope(p, [0, 1], { attack: 0.03, decay: 0.3, sustain: 0.2, release: 0.2, velamount: 0.6 }, "Formant Env");
  p.cable(p.vin, "pitch", fo, "pitch").cable(envf, "env", fo, "formant", 0.3).cable(p.vin, "pressure", fo, "formant", 0.15)
    .cable(p.cin, "fmt", fo, "formant", 0.3);
  ampEnvelope(p, { node: fo, stereo: true, jacks: ["outL", "outR"] }, [1, 1], { attack: 0.004, decay: 0.4, sustain: 0.85, release: 0.12 });
  return p;
}

// Hard sync with an envelope on the synced core: a biting, metallic bass.
function tornSync() {
  const p = voice("Torn Sync Bass", {
    description: "Dual Osc hard-synced to a core an octave below; an envelope tears the synced core's pitch down on every note, under a driven low-pass. Shared input Sync Sweep.",
    tags: ["mono", "sync", "aggressive", "electro"],
  }).settings({ voices: 1, mode: "Mono", glide: 0.02 }).input("sweep", "Sync Sweep");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, shapeB: 1, octaveA: -1, octaveB: -1, sync: 1, balance: 0.2, tuneA: 3 });
  const envs = envelope(p, [0, 1], { attack: 0.001, decay: 0.25, sustain: 0.05, release: 0.1, velamount: 0.6 }, "Sync Env");
  const flt = p.add("filter", [1, 0], { cutoff: 2200, resonance: 0.2, drive: 0.5, keytrack: 0.4, type: "Ladder Nonlinear Stages" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envs, "env", osc, "tuneA", 0.45).cable(p.cin, "sweep", osc, "tuneA", 0.3)
    .cable(osc, "mix", flt, "l").cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.001, decay: 0.3, sustain: 0.7, release: 0.08 });
  return p;
}

// Triangle with a touch of FM through a low pass gate: bouncy and rubbery.
function vactrolRubber() {
  const p = voice("Vactrol Rubber", {
    description: "A slightly FM'd triangle pinged through a Low Pass Gate and held open by the gate: rubbery, bouncy bass that darkens as it fades, no envelope needed.",
    tags: ["lpg", "rubber", "west coast", "pluck"],
  }).settings({ voices: 2, mode: "Poly" });
  const osc = p.add("oscillator", [0, 0], { shape: 0.33, fm: 0.12 }, { name: "Carrier" });
  const mod = p.add("oscillator", [0, 1], { shape: 0, octave: "+1" }, { name: "Modulator" });
  const lpg = p.add("low-pass-gate", [1, 0], { level: 0, response: 0.45, ping: 0.9, resonance: 0.3, brightness: 0.45, drive: 0.3, cell: "Classic" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(p.vin, "pitch", mod, "pitch").cable(mod, "sine", osc, "fm")
    .cable(osc, "out", lpg, "l").cable(osc, "sub", lpg, "l", 0.4)
    .cable(p.vin, "trigger", lpg, "ping").cable(p.vin, "velocity", lpg, "velocity").cable(p.vin, "gate", lpg, "cv", 0.6)
    .stereo(lpg, p.vout).cable(lpg, "active", p.vout, "active");
  return p;
}

export default category("Basses", "Monophonic and duophonic Voice Cells for bass lines, from sub and acid to reese, FM and wobble: patch Notes in and Out L/R out.", [
  diodeSquelch, abyssSub, reesePressure, ratioThump, foldGrowl, pocketPluck, eighthWobble, talkboxLow, tornSync, vactrolRubber,
]);
