// SPDX-License-Identifier: MIT
// Pads: slow, moving polyphonic Voice Cells for chords and beds. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Two detuned saws, a per-voice drifting LFO on the second and a slow ladder swell: string machine.
function velvetStrings() {
  const p = voice("Velvet Strings", {
    description: "Two saws a few cents apart, each voice drifting at its own rate, into a soft ladder that swells open: a lush analog string pad. Shared input Cutoff.",
    tags: ["pad", "strings", "analog", "lush"],
  }).settings({ voices: 8, spread: 0.6 }).input("cut", "Cutoff");
  const o1 = p.add("oscillator", [0, 0], { fine: -8 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [0, 1], { fine: 8 }, { name: "Saw 2" });
  const drift = p.add("lfo", [0, 2], { rate: 0.35, wave: "Random Smooth" }, { name: "Drift" });
  const envf = envelope(p, [0, 3], { attack: 1.2, decay: 2, sustain: 0.6, release: 2.5, velamount: 0.3 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 900, resonance: 0.12, keytrack: 0.4, type: "Ladder Linear" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch")
    .cable(drift, "out", o2, "pitch", semis(0.15)).cable(p.vin, "random", drift, "rate", 0.08)
    .cable(o1, "out", flt, "l", 0.55).cable(o2, "out", flt, "l", 0.55).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.2).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.9, decay: 1, sustain: 0.9, release: 2.2, velamount: 0.3 });
  return p;
}

// A Swarm on fifths that blooms out of unison, breathed on by Organic LFOs.
function swarmNebula() {
  const p = voice("Swarm Nebula", {
    description: "Ten Swarm oscillators bloom from unison into stacked fifths while Organic LFOs breathe on spread, warp and filter: a wide, living cloud. Shared input Bloom.",
    tags: ["pad", "cloud", "wide", "evolving"],
  }).settings({ voices: 6, spread: 0.3 }).input("bloom", "Bloom");
  const sw = p.add("swarm", [0, 0], { chord: "Fifths", count: 10, spread: 0.45, detune: 14, drift: 0.5, width: 1, glide: 1.5, crossfm: 0.04 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.08, spread: 0.6, drift: 0.4 });
  const flt = p.add("filter", [1, 0], { cutoff: 2600, resonance: 0.15, keytrack: 0.3, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", sw, "pitch").cable(org, "out1", sw, "spread", 0.25).cable(org, "out2", sw, "warp", 0.15)
    .cable(p.cin, "bloom", sw, "spread", 0.5).cable(p.vin, "trigger", sw, "reshuffle")
    .stereo(sw, flt).cable(org, "out3", flt, "cutoff", 0.08);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 1.8, decay: 1.5, sustain: 0.85, release: 3.5, velamount: 0.2 });
  return p;
}

// Additive saw spectrum with a moving comb and chorus: a breathy organ-choir.
function aetherChoir() {
  const p = voice("Aether Choir", {
    description: "Additive Osc with a chorus on its partials and a comb that sweeps slowly through them, differently per voice: an airy organ-choir. Shared input Air.",
    tags: ["pad", "choir", "additive", "airy"],
  }).settings({ voices: 8, spread: 0.4 }).input("air", "Air");
  const add = p.add("additive-osc", [0, 0], { partials: 24, tilt: -6, oddEven: 0.25, comb: 0.5, combSpacing: 5,
    chorus: 18, chorusRate: 0.4, width: 0.7 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.12, wave: "Triangle" }, { name: "Comb Sweep" });
  p.cable(p.vin, "pitch", add, "pitch").cable(lfo, "out", add, "combPhase", 0.5).cable(p.vin, "random", lfo, "phase", 0.5)
    .cable(p.cin, "air", add, "tilt", 0.3).cable(p.cin, "air", add, "chorus", 0.3);
  ampEnvelope(p, { node: add, stereo: true, jacks: ["outL", "outR"] }, [1, 1],
    { attack: 1.2, decay: 1, sustain: 0.9, release: 2.5, velamount: 0.25 });
  return p;
}

// Wavetable Spectra bank walked along a spiral path by a slow LFO.
function tidalTables() {
  const p = voice("Tidal Tables", {
    description: "Wavetable Osc on the Spectra bank, scanned along a spiral by a slow tide LFO and offset per voice, through a gentle ladder. Shared input Scan.",
    tags: ["pad", "wavetable", "morphing", "digital"],
  }).settings({ voices: 8, spread: 0.5 }).input("scan", "Scan");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "Spectra", path: "Spiral", scan: 0.3, stereo: 0.3, subLevel: 0.15 });
  const tide = p.add("lfo", [0, 1], { rate: 0.05, wave: "Triangle" }, { name: "Tide" });
  const flt = p.add("filter", [1, 0], { cutoff: 4200, resonance: 0.1, keytrack: 0.3, type: "Ladder Linear" });
  p.cable(p.vin, "pitch", wt, "pitch").cable(tide, "out", wt, "scan", 0.3).cable(p.vin, "random", wt, "scan", 0.15)
    .cable(p.cin, "scan", wt, "scan", 0.5).stereo(wt, flt, { from: ["outL", "outR"] });
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 1.5, decay: 1, sustain: 0.9, release: 3, velamount: 0.25 });
  return p;
}

// Macro Osc Vowel model: each voice sings its own slowly changing vowel.
function monasteryVowels() {
  const p = voice("Monastery Vowels", {
    description: "Macro Osc's Vowel model: each voice drifts through its own vowels with a slow vibrato fading in, a little breath on top: a formant choir. Shared input Vowel.",
    tags: ["pad", "choir", "formant", "vocal"],
  }).settings({ voices: 8, spread: 0.7 }).input("vowel", "Vowel");
  const mo = p.add("macro-osc", [0, 0], { model: "Vowel", tone: 0.35, shape: 0.6, blend: 0.15, level: 0.7 });
  const drift = p.add("lfo", [0, 1], { rate: 0.09, wave: "Random Smooth" }, { name: "Vowel Drift" });
  const vib = p.add("lfo", [0, 2], { rate: 5.2, fade: 1.2 }, { name: "Vibrato" });
  const flt = p.add("filter", [1, 0], { cutoff: 5500, resonance: 0.05, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", mo, "pitch").cable(drift, "out", mo, "tone", 0.25).cable(p.vin, "random", mo, "tone", 0.2)
    .cable(p.cin, "vowel", mo, "tone", 0.5).cable(vib, "sine", mo, "pitch", semis(0.15))
    .cable(mo, "out", flt, "l");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.8, decay: 1, sustain: 0.9, release: 2, velamount: 0.3 });
  return p;
}

// Two pulse waves with LFO-swept widths in opposite phase: the classic PWM pad.
function pulseWidthHaze() {
  const p = voice("Pulse Width Haze", {
    description: "Two pulse waves whose widths sweep in opposite phase, at a slightly different speed per voice, into a warm ladder: a shimmering PWM pad. Shared input Cutoff.",
    tags: ["pad", "pwm", "analog", "vintage"],
  }).settings({ voices: 8, spread: 0.7 }).input("cut", "Cutoff");
  const o1 = p.add("oscillator", [0, 0], { shape: 1, fine: -4 }, { name: "Pulse 1" });
  const o2 = p.add("oscillator", [0, 1], { shape: 1, fine: 4 }, { name: "Pulse 2" });
  const pwm = p.add("lfo", [0, 2], { rate: 0.6, wave: "Triangle" }, { name: "PWM" });
  const flt = p.add("filter", [1, 0], { cutoff: 1400, resonance: 0.2, drive: 0.15, keytrack: 0.3, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch")
    .cable(pwm, "out", o1, "pw", 0.35).cable(pwm, "out", o2, "pw", -0.35).cable(p.vin, "random", pwm, "rate", 0.05)
    .cable(o1, "out", flt, "l", 0.55).cable(o2, "out", flt, "l", 0.55).cable(p.vin, "pitch", flt, "pitch")
    .cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.6, decay: 1, sustain: 0.85, release: 1.8, velamount: 0.3 });
  return p;
}

// Saw and sub-octave triangle, a touch of folding, a low resonant ladder moved by Organic LFOs.
function abyssalDrone() {
  const p = voice("Abyssal Drone", {
    description: "Dual Osc saw over a triangle an octave down, lightly folded, into a low resonant ladder that Organic LFOs open and close over many seconds: a dark drone. Shared input Cutoff.",
    tags: ["pad", "drone", "dark", "ambient"],
  }).settings({ voices: 4, spread: 0.5 }).input("cut", "Cutoff");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, shapeB: 0.33, octaveB: -1, balance: 0.5, fold: 0.15, drift: 0.4, width: 0.6 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.03, spread: 0.4, drift: 0.5 });
  const flt = p.add("filter", [1, 0], { cutoff: 260, resonance: 0.45, drive: 0.3, keytrack: 0.2, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(org, "out1", osc, "fold", 0.2)
    .stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch")
    .cable(org, "out2", flt, "cutoff", 0.12).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 2.5, decay: 1, sustain: 1, release: 5, velamount: 0.15 });
  return p;
}

// Modal Voice bowing a bell-shaped body, a soft ting at the start: singing glass.
function bowedCrystal() {
  const p = voice("Bowed Crystal", {
    description: "Modal Voice bows an inharmonic glass body that swells in after a soft mallet ting; a slow LFO wanders the bow position and aftertouch bows harder. Shared input Brightness.",
    tags: ["pad", "glassy", "bell", "physical"],
  }).settings({ voices: 8, spread: 0.6 }).input("bright", "Brightness");
  const mv = p.add("modal-voice", [1, 0], { bow: 0.65, bowTimbre: 0.3, strike: 0.25, strikeTimbre: 0.2, contour: 0.1,
    geometry: 0.85, brightness: 0.7, damping: 0.25, position: 0.3, space: 0 });
  const lfo = p.add("lfo", [0, 1], { rate: 0.15, wave: "Random Smooth" }, { name: "Position Drift" });
  p.cable(p.vin, "pitch", mv, "pitch").cable(p.vin, "gate", mv, "gate").cable(p.vin, "trigger", mv, "strike")
    .cable(p.vin, "velocity", mv, "velocity").cable(p.vin, "pressure", mv, "bow", 0.3)
    .cable(lfo, "out", mv, "position", 0.12).cable(p.cin, "bright", mv, "brightness", 0.4)
    .stereo(mv, p.vout).cable(mv, "active", p.vout, "active");
  return p;
}

// A detuned major-seventh chord per key through a slowly sweeping phaser.
function satinSevenths() {
  const p = voice("Satin Sevenths", {
    description: "Chord Osc spreads an open major seventh over the stereo field with a chorus-like detune, through a phaser that sweeps slowly: an ensemble pad for one-finger chords. Shared input Cutoff.",
    tags: ["pad", "chords", "ensemble", "lush"],
  }).settings({ voices: 4 }).input("cut", "Cutoff");
  const chord = p.add("chord-osc", [0, 0], { chord: "Major 7", voices: 4, voicing: "Open", detune: 12, stereo: 0.8, shape: 0.6 });
  const sweep = p.add("lfo", [0, 1], { rate: 0.12, wave: "Triangle" }, { name: "Phaser Sweep" });
  const ph = p.add("filter", [1, 0], { cutoff: 900, resonance: 0.35, mix: 0.5, type: "Phaser 2-Pole ×2" }, { name: "Phaser" });
  const lp = p.add("filter", [2, 0], { cutoff: 3500, resonance: 0.1, keytrack: 0.3, type: "Ladder Linear" }, { name: "Low-pass" });
  p.cable(p.vin, "pitch", chord, "pitch").stereo(chord, ph).cable(sweep, "out", ph, "cutoff", 0.2)
    .stereo(ph, lp).cable(p.vin, "pitch", lp, "pitch").cable(p.cin, "cut", lp, "cutoff", 0.5);
  ampEnvelope(p, { node: lp, stereo: true }, [3, 1], { attack: 0.7, decay: 1, sustain: 0.85, release: 2.2, velamount: 0.3 });
  return p;
}

// Pink noise through two key-tracked resonant band-passes, gusting with Organic LFOs.
function desertWind() {
  const p = voice("Desert Wind", {
    description: "Pink noise through a pair of resonant band-passes tuned to the note, gusting and turning as Organic LFOs move them: a pitched wind texture. Shared input Howl (resonance).",
    tags: ["pad", "texture", "noise", "wind"],
  }).settings({ voices: 6, spread: 0.8 }).input("howl", "Howl");
  const nz = p.add("noise", [0, 0], { colour: -0.3 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.15, spread: 0.7, drift: 0.6 });
  const df = p.add("dual-filter", [1, 0], { cutoff: 261.63, spread: 1, res1: 0.85, res2: 0.8, mode1: 0.333, mode2: 0.333,
    keyTrack: 1, routing: "Parallel" });
  p.cable(nz, "pink", df, "l").cable(p.vin, "pitch", df, "pitch")
    .cable(org, "out1", df, "cutoff", 0.03).cable(org, "out2", df, "spread", 0.05)
    .cable(p.cin, "howl", df, "res1", 0.15).cable(p.cin, "howl", df, "res2", 0.15);
  const gust = p.add("vca", [2, 0], { gain: 0.7 }, { name: "Gusts" });
  p.stereo(df, gust).cable(org, "out3", gust, "gain", 0.3);
  ampEnvelope(p, { node: gust, stereo: true }, [3, 1], { attack: 2, decay: 1, sustain: 0.9, release: 4, velamount: 0.3 });
  return p;
}

export default category("Pads", "Slow, wide, moving Voice Cells for chords, beds and drones: patch Notes in and Out L/R out.", [
  velvetStrings, swarmNebula, aetherChoir, tidalTables, monasteryVowels, pulseWidthHaze, abyssalDrone, bowedCrystal,
  satinSevenths, desertWind,
]);
