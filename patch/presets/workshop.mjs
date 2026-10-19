// SPDX-License-Identifier: MIT
// Workshop: generative building blocks, timing tools and a few instruments, all plain cells made from the stock modules.
// Most of them are for patching (gates, triggers, pitches and notes in and out); the ones with Out L/R make sound by themselves
// or when played.
import { cell, voice, category, envelope, ampEnvelope, semis } from "./kit.mjs";

// ------------------------------------------------------------ local helpers

/// Gate Sequencer data: up to four 32-step tracks as strings. `.` off, `x` hit, `X` accent. `chance` is the step's probability (0..100).
function gateTracks(rows, chance = 100) {
  const step = (ch) => {
    const s = { on: 0, p: 100, l: 50, t: 0, r: 1, rs: 0, n: 0, c: [0, 0], v: 100 };
    if (ch === "x") Object.assign(s, { on: 1, v: 96, p: chance });
    else if (ch === "X") Object.assign(s, { on: 1, v: 124, p: chance });
    return s;
  };
  return { tracks: [0, 1, 2, 3].map((t) => ({ mute: false, steps: [...(rows[t] || "").padEnd(32, ".")].slice(0, 32).map(step) })) };
}

/// Stage Seq stages: [pitch, pulses, gate, opts]; gate is Rest/First/Every/Hold/Ratchet.
const STAGE_GATES = ["Rest", "First", "Every", "Hold", "Ratchet"];
function stageData(list) {
  return {
    stages: list.map(([p, n, g, o = {}]) => ({ p, n, g: STAGE_GATES.indexOf(g), r: o.r || 2, s: o.slide ? 1 : 0,
                                               v: o.v || 100, a: o.accent ? 1 : 0 })),
    randomize: { lanes: ["pitch", "pulses", "gate"], octaves: 1, maxPulses: 4, slide: 0.15, accent: 0.15 },
  };
}

/// Cartesian Seq grid: rows of cells (numbers = semitones, "." rest), 8 × 8, row-major.
function cartData(rows, vel = [112, 84, 96, 84]) {
  const cells = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const v = rows[r] ? rows[r][c] : undefined;
      const cv = { g: 0, p: 0, v: vel[c % vel.length], m: Math.round(-100 + ((r * 8 + c) * 200) / 63), a: 1 };
      if (typeof v === "number") Object.assign(cv, { g: 1, p: v });
      cells.push(cv);
    }
  return { cells, randomize: { density: 0.7, octaves: 1, skip: 0, velocity: [0.6, 1] } };
}

/// A Quantizer Suite whose channel A follows the board's key and scale (the Harmony Master on Bus A); without one it quantizes
/// to D Dorian. Channels B to D are left silent. `sample`: Continuous, Trigger or Track & Hold.
function boardScale(p, at, { sample = "Trigger", slew = 0, octave = 0 } = {}) {
  return p.add("quantizer-suite", at, {
    "a.mode": "Follow", "a.target": "Scale", "a.harmony": "Bus A", "a.root": "D", "a.scale": "Dorian",
    "a.sample": sample, "a.octave": octave, "a.slew": slew, "a.notes": true,
    "b.notes": false, "c.notes": false, "d.notes": false, hysteresis: 0.15,
  }, { name: "Board Scale" });
}

/// The mixer's send → an effect (set to 100 % wet) → the mixer's return.
function sendReturn(p, mix, fx) {
  p.cable(mix, "sendl", fx, "l").cable(mix, "sendr", fx, "r")
    .cable(fx, "l", mix, "returnl").cable(fx, "r", mix, "returnr");
}

// ------------------------------------------------------------ the cells

// Four sine operators in a small routing matrix: each modulator's depth is its own envelope times a shared Index.
function fourVoiceFm() {
  const p = voice("Four-Voice FM", {
    description: "Four sine operators with their own envelopes: two carriers and two modulators wired in a small matrix, so one key plays a bell, an electric piano or a growl. Shared inputs Index (all modulation depth) and Detune (beating between the carriers).",
    tags: ["fm", "operators", "matrix", "bell", "keys"],
    help: "Operator D (three times the pitch) modulates operator C and, a little, carrier B; operator C (twice the pitch) " +
      "modulates carrier A and, less, carrier B. A and B are the sounds you hear: A is the body at the played pitch, B is an octave up. " +
      "Each of the four has its own ADSR, so the carriers set the loudness shape and the modulators set how the tone " +
      "changes over time. A Multiplier turns each modulator's envelope times the Index input into the depth of its send VCA, " +
      "so a loud, bright attack that fades to a pure tone comes from short modulator decays.\n\n" +
      "Notes in, Out L/R. Index is added to the modulation depth: raise it for a harsher, more metallic sound. Detune moves " +
      "carrier B off the octave by up to a semitone, for slow beating.\n\n" +
      "Tip: open the cell and change the cable amounts from the send VCAs into the oscillators' FM jacks: they are the routing matrix.",
  }).settings({ voices: 6, mode: "Poly", spread: 0.3 }).input("index", "Index").input("detune", "Detune");
  const A = p.add("oscillator", [0, 0], { octave: "0", fm: 0.4 }, { name: "Op A" });
  const B = p.add("oscillator", [0, 1], { octave: "+1", fm: 0.4, fine: 3 }, { name: "Op B" });
  const C = p.add("oscillator", [0, 2], { octave: "+1", fm: 0.35 }, { name: "Op C" });
  const D = p.add("oscillator", [0, 3], { octave: "+1", coarse: 7.02, fm: 0.2 }, { name: "Op D" });
  const eA = envelope(p, [1, 0], { attack: 0.003, decay: 1.1, sustain: 0.45, release: 0.5, velamount: 0.4 }, "Env A");
  const eB = envelope(p, [1, 1], { attack: 0.004, decay: 0.6, sustain: 0.25, release: 0.3, velamount: 0.4 }, "Env B");
  const eC = envelope(p, [1, 2], { attack: 0.002, decay: 0.45, sustain: 0.2, release: 0.25, velamount: 0.7 }, "Env C");
  const eD = envelope(p, [1, 3], { attack: 0.001, decay: 0.18, sustain: 0.05, release: 0.12, velamount: 0.7 }, "Env D");
  const mult = p.add("multiplier", [2, 2], { biasx1: 0.55, biasx2: 0.45, gain1: 1.2, gain2: 1.4 }, { name: "Index × Env" });
  const vA = p.add("vca", [2, 0], {}, { name: "Out A" });
  const vB = p.add("vca", [2, 1], {}, { name: "Out B" });
  const vC = p.add("vca", [3, 2], {}, { name: "Send C" });
  const vD = p.add("vca", [3, 3], {}, { name: "Send D" });
  for (const o of [A, B, C, D]) p.cable(p.vin, "pitch", o, "pitch");
  p.cable(p.cin, "detune", B, "pitch", semis(1));
  p.cable(p.cin, "index", mult, "x1", 0.45).cable(eC, "env", mult, "y1").cable(mult, "out1", vC, "gain")
    .cable(p.cin, "index", mult, "x2", 0.45).cable(eD, "env", mult, "y2").cable(mult, "out2", vD, "gain");
  p.cable(D, "sine", vD, "l").cable(vD, "l", C, "fm").cable(vD, "l", B, "fm", 0.5)
    .cable(C, "sine", vC, "l").cable(vC, "l", A, "fm").cable(vC, "l", B, "fm", 0.4);
  p.cable(A, "sine", vA, "l").cable(eA, "env", vA, "gain")
    .cable(B, "sine", vB, "l").cable(eB, "env", vB, "gain");
  p.cable(vA, "l", p.vout, "l", 0.6).cable(vA, "l", p.vout, "r", 0.35)
    .cable(vB, "l", p.vout, "l", 0.3).cable(vB, "l", p.vout, "r", 0.5)
    .cable(eA, "active", p.vout, "active");
  return p;
}

// A delayed copy of any gate with random timing, plus matching velocity and pitch wobble.
function looseTime() {
  const p = cell("Loose Time", {
    description: "Humanises a gate and note stream: every gate comes out a few milliseconds early or late by a random amount, with a matching random velocity and a tiny random pitch wobble. Shared input Loose (from stiff to sloppy).",
    tags: ["humanise", "timing", "random", "gate", "utility"],
    help: "A Pulse Generator in External Width mode is a gate delay line: each gate edge comes out after the Delay, the " +
      "pulse as long as the gate was. Three seeded Randoms, all clocked by the incoming gate, draw a new value per note; " +
      "Multipliers scale them by the Loose input before they nudge the delay time, the velocity and the pitch.\n\n" +
      "Patch a gate, and optionally its pitch, into the matching inputs and take Gate, Velocity and Pitch out. Every gate " +
      "is delayed by about ten milliseconds on average (the price of being able to also play early), so patch the " +
      "unmodified gate of other parts through a plain cable if you need them to stay locked. With nothing in Loose the cell " +
      "stays a little loose by itself; Loose adds to that.\n\n" +
      "Tip: put it only on the hats and the lead, leaving the kick and bass stiff.",
  }).input("gate", "Gate", "gate").input("pitch", "Pitch", "pitch").input("loose", "Loose")
    .output("gout", "Gate", "gate").output("vel", "Velocity").output("pout", "Pitch", "pitch");
  const rt = p.add("random", [0, 0], { sync: "1/4", spread: 1, seed: 11 }, { name: "Timing Draw" });
  const rv = p.add("random", [0, 1], { sync: "1/4", spread: 1, seed: 29 }, { name: "Velocity Draw" });
  const rp = p.add("random", [0, 2], { sync: "1/4", spread: 1, seed: 53 }, { name: "Pitch Draw" });
  const m1 = p.add("multiplier", [1, 0], { biasy1: 0.35, biasy2: 0.35 }, { name: "Timing × Loose" });
  const m2 = p.add("multiplier", [1, 1], { biasy1: 0.35 }, { name: "Velocity × Loose" });
  const m3 = p.add("multiplier", [1, 2], { biasy1: 0.35 }, { name: "Pitch × Loose" });
  const pg = p.add("pulse-generator", [2, 0], { mode: "External Width", delay: 0.01, width: 0.02 }, { name: "Gate Delay" });
  const velScale = p.add("attenuverter", [2, 1], { scale1: 0.28, offset1: 0.72, clip: "Hard" }, { name: "Velocity Range" });
  const pitchSum = p.add("attenuverter", [2, 2], { scale1: 1, scale2: 0.012 }, { name: "Pitch + Wobble" });
  for (const r of [rt, rv, rp]) p.cable(p.cin, "gate", r, "clock");
  p.cable(rt, "out", m1, "x1").cable(p.cin, "loose", m1, "y1", 0.65).cable(m1, "out1", pg, "delay", 0.1)
    .cable(p.cin, "gate", pg, "gate").cable(pg, "gate", p.cout, "gout");
  p.cable(rv, "out", m2, "x1").cable(p.cin, "loose", m2, "y1", 0.65).cable(m2, "out1", velScale, "in1").cable(velScale, "out1", p.cout, "vel");
  p.cable(rp, "out", m3, "x1").cable(p.cin, "loose", m3, "y1", 0.65).cable(m3, "out1", pitchSum, "in2")
    .cable(p.cin, "pitch", pitchSum, "in1").cable(pitchSum, "sum", p.cout, "pout");
  return p;
}

// Eight segments that fall, bounce back a little lower and fall again.
function reboundEnvelope() {
  const p = cell("Rebound Envelope", {
    description: "An envelope that bounces: a hit falls to zero, springs back up to 60 %, falls, springs to 36 % and so on, each bounce shorter and softer. A gate restarts it. Shared inputs Bounce (time scale) and Velocity.",
    tags: ["envelope", "bounce", "decay", "percussion", "modulator"],
    help: "A Segments module set to eight segments in Free run: a fast rise to full, a fall to zero, then rises to 60, 36 and " +
      "20 percent, each followed by a shorter fall. Every segment's time is a share of the one before it, so the bounces " +
      "come faster and quieter, like a ball settling. A rising gate restarts the whole thing from the top.\n\n" +
      "Patch a gate into Gate and take Env out into a VCA, a filter or a pitch. Hits is a gate that goes high at each " +
      "landing, handy to fire a click or a second voice on every bounce. Bounce is added to the time scale (the whole " +
      "bounce gets longer) and Velocity scales the height of the first fall.\n\n" +
      "Tip: Env into the pitch of a drum voice makes a rolling, bouncing tom.",
  }).input("gate", "Gate", "gate").input("bounce", "Bounce").input("velocity", "Velocity")
    .output("env", "Env").output("inv", "Inverse").output("hits", "Hits", "gate").output("done", "Done", "trigger");
  const seg = p.add("segments", [1, 0], {
    count: 8, run: "Free", release: "Finish", velamount: 0.5,
    time1: 0.004, level1: 1, shape1: 0,
    time2: 0.26, level2: 0, shape2: 0.5,
    time3: 0.02, level3: 0.6, shape3: -0.3,
    time4: 0.17, level4: 0, shape4: 0.5,
    time5: 0.014, level5: 0.36, shape5: -0.3,
    time6: 0.11, level6: 0, shape6: 0.5,
    time7: 0.01, level7: 0.2, shape7: -0.3,
    time8: 0.07, level8: 0, shape8: 0.5,
  });
  const hits = p.add("logic", [2, 1], {}, { name: "Landings" });
  p.cable(p.cin, "gate", seg, "gate").cable(p.cin, "velocity", seg, "velocity").cable(p.cin, "bounce", seg, "timescale", 0.3)
    .cable(seg, "out", p.cout, "env").cable(seg, "inv", p.cout, "inv").cable(seg, "end", p.cout, "done")
    .cable(seg, "seg2", hits, "a").cable(seg, "seg4", hits, "b").cable(seg, "seg6", hits, "c").cable(hits, "or", p.cout, "hits");
  return p;
}

// Two oscillators, each with an undertone, ticking out prime-number and Fibonacci rhythms against a steady drone.
function undertonePair() {
  const p = cell("Undertone Pair", {
    description: "Two oscillators a fifth apart, each with its own octave-down undertone, struck by two rotating dividers: one counts in primes, the other in Fibonacci numbers, so the rhythms drift in and out of step above a steady drone. Shared inputs Pitch, Drone, Rotate and Detune.",
    tags: ["drone", "rhythm", "subharmonic", "polyrhythm", "generative"],
    help: "Oscillator A and its undertone are played by the divisions of a Rotating Divider on the prime numbers (every 2nd, 3rd, " +
      "5th and 7th eighth note); oscillator B, a fifth up, and its undertone by a second one on Fibonacci numbers over quarter " +
      "notes. Each note is a short plucked envelope, panned apart; underneath, the two oscillators also sound softly all the " +
      "time as a drone, so the rhythm always sits on a chord.\n\n" +
      "Press play: it sounds on its own from Out L/R and follows the transport. Pitch moves the whole pair (1 V per octave). " +
      "Drone is added to the level of the steady drone. Rotate shifts both dividers along their number sets at the next " +
      "step, which changes every rhythm at once. Detune pulls oscillator B off the fifth.\n\n" +
      "Tip: automate Rotate one step per bar for a slow shuffle of the polyrhythm.",
  }).input("pitch", "Pitch", "pitch").input("drone", "Drone").input("rotate", "Rotate").input("detune", "Detune").stereoOut();
  const oA = p.add("oscillator", [0, 0], { shape: 0.4, octave: "-1" }, { name: "Osc A" });
  const oB = p.add("oscillator", [0, 1], { shape: 0.4, octave: "-1", coarse: 7, fine: 2 }, { name: "Osc B" });
  const rdA = p.add("rotating-divider", [0, 2], { set: "Primes", base: "1/8", output: "Gate", sync: "Next Step", width: 0.3 }, { name: "Prime Rhythm" });
  const rdB = p.add("rotating-divider", [0, 3], { set: "Fibonacci", base: "1/4", output: "Gate", sync: "Next Step", width: 0.3 }, { name: "Fibonacci Rhythm" });
  const voices = [  // source, jack, rhythm, output, decay, level, mixer channel
    [oA, "out", rdA, "out2", 0.5, 0.8, 1], [oA, "sub", rdA, "out1", 0.9, 0.9, 1],
    [oB, "out", rdB, "out3", 0.4, 0.7, 2], [oB, "sub", rdB, "out1", 0.8, 0.9, 2],
  ];
  const mix = p.add("audio-mixer", [4, 1], { level1: -4, pan1: -0.5, level2: -4, pan2: 0.5, level3: -9, pan3: 0, send1: -16, send2: -16, send3: -18, return: -6, master: -2 });
  voices.forEach(([src, jack, rd, out, decay, level, ch], i) => {
    const env = p.add("adsr", [1, i], { attack: 0.004, decay, sustain: 0, release: 0.2, velamount: 0 }, { name: `Strike ${i + 1}` });
    const amp = p.add("vca", [2, i], {}, { name: `Voice ${i + 1}` });
    p.cable(rd, out, env, "gate").cable(src, jack, amp, "l", level).cable(env, "env", amp, "gain")
      .cable(amp, "l", mix, `in${ch}l`, 0.8).cable(amp, "l", mix, `in${ch}r`, 0.8);
  });
  const dA = p.add("vca", [3, 2], { gain: 0.14 }, { name: "Drone A" });
  const dB = p.add("vca", [3, 3], { gain: 0.14 }, { name: "Drone B" });
  p.cable(oA, "sub", dA, "l").cable(oA, "out", dA, "l", 0.4).cable(oB, "sub", dB, "l").cable(oB, "out", dB, "l", 0.4)
    .cable(p.cin, "drone", dA, "gain", 0.25).cable(p.cin, "drone", dB, "gain", 0.25)
    .cable(dA, "l", mix, "in3l", 0.7).cable(dB, "l", mix, "in3r", 0.7);
  p.cable(p.cin, "pitch", oA, "pitch").cable(p.cin, "pitch", oB, "pitch").cable(p.cin, "detune", oB, "pitch", semis(0.5))
    .cable(p.cin, "rotate", rdA, "rotate", 0.2).cable(p.cin, "rotate", rdB, "rotate", 0.2);
  const room = p.add("reverb", [5, 2], { size: 0.5, decay: 2.5, damping: 0.5, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, room);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Noise bursts, a band filter and a function envelope, with a rattle spacing knob and a jingle layer.
function shakerBox() {
  const p = cell("Shaker Box", {
    description: "A shaker, maraca or tambourine for one trigger: a quick rattle of noise bursts through a band filter, with an optional layer of metal jingles. Shared inputs Trigger and Accent (velocity), plus Body (filter colour) and Rattle (spacing between the bursts).",
    tags: ["percussion", "shaker", "maraca", "tambourine", "noise"],
    help: "A trigger starts a Pulse Generator burst of three pulses a few milliseconds apart; each pulse fires a Function envelope " +
      "that opens a VCA on filtered noise, so one hit is a little rattle rather than a single click. A Perc Voice in Noise Bank " +
      "mode adds the jingles of a tambourine on the first pulse. Accent lifts the loudness of the whole hit and Body moves the " +
      "centre of the band filter from a dull seed to a bright, papery shake.\n\n" +
      "Play it from MIDI (any note triggers it, velocity is the accent) or patch a trigger into Trigger. Rattle is added to the " +
      "spacing of the bursts: low is a tight flam, high a loose scatter.\n\n" +
      "Tip: put it on eighth notes with Accent from a slow LFO for a steady, breathing shake.",
  }).input("trig", "Trigger", "trigger").input("velocity", "Accent").input("body", "Body").input("rattle", "Rattle").stereoOut();
  const burst = p.add("pulse-generator", [0, 0], { mode: "Triggered", burst: 3, period: 0.03, width: 0.004 }, { name: "Rattle" });
  const env = p.add("function", [1, 0], { rise: 0.003, fall: 0.07, cycle: false, shape: 0.2 }, { name: "Burst Env" });
  const accent = p.add("multiplier", [1, 1], { biasy1: 0.6, gain1: 1 }, { name: "Accent" });
  const noise = p.add("noise", [0, 1], { colour: 0.5 });
  const flt = p.add("filter", [2, 0], { type: "SVF Multimode", mode: "BP", cutoff: 6200, resonance: 0.3 }, { name: "Shake Band" });
  const amp = p.add("vca", [3, 0], {}, { name: "Shake VCA" });
  const jing = p.add("perc-voice", [2, 1], { engine: "Noise Bank", pitch: 3800, tone: 0.85, click: 0.2, decay: 0.2, damp: 0.3, spread: 0.6, level: 0.3 }, { name: "Jingles" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -3, pan1: -0.15, level2: -9, pan2: 0.2, send1: -22, send2: -18, return: -8, master: 0 });
  p.cable(p.cin, "trig", burst, "trigger").cable(p.cin, "rattle", burst, "period", 0.25)
    .cable(burst, "gate", env, "trig")
    .cable(env, "a", accent, "x1").cable(p.cin, "velocity", accent, "y1", 0.4).cable(accent, "out1", amp, "gain")
    .cable(noise, "out", flt, "l").cable(p.cin, "body", flt, "cutoff", 0.3).cable(env, "a", flt, "cutoff", 0.12)
    .cable(flt, "l", amp, "l")
    .cable(amp, "l", mix, "in1l").cable(amp, "l", mix, "in1r", 0.8)
    .cable(p.cin, "trig", jing, "trig").cable(p.cin, "velocity", jing, "accent", 0.8)
    .stereo(jing, mix, { to: ["in2l", "in2r"] });
  const room = p.add("reverb", [5, 1], { size: 0.25, decay: 0.9, damping: 0.6, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, room);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// A track-and-hold, a gate counter that fires every fourth gate, and a second hold that samples only then.
function holdAndCount() {
  const p = cell("Hold & Count", {
    description: "Samples a signal on every gate and counts the gates: Held follows each gate, Held on Nth keeps only every fourth reading, and Nth is a trigger on every fourth gate. Reset restarts the count. Shared inputs Signal, Gate and Reset.",
    tags: ["sample and hold", "counter", "gate", "random", "utility"],
    help: "Two sample-and-holds read the Signal input: one on every incoming gate (with a hair of slew so steps don't click), " +
      "one only when the counter wraps. A Switch with four positions is the counter: each gate steps it, Count is its " +
      "position as a rising voltage, and Nth is the trigger it fires on the wrap, after four gates. A trigger into Reset " +
      "puts the count back to the start.\n\n" +
      "Patch a noise or random voltage into Signal and a clock into Gate: Held makes a stepped random melody on every note, " +
      "Held on Nth a slower one that changes only once per four, and Nth can restart a phrase or fire an accent. " +
      "Open the cell and set the Switch's Length (2 to 8) to count to another number.\n\n" +
      "Tip: Held on Nth into the pitch of a bass and Held into a lead gives a lead that wanders and a bass that stays put.",
  }).input("in", "Signal").input("gate", "Gate", "gate").input("reset", "Reset", "trigger")
    .output("held", "Held").output("heldn", "Held on Nth").output("nth", "Nth", "trigger").output("count", "Count");
  const sh = p.add("utility", [1, 0], { mode: "Sample & Hold", slew: 0.004 }, { name: "Hold Each" });
  const shn = p.add("utility", [1, 1], { mode: "Sample & Hold", slew: 0.004 }, { name: "Hold Nth" });
  const ctr = p.add("switch", [1, 2], { length: 4, order: "Forward" }, { name: "Counter" });
  p.cable(p.cin, "in", sh, "x").cable(p.cin, "gate", sh, "clock").cable(sh, "out", p.cout, "held")
    .cable(p.cin, "in", shn, "x").cable(ctr, "end", shn, "clock").cable(shn, "out", p.cout, "heldn")
    .cable(p.cin, "gate", ctr, "step").cable(p.cin, "reset", ctr, "reset")
    .cable(ctr, "end", p.cout, "nth").cable(ctr, "position", p.cout, "count");
  return p;
}

// Every second clock stays put, the others arrive late by an amount you choose.
function lateBeat() {
  const p = cell("Late Beat", {
    description: "A swing and shuffle processor for a sixteenth-note clock: the on-beats pass straight through and the off-beats arrive late by the Swing amount. Outputs the swung clock, the on-beats and the late off-beats separately. Shared inputs Swing and Reset.",
    tags: ["swing", "shuffle", "clock", "groove", "timing"],
    help: "A two-step Gate Sequencer splits the clock into odd sixteenths (On) and even sixteenths (Off). The Off steps go through " +
      "a Pulse Generator in Triggered mode, locked to an eighth-note period, whose Delay is measured in percent of that period. " +
      "Swing is added to the delay: zero is straight, a third of the way is a triplet shuffle, all the way is a hard dotted feel. " +
      "A Logic OR puts both back into one clock.\n\n" +
      "Leave Clock empty to follow the transport, or patch a sixteenth-note clock. Take Swung into a sequencer or drum machine's " +
      "Clock; On and Late go to different drums to swing only some of them (the hats late, the kick straight). A trigger into " +
      "Reset restarts the pair on a downbeat.\n\n" +
      "Tip: patch a slow LFO into Swing so the groove breathes over a few bars.",
  }).input("swing", "Swing").input("reset", "Reset", "trigger")
    .output("swung", "Swung", "gate").output("on", "On", "trigger").output("late", "Late", "gate");
  const split = p.add("gate-sequencer", [1, 0], { length1: 2, length2: 2, rate1: "1/16", rate2: "1/16", dice: "Fixed" }, {
    name: "On / Off Split", data: gateTracks(["x.", ".x"]),
  });
  const delay = p.add("pulse-generator", [2, 1], { mode: "Triggered", sync: "1/8", units: "% of Period", delaypct: 0.08, widthpct: 0.25 }, { name: "Late Off-beats" });
  const join = p.add("logic", [3, 0], {}, { name: "Back Together" });
  p.cable(p.cin, "reset", split, "reset").cable(p.cin, "swing", delay, "delaypct", 0.3)
    .cable(split, "trig2", delay, "trigger").cable(split, "trig1", join, "a").cable(delay, "gate", join, "b")
    .cable(join, "or", p.cout, "swung").cable(split, "trig1", p.cout, "on").cable(delay, "gate", p.cout, "late");
  return p;
}

// Two LFOs a golden ratio apart walk a grid of notes that snap to the board's scale.
function lissaWalk() {
  const p = cell("Lissa Walk", {
    description: "Two slow triangle LFOs whose rates are in the golden ratio steer a crosshair over an 8 × 8 grid of notes, so the path never exactly repeats, and every note snaps to the board's key and scale. Shared inputs Speed, Drift and Transpose.",
    tags: ["generative", "lissajous", "cartesian", "melody", "sequencer"],
    help: "A Cartesian Seq in Cartesian mode with Sample on Change plays a note as soon as the crosshair moves into a new cell. " +
      "X and Y come from two triangle LFOs at 0.073 and 0.118 Hz, a ratio of about 1.618, which is as far from a repeat as two " +
      "frequencies can be: the figure keeps slowly changing. A Quantizer Suite set to follow the Harmony Master's scale " +
      "(Bus A) then snaps every note; without a Harmony Master on the board it uses D Dorian.\n\n" +
      "Patch Notes into a Voice Cell. Speed is added to both LFO rates, Drift adds only to the second one and so bends the " +
      "figure, Transpose moves the whole melody. Mod and X carry the value of the grid cell and the first LFO, for filter or " +
      "pan movements that follow the melody.\n\n" +
      "Tip: put a Harmony Master on the board and change its chord or scale: the walk follows it.",
  }).input("speed", "Speed").input("drift", "Drift").input("tr", "Transpose", "pitch")
    .output("notes", "Notes", "notes").output("pitch", "Pitch", "pitch").output("gate", "Gate", "gate").output("mod", "Mod").output("x", "X", "control");
  const lx = p.add("lfo", [0, 0], { rate: 0.0731, wave: "Triangle", polarity: "Unipolar" }, { name: "X Walk" });
  const ly = p.add("lfo", [0, 1], { rate: 0.1183, wave: "Triangle", polarity: "Unipolar", phase: 90 }, { name: "Y Walk" });
  // A deterministic scatter of scale-ish offsets, a few rests.
  const pool = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
  const rows = [];
  for (let r = 0; r < 8; r++) {
    rows.push([]);
    for (let c = 0; c < 8; c++) rows[r].push((r * 3 + c * 5 + ((r * c) % 3)) % 11 === 0 ? "." : pool[(r * 3 + c * 5 + ((r * c) % 3)) % pool.length]);
  }
  const grid = p.add("cartesian-sequencer", [1, 0], { mode: "Cartesian", sample: "Change", columns: 8, rows: 8, gatelength: 0.8,
                                                     root: "D", scale: "Chromatic", octave: -1, modslew: 0.2 }, { data: cartData(rows) });
  const snap = boardScale(p, [2, 0], { sample: "Trigger" });
  p.cable(lx, "out", grid, "x").cable(ly, "out", grid, "y")
    .cable(p.cin, "speed", lx, "rate", 0.2).cable(p.cin, "speed", ly, "rate", 0.2).cable(p.cin, "drift", ly, "rate", 0.1)
    .cable(p.cin, "tr", grid, "transpose")
    .cable(grid, "pitch", snap, "ina").cable(grid, "trigger", snap, "triga")
    .cable(snap, "notes", p.cout, "notes").cable(snap, "outa", p.cout, "pitch").cable(grid, "gate", p.cout, "gate")
    .cable(grid, "mod", p.cout, "mod").cable(lx, "out", p.cout, "x");
  return p;
}

// A stage sequencer in its random-walk mode: the next stage is one up or one down, never a jump.
function drunkWalk() {
  const p = cell("Drunk Walk", {
    description: "A melody that stumbles: each step moves one stage up or down a ladder of eight notes, never leaping and never leaving the ladder, with a gate pattern of held, repeated and resting stages. Shared inputs Forget (random drop-outs), Hold (freeze) and Transpose.",
    tags: ["generative", "random walk", "melody", "gate", "sequencer"],
    help: "A Stage Seq in Brownian mode over eight stages of a minor pentatonic ladder: after every stage it takes one step up or " +
      "down at random, bouncing off both ends, so the line moves in small steps. Each stage has its own gate mode (a single pulse, " +
      "a ratchet, a long hold or a rest) and a Quantizer Suite makes every note follow the board's key and scale. A Coin Toss " +
      "on the gate then drops some notes at random.\n\n" +
      "Patch Notes into a Voice Cell, or Pitch and Gate into your own voice. Forget lowers the chance that a gate gets " +
      "through, up to a very sparse line. A gate into Hold freezes the walk on its current stage, Transpose moves it. Accent " +
      "is high on the stages marked as accents. It follows the transport unless you patch Clock.\n\n" +
      "Tip: hold the walk on a stage for a bar while the rest of the music changes, then let it go.",
  }).input("forget", "Forget").input("hold", "Hold", "gate").input("tr", "Transpose", "pitch")
    .output("notes", "Notes", "notes").output("pitch", "Pitch", "pitch").output("gate", "Gate", "gate")
    .output("accent", "Accent", "gate").output("stage", "Stage");
  const seq = p.add("stage-sequencer", [1, 0], { stages: 8, rate: "1/8", mode: "Brownian", gatelength: 0.6, root: "D", scale: "Minor Pentatonic", octave: 0 }, {
    data: stageData([
      [0, 1, "Every"], [3, 2, "Every"], [5, 1, "Ratchet", { r: 2 }], [7, 1, "Every", { accent: true }],
      [10, 3, "Hold"], [12, 1, "Every"], [15, 2, "First", { accent: true }], [17, 1, "Rest"],
    ]),
  });
  const drop = p.add("coin-toss", [2, 1], { prob1: 0.9, link: "Independent", seed: 17 }, { name: "Forget" });
  const snap = boardScale(p, [2, 0], { sample: "Continuous" });
  p.cable(p.cin, "hold", seq, "hold").cable(p.cin, "tr", seq, "transpose")
    .cable(seq, "gate", drop, "in1").cable(p.cin, "forget", drop, "prob1", -0.85)
    .cable(seq, "pitch", snap, "ina").cable(seq, "trigger", snap, "triga")
    .cable(snap, "notes", p.cout, "notes").cable(snap, "outa", p.cout, "pitch").cable(drop, "a1", p.cout, "gate")
    .cable(seq, "accentgate", p.cout, "accent").cable(seq, "stage", p.cout, "stage");
  return p;
}

// An accumulator: add a little to the running total at every step and fold it back when it gets too big.
function runningTotal() {
  const p = cell("Running Total", {
    description: "A melody from arithmetic: at every step a small amount is added to a running total, which folds back when it passes the top and the bottom. The total goes through a scale quantizer, so it sounds as a pattern that circles and slowly drifts. Shared inputs Add (the amount) and Transpose.",
    tags: ["generative", "accumulator", "melody", "math", "sequencer"],
    help: "A step clock (the sixteenth-note transport, or your own Clock) samples a loop: the held total plus the Add amount " +
      "goes through the Utility's Fold, which bounces it back between minus one and plus one, and becomes the new total. " +
      "Small amounts give long smooth sweeps, amounts close to a simple fraction like a quarter or a third give short " +
      "repeating patterns, and amounts that aren't give a line that keeps moving. A Quantizer Suite following the board's " +
      "scale turns the total into notes.\n\n" +
      "Patch Notes into a Voice Cell, or Pitch and Gate into your own. Add is added to the amount, so a dial turns the " +
      "pattern from a pedal tone through arpeggios to a wandering line; Total is the raw voltage for modulation.\n\n" +
      "Tip: set Add so 1 ÷ Add is nearly a whole number for a pattern that almost repeats and then slips.",
  }).input("add", "Add").output("notes", "Notes", "notes").output("pitch", "Pitch", "pitch").output("gate", "Gate", "gate").output("total", "Total");
  const clk = p.add("clock-divider", [0, 0], { div1: 1, base: "1/16", output: "Trigger", gatelength: "Base Step" }, { name: "Step Clock" });
  const hold = p.add("utility", [1, 0], { mode: "Sample & Hold" }, { name: "Total" });
  const sum = p.add("attenuverter", [1, 1], { scale1: 1, offset1: 0.29, scale2: 0.5 }, { name: "Add Amount" });
  const fold = p.add("utility", [2, 1], { mode: "Fold" }, { name: "Fold Back" });
  const snap = boardScale(p, [3, 0], { sample: "Trigger" });
  p.cable(clk, "out1", hold, "clock").cable(fold, "out", hold, "x").cable(hold, "out", sum, "in1")
    .cable(p.cin, "add", sum, "in2").cable(sum, "sum", fold, "x")
    .cable(hold, "out", snap, "ina", 0.8).cable(clk, "out1", snap, "triga")
    .cable(snap, "notes", p.cout, "notes").cable(snap, "outa", p.cout, "pitch").cable(clk, "out1", p.cout, "gate").cable(hold, "out", p.cout, "total");
  return p;
}

// A bass line that rewrites itself a little with every pass, with accents and slides.
function bassMaker() {
  const p = cell("Bass Maker", {
    description: "A self-writing bass: a sixteen-step line in E minor that Mutate rewrites more and more, snapped to the board's scale, through a growling ladder voice where strong steps are accents and tied steps slide. Shared inputs Mutate, Cutoff, Slide and Transpose.",
    tags: ["generative", "bass", "acid", "sequencer", "accent"],
    help: "A Step Sequencer with ties, rests and accents plays a Quantizer Suite (following the board's scale; E Dorian without a " +
      "Harmony Master) that glides between notes, into an oscillator with its sub, a ladder filter and an ADSR. The step's " +
      "velocity is the accent: loud steps open the filter and the amplitude further. Mutate is added to the sequencer's Variation, " +
      "so at zero the line repeats exactly and higher values randomly shift steps by up to an octave.\n\n" +
      "Press play: it sounds on its own from Out L/R and follows the transport. Cutoff opens the filter, Slide is added to the " +
      "glide time, Transpose moves the line.\n\n" +
      "Tip: ride Mutate up over eight bars, then pull it back to zero to keep the pattern you like.",
  }).input("mutate", "Mutate").input("cut", "Cutoff").input("slide", "Slide").input("tr", "Transpose", "pitch").stereoOut();
  // Notes are steps above E in the scale: root, fifth, octave and friends; "_" ties.
  const pattern = [0, ".", 0, 12, ".", 7, "_", 10, 0, ".", 5, 0, 12, ".", 7, 3];
  const vel = [127, 70, 90, 110, 70, 96, 70, 120, 100, 70, 84, 96, 127, 70, 90, 80];
  const data = (() => {
    const out = pattern.map((n, i) => {
      if (n === ".") return { g: 0, p: 0, v: vel[i] };
      if (n === "_") return { g: 2, p: 0, v: vel[i] };
      return { g: 1, p: n, v: vel[i] };
    });
    for (let i = 1; i < out.length; i++) if (out[i].g === 2) out[i].p = out[i - 1].p;
    while (out.length < 32) out.push({ g: 0, p: 0, v: 100 });
    return { steps: out };
  })();
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", gatelength: 0.55, variation: 0.08, varrange: 12, root: "E", scale: "Natural Minor", octave: -2 }, { data });
  const snap = boardScale(p, [1, 0], { sample: "Continuous", slew: 0.04, octave: 0 });
  const osc = p.add("oscillator", [2, 0], { shape: 0.67 }, { name: "Saw" });
  const env = p.add("adsr", [2, 1], { attack: 0.002, decay: 0.28, sustain: 0.25, release: 0.08, velamount: 0.85 }, { name: "Filter Env" });
  const flt = p.add("filter", [3, 0], { cutoff: 260, resonance: 0.45, drive: 0.4, keytrack: 0.4, type: "Ladder Tanh" });
  const aenv = p.add("adsr", [3, 1], { attack: 0.002, decay: 0.3, sustain: 0.7, release: 0.06, velamount: 0.6 }, { name: "Amp Env" });
  const amp = p.add("vca", [4, 0], {}, { name: "Amp" });
  p.cable(p.cin, "mutate", seq, "variation", 0.5).cable(p.cin, "tr", seq, "transpose")
    .cable(seq, "pitch", snap, "ina").cable(seq, "trigger", snap, "triga").cable(p.cin, "slide", snap, "a.slew", 0.2)
    .cable(snap, "outa", osc, "pitch").cable(snap, "outa", flt, "pitch")
    .cable(osc, "out", flt, "l", 0.5).cable(osc, "sub", flt, "l", 0.5)
    .cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(seq, "velocity", env, "velocity")
    .cable(seq, "gate", aenv, "gate").cable(seq, "trigger", aenv, "retrig").cable(seq, "velocity", aenv, "velocity")
    .cable(env, "env", flt, "cutoff", 0.4).cable(p.cin, "cut", flt, "cutoff", 0.5)
    .cable(flt, "l", amp, "l").cable(aenv, "env", amp, "gain")
    .cable(amp, "l", p.cout, "l", 0.8).cable(amp, "l", p.cout, "r", 0.8);
  return p;
}

// Jittery clock, two random gate streams and three held voltages, all loosened by a single input.
function scatterClock() {
  const p = cell("Scatter Clock", {
    description: "A clock source that can be tight or loose: a jittery clock out, two random gate streams and three held voltages, all from one input. Loose turns timing, gate chance and voltage spread from regular to scattered, and Repeat locks the random gates and voltages into a loop. Shared inputs Loose, Repeat and Bias.",
    tags: ["clock", "random", "generative", "jitter", "modulator"],
    help: "A Recall module draws two random gates (T1 and T2) and three random voltages on every step, and can repeat the " +
      "last few draws: its two Recall knobs are patched together to the Repeat input, which is added to both, so the gates and the " +
      "voltages loop together. Its step clock passes through a Pulse Generator whose Jitter is the Loose input, so the clock out " +
      "wobbles in time too. Loose also raises the gate Jitter and widens the spread of the voltages.\n\n" +
      "Leave Clock empty to follow the transport (sixteenth notes) or patch your own. Take Clock out into sequencers, Gate A and " +
      "Gate B to trigger drums, and Volt 1 to 3 into pitch or filter inputs (they change once per step). Bias tilts the " +
      "gates toward more or fewer hits.\n\n" +
      "Tip: turn Repeat all the way up once you like the pattern, then Loose up to hear it played ever more sloppily.",
  }).input("loose", "Loose").input("repeat", "Repeat").input("bias", "Bias")
    .output("clock", "Clock", "gate").output("gate1", "Gate A", "gate").output("gate2", "Gate B", "gate")
    .output("v1", "Volt 1").output("v2", "Volt 2").output("v3", "Volt 3");
  const rc = p.add("recall", [1, 0], { sync: "1/16", tmode: "Coin", tbias: 0.5, tjitter: 0.1, trecall: 0, xspread: 0.4, xrecall: 0, xsteps: 0.3, tloop: 8, xloop: 8, seed: 23 });
  const pg = p.add("pulse-generator", [2, 1], { mode: "Triggered", sync: "1/16", units: "% of Period", delaypct: 0.2, widthpct: 0.4, jitter: 0.02, seed: 7 }, { name: "Scattered Clock" });
  p.cable(p.cin, "repeat", rc, "trecall").cable(p.cin, "repeat", rc, "xrecall")
    .cable(p.cin, "bias", rc, "tbias", 0.5)
    .cable(p.cin, "loose", rc, "tjitter", 0.8).cable(p.cin, "loose", rc, "xspread", 0.5).cable(p.cin, "loose", pg, "jitter")
    .cable(rc, "clock", pg, "trigger").cable(pg, "gate", p.cout, "clock")
    .cable(rc, "t1", p.cout, "gate1").cable(rc, "t2", p.cout, "gate2")
    .cable(rc, "x1", p.cout, "v1").cable(rc, "x2", p.cout, "v2").cable(rc, "x3", p.cout, "v3");
  return p;
}

// Random strikes of four tuned bars, more and denser as the wind picks up.
function windChimes() {
  const p = cell("Wind Chimes", {
    description: "Four tuned metal tubes struck at random by a wandering wind: a gust generator raises and lowers the chance and speed of the strikes, each tube rings out in a small room. Shared inputs Wind (strength) and Tune (pitch).",
    tags: ["generative", "chimes", "wind", "ambient", "random"],
    help: "A Recall in Chance mode makes random gates at a free rate, and a Coin Toss splits them over four Modal Voices tuned to " +
      "G, C, E and G an octave up (a pentatonic cluster, so any strike sounds right with any other). A slow Uncertainty curve " +
      "is the gusts: it raises and lowers the rate and chance of the strikes on its own. The Wind input adds to both, so " +
      "a calm breeze is a rare ping and a storm a dense shimmer. Each strike's pitch also wobbles a hair with the " +
      "random voltage of the Recall, so no two hits are the same.\n\n" +
      "Press play: it rings by itself from Out L/R (the wind runs freely, not with the transport). Tune moves all four tubes " +
      "together, 1 V per octave; play it from the keyboard to transpose the set.\n\n" +
      "Tip: Wind from a slow LFO makes a breeze that comes and goes.",
  }).input("wind", "Wind").input("tune", "Tune", "pitch").stereoOut();
  const gust = p.add("uncertainty", [0, 0], { f1rate: 0.22, f1spread: 1, f2rate: 0.07, f2spread: 1 }, { name: "Gusts" });
  const rc = p.add("recall", [1, 0], { sync: "Free", rate: 2.5, tmode: "Chance", tbias: 0.2, tjitter: 0.5, trecall: 0, xspread: 0.5, seed: 12 });
  const coin = p.add("coin-toss", [2, 0], { prob1: 0.5, prob2: 0.5, seed: 3 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -7, pan1: -0.6, level2: -7, pan2: -0.2, level3: -7, pan3: 0.2, level4: -7, pan4: 0.6,
    send1: -12, send2: -12, send3: -12, send4: -12, return: -4, master: 0 });
  p.cable(gust, "fluct1", rc, "tbias", 0.12).cable(p.cin, "wind", rc, "tbias", 0.5)
    .cable(gust, "fluct2", rc, "rate", 0.18).cable(p.cin, "wind", rc, "rate", 0.35)
    .cable(rc, "t1", coin, "in1").cable(rc, "t2", coin, "in2");
  [["a1", 7, "x1", "Tube G"], ["b1", 12, "x2", "Tube C"], ["a2", 16, "x3", "Tube E"], ["b2", 19, "x1", "Tube G+"]].forEach(([trig, coarse, x, name], i) => {
    const mv = p.add("modal-voice", [3, i], { coarse, strike: 1, strikeTimbre: 0.7, geometry: 0.7, brightness: 0.8, damping: 0.12, position: 0.35,
      size: 0.22, space: 0.2, partials: "16", seed: 30 + i }, { name });
    p.cable(coin, trig, mv, "strike").cable(p.cin, "tune", mv, "pitch").cable(rc, x, mv, "pitch", 0.03)
      .stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const room = p.add("reverb", [5, 1], { size: 0.6, decay: 4, damping: 0.4, mix: 1, quality: "Eco (8 lines)" });
  sendReturn(p, mix, room);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  return p;
}

// Nine sine drawbars, vibrato, a click on the key and a decaying percussion harmonic.
function toneWheelOrgan() {
  const p = voice("Tone Wheel Organ", {
    description: "An additive drawbar organ: nine sine harmonics from the sub octave to the top, a vibrato, a soft click at the start of every key and a percussion harmonic that dies away. Shared inputs Perc (percussion amount), Vibrato (depth) and Bright (the upper drawbars).",
    tags: ["organ", "additive", "drawbar", "keys", "vibrato"],
    help: "Nine Oscillators sing one pure sine each at the footages of a drawbar organ: the octave below, the fifth above the " +
      "fundamental, the fundamental, then the octave, twelfth, two octaves, the seventeenth, nineteenth and three " +
      "octaves up. Two mixers set their levels (the default is a warm 00 8800 0 registration, with a touch of the top for air). " +
      "A tenth Oscillator at the twelfth makes the percussion with its own quick envelope, noise through a high-pass is the key " +
      "click, and one slow LFO through a VCA gives all of them the vibrato.\n\n" +
      "Notes in, Out L/R. Perc raises the percussion, Vibrato adds to the vibrato depth (zero is a still tone) and Bright adds " +
      "to the level of the upper five drawbars. Open the cell and change the mixer levels to move the drawbars.\n\n" +
      "Tip: play full chords low on the keyboard and use Bright with the mod wheel for a swell.",
  }).settings({ voices: 6, mode: "Poly" }).input("perc", "Perc").input("vib", "Vibrato").input("bright", "Bright");
  // [name, octave, coarse]: a drawbar organ's footages, as multiples of the played pitch.
  const bars = [["16'", "-1", 0], ["5 1/3'", "0", 7.02], ["8'", "0", 0], ["4'", "+1", 0], ["2 2/3'", "+1", 7.02],
                ["2'", "+2", 0], ["1 3/5'", "+2", 3.86], ["1 1/3'", "+2", 7.02], ["1'", "+3", 0]];
  const levels = [-3, -60, 0, -3, -60, -9, -60, -60, -15];
  const mixA = p.add("audio-mixer", [2, 0], { level1: levels[0], level2: levels[1], level3: levels[2], level4: levels[3], master: -4 }, { name: "Drawbars 1–4" });
  const mixB = p.add("audio-mixer", [2, 1], { level1: levels[4], level2: levels[5], level3: levels[6], level4: levels[7], master: -4 }, { name: "Drawbars 5–8" });
  const mixC = p.add("audio-mixer", [3, 0], { level1: 0, level2: 0, level3: levels[8], level4: -12, master: -2 }, { name: "Top & Extras" });
  const vib = p.add("lfo", [0, 4], { rate: 6.2, wave: "Sine" }, { name: "Vibrato LFO" });
  const vibAmt = p.add("vca", [1, 4], { gain: 0.35 }, { name: "Vibrato Depth" });
  p.cable(vib, "out", vibAmt, "l").cable(p.cin, "vib", vibAmt, "gain", 0.5);
  bars.forEach(([name, octave, coarse], i) => {
    const o = p.add("oscillator", [0, i % 4], { octave, coarse }, { name: `Drawbar ${name}` });
    p.cable(p.vin, "pitch", o, "pitch").cable(vibAmt, "l", o, "pitch", semis(0.3));
    if (i < 4) p.cable(o, "sine", mixA, `in${i + 1}l`);
    else if (i < 8) p.cable(o, "sine", mixB, `in${i - 3}l`);
    else p.cable(o, "sine", mixC, "in3l");
  });
  p.cable(p.cin, "bright", mixB, "level1", 0.1).cable(p.cin, "bright", mixB, "level2", 0.1).cable(p.cin, "bright", mixB, "level3", 0.1).cable(p.cin, "bright", mixB, "level4", 0.1);
  // Percussion: the twelfth, with a quick decay, scaled by Perc.
  const po = p.add("oscillator", [0, 3], { octave: "+1", coarse: 7.02 }, { name: "Percussion Tone" });
  const penv = envelope(p, [1, 2], { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05, velamount: 0 }, "Percussion Env");
  const pmul = p.add("multiplier", [1, 3], { biasy1: 0.45 }, { name: "Perc × Amount" });
  const pamp = p.add("vca", [1, 1], {}, { name: "Percussion" });
  p.cable(p.vin, "pitch", po, "pitch").cable(po, "sine", pamp, "l").cable(penv, "env", pmul, "x1").cable(p.cin, "perc", pmul, "y1", 0.55)
    .cable(pmul, "out1", pamp, "gain").cable(pamp, "l", mixC, "in1l", 0.9);
  // Key click.
  const noise = p.add("noise", [0, 5], { colour: 0.6 }, { name: "Click Noise" });
  const hp = p.add("filter", [1, 5], { type: "SVF Multimode", mode: "HP", cutoff: 1800, resonance: 0.1 }, { name: "Click Filter" });
  const cenv = envelope(p, [1, 6], { attack: 0.001, decay: 0.012, sustain: 0, release: 0.01, velamount: 0 }, "Click Env");
  const camp = p.add("vca", [2, 5], {}, { name: "Click VCA" });
  p.cable(noise, "out", hp, "l").cable(hp, "l", camp, "l").cable(cenv, "env", camp, "gain", 0.5).cable(camp, "l", mixC, "in4l");
  // The two drawbar mixers sum into channels 2 and 3 of the last one (mono).
  for (const m of [mixA, mixB]) p.cable(m, "outl", mixC, "in2l").cable(m, "outl", mixC, "in2r");
  ampEnvelope(p, { node: mixC, stereo: true, jacks: ["outl", "outr"] }, [4, 0], { attack: 0.008, decay: 0.05, sustain: 1, release: 0.07, velamount: 0.3 });
  return p;
}

// Four lanes of random gates that share one clock, each with its own chance, skip input and a rolled twin.
function quadPulseBank() {
  const p = cell("Quad Pulse Bank", {
    description: "Four independent probability lanes on one clock: each lane fires its own share of the steps, can be skipped by its own gate input, and has a twin output that rolls into a quick ratchet. Shared inputs Density (all lanes more likely), Fill, and Skip 1 to 4.",
    tags: ["generative", "probability", "gates", "ratchet", "rhythm"],
    help: "A Gate Sequencer with all sixteen steps on in each of its four tracks: each track's Chance knob decides how many " +
      "steps fire (about 90, 65, 40 and 20 percent from lane 1 to lane 4), and the tracks run at slightly different rates " +
      "(the third on eighths, the fourth on sixteenth triplets) so the lanes drift against each other. Every lane's trigger " +
      "also feeds a Pulse Generator that answers each hit with a burst of two to four fast pulses: the Roll outputs.\n\n" +
      "Leave Clock empty to follow the transport, or patch a sixteenth-note clock. Lane 1 to 4 are plain triggers for drums or " +
      "envelopes and Roll 1 to 4 ratchet versions of the same hits. A gate into Skip n mutes lane n while high, Fill (a gate " +
      "from a bar counter, say) plays the steps marked for fills, and Density is added to all four chances at once.\n\n" +
      "Tip: kick on lane 1, a rim on lane 3 and a rolled hat on Roll 2 is already a groove that never repeats.",
  }).input("density", "Density").input("fill", "Fill", "gate")
    .input("skip1", "Skip 1", "gate").input("skip2", "Skip 2", "gate").input("skip3", "Skip 3", "gate").input("skip4", "Skip 4", "gate")
    .output("t1", "Lane 1", "trigger").output("t2", "Lane 2", "trigger").output("t3", "Lane 3", "trigger").output("t4", "Lane 4", "trigger")
    .output("r1", "Roll 1", "gate").output("r2", "Roll 2", "gate").output("r3", "Roll 3", "gate").output("r4", "Roll 4", "gate");
  const row = "xxxxxxxxxxxxxxxx";
  const seq = p.add("gate-sequencer", [1, 1], { chance1: 0.9, chance2: 0.65, chance3: 0.4, chance4: 0.2, length1: 16, length2: 16, length3: 12, length4: 16,
    rate1: "1/16", rate2: "1/16", rate3: "1/8", rate4: "1/16T", dice: "New every loop", seed: 5 }, { name: "Chance Lanes", data: gateTracks([row, row, row, row]) });
  p.cable(p.cin, "fill", seq, "fill");
  for (let i = 1; i <= 4; i++) {
    p.cable(p.cin, `skip${i}`, seq, `mute${i}`).cable(p.cin, "density", seq, `chance${i}`, 0.3).cable(seq, `trig${i}`, p.cout, `t${i}`);
    const roll = p.add("pulse-generator", [2, i - 1], { mode: "Triggered", burst: i + 1 > 4 ? 4 : i + 1, sync: "1/32", units: "% of Period", widthpct: 0.3, seed: i }, { name: `Roll ${i}` });
    p.cable(seq, `trig${i}`, roll, "trigger").cable(roll, "gate", p.cout, `r${i}`);
  }
  return p;
}

export default category("Workshop", "Generative and timing tools, a few odd voices and instruments, built from the stock modules.", [
  fourVoiceFm, looseTime, reboundEnvelope, undertonePair, shakerBox, holdAndCount, lateBeat, lissaWalk,
  drunkWalk, runningTotal, bassMaker, scatterClock, windChimes, toneWheelOrgan, quadPulseBank,
]);
