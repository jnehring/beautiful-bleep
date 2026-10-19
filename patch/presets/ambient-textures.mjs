// SPDX-License-Identifier: MIT
// Ambient Textures: noise, grains, resonances and spectra that evolve slowly: weather and rooms rather than notes. Each one
// sounds on its own as soon as it is placed and needs no transport. Out L/R out.
import { cell, category, semis } from "./kit.mjs";
import { bed, sendReturn, hall } from "./ambient-kit.mjs";

// Pink noise rings a four-voice modal resonator whose body slowly changes.
function frozenLake() {
  const p = cell("Frozen Lake", {
    description: "A stream of pink noise excites a resonant body of four voices that slowly changes structure: a thin, glassy ring like wind across the ice. Shared input Thaw (damping).",
    tags: ["ambient", "texture", "resonator", "ice", "cold"],
    help: "A Noise module in pink goes into a Resonator in Modal mode with four voices. The constant noise keeps the modes ringing, so " +
      "you hear their pitches as a soft tone cluster. Organic LFOs move Structure (from string-like to plate-like), Brightness and the " +
      "tuning by a few semitones. A hall around it makes the lake.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Thaw input is added to Damping: higher makes the ring " +
      "shorter and warmer, lower makes it glassier and thinner.\n\n" +
      "Tip: Frequency sets the pitch of the whole cluster; lower it by twelve for a bigger, darker lake.",
  }).input("thaw", "Thaw").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.03, spread: 0.7, drift: 0.5, seed: 8 });
  const wind = p.add("noise", [1, 0], { colour: -0.2, level: 0.4 }, { name: "Wind" });
  const res = p.add("resonator", [2, 0], { model: "Modal", polyphony: "4", frequency: -5, structure: 0.35, brightness: 0.65, damping: 0.25, inputgain: -6, width: 1, dry: 0 });
  p.cable(wind, "out", res, "in").cable(lfo, "out1", res, "structure", 0.3).cable(lfo, "out2", res, "brightness", 0.2)
    .cable(lfo, "out3", res, "frequency", 0.03).cable(p.cin, "thaw", res, "damping", 0.4);
  const mix = bed(p, [3, 0], [{ node: res, mono: "mix", level: -6 }], { master: -1 });
  hall(p, mix, [4, 0], { size: 0.8, decay: 9, damping: 0.4, mix: 0.45 });
  return p;
}

// A chord into a granular cloud that feeds back on itself.
function grainFog() {
  const p = cell("Grain Fog", {
    description: "A soft major-seventh chord is recorded into a granular cloud that plays it back in large, overlapping grains drifting in position and pitch, with feedback so the cloud thickens and thins. Shared input Density.",
    tags: ["ambient", "texture", "granular", "cloud", "fog"],
    help: "A Chord Osc plays a major seventh through a gentle filter into a Grains module. Organic LFOs move the read position, the grain size " +
      "and the pitch scatter, while Feedback and Blur let the grains pile into a cloud. The result goes through a hall.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Density input is added to the density of the grains: " +
      "at the low end a few separate swells, at the high end a solid fog.\n\n" +
      "Tip: Pitch Quant on the Grains module sets what the scatter is rounded to: Octaves + fifths keeps it consonant.",
  }).input("density", "Density").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.04, spread: 0.6, drift: 0.5, seed: 19 });
  const ch = p.add("chord-osc", [1, 1], { chord: "Major 7", octave: "0", voices: 4, detune: 8, stereo: 0.7, shape: 0.35 }, { name: "Source Chord" });
  const flt = p.add("filter", [2, 1], { cutoff: 1500, resonance: 0.1, type: "SVF Multimode" }, { name: "Soften" });
  const gr = p.add("grains", [3, 1], { position: 0.5, size: 0.6, pitch: 0, density: 0.6, texture: 0.6, spread: 0.8, pitchjitter: 4,
    feedback: 0.5, blur: 0.5, mix: 1, buffer: "8 s", pitchquant: "Octaves + fifths", maxgrains: "32", seed: 12 });
  p.stereo(ch, flt).stereo(flt, gr).cable(lfo, "out1", gr, "position", 0.3).cable(lfo, "out2", gr, "size", 0.1)
    .cable(lfo, "out3", gr, "pitchjitter", 0.1).cable(p.cin, "density", gr, "density", 0.4);
  const mix = bed(p, [4, 1], [{ node: gr, level: -6 }], { master: -2 });
  hall(p, mix, [5, 1], { size: 0.85, decay: 10, mix: 0.4 });
  return p;
}

// White noise through a stereo dual filter whose cutoffs wander with two random curves.
function breathingWind() {
  const p = cell("Breathing Wind", {
    description: "Noise through a pair of resonant band-passes, one per ear, that wander on slow random curves while the whole wind swells and sinks over about half a minute: weather on a high, empty moor. Shared input Gust.",
    tags: ["ambient", "texture", "wind", "noise", "weather"],
    help: "A Noise module goes into a Dual Filter in Stereo routing, so each ear has its own resonant band-pass. An Uncertainty " +
      "module's two fluctuating curves move the Cutoff and the Spread of the filters, so the whistling moves around. A Tidal " +
      "module in Loop mode opens and closes a VCA over about thirty seconds, which is the breathing. A little room finishes it.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Gust input is added to the Cutoff: " +
      "it makes the wind higher and more whistling.\n\n" +
      "Tip: turn the resonances (Res 1 and Res 2) up for a thin howl, or down for a soft rush.",
  }).input("gust", "Gust").stereoOut();
  const un = p.add("uncertainty", [0, 1], { f1rate: 0.12, f2rate: 0.09, f1spread: 0.9, f2spread: 0.9, seed: 15 });
  const breath = p.add("tidal", [0, 2], { freq: 0.035, skew: 0.45, mode: "Loop", range: "Slow", polarity: "Unipolar" }, { name: "Breath" });
  const depth = p.add("utility", [1, 2], { scalex: 0.7, offset: 0.3 }, { name: "Breath Depth" });
  const air = p.add("noise", [1, 0], { colour: 0.2, level: 0.8 }, { name: "Air" });
  const df = p.add("dual-filter", [2, 0], { cutoff: 700, spread: 1.4, res1: 0.55, res2: 0.5, mode1: 0.5, mode2: 0.5, routing: "Stereo", drive: 0.1 });
  const amp = p.add("vca", [3, 0], { response: "Linear" }, { name: "Breath VCA" });
  p.cable(air, "out", df, "l").cable(air, "out", df, "r").cable(un, "fluct1", df, "cutoff", 0.25).cable(un, "fluct2", df, "spread", 0.12)
    .cable(p.cin, "gust", df, "cutoff", 0.3).cable(breath, "a", depth, "x").cable(depth, "out", amp, "gain").stereo(df, amp);
  const mix = bed(p, [4, 0], [{ node: amp, level: 4 }], { master: -1 });
  hall(p, mix, [5, 0], { size: 0.6, decay: 4, mix: 0.3 });
  return p;
}

// Random gates open a long swell on dark brown noise: far-off thunder.
function distantThunder() {
  const p = cell("Distant Thunder", {
    description: "Rare random gates open long, slow swells on dark brown noise that grumble and roll away into a big room: thunder somewhere beyond the hills. Shared input Storm (more rolls).",
    tags: ["ambient", "texture", "thunder", "storm", "dark"],
    help: "A Recall module in Chance mode, running free on its own clock, throws a rare gate. It opens an ADSR with a long attack and release, " +
      "which swells a VCA on brown Noise through a low-pass whose cutoff rises with the swell. A second, slower voice with a lower filter " +
      "rolls underneath. A large hall carries the rumble away.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Storm input is added to the gate bias of Recall: " +
      "higher means more thunder.\n\n" +
      "Tip: put it under a rain cell, such as Tin Roof Rain, for a storm.",
  }).input("storm", "Storm").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.3, trecall: 0.2, tloop: 8, gatelength: 0.1, rate: 0.5, sync: "Free", seed: 33 });
  p.cable(p.cin, "storm", rc, "tbias", 0.4);
  const mix = p.add("audio-mixer", [3, 1], { level1: 0, pan1: -0.3, level2: 2, pan2: 0.3, master: -2 });
  [["Roll", "t1", 1.2, 5, 420, -0.9], ["Rumble", "t2", 3.5, 7, 150, -1]].forEach(([name, gate, attack, release, cutoff, colour], i) => {
    const nz = p.add("noise", [1, i * 2], { colour, level: 0.9 }, { name: `${name} Noise` });
    const env = p.add("adsr", [1, i * 2 + 1], { attack, decay: 3, sustain: 0.3, release }, { name: `${name} Env` });
    const flt = p.add("filter", [2, i * 2], { cutoff, resonance: 0.15, type: "Ladder Tanh" }, { name: `${name} Filter` });
    const amp = p.add("vca", [2, i * 2 + 1], { response: "Linear" }, { name: `${name} VCA` });
    p.cable(rc, gate, env, "gate").cable(nz, "out", flt, "l").cable(nz, "out", flt, "r").cable(env, "env", flt, "cutoff", 0.25)
      .stereo(flt, amp).cable(env, "env", amp, "gain").stereo(amp, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  hall(p, mix, [4, 1], { size: 0.95, decay: 12, damping: 0.55, mix: 0.5 });
  return p;
}

// Two sine voices that slide on slow random curves into a dark long echo: whale calls.
function whaleSong() {
  const p = cell("Whale Song", {
    description: "Two sine voices a fifth apart that slide up and down on slow random curves and fade in and out of the dark, repeating into a long echo: calls across a very large ocean. Shared input Depth (echo).",
    tags: ["ambient", "texture", "whale", "ocean", "glide", "echo"],
    help: "Two Oscillators in sine shape are bent in pitch by the smooth and wobble outputs of a Wobble module (a random stream), by up to " +
      "seven semitones, so they glide in long calls. An Uncertainty module's curves fade each voice in and out through a VCA. " +
      "A Delay Network with a lot of feedback and a dark tone repeats the calls, then a vast hall.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Depth input is added to the delay feedback: " +
      "higher builds a chorus of echoes.\n\n" +
      "Tip: slow Wobble's Rate for fewer, longer calls.",
  }).input("depth", "Depth").stereoOut();
  const wob = p.add("wobble", [0, 0], { rate: 0.09, smooth: 0.7, wobble: 0.5, level: 1, seed: 9 });
  const un = p.add("uncertainty", [0, 2], { f1rate: 0.07, f2rate: 0.05, f1spread: 1, f2spread: 1, seed: 22 });
  const mix = p.add("audio-mixer", [3, 1], { level1: 0, pan1: -0.4, send1: -4, level2: -2, pan2: 0.4, send2: -3, return: -3, master: -1 });
  [["Call 1", -1, 0, "smooth", "fluct1", 7], ["Call 2", -1, 7, "wobble", "fluct2", 5]].forEach(([name, octave, coarse, pitchOut, ampOut, range], i) => {
    const o = p.add("oscillator", [1, i * 2], { octave: String(octave), coarse, shape: 0 }, { name });
    const lvl = p.add("utility", [1, i * 2 + 1], { scalex: 0.5, offset: 0.4 }, { name: `${name} Level` });
    const amp = p.add("vca", [2, i], { response: "Linear" }, { name: `${name} VCA` });
    p.cable(wob, pitchOut, o, "pitch", semis(range)).cable(un, ampOut, lvl, "x").cable(lvl, "out", amp, "gain")
      .cable(o, "out", amp, "l").cable(o, "out", amp, "r").stereo(amp, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const dly = p.add("delay-network", [4, 2], { time: 1.1, taps: 4, feedback: 0.6, scatter: 0.3, jitter: 0.15, tone: -0.5, character: 0.3, width: 1, mix: 1, routing: "Mesh" });
  p.cable(p.cin, "depth", dly, "feedback", 0.2);
  sendReturn(p, mix, dly);
  hall(p, mix, [5, 1], { size: 0.95, decay: 14, damping: 0.5, mix: 0.5 });
  return p;
}

// Noise through a filter bank tuned to a harmonic series, its bands scanned by slow LFOs.
function spectralShimmer() {
  const p = cell("Spectral Shimmer", {
    description: "White noise through ten narrow bands tuned to the harmonic series of A, with a scanning window drifting up and down the spectrum: breathy overtones appear and vanish as if singing. Shared input Scan.",
    tags: ["ambient", "texture", "spectral", "harmonics", "noise"],
    help: "A Noise module goes into a Filter Bank with Tuning on Harmonic: ten very narrow band-passes tuned to the first ten harmonics " +
      "of A. An Organic LFO moves Scan, which chooses where along the spectrum the bands are loud, and another moves Tilt and Odd/Even, " +
      "so the overtones come and go. Chorus and a hall widen it.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Scan input is added to the Scan knob: " +
      "turn it by hand or automate it to play the overtones.\n\n" +
      "Tip: raise Q for a purer, more tonal result; lower it for a breathy rush.",
  }).input("scan", "Scan").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.03, spread: 0.7, drift: 0.5, seed: 4 });
  const air = p.add("noise", [1, 0], { colour: 0, level: 0.6 }, { name: "Breath" });
  const fb = p.add("filter-bank", [2, 0], { tuning: "Harmonic", root: "A", q: 18, scan: 0.5, width: 3, tilt: -1, oddEven: 0, mix: 1 });
  p.cable(air, "out", fb, "l").cable(air, "out", fb, "r").cable(lfo, "out1", fb, "scan", 0.4).cable(lfo, "out2", fb, "oddEven", 0.5)
    .cable(lfo, "out3", fb, "tilt", 0.3).cable(p.cin, "scan", fb, "scan", 0.4);
  const mix = bed(p, [3, 0], [{ node: fb, level: -3 }], { master: -2 });
  const ch = p.add("chorus", [4, 0], { rate: 0.3, depth: 0.3, delay: 12, mix: 0.3 });
  p.stereo(mix, ch, { from: ["outl", "outr"] });
  hall(p, ch, [5, 0], { size: 0.85, decay: 9, mix: 0.4 }, ["l", "r"]);
  return p;
}

// Quiet noise swells fed into a long tape loop that keeps them and ages them.
function tapeHissMemory() {
  const p = cell("Tape Hiss Memory", {
    description: "Soft swells of pink noise are caught in a long, worn tape loop that holds on to them and slowly turns them into something that sounds like a memory of rain. Shared input Memory (loop feedback).",
    tags: ["ambient", "texture", "tape", "loop", "lo-fi", "noise"],
    help: "A Recall module in Chance mode makes a rare random gate. It opens a slow ADSR on pink Noise, a short swell. The swell goes " +
      "through a Saturator in Tape mode with a lot of Age, then into a Zone Delay on its long zone with a lot of feedback and wobble: " +
      "it loops, each pass duller and wobblier than the one before, until the next swell covers it.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Memory input is added to the feedback of the loop: " +
      "at the top the loop never forgets.\n\n" +
      "Tip: raise Recall's T Bias on the module to feed the loop more often.",
  }).input("memory", "Memory").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.2, trecall: 0.1, gatelength: 0.2, rate: 0.35, sync: "Free", seed: 44 });
  const nz = p.add("noise", [1, 0], { colour: -0.3, level: 0.7 }, { name: "Hiss" });
  const env = p.add("adsr", [1, 2], { attack: 2.5, decay: 2, sustain: 0.2, release: 4 }, { name: "Swell" });
  const amp = p.add("vca", [2, 0], { response: "Linear" }, { name: "Swell VCA" });
  const sat = p.add("saturator", [3, 0], { drive: 0.4, character: "Tape", age: 0.8, sag: 0.4, tone: 5000, level: 0.9 });
  p.cable(rc, "t1", env, "gate").cable(env, "env", amp, "gain").cable(nz, "out", amp, "l").cable(nz, "out", amp, "r").stereo(amp, sat);
  const loop = p.add("zone-delay", [4, 0], { zone: 5, time: 0.4, feedback: 0.88, character: 0.6, tone: -0.4, diffuse: 0.3, wobble: 0.6, mix: 0.9 });
  p.cable(p.cin, "memory", loop, "feedback", 0.1).stereo(sat, loop);
  const mix = bed(p, [5, 0], [{ node: loop, level: 6 }], { master: -1 });
  hall(p, mix, [6, 0], { size: 0.7, decay: 6, mix: 0.3 });
  return p;
}

// Beat Oscillator heterodyne tone through a barber-pole shifter and a slow phaser.
function magneticFields() {
  const p = cell("Magnetic Fields", {
    description: "Two radio-frequency carriers beating against each other make a low, wavering hum that a frequency shifter and a slow phaser pull into slowly turning, vaguely electrical weather. Shared input Pull.",
    tags: ["ambient", "texture", "beat", "electrical", "phaser", "sci-fi"],
    help: "A Beat Oscillator mixes two high carriers and plays their difference as a low tone, wavering because Drift is high. Pull makes the two " +
      "carriers want to lock together, so the tone sometimes stutters and settles. A Freq Shifter spirals it with a little feedback and a " +
      "six-stage Phaser sweeps it slowly. A hall around it.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Pull input is added to Pull: higher stutters and locks more.\n\n" +
      "Tip: Beat sets the pitch of the difference tone; it moves in one big hum range, from 20 to 200 hertz.",
  }).input("pull", "Pull").stereoOut();
  const lfo = p.add("organic-lfos", [0, 1], { rate: 0.03, spread: 0.6, drift: 0.5, seed: 26 });
  const bo = p.add("beat-oscillator", [1, 1], { carrier: 9000, beat: 0.35, pull: 0.25, drift: 0.5, range: "±200 Hz" });
  p.cable(lfo, "out1", bo, "beat", 0.05).cable(p.cin, "pull", bo, "pull", 0.5);
  const fs = p.add("freq-shifter", [2, 1], { range: "±10 Hz", shift: 0.1, feedback: 0.4, fbDelay: 0.2, spread: 0.7, mix: 0.6 });
  const ph = p.add("phaser", [3, 1], { rate: 0.05, depth: 0.7, centre: 600, feedback: 0.5, stages: "6", spread: 0.8, mix: 0.6 });
  p.cable(bo, "out", fs, "l").cable(bo, "out", fs, "r").cable(lfo, "out2", ph, "centre", 0.1).stereo(fs, ph);
  const mix = bed(p, [4, 1], [{ node: ph, level: -6 }], { master: -2 });
  hall(p, mix, [5, 1], { size: 0.75, decay: 8, mix: 0.4 });
  return p;
}

// Sympathetic strings struck now and then by random gates.
function resonantRooms() {
  const p = cell("Resonant Rooms", {
    description: "A set of sympathetic strings in D minor pentatonic that are brushed by rare random touches, so soft overtone clouds appear, ring together and fade into a big room. Shared input Touch (more strums).",
    tags: ["ambient", "texture", "strings", "sympathetic", "resonator"],
    help: "A Recall module in Chance mode running free makes rare gates and random voltages. A Quantizer holds the voltages to D minor pentatonic " +
      "and sets the pitch of a Resonator in Sympathetic mode with four voices. Each gate strums it, and the strings ring together " +
      "for a long time. An Organic LFO moves Brightness and Damping. A hall adds the room.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Touch input is added to the gate bias of Recall: " +
      "more is more strums, up to a continuous shimmer.\n\n" +
      "Tip: switch the Resonator's Model to String for a more plucked version.",
  }).input("touch", "Touch").stereoOut();
  const lfo = p.add("organic-lfos", [0, 2], { rate: 0.03, spread: 0.6, drift: 0.5, seed: 28 });
  const rc = p.add("recall", [0, 0], { tmode: "Chance", tbias: 0.18, trecall: 0.2, gatelength: 0.05, xspread: 0.8, rate: 0.5, sync: "Free", seed: 51 });
  const q = p.add("quantizer", [1, 0], { root: "D", scale: "Minor Pentatonic", range: 1, hysteresis: 0 });
  const res = p.add("resonator", [2, 0], { model: "Sympathetic", polyphony: "4", structure: 0.4, brightness: 0.6, damping: 0.25, position: 0.4, exciter: 0.6, width: 1, dry: 0 });
  p.cable(p.cin, "touch", rc, "tbias", 0.3).cable(rc, "x1", q, "in").cable(q, "out", res, "pitch").cable(rc, "t1", res, "strum")
    .cable(lfo, "out1", res, "brightness", 0.2).cable(lfo, "out2", res, "damping", 0.15);
  const mix = bed(p, [3, 0], [{ node: res, mono: "mix", level: -4 }], { master: -2 });
  hall(p, mix, [4, 0], { size: 0.85, decay: 9, mix: 0.45 });
  return p;
}

// A narrow tunable band-pass sweeping noise for single whistling partials, endlessly echoed.
function iceMachine() {
  const p = cell("Ice Machine", {
    description: "A very narrow band-pass slowly sweeps up and down through white noise, lifting out single glassy whistles one after another and trailing them into a cold echo. Shared input Chill (echo feedback).",
    tags: ["ambient", "texture", "sweep", "whistle", "cold", "echo"],
    help: "A Wave Analyzer in Sweep mode runs a ten-hertz-wide band-pass across the whole spectrum over about a minute, up and then down, " +
      "over a white Noise source. What comes out is a thin, pure whistle that glides. A Delay Network with scattered taps repeats it " +
      "and a hall makes it cold and large.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Chill input is added to the delay feedback: " +
      "higher leaves trails of old whistles.\n\n" +
      "Tip: set Range on the Wave Analyzer to 2 to 20 kHz for a high, thin version, or 20 to 200 Hz for deep rumbling pitches.",
  }).input("chill", "Chill").stereoOut();
  const nz = p.add("noise", [0, 1], { colour: 0, level: 1 }, { name: "Static" });
  const wa = p.add("wave-analyzer", [1, 1], { mode: "Sweep", sweeptime: 60, sweepdir: "Up-Down", bandwidth: "10 Hz", range: "200 Hz–2 kHz", gain: 24 });
  p.cable(nz, "out", wa, "in");
  const mix = bed(p, [2, 1], [{ node: wa, mono: "band", level: -4, send: -6 }], { return: -4, master: -2 });
  const dly = p.add("delay-network", [3, 2], { time: 0.8, taps: 4, feedback: 0.6, scatter: 0.4, jitter: 0.1, tone: -0.2, character: 0.2, width: 1, mix: 1, routing: "Mesh" });
  p.cable(p.cin, "chill", dly, "feedback", 0.2);
  sendReturn(p, mix, dly);
  hall(p, mix, [4, 1], { size: 0.9, decay: 11, damping: 0.35, mix: 0.45 });
  return p;
}

export default category("Ambient Textures", "Noise, grains and resonances that evolve slowly: weather and rooms rather than notes. Nothing to play, no transport needed. Out L/R out.", [
  frozenLake, grainFog, breathingWind, distantThunder, whaleSong, spectralShimmer, tapeHissMemory, magneticFields, resonantRooms, iceMachine,
]);
