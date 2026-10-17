// SPDX-License-Identifier: MIT
// Synthesizers: full-bodied polyphonic Voice Cells. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Saw and pulse through a ladder with a quick snap: house-style stabs.
function slateStabs() {
  const p = voice("Slate Stabs", {
    description: "A saw and a narrow pulse through a ladder that snaps open and shuts again: short, punchy chord stabs. Play it with a shared Cutoff knob or a filter LFO.",
    tags: ["poly", "stabs", "house", "chords", "punchy"],
    help: "A Dual Osc supplies a saw (A) and a narrow pulse (B) an octave apart. A quick Filter Env opens a Ladder Tanh filter " +
      "on each key and lets it fall back to a closed 500 Hz, so every chord is a short stab. The amp envelope has a " +
      "medium release so stabs do not click off.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter's resting point; turn it up for bright, open stabs.\n\n" +
      "Tip: play three- and four-note minor chords on the off-beat and add a delay after Out L/R.",
  }).settings({ voices: 8, spread: 0.25 }).input("cut", "Cutoff");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, shapeB: 1, widthA: 0.5, octaveB: 0, fineB: 6, balance: 0.45, drift: 0.2, width: 0.4 });
  const envf = envelope(p, [0, 1], { attack: 0.002, decay: 0.2, sustain: 0.05, release: 0.2, velamount: 0.6 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 500, resonance: 0.3, drive: 0.25, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.4).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 0.35, sustain: 0.5, release: 0.25 });
  return p;
}

// Two pulse oscillators with opposite pulse-width motion: the wide, chorused PWM ensemble.
function wideRibbonPulse() {
  const p = voice("Wide Ribbon Pulse", {
    description: "Two pulse waves whose widths sway in opposite directions on one slow LFO, giving a wide, chorused sound without a chorus. Shared input Sway.",
    tags: ["poly", "pwm", "pulse", "wide", "ensemble"],
    help: "Two Oscillators in pulse shape, one slightly flat and one sharp. A Sway LFO moves their Pulse Width in opposite " +
      "directions (one cable is inverted), so the pair slowly breathes in and out of phase. A gentle 1-Pole " +
      "low-pass softens the top, and the voices spread across the stereo field.\n\n" +
      "Notes in, Out L/R. The shared input Sway adds to the width movement of both oscillators; turn it up for a deeper effect.\n\n" +
      "Tip: hold wide, open chords. The motion is slow, so long notes show it best.",
  }).settings({ voices: 8, spread: 0.7 }).input("sway", "Sway");
  const o1 = p.add("oscillator", [0, 0], { shape: 1, pw: 0.5, fine: -9 }, { name: "Pulse Left" });
  const o2 = p.add("oscillator", [0, 1], { shape: 1, pw: 0.5, fine: 9 }, { name: "Pulse Right" });
  const lfo = p.add("lfo", [0, 2], { rate: 0.35, fade: 0.4 }, { name: "Sway LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 4200, keytrack: 0.4, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch").cable(p.vin, "pitch", flt, "pitch")
    .cable(lfo, "sine", o1, "pw", 0.3).cable(lfo, "sine", o2, "pw", -0.3)
    .cable(p.cin, "sway", o1, "pw", 0.3).cable(p.cin, "sway", o2, "pw", -0.3)
    .cable(o1, "out", flt, "l", 0.5).cable(o2, "out", flt, "r", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.01, decay: 0.4, sustain: 0.85, release: 0.5 });
  return p;
}

// Additive partials with a tilt that brightens on the attack: spectral keys.
function spectrumKeys() {
  const p = voice("Spectrum Keys", {
    description: "Additive partials whose brightness falls from a bright strike to a mellow hum, with a touch of chorus between the channels: clean, glassy, organ-like keys.",
    tags: ["poly", "additive", "keys", "clean", "organ"],
    help: "An Additive Osc builds the note from up to 40 sine partials on a square-wave base, with a little built-in chorus. " +
      "A Bright Env lifts the number of partials at the start of each key and lets it settle, so notes strike bright and " +
      "relax. No filter is involved.\n\n" +
      "Notes in, Out L/R. The shared input Odd/Even moves the balance between odd and even partials: left is hollow and organ-like, right is fuller.\n\n" +
      "Tip: play it in the middle of the keyboard with slow chords, then sweep Odd/Even.",
  }).settings({ voices: 8 }).input("oe", "Odd/Even");
  const add = p.add("additive-osc", [0, 0], { partials: 14, tilt: -4, oddEven: -0.4, chorus: 12, chorusRate: 0.5, width: 0.5, damp: 0.5 }, { name: "Partials" });
  const envb = envelope(p, [0, 1], { attack: 0.001, decay: 0.5, sustain: 0.3, release: 0.4, velamount: 0.6 }, "Bright Env");
  p.cable(p.vin, "pitch", add, "pitch").cable(envb, "env", add, "partials", 0.4).cable(p.cin, "oe", add, "oddEven", 0.5);
  ampEnvelope(p, { node: add, stereo: true, jacks: ["outL", "outR"] }, [1, 1], { attack: 0.004, decay: 0.8, sustain: 0.7, release: 0.5 });
  return p;
}

// Hard sync swept by an envelope: ripping, vocal synth keys.
function syncRake() {
  const p = voice("Sync Rake", {
    description: "A dual oscillator with hard sync that opens wide on each note and settles, the way a classic sync lead rakes across a chord. Shared input Sync.",
    tags: ["poly", "sync", "aggressive", "bright", "classic"],
    help: "A Dual Osc with both oscillators set to saw, the second one synced to the first. An envelope raises the Sync amount " +
      "on every note and lets it fall back, which makes the harmonics sweep from tearing to calm. A ladder " +
      "takes the harshest edges off.\n\n" +
      "Notes in, Out L/R. The shared input Sync adds to the sync amount for the whole cell: raise it for a more aggressive sound.\n\n" +
      "Tip: short staccato chords reveal the sweep best; hold notes to hear it settle.",
  }).settings({ voices: 6, spread: 0.2 }).input("sync", "Sync");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, shapeB: 0.67, octaveB: 0, sync: 0.35, balance: 0.35, drift: 0.15, width: 0.3 });
  const envs = envelope(p, [0, 1], { attack: 0.003, decay: 0.6, sustain: 0.25, release: 0.35, velamount: 0.5 }, "Sync Env");
  const flt = p.add("filter", [1, 0], { cutoff: 3600, resonance: 0.15, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envs, "env", osc, "sync", 0.4).cable(p.cin, "sync", osc, "sync", 0.4)
    .stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.6, sustain: 0.75, release: 0.3 });
  return p;
}

// Folded sine with a decaying fold: metallic, bell-ish electric keys.
function foldedPianet() {
  const p = voice("Folded Pianet", {
    description: "A sine-like oscillator pushed into a wavefolder that relaxes after every strike: reedy, metallic keys with a barky attack and a smooth sustain.",
    tags: ["poly", "wavefolder", "keys", "reedy", "west coast"],
    help: "A Dual Osc generates a near-sine and folds it with its own Fold control. An envelope drives the fold up at the " +
      "start of each note and lets it fall, so the strike is bright and barky while the held note mellows. A quick " +
      "1-Pole low-pass trims the top.\n\n" +
      "Notes in, Out L/R. The shared input Fold adds to the fold amount; velocity also increases it.\n\n" +
      "Tip: play it with short, varied-velocity chords, like an electric piano that bites back.",
  }).settings({ voices: 8, spread: 0.2 }).input("fold", "Fold");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.1, balance: 0, fold: 0.15, symmetry: 0.1, drift: 0.05, width: 0.2 });
  const envf = envelope(p, [0, 1], { attack: 0.001, decay: 0.45, sustain: 0.08, release: 0.3, velamount: 0.8 }, "Fold Env");
  const flt = p.add("filter", [1, 0], { cutoff: 5200, keytrack: 0.4, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envf, "env", osc, "fold", 0.4).cable(p.cin, "fold", osc, "fold", 0.4)
    .stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 1.2, sustain: 0.4, release: 0.35, velamount: 0.6 });
  return p;
}

// Low pass gate chord voice: round, organic synth with a vactrol close.
function lunarGateChords() {
  const p = voice("Lunar Gate Chords", {
    description: "A saw pair into a Low Pass Gate: notes bloom open and close slowly and darkly, an organic, rounded poly synth. Shared input Brightness.",
    tags: ["poly", "vactrol", "organic", "round", "chords"],
    help: "Two detuned Oscillators (a saw and a triangle-core pulse) run into a Low Pass Gate. Each key pings the gate, which " +
      "opens fast and closes slowly and more darkly, like a vactrol. The Gate's Active output frees the voice, so there " +
      "is no separate amp envelope.\n\n" +
      "Notes in, Out L/R. The shared input Brightness adds to the gate's brightness: how open the tone is while the gate rings.\n\n" +
      "Tip: play firmly; harder velocity opens the gate further and leaves a longer tail.",
  }).settings({ voices: 8, spread: 0.4 }).input("bright", "Brightness");
  const o1 = p.add("oscillator", [0, 0], { shape: 0.67, fine: -6 }, { name: "Saw" });
  const o2 = p.add("oscillator", [0, 1], { shape: 0.9, pw: 0.35, fine: 6 }, { name: "Pulse" });
  const lpg = p.add("low-pass-gate", [1, 0], { level: 0, response: 0.55, ping: 0.9, resonance: 0.15, brightness: 0.5, drive: 0.2, cell: "Classic" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch")
    .cable(o1, "out", lpg, "l", 0.6).cable(o2, "out", lpg, "l", 0.45).cable(o1, "out", lpg, "r", 0.6).cable(o2, "out", lpg, "r", 0.45)
    .cable(p.vin, "trigger", lpg, "ping").cable(p.vin, "velocity", lpg, "velocity")
    .cable(p.vin, "gate", lpg, "cv", 0.6).cable(p.cin, "bright", lpg, "cv", 0.3)
    .cable(lpg, "active", p.vout, "active").stereo(lpg, p.vout);
  return p;
}

// Quintal swarm stack for open, hollow chord voicings.
function quintalStack() {
  const p = voice("Quintal Stack", {
    description: "A swarm built on stacked fifths: every key plays an open, hollow harmony that fills the stereo field, through a gentle low-pass. Shared input Warp.",
    tags: ["poly", "fifths", "open", "wide", "cinematic"],
    help: "A Swarm in Fifths mode spreads six oscillators over stacked fifths with mild detune, drift and width. A Ladder Tanh low-pass at 3 kHz " +
      "removes the fizz and a slow-ish envelope opens it.\n\n" +
      "Notes in, Out L/R. The shared input Warp bends the spacing of the swarm's partials; small amounts add colour, large ones get strange.\n\n" +
      "Tip: single notes are enough; each one is already a chord. Move up and down in fourths and fifths.",
  }).settings({ voices: 4, spread: 0.3 }).input("warp", "Warp");
  const sw = p.add("swarm", [0, 0], { chord: "Fifths", count: 6, spread: 0.5, detune: 10, drift: 0.3, width: 0.9, glide: 0.1 });
  const envf = envelope(p, [0, 1], { attack: 0.06, decay: 0.7, sustain: 0.55, release: 0.6, velamount: 0.4 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 1500, resonance: 0.12, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", sw, "pitch").cable(p.cin, "warp", sw, "warp", 0.5).stereo(sw, flt)
    .cable(p.vin, "pitch", flt, "pitch").cable(envf, "env", flt, "cutoff", 0.3);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.04, decay: 0.5, sustain: 0.8, release: 0.7 });
  return p;
}

// Vowel bank of the wavetable oscillator, scanned by the velocity and an envelope.
function vowelTableKeys() {
  const p = voice("Vowel Table Keys", {
    description: "The Vowel bank of a wavetable oscillator, steered across the vowels by an envelope and by how hard you play: talking, choir-like keys. Shared input Vowel.",
    tags: ["poly", "wavetable", "vowel", "vocal", "expressive"],
    help: "A Wavetable Osc on the Vowel bank with a little stereo detune. A Vowel Env moves its X position on each note, and velocity pushes " +
      "it further, so soft notes stay on one vowel while hard ones travel to another. A soft low-pass sits behind it.\n\n" +
      "Notes in, Out L/R. The shared input Vowel adds to the table's Y position, which picks a different row of vowels.\n\n" +
      "Tip: play long chords and vary the velocity of each finger to hear different vowels in one chord.",
  }).settings({ voices: 8, spread: 0.4 }).input("vowel", "Vowel");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "Vowel", x: 0.15, y: 0.2, stereo: 0.2, subLevel: 0.1 });
  const envx = envelope(p, [0, 1], { attack: 0.08, decay: 1, sustain: 0.5, release: 0.6, velamount: 0.7 }, "Vowel Env");
  const flt = p.add("filter", [1, 0], { cutoff: 6500, keytrack: 0.4, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", wt, "pitch").cable(envx, "env", wt, "x", 0.5).cable(p.vin, "velocity", wt, "x", 0.2)
    .cable(p.cin, "vowel", wt, "y", 0.5).stereo(wt, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.03, decay: 0.6, sustain: 0.75, release: 0.6 });
  return p;
}

// Band-pass reed: narrow pulse through two filters set to a pair of bands.
function hollowReed() {
  const p = voice("Hollow Reed", {
    description: "A narrow pulse split by a dual band-pass pair into a nasal, woody, clarinet-like tone with a breath of noise at the start. Shared input Spread.",
    tags: ["poly", "reed", "woody", "nasal", "filtered"],
    help: "A narrow-pulse Oscillator passes through a Dual Filter in Parallel routing with both bands set to band-pass, pulled apart by Spread " +
      "to give a hollow, reedy tone. A little Noise is let in by a very short envelope for the breath at the start of the note.\n\n" +
      "Notes in, Out L/R. The shared input Spread moves the two bands apart: closer sounds nasal, wider sounds hollow.\n\n" +
      "Tip: play single lines and slow, close harmonies. Keep the vibrato to the pitch wheel on your keyboard.",
  }).settings({ voices: 6, spread: 0.2 }).input("spread", "Spread");
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.18 });
  const noise = p.add("noise", [0, 1], { colour: 0.4, level: 0.5 });
  const envn = envelope(p, [0, 2], { attack: 0.001, decay: 0.07, sustain: 0, release: 0.05, velamount: 0.5 }, "Breath Env");
  const nvca = p.add("vca", [1, 2], {}, { name: "Breath VCA" });
  const flt = p.add("dual-filter", [2, 0], { cutoff: 900, spread: 1.4, res1: 0.5, res2: 0.4, mode1: 0.5, mode2: 0.5, keyTrack: 0.9, drive: 0.1, routing: "Parallel" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(p.vin, "pitch", flt, "pitch").cable(p.cin, "spread", flt, "spread", 0.3)
    .cable(osc, "out", flt, "l", 0.6).cable(osc, "out", flt, "r", 0.6)
    .cable(noise, "out", nvca, "l", 0.5).cable(envn, "env", nvca, "gain", 0.5)
    .cable(nvca, "l", flt, "l", 0.5).cable(nvca, "l", flt, "r", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [3, 1], { attack: 0.025, decay: 0.3, sustain: 0.85, release: 0.15 });
  return p;
}

// Harmonic model of the macro oscillator opening like an organ-synth blend.
function harmonicBloom() {
  const p = voice("Harmonic Bloom", {
    description: "A macro oscillator on its harmonic model: the spectrum opens upward as you hold a key, a bright, smooth, singing poly tone. Shared input Tone.",
    tags: ["poly", "harmonic", "smooth", "singing", "evolving"],
    help: "A Macro Osc on the Harmonic model. A Bloom Env raises its Tone and Shape slowly after the key goes down, so the upper harmonics fade " +
      "in and the note blooms. Velocity sets how far it opens. Aux is not used.\n\n" +
      "Notes in, Out L/R. The shared input Tone adds to the spectrum position of every voice.\n\n" +
      "Tip: hold chords for several seconds to hear the full bloom; short notes stay warm and soft.",
  }).settings({ voices: 8, spread: 0.3 }).input("tone", "Tone");
  const osc = p.add("macro-osc", [0, 0], { model: "Harmonic", tone: 0.2, shape: 0.3, blend: 0.4, level: 0.7 });
  const envb = envelope(p, [0, 1], { attack: 0.5, decay: 1.5, sustain: 0.6, release: 0.8, velamount: 0.6 }, "Bloom Env");
  p.cable(p.vin, "pitch", osc, "pitch").cable(envb, "env", osc, "tone", 0.4).cable(envb, "env", osc, "shape", 0.25)
    .cable(p.cin, "tone", osc, "tone", 0.4);
  ampEnvelope(p, { node: osc, jack: "out" }, [1, 1], { attack: 0.03, decay: 0.7, sustain: 0.8, release: 0.7 });
  return p;
}

export default category("Synthesizers", "Full-bodied polyphonic Voice Cells for chords, stabs and keys: patch Notes in and take Out L/R.", [
  slateStabs, wideRibbonPulse, spectrumKeys, syncRake, foldedPianet, lunarGateChords, quintalStack, vowelTableKeys, hollowReed, harmonicBloom,
]);
