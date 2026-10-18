// SPDX-License-Identifier: MIT
// Switch: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function rotation() {
  const p = patch("Switch: Four Timbres in Rotation", {
    module: "switch", tempo: 100,
    description: "The same riff is played by four different oscillators, and the Switch hands the output to the next one every half note with a short crossfade: saw, hollow pulse, triangle and a bright octave. Change Direction to Ping-Pong or Random, or lengthen Fade to blend the voices.",
    tags: ["crossfade", "timbre", "rotation", "sequential"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: 0.5 },
    { data: steps([0, 7, 3, 10, 12, 10, 7, 3]) });
  const env = p.add("adsr", [0, 1], { attack: 0.003, decay: 0.2, sustain: 0.3, release: 0.15 }, { name: "Amp Env" });
  const o = [
    p.add("oscillator", [1, 0], { shape: 0.85 }, { name: "Saw" }),
    p.add("oscillator", [1, 1], { shape: 0.5, pw: 0.25 }, { name: "Pulse" }),
    p.add("oscillator", [1, 2], { shape: 0.1 }, { name: "Triangle" }),
    p.add("oscillator", [1, 3], { shape: 0.9, octave: "+1" }, { name: "Bright" }),
  ];
  const sw = p.add("switch", [2, 0], { length: 4, rate: "1/2", fade: 0.05, level2: 0.8, level3: 1, level4: 0.5 });
  o.forEach((x, i) => p.cable(seq, "pitch", x, "pitch").cable(x, "out", sw, "in" + (i + 1)));
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig");
  const vca = p.add("vca", [3, 0], {});
  const f = p.add("filter", [4, 0], { cutoff: 2200, resonance: 0.15, type: "SVF Multimode" });
  p.cable(sw, "out", vca, "l").cable(env, "env", vca, "gain").cable(vca, "l", f, "l");
  const drums = beat(p, [0, 6], { style: "half", level: -8 });
  const mix = p.add("audio-mixer", [5, 0], { level1: 5, level2: -6, master: -1 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [6, 0], { size: 0.5, decay: 2.2, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function walk() {
  const p = patch("Switch: Random Walk Textures", {
    module: "switch", tempo: 70,
    description: "Four sustained layers, a soft pad, a breathy noise band, a deep sine and a shimmering high chord, are slowly crossfaded by the Switch in Random Walk order, one step at a time, so the texture wanders without ever jumping. Change Seed for another route.",
    tags: ["random walk", "texture", "ambient", "crossfade"],
  });
  const o1 = p.add("oscillator", [0, 0], { shape: 0.7, fine: -6 }, { name: "Pad A" });
  const o2 = p.add("oscillator", [0, 1], { shape: 0.7, fine: 6, coarse: 7 }, { name: "Pad B" });
  const pm = p.add("audio-mixer", [1, 0], { level1: -9, level2: -12, master: 0 });
  const pf = p.add("filter", [2, 0], { cutoff: 900, resonance: 0.1, type: "SVF Multimode" });
  const noise = p.add("noise", [0, 2], { colour: 0.3, level: 0.25 });
  const nf = p.add("filter", [1, 2], { cutoff: 1400, resonance: 0.4, type: "SVF Bandpass (unit gain)" });
  const sub = p.add("oscillator", [0, 3], { shape: 0, octave: "-2" }, { name: "Deep Sine" });
  const hi1 = p.add("oscillator", [0, 4], { shape: 0.2, octave: "+1", fine: -9 }, { name: "Shimmer A" });
  const hi2 = p.add("oscillator", [0, 5], { shape: 0.2, octave: "+1", coarse: 4, fine: 9 }, { name: "Shimmer B" });
  const hm = p.add("audio-mixer", [1, 4], { level1: -14, level2: -16, master: 0 });
  const sw = p.add("switch", [3, 0], { length: 4, rate: "1 bar", order: "Random Walk", fade: 0.9, seed: 4, level1: 1, level2: 0.6, level3: 1, level4: 0.7 });
  p.cable(o1, "out", pm, "in1l").cable(o1, "out", pm, "in1r").cable(o2, "out", pm, "in2l").cable(o2, "out", pm, "in2r")
    .stereo(pm, pf, { from: ["outl", "outr"] }).cable(pf, "l", sw, "in1")
    .cable(noise, "out", nf, "l").cable(nf, "l", sw, "in2").cable(sub, "out", sw, "in3")
    .cable(hi1, "out", hm, "in1l").cable(hi1, "out", hm, "in1r").cable(hi2, "out", hm, "in2l").cable(hi2, "out", hm, "in2r")
    .cable(hm, "outl", sw, "in4");
  finish(p, [4, 0], sw, "out", -1, { size: 0.75, decay: 6, mix: 0.4 });
  return p;
}

function router() {
  const p = patch("Switch: One Riff, Four Treatments", {
    module: "switch", tempo: 96,
    description: "Used the other way round, one input goes to eight outputs: a single riff is sent to a dry output, an echo, a high-pass filter and a huge reverb in turn, each for half a bar. Try Direction Random or Length 2 to make it jump between only two of them.",
    tags: ["router", "one to many", "effects", "send"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 12, 10, 7, 3, 5], { rate: "1/8", shape: 0.7, root: "D", scale: "Dorian", gatelength: 0.45,
    env: { attack: 0.003, decay: 0.2, sustain: 0.25, release: 0.15 } });
  const sw = p.add("switch", [3, 0], { length: 4, rate: "1/2", fade: 0.02, idle: "Zero" });
  p.cable(m.amp, "l", sw, "in");
  const lp = p.add("filter", [4, 0], { cutoff: 1800, type: "SVF Multimode" }, { name: "Dry" });
  const dl = p.add("delay", [4, 1], { timel: 375, timer: 250, feedback: 0.55, mix: 1, mode: "Stereo" });
  const hp = p.add("filter", [4, 2], { cutoff: 1500, mode: "Notch", resonance: 0.3, type: "SVF Multimode" }, { name: "Thin" });
  const rv = p.add("reverb", [4, 3], { size: 0.95, decay: 9, mix: 1, quality: "Eco (8 lines)" });
  p.cable(sw, "out1", lp, "l").cable(sw, "out2", dl, "l").cable(sw, "out3", hp, "l").cable(sw, "out4", rv, "l").cable(sw, "out4", rv, "r");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -1, level3: -3, level4: 0, pan1: 0, pan3: 0.3, master: 0 });
  p.cable(lp, "l", mix, "in1l").cable(lp, "l", mix, "in1r").stereo(dl, mix, { to: ["in2l", "in2r"] })
    .cable(hp, "l", mix, "in3l").cable(hp, "l", mix, "in3r").stereo(rv, mix, { to: ["in4l", "in4r"] });
  const drums = beat(p, [0, 5], { style: "sparse", level: -9 });
  const out = p.add("audio-mixer", [6, 0], { level1: 0, level2: -6, master: 0 });
  p.stereo(mix, out, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(drums, out, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(out, p.out, { from: ["outl", "outr"] });
  return p;
}

function drones() {
  const p = patch("Switch: Gliding Drone Chords", {
    module: "switch", tempo: 60,
    description: "Four sine drones stacked on different chord tones are passed one at a time through the Switch in Glide mode and ping-pong order, with a long Fade so each tone seems to slide into the next. Change Mode to Crossfade for a cleaner blend or Fade for a quicker move.",
    tags: ["glide", "drone", "ping-pong", "slow"],
  });
  const notes = [{ coarse: -5 }, { coarse: 0 }, { coarse: 4 }, { coarse: 11 }];
  const os = notes.map((n, i) => p.add("oscillator", [0, i], { shape: i % 2 ? 0.15 : 0, fine: (i - 1.5) * 4, ...n }, { name: `Drone ${i + 1}` }));
  const sw = p.add("switch", [1, 0], { length: 4, rate: "2 bars", order: "Ping-Pong", mode: "Glide", fade: 1.6, curve: "Equal Power" });
  os.forEach((o, i) => p.cable(o, "out", sw, "in" + (i + 1)));
  const f = p.add("filter", [2, 0], { cutoff: 1200, resonance: 0.15, type: "SVF Multimode" });
  const lfo = p.add("lfo", [2, 1], { rate: 0.1 }, { name: "Breath" });
  p.cable(sw, "out", f, "l").cable(lfo, "out", f, "cutoff", 0.1);
  const seq = melody(p, [0, 5], [0, ".", ".", 7, ".", ".", 12, ".", 4, ".", ".", 9, ".", ".", ".", "."], { rate: "1/4", shape: 0.1, root: "C", scale: "Major Pentatonic", octave: 1, gatelength: 0.3,
    env: { decay: 0.8, sustain: 0, release: 0.8 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -14, level2: -9, master: 0 });
  p.cable(f, "l", mix, "in1l").cable(f, "l", mix, "in1r").cable(seq.amp, "l", mix, "in2l").cable(seq.amp, "l", mix, "in2r");
  const v = p.add("reverb", [5, 0], { size: 0.8, decay: 7, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function carousel() {
  const p = patch("Switch: Drum Voice Carousel", {
    module: "switch", tempo: 116,
    description: "One drum pattern plays four different drums at once, but the Switch lets only one of them through, stepping to the next each bar by a trigger: the same groove turns from kick to snare to clap to tom. Lengthen the Length setting to add silent bars, or change Direction.",
    tags: ["step input", "drums", "trigger", "bar by bar"],
  });
  const g = p.add("drum-grid", [0, 0], {}, { name: "Groove", data: drumGrid(["Hit", "Hat", "", "", "", "", "", ""],
    [pattern("Groove", ["x..x..x..x.x..x.", "x.x.x.x.x.x.x.x."])]) });
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  const snare = p.add("punch-snare", [1, 1], { level: 0.7 });
  const clap = p.add("punch-clap", [1, 2], { level: 0.7 });
  const tom = p.add("punch-tom", [1, 3], { tune: 130, decay: 0.35 });
  const bar = p.add("lfo", [0, 4], { wave: "Square", sync: "1 bar", polarity: "Unipolar", pw: 0.1 }, { name: "Bar Clock" });
  const sw = p.add("switch", [2, 1], { length: 4, rate: "Off", fade: 0.002 });
  p.cable(g, "gate1", kick, "trig").cable(g, "gate1", snare, "trig").cable(g, "gate1", clap, "trig").cable(g, "gate1", tom, "trig")
    .cable(kick, "out", sw, "in1").cable(snare, "out", sw, "in2").cable(clap, "out", sw, "in3").cable(tom, "out", sw, "in4")
    .cable(bar, "out", sw, "step");
  const hats = p.add("punch-hats", [2, 4], { level: 0.45 });
  p.cable(g, "gate2", hats, "closed");
  const m = melody(p, [0, 6], [0, ".", 0, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.3, root: "E", scale: "Natural Minor", octave: -2, gatelength: 0.7,
    env: { decay: 0.25, sustain: 0.4, release: 0.1 } });
  const mix = p.add("audio-mixer", [4, 0], { level1: -2, level2: -10, level3: -4, master: -4 });
  p.cable(sw, "out", mix, "in1l").cable(sw, "out", mix, "in1r").cable(hats, "out", mix, "in2l").cable(hats, "out", mix, "in2r")
    .cable(m.amp, "l", mix, "in3l").cable(m.amp, "l", mix, "in3r");
  const v = p.add("reverb", [5, 0], { size: 0.4, decay: 1.6, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [rotation, walk, router, drones, carousel];
