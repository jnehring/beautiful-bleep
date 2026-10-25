// SPDX-License-Identifier: MIT
// Processing: dynamics, stereo, spectral and character effects built from the board's own modules, no new DSP.
// Stereo cells: In L/R → processing → Out L/R. Shared inputs are added to the knobs named in each help text.
import { cell, category } from "./kit.mjs";

/// A stereo effect cell: the jacks, the shared inputs ([id, name] pairs) and what it can be loaded as.
function fx(name, { description, tags, help, inputs = [], tail = 0 }) {
  const p = cell(name, { description, tags, help }).stereoIn().stereoOut();
  for (const [id, label, type] of inputs) p.input(id, label, type);
  return p.plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail } });
}

/// Dry In L/R against a wet stereo pair with one Mix input (added to the Crossfader's Fade), then Cell Out.
function blend(p, at, wet, jacks, fade, amount = 0.5) {
  const xf = p.add("crossfader", at, { fade }, { name: "Dry/Wet" });
  p.cable(p.cin, "l", xf, "al").cable(p.cin, "r", xf, "ar")
    .cable(wet, jacks[0], xf, "bl").cable(wet, jacks[1], xf, "br")
    .cable(xf, "outl", p.cout, "l").cable(xf, "outr", p.cout, "r");
  if (p.root.inputs.some((j) => j.id === "mix")) p.cable(p.cin, "mix", xf, "fade", amount);
  return xf;
}

/// A Matrix Mixer with every crosspoint given: rows[out] = { in: gain }, ins/outs counted from 1.
function matrixValues(rows) {
  const v = { inputs: 8, outputs: 8 };
  for (let i = 1; i <= 8; i++) for (let o = 1; o <= 8; o++) v[`g_${i}_${o}`] = (rows[o] && rows[o][i]) || 0;
  return v;
}

// ---------------------------------------------------------------- 1

function twinTremolo() {
  const p = fx("Twin Tremolo", {
    description: "Tremolo with two LFOs, one per side, set a quarter cycle apart so the level seesaws across the stereo field. Shared inputs Rate, Depth, Spread and Shape.",
    tags: ["tremolo", "stereo", "pulse", "movement"],
    help: "Two LFOs scale the left and right signals through a Multiplier. The second LFO starts 90 degrees behind the first, " +
      "so the level of one side is rising while the other falls: Spread widens or closes that offset, down to a plain mono tremolo.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Rate, Depth, Spread and Shape are added to the LFO rate, the depth knob of the " +
      "Multiplier, the phase offset and the LFO wave (sine, triangle, saw, square, random). To lock the speed to the tempo, open the cell " +
      "and set both LFOs' Sync to a note value.\n\n" +
      "Tip: set Shape to square, Depth to the top and Spread to 180 degrees for a hard left-right chop.",
    inputs: [["rate", "Rate"], ["depth", "Depth"], ["spread", "Spread"], ["shape", "Shape"]],
  });
  const a = p.add("lfo", [0, 0], { rate: 4.5, wave: "Sine" }, { name: "LFO Left" });
  const b = p.add("lfo", [0, 1], { rate: 4.5, wave: "Sine", phase: 90 }, { name: "LFO Right" });
  const depth = p.add("multiplier", [1, 0], { gain1: 0.6, gain2: 0.6 }, { name: "Depth" });
  const amp = p.add("multiplier", [2, 0], { biasy1: 1, biasy2: 1, gain1: 0.8, gain2: 0.8 }, { name: "Tremolo" });
  p.cable(a, "out", depth, "x1").cable(b, "out", depth, "x2")
    .cable(depth, "out1", amp, "y1").cable(depth, "out2", amp, "y2")
    .cable(p.cin, "l", amp, "x1").cable(p.cin, "r", amp, "x2")
    .cable(amp, "out1", p.cout, "l").cable(amp, "out2", p.cout, "r")
    .cable(p.cin, "rate", a, "rate", 0.15).cable(p.cin, "rate", b, "rate", 0.15)
    .cable(p.cin, "depth", depth, "gain1", 0.125).cable(p.cin, "depth", depth, "gain2", 0.125)
    .cable(p.cin, "spread", b, "phase", 0.5)
    .cable(p.cin, "shape", a, "wave", 0.5).cable(p.cin, "shape", b, "wave", 0.5);
  return p;
}

// ---------------------------------------------------------------- 2

/// One band of the whirl: a Doppler delay swung by two quadrature LFO outputs, and amplitude modulation from the other two.
function rotor(p, col, row, src, { rate, delayMs, swing, am, name }) {
  const q = p.add("quad-lfo", [col, row], { mode: "Phase", spread: 90, rate1: rate }, { name: `${name} Rotor` });
  const dop = p.add("multiplier", [col + 1, row], { gain1: 1, gain2: 1 }, { name: `${name} Depth` });
  const dly = p.add("delay", [col + 1, row + 1], { timel: delayMs, timer: delayMs, feedback: 0, mix: 1, lowcut: 20, highcut: 20000 }, { name: `${name} Doppler` });
  const att = p.add("attenuverter", [col + 2, row], { scale: am }, { name: `${name} Swell L` });
  const att2 = p.add("attenuverter", [col + 3, row], { scale: am }, { name: `${name} Swell R` });
  const amp = p.add("multiplier", [col + 2, row + 1], { biasy1: 1, biasy2: 1 }, { name: `${name} Level` });
  p.cable(q, "out1", dop, "x1").cable(q, "out3", dop, "x2")
    .cable(dop, "out1", dly, "timel", swing).cable(dop, "out2", dly, "timer", swing)
    .cable(src, "l", dly, "l").cable(src, "r", dly, "r")
    .cable(q, "out2", att, "in").cable(q, "out4", att2, "in")
    .cable(att, "out", amp, "y1").cable(att2, "out", amp, "y2")
    .cable(dly, "l", amp, "x1").cable(dly, "r", amp, "x2")
    .cable(p.cin, "depth", dop, "gain1", 0.125).cable(p.cin, "depth", dop, "gain2", 0.125)
    .cable(p.cin, "mics", q, "spread", 0.25).cable(p.cin, "speed", q, "rate1", 0.1);
  return { q, amp };
}

function whirl() {
  const p = fx("Whirl", {
    description: "A rotating-speaker effect: a crossover feeds a fast horn and a slower drum, each swung by Doppler delay and amplitude swell, with a Slow/Fast switch that spins up and down over a couple of seconds. Shared inputs Mix, Fast, Speed, Depth, Mics and Split.",
    tags: ["rotary", "doppler", "movement", "organ"],
    help: "A low-pass and a high-pass filter split the sound at 800 Hz. Each band goes through a modulated delay, so the pitch leans up and " +
      "down as the imaginary speaker swings past, and through a level swell from the other two outputs of the same quad LFO. The horn " +
      "(highs) turns faster than the drum (lows). The two stereo channels listen from opposite sides of the turn.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The Fast button inside the cell, or a gate into Fast, switches between slow and " +
      "fast; a slew ramps the speed over about 1.8 seconds so it accelerates and coasts like a real rotor. Speed adds to both rotor rates, " +
      "Depth to the Doppler swing, Mics to the quarter-cycle offset between the four LFO phases, Split to the crossover frequency and Mix " +
      "to the dry/wet balance.\n\n" +
      "Tip: put it after an organ or an electric piano and hit Fast on the chorus of the song.",
    inputs: [["mix", "Mix"], ["fast", "Fast", "gate"], ["speed", "Speed"], ["depth", "Depth"], ["mics", "Mics"], ["split", "Split"]],
    tail: 1,
  });
  const lo = p.add("filter", [0, 2], { mode: "LP", cutoff: 800, type: "SVF Multimode" }, { name: "Drum Band" });
  const hi = p.add("filter", [0, 0], { mode: "HP", cutoff: 800, type: "SVF Multimode" }, { name: "Horn Band" });
  p.stereo(p.cin, lo).stereo(p.cin, hi)
    .cable(p.cin, "split", lo, "cutoff", 0.15).cable(p.cin, "split", hi, "cutoff", 0.15);
  const horn = rotor(p, 1, 0, hi, { rate: 0.8, delayMs: 2.5, swing: 0.07, am: 0.3, name: "Horn" });
  const drum = rotor(p, 1, 2, lo, { rate: 0.7, delayMs: 4, swing: 0.05, am: 0.35, name: "Drum" });
  const btn = p.add("button", [1, 4], { mode: "Toggle" }, { name: "Fast" });
  const either = p.add("math", [2, 4], { op1: "Max" }, { name: "Slow/Fast" });
  const ramp = p.add("utility", [3, 4], { slew: 1.8 }, { name: "Spin Up" });
  p.cable(btn, "toggle", either, "ina1").cable(p.cin, "fast", either, "inb1")
    .cable(either, "out1", ramp, "x")
    .cable(ramp, "out", horn.q, "rate1", 0.244).cable(ramp, "out", drum.q, "rate1", 0.228);
  const mix = p.add("audio-mixer", [4, 1], { level1: 0, level2: 0, master: 0 }, { name: "Speaker" });
  p.cable(horn.amp, "out1", mix, "in1l").cable(horn.amp, "out2", mix, "in1r")
    .cable(drum.amp, "out1", mix, "in2l").cable(drum.amp, "out2", mix, "in2r");
  blend(p, [5, 1], mix, ["outl", "outr"], 0.85);
  return p;
}

// ---------------------------------------------------------------- 3

function midSideLab() {
  const p = fx("Mid-Side Lab", {
    description: "Splits the stereo image into its centre and its sides, gives each its own filter, saturation and level, then puts it back together. Shared inputs Mid, Side, Mid Drive, Side Drive, Bass Mono and Mid Tone.",
    tags: ["mid-side", "stereo", "width", "mastering"],
    help: "A Matrix Mixer encodes left and right into Mid (what they share) and Side (what differs). The Mid goes through a low-pass " +
      "filter, a Saturator and a VCA; the Side through a high-pass filter, a Saturator and a VCA; a second Matrix Mixer decodes them back to " +
      "left and right. With everything at its default the sound comes out nearly unchanged but a little wider.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Mid and Side are added to the two levels (Side above one widens, at zero the " +
      "result is mono), Mid Drive and Side Drive to the saturation, Bass Mono to the Side's high-pass frequency, which keeps low notes in " +
      "the middle, and Mid Tone to the Mid's low-pass.\n\n" +
      "Tip: drive only the Side a little and pull Bass Mono up to 200 Hz for a wide, gritty sound with a solid centre.",
    inputs: [["mid", "Mid"], ["side", "Side"], ["middrive", "Mid Drive"], ["sidedrive", "Side Drive"], ["bass", "Bass Mono"], ["tone", "Mid Tone"]],
    tail: 3,
  });
  const enc = p.add("matrix-mixer", [0, 0], matrixValues({ 1: { 1: 0.5, 2: 0.5 }, 2: { 1: 0.5, 2: -0.5 } }), { name: "Encode" });
  const dec = p.add("matrix-mixer", [5, 0], matrixValues({ 1: { 1: 1, 2: 1 }, 2: { 1: 1, 2: -1 } }), { name: "Decode" });
  const midF = p.add("filter", [1, 0], { mode: "LP", cutoff: 18000, type: "SVF Multimode" }, { name: "Mid Tone" });
  const midS = p.add("saturator", [2, 0], { drive: 0.2, character: "Tube", mix: 1, sag: 0, age: 0 }, { name: "Mid Warmth" });
  const midV = p.add("vca", [3, 0], { gain: 1, response: "Linear" }, { name: "Mid Level" });
  const sideF = p.add("filter", [1, 1], { mode: "HP", cutoff: 120, type: "SVF Multimode" }, { name: "Bass Mono" });
  const sideS = p.add("saturator", [2, 1], { drive: 0.1, character: "Diode", mix: 1, sag: 0, age: 0 }, { name: "Side Grit" });
  const sideV = p.add("vca", [3, 1], { gain: 1.2, response: "Linear" }, { name: "Side Level" });
  p.cable(p.cin, "l", enc, "in1").cable(p.cin, "r", enc, "in2")
    .cable(enc, "out1", midF, "l").cable(midF, "l", midS, "l").cable(midS, "l", midV, "l").cable(midV, "l", dec, "in1")
    .cable(enc, "out2", sideF, "l").cable(sideF, "l", sideS, "l").cable(sideS, "l", sideV, "l").cable(sideV, "l", dec, "in2")
    .cable(dec, "out1", p.cout, "l").cable(dec, "out2", p.cout, "r")
    .cable(p.cin, "mid", midV, "gain", 0.5).cable(p.cin, "side", sideV, "gain", 0.5)
    .cable(p.cin, "middrive", midS, "drive", 0.5).cable(p.cin, "sidedrive", sideS, "drive", 0.5)
    .cable(p.cin, "bass", sideF, "cutoff", 0.15).cable(p.cin, "tone", midF, "cutoff", 0.15);
  return p;
}

// ---------------------------------------------------------------- 4

function swingPan() {
  const p = fx("Swing Pan", {
    description: "An equal-power auto-pan with a twist: the louder the signal, the further it is pushed to one side. Shared inputs Pan, Rate, Depth, Push and Shape.",
    tags: ["pan", "autopan", "stereo", "movement"],
    help: "An LFO sweeps the pan of a mixer channel; an Envelope Follower adds a second push that follows the loudness, so loud notes swing " +
      "out to the right while quiet tails settle in the middle. The mixer's pan is equal-power, so the level stays steady as it moves.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Pan is added to the centre position, Rate to the sweep speed, Depth to the sweep " +
      "width (zero stops the sweep), Push to the loudness amount and Shape to the LFO wave.\n\n" +
      "Tip: set Depth to zero and use only Push on a drum loop: each hit leans right and falls back with the release.",
    inputs: [["pan", "Pan"], ["rate", "Rate"], ["depth", "Depth"], ["push", "Push"], ["shape", "Shape"]],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.4, wave: "Sine" }, { name: "Sweep" });
  const wid = p.add("multiplier", [1, 0], { gain1: 0.8 }, { name: "Sweep Width" });
  const fol = p.add("envelope-follower", [0, 1], { attack: 0.01, release: 0.3, gain: 2 }, { name: "Level" });
  const push = p.add("utility", [1, 1], { scalex: 0.4 }, { name: "Push" });
  const mix = p.add("audio-mixer", [2, 0], { limiter: false }, { name: "Pan" });
  p.stereo(p.cin, mix, { to: ["in1l", "in1r"] })
    .cable(lfo, "out", wid, "x1").cable(wid, "out1", mix, "pan1", 0.5)
    .cable(p.cin, "l", fol, "in").cable(p.cin, "r", fol, "in").cable(fol, "env", push, "x").cable(push, "out", mix, "pan1", 0.5)
    .cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r")
    .cable(p.cin, "pan", mix, "pan1", 0.5).cable(p.cin, "rate", lfo, "rate", 0.15)
    .cable(p.cin, "depth", wid, "gain1", 0.125).cable(p.cin, "push", push, "scalex", 0.5)
    .cable(p.cin, "shape", lfo, "wave", 0.5);
  return p;
}

// ---------------------------------------------------------------- 5

function punchShaper() {
  const p = fx("Punch Shaper", {
    description: "Reshapes the attack and the sustain of any sound by comparing a fast and a slow loudness follower. Shared inputs Attack, Sustain, Sense and Grit.",
    tags: ["transient", "dynamics", "punch", "drums"],
    help: "Two Envelope Followers listen to the input, one quick and one slow. Their difference is positive at the start of a sound " +
      "(the quick one is ahead) and negative while it dies away. The positive part, scaled by Attack, and the negative part, scaled by Sustain, " +
      "are added to a gain of one and drive a VCA. A little Saturator after it adds grit.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Attack is added to the transient amount (more snap), Sustain to the tail amount " +
      "(more body, or less when the knob inside is negative), Sense to the follower sensitivity and Grit to the drive of the final saturation.\n\n" +
      "Tip: for tighter drums leave Attack up and set the Sustain scale inside the cell below zero.",
    inputs: [["attack", "Attack"], ["sustain", "Sustain"], ["sense", "Sense"], ["grit", "Grit"]],
    tail: 3,
  });
  const fast = p.add("envelope-follower", [0, 0], { attack: 0.001, release: 0.02, gain: 3 }, { name: "Fast" });
  const slow = p.add("envelope-follower", [0, 1], { attack: 0.03, release: 0.25, gain: 3 }, { name: "Slow" });
  const diff = p.add("math", [1, 0], { op1: "Subtract" }, { name: "Difference" });
  const abs = p.add("utility", [2, 0], { mode: "Rectify" }, { name: "Size" });
  const pos = p.add("utility", [2, 1], { scalex: 0.5, scaley: 0.5 }, { name: "Onset" });
  const neg = p.add("utility", [2, 2], { scalex: -0.5, scaley: 0.5 }, { name: "Decay" });
  const gain = p.add("utility", [3, 1], { scalex: 0.6, scaley: -0.2, offset: 1 }, { name: "Gain" });
  const amp = p.add("vca", [4, 0], { gain: 0, response: "Linear" }, { name: "Shaper" });
  const grit = p.add("saturator", [5, 0], { drive: 0.1, character: "Tape", mix: 0.6, sag: 0, age: 0 }, { name: "Grit" });
  p.cable(p.cin, "l", fast, "in").cable(p.cin, "r", fast, "in").cable(p.cin, "l", slow, "in").cable(p.cin, "r", slow, "in")
    .cable(fast, "env", diff, "ina1").cable(slow, "env", diff, "inb1")
    .cable(diff, "out1", abs, "x").cable(diff, "out1", pos, "x").cable(abs, "out", pos, "y")
    .cable(diff, "out1", neg, "x").cable(abs, "out", neg, "y")
    .cable(pos, "out", gain, "x").cable(neg, "out", gain, "y").cable(gain, "out", amp, "gain")
    .stereo(p.cin, amp).stereo(amp, grit).stereo(grit, p.cout)
    .cable(p.cin, "attack", gain, "scalex", 0.5).cable(p.cin, "sustain", gain, "scaley", 0.5)
    .cable(p.cin, "sense", fast, "gain", 0.2).cable(p.cin, "sense", slow, "gain", 0.2)
    .cable(p.cin, "grit", grit, "drive", 0.5);
  return p;
}

// ---------------------------------------------------------------- 6

function bandEchoes() {
  const p = fx("Band Echoes", {
    description: "A spectral delay: the sound is cut into five bands and each band gets its own echo time, so lows answer first and highs trail behind, spread across the stereo field. Shared inputs Time, Stretch, Feedback, Tilt and Mix.",
    tags: ["delay", "spectral", "filter-bank", "stereo"],
    help: "A Filter Bank splits the input into ten bands; two Matrix Mixers gather them into five groups of two. Each group goes " +
      "through its own Delay, from 70 ms for the lows to 480 ms for the highs, and a third Matrix Mixer spreads the five echoes from left to " +
      "right across the stereo field. The dry sound comes back on a Crossfader.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Time is added to all five delay times, Stretch to each time in growing steps " +
      "(the higher the band, the more it moves), Feedback to the repeats, Tilt to the bank's tilt, which fades low bands against high ones, and " +
      "Mix to the dry/wet balance.\n\n" +
      "Tip: a short plucked sound with Stretch up turns into a rising or falling shimmer.",
    inputs: [["time", "Time"], ["stretch", "Stretch"], ["fb", "Feedback"], ["tilt", "Tilt"], ["mix", "Mix"]],
    tail: 5,
  });
  const bank = p.add("filter-bank", [0, 0], { jacks: "Bands", q: 3 }, { name: "Bands" });
  const bandPairs = [[1, 2], [3, 4], [5, 6], [7, 8]];
  const rows = {};
  bandPairs.forEach(([a, b], i) => { rows[i + 1] = { [a]: 1, [b]: 1 }; });
  const gather = p.add("matrix-mixer", [1, 0], matrixValues(rows), { name: "Low Groups" });
  const top = p.add("matrix-mixer", [1, 1], matrixValues({ 1: { 1: 1, 2: 1 } }), { name: "High Group" });
  p.stereo(p.cin, bank).cable(p.cin, "tilt", bank, "tilt", 0.5);
  for (let i = 1; i <= 8; i++) p.cable(bank, `band${i}`, gather, `in${i}`);
  p.cable(bank, "band9", top, "in1").cable(bank, "band10", top, "in2");
  const times = [70, 150, 240, 350, 480];
  const spread = p.add("matrix-mixer", [3, 0], matrixValues({
    1: { 1: 0.9, 2: 0.65, 3: 0.4, 4: 0.2, 5: 0 }, 2: { 1: 0, 2: 0.2, 3: 0.4, 4: 0.65, 5: 0.9 } }), { name: "Spread" });
  times.forEach((ms, i) => {
    const dly = p.add("delay", [2, i], { timel: ms, timer: ms, feedback: 0.35, mix: 1, lowcut: 20, highcut: 12000 }, { name: `Echo ${i + 1}` });
    p.cable(i < 4 ? gather : top, i < 4 ? `out${i + 1}` : "out1", dly, "l")
      .cable(dly, "l", spread, `in${i + 1}`)
      .cable(p.cin, "time", dly, "timel", 0.05).cable(p.cin, "time", dly, "timer", 0.05)
      .cable(p.cin, "stretch", dly, "timel", 0.01 * (i + 1)).cable(p.cin, "stretch", dly, "timer", 0.01 * (i + 1))
      .cable(p.cin, "fb", dly, "feedback", 0.2);
  });
  blend(p, [4, 0], spread, ["out1", "out2"], 0.6);
  return p;
}

// ---------------------------------------------------------------- 7

function gateVerb() {
  const p = fx("Gate Verb", {
    description: "A big reverb that is only let through while the dry sound is loud, then cut off with an adjustable hold, and that rings longer after harder hits. Shared inputs Mix, Hold, Threshold and Decay.",
    tags: ["reverb", "gated", "drums", "dynamics"],
    help: "The Verb is fully wet. An Envelope Follower listens to the dry input; its gate output, smoothed by a slew, opens a VCA " +
      "after the reverb, so the tail is chopped when the sound stops. The follower's level also lengthens the reverb Decay a little, so " +
      "hard hits bloom bigger than soft ones.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Hold is added to the slew time (how long the tail lingers before closing), " +
      "Threshold to the loudness needed to open the gate, Decay to the reverb time and Mix to the dry/wet balance.\n\n" +
      "Tip: a snare with Hold at a quarter turn gives a short, explosive room; with Hold up it turns into a swell.",
    inputs: [["mix", "Mix"], ["hold", "Hold"], ["thresh", "Threshold"], ["decay", "Decay"]],
    tail: 3,
  });
  const verb = p.add("reverb", [1, 0], { size: 0.6, decay: 2.5, damping: 0.35, preDelay: 0.01, mix: 1 });
  const fol = p.add("envelope-follower", [0, 1], { attack: 0.002, release: 0.1, gain: 4, threshold: 0.1 }, { name: "Listener" });
  const hold = p.add("utility", [1, 1], { slew: 0.12 }, { name: "Hold" });
  const gate = p.add("vca", [2, 0], { gain: 0, response: "Linear" }, { name: "Gate" });
  p.stereo(p.cin, verb).stereo(verb, gate)
    .cable(p.cin, "l", fol, "in").cable(p.cin, "r", fol, "in")
    .cable(fol, "gate", hold, "x").cable(hold, "out", gate, "gain")
    .cable(fol, "env", verb, "decay", 0.1)
    .cable(p.cin, "hold", hold, "slew", 0.05).cable(p.cin, "thresh", fol, "threshold", 0.5)
    .cable(p.cin, "decay", verb, "decay", 0.3);
  blend(p, [3, 0], gate, ["l", "r"], 0.5);
  return p;
}

// ---------------------------------------------------------------- 8

function duckedEcho() {
  const p = fx("Ducked Echo", {
    description: "A tempo-synced ping-pong echo that gets out of the way while you play and swells back in the gaps. Shared inputs Duck, Recover, Feedback and Level.",
    tags: ["delay", "ducking", "sidechain", "ping-pong"],
    help: "A fully wet Delay (dotted eighth on the left, quarter on the right, ping-pong) goes through a VCA. An Envelope Follower " +
      "on the dry signal lowers that VCA by the amount of the Duck scale, so the echoes sit back under loud playing and rise again " +
      "over the Recover time. The dry sound always passes untouched.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. The delay follows the transport tempo or a cable into Clock. Duck is added to the " +
      "ducking depth, Recover to the follower release, Feedback to the repeats and Level to the loudness of the echoes.\n\n" +
      "Tip: with Duck at the top, a sustained pad stays clean and the echoes only show up in the rests.",
    inputs: [["duck", "Duck"], ["recover", "Recover"], ["fb", "Feedback"], ["level", "Level"]],
    tail: 12,
  });
  const dly = p.add("delay", [1, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", mode: "Ping-Pong", feedback: 0.55, lowcut: 150, highcut: 5000, mix: 1 });
  const fol = p.add("envelope-follower", [0, 1], { attack: 0.01, release: 0.4, gain: 3 }, { name: "Listener" });
  const duck = p.add("utility", [1, 1], { scalex: -0.8, offset: 1 }, { name: "Duck" });
  const amp = p.add("vca", [2, 0], { gain: 0, response: "Linear" }, { name: "Echo Level" });
  const mix = p.add("audio-mixer", [3, 0], { level2: -3, limiter: false }, { name: "Sum" });
  p.stereo(p.cin, dly).stereo(dly, amp).stereo(p.cin, mix, { to: ["in1l", "in1r"] })
    .cable(amp, "l", mix, "in2l").cable(amp, "r", mix, "in2r")
    .cable(p.cin, "l", fol, "in").cable(p.cin, "r", fol, "in").cable(fol, "env", duck, "x").cable(duck, "out", amp, "gain")
    .cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r")
    .cable(p.cin, "duck", duck, "scalex", -0.5).cable(p.cin, "recover", fol, "release", 0.1)
    .cable(p.cin, "fb", dly, "feedback", 0.15).cable(p.cin, "level", amp, "gain", 0.3);
  return p;
}

// ---------------------------------------------------------------- 9

function tapeStop() {
  const p = fx("Tape Stop", {
    description: "Slows everything down to a halt, darkening as it goes, and spins back up on release; a hand button or a gate triggers it, and a wobble grows as the speed falls. Shared inputs Stop, Time and Wobble.",
    tags: ["tape", "brake", "slowdown", "dj", "transition"],
    help: "A fully wet Delay is normally set to one millisecond, so the sound passes through unchanged. When the Stop button (inside the " +
      "cell) or the Stop gate is held, an envelope pushes the delay time up, which makes the sound play slower and lower until it " +
      "almost stops; at the same time the delay's high cut closes. A slow LFO scaled by the same envelope adds wow as the speed falls. " +
      "On release the envelope drops quickly and the pitch jumps back up.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Stop is a gate, for example from a sequencer's gate track, Time is added to " +
      "the length of the slowdown and Wobble to the amount of wow.\n\n" +
      "Tip: trigger it for a bar before a drop; with Time down it becomes a quick turntable-style stop.",
    inputs: [["stop", "Stop", "gate"], ["time", "Time"], ["wobble", "Wobble"]],
    tail: 3,
  });
  const btn = p.add("button", [0, 0], {}, { name: "Stop" });
  const either = p.add("math", [1, 0], { op1: "Max" }, { name: "Stop Gate" });
  const env = p.add("adsr", [2, 0], { attack: 2.6, decay: 0.1, sustain: 1, release: 0.7 }, { name: "Speed" });
  const wow = p.add("lfo", [2, 1], { rate: 0.9 }, { name: "Wow" });
  const wowAmt = p.add("multiplier", [3, 1], { gain1: 0.4 }, { name: "Wow Amount" });
  const dly = p.add("delay", [3, 0], { timel: 1, timer: 1, feedback: 0, mix: 1, highcut: 20000, lowcut: 20 });
  p.cable(btn, "gate", either, "ina1").cable(p.cin, "stop", either, "inb1").cable(either, "out1", env, "gate")
    .cable(env, "env", dly, "timel", 0.8).cable(env, "env", dly, "timer", 0.8).cable(env, "env", dly, "highcut", -0.45)
    .cable(wow, "out", wowAmt, "x1").cable(env, "env", wowAmt, "y1")
    .cable(wowAmt, "out1", dly, "timel", 0.03).cable(wowAmt, "out1", dly, "timer", 0.03)
    .cable(p.cin, "wobble", wowAmt, "gain1", 0.125)
    .cable(p.cin, "time", env, "attack", 0.3)
    .stereo(p.cin, dly).stereo(dly, p.cout);
  return p;
}

// ---------------------------------------------------------------- 10

function threeBandSqueeze() {
  const p = fx("Three-Band Squeeze", {
    description: "Splits the sound into low, mid and high, compresses each band on its own, and puts them back; one Squeeze input pushes all three harder at once. Shared inputs Squeeze, Low Split, High Split and Parallel.",
    tags: ["compressor", "multiband", "dynamics", "mastering"],
    help: "Two crossovers (at 180 Hz and 2.5 kHz) divide the signal into three bands. Each band has its own Compressor: slow and heavy " +
      "on the lows, medium on the mids, quick on the highs. An Audio Mixer sums them with its limiter on.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Squeeze lowers all three thresholds and raises their make-up gain together, " +
      "Low Split and High Split are added to the two crossover frequencies, and Parallel is subtracted from the compressors' Mix so the untouched " +
      "sound blends back in.\n\n" +
      "Tip: for a mix bus keep Squeeze low; for a drum loop push it and set Parallel to about half.",
    inputs: [["squeeze", "Squeeze"], ["lowsplit", "Low Split"], ["highsplit", "High Split"], ["parallel", "Parallel"]],
  });
  const lo = p.add("filter", [0, 0], { mode: "LP", cutoff: 180, type: "SVF Multimode" }, { name: "Low" });
  const rest = p.add("filter", [0, 1], { mode: "HP", cutoff: 180, type: "SVF Multimode" }, { name: "Upper" });
  const mid = p.add("filter", [1, 1], { mode: "LP", cutoff: 2500, type: "SVF Multimode" }, { name: "Mid" });
  const hi = p.add("filter", [1, 2], { mode: "HP", cutoff: 2500, type: "SVF Multimode" }, { name: "High" });
  const cl = p.add("compressor", [2, 0], { threshold: -20, ratio: 4, attack: 25, release: 200, knee: 8 }, { name: "Low Squeeze" });
  const cm = p.add("compressor", [2, 1], { threshold: -18, ratio: 3, attack: 10, release: 120, knee: 8 }, { name: "Mid Squeeze" });
  const ch = p.add("compressor", [2, 2], { threshold: -22, ratio: 4, attack: 3, release: 80, knee: 6 }, { name: "High Squeeze" });
  const sum = p.add("audio-mixer", [3, 1], {}, { name: "Sum" });
  p.stereo(p.cin, lo).stereo(p.cin, rest).stereo(rest, mid).stereo(rest, hi)
    .stereo(lo, cl).stereo(mid, cm).stereo(hi, ch)
    .cable(cl, "l", sum, "in1l").cable(cl, "r", sum, "in1r").cable(cm, "l", sum, "in2l").cable(cm, "r", sum, "in2r")
    .cable(ch, "l", sum, "in3l").cable(ch, "r", sum, "in3r")
    .cable(sum, "outl", p.cout, "l").cable(sum, "outr", p.cout, "r")
    .cable(p.cin, "lowsplit", lo, "cutoff", 0.15).cable(p.cin, "lowsplit", rest, "cutoff", 0.15)
    .cable(p.cin, "highsplit", mid, "cutoff", 0.15).cable(p.cin, "highsplit", hi, "cutoff", 0.15);
  for (const c of [cl, cm, ch])
    p.cable(p.cin, "squeeze", c, "threshold", -0.4).cable(p.cin, "squeeze", c, "makeup", 0.3).cable(p.cin, "parallel", c, "mix", -0.5);
  return p;
}

// ---------------------------------------------------------------- 11

function threeWaySplit() {
  const p = fx("Three-Way Split", {
    description: "A stereo crossover with an output per band: low, mid and high each leave on their own jacks, and the recombined sound leaves on Out L/R. Shared inputs Low Split, High Split and Mid Dip.",
    tags: ["crossover", "split", "bands", "routing"],
    help: "Two crossovers (at 200 Hz and 3 kHz) divide the stereo input into low, mid and high. Each band is available on its own pair of " +
      "jacks (Low L/R, Mid L/R, High L/R) to be processed separately, for example with a different effect on every band. The Out L/R jacks " +
      "hold the three bands summed again, with a dip for the mid.\n\n" +
      "Patch a sound into In L/R, take the band outputs wherever you like and bring them together again later. Low Split and High Split " +
      "are added to the two crossover frequencies; Mid Dip lowers the mid band in the summed output only.\n\n" +
      "Tip: put a saturator on the lows and a delay on the highs, and mix them back on a separate mixer.",
    inputs: [["lowsplit", "Low Split"], ["highsplit", "High Split"], ["middip", "Mid Dip"]],
  }).output("ll", "Low L").output("lr", "Low R").output("ml", "Mid L").output("mr", "Mid R").output("hl", "High L").output("hr", "High R");
  const lo = p.add("filter", [0, 0], { mode: "LP", cutoff: 200, type: "SVF Multimode" }, { name: "Low" });
  const rest = p.add("filter", [0, 1], { mode: "HP", cutoff: 200, type: "SVF Multimode" }, { name: "Upper" });
  const mid = p.add("filter", [1, 1], { mode: "LP", cutoff: 3000, type: "SVF Multimode" }, { name: "Mid" });
  const hi = p.add("filter", [1, 2], { mode: "HP", cutoff: 3000, type: "SVF Multimode" }, { name: "High" });
  const sum = p.add("audio-mixer", [2, 1], {}, { name: "Sum" });
  p.stereo(p.cin, lo).stereo(p.cin, rest).stereo(rest, mid).stereo(rest, hi)
    .cable(lo, "l", p.cout, "ll").cable(lo, "r", p.cout, "lr").cable(mid, "l", p.cout, "ml").cable(mid, "r", p.cout, "mr")
    .cable(hi, "l", p.cout, "hl").cable(hi, "r", p.cout, "hr")
    .cable(lo, "l", sum, "in1l").cable(lo, "r", sum, "in1r").cable(mid, "l", sum, "in2l").cable(mid, "r", sum, "in2r")
    .cable(hi, "l", sum, "in3l").cable(hi, "r", sum, "in3r")
    .cable(sum, "outl", p.cout, "l").cable(sum, "outr", p.cout, "r")
    .cable(p.cin, "lowsplit", lo, "cutoff", 0.15).cable(p.cin, "lowsplit", rest, "cutoff", 0.15)
    .cable(p.cin, "highsplit", mid, "cutoff", 0.15).cable(p.cin, "highsplit", hi, "cutoff", 0.15)
    .cable(p.cin, "middip", sum, "level2", -0.4);
  return p;
}

// ---------------------------------------------------------------- 12

function airExciter() {
  const p = fx("Air Exciter", {
    description: "Adds sheen on top: the highs are cut out, saturated, widened with a slow chorus and blended back in. Shared inputs Air, Freq, Drive and Width.",
    tags: ["exciter", "saturation", "brightness", "enhancer"],
    help: "A high-pass filter takes only the top of the sound, a Saturator creates new harmonics from it, a Chorus spreads those across " +
      "the stereo field and a VCA sets how much of it is added to the untouched input.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Air is added to the amount of exciter blended in, Freq to the high-pass " +
      "frequency (higher is airier and thinner), Drive to the saturation and Width to the chorus mix.\n\n" +
      "Tip: it works best on dull recordings; if the result gets hissy, lower Freq's range or turn Drive down rather than Air.",
    inputs: [["air", "Air"], ["freq", "Freq"], ["drive", "Drive"], ["width", "Width"]],
    tail: 3,
  });
  const hp = p.add("filter", [1, 0], { mode: "HP", cutoff: 5000, type: "SVF Multimode" }, { name: "Top" });
  const sat = p.add("saturator", [2, 0], { drive: 0.55, bias: 0.15, character: "Tube", mix: 1, sag: 0, age: 0 }, { name: "Harmonics" });
  const wide = p.add("chorus", [3, 0], { rate: 0.3, depth: 0.3, mix: 0.5 }, { name: "Widen" });
  const amt = p.add("vca", [4, 0], { gain: 0.35, response: "Linear" }, { name: "Air" });
  const mix = p.add("audio-mixer", [5, 0], { limiter: false }, { name: "Sum" });
  p.stereo(p.cin, hp).stereo(hp, sat).stereo(sat, wide).stereo(wide, amt)
    .stereo(p.cin, mix, { to: ["in1l", "in1r"] }).cable(amt, "l", mix, "in2l").cable(amt, "r", mix, "in2r")
    .cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r")
    .cable(p.cin, "air", amt, "gain", 0.5).cable(p.cin, "freq", hp, "cutoff", 0.1)
    .cable(p.cin, "drive", sat, "drive", 0.5).cable(p.cin, "width", wide, "mix", 0.5);
  return p;
}

// ---------------------------------------------------------------- 13

function dynamicBand() {
  const p = fx("Dynamic Band", {
    description: "One equaliser band whose gain rides the loudness: it can bloom or dip as you play, and it can listen to a second signal instead. Shared inputs Range, Freq, Speed and Key.",
    tags: ["eq", "dynamic", "envelope", "sidechain"],
    help: "An Envelope Follower reads the loudness of the input (and of the Key input if you patch one); a Utility scales it by the Range " +
      "amount and adds it to the gain of a bell band of the EQ at 3 kHz. With a positive scale the band swells with louder playing, with a " +
      "negative scale it dips, which is a de-esser or a duck for one part of the spectrum.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Range is added to the scale (below zero it turns the effect around), Freq to " +
      "the band frequency, Speed to the follower release, and Key is an extra audio input the band also listens to.\n\n" +
      "Tip: feed a kick into Key and put the band at 80 Hz on a bass: the bass opens up on every kick.",
    inputs: [["range", "Range"], ["freq", "Freq"], ["speed", "Speed"], ["key", "Key", "audio"]],
  });
  const fol = p.add("envelope-follower", [0, 1], { attack: 0.005, release: 0.15, gain: 3 }, { name: "Listener" });
  const range = p.add("utility", [1, 1], { scalex: 0.45 }, { name: "Range" });
  const eq = p.add("eq", [2, 0], { b2On: false, b3On: true, b3Type: "Bell", b3Hz: 3000, b3Q: 1.4, b4On: false, b5On: false });
  p.cable(p.cin, "l", fol, "in").cable(p.cin, "r", fol, "in").cable(p.cin, "key", fol, "in")
    .cable(fol, "env", range, "x").cable(range, "out", eq, "b3Gain")
    .stereo(p.cin, eq).stereo(eq, p.cout)
    .cable(p.cin, "range", range, "scalex", 0.5).cable(p.cin, "freq", eq, "b3Hz", 0.15).cable(p.cin, "speed", fol, "release", 0.1);
  return p;
}

// ---------------------------------------------------------------- 14

function octavePair() {
  const p = fx("Octave Pair", {
    description: "The dry sound with two sub copies, one and two octaves down, each darkened and drifting a little. Shared inputs Sub 1, Sub 2, Tone and Detune.",
    tags: ["octave", "sub", "pitch", "bass"],
    help: "Two Pitch Shifters move the input down 12 and 24 semitones. Each goes through a low-pass filter so the copies stay round, " +
      "and an Audio Mixer blends them under the dry signal.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Sub 1 and Sub 2 are added to the two copies' levels, Tone to both low-pass frequencies and " +
      "Detune to the fine tuning of both, one up and one down, which gives a slow beat between them.\n\n" +
      "Tip: it works best on single lines such as a bass or a lead; chords make the lowest copies muddy.",
    inputs: [["sub1", "Sub 1"], ["sub2", "Sub 2"], ["tone", "Tone"], ["detune", "Detune"]],
  });
  const o1 = p.add("pitch-shifter", [1, 0], { pitch: -12, window: 90, drift: 0.1, mix: 1 }, { name: "Octave Down" });
  const o2 = p.add("pitch-shifter", [1, 1], { pitch: -24, window: 140, drift: 0.15, mix: 1 }, { name: "Two Octaves Down" });
  const f1 = p.add("filter", [2, 0], { mode: "LP", cutoff: 1800, type: "SVF Multimode" }, { name: "Tone 1" });
  const f2 = p.add("filter", [2, 1], { mode: "LP", cutoff: 900, type: "SVF Multimode" }, { name: "Tone 2" });
  const mix = p.add("audio-mixer", [3, 0], { level2: -4, level3: -8 }, { name: "Blend" });
  p.stereo(p.cin, o1).stereo(p.cin, o2).stereo(o1, f1).stereo(o2, f2)
    .stereo(p.cin, mix, { to: ["in1l", "in1r"] })
    .cable(f1, "l", mix, "in2l").cable(f1, "r", mix, "in2r").cable(f2, "l", mix, "in3l").cable(f2, "r", mix, "in3r")
    .cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r")
    .cable(p.cin, "sub1", mix, "level2", 0.3).cable(p.cin, "sub2", mix, "level3", 0.3)
    .cable(p.cin, "tone", f1, "cutoff", 0.15).cable(p.cin, "tone", f2, "cutoff", 0.15)
    .cable(p.cin, "detune", o1, "fine", 0.05).cable(p.cin, "detune", o2, "fine", -0.05);
  return p;
}

// ---------------------------------------------------------------- 15

function intervalStack() {
  const p = fx("Interval Stack", {
    description: "Layers the input with three pitch-shifted copies that follow the chord of the board's Harmony Master, gliding when the chord changes. Shared inputs Stack, Glide and Spread.",
    tags: ["harmony", "pitch", "chord", "shifter"],
    help: "A Harmony Master supplies the board's chord. Three Math rows subtract its root from three chord tones, which gives the intervals " +
      "above the root; a Utility slew per interval smooths them, and each result sets the pitch of a Pitch Shifter. An Audio Mixer puts the " +
      "dry sound and the three copies together, with the copies panned apart.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Stack is added to the levels of the three copies, Glide to the time they slide to a " +
      "new chord, and Spread to how far the copies sit left and right. Change the chord with a Harmony Master elsewhere on the board.\n\n" +
      "Tip: it is clearest on a single sustained note; change the chord with a progression and listen to the layers glide.",
    inputs: [["stack", "Stack"], ["glide", "Glide"], ["spread", "Spread"]],
  });
  const hm = p.add("harmony-master", [0, 1], { quality: "Diatonic Seventh" }, { name: "Chord" });
  const mathA = p.add("math", [1, 0], { op1: "Subtract", op2: "Subtract" }, { name: "Intervals A" });
  const mathB = p.add("math", [1, 1], { op1: "Subtract" }, { name: "Intervals B" });
  p.cable(hm, "tone2", mathA, "ina1").cable(hm, "root", mathA, "inb1").cable(hm, "tone3", mathA, "ina2").cable(hm, "root", mathA, "inb2")
    .cable(hm, "tone4", mathB, "ina1").cable(hm, "root", mathB, "inb1");
  const mix = p.add("audio-mixer", [5, 1], { level2: -6, level3: -6, level4: -6, pan2: -0.5, pan3: 0.5 }, { name: "Stack" });
  p.stereo(p.cin, mix, { to: ["in1l", "in1r"] })
    .cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r");
  [[mathA, "out1"], [mathA, "out2"], [mathB, "out1"]].forEach(([m, jack], i) => {
    const glide = p.add("utility", [2, i], { slew: 0.12 }, { name: `Glide ${i + 1}` });
    const sh = p.add("pitch-shifter", [3, i], { pitch: 0, window: 90, drift: 0.05, mix: 1 }, { name: `Voice ${i + 1}` });
    p.cable(m, jack, glide, "x").cable(glide, "out", sh, "pitch", 0.25).stereo(p.cin, sh)
      .cable(sh, "l", mix, `in${i + 2}l`).cable(sh, "r", mix, `in${i + 2}r`)
      .cable(p.cin, "stack", mix, `level${i + 2}`, 0.3).cable(p.cin, "glide", glide, "slew", 0.05);
  });
  p.cable(p.cin, "spread", mix, "pan2", -0.5).cable(p.cin, "spread", mix, "pan3", 0.5);
  return p;
}

// ---------------------------------------------------------------- 16

function dustAndCrackle() {
  const p = fx("Dust & Crackle", {
    description: "Makes any sound feel like a worn record: it is band-limited, crushed, wobbled, and dusted with random pops that appear only while the music plays. Shared inputs Wear, Dust, Crackle and Warp.",
    tags: ["lofi", "vinyl", "noise", "degrade", "character"],
    help: "An EQ cuts the lows and the highs and adds a mid bump, a Crunch bit-crushes and lowers the sample rate, and a slow Chorus " +
      "adds wow. Next to that, a Pulse Generator runs at irregular intervals, each pulse is multiplied by white noise so every pop has its own " +
      "size and sign, and a second Crunch roughens it. An Envelope Follower on the input opens a VCA for the crackle, so the dust only " +
      "shows up while there is sound, and fades with the tail.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Wear is added to the sample-rate reduction, Dust to how often the pops come, " +
      "Crackle to their level and Warp to the depth of the wow.\n\n" +
      "Tip: for a scratchy intro raise Dust and Crackle together and keep Wear low.",
    inputs: [["wear", "Wear"], ["dust", "Dust"], ["crackle", "Crackle"], ["warp", "Warp"]],
    tail: 4,
  });
  const eq = p.add("eq", [1, 0], { b1On: true, b1Type: "Low Cut", b1Hz: 80, b2On: false, b3On: true, b3Type: "Bell", b3Hz: 1800, b3Gain: 3, b4On: false, b5On: false, b6On: true, b6Type: "High Cut", b6Hz: 6500 }, { name: "Worn EQ" });
  const crush = p.add("crunch", [2, 0], { drive: 0.2, bits: 12, rate: 0.15, tone: 9000, mix: 1 }, { name: "Crush" });
  const wow = p.add("chorus", [3, 0], { rate: 0.5, depth: 0.08, mix: 0.5 }, { name: "Wow" });
  const pg = p.add("pulse-generator", [0, 1], { period: 0.07, width: 0.0002, jitter: 1 }, { name: "Pops" });
  const nz = p.add("noise", [0, 2], {}, { name: "Size" });
  const size = p.add("multiplier", [1, 1], {}, { name: "Pop Size" });
  const crack = p.add("crunch", [2, 1], { drive: 0.5, bits: 10, rate: 0.3, tone: 7000, mix: 1 }, { name: "Roughen" });
  const fol = p.add("envelope-follower", [1, 2], { attack: 0.01, release: 0.25, gain: 4 }, { name: "Playing" });
  const gate = p.add("vca", [3, 1], { gain: 0, response: "Linear" }, { name: "Crackle Gate" });
  const mix = p.add("audio-mixer", [4, 0], { level2: -12, limiter: true }, { name: "Sum" });
  p.stereo(p.cin, eq).stereo(eq, crush).stereo(crush, wow).stereo(wow, mix, { to: ["in1l", "in1r"] })
    .cable(pg, "out", size, "x1").cable(nz, "white", size, "y1")
    .cable(size, "out1", crack, "l").cable(size, "out1", crack, "r")
    .cable(crack, "l", gate, "l").cable(crack, "r", gate, "r")
    .cable(p.cin, "l", fol, "in").cable(p.cin, "r", fol, "in").cable(fol, "env", gate, "gain")
    .cable(gate, "l", mix, "in2l").cable(gate, "r", mix, "in2r")
    .cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r")
    .cable(p.cin, "wear", crush, "rate", 0.5).cable(p.cin, "dust", pg, "period", -0.12)
    .cable(p.cin, "crackle", gate, "gain", 0.25).cable(p.cin, "warp", wow, "depth", 0.3);
  return p;
}

// ---------------------------------------------------------------- 17

function bucketEcho() {
  const p = fx("Bucket Echo", {
    description: "An echo that gets darker, dirtier and wobblier with every repeat, because the saturation, the low-pass filter and a drifting delay time all sit inside its feedback loop. Shared inputs Time, Feedback, Dark, Age and Mix.",
    tags: ["delay", "analog", "dark", "feedback", "lofi"],
    help: "The dry sound and the feedback return meet in a mixer and go into a Delay. What comes out passes a Saturator and a low-pass filter, " +
      "then a VCA that sets the feedback and returns to the mixer, so each repeat is warmer and duller than the one before. A slow LFO, scaled by " +
      "Age, makes the delay time drift. The mixer's limiter keeps the loop from running away.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Time is added to the delay time, Feedback to the feedback amount, Dark to the " +
      "filter (positive makes it darker), Age to the drift and Mix to the dry/wet balance.\n\n" +
      "Tip: with Feedback high the loop self-oscillates into a murky drone; pull Dark back to keep it alive.",
    inputs: [["time", "Time"], ["fb", "Feedback"], ["dark", "Dark"], ["age", "Age"], ["mix", "Mix"]],
    tail: 12,
  });
  const sum = p.add("audio-mixer", [1, 0], { limiter: true }, { name: "Loop In" });
  const dly = p.add("delay", [2, 0], { timel: 320, timer: 320, feedback: 0, mix: 1, lowcut: 80, highcut: 20000 }, { name: "Delay" });
  const sat = p.add("saturator", [3, 0], { drive: 0.3, character: "Tape", mix: 1, sag: 0, age: 0 }, { name: "Warm" });
  const flt = p.add("filter", [4, 0], { mode: "LP", cutoff: 3500, resonance: 0.1, type: "SVF Multimode" }, { name: "Darken" });
  const fb = p.add("vca", [4, 1], { gain: 0.3, response: "Linear" }, { name: "Feedback" });
  const drift = p.add("lfo", [2, 1], { rate: 0.7 }, { name: "Drift" });
  const age = p.add("multiplier", [3, 1], { gain1: 0.3 }, { name: "Age" });
  p.stereo(p.cin, sum, { to: ["in1l", "in1r"] }).cable(sum, "outl", dly, "l").cable(sum, "outr", dly, "r")
    .stereo(dly, sat).stereo(sat, flt).stereo(flt, fb)
    .cable(fb, "l", sum, "in2l").cable(fb, "r", sum, "in2r")
    .cable(drift, "out", age, "x1").cable(age, "out1", dly, "timel", 0.02).cable(age, "out1", dly, "timer", 0.02)
    .cable(p.cin, "time", dly, "timel", 0.2).cable(p.cin, "time", dly, "timer", 0.2)
    .cable(p.cin, "fb", fb, "gain", 0.3).cable(p.cin, "dark", flt, "cutoff", -0.2)
    .cable(p.cin, "age", age, "gain1", 0.125).cable(p.cin, "age", sat, "drive", 0.3);
  blend(p, [5, 0], flt, ["l", "r"], 0.5);
  return p;
}

// ---------------------------------------------------------------- 18

function quadGates() {
  const p = fx("Quad Gates", {
    description: "Four low-pass gates side by side, each opened by its own LFO speed and spread across the stereo field, with a trigger input for each. Shared inputs Rate, Open, Tone, Ping 1 to 4 and Mix.",
    tags: ["gate", "lowpass", "rhythm", "pulse", "movement"],
    help: "The input goes to four Low Pass Gates. A Quad LFO in Divide mode runs them at rate ratios of 1, 1/2, 1/3 and 1/4, so their " +
      "openings meet and part in a repeating pattern. Each gate has its own tone and pan, from dull and left to bright and right, and an " +
      "Audio Mixer sums them.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Rate is added to the LFO speed, Open to how far all gates stay open, Tone " +
      "to their brightness and Mix to the dry/wet balance. A trigger into Ping 1 to 4 plucks the matching gate on its own, which is the way to " +
      "play it from a sequencer.\n\n" +
      "Tip: feed it a sustained pad; the four gates draw a slowly changing rhythm out of it.",
    inputs: [["rate", "Rate"], ["open", "Open"], ["tone", "Tone"], ["ping1", "Ping 1", "trigger"], ["ping2", "Ping 2", "trigger"],
             ["ping3", "Ping 3", "trigger"], ["ping4", "Ping 4", "trigger"], ["mix", "Mix"]],
    tail: 1,
  });
  const lfo = p.add("quad-lfo", [0, 0], { mode: "Divide", rate1: 2, polarity: "Unipolar", wave1: "Triangle", wave2: "Triangle", wave3: "Triangle", wave4: "Triangle" }, { name: "Openings" });
  const mix = p.add("audio-mixer", [2, 1], { level1: -6, level2: -6, level3: -6, level4: -6, pan1: -0.8, pan2: -0.3, pan3: 0.3, pan4: 0.8 }, { name: "Gates" });
  p.cable(p.cin, "rate", lfo, "rate1", 0.15);
  for (let i = 1; i <= 4; i++) {
    const g = p.add("low-pass-gate", [1, i - 1], { level: 0, brightness: 0.2 + 0.2 * i, response: 0.4 }, { name: `Gate ${i}` });
    p.stereo(p.cin, g).cable(lfo, `out${i}`, g, "cv").cable(p.cin, `ping${i}`, g, "ping")
      .cable(g, "l", mix, `in${i}l`).cable(g, "r", mix, `in${i}r`)
      .cable(p.cin, "open", g, "level", 0.5).cable(p.cin, "tone", g, "brightness", 0.5);
  }
  blend(p, [3, 1], mix, ["outl", "outr"], 0.8);
  return p;
}

// ---------------------------------------------------------------- 19

function bandSculptor() {
  const p = fx("Band Sculptor", {
    description: "Ten frequency bands, each one's volume steered by how loud that band already is: push Sculpt up and the strong bands get stronger, pull it down and they even out. Shared inputs Sculpt, Tilt, Shift and Mix.",
    tags: ["filter-bank", "spectral", "dynamics", "vocoder", "morph"],
    help: "A Filter Bank splits the sound into ten bands and reports the loudness of each. Every band goes to its own VCA, whose gain is " +
      "a base level plus that band's loudness multiplied by Sculpt. With Sculpt positive the peaks of the spectrum are exaggerated; negative " +
      "flattens them. Odd bands go to the left and even bands to the right, so the result is wide as well.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Sculpt is added to the sculpting amount, Tilt to the bank's tilt, Shift to " +
      "how far the whole set of bands moves up or down in pitch, and Mix to the dry/wet balance.\n\n" +
      "Tip: modulate Shift with a slow LFO on a held chord for a moving, vowel-like colour.",
    inputs: [["sculpt", "Sculpt"], ["tilt", "Tilt"], ["shift", "Shift"], ["mix", "Mix"]],
  });
  const bank = p.add("filter-bank", [0, 0], { jacks: "Bands + Envs", q: 4, attack: 0.005, release: 0.12 }, { name: "Bands" });
  p.stereo(p.cin, bank).cable(p.cin, "tilt", bank, "tilt", 0.5).cable(p.cin, "shift", bank, "shift", 0.25);
  const odd = {}, even = {};
  for (let i = 1; i <= 10; i++) {
    if (i <= 8) (i % 2 ? odd : even)[i] = 1;
  }
  const g1 = p.add("matrix-mixer", [3, 0], matrixValues({ 1: odd, 2: even }), { name: "Gather" });
  const g2 = p.add("matrix-mixer", [4, 0], matrixValues({ 1: { 1: 1, 3: 1 }, 2: { 2: 1, 4: 1 } }), { name: "Sum" });
  const mults = [];
  for (let i = 1; i <= 10; i++) {
    if (i % 2 === 1) mults.push(p.add("multiplier", [1, (i - 1) / 2], { biasy1: 0.5, biasy2: 0.5, gain1: 1, gain2: 1 }, { name: `Sculpt ${i}-${i + 1}` }));
    const m = mults[mults.length - 1], k = i % 2 === 1 ? 1 : 2;
    const v = p.add("vca", [2, i - 1], { gain: 1.5, response: "Linear" }, { name: `Band ${i}` });
    p.cable(bank, `env${i}`, m, `x${k}`).cable(p.cin, "sculpt", m, `y${k}`, 0.5)
      .cable(m, `out${k}`, v, "gain").cable(bank, `band${i}`, v, "l");
    if (i <= 8) p.cable(v, "l", g1, `in${i}`);
    else p.cable(v, "l", g2, `in${i - 8}`);
  }
  p.cable(g1, "out1", g2, "in3").cable(g1, "out2", g2, "in4");
  blend(p, [5, 0], g2, ["out1", "out2"], 0.85);
  return p;
}

// ---------------------------------------------------------------- 20

function quadAmp() {
  const p = cell("Quad Amp", {
    description: "Four VCAs in one cell with a shared response control that bends their gain CV from straight to squared, a mix bus with spread and master, and a direct output for each channel. Shared inputs In 1 to 4, Gain 1 to 4, Response and Master.",
    tags: ["vca", "mixer", "amplifier", "utility"],
    help: "Each of the four inputs has its own VCA. Its gain is one by default plus the Gain CV for that channel, which makes the channel " +
      "louder when you patch an envelope (up to twice) and leaves it alone when nothing is patched. A Multiplier squares the CV, and a Crossfader " +
      "blends between the straight and the squared CV with Response, so the same envelope can move from a linear to a curved swell.\n\n" +
      "Patch audio into In 1 to 4. Out L/R is the mix bus (a four-channel mixer with its channels spread from left to right, and a limiter); " +
      "Out 1 to 4 are the VCAs on their own, before the mixer. Response is added to the crossfade and Master to the mixer's master level.\n\n" +
      "Tip: one envelope into Gain 1 and Gain 2 and another into Gain 3 and Gain 4 makes a quick four-way cross-swell.",
  }).input("in1", "In 1", "audio").input("in2", "In 2", "audio").input("in3", "In 3", "audio").input("in4", "In 4", "audio")
    .input("g1", "Gain 1").input("g2", "Gain 2").input("g3", "Gain 3").input("g4", "Gain 4")
    .input("resp", "Response").input("master", "Master")
    .stereoOut().output("o1", "Out 1").output("o2", "Out 2").output("o3", "Out 3").output("o4", "Out 4")
    .plays({ effect: { in: ["in1", "in2"], out: ["l", "r"], tail: 0 } });
  const mix = p.add("audio-mixer", [4, 1], { pan1: -0.9, pan2: -0.3, pan3: 0.3, pan4: 0.9, limiter: true }, { name: "Bus" });
  for (const [pair, row] of [[[1, 2], 0], [[3, 4], 2]]) {
    const sq = p.add("multiplier", [1, row], {}, { name: `Squared ${pair[0]}-${pair[1]}` });
    const curve = p.add("crossfader", [2, row], { fade: 0.2, curve: "Linear" }, { name: `Response ${pair[0]}-${pair[1]}` });
    p.cable(p.cin, `g${pair[0]}`, sq, "x1").cable(p.cin, `g${pair[0]}`, sq, "y1")
      .cable(p.cin, `g${pair[1]}`, sq, "x2").cable(p.cin, `g${pair[1]}`, sq, "y2")
      .cable(p.cin, `g${pair[0]}`, curve, "al").cable(p.cin, `g${pair[1]}`, curve, "ar")
      .cable(sq, "out1", curve, "bl").cable(sq, "out2", curve, "br")
      .cable(p.cin, "resp", curve, "fade", 1);
    pair.forEach((n, j) => {
      const v = p.add("vca", [3, row + j], { gain: 1, response: "Linear" }, { name: `Amp ${n}` });
      p.cable(p.cin, `in${n}`, v, "l").cable(p.cin, `in${n}`, v, "r")
        .cable(curve, j ? "outr" : "outl", v, "gain")
        .cable(v, "l", p.cout, `o${n}`).cable(v, "l", mix, `in${n}l`).cable(v, "r", mix, `in${n}r`);
    });
  }
  p.cable(p.cin, "master", mix, "master", 0.3).cable(mix, "outl", p.cout, "l").cable(mix, "outr", p.cout, "r");
  return p;
}

export default category("Processing",
  "Dynamics, stereo, spectral and character effects: tremolo and rotary movement, mid-side and band splits, gates and ducking, tape slowdown and worn-record degradation.",
  [twinTremolo, whirl, midSideLab, swingPan, punchShaper, bandEchoes, gateVerb, duckedEcho, tapeStop, threeBandSqueeze,
   threeWaySplit, airExciter, dynamicBand, octavePair, intervalStack, dustAndCrackle, bucketEcho, quadGates, bandSculptor, quadAmp]);
