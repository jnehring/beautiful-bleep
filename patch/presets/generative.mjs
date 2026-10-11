// SPDX-License-Identifier: MIT
// Generative: self-playing patches as plain cells. Press play and they make
// music on their own, in time with the transport; Out L/R out.
import { cell, category } from "./kit.mjs";

/// The mixer's send → an effect (set to 100 % wet) → the mixer's return.
function sendReturn(p, mix, fx) {
  p.cable(mix, "sendl", fx, "l").cable(mix, "sendr", fx, "r")
    .cable(fx, "l", mix, "returnl").cable(fx, "r", mix, "returnr");
}

// Recall's chance gates tossed between three pinged low pass gates; each
// samples its own pentatonic note: west-coast hand drums.
function bongoGarden() {
  const p = cell("Bongo Garden", {
    description: "Random gates tossed between three pinged low pass gates, each tuned to a fresh D minor pentatonic note: a west-coast hand-drum garden that keeps shifting. Shared input Density.",
    tags: ["generative", "west coast", "percussion", "pentatonic", "low pass gate"],
    help: "A Recall module makes random gates that a Coin Toss tosses between three pinged low pass gates. Each " +
      "drum samples a fresh D minor pentatonic note from a Quantizer Suite, fed by Uncertainty curves. " +
      "Drums are mixed in stereo with a send to a small reverb.\n\n" +
      "Press play: it makes sound on its own from Out L/R. The Density input raises the gate bias of " +
      "Recall, so more means more hits. It follows the transport.\n\n" +
      "Tip: lower Density for a sparse pattern, and pitch the whole garden by editing the quantizer root.",
  }).input("dens", "Density").stereoOut();
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.42, trecall: 0.6, tloop: 16, tjitter: 0.08, sync: "1/16", seed: 7 });
  const coin = p.add("coin-toss", [0, 1], { prob1: 0.55, prob2: 0.5, memory1: 0.3, seed: 11 });
  const un = p.add("uncertainty", [0, 2], { f1rate: 0.7, f2rate: 0.45 });
  const qs = p.add("quantizer-suite", [1, 2], {
    "a.root": "D", "a.scale": "Minor Pentatonic", "a.sample": "Trigger", "a.octave": -1,
    "b.mode": "Quantize", "b.sample": "Trigger", "b.octave": 0,
    "c.mode": "Transpose", "c.steps": -3, "c.sample": "Trigger", "c.octave": -1,
  });
  p.cable(p.cin, "dens", rc, "tbias", 0.4)
    .cable(rc, "t1", coin, "in1").cable(rc, "t2", coin, "in2")
    .cable(un, "fluct1", qs, "ina").cable(un, "fluct2", qs, "inb").cable(un, "fluct2", qs, "inc")
    .cable(coin, "a1", qs, "triga").cable(coin, "b1", qs, "trigb").cable(coin, "a2", qs, "trigc");
  const mix = p.add("audio-mixer", [3, 1], { level1: -6, pan1: -0.55, level2: -6, pan2: 0.55, level3: -5, pan3: 0,
    send1: -14, send2: -14, send3: -16, return: -4, master: -2 });
  const pings = [["a1", "outa", 0.12], ["b1", "outb", 0.25], ["a2", "outc", 0.05]];
  pings.forEach(([gate, pitch, shape], i) => {
    const osc = p.add("oscillator", [1, i], { shape, fm: 0.12 }, { name: `Drum ${i + 1}` });
    const lpg = p.add("low-pass-gate", [2, i], { response: 0.3, ping: 0.9, resonance: 0.35, brightness: 0.6, drive: 0.15 },
      { name: `LPG ${i + 1}` });
    p.cable(qs, pitch, osc, "pitch").cable(osc, "sub", osc, "fm").cable(osc, "out", lpg, "l")
      .cable(coin, gate, lpg, "ping").cable(lpg, "l", mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [4, 2], { size: 0.35, decay: 1.4, damping: 0.5, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, verb);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A shift register's melody plucks a two-voice string resonator, a canon
// bass echoes it four steps later; dotted delay and a room.
function turingStrings() {
  const p = cell("Turing Strings", {
    description: "A Shift Register melody in A Dorian plucks a string Resonator while a sine bass echoes the same bits four steps later, through a dotted-eighth delay network. Shared input Lock (frozen ↔ mutating).",
    tags: ["generative", "turing machine", "shift register", "plucked", "string", "delay"],
    help: "A Shift Register (8 bits, A Dorian) plucks a two-voice string Resonator on its bit 1. Another bit " +
      "triggers a sine bass through a low pass gate, so the bass echoes the melody later. A dotted-eighth " +
      "Delay Network and a reverb finish it.\n\n" +
      "Press play: it plays on its own from Out L/R. The Lock input is added to the Lock knob: up freezes " +
      "the pattern, down lets it mutate. It follows the transport.\n\n" +
      "Tip: freeze the pattern when you like it, then ride Lock for variation.",
  }).input("lock", "Lock").stereoOut();
  const sr = p.add("shift-register", [0, 0], { lock: 0.85, length: 8, sync: "1/8", octaves: 2, root: "A", scale: "Dorian", seed: 23, gatelength: 0.4 });
  const res = p.add("resonator", [1, 0], { model: "String", polyphony: "2", frequency: -12, structure: 0.4, brightness: 0.55, damping: 0.55, position: 0.25, exciter: 0.7 });
  const dn = p.add("delay-network", [2, 0], { sync: "1/8.", taps: 3, feedback: 0.42, scatter: 0.2, character: 0.3, tone: -0.3, width: 0.9, mix: 0.3, routing: "Ring" });
  const bass = p.add("oscillator", [1, 1], { octave: "-2", shape: 0.1 }, { name: "Canon Bass" });
  const lpg = p.add("low-pass-gate", [2, 1], { response: 0.55, ping: 0.85, brightness: 0.5 });
  p.cable(p.cin, "lock", sr, "lock", 0.5)
    .cable(sr, "bit1", res, "strum").cable(sr, "pitch", res, "pitch")
    .cable(res, "odd", dn, "l").cable(res, "even", dn, "r")
    .cable(sr, "pitch", bass, "pitch").cable(bass, "out", lpg, "l").cable(sr, "bit5", lpg, "ping");
  const mix = p.add("audio-mixer", [3, 1], { level1: -3, level2: -8, send1: -16, send2: -24, return: -6, master: -2 });
  p.stereo(dn, mix, { to: ["in1l", "in1r"] }).cable(lpg, "l", mix, "in2l");
  const verb = p.add("reverb", [4, 2], { size: 0.55, decay: 2.8, damping: 0.45, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, verb);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Four voices on free LFO loops of prime-ish lengths (18–29 s): they never
// line up the same way twice. Eno's Music for Airports, as a patch.
function tapeLoopChoir() {
  const p = cell("Tape Loop Choir", {
    description: "Four soft voices of a D♭ major-seven chord, each swelling on its own free-running loop of 18 to 29 seconds so they never line up the same way twice, into a wobbling tape delay and a long hall.",
    tags: ["generative", "ambient", "eno", "tape loops", "slow"],
    help: "Four soft voices make a D flat major seven chord. Each is gated by its own free LFO loop of 18 to 29 " +
      "seconds, so the swells never line up the same way twice. The sum goes through a dark filter, a " +
      "wobbling tape delay and a long hall.\n\n" +
      "Press play: it plays on its own from Out L/R, and has no inputs. The loops run freely and are not " +
      "tied to the tempo.\n\n" +
      "Tip: use it as a bed under a slow lead or just as ambient background.",
  }).stereoOut();
  const voices = [  // coarse (semitones from C4), loop length (s), LFO phase, pan
    [-4, 23.3, 0, -0.6], [1, 18.1, 120, 0.3], [5, 29.1, 250, -0.2], [12, 25.7, 60, 0.65],
  ];
  const mix = p.add("audio-mixer", [4, 1], { level1: -6, pan1: voices[0][3], level2: -7, pan2: voices[1][3],
    level3: -7, pan3: voices[2][3], level4: -9, pan4: voices[3][3], master: -3 });
  voices.forEach(([coarse, secs, phase, pan], i) => {
    const loop = p.add("lfo", [0, i], { rate: 1 / secs, phase, pw: 0.16, polarity: "Unipolar" }, { name: `Loop ${i + 1}` });
    const osc = p.add("oscillator", [1, i], { coarse, shape: 0.18, fine: [-4, 3, -2, 5][i] }, { name: `Voice ${i + 1}` });
    const env = p.add("adsr", [2, i], { attack: 2.5, decay: 1.5, sustain: 0.75, release: 6, velamount: 0 }, { name: `Swell ${i + 1}` });
    const vca = p.add("vca", [3, i], {}, { name: `VCA ${i + 1}` });
    p.cable(loop, "square", env, "gate").cable(osc, "out", vca, "l").cable(env, "env", vca, "gain")
      .cable(vca, "l", mix, `in${i + 1}l`);
  });
  const tone = p.add("filter", [5, 0], { cutoff: 2600, resonance: 0.05, type: "1-Pole Low-pass" }, { name: "Tape Tone" });
  const tape = p.add("zone-delay", [5, 1], { zone: 4, time: 0.55, feedback: 0.55, character: 0.4, tone: -0.3, wobble: 0.45, diffuse: 0.3, mix: 0.35 });
  const verb = p.add("reverb", [5, 2], { size: 0.85, decay: 9, damping: 0.55, modDepth: 0.4, mix: 0.4 });
  p.stereo(mix, tone, { from: ["outl", "outr"] }).stereo(tone, tape).stereo(tape, verb).stereo(verb, p.cout);
  return p;
}

// Chance gates in a gusty rhythm strike two bell-like modal bodies, each
// holding its own pentatonic note until its next strike.
function windChimes() {
  const p = cell("Wind Chimes", {
    description: "Gusts of chance triggers strike two bell-like Modal Voices tuned to F major pentatonic, slow organic movement on where they are struck, in a wide reverb. Shared input Wind (more strikes).",
    tags: ["generative", "chimes", "bells", "modal", "ambient", "pentatonic"],
    help: "A Recall module makes sparse chance triggers that strike two Modal Voices. A Quantizer Suite tunes " +
      "each to F major pentatonic, and organic LFOs vary where on the bar they are struck. A reverb makes " +
      "the space.\n\n" +
      "Press play: it plays on its own from Out L/R. The Wind input is added to the trigger bias: more " +
      "means more chimes. It follows the transport.\n\n" +
      "Tip: raise Wind in gusts and lower it for stillness.",
  }).input("wind", "Wind").stereoOut();
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.16, tjitter: 0.7, sync: "1/16", seed: 42 });
  const gust = p.add("organic-lfos", [0, 1], { rate: 0.05, spread: 0.6, drift: 0.5, seed: 5 });
  const un = p.add("uncertainty", [0, 2], { f1rate: 0.23, f2rate: 0.31, f1spread: 0.6, f2spread: 0.6, seed: 9 });
  const qs = p.add("quantizer-suite", [1, 2], {
    "a.root": "F", "a.scale": "Major Pentatonic", "a.sample": "Trigger", "a.octave": 1,
    "b.mode": "Quantize", "b.sample": "Trigger", "b.octave": 1,
  });
  p.cable(p.cin, "wind", rc, "tbias", 0.35).cable(gust, "out3", rc, "tbias", 0.12)
    .cable(un, "fluct1", qs, "ina").cable(un, "fluct2", qs, "inb")
    .cable(rc, "t1", qs, "triga").cable(rc, "t2", qs, "trigb");
  const mix = p.add("audio-mixer", [3, 1], { level1: -6, level2: -6, send1: -8, send2: -8, return: -3, master: -3 });
  [["t1", "outa", "out1"], ["t2", "outb", "out2"]].forEach(([trig, pitch, mod], i) => {
    const mv = p.add("modal-voice", [2, i], { strike: 1, strikeTimbre: 0.65, geometry: 0.85 - i * 0.1, brightness: 0.7,
      damping: 0.2, position: 0.35, size: 0.3, space: 0.3, partials: "16", seed: 3 + i }, { name: `Chime ${i + 1}` });
    p.cable(qs, pitch, mv, "pitch").cable(rc, trig, mv, "strike").cable(gust, mod, mv, "position", 0.25)
      .stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const verb = p.add("reverb", [4, 2], { size: 0.8, decay: 6, damping: 0.3, modDepth: 0.35, mix: 1 });
  sendReturn(p, mix, verb);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Drum Map with a little chaos plus a polymeter acid line through a diode
// ladder whose cutoff drifts on a slow LFO: a techno loop that never repeats.
function acidWeather() {
  const p = cell("Acid Weather", {
    description: "A generative techno loop: Drum Map kick, clap and hats with a touch of chaos, and a Polymeter Seq acid line in A minor through a resonant diode ladder whose cutoff drifts like weather. Shared input Cutoff.",
    tags: ["generative", "techno", "acid", "drums", "loop"],
    help: "A Drum Map drives Punch kick, clap and hats with a touch of chaos, and a Polymeter Seq plays an A " +
      "minor acid line through a Diode Ladder filter. A slow random LFO moves the cutoff like weather, and " +
      "a dotted delay is on a send.\n\n" +
      "Press play: it plays on its own from Out L/R. The Cutoff input is added to the filter cutoff, which " +
      "also follows the acid line envelope. It follows the transport.\n\n" +
      "Tip: raise Cutoff slowly for a build.",
  }).input("cut", "Cutoff").stereoOut();
  const dm = p.add("drum-map", [0, 0], { x: 0.3, y: 0.6, kickdensity: 0.55, snaredensity: 0.4, hatsdensity: 0.65, chaos: 0.25, chaosrate: "Every 2 bars", swing: 0.54, seed: 17 });
  const kick = p.add("punch-kick", [1, 0], { tune: 48, decay: 0.45, drive: 0.35 });
  const clap = p.add("punch-clap", [1, 1], { tone: 1300, decay: 0.3 });
  const hats = p.add("punch-hats", [1, 2], { closed: 0.04, open: 0.3, crunch: 0.3, level: 0.6 });
  p.cable(dm, "kick", kick, "trig").cable(dm, "kickvel", kick, "velocity")
    .cable(dm, "snare", clap, "trig").cable(dm, "snarevel", clap, "velocity")
    .cable(dm, "hats", hats, "closed").cable(dm, "hatsacc", hats, "open").cable(dm, "hatsvel", hats, "velocity");
  const seq = p.add("polymeter-sequencer", [0, 3], { root: "A", scale: "Natural Minor", octave: -1, gatescale: 0.7, swing: 0.54, seed: 31 });
  const osc = p.add("oscillator", [1, 3], { octave: "-1", shape: 0.6667 }, { name: "Acid Saw" });
  const env = p.add("adsr", [1, 4], { attack: 0.002, decay: 0.22, sustain: 0.15, release: 0.12, velamount: 0.6 }, { name: "Acid Env" });
  const drift = p.add("lfo", [2, 4], { rate: 0.04, wave: "Random Smooth", seed: 4 }, { name: "Weather" });
  const flt = p.add("filter", [2, 3], { cutoff: 380, resonance: 0.78, drive: 0.35, keytrack: 0.3, type: "Diode Ladder Tanh" });
  const vca = p.add("vca", [3, 3]);
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "pitch", flt, "pitch").cable(seq, "gate", env, "gate")
    .cable(seq, "trigger", env, "retrig").cable(seq, "velocity", env, "velocity")
    .cable(osc, "out", flt, "l").cable(env, "env", flt, "cutoff", 0.32).cable(drift, "out", flt, "cutoff", 0.12)
    .cable(p.cin, "cut", flt, "cutoff", 0.4).cable(flt, "l", vca, "l").cable(env, "env", vca, "gain");
  const mix = p.add("audio-mixer", [4, 1], { level1: -2, level2: -9, pan2: 0.15, level3: -12, pan3: -0.25, level4: -7,
    send4: -10, send2: -20, return: -9, master: -2 });
  p.cable(kick, "out", mix, "in1l").cable(clap, "out", mix, "in2l").cable(hats, "out", mix, "in3l").cable(vca, "l", mix, "in4l");
  const dly = p.add("delay-network", [5, 2], { sync: "1/8.", taps: 2, feedback: 0.45, tone: -0.4, width: 1, mix: 1, routing: "Ring" });
  sendReturn(p, mix, dly);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A Harmony Master on bus D walks a locked four-chord loop; a pad plays the
// chord tones, a bass follows the root, an arpeggio follows the chord.
function seasonsTurning() {
  const p = cell("Seasons Turning", {
    description: "A Harmony Master (bus D) walks a repeating loop of four D minor seventh chords, two bars each: a saw pad holds the chord tones, a plucked bass follows the chord's bass note, and a Pluck arpeggio traces the chord. Shared input Root (transposes everything).",
    tags: ["generative", "chords", "progression", "arpeggio", "harmony"],
    help: "A Random module walks a four-step loop of chord degrees on a Harmony Master (D minor sevenths, Bus " +
      "D). Three saw oscillators play the chord tones through a ladder filter, a plucked bass follows the " +
      "chord's bass note, and a Pluck arpeggio is snapped to the chord via a Quantizer Suite.\n\n" +
      "Press play: it plays on its own from Out L/R. The Root input, a pitch, transposes the chords. It " +
      "follows the transport.\n\n" +
      "Tip: patch a keyboard or sequencer pitch into Root to change key.",
  }).input("root", "Root", "pitch").stereoOut();
  const walk = p.add("random", [0, 0], { sync: "2 bars", length: "4 steps", loop: 1, spread: 1, seed: 12 }, { name: "Chord Walk" });
  const hm = p.add("harmony-master", [1, 0], { source: "Manual", key: "D", scale: "Natural Minor", quality: "Diatonic Seventh",
    degree: 4, octave: -1, bus: "D" });
  p.cable(walk, "out", hm, "degree", 0.5).cable(p.cin, "root", hm, "transpose");
  // Pad: three chord tones on detuned saws through a soft ladder.
  const pf = p.add("filter", [3, 0], { cutoff: 900, resonance: 0.2, drive: 0.15, type: "Ladder Tanh" }, { name: "Pad Filter" });
  const sweep = p.add("lfo", [3, 1], { rate: 0.07 }, { name: "Pad Sweep" });
  ["tone1", "tone2", "tone3"].forEach((t, i) => {
    const o = p.add("oscillator", [2, i], { fine: [-6, 4, 8][i], shape: 0.6667 }, { name: `Pad ${i + 1}` });
    p.cable(hm, t, o, "pitch");
    if (i !== 2) p.cable(o, "out", pf, "l", 0.35);
    if (i !== 0) p.cable(o, "out", pf, "r", 0.35);
  });
  p.cable(sweep, "sine", pf, "cutoff", 0.08);
  // Rhythm for bass and arpeggio.
  const rb = p.add("rhythm-bank", [0, 3], { pattern: 37, family: "Interlock", rate: "1/16", width: 0.3 });
  const bass = p.add("oscillator", [2, 3], { shape: 0.3 }, { name: "Bass" });
  const blpg = p.add("low-pass-gate", [3, 3], { response: 0.6, ping: 0.9, brightness: 0.55, resonance: 0.2 }, { name: "Bass LPG" });
  p.cable(hm, "bass", bass, "pitch").cable(bass, "out", blpg, "l").cable(rb, "out1", blpg, "ping").cable(hm, "change", blpg, "ping");
  // Arpeggio: a slow triangle contour snapped to the chord tones on every hit.
  const contour = p.add("lfo", [0, 4], { rate: 0.31 }, { name: "Contour" });
  const qs = p.add("quantizer-suite", [1, 4], { "a.mode": "Follow", "a.harmony": "Bus D", "a.target": "Chord", "a.sample": "Trigger",
    "a.octave": 1, "b.notes": false, "c.notes": false, "d.notes": false });
  const arp = p.add("macro-osc", [2, 4], { model: "Pluck", tone: 0.55, blend: 0.4, decay: 0.7, level: 0.7 }, { name: "Arp Pluck" });
  p.cable(contour, "triangle", qs, "ina").cable(rb, "out2", qs, "triga")
    .cable(qs, "outa", arp, "pitch").cable(rb, "out2", arp, "trig");
  const mix = p.add("audio-mixer", [4, 2], { level1: -12, level2: -6, level3: -8, pan3: 0.3,
    send1: -12, send3: -8, return: -6, master: -2 });
  p.stereo(pf, mix, { to: ["in1l", "in1r"] }).cable(blpg, "l", mix, "in2l").cable(arp, "out", mix, "in3l");
  const verb = p.add("reverb", [5, 3], { size: 0.7, decay: 4.5, damping: 0.45, preDelay: 0.04, mix: 1 });
  sendReturn(p, mix, verb);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A minor-ninth swarm breathing through a scale-tuned filter bank, eight
// related slow LFOs on its spread, scan and shift.
function lichenDrone() {
  const p = cell("Lichen Drone", {
    description: "A twelve-voice Swarm on a C minor ninth, breathing through a scale-tuned Filter Bank; eight related Organic LFOs slowly move its spread, cross-FM and the bank's scan and shift. Shared input Root (pitch).",
    tags: ["generative", "drone", "ambient", "swarm", "evolving"],
    help: "A twelve-voice Swarm plays a C minor ninth chord through a scale-tuned Filter Bank and a long " +
      "reverb. Eight related Organic LFOs slowly move the spread, cross-FM, scan, shift and width, so the " +
      "drone evolves.\n\n" +
      "Press play: it plays on its own from Out L/R and is not tied to the tempo. The Root input, a pitch, " +
      "moves the Swarm and the Filter Bank together.\n\n" +
      "Tip: change Root slowly with a glide for drone modulations.",
  }).input("root", "Root", "pitch").stereoOut();
  const life = p.add("organic-lfos", [0, 1], { rate: 0.025, spread: 0.7, drift: 0.6, twist: 0.3, seed: 8 });
  const sw = p.add("swarm", [1, 0], { octave: -1, chord: "Minor 9", count: 12, spread: 0.45, range: 3, detune: 14, drift: 0.55,
    crossfm: 0.06, glide: 3, width: 0.9, pattern: "Random", stack: "Centred", seed: 6 });
  const air = p.add("noise", [1, 1], { colour: -0.6, level: 1 }, { name: "Breath" });
  const fb = p.add("filter-bank", [2, 0], { q: 7, tilt: -1.5, scan: 0.5, width: 5, tuning: "Scale", root: "C", scale: "Minor Pentatonic", mix: 0.75 });
  p.cable(p.cin, "root", sw, "pitch").cable(p.cin, "root", fb, "pitch")
    .stereo(sw, fb).cable(air, "out", fb, "l", 0.05).cable(air, "out", fb, "r", 0.05)
    .cable(life, "out1", sw, "spread", 0.3).cable(life, "out2", sw, "crossfm", 0.08)
    .cable(life, "out3", fb, "scan", 0.4).cable(life, "out4", fb, "shift", 0.12).cable(life, "out5", fb, "width", 0.2);
  const verb = p.add("reverb", [3, 0], { size: 0.9, decay: 12, damping: 0.5, modDepth: 0.5, mix: 0.4 });
  p.stereo(fb, verb).cable(life, "out6", verb, "size", 0.05);
  const mix = p.add("audio-mixer", [4, 1], { level1: -6, master: -3 });
  p.stereo(verb, mix, { to: ["in1l", "in1r"] }).stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Four marimba bars on prime clock divisions (2, 3, 5, 7 sixteenths): a
// rotating polyrhythm on a C minor seventh chord.
function primeMarimba() {
  const p = cell("Prime Marimba", {
    description: "Four Modal Voice marimba bars on C minor-seventh chord tones, struck every 2, 3, 5 and 7 sixteenths; a slow random rotates which bar gets which prime, so the polyrhythm turns over every four bars.",
    tags: ["generative", "polyrhythm", "marimba", "mallets", "modal"],
    help: "A Rotating Divider outputs triggers every 2, 3, 5 and 7 sixteenths. Each strikes a Modal Voice " +
      "marimba bar tuned to a C minor seventh chord tone. A slow random rotates which bar gets which prime " +
      "every four bars.\n\n" +
      "Press play: it plays on its own from Out L/R and has no inputs. It follows the transport.\n\n" +
      "Tip: it works well as a background layer under pads and bass.",
  }).stereoOut();
  const div = p.add("rotating-divider", [0, 1], { set: "Primes", base: "1/16", output: "Trigger", rotate: 4, sync: "Next Bar" });
  const turn = p.add("random", [0, 2], { sync: "4 bars", spread: 1, length: "8 steps", loop: 0.5, seed: 21 }, { name: "Turn" });
  p.cable(turn, "out", div, "rotate", 0.25);
  const bars = [[-12, -0.5], [-5, 0.5], [3, -0.25], [10, 0.25]];  // coarse, pan
  const mix = p.add("audio-mixer", [2, 1], { level1: -4, level2: -6, level3: -7, level4: -8, master: -2,
    send1: -18, send2: -16, send3: -14, send4: -14, return: -6, pan1: bars[0][1], pan2: bars[1][1], pan3: bars[2][1], pan4: bars[3][1] });
  bars.forEach(([coarse], i) => {
    const mv = p.add("modal-voice", [1, i], { coarse, strike: 1, strikeTimbre: 0.4, geometry: 0.55, brightness: 0.5,
      damping: 0.4, position: 0.2 + i * 0.08, space: 0.1, partials: "16", seed: 10 + i }, { name: `Bar ${i + 1}` });
    p.cable(div, `out${i + 1}`, mv, "strike").cable(mv, "l", mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [3, 2], { size: 0.45, decay: 1.8, damping: 0.5, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, verb);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Random Lydian plucks recorded into Grains, read back at wandering
// positions in octaves and fifths: a shimmering cloud.
function pollenCloud() {
  const p = cell("Pollen Cloud", {
    description: "Sparse Lydian plucks from a Macro Osc feed Grains, which scatters them back at wandering positions, an octave or a fifth away, with feedback and blur: a slowly shimmering cloud. Shared input Density.",
    tags: ["generative", "granular", "ambient", "cloud", "shimmer"],
    help: "Random notes on 8ths, quantized to E Lydian, are played by a plucked Macro Osc at coin-toss moments. " +
      "Grains records the plucks and scatters them at moving positions, an octave or a fifth away, with " +
      "feedback and blur.\n\n" +
      "Press play: it plays on its own from Out L/R. The Density input is added to the Grains density: more " +
      "means a thicker cloud. It follows the transport.\n\n" +
      "Tip: lower Density for sparse clouds with space between grains.",
  }).input("dens", "Density").stereoOut();
  const notes = p.add("random", [0, 0], { sync: "1/8", spread: 0.8, loop: 0.4, length: "16 steps", seed: 3 }, { name: "Notes" });
  const gate = p.add("coin-toss", [0, 1], { prob1: 0.35, seed: 19 });
  const q = p.add("quantizer", [1, 0], { root: "E", scale: "Lydian", range: 1.5 });
  const src = p.add("macro-osc", [2, 0], { model: "Pluck", tone: 0.4, blend: 0.6, decay: 1.2, level: 0.7 }, { name: "Plucks" });
  p.cable(notes, "out", q, "in").cable(notes, "trig", gate, "in1")
    .cable(q, "out", src, "pitch").cable(gate, "a1", src, "trig");
  const wander = p.add("wobble", [1, 2], { rate: 0.15, smooth: 0.9, wobble: 0.3, polarity: "Unipolar", seed: 2 }, { name: "Wander" });
  const gr = p.add("grains", [3, 0], { position: 0.15, size: 0.35, density: 0.55, texture: 0.6, spread: 0.5, pitchjitter: 12,
    feedback: 0.35, blur: 0.45, mix: 0.7, reverse: 0.25, pitchquant: "Octaves + fifths", buffer: "4 s", seed: 14 });
  p.cable(src, "out", gr, "l").cable(wander, "smooth", gr, "position", 0.5)
    .cable(wander, "wobble", gr, "size", 0.15).cable(p.cin, "dens", gr, "density", 0.4);
  const verb = p.add("reverb", [4, 0], { size: 0.75, decay: 5, damping: 0.4, mix: 0.3, quality: "Eco (8 lines)" });
  const mix = p.add("audio-mixer", [5, 1], { level1: -4, master: -2 });
  p.stereo(gr, verb).stereo(verb, mix, { to: ["in1l", "in1r"] }).stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Two leaky neurons fire at each other; their spikes and logic gates hit
// four percussion voices, then a glitcher and a scattered delay.
function synapseClicks() {
  const p = cell("Synapse Clicks", {
    description: "Two Neurons firing at each other, nudged by slow organic drift, play metallic FM clicks, a modal knock, noise ticks and a rim; Bender glitches the mix and a scattered delay smears it. Shared input Excite (fires faster).",
    tags: ["generative", "glitch", "percussion", "neuron", "idm"],
    help: "Two Neurons fire at each other. Their spikes and logic outputs trigger an FM click, a modal knock, " +
      "noise ticks and a clave. Organic LFOs nudge them, a Bender glitches the mix and a scattered Delay " +
      "Network smears it.\n\n" +
      "Press play: it plays on its own from Out L/R. The Excite input is added to one neuron, making it " +
      "fire faster. The neurons run freely; only the Bender slices follow the transport.\n\n" +
      "Tip: raise Excite for denser, busier rhythms.",
  }).input("exc", "Excite").stereoOut();
  const nr = p.add("neuron", [0, 0], { aw1: 0.75, bw1: 0.95, aleak: 0.2, bleak: 0.35, apulse: 0.02, bpulse: 0.02 });
  const drift = p.add("organic-lfos", [0, 1], { rate: 0.08, spread: 0.6, seed: 13 });
  p.cable(drift, "out1", nr, "a2", 0.4).cable(drift, "out2", nr, "b2", 0.4).cable(p.cin, "exc", nr, "a2", 0.5);
  const fm = p.add("perc-voice", [1, 0], { engine: "FM", pitch: 900, tone: 0.75, click: 0.6, decay: 0.06, damp: 0.6, sweep: 0.2, level: 0.6 }, { name: "FM Click" });
  const knock = p.add("perc-voice", [1, 1], { engine: "Modal", pitch: 160, tone: 0.45, decay: 0.18, sweep: 0.3, level: 0.75 }, { name: "Knock" });
  const tick = p.add("perc-voice", [1, 2], { engine: "Noise Bank", pitch: 2400, tone: 0.8, decay: 0.03, level: 0.5 }, { name: "Tick" });
  const rim = p.add("ring-rim", [1, 3], { voice: "Clave", tune: 5, level: 0.5 });
  p.cable(nr, "aspike", fm, "trig").cable(nr, "diff", fm, "pitch", 0.5)
    .cable(nr, "bspike", knock, "trig").cable(nr, "aout", knock, "pitch", 0.25)
    .cable(nr, "xor", tick, "trig").cable(nr, "and", rim, "trig");
  const mix = p.add("audio-mixer", [2, 1], { level1: -6, pan1: -0.4, level2: -3, level3: -10, pan3: 0.5, level4: -9, pan4: 0.2,
    send1: -10, send2: -18, send3: -12, send4: -14, return: -8, master: -2 });
  p.cable(fm, "l", mix, "in1l").cable(fm, "r", mix, "in1r").cable(knock, "l", mix, "in2l").cable(knock, "r", mix, "in2r")
    .cable(tick, "l", mix, "in3l").cable(rim, "out", mix, "in4l");
  const dly = p.add("delay-network", [3, 2], { time: 0.11, taps: 5, scatter: 0.6, jitter: 0.3, reverse: 0.3, feedback: 0.4, tone: 0.2, mix: 1, routing: "Mesh" });
  sendReturn(p, mix, dly);
  const bend = p.add("bender", [3, 1], { chance: 0.2, repeats: 4, sync: "1/16", mode: "Shuffle", bendsteps: "Octaves" });
  p.stereo(mix, bend, { from: ["outl", "outr"] }).stereo(bend, p.cout);
  return p;
}

export default category("Generative", "Self-playing patches: press play and they make music on their own, in time with the transport. Out L/R out.", [
  bongoGarden, turingStrings, tapeLoopChoir, windChimes, acidWeather, seasonsTurning, lichenDrone, primeMarimba, pollenCloud, synapseClicks,
]);
