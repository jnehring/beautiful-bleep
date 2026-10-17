// SPDX-License-Identifier: MIT
// Basses: mostly monophonic Voice Cells for low lines. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Two saws and a sub through a big ladder: the classic fat analog bass.
function heavyLadder() {
  const p = voice("Heavy Ladder Bass", {
    description: "Two detuned saws plus a sub square through a thick, lightly resonant ladder with a medium envelope: the all-round fat analog bass. Shared input Cutoff.",
    tags: ["mono", "analog", "fat", "ladder", "classic"],
    help: "Two Oscillators (saws, 8 cents apart) and the first one's sub output feed a Ladder Tanh filter at 240 Hz. A medium Filter Env " +
      "opens it on every note. The cell is mono, with a short glide between overlapping notes.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter; raise it for a brighter, more present bass.\n\n" +
      "Tip: double a kick drum rhythm with it and keep the notes short or long, not in between.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.04 }).input("cut", "Cutoff");
  const o1 = p.add("oscillator", [0, 0], { shape: 0.67, fine: -8 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [0, 1], { shape: 0.67, fine: 8 }, { name: "Saw 2" });
  const envf = envelope(p, [0, 2], { attack: 0.003, decay: 0.35, sustain: 0.35, release: 0.15, velamount: 0.5 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 240, resonance: 0.25, drive: 0.35, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch").cable(p.vin, "pitch", flt, "pitch")
    .cable(o1, "out", flt, "l", 0.45).cable(o2, "out", flt, "l", 0.45).cable(o1, "sub", flt, "l", 0.4)
    .cable(envf, "env", flt, "cutoff", 0.35).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.4, sustain: 0.85, release: 0.1 });
  return p;
}

// A fast pitch fall at the start of the note, like a thumbed string.
function slapSnap() {
  const p = voice("Slap Snap Bass", {
    description: "A triangle-core oscillator that starts a fifth above and snaps down onto the note, with a pulse edge: a springy, slapped electric bass. Shared input Snap.",
    tags: ["mono", "slap", "funk", "percussive", "pitch envelope"],
    help: "An Oscillator in a pulse-leaning shape with its sub output added. A very short Snap Env pushes the pitch up by about seven " +
      "semitones and lets it fall onto the played note in a few milliseconds, the way a slapped string settles. A 2-pole low-pass keeps the highs " +
      "in check.\n\n" +
      "Notes in, Out L/R. The shared input Snap adds to how far the pitch snaps down; turn it up for a bigger pluck, down to zero for a plain bass.\n\n" +
      "Tip: play short, off-beat notes with strong accents and a ghost note between.",
  }).settings({ voices: 1, mode: "Mono" }).input("snap", "Snap");
  const osc = p.add("oscillator", [0, 0], { shape: 0.85, pw: 0.35 });
  const envs = envelope(p, [0, 1], { attack: 0.001, decay: 0.035, sustain: 0, release: 0.03, velamount: 0.4 }, "Snap Env");
  const envf = envelope(p, [0, 2], { attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.1, velamount: 0.7 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 320, resonance: 0.3, keytrack: 0.6, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envs, "env", osc, "pitch", semis(7)).cable(p.cin, "snap", osc, "pitch", semis(5))
    .cable(osc, "out", flt, "l", 0.7).cable(osc, "sub", flt, "l", 0.4).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.4);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.001, decay: 0.28, sustain: 0.3, release: 0.08, velamount: 0.5 });
  return p;
}

// Pulse width rippling at a steady rate.
function ripplePulse() {
  const p = voice("Ripple Pulse Bass", {
    description: "A pulse wave whose width ripples on a quick LFO and a filter that follows the key: a hollow, buzzing bass for synth-pop and electro. Shared input Ripple.",
    tags: ["mono", "pwm", "electro", "synth-pop", "buzzy"],
    help: "An Oscillator in pulse shape, with a Ripple LFO moving its Pulse Width at a few hertz, and its sub added underneath. A resonant " +
      "SVF low-pass follows the keys, and aftertouch brightens it.\n\n" +
      "Notes in, Out L/R. The shared input Ripple adds to the width movement; more of it gives a more obvious chorus-like motion.\n\n" +
      "Tip: play straight eighth notes. Keep the Ripple LFO slower than the notes to hear it, faster to hear a buzz.",
  }).settings({ voices: 1, mode: "Mono", glide: 0.02 }).input("ripple", "Ripple");
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.5 });
  const lfo = p.add("lfo", [0, 1], { rate: 3.4 }, { name: "Ripple LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 700, resonance: 0.3, keytrack: 0.7, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(lfo, "sine", osc, "pw", 0.3).cable(p.cin, "ripple", osc, "pw", 0.3)
    .cable(osc, "out", flt, "l", 0.7).cable(osc, "sub", flt, "l", 0.35).cable(p.vin, "pitch", flt, "pitch")
    .cable(p.vin, "pressure", flt, "cutoff", 0.2);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.2, sustain: 0.8, release: 0.1 });
  return p;
}

// Pure sine with a big, fast pitch dive and a long tail.
function diveBomb() {
  const p = voice("Dive Bomb 808", {
    description: "A sine that dives an octave into the note and rings long, softly saturated: the boomy, sliding 808-style sub for trap and hip hop. Shared input Dive.",
    tags: ["mono", "808", "trap", "sub", "pitch envelope"],
    help: "An Oscillator on sine, with the sub added a little. A short Dive Env pushes the pitch up an octave at the start of each note and drops it onto the " +
      "key. A Ladder Tanh filter with drive rounds the edge. The amp tail is long, and legato notes slide into each other with a longer glide.\n\n" +
      "Notes in, Out L/R. The shared input Dive adds to the depth of the pitch drop. Turn it down to zero for a plain sub.\n\n" +
      "Tip: play low notes, one at a time, and link them for slides. The note length decides the groove.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.12, glidemode: "Legato only" }).input("dive", "Dive");
  const osc = p.add("oscillator", [0, 0], { shape: 0, octave: "-1" });
  const envd = envelope(p, [0, 1], { attack: 0.001, decay: 0.07, sustain: 0, release: 0.05, velamount: 0.3 }, "Dive Env");
  const flt = p.add("filter", [1, 0], { cutoff: 700, resonance: 0, drive: 0.45, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envd, "env", osc, "pitch", semis(12)).cable(p.cin, "dive", osc, "pitch", semis(10))
    .cable(osc, "sine", flt, "l", 0.8).cable(osc, "triangle", flt, "l", 0.1).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 1.4, sustain: 0.5, release: 0.25, velamount: 0.4 });
  return p;
}

// Square, triangle sub, no filter: chip-style.
function pixelBass() {
  const p = voice("Pixel Bass", {
    description: "A 25 percent pulse and a triangle an octave down with no filter and a hard stepped envelope: a clean, buzzy video-game console bass.",
    tags: ["mono", "chiptune", "8-bit", "retro", "square"],
    help: "An Oscillator on a narrow pulse and a second on a triangle one octave lower are mixed and sent straight to the VCA with no filter, so the " +
      "sound stays bright and simple. The envelope is short and drops to a held level quickly.\n\n" +
      "Notes in, Out L/R. No shared inputs. The cell is mono with no glide.\n\n" +
      "Tip: play fast, arpeggiated eighth or sixteenth bass lines; combine with a tight drum loop.",
  }).settings({ voices: 1, mode: "Mono", glide: 0 });
  const o1 = p.add("oscillator", [0, 0], { shape: 1, pw: 0.25 }, { name: "Pulse" });
  const o2 = p.add("oscillator", [0, 1], { shape: 0, octave: "-1" }, { name: "Triangle" });
  const amp = ampEnvelope(p, { node: o1, stereo: false }, [1, 1], { attack: 0.001, decay: 0.08, sustain: 0.7, release: 0.04, velamount: 0.1 });
  p.cable(p.vin, "pitch", o1, "pitch").cable(p.vin, "pitch", o2, "pitch").cable(o2, "triangle", amp.amp, "l", 0.7);
  return p;
}

// Karplus-style pluck.
function uprightPluck() {
  const p = voice("Upright Pluck Bass", {
    description: "A plucked-string model struck on every key and damped by a low-pass: a woody, acoustic double-bass pluck for jazz, folk and bossa lines.",
    tags: ["mono", "acoustic", "pluck", "jazz", "woody"],
    help: "A Macro Osc on the Pluck model is struck by Voice In's trigger and rings on its own. A Ladder low-pass at 600 Hz opens a bit with velocity so a hard " +
      "note has more finger and a soft one is round. The Tone and Decay are set for a short acoustic note.\n\n" +
      "Notes in, Out L/R. The shared input Brightness opens the low-pass: lower makes it more muffled.\n\n" +
      "Tip: play walking quarter notes at moderate velocity; leave rests between phrases.",
  }).settings({ voices: 1, mode: "Mono" }).input("damp", "Brightness");
  const str = p.add("macro-osc", [0, 0], { model: "Pluck", tone: 0.35, shape: 0.5, blend: 0.2, decay: 0.8, level: 0.8 });
  const flt = p.add("filter", [1, 0], { cutoff: 600, resonance: 0.1, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", str, "pitch").cable(p.vin, "trigger", str, "trig").cable(p.vin, "velocity", str, "accent")
    .cable(str, "out", flt, "l", 0.9).cable(str, "out", flt, "r", 0.9).cable(p.vin, "pitch", flt, "pitch")
    .cable(p.vin, "velocity", flt, "cutoff", 0.15).cable(p.cin, "damp", flt, "cutoff", 0.4);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.001, decay: 1.5, sustain: 0.4, release: 0.2 });
  return p;
}

// FM with exponential feedback-like mode for a metallic growl.
function grindEngine() {
  const p = voice("Grind Engine", {
    description: "Two oscillators in exponential FM with the modulator following the key: a clangorous, grinding industrial bass that gets meaner the harder you play. Shared input Grind.",
    tags: ["mono", "fm", "industrial", "metallic", "gritty"],
    help: "A Dual Osc in Exponential FM mode, the second oscillator modulating the first, with a little fold. A Grind Env raises the FM depth at the start " +
      "of a note, and velocity adds more. A Ladder Tanh filter tames the highest metal.\n\n" +
      "Notes in, Out L/R. The shared input Grind adds to the FM depth. Mono, no glide.\n\n" +
      "Tip: low, repeated notes with different velocities produce the most interesting growls.",
  }).settings({ voices: 1, mode: "Mono", glide: 0 }).input("grind", "Grind");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0, shapeB: 0, octaveA: -1, octaveB: 0, tuneB: 0.07, fmDepth: 0.15, fmMode: "Exponential", fold: 0.15, balance: 0, drift: 0.05 });
  const envg = envelope(p, [0, 1], { attack: 0.001, decay: 0.25, sustain: 0.3, release: 0.1, velamount: 0.8 }, "Grind Env");
  const flt = p.add("filter", [1, 0], { cutoff: 1200, resonance: 0.2, drive: 0.3, keytrack: 0.4, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envg, "env", osc, "fmDepth", 0.25).cable(p.cin, "grind", osc, "fmDepth", 0.3)
    .stereo(osc, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 0.4, sustain: 0.8, release: 0.1 });
  return p;
}

// Wavetable fold bank: sweeps through folded shapes.
function foldedTable() {
  const p = voice("Folded Table Bass", {
    description: "The Fold bank of a wavetable oscillator, swept by an envelope from smooth towards harsh on each note: a modern, evolving digital bass. Shared input Position.",
    tags: ["mono", "wavetable", "digital", "modern", "evolving"],
    help: "A Wavetable Osc on the Fold bank, an octave down with its sub added. A Table Env sweeps the X position of the table from mellow shapes to " +
      "folded ones at the start of each note, and then settles. A ladder with moderate drive adds weight.\n\n" +
      "Notes in, Out L/R. The shared input Position adds to the table's Y axis, so it changes which family of shapes the sweep plays through.\n\n" +
      "Tip: automate Position over a few bars for a bass that changes character without changing notes.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.05 }).input("pos", "Position");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "Fold", octave: -1, x: 0.1, y: 0.2, subLevel: 0.4, stereo: 0.05 });
  const envx = envelope(p, [0, 1], { attack: 0.002, decay: 0.45, sustain: 0.3, release: 0.15, velamount: 0.6 }, "Table Env");
  const flt = p.add("filter", [1, 0], { cutoff: 900, resonance: 0.12, drive: 0.3, keytrack: 0.5, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", wt, "pitch").cable(envx, "env", wt, "x", 0.5).cable(p.cin, "pos", wt, "y", 0.5)
    .stereo(wt, flt, { from: ["outL", "outR"] }).cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 0.5, sustain: 0.85, release: 0.12 });
  return p;
}

// Dual filter bandpass pair on a saw: a "yoy" vowel bass.
function mouthBass() {
  const p = voice("Mouth Bass", {
    description: "A saw through a dual filter whose band spread opens with each note, so the bass says a short, rubbery 'yow' on every hit. Shared input Mouth.",
    tags: ["mono", "vowel", "talking", "rubber", "dubstep"],
    help: "An Oscillator saw plus sub go into a Dual Filter in Serial routing, both sides set to band-pass with high resonance. A Mouth Env widens " +
      "the Spread and lifts the Cutoff at the start of each note, which moves the two peaks like a vowel. Legato notes keep the shape and slide.\n\n" +
      "Notes in, Out L/R. The shared input Mouth moves the filter's resting cutoff: lower is darker, higher opens up an 'ee'.\n\n" +
      "Tip: play slow, syncopated notes with some overlap, and push the Mouth dial while a note is held.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.05 }).input("mouth", "Mouth");
  const osc = p.add("oscillator", [0, 0], { shape: 0.67 });
  const envm = envelope(p, [0, 1], { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.15, velamount: 0.5 }, "Mouth Env");
  const flt = p.add("dual-filter", [1, 0], { cutoff: 300, spread: 1.2, res1: 0.6, res2: 0.55, mode1: 0.5, mode2: 0.5, drive: 0.3, keyTrack: 0.6, routing: "Serial" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(p.vin, "pitch", flt, "pitch")
    .cable(osc, "out", flt, "l", 0.6).cable(osc, "sub", flt, "l", 0.4).cable(osc, "out", flt, "r", 0.6).cable(osc, "sub", flt, "r", 0.4)
    .cable(envm, "env", flt, "cutoff", 0.3).cable(envm, "env", flt, "spread", 0.3).cable(p.cin, "mouth", flt, "cutoff", 0.4);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.004, decay: 0.4, sustain: 0.85, release: 0.12 });
  return p;
}

// Swarm in octaves, played low.
function octaveStack() {
  const p = voice("Octave Stack Bass", {
    description: "A swarm of oscillators spread over three octaves, with the lowest ones leading: a huge, mono-compatible bass for dance floors. Shared input Cutoff.",
    tags: ["mono", "swarm", "octaves", "huge", "edm"],
    help: "A Swarm in Octaves mode with six oscillators, a little detune and moderate width, played from a low Octave. A Ladder Tanh filter with keytracking " +
      "and a snappy envelope closes the top end. The stereo width is kept moderate so the low end stays solid.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter.\n\n" +
      "Tip: play long root notes under chord changes; cut high-pass on the rest of the mix to leave room.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.05 }).input("cut", "Cutoff");
  const sw = p.add("swarm", [0, 0], { chord: "Octaves", count: 6, octave: -1, spread: 0.3, detune: 9, drift: 0.2, width: 0.4, glide: 0 });
  const envf = envelope(p, [0, 1], { attack: 0.004, decay: 0.3, sustain: 0.5, release: 0.15, velamount: 0.5 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 320, resonance: 0.2, drive: 0.25, keytrack: 0.6, type: "Ladder Tanh" });
  p.cable(p.vin, "pitch", sw, "pitch").stereo(sw, flt).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.35).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.4, sustain: 0.85, release: 0.12 });
  return p;
}

export default category("Basses", "Mono and legato Voice Cells for low lines: patch Notes in and take Out L/R.", [
  heavyLadder, slapSnap, ripplePulse, diveBomb, pixelBass, uprightPluck, grindEngine, foldedTable, mouthBass, octaveStack,
]);
