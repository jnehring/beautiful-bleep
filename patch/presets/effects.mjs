// SPDX-License-Identifier: MIT
// Effects: stereo insert effects. In L/R → processing → Out L/R.
import { cell, category } from "./kit.mjs";

// A steady +1 from a Utility's Offset: holds a gate input high.
function constant(p, at, name = "Always On") {
  return p.add("utility", at, { scalex: 0, offset: 1 }, { name });
}

// High-passed input into a large, slowly modulated FDN hall with pre-delay.
function cathedralHall() {
  const p = cell("Cathedral Hall", {
    description: "A gentle high-pass keeps the lows out of a big, dark hall with 40 ms pre-delay and a six-second tail. Shared inputs Mix and Freeze.",
    tags: ["reverb", "hall", "ambient", "space"],
    help: "A 1-pole high-pass at 160 Hz feeds a Reverb with a large size, a six-second decay, 40 ms pre-delay " +
      "and slow modulation. The high-pass keeps low end out of the tail so the hall stays clear. The reverb " +
      "is 30 percent wet.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Mix input is added to the reverb's Mix knob. " +
      "A gate into Freeze holds the current tail as an endless wash.\n\n" +
      "Tip: freeze a chord for a moment, then release it to let the hall decay.",
  }).stereoIn().stereoOut().input("mix", "Mix").input("freeze", "Freeze", "gate");
  const hp = p.add("filter", [0, 0], { cutoff: 160, type: "1-Pole High-pass", mix: 0.6 }, { name: "Low Cut" });
  const verb = p.add("reverb", [1, 0], { size: 0.85, decay: 6, preDelay: 0.04, diffusion: 0.8, damping: 0.55,
                                         modRate: 0.4, modDepth: 0.35, width: 1.2, mix: 0.3 });
  p.stereo(p.cin, hp).stereo(hp, verb).stereo(verb, p.cout)
    .cable(p.cin, "mix", verb, "mix", 0.5).cable(p.cin, "freeze", verb, "freeze");
  return p;
}

// Dotted-eighth ping-pong through a dark tape loop, then a touch of room.
function dubPingPong() {
  const p = cell("Dub Ping-Pong", {
    description: "Tempo-synced dotted-eighth echoes that bounce left and right, darker with every pass, into a short room. Shared inputs Feedback and Tone.",
    tags: ["delay", "ping-pong", "dub", "tempo"],
    help: "A Zone Delay in transport sync with a dotted eighth time, set to ping-pong so repeats alternate left " +
      "and right, each pass darker, into a short Room reverb. Always-on constant keeps the ping-pong " +
      "switched on.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Feedback input is added to the delay's " +
      "Feedback knob and Tone to its Tone. The delay time follows the transport tempo.\n\n" +
      "Tip: send a sparse, dry part through it and ride Feedback up for dub throws.",
  }).stereoIn().stereoOut().input("fb", "Feedback").input("tone", "Tone");
  const on = constant(p, [0, 1], "Ping-Pong On");
  const dly = p.add("zone-delay", [1, 0], { zone: 3, sync: "Transport", time: 8 / 12, feedback: 0.6,
                                             character: 0.4, tone: -0.1, wobble: 0.15, mix: 0.3 });
  const verb = p.add("reverb", [2, 0], { size: 0.35, decay: 1.2, damping: 0.5, mix: 0.15 }, { name: "Room" });
  p.stereo(p.cin, dly).cable(on, "out", dly, "pingpong").stereo(dly, verb).stereo(verb, p.cout)
    .cable(p.cin, "fb", dly, "feedback", 0.4).cable(p.cin, "tone", dly, "tone", 0.5);
  return p;
}

// Grains an octave up with fifth jitter, fed back and blurred, into a long verb.
function shimmerCloud() {
  const p = cell("Shimmer Cloud", {
    description: "Grains pitched up an octave with octave-and-fifth jitter feed back into a long reverb: a shimmering halo above anything. Shared inputs Mix and Freeze.",
    tags: ["shimmer", "granular", "ambient", "reverb"],
    help: "Grains pitches the sound up an octave with octave-and-fifth jitter and feeds itself back with blur, " +
      "into a long Reverb (9 s decay). The result is a bright halo of high voices above the original.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Mix is added to both the Grains and the Reverb " +
      "mix, so one input fades the whole effect. A gate into Freeze freezes both Grains and the reverb " +
      "tail. Plays a long tail, so allow time after the sound stops.\n\n" +
      "Tip: use it on sustained pads or single notes; busy material turns into mush.",
  }).stereoIn().stereoOut().input("mix", "Mix").input("freeze", "Freeze", "gate")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 14 } });  // Verb decay 9 s, fed back by Grains
  const gr = p.add("grains", [0, 0], { size: 0.35, density: 0.6, texture: 0.5, spread: 0.4, pitch: 12,
                                       pitchjitter: 7, pitchquant: "Octaves + fifths", feedback: 0.3, blur: 0.5, mix: 0.35 });
  const verb = p.add("reverb", [1, 0], { size: 0.9, decay: 9, preDelay: 0.02, damping: 0.3, modDepth: 0.4, tone: 0.2, mix: 0.35 });
  p.stereo(p.cin, gr).stereo(gr, verb).stereo(verb, p.cout)
    .cable(p.cin, "mix", gr, "mix", 0.5).cable(p.cin, "mix", verb, "mix", 0.4)
    .cable(p.cin, "freeze", gr, "freeze").cable(p.cin, "freeze", verb, "freeze");
  return p;
}

// Short tape delay with wow and a slow LFO on its time: chorus and wobble.
function wornTapeChorus() {
  const p = cell("Worn Tape Chorus", {
    description: "A short tape-style delay whose head drifts with wow, flutter and a slow LFO: warm chorus and seasick tape wobble. Shared input Depth.",
    tags: ["chorus", "tape", "wobble", "lo-fi", "modulation"],
    help: "A Zone Delay in its tape zone with a short time, light feedback and wobble. A slow LFO named Wow " +
      "also moves the delay time, so the pitch drifts like a worn tape head. Half wet, it reads as chorus.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Depth input is added to the delay's Wobble " +
      "knob: more means a seasick sway. It does not follow the transport.\n\n" +
      "Tip: it suits electric piano, guitar and pads; raise Depth for lo-fi warble.",
  }).stereoIn().stereoOut().input("depth", "Depth");
  const lfo = p.add("lfo", [0, 1], { rate: 0.45 }, { name: "Wow" });
  const dly = p.add("zone-delay", [1, 0], { zone: 2, time: 0.35, feedback: 0.12, character: 0.25, offset: 0.2,
                                             wobble: 0.6, mix: 0.5, timechange: "Tape" });
  p.stereo(p.cin, dly).stereo(dly, p.cout).cable(lfo, "sine", dly, "time", 0.04)
    .cable(p.cin, "depth", dly, "wobble", 0.4);
  return p;
}

// A resonant ladder swept by a half-note triangle: tempo auto-filter.
function halfNoteWah() {
  const p = cell("Half-Note Wah", {
    description: "A resonant tanh ladder swept up and down by a triangle locked to half notes: a tempo auto-filter for pads, chords and loops. Shared inputs Cutoff and Depth.",
    tags: ["filter", "auto-filter", "tempo", "wah"],
    help: "A Ladder Tanh filter with resonance and a touch of drive, with a triangle LFO locked to half notes " +
      "sweeping its cutoff. A Multiplier named Depth scales the sweep before it reaches the cutoff.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Cutoff is added to the filter cutoff, moving the " +
      "centre of the sweep. Depth is added to the Multiplier's Y input, scaling how far the LFO sweeps. The " +
      "LFO follows the transport tempo.\n\n" +
      "Tip: put it on chords or a full drum loop and set Cutoff so the sweep opens on the downbeat.",
  }).stereoIn().stereoOut().input("cut", "Cutoff").input("depth", "Depth");
  const lfo = p.add("lfo", [0, 1], { wave: "Triangle", sync: "1/2" }, { name: "Sweep" });
  const amt = p.add("multiplier", [1, 1], { biasy1: 0.6 }, { name: "Depth" });
  const flt = p.add("filter", [1, 0], { cutoff: 900, resonance: 0.45, drive: 0.15, type: "Ladder Tanh" });
  p.cable(lfo, "out", amt, "x1").cable(p.cin, "depth", amt, "y1", 0.4)
    .stereo(p.cin, flt).cable(amt, "out1", flt, "cutoff", 0.4).cable(p.cin, "cut", flt, "cutoff", 0.5)
    .stereo(flt, p.cout);
  return p;
}

// Frequency shifter with one-sample feedback: the endless rising phaser.
function barberPole() {
  const p = cell("Barber Pole", {
    description: "A frequency shifter with tight feedback: phaser notches that rise forever, turning in opposite directions in the two ears. Shared input Speed.",
    tags: ["phaser", "barber-pole", "frequency shifter", "stereo"],
    help: "A Frequency Shifter with strong feedback and a tiny fine shift. Each pass moves the spectrum a " +
      "little more, so the phaser notches seem to rise forever. Spread is at maximum, so left and right " +
      "shift in opposite directions.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Speed input is added to the shifter's Fine " +
      "knob, so more Speed moves the notches faster. It does not follow the transport.\n\n" +
      "Tip: best on sustained sounds with plenty of harmonics, like strings, pads or noise.",
  }).stereoIn().stereoOut().input("speed", "Speed");
  const fs = p.add("freq-shifter", [0, 0], { shift: 0, fine: 0.3, feedback: 0.7, fbDelay: 0, spread: 1, mix: 0.5, range: "±10 Hz" });
  p.stereo(p.cin, fs).stereo(fs, p.cout).cable(p.cin, "speed", fs, "fine", 0.1);
  return p;
}

// Bender shuffling sixteenth slices now and then, with octave jumps.
function stutterEngine() {
  const p = cell("Stutter Engine", {
    description: "Bender catches sixteenth-note slices by chance and repeats, reverses and re-pitches them in octaves: seeded glitches that come back every loop. Shared inputs Chance and Glitch.",
    tags: ["glitch", "stutter", "repeat", "tempo"],
    help: "A Bender on 16th-note slices (Shuffle mode). At each slice there is a chance it is caught, repeated " +
      "up to four times, reversed or bent in octaves. The seed makes the glitches repeat each loop. Slice " +
      "timing follows the transport.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Chance input is added to the Chance knob. A " +
      "trigger into Glitch forces an immediate glitch, for instance from a button or a clock.\n\n" +
      "Tip: use it on drums or a rhythmic loop and raise Chance only for fills.",
  }).stereoIn().stereoOut().input("chance", "Chance").input("glitch", "Glitch", "trigger");
  const bd = p.add("bender", [0, 0], { sync: "1/16", chance: 0.2, repeats: 4, bend: 1, bendvar: 0.4,
                                       slice: 0.3, mode: "Shuffle", bendsteps: "Octaves", edge: 0.8 });
  p.stereo(p.cin, bd).stereo(bd, p.cout).cable(p.cin, "chance", bd, "chance", 0.5).cable(p.cin, "glitch", bd, "glitch");
  return p;
}

// Soft folding, always-on bit corruption and a dull 1-pole: crunchy lo-fi.
function bitRot() {
  const p = cell("Bit Rot", {
    description: "A touch of wavefolding, constant sample-rate and bit crushing and a dull low-pass: a worn, crunchy sampler sound. Shared input Grit.",
    tags: ["lo-fi", "crush", "distortion", "saturation"],
    help: "Three stages in a row: a Wavefolder with a small fold, a Bender in Crush mode with corruption always " +
      "on (bit and sample-rate crushing), and a dull 1-pole low-pass at 4.5 kHz.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Grit input is added to the Wavefolder's Fold " +
      "and to the Crusher's Corrupt knob together, so one control makes everything dirtier. It does not " +
      "follow the transport.\n\n" +
      "Tip: run a clean drum loop through it and push Grit for a worn sampler sound.",
  }).stereoIn().stereoOut().input("grit", "Grit");
  const fold = p.add("wavefolder", [0, 0], { fold: 0.18, symmetry: 0.1, mix: 0.6, source: "Input" });
  const crush = p.add("bender", [1, 0], { chance: 0, corrupt: 0.35, corruptwhen: "Always", mode: "Crush" }, { name: "Crusher" });
  const lp = p.add("filter", [2, 0], { cutoff: 4500, drive: 0.35, type: "Naive 1-Pole Low-pass" }, { name: "Dull" });
  p.stereo(p.cin, fold).stereo(fold, crush).stereo(crush, lp).stereo(lp, p.cout)
    .cable(p.cin, "grit", fold, "fold", 0.4).cable(p.cin, "grit", crush, "corrupt", 0.5);
  return p;
}

// Ten band-passes tuned to a minor pentatonic, a window drifting across them.
function pentatonicPrism() {
  const p = cell("Pentatonic Prism", {
    description: "Ten narrow band-passes tuned to C minor pentatonic, a slow window scanning across them: drums and noise turn into ringing, tuned chords. Shared input Scan.",
    tags: ["filter bank", "resonant", "tuned", "spectral"],
    help: "A Filter Bank with ten narrow band-passes tuned to C minor pentatonic. A slow LFO named Drift moves " +
      "its Scan window across them, and odd and even bands go to different sides. Whatever you feed it " +
      "comes out as ringing tuned chords.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Scan input is added to the Scan knob, moving " +
      "the window yourself. The effect is 60 percent wet.\n\n" +
      "Tip: it works best on drums, noise and other sounds with lots of broadband energy.",
  }).stereoIn().stereoOut().input("scan", "Scan");
  const lfo = p.add("lfo", [0, 1], { rate: 0.07 }, { name: "Drift" });
  const fb = p.add("filter-bank", [1, 0], { tuning: "Scale", root: "C", scale: "Minor Pentatonic", q: 14,
                                            width: 4, scan: 0.5, mix: 0.6, stereo: "Odd/Even split" });
  p.stereo(p.cin, fb).stereo(fb, p.cout).cable(lfo, "sine", fb, "scan", 0.3).cable(p.cin, "scan", fb, "scan", 0.5);
  return p;
}

// A sixteenth square chopping a VCA, softened edges: the trance gate.
function sixteenthChopper() {
  const p = cell("Sixteenth Chopper", {
    description: "A VCA chopped on sixteenths by a synced square with softened edges: rhythmic trance gate for pads and drones. Shared input Depth.",
    tags: ["gate", "tremolo", "rhythmic", "tempo"],
    help: "A synced LFO square on 16ths, softened by a short slew, controls a VCA's gain. A Multiplier named " +
      "Depth sets how much the square closes the gate, so the sound is chopped rhythmically into a trance " +
      "gate.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Depth input is added to the Multiplier's Y " +
      "input: higher means deeper chopping. The LFO follows the transport tempo.\n\n" +
      "Tip: use it on a pad or drone and automate Depth for builds.",
  }).stereoIn().stereoOut().input("depth", "Depth");
  const lfo = p.add("lfo", [0, 1], { wave: "Square", sync: "1/16", polarity: "Unipolar", pw: 0.55 }, { name: "Chop" });
  const soft = p.add("utility", [1, 1], { slew: 0.004 }, { name: "Soften" });
  const amt = p.add("multiplier", [2, 1], { biasy1: 0.75 }, { name: "Depth" });
  const vca = p.add("vca", [1, 0], { gain: 0.25, response: "Linear" });
  p.cable(lfo, "out", soft, "x").cable(soft, "out", amt, "x1").cable(p.cin, "depth", amt, "y1", 0.25)
    .stereo(p.cin, vca).cable(amt, "out1", vca, "gain").stereo(vca, p.cout);
  return p;
}

export default category("Effects", "Stereo insert effects: patch In L/R from any sound and take Out L/R onwards.", [
  cathedralHall, dubPingPong, shimmerCloud, wornTapeChorus, halfNoteWah, barberPole, stutterEngine, bitRot,
  pentatonicPrism, sixteenthChopper,
]);
