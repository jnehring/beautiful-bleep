// SPDX-License-Identifier: MIT
// Rotating Div: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";

// ------------------------------------------------------------ local helpers

/// Four-in-one ending: a mixer with a send to a room reverb, to Out 1/2. Returns the mixer.
function kitMix(p, at, levels, room = {}) {
  const [c, r] = at;
  const mix = p.add("audio-mixer", [c, r], levels, { name: "Mix" });
  const verb = p.add("reverb", [c + 1, r + 1], { size: 0.4, decay: 1.4, damping: 0.5, mix: 1, ...room });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

// ------------------------------------------------------------ patches

function integerGears() {
  const p = patch("Rotating Div: Integer Gears", {
    module: "rotating-divider", tempo: 110,
    description: "Eight integer divisions of the 16th-note clock (/1 to /8) strike a hat, tom, kick, rim, clap and cowbell, forming polyrhythms that realign every four bars. A slow ramp on Rotate shifts which drum gets which division at each bar; turn Rotate by hand and listen to the kit re-gear.",
    tags: ["polyrhythm", "drums", "integers", "rotate"],
  });
  const div = p.add("rotating-divider", [0, 1], { set: "Integers", output: "Trigger", realign: "4 bars", sync: "Next Bar", base: "1/16" });
  const turn = p.add("lfo", [0, 3], { wave: "Saw Up", sync: "8 bars", polarity: "Unipolar" }, { name: "Gear Shift" });
  p.cable(turn, "out", div, "rotate", 0.2);
  const hats = p.add("punch-hats", [1, 0], { closed: 0.04, crunch: 0.3, level: 0.55 });
  const tom = p.add("ring-tom", [1, 1], { tune: 150, decay: 0.3, level: 0.7 });
  const kick = p.add("punch-kick", [1, 2], { tune: 50, decay: 0.5, drive: 0.25, level: 0.85 });
  const rim = p.add("ring-rim", [1, 3], { level: 0.5 });
  const clap = p.add("punch-clap", [2, 0], { level: 0.5, decay: 0.3 });
  const bell = p.add("ring-cowbell", [2, 1], { tune: -5, decay: 0.2, level: 0.4 });
  p.cable(div, "out2", hats, "closed").cable(div, "out3", tom, "trig").cable(div, "out4", kick, "trig")
    .cable(div, "out5", rim, "trig").cable(div, "out6", clap, "trig").cable(div, "out7", bell, "trig");
  const a = p.add("audio-mixer", [3, 0], { level1: -9, pan1: 0.35, level2: -5, pan2: -0.4, level3: -3, level4: -8, pan4: 0.2, limiter: false, master: -2 }, { name: "Drums" });
  p.cable(hats, "out", a, "in1l").cable(tom, "out", a, "in2l").cable(kick, "out", a, "in3l").cable(rim, "out", a, "in4l");
  const mix = kitMix(p, [4, 0], { level1: 0, level2: -5, pan2: -0.15, level3: -8, pan3: 0.3, send1: -14, send2: -10, send3: -10, master: -3 });
  p.stereo(a, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(clap, "out", mix, "in2l").cable(bell, "out", mix, "in3l");
  return p;
}

function primeChimes() {
  const p = patch("Rotating Div: Prime Chimes", {
    module: "rotating-divider", tempo: 78,
    description: "The Primes set (1, 2, 3, 5, 7, 11, 13, 17) on eighth notes strikes six bells of an F major-pentatonic chord, so the chimes drift through patterns that almost never repeat. A slow ramp on Rotate hands the fast and slow divisions to different bells over time.",
    tags: ["primes", "chimes", "generative", "pentatonic"],
  });
  const div = p.add("rotating-divider", [0, 1], { set: "Primes", output: "Trigger", base: "1/8", sync: "Next Bar", realign: "Never" });
  const turn = p.add("lfo", [0, 3], { wave: "Saw Up", sync: "8 bars", polarity: "Unipolar" }, { name: "Reassign" });
  p.cable(turn, "out", div, "rotate", 0.3);
  const mix = p.add("audio-mixer", [3, 1], { level1: -9, pan1: -0.6, level2: -9, pan2: -0.3, level3: -9, pan3: 0, level4: -9, pan4: 0.3, send1: -6, send2: -6, send3: -6, send4: -6, return: -3, master: 0, limiter: false }, { name: "Chimes" });
  const mix2 = p.add("audio-mixer", [3, 3], { level1: -9, pan1: 0.6, level2: -9, pan2: -0.15, send1: -6, send2: -6, return: -60, master: 0, limiter: false }, { name: "Chimes 2" });
  // F, G, A, C, D, F (pentatonic chord, semitones from C4)
  [5, 7, 9, 12, 14, 17].forEach((coarse, i) => {
    const chime = p.add("modal-voice", [1, i], { strike: 1, strikeTimbre: 0.7, geometry: 0.8, brightness: 0.65, damping: 0.2, position: 0.3, size: 0.3, space: 0.25, coarse }, { name: `Chime ${i + 1}` });
    p.cable(div, `out${i + 1}`, chime, "strike");
    const target = i < 4 ? mix : mix2, ch = i < 4 ? i + 1 : i - 3;
    p.stereo(chime, target, { to: [`in${ch}l`, `in${ch}r`] });
  });
  const verb = p.add("reverb", [4, 2], { size: 0.85, decay: 6, damping: 0.35, modDepth: 0.35, mix: 1 });
  const fin = p.add("audio-mixer", [5, 2], { level1: 0, level2: 0, master: -9, limiter: false }, { name: "Master" });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").stereo(verb, mix, { to: ["returnl", "returnr"] });
  p.stereo(mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(mix2, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(fin, p.out, { from: ["outl", "outr"] });
  return p;
}

function fibonacciPad() {
  const p = patch("Rotating Div: Fibonacci Pad", {
    module: "rotating-divider", tempo: 60,
    description: "Gate output on quarter notes with the Fibonacci set (1, 2, 3, 5, 8, 13, 21, 34): each division opens one note of a C major-nine chord, so the pad breathes in and out as the gates fall in and out of step. Widen or narrow Width to change how long each note is held.",
    tags: ["pad", "fibonacci", "gates", "slow"],
  });
  const div = p.add("rotating-divider", [0, 1], { set: "Fibonacci", output: "Gate", base: "1/4", width: 0.6, gatelength: "Division", realign: "Never" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -9, pan1: -0.5, level2: -9, pan2: 0.5, level3: -9, pan3: -0.2, level4: -9, pan4: 0.2, master: 0, limiter: false }, { name: "Pad A" });
  const mix2 = p.add("audio-mixer", [4, 2], { level1: -9, pan1: -0.7, level2: -9, pan2: 0.7, master: 0, limiter: false }, { name: "Pad B" });
  // C3, G3, E4, B4, D5, C4: [octave, semitones]
  [["-1", 0], ["-1", 7], ["0", 4], ["0", 11], ["+1", 2], ["0", 0]].forEach(([octave, coarse], i) => {
    const osc = p.add("oscillator", [1, i], { shape: i % 2 ? 0.7 : 0.45, octave, coarse, fine: (i - 3) * 3 }, { name: `Note ${i + 1}` });
    const env = p.add("adsr", [2, i], { attack: 1.5, decay: 1, sustain: 0.8, release: 3, velamount: 0 }, { name: `Swell ${i + 1}` });
    const amp = p.add("vca", [3, i], {}, { name: `VCA ${i + 1}` });
    p.cable(div, `out${i + 1}`, env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
    const target = i < 4 ? mix : mix2, ch = i < 4 ? i + 1 : i - 3;
    p.cable(amp, "l", target, `in${ch}l`);
  });
  const fin = p.add("audio-mixer", [5, 1], { level1: 0, level2: -3, master: 0, limiter: false }, { name: "Master" });
  const filt = p.add("filter", [6, 1], { cutoff: 1400, resonance: 0.15, type: "1-Pole Low-pass" }, { name: "Softener" });
  const verb = p.add("reverb", [7, 1], { size: 0.9, decay: 9, damping: 0.4, modDepth: 0.4, mix: 0.5 });
  p.stereo(mix, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(mix2, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(fin, filt, { from: ["outl", "outr"] }).stereo(filt, verb).stereo(verb, p.out);
  return p;
}

function powersGroove() {
  const p = patch("Rotating Div: Powers Groove", {
    module: "rotating-divider", tempo: 124,
    description: "Powers of 2 split the 16th clock into a clean techno grid: /1 hats, /2 off-beat accents, /4 kick, /8 clap, /16 a bar-long ping. The Stair output counts how many divisions fire together and, snapped to a scale, plays the bass: busier beats climb higher.",
    tags: ["techno", "powers of 2", "stair", "bass"],
  });
  const div = p.add("rotating-divider", [0, 1], { set: "Powers of 2", output: "Trigger", base: "1/16", width: 0.4 });
  const gdiv = p.add("rotating-divider", [0, 3], { set: "Powers of 2", output: "Gate", base: "1/16", width: 0.4, gatelength: "Base Step" }, { name: "Bass Gates" });
  const hat = p.add("punch-hats", [1, 0], { closed: 0.035, tone: 0.6, level: 0.45 });
  const kick = p.add("punch-kick", [1, 1], { tune: 48, decay: 0.45, drive: 0.3, level: 0.85 });
  const clap = p.add("punch-clap", [1, 2], { level: 0.5, decay: 0.3 });
  const ping = p.add("ring-rim", [1, 3], { level: 0.35 });
  p.cable(div, "out1", hat, "closed").cable(div, "out3", kick, "trig").cable(div, "out4", clap, "trig").cable(div, "out5", ping, "trig");
  const q = p.add("quantizer", [1, 4], { root: "A", scale: "Minor Pentatonic", range: 2 }, { name: "Stair Notes" });
  p.cable(div, "stair", q, "in");
  const bass = p.add("oscillator", [2, 4], { shape: 0.9, octave: "-2" }, { name: "Bass" });
  const env = p.add("adsr", [2, 5], { attack: 0.003, decay: 0.15, sustain: 0.4, release: 0.08 }, { name: "Bass Env" });
  const amp = p.add("vca", [3, 4], {}, { name: "Bass VCA" });
  const filt = p.add("filter", [4, 4], { cutoff: 450, resonance: 0.4, drive: 0.2 }, { name: "Bass Filter" });
  p.cable(q, "out", bass, "pitch").cable(gdiv, "out2", env, "gate").cable(bass, "out", amp, "l").cable(env, "env", amp, "gain")
    .cable(amp, "l", filt, "l").cable(env, "env", filt, "cutoff", 0.35);
  const dm = p.add("audio-mixer", [5, 0], { level1: -12, pan1: 0.3, level2: -3, level3: -8, pan3: 0.1, level4: -14, pan4: -0.3, send3: -12, send4: -8, return: -4, master: -2 }, { name: "Drums" });
  p.cable(hat, "out", dm, "in1l").cable(kick, "out", dm, "in2l").cable(clap, "out", dm, "in3l").cable(ping, "out", dm, "in4l");
  const room = p.add("reverb", [6, 1], { size: 0.3, decay: 1, damping: 0.5, mix: 1 });
  p.cable(dm, "sendl", room, "l").cable(dm, "sendr", room, "r").stereo(room, dm, { to: ["returnl", "returnr"] });
  const fin = p.add("audio-mixer", [7, 0], { level1: 0, level2: -3, master: -2 }, { name: "Master" });
  p.stereo(dm, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(filt, "l", fin, "in2l").stereo(fin, p.out, { from: ["outl", "outr"] });
  return p;
}

function oddMeters() {
  const p = patch("Rotating Div: Odd Meters", {
    module: "rotating-divider", tempo: 100,
    description: "Set = Custom with the divisions 4, 3, 5, 6, 7, 9, 10 and 12 drives a tuned drum ensemble of toms, a rim, a cowbell, a hat and a clap: a kit that lines up only every few bars (Realign sets 8). Type other numbers into the divisions in the view for a new meter.",
    tags: ["custom", "odd meters", "toms", "polyrhythm"],
  });
  const div = p.add("rotating-divider", [0, 1], { set: "Custom", output: "Trigger", base: "1/16", realign: "8 bars", sync: "Next Bar" }, {
    data: { custom: [4, 3, 5, 6, 7, 9, 10, 12] },
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 52, decay: 0.5, level: 0.8 });
  const t1 = p.add("ring-tom", [1, 1], { tune: 190, decay: 0.3, bend: 0.4, level: 0.7 }, { name: "Tom High" });
  const rim = p.add("ring-rim", [1, 2], { level: 0.5 });
  const t2 = p.add("ring-tom", [1, 3], { tune: 120, decay: 0.4, bend: 0.4, level: 0.7 }, { name: "Tom Mid" });
  const bell = p.add("ring-cowbell", [2, 0], { tune: 2, decay: 0.2, level: 0.35 });
  const t3 = p.add("ring-tom", [2, 1], { tune: 85, decay: 0.5, bend: 0.5, level: 0.75 }, { name: "Tom Low" });
  const hat = p.add("punch-hats", [2, 2], { closed: 0.04, level: 0.45 });
  const clap = p.add("punch-clap", [2, 3], { level: 0.5, decay: 0.3 });
  p.cable(div, "out1", kick, "trig").cable(div, "out2", t1, "trig").cable(div, "out3", rim, "trig").cable(div, "out4", t2, "trig")
    .cable(div, "out5", bell, "trig").cable(div, "out6", t3, "trig").cable(div, "out7", hat, "closed").cable(div, "out8", clap, "trig");
  const a = p.add("audio-mixer", [3, 0], { level1: -3, level2: -5, pan2: 0.4, level3: -9, pan3: -0.4, level4: -5, pan4: -0.2, limiter: false, master: -2 }, { name: "Group A" });
  const b = p.add("audio-mixer", [3, 2], { level1: -12, pan1: 0.3, level2: -4, pan2: 0.1, level3: -12, pan3: 0.45, level4: -9, pan4: -0.45, limiter: false, master: -2 }, { name: "Group B" });
  p.cable(kick, "out", a, "in1l").cable(t1, "out", a, "in2l").cable(rim, "out", a, "in3l").cable(t2, "out", a, "in4l");
  p.cable(bell, "out", b, "in1l").cable(t3, "out", b, "in2l").cable(hat, "out", b, "in3l").cable(clap, "out", b, "in4l");
  const mix = kitMix(p, [4, 1], { level1: 0, level2: 0, send1: -14, send2: -10, master: -3 });
  p.stereo(a, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(b, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return p;
}

export default [integerGears, primeChimes, fibonacciPad, powersGroove, oddMeters];
