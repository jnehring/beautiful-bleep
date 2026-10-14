// SPDX-License-Identifier: MIT
// Clock Div: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

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

function basicKit() {
  const p = patch("Clock Div: Basic Kit", {
    module: "clock-divider", tempo: 112,
    description: "One 16th-note clock divided six ways: a kick every 4 steps, hats every 2, a rim every 3, a cowbell every 5 and a clap once a bar. Realign restarts the odd divisions on every downbeat so they keep landing on the one; set it to Never and listen to them drift.",
    tags: ["drums", "kit", "realign", "basics"],
  });
  const div = p.add("clock-divider", [0, 1], { div1: 4, div2: 2, div3: 3, div4: 5, div5: 16, div6: 7, output: "Trigger", base: "1/16", realign: "1 bar" });
  const kick = p.add("punch-kick", [1, 0], { tune: 50, decay: 0.5, drive: 0.25, level: 0.85 });
  const hat = p.add("punch-hats", [1, 1], { closed: 0.04, crunch: 0.3, level: 0.5 });
  const rim = p.add("ring-rim", [1, 2], { level: 0.5 });
  const bell = p.add("ring-cowbell", [1, 3], { tune: 3, decay: 0.2, level: 0.4 });
  const clap = p.add("punch-clap", [2, 0], { level: 0.5, decay: 0.3 });
  const tom = p.add("ring-tom", [2, 1], { tune: 140, decay: 0.3, level: 0.55 });
  p.cable(div, "out1", kick, "trig").cable(div, "out2", hat, "closed").cable(div, "out3", rim, "trig")
    .cable(div, "out4", bell, "trig").cable(div, "out5", clap, "trig").cable(div, "out6", tom, "trig");
  const a = p.add("audio-mixer", [3, 0], { level1: -3, level2: -12, pan2: 0.3, level3: -9, pan3: -0.35, level4: -14, pan4: 0.2, limiter: false, master: -2 }, { name: "Group A" });
  const b = p.add("audio-mixer", [3, 2], { level1: -8, pan1: 0.1, level2: -8, pan2: -0.2, limiter: false, master: -2 }, { name: "Group B" });
  p.cable(kick, "out", a, "in1l").cable(hat, "out", a, "in2l").cable(rim, "out", a, "in3l").cable(bell, "out", a, "in4l");
  p.cable(clap, "out", b, "in1l").cable(tom, "out", b, "in2l");
  const mix = kitMix(p, [4, 0], { level1: 0, level2: 0, send1: -14, send2: -10, master: -3 });
  p.stereo(a, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(b, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return p;
}

function toms345() {
  const p = patch("Clock Div: Three Against Four", {
    module: "clock-divider", tempo: 96,
    description: "Four tuned toms on /3, /4, /5 and /7 of an 8th-note clock, with Realign off: the pattern slides against itself and only comes round again after 420 steps. Set Realign to 1 bar and the same divisions lock to the bar line instead.",
    tags: ["polyrhythm", "toms", "drift", "ensemble"],
  });
  const div = p.add("clock-divider", [0, 1], { div1: 3, div2: 4, div3: 5, div4: 7, div5: 2, output: "Trigger", base: "1/8", realign: "Never" });
  const t1 = p.add("ring-tom", [1, 0], { tune: 200, decay: 0.3, bend: 0.4, level: 0.7 }, { name: "Tom 3" });
  const t2 = p.add("ring-tom", [1, 1], { tune: 150, decay: 0.35, bend: 0.4, level: 0.7 }, { name: "Tom 4" });
  const t3 = p.add("ring-tom", [1, 2], { tune: 110, decay: 0.45, bend: 0.5, level: 0.75 }, { name: "Tom 5" });
  const t4 = p.add("ring-tom", [1, 3], { tune: 80, decay: 0.6, bend: 0.5, level: 0.8 }, { name: "Tom 7" });
  const hat = p.add("punch-hats", [2, 0], { closed: 0.035, level: 0.4 });
  p.cable(div, "out1", t1, "trig").cable(div, "out2", t2, "trig").cable(div, "out3", t3, "trig").cable(div, "out4", t4, "trig")
    .cable(div, "out5", hat, "closed");
  const a = p.add("audio-mixer", [3, 0], { level1: 0, pan1: 0.5, level2: 0, pan2: 0.15, level3: 0, pan3: -0.2, level4: 2, pan4: -0.5, limiter: false, master: -3 }, { name: "Toms" });
  p.cable(t1, "out", a, "in1l").cable(t2, "out", a, "in2l").cable(t3, "out", a, "in3l").cable(t4, "out", a, "in4l");
  const mix = kitMix(p, [4, 0], { level1: 0, level2: -12, pan2: 0.3, send1: -10, send2: -14, master: -3 }, { size: 0.55, decay: 2 });
  p.stereo(a, mix, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).cable(hat, "out", mix, "in2l");
  return p;
}

function slowChimes() {
  const p = patch("Clock Div: Slow Chimes", {
    module: "clock-divider", tempo: 70,
    description: "Long divisions of an 8th-note clock (/5, /8, /11, /13, /19 and /29) strike six bells of a D minor-pentatonic chord. Because the numbers share no factors, the same combination of bells takes minutes to come round. Change a Div knob and that bell shifts into a new rhythm.",
    tags: ["chimes", "generative", "slow", "ambient"],
  });
  const div = p.add("clock-divider", [0, 1], { div1: 5, div2: 8, div3: 11, div4: 13, div5: 19, div6: 29, output: "Trigger", base: "1/8" });
  const mix = p.add("audio-mixer", [3, 1], { level1: -9, pan1: -0.6, level2: -9, pan2: -0.3, level3: -9, pan3: 0, level4: -9, pan4: 0.3, send1: -6, send2: -6, send3: -6, send4: -6, return: -3, master: 0, limiter: false }, { name: "Chimes" });
  const mix2 = p.add("audio-mixer", [3, 3], { level1: -9, pan1: 0.6, level2: -9, pan2: -0.15, send1: -6, send2: -6, return: -60, master: 0, limiter: false }, { name: "Chimes 2" });
  // D, F, A, C, E, D (semitones from C4)
  [2, 5, 9, 12, 16, 14].forEach((coarse, i) => {
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

function chordGates() {
  const p = patch("Clock Div: Gate Pad", {
    module: "clock-divider", tempo: 60,
    description: "Gate output on quarter notes with Div 1 to 6 at 4, 6, 8, 12, 16 and 24: six notes of an A minor-nine chord swell in and out at different rates, so the harmony thickens and thins over a few bars. Width sets how long each note is held.",
    tags: ["pad", "gates", "slow", "harmony"],
  });
  const div = p.add("clock-divider", [0, 1], { div1: 4, div2: 6, div3: 8, div4: 12, div5: 16, div6: 24, output: "Gate", base: "1/4", width: 0.7, gatelength: "Division" });
  const mix = p.add("audio-mixer", [4, 0], { level1: -9, pan1: -0.5, level2: -9, pan2: 0.5, level3: -9, pan3: -0.2, level4: -9, pan4: 0.2, master: 0, limiter: false }, { name: "Pad A" });
  const mix2 = p.add("audio-mixer", [4, 2], { level1: -9, pan1: -0.7, level2: -9, pan2: 0.7, master: 0, limiter: false }, { name: "Pad B" });
  // A2, E3, C4, G4, B4, A3: [octave, semitones from C]
  [["-2", 9], ["-1", 4], ["0", 0], ["0", 7], ["0", 11], ["-1", 9]].forEach(([octave, coarse], i) => {
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

function halfTime() {
  const p = patch("Clock Div: Half-Time Melody", {
    module: "clock-divider", tempo: 118,
    description: "A drum beat plays at full speed while a step sequencer is clocked by Out 1 (/2) of the same 16th clock, so its melody runs in half time. Out 2 (/32) resets the sequencer every two bars, keeping it in step with the drums. Change Div 1 to 3 or 4 for a slower, odder line.",
    tags: ["clock", "sequencer", "half time", "melody"],
  });
  const div = p.add("clock-divider", [0, 1], { div1: 2, div2: 32, output: "Trigger", base: "1/16", realign: "2 bars" });
  const m = melody(p, [1, 2], [0, null, 3, null, 5, 7, null, 5, 3, null, 7, null, 10, 7, 5, 3], { rate: "1/16", octave: 0, gatelength: 0.5,
    env: { attack: 0.004, decay: 0.3, sustain: 0.15, release: 0.25 } });
  p.cable(div, "out1", m.seq, "clock").cable(div, "out2", m.seq, "reset");
  const drums = beat(p, [1, 5], { style: "broken", level: -6 });
  const verb = p.add("reverb", [4, 3], { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.3 });
  const mix = p.add("audio-mixer", [5, 2], { level1: -4, level2: 0, master: -3 }, { name: "Master" });
  p.cable(m.amp, "l", verb, "l").stereo(verb, mix, { to: ["in1l", "in1r"] });
  p.stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

export default [basicKit, toms345, slowChimes, chordGates, halfTime];
