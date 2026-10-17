// SPDX-License-Identifier: MIT
// Processors: tone-shaping and dynamics. EQ, compression, saturation, filters, gating and widening.
// Stereo cells: In L/R → processing → Out L/R.
import { cell, category } from "./kit.mjs";

// A mastering-style tone curve on the six-band EQ.
function airAndWeight() {
  const p = cell("Air & Weight", {
    description: "A gentle tone curve: a clean low cut, more weight in the bottom, less boxiness at 300 Hz and a lift of air on top. Shared inputs Weight and Air.",
    tags: ["eq", "mastering", "tone", "polish", "air"],
    help: "One EQ with four bands in use: a 24 dB/oct low cut at 28 Hz, a low shelf at 85 Hz (+2 dB), a wide dip at " +
      "300 Hz (-2.5 dB) and a high shelf at 10 kHz (+3 dB), plus a slight bell at 3 kHz for presence.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Weight is added to the gain of the low shelf and Air " +
      "to the gain of the high shelf, so each moves the curve by up to about 9 dB at full amount.\n\n" +
      "Tip: put it last on a mix; turn Air up until the top opens, then back off a little.",
  }).stereoIn().stereoOut().input("weight", "Weight").input("air", "Air");
  const eq = p.add("eq", [1, 0], {
    b1On: true, b1Type: "Low Cut", b1Hz: 28, b1Slope: "24 dB/oct",
    b2Type: "Low Shelf", b2Hz: 85, b2Gain: 2, b2Q: 0.7,
    b3Type: "Bell", b3Hz: 300, b3Gain: -2.5, b3Q: 0.8,
    b4Type: "Bell", b4Hz: 3000, b4Gain: 1, b4Q: 0.7,
    b5Type: "High Shelf", b5Hz: 10000, b5Gain: 3, b5Q: 0.7,
    level: -1,
  });
  p.stereo(p.cin, eq).stereo(eq, p.cout)
    .cable(p.cin, "weight", eq, "b2Gain", 0.25).cable(p.cin, "air", eq, "b5Gain", 0.25);
  return p;
}

// Slow, gentle bus compressor whose detector ignores the bass.
function softGlue() {
  const p = cell("Soft Glue", {
    description: "A slow, gentle compressor that listens only above 150 Hz, so the bass cannot make the mix pump: it holds drums, bass and chords together. Shared inputs Threshold and Mix.",
    tags: ["compressor", "bus", "glue", "dynamics", "mix"],
    help: "A Compressor in RMS mode with a low ratio, a slow 30 ms attack and a soft knee. Its Sidechain input " +
      "gets a copy of the signal through a 1-pole high-pass at 150 Hz, so loud bass notes do not control the " +
      "gain reduction. A light shelf on top adds a little polish afterwards.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Threshold is subtracted from the compressor's " +
      "Threshold knob (more means more compression) and Mix is added to its Mix knob, which blends the " +
      "squeezed sound with the dry one.\n\n" +
      "Tip: on a drum bus, set Threshold so the needle moves two to four decibels on loud hits.",
  }).stereoIn().stereoOut().input("amount", "Amount").input("mix", "Mix");
  const hp = p.add("filter", [0, 1], { cutoff: 150, type: "1-Pole High-pass" }, { name: "Detector Low Cut" });
  const comp = p.add("compressor", [1, 0], { threshold: -22, ratio: 2.5, attack: 30, release: 220, knee: 10, makeup: 3, detector: "RMS", mix: 1 });
  const tone = p.add("eq", [2, 0], { b5Hz: 9000, b5Gain: 1.5 }, { name: "Polish" });
  p.stereo(p.cin, hp).stereo(p.cin, comp)
    .cable(hp, "l", comp, "key")
    .stereo(comp, tone).stereo(tone, p.cout)
    .cable(p.cin, "amount", comp, "threshold", -0.4).cable(p.cin, "mix", comp, "mix", 0.5);
  return p;
}

// Tape saturation followed by a gentle roll-off.
function tapeWarmth() {
  const p = cell("Tape Warmth", {
    description: "Tape-style saturation with a bit of supply sag, rounded off by a soft top cut and a little extra bottom: the warmth of a good machine. Shared inputs Drive and Tone.",
    tags: ["saturation", "tape", "warm", "analog"],
    help: "A Saturator in its Tape character with moderate drive, some sag, followed by an EQ with a low " +
      "shelf at 100 Hz (+1.5 dB) and a gentle high cut at 14 kHz.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Drive is added to the Saturator's Drive knob and Tone " +
      "to its Tone knob, which sets the top end of the saturated signal. It does not follow the transport.\n\n" +
      "Tip: it works on almost anything; try it on drums for glue or on a synth to soften digital edges.",
  }).stereoIn().stereoOut().input("drive", "Drive").input("tone", "Tone");
  const sat = p.add("saturator", [1, 0], { character: "Tape", drive: 0.5, bias: 0.05, color: 0.1, sag: 0.4, age: 0, tone: 12000, level: 1, mix: 1 });
  const eq = p.add("eq", [2, 0], { b2Hz: 100, b2Gain: 1.5, b6On: true, b6Hz: 14000, b6Slope: "12 dB/oct" }, { name: "Roll-Off" });
  p.stereo(p.cin, sat).stereo(sat, eq).stereo(eq, p.cout)
    .cable(p.cin, "drive", sat, "drive", 0.4).cable(p.cin, "tone", sat, "tone", 0.4);
  return p;
}

// EQ, compressor and limiter in a row: loudness without crushing.
function loudnessPush() {
  const p = cell("Loudness Push", {
    description: "A tone curve, a medium compressor and a brickwall limiter in a row: it makes a mix louder and more even without falling over. Shared inputs Push and Bright.",
    tags: ["limiter", "mastering", "loudness", "compressor", "eq"],
    help: "Three stages: an EQ (low cut at 30 Hz, a lift at 90 Hz, a dip at 350 Hz and a high shelf), a Compressor " +
      "at 3:1 with a 15 ms attack, and a Limiter with a ceiling at -1 dB.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Push is added to the Limiter's Input knob (up to +24 " +
      "dB at full amount, so a small turn is enough) and Bright to the high shelf's gain.\n\n" +
      "Tip: raise Push until the loudest parts just touch the limiter, and leave the rest of the headroom alone.",
  }).stereoIn().stereoOut().input("push", "Push").input("bright", "Bright");
  const eq = p.add("eq", [1, 0], {
    b1On: true, b1Hz: 30, b1Slope: "24 dB/oct",
    b2Hz: 90, b2Gain: 2, b3Hz: 350, b3Gain: -2, b3Q: 0.9, b4On: false, b5Hz: 9000, b5Gain: 2.5,
  });
  const comp = p.add("compressor", [2, 0], { threshold: -18, ratio: 3, attack: 15, release: 140, knee: 6, makeup: 3 });
  const lim = p.add("limiter", [3, 0], { ceiling: -1, release: 80, input: 3 });
  p.stereo(p.cin, eq).stereo(eq, comp).stereo(comp, lim).stereo(lim, p.cout)
    .cable(p.cin, "push", lim, "input", 0.25).cable(p.cin, "bright", eq, "b5Gain", 0.25);
  return p;
}

// The playing loudness sweeps a band-pass.
function touchWah() {
  const p = cell("Touch Wah", {
    description: "The loudness of what you play opens a resonant band-pass: hard notes make it quack, soft notes keep it closed. Shared inputs Sensitivity and Cutoff.",
    tags: ["wah", "envelope follower", "funk", "filter", "dynamic"],
    help: "An Envelope Follower listens to the input and its output opens the cutoff of an SVF Band-pass filter with " +
      "medium-high resonance. The follower reacts in a few milliseconds and falls back in a quarter of a " +
      "second, which is the typical quack.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Sensitivity is added to the follower's Gain (how far " +
      "the wah opens for a given loudness) and Cutoff to the filter's resting cutoff.\n\n" +
      "Tip: it loves funky guitar, clavinet and bass; play with a lot of dynamics and set Sensitivity so the " +
      "loudest note just opens the filter fully.",
  }).stereoIn().stereoOut().input("sens", "Sensitivity").input("cut", "Cutoff");
  const env = p.add("envelope-follower", [0, 1], { attack: 0.008, release: 0.22, gain: 4 }, { name: "Touch" });
  const flt = p.add("filter", [1, 0], { type: "SVF Bandpass (unit gain)", cutoff: 450, resonance: 0.5, drive: 0.15, mix: 0.75 }, { name: "Wah" });
  p.cable(p.cin, "l", env, "in")
    .cable(env, "env", flt, "cutoff", 0.4).cable(p.cin, "sens", env, "gain", 0.3).cable(p.cin, "cut", flt, "cutoff", 0.4)
    .stereo(p.cin, flt).stereo(flt, p.cout);
  return p;
}

// Two band-pass filters at different centres, slowly sliding: a vowel that never settles.
function driftingVowel() {
  const p = cell("Drifting Vowel", {
    description: "Two resonant band-passes side by side, the second pulled away from the first, slowly drifting: a sound seems to change vowels as it plays. Shared inputs Cutoff and Spread.",
    tags: ["formant", "vowel", "filter", "dual filter", "vocal"],
    help: "A Dual Filter in Parallel routing with two band-pass sections and medium resonance. The second filter " +
      "sits above the first by Spread. A slow LFO named Drift moves the shared cutoff, so the pair glides " +
      "across vowel-like positions.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Cutoff is added to the shared cutoff and Spread to " +
      "the distance between the two peaks. It does not follow the transport.\n\n" +
      "Tip: it needs a source with plenty of harmonics, like a saw, a pulse, strings or noise.",
  }).stereoIn().stereoOut().input("cut", "Cutoff").input("spread", "Spread");
  const lfo = p.add("lfo", [0, 1], { rate: 0.15, wave: "Triangle" }, { name: "Drift" });
  const df = p.add("dual-filter", [1, 0], { cutoff: 600, spread: 1.4, res1: 0.55, res2: 0.55, mode1: 0.5, mode2: 0.5,
                                            drive: 0.15, routing: "Parallel", mix: 0.9 });
  p.stereo(p.cin, df).stereo(df, p.cout)
    .cable(lfo, "out", df, "cutoff", 0.18).cable(p.cin, "cut", df, "cutoff", 0.4).cable(p.cin, "spread", df, "spread", 0.2);
  return p;
}

// Envelope follower threshold gate drives a smoothed VCA.
function tightGate() {
  const p = cell("Tight Gate", {
    description: "Silences everything below a threshold so noise, hum and spill between notes disappear: the gate closes with a short, smoothed release. Shared inputs Threshold and Release.",
    tags: ["gate", "noise gate", "cleanup", "dynamics", "drums"],
    help: "An Envelope Follower with a threshold turns the input into a gate signal, a Utility named Smooth " +
      "slews it so the edges do not click, and a VCA applies it to the sound.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Threshold is added to the follower's threshold " +
      "(higher means more is cut) and Release is added to its release, which also lengthens the time the gate " +
      "stays open after a hit.\n\n" +
      "Tip: set Threshold just above the noise floor; on drums, shorten Release for a tight, punchy sound.",
  }).stereoIn().stereoOut().input("threshold", "Threshold").input("release", "Release");
  const env = p.add("envelope-follower", [0, 1], { attack: 0.002, release: 0.12, gain: 2, threshold: 0.06 }, { name: "Detector" });
  const soft = p.add("utility", [1, 1], { slew: 0.01 }, { name: "Smooth" });
  const vca = p.add("vca", [2, 0], { gain: 0, response: "Linear" });
  p.cable(p.cin, "l", env, "in")
    .cable(env, "gate", soft, "x").cable(soft, "out", vca, "gain")
    .cable(p.cin, "threshold", env, "threshold", 0.3).cable(p.cin, "release", env, "release", 0.3)
    .stereo(p.cin, vca).stereo(vca, p.cout);
  return p;
}

// A short, high-passed Haas copy at a different time on each side.
function haasWidener() {
  const p = cell("Haas Widener", {
    description: "A high-passed copy delayed by a different few milliseconds on each side is added under the dry sound: mono sources spread out without phasing the bass. Shared inputs Width and Time.",
    tags: ["stereo", "widener", "haas", "width", "mix"],
    help: "The dry sound passes straight through. A copy goes through a 1-pole high-pass at 250 Hz, a Delay with " +
      "12 ms on the left and 23 ms on the right, and a VCA named Width into the output. Because the low end is " +
      "left out of the copy, the bass stays centred and solid.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Width is added to the VCA gain and Time to both delay " +
      "times. Check the result in mono; very high Width can thin out the sound.\n\n" +
      "Tip: use it on mono synths, guitars or vocals that sound narrow next to a stereo bed.",
  }).stereoIn().stereoOut().input("width", "Width").input("time", "Time");
  const hp = p.add("filter", [1, 1], { cutoff: 250, type: "1-Pole High-pass" }, { name: "Keep Bass Out" });
  const dly = p.add("delay", [2, 1], { timel: 12, timer: 23, feedback: 0, lowcut: 20, highcut: 14000, mix: 1 });
  const vca = p.add("vca", [3, 1], { gain: 0.5, response: "Linear" }, { name: "Width" });
  p.stereo(p.cin, p.cout).stereo(p.cin, hp).stereo(hp, dly).stereo(dly, vca).stereo(vca, p.cout)
    .cable(p.cin, "width", vca, "gain", 0.5).cable(p.cin, "time", dly, "timel", 0.2).cable(p.cin, "time", dly, "timer", 0.2);
  return p;
}

// A crushed, folded copy blended under the clean sound.
function parallelGrit() {
  const p = cell("Parallel Grit", {
    description: "A crushed and folded copy of the sound is blended with the clean one: drums and basses gain bite and weight without losing their shape. Shared inputs Grit and Blend.",
    tags: ["distortion", "parallel", "bitcrusher", "wavefolder", "drums"],
    help: "The sound goes down two paths: one stays clean, the other passes a Crunch (8 bits, reduced sample rate, " +
      "tone at 6 kHz) and then a Folder. A Crossfader blends the two.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Grit is added to the Crunch Drive and the Folder's " +
      "Fold, so one control makes the dirty path nastier; Blend is added to the Crossfader and sets how much of " +
      "it you hear.\n\n" +
      "Tip: for a drum loop, keep Blend around a third and push Grit; for a bass, lower both.",
  }).stereoIn().stereoOut().input("grit", "Grit").input("blend", "Blend");
  const cr = p.add("crunch", [1, 1], { drive: 0.55, bits: 8, rate: 0.2, tone: 6000, level: 0.9 });
  const fold = p.add("wavefolder", [2, 1], { fold: 0.25, symmetry: 0.15, source: "Input", mix: 1 });
  const fade = p.add("crossfader", [3, 0], { fade: 0.3 }, { name: "Blend" });
  p.stereo(p.cin, cr).stereo(cr, fold)
    .cable(p.cin, "l", fade, "al").cable(p.cin, "r", fade, "ar")
    .cable(fold, "l", fade, "bl").cable(fold, "r", fade, "br")
    .cable(fade, "outl", p.cout, "l").cable(fade, "outr", p.cout, "r")
    .cable(p.cin, "grit", cr, "drive", 0.4).cable(p.cin, "grit", fold, "fold", 0.4).cable(p.cin, "blend", fade, "fade", 0.5);
  return p;
}

// Compressor ducked by a band-passed copy: only sibilance is turned down.
function deEsser() {
  const p = cell("Gentle De-Esser", {
    description: "Harsh S sounds and hi-hat sizzle around 6 to 8 kHz pull the whole sound down for a moment and nothing else does: a vocal or a bright mix stays smooth. Shared inputs Amount and Frequency.",
    tags: ["de-esser", "vocal", "compressor", "sibilance", "dynamics"],
    help: "A band-pass filter at 6.5 kHz listens to the input and feeds the Sidechain input of a fast Compressor. " +
      "When the band is loud (an S or a hi-hat), the compressor turns the whole signal down for a few " +
      "milliseconds; otherwise the sound passes untouched.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Amount is subtracted from the compressor's Threshold " +
      "(higher means more de-essing) and Frequency is added to the listening filter's cutoff.\n\n" +
      "Tip: sweep Frequency while a vocal plays until the harshest S is tamed, then lower Amount until the " +
      "effect is hardly audible.",
  }).stereoIn().stereoOut().input("amount", "Amount").input("freq", "Frequency");
  const band = p.add("filter", [0, 1], { type: "SVF Bandpass (unit gain)", cutoff: 6500, resonance: 0.35 }, { name: "Listener" });
  const comp = p.add("compressor", [1, 0], { threshold: -28, ratio: 5, attack: 0.5, release: 70, knee: 4, makeup: 0, detector: "Peak" });
  p.stereo(p.cin, band).stereo(p.cin, comp)
    .cable(band, "l", comp, "key")
    .stereo(comp, p.cout)
    .cable(p.cin, "amount", comp, "threshold", -0.3).cable(p.cin, "freq", band, "cutoff", 0.3);
  return p;
}

export default category("Processors", "Tone-shaping and dynamics: EQ, compression, saturation, filters, gating, widening and distortion for any stereo signal.", [
  airAndWeight, softGlue, tapeWarmth, loudnessPush, touchWah, driftingVowel, tightGate, haasWidener, parallelGrit, deEsser,
]);
