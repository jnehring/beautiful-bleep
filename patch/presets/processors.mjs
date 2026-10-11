// SPDX-License-Identifier: MIT
// Processors: pitch, modulation, dynamics and tone effects, built from the Pitch Shifter, Chorus, Phaser,
// Compressor, Crunch and EQ modules. In L/R → processing → Out L/R.
import { cell, category } from "./kit.mjs";

// The shimmer: the reverb's wet signal goes through a shifter and back into the reverb. A limiter keeps the loop
// from running away; the shared Shimmer input opens or closes the loop gain.
function shimmerLoop(name, description, tags, help, { semitones, window, loop, decay, tail }) {
  const p = cell(name, { description, tags, help })
    .stereoIn().stereoOut().input("mix", "Mix").input("shimmer", "Shimmer").input("freeze", "Freeze", "gate")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail } });  // Verb decay, lengthened by the loop
  const verb = p.add("reverb", [1, 0], { size: 0.85, decay, preDelay: 0.02, damping: 0.35, modDepth: 0.35, tone: 0.1, mix: 0.5 });
  const gain = p.add("vca", [2, 1], { gain: loop }, { name: "Shimmer" });
  const shift = p.add("pitch-shifter", [3, 1], { pitch: semitones, window, drift: 0.12, mix: 1 });
  const limit = p.add("compressor", [4, 1], { threshold: -9, ratio: 40, attack: 0.5, release: 120, knee: 3 }, { name: "Loop Limiter" });
  p.stereo(p.cin, verb).stereo(verb, gain, { from: ["wetL", "wetR"] }).stereo(gain, shift).stereo(shift, limit)
    .stereo(limit, verb).stereo(verb, p.cout)
    .cable(p.cin, "mix", verb, "mix", 0.5).cable(p.cin, "shimmer", gain, "gain", 0.5).cable(p.cin, "freeze", verb, "freeze");
  return p;
}

function shimmerVerb() {
  return shimmerLoop("Shimmer Verb", "The reverb's tail is pitched up an octave and fed back into it, so every echo climbs: a halo of ever higher voices above the sound. A limiter keeps the loop bounded. Shared inputs Mix, Shimmer (loop amount) and Freeze.",
    ["shimmer", "reverb", "octave", "ambient", "pitch"],
    "A Reverb whose wet signal goes through a Pitch Shifter (up 12 semitones), a Shimmer VCA and a Loop Limiter compressor, " +
    "then back into the reverb. Each echo is an octave higher than the last; the limiter keeps the loop from running away.\n\n" +
    "Patch a sound into In L/R and take Out L/R onwards. Mix is added to the reverb mix, Shimmer to the loop gain (more means " +
    "more climbing echoes), and a gate into Freeze holds the tail. The tail is long, about 20 seconds.\n\n" +
    "Tip: play single sustained notes and raise Shimmer slowly.", { semitones: 12, window: 100, loop: 0.35, decay: 8, tail: 20 });
}

function fifthShimmer() {
  return shimmerLoop("Fifth Shimmer", "The same loop, but a fifth up: each echo moves to the next fifth, so the halo is open and suspended rather than bright. A longer window keeps it smooth. Shared inputs Mix, Shimmer and Freeze.",
    ["shimmer", "reverb", "fifth", "ambient", "pitch"],
    "The same loop as Shimmer Verb: the reverb's wet signal passes through a Pitch Shifter, a gain stage and a limiter before " +
    "returning. Here the shift is a fifth (7 semitones) with a longer window, so the repeats stack into open fifths.\n\n" +
    "Patch a sound into In L/R and take Out L/R onwards. Mix is added to the reverb mix, Shimmer to the loop gain, and a gate " +
    "into Freeze holds the tail. The tail is long, about 22 seconds.\n\n" +
    "Tip: with Shimmer low it adds a soft ghost fifth; with it high the tail becomes a wide suspended chord.", { semitones: 7, window: 140, loop: 0.3, decay: 10, tail: 22 });
}

// A shifted-down copy, rounded off, under the original.
function subOctaver() {
  const p = cell("Sub Octaver", {
    description: "A copy of the sound an octave down, with its top taken off, mixed under the original: a bass, a lead or a kick gets a floor. Shared input Sub (the amount of the lower octave).",
    tags: ["octave", "bass", "pitch", "sub"],
    help: "A Pitch Shifter drops a copy of the sound one octave, a 1-pole low-pass at 400 Hz rounds its top " +
      "off, and a VCA named Sub sets its level. The result is mixed under the original, which passes " +
      "through unchanged.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Sub input is added to the Sub gain: more " +
      "adds more low octave. It works best on one note at a time, as a pitch shifter does not follow chords " +
      "cleanly.\n\n" +
      "Tip: use it on a mono bass line or a lead, and keep Sub moderate to avoid clipping.",
  }).stereoIn().stereoOut().input("sub", "Sub");
  const shift = p.add("pitch-shifter", [0, 1], { pitch: -12, window: 60, mix: 1 });
  const lp = p.add("filter", [1, 1], { cutoff: 400, type: "1-Pole Low-pass" }, { name: "Round Off" });
  const gain = p.add("vca", [2, 1], { gain: 0.6 }, { name: "Sub" });
  p.stereo(p.cin, shift).stereo(shift, lp).stereo(lp, gain).stereo(gain, p.cout).stereo(p.cin, p.cout)
    .cable(p.cin, "sub", gain, "gain", 0.5);
  return p;
}

// Two slightly detuned, drifting copies and a light chorus around the dry sound.
function vocalDoubler() {
  const p = cell("Vocal Doubler", {
    description: "Two copies, a few cents sharp and flat, each wandering a little, plus a light chorus: a single voice or lead becomes a small ensemble. Shared input Spread (the detune).",
    tags: ["doubler", "vocal", "chorus", "pitch", "wide"],
    help: "Two Pitch Shifters, one 9 cents sharp and one 9 cents flat, each with a little drift, plus a light " +
      "Chorus. The dry sound and both copies go into the chorus, which makes the result wider.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Spread input is added to both shifters' Fine " +
      "knobs in opposite directions, widening the detune. It does not follow the transport.\n\n" +
      "Tip: works well on a single voice, a lead or a mono synth that needs width.",
  }).stereoIn().stereoOut().input("spread", "Spread");
  const up = p.add("pitch-shifter", [0, 0], { pitch: 0, fine: 9, window: 40, drift: 0.25, mix: 1 }, { name: "Sharp" });
  const down = p.add("pitch-shifter", [0, 1], { pitch: 0, fine: -9, window: 46, drift: 0.25, mix: 1 }, { name: "Flat" });
  const cho = p.add("chorus", [1, 0], { rate: 0.35, depth: 0.35, delay: 14, spread: 0.8, mix: 0.3 });
  p.stereo(p.cin, up).stereo(p.cin, down)
    .stereo(p.cin, cho, { amount: 0.5 }).stereo(up, cho, { amount: 0.35 }).stereo(down, cho, { amount: 0.35 })
    .stereo(cho, p.cout)
    .cable(p.cin, "spread", up, "fine", 0.3).cable(p.cin, "spread", down, "fine", -0.3);
  return p;
}

function jetFlanger() {
  const p = cell("Jet Flanger", {
    description: "A short, resonant flanger on a slow sweep: the whoosh of a jet passing over drums, noise or a full mix. Shared inputs Rate and Feedback.",
    tags: ["flanger", "modulation", "jet", "sweep"],
    help: "A Chorus module in Flanger mode: short delay (2.2 ms), deep modulation, strong feedback and a slow " +
      "rate (0.12 Hz). The sweep gives a jet-like whoosh.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Rate is added to the flanger's Rate knob and " +
      "Feedback to its Feedback knob. It does not follow the transport.\n\n" +
      "Tip: put it on drums or a full mix; raise Feedback for a more metallic sound.",
  }).stereoIn().stereoOut().input("rate", "Rate").input("fb", "Feedback");
  const fl = p.add("chorus", [0, 0], { mode: "Flanger", rate: 0.12, depth: 0.85, delay: 2.2, feedback: 0.72, spread: 0.6, mix: 0.5 });
  p.stereo(p.cin, fl).stereo(fl, p.cout).cable(p.cin, "rate", fl, "rate", 0.4).cable(p.cin, "fb", fl, "feedback", 0.3);
  return p;
}

function slowPhaser() {
  const p = cell("Slow Phaser", {
    description: "Eight allpass stages sweeping slowly and wide, the right ear half a cycle behind the left: notches that travel through a pad, strings or an electric piano. Shared inputs Speed and Feedback.",
    tags: ["phaser", "modulation", "pad", "sweep", "stereo"],
    help: "A Phaser with eight allpass stages, a slow rate (0.08 Hz), wide depth and spread at maximum, so the " +
      "right ear is half a cycle behind the left. Notches travel through the sound.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Speed is added to the Rate knob and Feedback to " +
      "the Feedback knob. It does not follow the transport.\n\n" +
      "Tip: suits pads, strings and electric piano; raise Feedback for a more vocal sweep.",
  }).stereoIn().stereoOut().input("speed", "Speed").input("fb", "Feedback");
  const ph = p.add("phaser", [0, 0], { rate: 0.08, depth: 0.8, centre: 650, feedback: 0.55, stages: "8", spread: 1, mix: 0.5 });
  p.stereo(p.cin, ph).stereo(ph, p.cout).cable(p.cin, "speed", ph, "rate", 0.4).cable(p.cin, "fb", ph, "feedback", 0.3);
  return p;
}

// A kick (or any sound) on the sidechain input pushes the sound down.
function pumpDuck() {
  const p = cell("Pump Duck", {
    description: "Patch a kick or any rhythmic sound into Sidechain and the sound on In L/R is pushed down with every hit, then swells back: the pumping of dance music. Shared inputs Sidechain, Depth (lowers the threshold) and Release.",
    tags: ["sidechain", "compressor", "pump", "ducking", "dance"],
    help: "A Compressor with a high ratio, a low threshold and a 3 ms attack, driven by a sidechain key. " +
      "Whatever you patch into Sidechain pushes the sound on In L/R down, then it swells back over a 220 ms " +
      "release.\n\n" +
      "Patch the sound to be ducked into In L/R, a kick or any rhythmic sound into Sidechain, and take Out " +
      "L/R onwards. Depth is added to the threshold (more means deeper ducking) and Release to the release " +
      "time.\n\n" +
      "Tip: patch a kick into Sidechain and a pad into In L/R for classic dance pumping.",
  }).stereoIn().stereoOut().input("key", "Sidechain", "audio").input("depth", "Depth").input("release", "Release");
  const comp = p.add("compressor", [0, 0], { threshold: -32, ratio: 12, attack: 3, release: 220, knee: 4, makeup: 2, link: 1 });
  p.stereo(p.cin, comp).stereo(comp, p.cout)
    .cable(p.cin, "key", comp, "key").cable(p.cin, "depth", comp, "threshold", -0.4).cable(p.cin, "release", comp, "release", 0.4);
  return p;
}

function brokenRadio() {
  const p = cell("Broken Radio", {
    description: "Five bits, a quarter of the sample rate, a drive and a band-limiting EQ: music through a failing radio or a 90s sampler. Shared input Damage.",
    tags: ["lo-fi", "bitcrusher", "radio", "distortion"],
    help: "A Crunch module (5 bits, quarter sample rate, drive) followed by an EQ that cuts lows and highs and " +
      "boosts the mids. Together this sounds like a small, failing radio.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Damage input is subtracted from Bits and " +
      "added to Rate, so one control wrecks both. It does not follow the transport.\n\n" +
      "Tip: try it on a full mix, then bring Damage up for dropouts.",
  }).stereoIn().stereoOut().input("damage", "Damage");
  const cr = p.add("crunch", [0, 0], { drive: 0.5, bits: 5, rate: 0.35, tone: 3200, level: 1 });
  const eq = p.add("eq", [1, 0], { lowHz: 500, lowGain: -12, m2Hz: 1600, m2Gain: 5, m2Q: 1.2, highHz: 4500, highGain: -10 });
  p.stereo(p.cin, cr).stereo(cr, eq).stereo(eq, p.cout)
    .cable(p.cin, "damage", cr, "bits", -0.35).cable(p.cin, "damage", cr, "rate", 0.35);
  return p;
}

function telephone() {
  const p = cell("Telephone", {
    description: "Everything below 500 Hz and above 3 kHz removed, a bump in the middle and a touch of drive: a voice or a drum loop down the line. Shared input Drive.",
    tags: ["telephone", "eq", "band-pass", "lo-fi"],
    help: "An EQ cuts everything below about 700 Hz and above 3 kHz and lifts the middle, followed by a Crunch " +
      "module for a little drive. This narrow band is the sound of a voice or loop down the line.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Drive input is added to the Crunch Drive " +
      "knob.\n\n" +
      "Tip: use it on a vocal or a drum loop and bring in Drive for distortion.",
  }).stereoIn().stereoOut().input("drive", "Drive");
  const eq = p.add("eq", [0, 0], { lowHz: 700, lowGain: -15, m1Hz: 1500, m1Gain: 6, m1Q: 1.5, highHz: 3000, highGain: -15 });
  const cr = p.add("crunch", [1, 0], { drive: 0.35, mix: 0.7 });
  p.stereo(p.cin, eq).stereo(eq, cr).stereo(cr, p.cout).cable(p.cin, "drive", cr, "drive", 0.5);
  return p;
}

// Tape speed errors: a slow sine and a wandering LFO are the wow, a fast random one the flutter, all moving the
// shifter's pitch by a few cents. A little head-bump, top-end roll-off and saturation finish the tape.
function wowAndFlutter() {
  const p = cell("Wow & Flutter", {
    description: "The speed errors of a worn tape machine: a slow wow and a quick flutter wobble the pitch by a few cents, with a darker top, a little saturation and drift. Shared inputs Wow and Flutter (the depth of each).",
    tags: ["tape", "wow", "flutter", "vibrato", "lo-fi", "pitch"],
    help: "Three LFOs (a slow sine, a wandering random, a fast random) modulate the pitch of a Pitch Shifter by " +
      "a few cents. A Multiplier sets their depth. An EQ rolls off the top and a Crunch stage adds " +
      "saturation, like tape.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Wow input is added to the depth of the slow " +
      "motion and Flutter to the depth of the fast one. It does not follow the transport.\n\n" +
      "Tip: use it on pads or keys and keep the depths low for realism.",
  }).stereoIn().stereoOut().input("wow", "Wow").input("flutter", "Flutter");
  const slow = p.add("lfo", [0, 0], { rate: 0.55, wave: "Sine" }, { name: "Wow" });
  const wander = p.add("lfo", [0, 1], { rate: 1.4, wave: "Random Smooth" }, { name: "Wander" });
  const quick = p.add("lfo", [0, 2], { rate: 9, wave: "Random Smooth" }, { name: "Flutter" });
  const depth = p.add("multiplier", [1, 1], { biasx1: 0, biasy1: 0.6, gain1: 1, biasx2: 0, biasy2: 0.5, gain2: 1 }, { name: "Depth" });
  const shift = p.add("pitch-shifter", [2, 0], { pitch: 0, window: 30, drift: 0.2, mix: 1 }, { name: "Speed" });
  const tone = p.add("eq", [3, 0], { lowHz: 60, lowGain: -2, highHz: 7000, highGain: -5 }, { name: "Head" });
  const sat = p.add("crunch", [4, 0], { drive: 0.25, mix: 0.6 }, { name: "Tape" });
  p.cable(slow, "out", depth, "x1", 0.7).cable(wander, "out", depth, "x1", 0.3).cable(p.cin, "wow", depth, "y1", 0.4)
    .cable(quick, "out", depth, "x2").cable(p.cin, "flutter", depth, "y2", 0.4)
    .cable(depth, "out1", shift, "pitch", 0.003).cable(depth, "out2", shift, "pitch", 0.0008)
    .stereo(p.cin, shift).stereo(shift, tone).stereo(tone, sat).stereo(sat, p.cout);
  return p;
}

export default category("Processors", "Pitch, modulation, dynamics and tone effects: shimmer, doubling, flanging, phasing, sidechain pumping and lo-fi.", [
  shimmerVerb, fifthShimmer, subOctaver, vocalDoubler, jetFlanger, slowPhaser, pumpDuck, brokenRadio, telephone, wowAndFlutter,
]);
