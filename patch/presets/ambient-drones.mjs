// SPDX-License-Identifier: MIT
// Ambient Drones: long, sustained beds that never settle. Each one sounds on its own as soon as it is placed (no notes,
// no transport) and moves by itself: slow organic LFOs, drifting oscillators, long reverbs. Out L/R out.
import { cell, category } from "./kit.mjs";
import { bed, sendReturn, hall, constant } from "./ambient-kit.mjs";

// Four detuned saw-triangle oscillators on A and E under a ladder filter that opens and closes like a tide.
function slowTide() {
  const p = cell("Slow Tide", {
    description: "Four slightly detuned oscillators on A and E under a low-pass that opens and closes over a minute, like a tide coming in and going out. Shared input Tide (speeds up the motion).",
    tags: ["ambient", "drone", "evolving", "warm", "slow"],
    help: "Four Oscillators (a root, a slightly wider copy of it, a fifth and an octave) go into a Ladder Tanh filter. " +
      "Organic LFOs at about one cycle every forty seconds move the cutoff and the detune of the wide copy, so the chord " +
      "slowly brightens, darkens and beats against itself. A large hall sits behind it.\n\n" +
      "It sounds on its own from Out L/R when placed; it is not tied to the tempo. The Tide input is added to the rate of the " +
      "Organic LFOs: raise it and the tide turns faster.\n\n" +
      "Tip: lower the filter's Resonance to zero for a plainer, softer bed; raise it for a vowel-like hum.",
  }).input("tide", "Tide").stereoOut();
  const lfo = p.add("organic-lfos", [0, 3], { rate: 0.025, spread: 0.6, drift: 0.5, seed: 5 });
  const flt = p.add("filter", [2, 1], { cutoff: 420, resonance: 0.22, drive: 0.08, type: "Ladder Tanh" }, { name: "Tide Filter" });
  [["Root", "-2", 9, -5, 0.2, 0.5, 0.25], ["Root Wide", "-2", 9, 6, 0.2, 0.25, 0.5], ["Fifth", "-1", 4, 0, 0.3, 0.35, 0.35], ["Octave", "-1", 9, 3, 0.45, 0.25, 0.25]]
    .forEach(([name, octave, coarse, fine, shape, l, r], i) => {
      const o = p.add("oscillator", [1, i], { octave, coarse, fine, shape }, { name });
      p.cable(o, "out", flt, "l", l).cable(o, "out", flt, "r", r);
      if (i === 1) p.cable(lfo, "out2", o, "fine", 0.04);
    });
  p.cable(lfo, "out1", flt, "cutoff", 0.2).cable(p.cin, "tide", lfo, "rate", 0.3);
  const mix = bed(p, [3, 1], [{ node: flt, level: -6 }], { master: -2 });
  hall(p, mix, [4, 1], { size: 0.8, decay: 10, mix: 0.4 });
  return p;
}

// Additive partials with a drifting odd/even balance and stretch, a shimmer an octave up in a hall.
function glassCathedral() {
  const p = cell("Glass Cathedral", {
    description: "Two additive drones on A and E whose odd and even partials swap places and drift slightly out of tune with each other, lit by an octave-up shimmer in a vast hall. Shared input Shimmer.",
    tags: ["ambient", "drone", "additive", "shimmer", "glass"],
    help: "Two Additive Osc modules play sixty-four-partial saws, A and E. Organic LFOs move Odd/Even from hollow clarinet-like " +
      "to bright and back, and nudge Stretch so the partials slide a little apart and together again, like glass " +
      "picking up overtones. The mixer sends a part of the sound through a Pitch Shifter an octave up into the hall, " +
      "where it blooms as a shimmer.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Shimmer input is added to the " +
      "level of the shimmer feedback: at zero it is a thin veil, higher it climbs in octaves.\n\n" +
      "Tip: set Stretch higher on the modules for a bell-like version.",
  }).input("shimmer", "Shimmer").stereoOut();
  const lfo = p.add("organic-lfos", [0, 2], { rate: 0.03, spread: 0.7, drift: 0.4, seed: 11 });
  const a = p.add("additive-osc", [1, 0], { octave: -2, coarse: 9, partials: 40, tilt: -8, chorus: 14, width: 0.8, damp: 0.3 }, { name: "Glass A" });
  const b = p.add("additive-osc", [1, 1], { octave: -1, coarse: 4, partials: 28, tilt: -11, chorus: 22, width: 0.8, fine: 5, damp: 0.3 }, { name: "Glass E" });
  p.cable(lfo, "out1", a, "oddEven", 0.35).cable(lfo, "out2", b, "oddEven", -0.3)
    .cable(lfo, "out3", a, "stretch", 0.05).cable(lfo, "out4", b, "stretch", 0.04);
  const mix = bed(p, [2, 0], [{ node: a, jacks: ["outL", "outR"], level: -9, send: -12 }, { node: b, jacks: ["outL", "outR"], level: -12, send: -8 }], { return: -5, master: -2 });
  const shift = p.add("pitch-shifter", [3, 2], { pitch: 12, window: 120, drift: 0.2, feedback: 0.25, mix: 1 });
  p.cable(p.cin, "shimmer", shift, "feedback", 0.3);
  sendReturn(p, mix, shift);
  hall(p, mix, [4, 0], { size: 0.95, decay: 14, damping: 0.45, mix: 0.5 });
  return p;
}

// Two pulse-formant voices a fifth apart and a breath of band-passed noise: a held, wordless vowel.
function monksBreath() {
  const p = cell("Monk's Breath", {
    description: "Two formant voices a fifth apart hold a vowel while a ghost of band-passed breath moves around them: a long wordless chant that slowly turns from one vowel to another. Shared input Vowel.",
    tags: ["ambient", "drone", "formant", "vowel", "breath"],
    help: "Two Formant Osc voices (D and A, low) make a resonant, voice-like pulse whose peak is moved by Organic LFOs, so the vowel " +
      "wanders. A Noise module through a band-pass Multi Filter that also wanders gives a faint breath. Chorus and a warm hall " +
      "finish it.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Vowel input is added to the formant of both voices: raise it " +
      "to make the vowel brighter.\n\n" +
      "Tip: turn Narrow up on the voices for a more nasal, reedy chant.",
  }).input("vowel", "Vowel").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.04, spread: 0.6, drift: 0.5, seed: 21 });
  const v1 = p.add("formant-osc", [1, 0], { octave: -2, coarse: 2, formant: 1.2, narrow: 0.4, body: 0.7, spread: 0.3 }, { name: "Voice D" });
  const v2 = p.add("formant-osc", [1, 1], { octave: -2, coarse: 9, formant: 2.4, narrow: 0.35, body: 0.7, spread: -0.3 }, { name: "Voice A" });
  p.cable(lfo, "out1", v1, "formant", 0.2).cable(lfo, "out2", v2, "formant", 0.2)
    .cable(p.cin, "vowel", v1, "formant", 0.25).cable(p.cin, "vowel", v2, "formant", 0.25)
    .cable(lfo, "out5", v1, "pitch", 0.003).cable(lfo, "out6", v2, "pitch", 0.003);
  const air = p.add("noise", [1, 2], { colour: -0.2, level: 0.5 }, { name: "Breath" });
  const bp = p.add("filter", [2, 2], { cutoff: 900, resonance: 0.55, mode: "BP", type: "SVF Multimode" }, { name: "Breath Filter" });
  p.cable(air, "out", bp, "l").cable(air, "out", bp, "r").cable(lfo, "out3", bp, "cutoff", 0.15);
  const mix = bed(p, [3, 1], [
    { node: v1, jacks: ["outL", "outR"], level: -8, pan: -0.2 },
    { node: v2, jacks: ["outL", "outR"], level: -9, pan: 0.2 },
    { node: bp, level: -22 },
  ], { master: -2 });
  const ch = p.add("chorus", [4, 1], { rate: 0.25, depth: 0.35, delay: 14, mix: 0.35 });
  p.stereo(mix, ch, { from: ["outl", "outr"] });
  hall(p, ch, [5, 1], { size: 0.8, decay: 8, mix: 0.4 }, ["l", "r"]);
  return p;
}

// A 55 Hz lamp-stabilised sine, a triangle sub and brown noise under a tape saturator.
function deepHum() {
  const p = cell("Deep Hum", {
    description: "A warm 55 Hz sine from a lamp-stabilised test oscillator with a faint mains buzz, a triangle sub and brown noise, pushed gently into tape: the sound of a large building at night. Shared input Warmth.",
    tags: ["ambient", "drone", "sub", "hum", "dark"],
    help: "A Test Oscillator on its slow range hums near 55 Hz and drifts a little, as a real lamp-stabilised oscillator does; its Mains " +
      "setting adds a faint buzz. An Oscillator two octaves below A adds weight and Noise in brown adds air. A Multi Filter keeps the " +
      "top end down and a Saturator in Tape mode glues it together. A slow Organic LFO breathes the filter and the drive.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Warmth input is added to the saturator drive. " +
      "This one is mostly low: check it on speakers that reproduce bass.\n\n" +
      "Tip: set Mains to Off on the Test Oscillator for a cleaner, purer tone.",
  }).input("warmth", "Warmth").stereoOut();
  const lfo = p.add("organic-lfos", [0, 2], { rate: 0.02, spread: 0.5, drift: 0.5, seed: 31 });
  const hum = p.add("test-oscillator", [1, 0], { freq: 5.5, range: "×10", loopgain: 1.2, drift: 0.5, mains: "50 Hz", level: 0.8 });
  const sub = p.add("oscillator", [1, 1], { octave: "-3", coarse: 9, shape: 0.1 }, { name: "Sub" });
  const dark = p.add("noise", [1, 2], { colour: -0.9, level: 0.6 }, { name: "Air" });
  const flt = p.add("filter", [2, 1], { cutoff: 180, resonance: 0.12, type: "Ladder Tanh" }, { name: "Low Pass" });
  p.cable(hum, "sine", flt, "l", 0.6).cable(hum, "sine", flt, "r", 0.6).cable(sub, "out", flt, "l", 0.5).cable(sub, "out", flt, "r", 0.5)
    .cable(dark, "out", flt, "l", 0.15).cable(dark, "out", flt, "r", 0.12).cable(lfo, "out1", flt, "cutoff", 0.15);
  const sat = p.add("saturator", [3, 1], { drive: 0.4, character: "Tape", sag: 0.5, age: 0.4, level: 0.9 });
  p.cable(p.cin, "warmth", sat, "drive", 0.3).cable(lfo, "out2", sat, "drive", 0.1).stereo(flt, sat);
  const mix = bed(p, [4, 1], [{ node: sat, level: -4 }], { master: -2 });
  hall(p, mix, [5, 1], { size: 0.6, decay: 5, mix: 0.25 });
  return p;
}

// A Swarm of twelve oscillators on a minor ninth that bloom and unbloom with a slow LFO.
function swarmBloom() {
  const p = cell("Swarm Bloom", {
    description: "A cloud of twelve oscillators that gathers into a D minor ninth, then loosens back towards unison, never the same twice: a drone that breathes in chords. Shared input Bloom.",
    tags: ["ambient", "drone", "swarm", "chord", "evolving"],
    help: "A Swarm module plays twelve oscillators over a minor ninth chord. Spread is moved by an Organic LFO: at the low end they sit " +
      "close to one note, at the high end they open into the whole chord and spread over the stereo field. Drift and Detune keep " +
      "each one moving. A low-pass Multi Filter that opens a little with the bloom and a hall finish the sound.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Bloom input is added to Spread: it opens the chord.\n\n" +
      "Tip: Chord is a choice on the Swarm: try Fifths for a bare, open cloud, or Quartal for a suspended one.",
  }).input("bloom", "Bloom").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.022, spread: 0.6, drift: 0.5, seed: 17 });
  const sw = p.add("swarm", [1, 1], { octave: -1, coarse: 2, count: 12, chord: "Minor 9", spread: 0.45, detune: 14, drift: 0.5, width: 0.9, glide: 0.8 });
  const flt = p.add("filter", [2, 1], { cutoff: 1800, resonance: 0.1, type: "SVF Multimode" }, { name: "Soft Top" });
  p.cable(lfo, "out1", sw, "spread", 0.4).cable(p.cin, "bloom", sw, "spread", 0.4)
    .cable(lfo, "out1", flt, "cutoff", 0.15).stereo(sw, flt);
  const mix = bed(p, [3, 1], [{ node: flt, level: -12 }], { master: -3 });
  hall(p, mix, [4, 1], { size: 0.9, decay: 11, mix: 0.45 });
  return p;
}

// A chord oscillator through tape saturation and a wobbling long tape echo.
function tapeNebula() {
  const p = cell("Tape Nebula", {
    description: "A minor add-nine chord from one Chord Osc smears into a long, wobbling tape echo that feeds on itself, so the chord blurs into a slowly turning cloud. Shared input Smear (echo feedback).",
    tags: ["ambient", "drone", "tape", "echo", "chord", "lo-fi"],
    help: "A Chord Osc plays a C minor add-nine on five oscillators with some detune and stereo spread. A dark Multi Filter " +
      "and a Saturator in Tape mode soften it, then a Zone Delay on its long zone with a lot of feedback and wobble repeats it " +
      "into itself. A slow Organic LFO moves the filter.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Smear input is added to the echo feedback: " +
      "higher builds a thicker cloud that can swell by itself, lower lets the chord stand.\n\n" +
      "Tip: Time on the Zone Delay changes the speed of the smear; because it is a tape delay, moving it bends the pitch.",
  }).input("smear", "Smear").stereoOut();
  const lfo = p.add("organic-lfos", [0, 2], { rate: 0.03, spread: 0.5, drift: 0.4, seed: 7 });
  const ch = p.add("chord-osc", [1, 1], { chord: "Minor add9", octave: "-1", voices: 5, detune: 10, stereo: 0.8, shape: 0.4 }, { name: "Chord" });
  const flt = p.add("filter", [2, 1], { cutoff: 900, resonance: 0.15, type: "Ladder Tanh" }, { name: "Dark Filter" });
  const sat = p.add("saturator", [3, 1], { drive: 0.45, character: "Tape", sag: 0.4, age: 0.5, level: 0.9 });
  p.cable(lfo, "out1", flt, "cutoff", 0.2).stereo(ch, flt).stereo(flt, sat);
  const echo = p.add("zone-delay", [4, 1], { zone: 4, time: 0.55, feedback: 0.75, character: 0.45, tone: -0.35, diffuse: 0.4, wobble: 0.5, mix: 0.6 });
  p.cable(p.cin, "smear", echo, "feedback", 0.2).stereo(sat, echo);
  const mix = bed(p, [5, 1], [{ node: echo, level: -6 }], { master: -3 });
  hall(p, mix, [6, 1], { size: 0.85, decay: 9, mix: 0.35 });
  return p;
}

// Dual Osc with slow FM and drift, brown noise and a heartbeat-slow amplitude swell: far-off engines.
function distantEngines() {
  const p = cell("Distant Engines", {
    description: "Two low oscillators rubbing against each other in slow FM, with a rumble of noise and a swell that rises and falls over half a minute: engines in the next valley. Shared input Rumble.",
    tags: ["ambient", "drone", "industrial", "dark", "fm"],
    help: "A Dual Osc with both cores three octaves down, B tuned a fifth below A and a little FM from B into A, drifting at 60 %, " +
      "so the two never agree. Brown Noise adds a rumble. A Tidal module in Loop mode moves the sound's level through a long swell, " +
      "and the ladder filter after it opens and closes with an Organic LFO. A little hall at the end.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Rumble input is added to the FM depth: raise it for rougher engines.\n\n" +
      "Tip: Fold on the Dual Osc turns the engines into something much more metallic.",
  }).input("rumble", "Rumble").stereoOut();
  const lfo = p.add("organic-lfos", [0, 2], { rate: 0.025, spread: 0.5, drift: 0.5, seed: 2 });
  const swell = p.add("tidal", [0, 0], { freq: 0.05, skew: 0.5, mode: "Loop", range: "Slow", polarity: "Unipolar" }, { name: "Swell" });
  const lvl = p.add("utility", [1, 0], { scalex: 0.5, offset: 0.55 }, { name: "Swell Depth" });
  const osc = p.add("dual-osc", [1, 1], { octaveA: -3, octaveB: -3, tuneB: -7, shapeA: 0.3, shapeB: 0.15, fmDepth: 0.2, drift: 0.6, fold: 0.1, balance: 0.5, width: 0.7 });
  const rumble = p.add("noise", [1, 3], { colour: -1, level: 0.7 }, { name: "Rumble" });
  const flt = p.add("filter", [2, 1], { cutoff: 260, resonance: 0.2, drive: 0.15, type: "Ladder Tanh" }, { name: "Valley Filter" });
  const amp = p.add("vca", [3, 1], { response: "Linear" }, { name: "Swell VCA" });
  p.cable(swell, "a", lvl, "x").cable(lvl, "out", amp, "gain").cable(p.cin, "rumble", osc, "fmDepth", 0.25)
    .stereo(osc, flt, { from: ["outL", "outR"] }).cable(rumble, "out", flt, "l", 0.2).cable(rumble, "out", flt, "r", 0.2)
    .cable(lfo, "out1", flt, "cutoff", 0.15).stereo(flt, amp);
  const mix = bed(p, [4, 1], [{ node: amp, level: 2 }], { master: -2 });
  hall(p, mix, [5, 1], { size: 0.55, decay: 4, mix: 0.2 });
  return p;
}

// A wavetable oscillator scanned by slow LFOs through its vowel bank, chorused and shimmering.
function auroraVeil() {
  const p = cell("Aurora Veil", {
    description: "Two wavetable oscillators on A and E gliding through the Vowel table in slow, unrelated paths, wrapped in chorus and an octave-up shimmer: coloured curtains of sound that fold over each other. Shared input Colour.",
    tags: ["ambient", "drone", "wavetable", "vowel", "shimmer"],
    help: "Two Wavetable Osc modules read the Vowel bank. Organic LFOs move X and Y of each, so the table is scanned along paths " +
      "that never repeat. A Chorus widens them and a Pitch Shifter an octave up sits in the hall's feedback path as a shimmer.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Colour input is added to Y of both oscillators: " +
      "it moves the whole sound to a different row of the table.\n\n" +
      "Tip: change Bank to Spectra or Bell for a different family of veils.",
  }).input("colour", "Colour").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.03, spread: 0.7, drift: 0.5, seed: 23 });
  const a = p.add("wavetable-osc", [1, 0], { bank: "Vowel", octave: -1, coarse: 9, x: 0.4, y: 0.3, stereo: 0.3, subLevel: 0.2 }, { name: "Veil A" });
  const b = p.add("wavetable-osc", [1, 1], { bank: "Vowel", octave: 0, coarse: 4, x: 0.6, y: 0.5, stereo: -0.3 }, { name: "Veil E" });
  p.cable(lfo, "out1", a, "x", 0.4).cable(lfo, "out2", a, "y", 0.4).cable(lfo, "out3", b, "x", 0.4).cable(lfo, "out4", b, "y", 0.4)
    .cable(p.cin, "colour", a, "y", 0.4).cable(p.cin, "colour", b, "y", 0.4);
  const mix = bed(p, [2, 0], [{ node: a, jacks: ["outL", "outR"], level: -10, send: -14 }, { node: b, jacks: ["outL", "outR"], level: -12, send: -12 }], { return: -6, master: -2 });
  const shift = p.add("pitch-shifter", [3, 2], { pitch: 12, window: 110, drift: 0.2, mix: 1 });
  sendReturn(p, mix, shift);
  const ch = p.add("chorus", [3, 0], { rate: 0.2, depth: 0.45, delay: 15, mix: 0.4 });
  p.stereo(mix, ch, { from: ["outl", "outr"] });
  hall(p, ch, [4, 0], { size: 0.9, decay: 12, mix: 0.45 }, ["l", "r"]);
  return p;
}

// Three Modal Voices bowed all the time, like singing bowls that never fade.
function singingBowlsDrone() {
  const p = cell("Singing Bowls Drone", {
    description: "Three bowed bell bodies tuned to D, A and E that never stop singing, their bows swelling and relaxing on three slow cycles so the beating between them is always changing. Shared input Bow (pressure).",
    tags: ["ambient", "drone", "bowed", "bowls", "physical model"],
    help: "Three Modal Voices in a bell geometry are bowed without a break: a Utility that is always one acts as their gate. Organic " +
      "LFOs vary each bow's pressure slowly and out of step, so one voice swells while another fades, and the three beat against " +
      "each other. A large hall carries it.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Bow input is added to the pressure of all three: " +
      "more is louder and rougher, less turns into thin whistling.\n\n" +
      "Tip: lower Damping on the voices for a longer shimmer after the bow dips.",
  }).input("bow", "Bow").stereoOut();
  const on = constant(p, [0, 0], "Bow Held");
  const lfo = p.add("organic-lfos", [0, 2], { rate: 0.035, spread: 0.7, drift: 0.5, seed: 14 });
  const mix = p.add("audio-mixer", [2, 1], { level1: -7, pan1: -0.5, level2: -7, pan2: 0.5, level3: -8, pan3: 0, master: -2 });
  [["Bowl D", -10], ["Bowl A", -3], ["Bowl E", 2]].forEach(([name, coarse], i) => {
    const mv = p.add("modal-voice", [1, i], { bow: 0.5, bowTimbre: 0.35, strike: 0, geometry: 0.7, brightness: 0.55, damping: 0.2,
      position: 0.3 + i * 0.12, size: 0.45, space: 0.4, contour: 0.15, coarse, partials: "16", seed: 50 + i }, { name });
    p.cable(on, "out", mv, "gate").cable(lfo, `out${i + 1}`, mv, "bow", 0.2).cable(p.cin, "bow", mv, "bow", 0.3)
      .stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  hall(p, mix, [3, 1], { size: 0.9, decay: 12, damping: 0.4, mix: 0.4 });
  return p;
}

// A harmonic macro model with a barber-pole frequency shifter feeding on itself.
function subharmonicOcean() {
  const p = cell("Subharmonic Ocean", {
    description: "A rich harmonic oscillator on a low A passes through a frequency shifter that spirals back into itself, so slow swirls of overtones climb and sink around a steady fundamental. Shared input Spiral.",
    tags: ["ambient", "drone", "frequency shifter", "spiral", "deep"],
    help: "A Macro Osc on its Harmonic model plays a low A. Organic LFOs move its Tone, Shape and Blend knobs slowly. A Freq Shifter on the " +
      "plus or minus ten hertz range shifts it up by about one and a half hertz and feeds a part of itself back, which gives barber-pole " +
      "phasing: the overtones seem to rise forever. A hall completes the sea.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Spiral input is added to the shifter feedback: " +
      "more makes bells and swirls, too much turns into a roar.\n\n" +
      "Tip: set Shift to a negative amount for a spiral that sinks instead of rising.",
  }).input("spiral", "Spiral").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.02, spread: 0.6, drift: 0.5, seed: 3 });
  const osc = p.add("macro-osc", [1, 1], { model: "Harmonic", octave: -2, coarse: 9, tone: 0.4, shape: 0.5, blend: 0.3, level: 0.8 });
  p.cable(lfo, "out1", osc, "tone", 0.3).cable(lfo, "out2", osc, "shape", 0.3).cable(lfo, "out3", osc, "blend", 0.3);
  const fs = p.add("freq-shifter", [2, 1], { range: "±10 Hz", shift: 0.15, feedback: 0.35, fbDelay: 0.3, spread: 0.6, mix: 0.6 });
  p.cable(osc, "out", fs, "l").cable(osc, "out", fs, "r").cable(p.cin, "spiral", fs, "feedback", 0.25);
  const mix = bed(p, [3, 1], [{ node: fs, level: -6 }], { master: -2 });
  hall(p, mix, [4, 1], { size: 0.9, decay: 13, mix: 0.4 });
  return p;
}

export default category("Ambient Drones", "Long, sustained beds that move by themselves: nothing to play, no transport needed. Out L/R out.", [
  slowTide, glassCathedral, monksBreath, deepHum, swarmBloom, tapeNebula, distantEngines, auroraVeil, singingBowlsDrone, subharmonicOcean,
]);
