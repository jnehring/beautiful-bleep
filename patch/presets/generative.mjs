// SPDX-License-Identifier: MIT
// Generative: self-playing patches as plain cells. Press play and they make
// music on their own, in time with the transport; Out L/R out.
import { cell, category, semis, steps as stepsOf } from "./kit.mjs";

/// Gate Sequencer data: up to four 32-step tracks as strings. `.` off, `x` hit, `X` accent, `o` ghost, `?` coin-flip hit.
function gateTracks(rows) {
  const step = (ch) => {
    const s = { on: 0, p: 100, l: 50, t: 0, r: 1, rs: 0, n: 0, c: [0, 0], v: 100 };
    if (ch === "x") Object.assign(s, { on: 1, v: 96 });
    else if (ch === "X") Object.assign(s, { on: 1, v: 124 });
    else if (ch === "o") Object.assign(s, { on: 1, v: 48 });
    else if (ch === "?") Object.assign(s, { on: 1, p: 45, v: 80 });
    return s;
  };
  return { tracks: [0, 1, 2, 3].map((t) => ({ mute: false, steps: [...(rows[t] || "").padEnd(32, ".")].slice(0, 32).map(step) })) };
}

/// The mixer's send → an effect (set to 100 % wet) → the mixer's return.
function sendReturn(p, mix, fx) {
  p.cable(mix, "sendl", fx, "l").cable(mix, "sendr", fx, "r")
    .cable(fx, "l", mix, "returnl").cable(fx, "r", mix, "returnr");
}

// Dense chance triggers on three noise-bank voices tuned high, like drops on corrugated metal.
function tinRoofRain() {
  const p = cell("Tin Roof Rain", {
    description: "Dense random drops on three bright noise-band voices of different pitch, panned across a small room: steady rain on a metal roof that never repeats. Shared input Intensity (drizzle to downpour).",
    tags: ["generative", "rain", "texture", "noise", "ambient"],
    help: "A Recall module on thirty-second notes makes random gates in Chance mode; a Coin Toss splits them between " +
      "three Perc Voices in Noise Bank mode, each tuned to a different pitch and given a very short decay, so " +
      "they sound like drops hitting sheet metal. The random voltages of Recall nudge each pitch, and a small " +
      "reverb is the room.\n\n" +
      "Press play: it makes sound on its own from Out L/R. The Intensity input is added to the gate bias of " +
      "Recall: lower is a drizzle, higher is a downpour. It follows the transport.\n\n" +
      "Tip: automate Intensity slowly up and down as a storm passing.",
  }).input("int", "Intensity").stereoOut();
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.5, tjitter: 0.6, trecall: 0, xspread: 0.9, sync: "1/32", seed: 41 });
  const coin = p.add("coin-toss", [0, 1], { prob1: 0.5, prob2: 0.5, seed: 8 });
  p.cable(p.cin, "int", rc, "tbias", 0.35).cable(rc, "t1", coin, "in1").cable(rc, "t2", coin, "in2");
  const mix = p.add("audio-mixer", [3, 1], { level1: -9, pan1: -0.6, level2: -9, pan2: 0.6, level3: -11, pan3: 0.05,
    send1: -14, send2: -14, send3: -14, return: -5, master: 0 });
  [["a1", 2800, 0.05, "x1"], ["b1", 3900, 0.035, "x2"], ["a2", 1700, 0.07, "x3"]].forEach(([trig, pitch, decay, x], i) => {
    const d = p.add("perc-voice", [1, i], { engine: "Noise Bank", pitch, tone: 0.7, click: 0.4, decay, damp: 0.7, level: 0.7, seed: 5 + i },
      { name: `Drops ${i + 1}` });
    p.cable(coin, trig, d, "trig").cable(rc, x, d, "pitch", 0.15).stereo(d, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const room = p.add("reverb", [4, 2], { size: 0.3, decay: 1.2, damping: 0.55, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, room);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Two identical twelve-step claves, clocked by two free LFOs a hair apart: they slide out of phase and back.
function phaseClaves() {
  const p = cell("Phase Claves", {
    description: "The same twelve-step wooden pattern played by two clocks a hair apart: the two parts slowly slide out of phase and back again over minutes, a minimalist hand-clapping piece. Shared input Drift (widens the gap).",
    tags: ["generative", "minimalism", "phasing", "claves", "percussion"],
    help: "Two LFO squares run freely at 6.00 and 6.03 steps per second. Each clocks its own Gate Sequencer with " +
      "the same twelve-step pattern of eight hits, and each plays a Ring Rim Clave, one tuned a little higher " +
      "and panned left, the other right. Because the second clock is slightly faster, it gains one step " +
      "on the first about every 33 seconds; after twelve steps the two are in step again.\n\n" +
      "Press play: it plays on its own from Out L/R. The Drift input is added to the second clock's rate: " +
      "a little makes the phasing faster. The clocks are free and do not follow the transport.\n\n" +
      "Tip: with Drift at zero, listen for the moment the parts line up again after about six and a half minutes.",
  }).input("drift", "Drift").stereoOut();
  const pat = "xxx.xx.x.xx.";
  const clkA = p.add("lfo", [0, 0], { rate: 6, wave: "Square", polarity: "Unipolar", pw: 0.5 }, { name: "Clock A" });
  const clkB = p.add("lfo", [0, 1], { rate: 6.03, wave: "Square", polarity: "Unipolar", pw: 0.5 }, { name: "Clock B" });
  p.cable(p.cin, "drift", clkB, "rate", 0.004);
  const mix = p.add("audio-mixer", [3, 0], { level1: -4, pan1: -0.7, level2: -4, pan2: 0.7, send1: -18, send2: -18, return: -6, master: -2 });
  [[clkA, 0, "A"], [clkB, 3, "B"]].forEach(([clk, tune, tag], i) => {
    const seq = p.add("gate-sequencer", [1, i], { length1: 12, rate1: "1/16", swing: 0.5, dice: "Fixed" },
      { name: `Pattern ${tag}`, data: gateTracks([pat]) });
    const clave = p.add("ring-rim", [2, i], { voice: "Clave", tune, decay: 1, level: 0.8 }, { name: `Clave ${tag}` });
    p.cable(clk, "out", seq, "clock").cable(seq, "trig1", clave, "trig").cable(clave, "out", mix, `in${i + 1}l`);
  });
  const room = p.add("reverb", [4, 1], { size: 0.35, decay: 1.2, damping: 0.5, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, room);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A rotating divider on powers of two strikes four bell-like bodies, from a fast bar to the big gong.
function colotomicCycle() {
  const p = cell("Colotomic Cycle", {
    description: "A gamelan-style cycle: a fast bar plays random notes, and slower bells and a deep gong strike on every 4th, 8th and 16th beat, so the layers meet only at the end of each long cycle. Shared input Rotate (moves the divisions).",
    tags: ["generative", "gamelan", "gong", "cycle", "bells", "percussion"],
    help: "A Rotating Divider on the Powers of 2 set with a quarter-note base fires four layers at different divisions. " +
      "The fastest strikes a bright bar tuned to random notes of D minor pentatonic, the next a mid bell, " +
      "the next a low plate and the slowest a deep gong with a long ring. Together they mark the structure " +
      "of the cycle: the gong closes it.\n\n" +
      "Press play: it plays on its own from Out L/R. The Rotate input is added to the Rotate knob and " +
      "shifts the divisions at the next bar: more means slower layers. It follows the transport.\n\n" +
      "Tip: change the divider's Base to 1/8 for a faster, tighter cycle.",
  }).input("rot", "Rotate").stereoOut();
  const layers = [  // divider output, coarse, geometry, damping, size, level, pan, send
    ["out2", 7, 0.3, 0.45, 0.2, -5, -0.4, -16, "Saron"],
    ["out3", -2, 0.65, 0.35, 0.35, -5, 0.35, -14, "Bell"],
    ["out4", -12, 0.55, 0.25, 0.5, -4, -0.15, -12, "Plate"],
    ["out5", -24, 0.9, 0.12, 0.8, -3, 0, -12, "Gong"],
  ];
  const mixValues = { return: -5, master: -5 };
  layers.forEach(([, , , , , level, pan, send], i) => Object.assign(mixValues, { [`level${i + 1}`]: level, [`pan${i + 1}`]: pan, [`send${i + 1}`]: send }));
  const rd = p.add("rotating-divider", [0, 1], { set: "Powers of 2", base: "1/4", output: "Trigger", sync: "Next Bar" });
  const walk = p.add("random", [0, 0], { sync: "1/4", spread: 1, loop: 0.35, length: "8 steps", seed: 14 }, { name: "Saron Notes" });
  const q = p.add("quantizer", [1, 0], { root: "D", scale: "Minor Pentatonic", range: 1, hysteresis: 0 });
  p.cable(p.cin, "rot", rd, "rotate", 0.25).cable(walk, "out", q, "in");
  const mix = p.add("audio-mixer", [3, 1], mixValues);
  layers.forEach(([out, coarse, geometry, damping, size, , , , name], i) => {
    const mv = p.add("modal-voice", [2, i], { coarse, strike: 1, strikeTimbre: 0.5, geometry, brightness: 0.6, damping, position: 0.3,
      size, space: 0.2, partials: "16", seed: 20 + i }, { name });
    p.cable(rd, out, mv, "strike");
    if (i === 0) p.cable(q, "out", mv, "pitch");
    p.stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const verb = p.add("reverb", [4, 2], { size: 0.55, decay: 3.5, damping: 0.4, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, verb);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A four-on-the-floor kick, offbeat hats and delayed chord stabs: a foggy dub techno loop.
function dubTechnoFog() {
  const p = cell("Dub Techno Fog", {
    description: "A hazy dub-techno loop: soft kick, offbeat hats and a minor seventh chord stab fed into a long dotted echo and a cavernous reverb, so the chord dissolves into the fog. Shared inputs Cutoff and Dub (echo feedback).",
    tags: ["generative", "dub techno", "chords", "echo", "loop"],
    help: "A Gate Sequencer plays a Ring Kick, closed hats, a ghost rim and the chord. The chord comes from a Chord " +
      "Osc on a minor seventh, through a ladder filter and a short envelope. A dotted-eighth Delay Network " +
      "with a lot of feedback and a big reverb sit on a send, so only the first hit is clear and the rest is " +
      "fog.\n\n" +
      "Press play: it plays on its own from Out L/R. The Cutoff input is added to the chord filter cutoff, and " +
      "Dub is added to the echo feedback: raise it for a wash, lower it to hear the pattern. It follows the " +
      "transport.\n\n" +
      "Tip: ride Dub up on the last bar of a phrase, then back to zero on the downbeat.",
  }).input("cut", "Cutoff").input("dub", "Dub").stereoOut();
  const seq = p.add("gate-sequencer", [0, 1], { swing: 0.5, dice: "Fixed" }, {
    data: gateTracks(["X...X...X...X...", "..x...x...x...x.", "..X....x..x....x", "...?.?..?....?.."]),
  });
  const kick = p.add("ring-kick", [1, 0], { tune: 48, decay: 0.55, sweep: 0.3, tone: 0.2, level: 0.8 });
  const hat = p.add("ring-hats", [1, 1], { closed: 0.04, tone: 0.4, level: 0.5 });
  const rim = p.add("ring-rim", [1, 2], { voice: "Rim", tune: -2, level: 0.45 });
  p.cable(seq, "trig1", kick, "trig").cable(seq, "trig2", hat, "closed").cable(seq, "trig4", rim, "trig");
  const chord = p.add("chord-osc", [1, 3], { chord: "Minor 7", octave: "-1", voices: 4, detune: 9, stereo: 0.7, shape: 0.5 }, { name: "Chord" });
  const flt = p.add("filter", [2, 3], { cutoff: 700, resonance: 0.25, drive: 0.1, type: "Ladder Tanh" }, { name: "Stab Filter" });
  const env = p.add("adsr", [2, 4], { attack: 0.004, decay: 0.28, sustain: 0, release: 0.2 }, { name: "Stab Env" });
  const amp = p.add("vca", [3, 3], {}, { name: "Stab VCA" });
  p.cable(seq, "gate3", env, "gate").cable(p.cin, "cut", flt, "cutoff", 0.4).cable(env, "env", flt, "cutoff", 0.25)
    .stereo(chord, flt).stereo(flt, amp).cable(env, "env", amp, "gain");
  const mix = p.add("audio-mixer", [4, 1], { level1: -4, level2: -14, pan2: 0.25, level3: -9, send3: -3, send2: -22, level4: -18, pan4: -0.3,
    return: -5, master: -2 });
  p.cable(kick, "out", mix, "in1l").cable(hat, "out", mix, "in2l").stereo(amp, mix, { to: ["in3l", "in3r"] }).cable(rim, "out", mix, "in4l");
  const dly = p.add("delay-network", [5, 1], { sync: "1/8.", taps: 2, feedback: 0.6, scatter: 0.2, tone: -0.5, character: 0.35, width: 1, mix: 1, routing: "Ring" });
  const verb = p.add("reverb", [5, 2], { size: 0.8, decay: 6, damping: 0.5, mix: 0.35, quality: "Eco (8 lines)" });
  p.cable(p.cin, "dub", dly, "feedback", 0.2);
  p.cable(mix, "sendl", dly, "l").cable(mix, "sendr", dly, "r").stereo(dly, verb).stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Random sine pings that glide down, thrown into a dark echo: a submarine in the dark.
function sonarDeep() {
  const p = cell("Sonar Deep", {
    description: "Rare random sine pings that sweep downward, one high and one deep, thrown into a dark, scattered echo and a huge reverb: a submarine listening in the deep. Shared input Activity (more pings).",
    tags: ["generative", "sonar", "pings", "dark", "ambient", "echo"],
    help: "A Recall module on half notes makes sparse random gates in Chance mode. One starts a Sweep Generator that glides a " +
      "sine from 2.4 kHz down to 700 Hz in under half a second; the other starts a second generator for a deep, " +
      "slow ping from 280 Hz to 110 Hz. Both go into a dark Delay Network with scattered taps and a very long reverb.\n\n" +
      "Press play: it plays on its own from Out L/R. The Activity input is added to the gate bias of Recall: higher " +
      "means more pings. It follows the transport.\n\n" +
      "Tip: it works well as a background under slow pads: set Activity so you hear a ping every few seconds.",
  }).input("act", "Activity").stereoOut();
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.2, trecall: 0.3, tloop: 12, sync: "1/2", seed: 27, gatelength: 0.2 });
  p.cable(p.cin, "act", rc, "tbias", 0.3);
  const hi = p.add("sweep-generator", [1, 0], { mode: "Triggered", waveform: "Sine", start: 2400, stop: 700, time: 0.4, law: "Log", sweepsync: "Free",
    warmup: "Off", drift: 0, level: 0.6 }, { name: "High Ping" });
  const lo = p.add("sweep-generator", [1, 1], { mode: "Triggered", waveform: "Sine", start: 280, stop: 110, time: 1.5, law: "Log", sweepsync: "Free",
    warmup: "Off", drift: 0, level: 0.8 }, { name: "Deep Ping" });
  p.cable(rc, "t1", hi, "trigger").cable(rc, "t2", lo, "trigger");
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, pan1: -0.3, send1: -4, level2: -6, pan2: 0.3, send2: -6, return: -4, master: -2 });
  p.cable(hi, "out", mix, "in1l").cable(lo, "out", mix, "in2l");
  const dly = p.add("delay-network", [3, 1], { time: 0.9, taps: 4, feedback: 0.62, scatter: 0.4, jitter: 0.1, tone: -0.55, character: 0.3, width: 1, mix: 1, routing: "Mesh" });
  const verb = p.add("reverb", [4, 1], { size: 0.9, decay: 9, damping: 0.55, mix: 0.5, modDepth: 0.4, quality: "Eco (8 lines)" });
  p.cable(mix, "sendl", dly, "l").cable(mix, "sendr", dly, "r").stereo(dly, verb).stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A heartbeat shape breathes through a stack of low drone oscillators.
function heartbeatDrone() {
  const p = cell("Heartbeat Drone", {
    description: "A dark drone of two fifths and a minor third whose level and filter beat like a slow heart, once a half note, under a bed of dark noise and a long reverb. Shared inputs Cutoff and Depth (shallow to deep beat).",
    tags: ["generative", "drone", "heartbeat", "dark", "pulse", "ambient"],
    help: "Three low oscillators (a root, a fifth and a minor third) and a little dark noise go through a ladder filter and a VCA. " +
      "A looping Shape Env plays the Heartbeat shape once every half note: it opens the VCA and nudges the filter, so the drone " +
      "swells with two quick pulses and sinks back. A slow organic LFO moves the cutoff and a long reverb " +
      "sits around it.\n\n" +
      "Press play: it plays on its own from Out L/R. Cutoff is added to the filter cutoff, Depth is added to the " +
      "heartbeat depth: at zero the drone still breathes a little, higher it pulses deeply. It follows the transport.\n\n" +
      "Tip: automate Depth up slowly as a scene tightens.",
  }).input("cut", "Cutoff").input("depth", "Depth").stereoOut();
  const oscs = [["Root", "-2", 0, 0.12, 0], ["Fifth", "-2", 7, 0.18, 4], ["Third", "-1", 3, 0.3, -3]].map(([name, octave, coarse, shape, fine], i) =>
    p.add("oscillator", [0, i], { octave, coarse, shape, fine }, { name }));
  const breath = p.add("noise", [0, 3], { colour: -0.7, level: 1 }, { name: "Dark Noise" });
  const flt = p.add("filter", [1, 1], { cutoff: 240, resonance: 0.18, drive: 0.1, type: "Ladder Tanh" }, { name: "Drone Filter" });
  oscs.forEach((o, i) => { const amt = [0.5, 0.35, 0.18][i]; p.cable(o, "out", flt, "l", amt).cable(o, "out", flt, "r", amt); });
  p.cable(breath, "out", flt, "l", 0.1).cable(breath, "out", flt, "r", 0.1);
  const heart = p.add("shape-env", [1, 3], { shape: "Heartbeat", mode: "Loop", sync: "1/2" }, { name: "Heartbeat" });
  const depth = p.add("utility", [2, 3], { scalex: 0.65, offset: 0.35 }, { name: "Depth" });
  const drift = p.add("organic-lfos", [1, 4], { rate: 0.03, spread: 0.5, seed: 3 });
  const amp = p.add("vca", [2, 1], {}, { name: "Beat VCA" });
  p.cable(heart, "out", depth, "x").cable(p.cin, "depth", depth, "scalex", 0.15).cable(p.cin, "depth", depth, "offset", -0.15)
    .cable(p.cin, "cut", flt, "cutoff", 0.4).cable(heart, "out", flt, "cutoff", 0.1).cable(drift, "out1", flt, "cutoff", 0.08)
    .stereo(flt, amp).cable(depth, "out", amp, "gain");
  const verb = p.add("reverb", [3, 1], { size: 0.85, decay: 8, damping: 0.55, mix: 0.4, modDepth: 0.4, quality: "Eco (8 lines)" });
  const mix = p.add("audio-mixer", [4, 1], { level1: 0, master: -2 });
  p.stereo(amp, verb).stereo(verb, mix, { to: ["in1l", "in1r"] }).stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Three pulse-formant voices on an A minor triad, their vowels slowly morphing.
function vowelDriftChoir() {
  const p = cell("Vowel Drift Choir", {
    description: "Three pulse-formant voices on an A minor triad sing with vowels that drift independently and a faint wobble in the pitch, through chorus and a wide hall: a choir that never says the same word. Shared input Vowel.",
    tags: ["generative", "choir", "vowel", "formant", "pad", "evolving"],
    help: "Three Formant Osc voices (A, E and A an octave apart) make a bright pulse with a moving resonant peak, which " +
      "sounds like a sung vowel. Organic LFOs move each voice's formant independently and add a little pitch " +
      "wobble, so the vowels shift from ah to oh to ee in no pattern. The sum goes through a chorus and a wide hall.\n\n" +
      "Press play: it plays on its own from Out L/R and is not tied to the tempo. The Vowel input is added to the formant " +
      "of all three voices together: raise it to brighten the vowels, lower it to darken them.\n\n" +
      "Tip: automate Vowel with a slow LFO for a synchronised change of word across the choir.",
  }).input("vowel", "Vowel").stereoOut();
  const life = p.add("organic-lfos", [0, 1], { rate: 0.05, spread: 0.6, drift: 0.5, seed: 12 });
  const mix = p.add("audio-mixer", [3, 1], { level1: -9, pan1: -0.3, level2: -9, pan2: 0.3, level3: -10, pan3: 0, master: -4 });
  [[-1, -3, 1.4], [-1, 4, 2.2], [0, -3, 0.7]].forEach(([octave, coarse, formant], i) => {
    const fo = p.add("formant-osc", [1, i], { octave, coarse, formant, narrow: 0.35, body: 0.7, spread: 0.3 }, { name: `Voice ${i + 1}` });
    p.cable(life, `out${i + 1}`, fo, "formant", 0.18).cable(p.cin, "vowel", fo, "formant", 0.25)
      .cable(life, `out${i + 4}`, fo, "pitch", semis(0.15)).stereo(fo, mix, { from: ["outL", "outR"], to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const ch = p.add("chorus", [4, 1], { rate: 0.3, depth: 0.4, delay: 12, mix: 0.4 });
  const verb = p.add("reverb", [5, 1], { size: 0.8, decay: 6, damping: 0.45, modDepth: 0.35, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(mix, ch, { from: ["outl", "outr"] }).stereo(ch, verb).stereo(verb, p.cout);
  return p;
}

// A step-sequenced lullaby on a bright wooden bar that mutates a little each time round.
function windUpLullaby() {
  const p = cell("Wind-Up Lullaby", {
    description: "A sixteen-step G major lullaby on a bright struck bar with a low bell at the end of each round; Variation lets random steps wander, and a wobbly tape echo makes the whole box sound old. Shared input Variation.",
    tags: ["generative", "music box", "lullaby", "melodic", "tape", "mutating"],
    help: "A Step Sequencer plays sixteen steps in G major on eighth notes. Each note strikes a bright Modal Voice " +
      "tuned like a small wooden bar. At the end of each round a second voice, an octave lower, strikes a " +
      "soft bell. A Zone Delay with tape wobble gives the sound an old, drifting character.\n\n" +
      "Press play: it plays on its own from Out L/R. The Variation input is added to the sequencer's " +
      "Variation: at zero the lullaby is exactly the same every time, higher some steps jump by up to " +
      "seven semitones, so the tune mutates round by round. It follows the transport.\n\n" +
      "Tip: set the starting Variation on the sequencer a little above zero and let it run for a while.",
  }).input("var", "Variation").stereoOut();
  const seq = p.add("step-sequencer", [0, 1], { length: 16, rate: "1/8", gatelength: 0.5, variation: 0.08, varrange: 7, root: "G", scale: "Major", octave: 0, seed: 6 }, {
    data: stepsOf([7, 9, 11, 14, 11, 9, 7, ".", 4, 7, 9, 11, 9, 7, 4, "."]),
  });
  const bar = p.add("modal-voice", [1, 0], { strike: 1, strikeTimbre: 0.7, geometry: 0.3, brightness: 0.85, damping: 0.5, size: 0.12, position: 0.25, space: 0.15, partials: "16", seed: 6 }, { name: "Music Box" });
  const bell = p.add("modal-voice", [1, 1], { coarse: -12, strike: 1, strikeTimbre: 0.4, geometry: 0.7, brightness: 0.55, damping: 0.25, size: 0.3, space: 0.2, partials: "16", seed: 7 }, { name: "Low Bell" });
  p.cable(p.cin, "var", seq, "variation", 0.5)
    .cable(seq, "pitch", bar, "pitch").cable(seq, "trigger", bar, "strike")
    .cable(seq, "pitch", bell, "pitch").cable(seq, "end", bell, "strike");
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, pan1: -0.15, level2: -9, pan2: 0.15, master: -2 });
  p.stereo(bar, mix, { to: ["in1l", "in1r"] }).stereo(bell, mix, { to: ["in2l", "in2r"] });
  const tape = p.add("zone-delay", [3, 0], { zone: 3, time: 0.4, feedback: 0.4, character: 0.5, tone: -0.3, wobble: 0.5, mix: 0.3 });
  p.stereo(mix, tape, { from: ["outl", "outr"] }).stereo(tape, p.cout);
  return p;
}

// A pattern bank of four related rhythms plays four Ring drums; a slow random leafs through the bank.
function kitchenTableBeat() {
  const p = cell("Kitchen Table Beat", {
    description: "Four related rhythms from a Rhythm Bank play a kick, snare, hat and rim in a warm saturated mix, and every four bars a slow random leafs to a new groove. Shared inputs Pattern and Drive.",
    tags: ["generative", "drums", "groove", "lo-fi", "rhythm bank", "evolving"],
    help: "A Rhythm Bank in the Interlock family gives four rhythms that are related and avoid colliding with each other, " +
      "each patched to a Ring drum voice: kick, snare, closed hat and rim. A slow Random module changes the pattern " +
      "number every four bars, so the groove changes in steps, and the mix goes through a warm Saturator and a small room.\n\n" +
      "Press play: it plays on its own from Out L/R. The Pattern input is added to the pattern number: use it to " +
      "choose a different set of grooves; Drive is added to the saturator drive for more crunch. It follows the transport.\n\n" +
      "Tip: set the Random module's Loop higher to make the changes come back in a repeating sequence of four.",
  }).input("pat", "Pattern").input("drive", "Drive").stereoOut();
  const rb = p.add("rhythm-bank", [0, 1], { pattern: 37, family: "Interlock", length: "16", rate: "1/16", width: 0.3, complement: "Avoid", output: "Trigger" });
  const walk = p.add("random", [0, 0], { sync: "4 bars", length: "4 steps", spread: 1, loop: 0.5, seed: 30 }, { name: "Groove Change" });
  p.cable(walk, "out", rb, "pattern", 0.12).cable(p.cin, "pat", rb, "pattern", 0.3);
  const kick = p.add("ring-kick", [1, 0], { tune: 52, decay: 0.5, sweep: 0.3, tone: 0.3, level: 0.85 });
  const snare = p.add("ring-snare", [1, 1], { tune: 190, tone: 0.5, snappy: 0.5, decay: 0.2, level: 0.7 });
  const hat = p.add("ring-hats", [1, 2], { closed: 0.05, tone: 0.45, level: 0.55 });
  const rim = p.add("ring-rim", [1, 3], { voice: "Rim", level: 0.6 });
  p.cable(rb, "out1", kick, "trig").cable(rb, "out2", snare, "trig").cable(rb, "out3", hat, "closed").cable(rb, "out4", rim, "trig");
  const mix = p.add("audio-mixer", [2, 1], { level1: -3, level2: -6, pan2: 0.1, level3: -12, pan3: 0.3, level4: -10, pan4: -0.3,
    send2: -16, send4: -14, return: -8, master: -3 });
  p.cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hat, "out", mix, "in3l").cable(rim, "out", mix, "in4l");
  const room = p.add("reverb", [3, 2], { size: 0.3, decay: 1, damping: 0.5, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, room);
  const sat = p.add("saturator", [4, 1], { drive: 0.45, color: 0.2, sag: 0.4, level: 0.9 });
  p.cable(p.cin, "drive", sat, "drive", 0.3).stereo(mix, sat, { from: ["outl", "outr"] }).stereo(sat, p.cout);
  return p;
}

// Three bowed glass bodies that fade in and out on their own long loops, each fading in on a new note.
function bowedGlassTrio() {
  const p = cell("Bowed Glass Trio", {
    description: "Three bowed glass-plate voices whose bows start and stop on their own loops of 17, 23 and 31 seconds, each choosing a fresh D major pentatonic note whenever it starts: slow, singing, always-new chords. Shared input Bow (pressure).",
    tags: ["generative", "bowed", "glass", "ambient", "slow", "physical model"],
    help: "Three Modal Voices in a plate-like geometry are bowed continuously while their gate is high. Each gate is a free " +
      "LFO square with a loop length of 17, 23 or 31 seconds, so the bows overlap in changing ways. A Quantizer " +
      "Suite fed by slowly fluctuating curves from an Uncertainty module samples a new D major pentatonic " +
      "pitch each time a bow starts. The sum goes through a big reverb.\n\n" +
      "Press play: it plays on its own from Out L/R and is not tied to the tempo. The Bow input is added to the bow " +
      "pressure of all three voices: more pressure is louder and rougher, less is breathy and soft.\n\n" +
      "Tip: reduce the bow pressure for a ghostly, whistling sound.",
  }).input("bow", "Bow").stereoOut();
  const un = p.add("uncertainty", [0, 1], { f1rate: 0.19, f2rate: 0.27, f1spread: 0.7, f2spread: 0.7, seed: 4 });
  const loops = [17, 23, 31];
  const lfos = loops.map((secs, i) => p.add("lfo", [0, i + 2], { rate: 1 / secs, phase: i * 130, pw: 0.7, wave: "Square", polarity: "Unipolar" }, { name: `Loop ${i + 1}` }));
  const qs = p.add("quantizer-suite", [1, 1], {
    "a.mode": "Quantize", "a.root": "D", "a.scale": "Major Pentatonic", "a.sample": "Trigger", "a.octave": -1,
    "b.mode": "Quantize", "b.root": "D", "b.scale": "Major Pentatonic", "b.sample": "Trigger", "b.octave": 0,
    "c.mode": "Quantize", "c.root": "D", "c.scale": "Major Pentatonic", "c.sample": "Trigger", "c.octave": 0,
    "d.notes": false,
  });
  p.cable(un, "fluct1", qs, "ina").cable(un, "fluct2", qs, "inb").cable(un, "fluct2", qs, "inc")
    .cable(lfos[0], "out", qs, "triga").cable(lfos[1], "out", qs, "trigb").cable(lfos[2], "out", qs, "trigc");
  const mix = p.add("audio-mixer", [3, 1], { level1: -8, pan1: -0.5, level2: -8, pan2: 0.5, level3: -9, pan3: 0, master: -3 });
  ["outa", "outb", "outc"].forEach((pitch, i) => {
    const mv = p.add("modal-voice", [2, i], { bow: 0.55, bowTimbre: 0.5, strike: 0, geometry: 0.72, brightness: 0.6, damping: 0.15,
      position: 0.3 + i * 0.1, size: 0.4, space: 0.3, contour: 0.5, partials: "16", seed: 40 + i }, { name: `Glass ${i + 1}` });
    p.cable(qs, pitch, mv, "pitch").cable(lfos[i], "out", mv, "gate").cable(p.cin, "bow", mv, "bow", 0.3)
      .stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const verb = p.add("reverb", [4, 1], { size: 0.85, decay: 7, damping: 0.45, modDepth: 0.4, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(mix, verb, { from: ["outl", "outr"] }).stereo(verb, p.cout);
  return p;
}

export default category("Generative", "Self-playing patches: press play and they make music on their own, in time with the transport. Out L/R out.", [
  tinRoofRain, phaseClaves, colotomicCycle, dubTechnoFog, sonarDeep, heartbeatDrone, vowelDriftChoir, windUpLullaby,
  kitchenTableBeat, bowedGlassTrio,
]);
