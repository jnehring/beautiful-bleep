// SPDX-License-Identifier: MIT
// Pads: slow, moving polyphonic Voice Cells for chords and beds. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";
import { withFx, verb, echo, chorus, phaser, shimmer } from "./fx.mjs";

// Additive saw partials, chorused wide, brightness drifting slowly.
function additiveDawn() {
  const p = voice("Additive Dawn", {
    description: "Additive saw partials with a built-in chorus and a tilt that drifts slowly brighter and darker: a clean, airy pad that rises like first light. Shared input Brightness.",
    tags: ["pad", "additive", "airy", "evolving", "clean"],
    help: "An Additive Osc with 24 saw partials, a soft Tilt and a wide, slow chorus. An Organic LFO moves the " +
      "Tilt up and down over many seconds, and velocity adds a little more top. A slow amp envelope fades " +
      "each note in and a long release lets chords melt into one another. Six voices.\n\n" +
      "Notes in, Out L/R. The shared input Brightness adds to the Tilt.\n\n" +
      "Tip: hold open chords with the sustain pedal and raise Brightness as the section builds.",
  }).settings({ voices: 6, spread: 0.5 }).input("bright", "Brightness");
  const add = p.add("additive-osc", [0, 0], { partials: 24, tilt: -8, chorus: 22, chorusRate: 0.25, width: 0.9 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.12, spread: 0.5 });
  p.cable(p.vin, "pitch", add, "pitch").cable(org, "out1", add, "tilt", 0.12).cable(p.vin, "velocity", add, "tilt", 0.06)
    .cable(p.cin, "bright", add, "tilt", 0.3);
  ampEnvelope(p, { node: add, stereo: true, jacks: ["outL", "outR"] }, [1, 1], { attack: 1.4, decay: 1.5, sustain: 0.85, release: 2.5, velamount: 0.2 });
  return p;
}

// Wavetable bank wandering on two slow axes.
function spectraTide() {
  const p = voice("Spectra Tide", {
    description: "A spectral wavetable that wanders slowly across its grid on two axes, never repeating the same way twice: a glassy, shifting pad. Shared input Drift.",
    tags: ["pad", "wavetable", "evolving", "glassy", "spectral"],
    help: "A Wavetable Osc on the Spectra bank. Two Organic LFOs move X and Y very slowly, and each voice starts " +
      "from a slightly different place. A gentle 1-Pole low-pass at 6 kHz takes off the digital edge. Six " +
      "voices.\n\n" +
      "Notes in, Out L/R. The shared input Drift adds to the X position, so you can steer where the pad sits " +
      "in the table.\n\n" +
      "Tip: hold a chord and listen: the sound slowly changes from bright to hollow and back.",
  }).settings({ voices: 6, spread: 0.6 }).input("drift", "Drift");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "Spectra", x: 0.3, y: 0.3, stereo: 0.3 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.1, spread: 0.7 });
  const flt = p.add("filter", [1, 0], { cutoff: 6000, resonance: 0.05, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", wt, "pitch").cable(org, "out1", wt, "x", 0.25).cable(org, "out2", wt, "y", 0.25)
    .cable(p.vin, "random", wt, "scan", 0.1).cable(p.cin, "drift", wt, "x", 0.5)
    .stereo(wt, flt, { from: ["outL", "outR"] });
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 1.2, decay: 1.5, sustain: 0.85, release: 2.5, velamount: 0.2 });
  return p;
}

// Formant oscillator with a slow vowel drift, like a hummed choir.
function hollowChoir() {
  const p = voice("Hollow Choir", {
    description: "A pulse-formant oscillator whose peak drifts slowly, voice by voice, giving a hummed, hollow choir that never settles on one vowel. Shared input Formant.",
    tags: ["pad", "choir", "formant", "vocal", "hollow"],
    help: "A Formant Osc in a wide stereo setting. An Organic LFO nudges the Formant peak a little differently " +
      "for each voice, so a chord sounds like several singers on slightly different vowels. A 1-Pole " +
      "low-pass at 4 kHz softens it and a slow envelope swells each note. Six voices.\n\n" +
      "Notes in, Out L/R. The shared input Formant adds to the peak position and so moves the vowel for " +
      "all voices together.\n\n" +
      "Tip: play wide, open chords and ride Formant slowly for a choir that turns its head.",
  }).settings({ voices: 6, spread: 0.7 }).input("form", "Formant");
  const fo = p.add("formant-osc", [0, 0], { formant: 1.2, narrow: 0.35, body: 0.75, spread: 0.6 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.15, spread: 0.8 });
  const flt = p.add("filter", [1, 0], { cutoff: 4000, resonance: 0.05, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", fo, "pitch").cable(org, "out1", fo, "formant", 0.1).cable(p.vin, "random", fo, "formant", 0.05)
    .cable(p.cin, "form", fo, "formant", 0.3).stereo(fo, flt, { from: ["outL", "outR"] });
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 1.1, decay: 1.2, sustain: 0.9, release: 2.2, velamount: 0.2 });
  return p;
}

// Chord oscillator: every key plays a minor seventh.
function seventhGlow() {
  const p = voice("Seventh Glow", {
    description: "Every key sounds a full minor seventh chord, slightly detuned and spread wide through a soft ladder: one-finger jazzy pad harmony. Shared input Cutoff.",
    tags: ["pad", "chord", "jazz", "minor seventh", "warm"],
    help: "A Chord Osc set to a minor seventh with four voices, a little detune and a wide stereo image, through " +
      "a Ladder Linear filter at 1.4 kHz that a slow envelope opens. Three voices, since each already plays " +
      "a whole chord.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter.\n\n" +
      "Tip: play single notes for lush chord changes; play two or three together for stacked, ambiguous harmony.",
  }).settings({ voices: 3, spread: 0.4 }).input("cut", "Cutoff");
  const ch = p.add("chord-osc", [0, 0], { chord: "Minor 7", voices: 4, detune: 12, stereo: 0.8, shape: 0.67 });
  const envf = envelope(p, [0, 1], { attack: 1.2, decay: 2, sustain: 0.6, release: 2, velamount: 0.3 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 1400, resonance: 0.12, keytrack: 0.4, type: "Ladder Linear" });
  p.cable(p.vin, "pitch", ch, "pitch").stereo(ch, flt).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.15).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.8, decay: 1, sustain: 0.9, release: 2.2, velamount: 0.2 });
  return p;
}

// Two saws into a dual filter whose two peaks drift apart and together.
function duskFormants() {
  const p = voice("Dusk Formants", {
    description: "Two detuned saws through a pair of parallel resonant filters whose peaks slowly drift apart and together, like a vowel at dusk. Shared input Spread.",
    tags: ["pad", "formant", "filter", "evolving", "dark"],
    help: "Two saw Oscillators feed a Dual Filter in Parallel mode with moderate resonance. A slow LFO " +
      "changes the Spread between the two peaks, so the voice-like colour opens and closes over several " +
      "seconds. Six voices with a long release.\n\n" +
      "Notes in, Out L/R. The shared input Spread adds to the distance between the two filters.\n\n" +
      "Tip: play low chords; the filters follow the keyboard, so the colour moves with the harmony.",
  }).settings({ voices: 6, spread: 0.5 }).input("spread", "Spread");
  const o1 = p.add("oscillator", [0, 0], { fine: -9 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [0, 1], { fine: 9, octave: "-1" }, { name: "Saw 2" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.08, wave: "Triangle" }, { name: "Spread LFO" });
  const df = p.add("dual-filter", [1, 0], { cutoff: 800, spread: 1.6, res1: 0.55, res2: 0.5, keyTrack: 0.8, routing: "Parallel", mode1: 0, mode2: 0 });
  for (const o of [o1, o2]) p.cable(p.vin, "pitch", o, "pitch").cable(o, "out", df, "l", 0.5).cable(o, "out", df, "r", 0.5);
  p.cable(p.vin, "pitch", df, "pitch").cable(lfo, "out", df, "spread", 0.12).cable(p.cin, "spread", df, "spread", 0.4)
    .cable(p.vin, "random", df, "cutoff", 0.04);
  ampEnvelope(p, { node: df, stereo: true }, [2, 1], { attack: 1.2, decay: 1, sustain: 0.9, release: 2.4, velamount: 0.2 });
  return p;
}

// Three pulses with independent width movement: a string-ensemble wash.
function ribbonEnsemble() {
  const p = voice("Ribbon Ensemble", {
    description: "Three detuned pulse waves, each with its own slowly wandering width, into a soft low-pass: a thick, swirling analog ensemble. Shared input Cutoff.",
    tags: ["pad", "pwm", "ensemble", "analog", "swirling"],
    help: "Three pulse Oscillators tuned -10, 0 and +10 cents. Two Organic LFO outputs and a random LFO move " +
      "their pulse widths at different slow rates, so the thickness keeps changing. An SVF low-pass at 2.2 kHz " +
      "shapes them. Six voices.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter.\n\n" +
      "Tip: play chords in the middle register and let them sit for a few bars to hear the width move.",
  }).settings({ voices: 6, spread: 0.6 }).input("cut", "Cutoff");
  const o1 = p.add("oscillator", [0, 0], { shape: 1, fine: -10, pw: 0.35 }, { name: "Pulse 1" });
  const o2 = p.add("oscillator", [0, 1], { shape: 1, fine: 0, pw: 0.5 }, { name: "Pulse 2" });
  const o3 = p.add("oscillator", [0, 2], { shape: 1, fine: 10, pw: 0.6 }, { name: "Pulse 3" });
  const org = p.add("organic-lfos", [0, 3], { rate: 0.2, spread: 0.8 });
  const flt = p.add("filter", [1, 0], { cutoff: 2200, resonance: 0.12, keytrack: 0.5, type: "SVF Multimode" });
  p.cable(org, "out1", o1, "pw", 0.3).cable(org, "out2", o2, "pw", 0.3).cable(org, "out3", o3, "pw", 0.3);
  for (const o of [o1, o2, o3]) p.cable(p.vin, "pitch", o, "pitch").cable(o, "out", flt, "l", 0.4).cable(o, "out", flt, "r", 0.4);
  p.cable(p.vin, "pitch", flt, "pitch").cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.9, decay: 1, sustain: 0.9, release: 2, velamount: 0.2 });
  return p;
}

// FM with a quiet index, shimmering and cold.
function frostGlass() {
  const p = voice("Frost Glass", {
    description: "An FM voice an octave up with a gently wandering index and a slow swell: a cold, shimmering pad of glass-bell overtones. Shared input Shine.",
    tags: ["pad", "fm", "glass", "bell", "shimmer"],
    help: "A Macro Osc in FM mode, one octave up. A slow Random LFO changes the Shape (the FM index) per voice " +
      "and an envelope brightens the swell. A high-cut SVF filter at 7 kHz keeps it from getting harsh. " +
      "Six voices with a long release.\n\n" +
      "Notes in, Out L/R. The shared input Shine adds to the index and so to the number of bell-like overtones.\n\n" +
      "Tip: play high, sparse chords; low notes sound heavier and less glassy.",
  }).settings({ voices: 6, spread: 0.5 }).input("shine", "Shine");
  const fm = p.add("macro-osc", [0, 0], { model: "FM", octave: 1, tone: 0.8, shape: 0.2, blend: 0.1, level: 0.7 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.15, spread: 0.6 });
  const envi = envelope(p, [0, 2], { attack: 1.5, decay: 2, sustain: 0.5, release: 2, velamount: 0.3 }, "Index Env");
  const flt = p.add("filter", [1, 0], { cutoff: 7000, resonance: 0.05, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", fm, "pitch").cable(org, "out1", fm, "shape", 0.12).cable(envi, "env", fm, "shape", 0.15)
    .cable(p.cin, "shine", fm, "shape", 0.4).cable(fm, "out", flt, "l").cable(fm, "out", flt, "r");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 1.1, decay: 1.5, sustain: 0.8, release: 2.5, velamount: 0.2 });
  return p;
}

// Noise through a tracking narrow band-pass plus a soft triangle: breathy air organ.
function breathOrgan() {
  const p = voice("Breath Organ", {
    description: "Pink noise through a narrow band-pass that tracks each note, with a soft triangle underneath: a breathy, pipe-like pad with air on every chord. Shared input Breath.",
    tags: ["pad", "breath", "noise", "organ", "airy"],
    help: "Pink Noise goes through a resonant SVF band-pass that follows the key, which makes the noise ring at " +
      "the note's pitch. A soft triangle Oscillator sits underneath for body. Both go through a VCA with a " +
      "slow swell. A drifting LFO moves the band slightly. Eight voices.\n\n" +
      "Notes in, Out L/R. The shared input Breath adds to the level of the noise.\n\n" +
      "Tip: play octaves or fifths; the narrow band rings clearly on simple intervals.",
  }).settings({ voices: 8, spread: 0.5 }).input("breath", "Breath");
  const tri = p.add("oscillator", [0, 0], { shape: 0.2 }, { name: "Tone" });
  const noise = p.add("noise", [0, 1], { colour: -0.2, level: 1 });
  const bp = p.add("filter", [1, 1], { cutoff: 440, resonance: 0.85, keytrack: 1, type: "SVF Bandpass (unit gain)" }, { name: "Breath Band" });
  const air = p.add("vca", [2, 1], { gain: 3 }, { name: "Breath Level" });
  const drift = p.add("lfo", [0, 2], { rate: 0.3, wave: "Random Smooth" }, { name: "Drift" });
  const mix = p.add("filter", [2, 0], { cutoff: 5000, resonance: 0.05, type: "1-Pole Low-pass" }, { name: "Tone LP" });
  p.cable(p.vin, "pitch", tri, "pitch").cable(noise, "pink", bp, "l").cable(p.vin, "pitch", bp, "pitch")
    .cable(drift, "out", bp, "cutoff", 0.03).cable(bp, "l", air, "l").cable(p.cin, "breath", air, "gain", 0.4)
    .cable(tri, "out", mix, "l", 0.7).cable(tri, "out", mix, "r", 0.7).cable(air, "l", mix, "l", 0.9).cable(air, "l", mix, "r", 0.9);
  ampEnvelope(p, { node: mix, stereo: true }, [3, 1], { attack: 1, decay: 1, sustain: 0.9, release: 1.8, velamount: 0.2 });
  return p;
}

// Brown noise plus a deep saw into a closed lowpass that slowly opens: a cellar bed.
function cellarFog() {
  const p = voice("Cellar Fog", {
    description: "A deep saw, its sub and a veil of brown noise behind a closed low-pass that creeps open as the note holds: a dark, rumbling bed. Shared input Cutoff.",
    tags: ["pad", "dark", "drone", "noise", "low"],
    help: "A saw Oscillator an octave down with its sub output, plus Brown Noise, all through a Ladder Tanh " +
      "low-pass at 220 Hz. A slow Filter Env opens the filter during a held note. A random LFO drifts the " +
      "cutoff a little. Four voices, long release.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter.\n\n" +
      "Tip: play low, sparse notes and bring Cutoff up for a slow-motion rise.",
  }).settings({ voices: 4, spread: 0.4 }).input("cut", "Cutoff");
  const saw = p.add("oscillator", [0, 0], { octave: "-1", fine: 4 }, { name: "Saw" });
  const noise = p.add("noise", [0, 1], { colour: -1, level: 0.5 });
  const envf = envelope(p, [0, 2], { attack: 3, decay: 3, sustain: 0.5, release: 2.5, velamount: 0.2 }, "Filter Env");
  const drift = p.add("lfo", [0, 3], { rate: 0.15, wave: "Random Smooth" }, { name: "Drift" });
  const flt = p.add("filter", [1, 0], { cutoff: 220, resonance: 0.25, drive: 0.25, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", saw, "pitch").cable(saw, "out", flt, "l", 0.6).cable(saw, "sub", flt, "l", 0.4)
    .cable(noise, "brown", flt, "l", 0.25).cable(saw, "out", flt, "r", 0.6).cable(saw, "sub", flt, "r", 0.4)
    .cable(noise, "brown", flt, "r", 0.25).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.25).cable(drift, "out", flt, "cutoff", 0.04).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 2, decay: 1.5, sustain: 0.9, release: 2.5, velamount: 0.2 });
  return p;
}

// The Folder's internal oscillator, folded by slow modulation.
function foldedAurora() {
  const p = voice("Folded Aurora", {
    description: "The Folder's own oscillator, folded a little more and less by slow wandering modulators and pushed off-centre: a rippling, shimmering west-coast pad. Shared input Fold.",
    tags: ["pad", "wavefolder", "west coast", "shimmer", "evolving"],
    help: "A Wavefolder using its internal oscillator. An Organic LFO moves the fold amount and the symmetry " +
      "slowly, so the harmonics ripple like a light curtain. A swell envelope also folds the note more as it " +
      "opens. A 1-Pole low-pass at 5 kHz rounds off the top. Six voices.\n\n" +
      "Notes in, Out L/R. The shared input Fold adds to the fold amount.\n\n" +
      "Tip: keep Fold low for a gentle shimmer and raise it for glassier, more metallic textures.",
  }).settings({ voices: 6, spread: 0.6 }).input("fold", "Fold");
  const wf = p.add("wavefolder", [0, 0], { fold: 0.15, wave: 0.4, spread: 0.5, source: "Internal", level: 0.7 });
  const org = p.add("organic-lfos", [0, 1], { rate: 0.12, spread: 0.7 });
  const envw = envelope(p, [0, 2], { attack: 1.8, decay: 2, sustain: 0.5, release: 2, velamount: 0.3 }, "Fold Env");
  const flt = p.add("filter", [1, 0], { cutoff: 5000, resonance: 0.05, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", wf, "pitch").cable(org, "out1", wf, "fold", 0.15).cable(org, "out2", wf, "symmetry", 0.3)
    .cable(envw, "env", wf, "fold", 0.2).cable(p.cin, "fold", wf, "fold", 0.4).stereo(wf, flt);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 1.2, decay: 1.5, sustain: 0.85, release: 2.4, velamount: 0.2 });
  return p;
}

export default category("Pads", "Slow, moving polyphonic Voice Cells for chords and beds, from additive and wavetable clouds to formant choirs, breath organs and folded textures: patch Notes in and Out L/R out.", [
  withFx(additiveDawn, [chorus(0.25, 0.45, 0.4, 14, 0.9), verb(0.85, 5, 0.38, 0.35)],
    { say: "A wide chorus and a long hall let the dawn spread over the stereo field.", help: "A wide Chorus and a long Reverb bring the pad into a hazy distance.", tags: ["chorus", "reverb"] }),
  withFx(spectraTide, [phaser(0.12, 0.7, 900, 0.5, 8, 0.45), verb(0.9, 7, 0.38, 0.3)],
    { say: "A slow phaser turns the tide, and a very long hall carries it away.", help: "A very slow Phaser adds sweeping notches and a very long Reverb stretches the pad into a landscape.", tags: ["phaser", "reverb"] }),
  withFx(hollowChoir, [chorus(0.3, 0.5, 0.45, 15, 1), verb(0.95, 8, 0.4, 0.3)],
    { say: "A wide chorus and a cathedral reverb make the choir sound a hundred strong.", help: "A wide Chorus thickens the voices and a very large Reverb places them in a cathedral.", tags: ["chorus", "cathedral"] }),
  withFx(seventhGlow, [shimmer(0.3), echo(450, 675, 0.4, 0.2, 5000, 200, true), verb(0.9, 6, 0.38, 0.3)],
    { say: "A shimmer, slow echoes and a huge hall give the sevenths a golden glow.", help: "A Pitch Shifter adds an octave shimmer, a slow ping-pong Delay and a very long Reverb finish the glow.", tags: ["shimmer", "delay"] }),
  withFx(duskFormants, [phaser(0.18, 0.6, 1000, 0.45, 6, 0.4), verb(0.85, 5.5, 0.36, 0.35)],
    { say: "A slow phaser and a deep hall let the dusk formants breathe.", help: "A slow Phaser moves the formants and a long Reverb sets them in a big space.", tags: ["phaser", "reverb"] }),
  withFx(ribbonEnsemble, [chorus(0.35, 0.55, 0.5, 14, 1), phaser(0.1, 0.4, 1400, 0.3, 4, 0.25), verb(0.8, 4.5, 0.33)],
    { say: "A deep chorus, a gentle phaser and a long hall make the ribbons a lush ensemble.", help: "A deep Chorus, a gentle Phaser and a long Reverb make the ensemble lush.", tags: ["chorus", "phaser"] }),
  withFx(frostGlass, [shimmer(0.3), echo(380, 570, 0.4, 0.22, 7000, 200, true), verb(0.9, 6.5, 0.4, 0.2)],
    { say: "Shimmer and icy echoes in a big hall: frozen glass, ringing forever.", help: "A Pitch Shifter adds a bright octave, a ping-pong Delay scatters it and a bright, long Reverb freezes it.", tags: ["shimmer", "icy"] }),
  withFx(breathOrgan, [chorus(0.5, 0.35, 0.35), verb(0.8, 4, 0.3)],
    { say: "A chorus and a church-sized reverb put the organ in a nave.", help: "A Chorus and a large Reverb place the breath organ in a church.", tags: ["chorus", "church"] }),
  withFx(cellarFog, [echo(520, 780, 0.5, 0.25, 2500, 150, true), verb(0.95, 8.5, 0.42, 0.55)],
    { say: "Dark, slow echoes and a vast, damped reverb make the fog roll in.", help: "A slow ping-pong Delay with its high cut lowered and a vast, damped Reverb make a dark, deep fog.", tags: ["dark", "reverb"] }),
  withFx(foldedAurora, [shimmer(0.25), phaser(0.15, 0.6, 1200, 0.45, 6, 0.35), verb(0.9, 6, 0.38, 0.25)],
    { say: "Shimmer and a drifting phaser in a huge hall make the aurora shimmer.", help: "A Pitch Shifter adds an octave shimmer, a slow Phaser drifts and a huge Reverb finishes the aurora.", tags: ["shimmer", "phaser"] }),
]);
