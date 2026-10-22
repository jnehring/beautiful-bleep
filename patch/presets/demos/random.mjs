// SPDX-License-Identifier: MIT
// Random: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Mono/stereo source (`src`, jacks l/r) → trim → reverb → Out.
function finish(p, at, src, o = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: o.trim ?? 0, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...(o.verb || {}) });
  const [jl, jr] = o.jacks || ["l", "r"];
  p.cable(src, jl, t, "in1l").cable(src, o.stereo ? jr : jl, t, "in1r");
  p.stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

/// Plucked melody into a Multi Filter (returns the filter, stereo out).
function voice(p, at, notes, o = {}) {
  const m = melody(p, at, notes, o);
  const f = p.add("filter", [at[0] + 3, at[1]], { cutoff: 1200, resonance: 0.25, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(m.amp, "l", f, "l").cable(m.amp, "l", f, "r");
  return { ...m, filt: f };
}

/// Two detuned oscillators (left / right) held by a sequencer → VCA (gain left to the caller) → Multi Filter.
function pad(p, at, notes, o = {}) {
  const [c, r] = at;
  const seq = p.add("step-sequencer", [c, r], { length: notes.length, rate: o.rate || "1/2", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
    octave: o.octave ?? -1, gatelength: o.gate ?? 0.95 }, { data: steps(notes) });
  const o1 = p.add("oscillator", [c + 1, r], { shape: o.shape ?? 0.5, fine: -9 }, { name: "Osc L" });
  const o2 = p.add("oscillator", [c + 1, r + 1], { shape: o.shape ?? 0.5, fine: 9 }, { name: "Osc R" });
  const amp = p.add("vca", [c + 2, r], { gain: o.gain ?? 1 }, { name: "VCA" });
  const f = p.add("filter", [c + 3, r], { cutoff: 1400, resonance: 0.2, ...(o.filter || {}) }, { name: "Filter" });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", amp, "l").cable(o2, "out", amp, "r")
    .stereo(amp, f);
  return { seq, o1, o2, amp, filt: f };
}

/// Up to six oscillators, each through its own VCA (gain from the caller), mixed to stereo on `master` (jacks outl/outr).
/// tones: [semitones, octave] per oscillator.
function chord(p, at, tones, o = {}) {
  const [c, r] = at;
  const lv = o.lvl ?? -10;
  const mixA = p.add("audio-mixer", [c + 2, r], { level1: lv, level2: lv, level3: lv, pan1: -0.7, pan2: 0, pan3: 0.7, master: 0 }, { name: "Mix 1-3" });
  const mixB = p.add("audio-mixer", [c + 2, r + 3], { level1: lv, level2: lv, level3: lv, pan1: 0.5, pan2: -0.4, pan3: 0.2, master: 0 }, { name: "Mix 4-6" });
  const vcas = [], oscs = [];
  tones.forEach((t, i) => {
    const osc = p.add("oscillator", [c, r + i], { shape: o.shape ?? 0, coarse: t[0], octave: t[1] }, { name: `Tone ${i + 1}` });
    const vca = p.add("vca", [c + 1, r + i], { gain: o.gain ?? 0 }, { name: `Level ${i + 1}` });
    p.cable(osc, "out", vca, "l");
    if (o.pitch) p.cable(o.pitch, "pitch", osc, "pitch");
    const m = i < 3 ? mixA : mixB, k = (i % 3) + 1;
    p.cable(vca, "l", m, `in${k}l`).cable(vca, "l", m, `in${k}r`);
    vcas.push(vca); oscs.push(osc);
  });
  const master = p.add("audio-mixer", [c + 3, r], { level1: 0, level2: 0, master: o.master ?? 0 }, { name: "Master" });
  p.stereo(mixA, master, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(mixB, master, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { vcas, oscs, master, jacks: ["outl", "outr"] };
}

function steppedMelody() {
  const p = patch("Random: Wandering Melody", {
    module: "random", tempo: 98,
    description: "Every eighth note the Random module picks a new value; with Semitones on they land on exact notes, so a steady rhythm plays a never-repeating tune. Raise Spread for a wider range, move Bias up or down to place it higher or lower, or change Seed for a new tune.",
    tags: ["random melody", "semitones", "bias", "spread"],
  });
  const v = voice(p, [0, 0], [0, 0, 0, ".", 0, 0, ".", 0, 0, 0, 0, ".", 0, ".", 0, 0], { rate: "1/8", shape: 0.75, root: "A", octave: 0, env: { decay: 0.25, sustain: 0.1 }, filter: { cutoff: 1800, resonance: 0.15 } });
  const r = p.add("random", [3, 1], { spread: 0.35, bias: -0.2, smooth: 0, loop: 0, sync: "1/8", quantize: true, seed: 7 });
  p.cable(r, "out", v.osc, "pitch", 0.2);
  finish(p, [4, 0], v.filt, { stereo: true, trim: 6, verb: { size: 0.5, decay: 2.5, mix: 0.3 } });
  return p;
}

function lockedLoop() {
  const p = patch("Random: Locked Loop", {
    module: "random", tempo: 114,
    description: "Loop at its top setting repeats an eight-step random pattern exactly, here moving a bass line's filter in time with the drums. Turn Loop down and the pattern slowly mutates, down to fully new values every step; change Length to repeat after more or fewer steps.",
    tags: ["loop", "length", "groove", "filter"],
  });
  const v = voice(p, [0, 0], [0, "_", 0, 7, 0, "_", 5, 3, 0, "_", 0, 7, 10, "_", 5, 3], { rate: "1/8", shape: 0.95, root: "C", octave: -2, gatelength: 0.8, env: { decay: 0.2, sustain: 0.7 }, filter: { cutoff: 300, resonance: 0.4 } });
  const r = p.add("random", [3, 1], { spread: 1, smooth: 0.15, loop: 1, length: "8 steps", sync: "1/8", seed: 21 });
  p.cable(r, "out", v.filt, "cutoff", 0.5);
  const drums = beat(p, [0, 4], { style: "broken", level: -6 });
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -9, master: 0 });
  p.cable(v.filt, "l", mix, "in1l").cable(v.filt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] }).stereo(mix, p.out, { from: ["outl", "outr"] });
  return p;
}

function smoothDrift() {
  const p = patch("Random: Smooth Drift", {
    module: "random", tempo: 72,
    description: "With Smooth turned up the random steps glide into one another, making a slow, irregular drift that moves a pad's brightness and tone. Lower Smooth to bring back the steps, or raise Rate to make the drift busier.",
    tags: ["smooth", "drift", "pad", "slow"],
  });
  const pd = pad(p, [0, 0], [0, 7, 3, 10, 5, 8, 3, 7], { rate: "1/1", root: "D", scale: "Natural Minor", gain: 1, shape: 0.6, filter: { cutoff: 800, resonance: 0.25 } });
  const r = p.add("random", [0, 3], { rate: 0.4, spread: 1, smooth: 1, loop: 0, sync: "Free", seed: 4 });
  const r2 = p.add("random", [1, 3], { rate: 0.23, spread: 1, smooth: 1, sync: "Free", seed: 33 });
  p.cable(r, "out", pd.filt, "cutoff", 0.4).cable(r2, "out", pd.o1, "shape", 0.3).cable(r2, "out", pd.o2, "shape", -0.3);
  finish(p, [5, 0], pd.filt, { stereo: true, trim: -13, verb: { size: 0.6, decay: 4, mix: 0.35 } });
  return p;
}

function toms() {
  const p = patch("Random: Tom Roll", {
    module: "random", tempo: 104,
    description: "The Random module's trigger output fires a tom at irregular moments while its stepped output retunes it each time, a loose, tuned roll over a steady kick. Raise Rate for a busier roll or pull Spread in for a narrower range of pitches.",
    tags: ["drums", "tom", "trigger", "pitch"],
  });
  const r = p.add("random", [0, 0], { rate: 6, spread: 0.8, bias: 0, smooth: 0, sync: "1/16", seed: 5 });
  const tom = p.add("punch-tom", [1, 0], { tune: 140, decay: 0.35, bend: 0.4, level: 0.7 });
  const kick = p.add("punch-kick", [1, 1], { level: 0.7 });
  const g = p.add("lfo", [0, 2], { wave: "Square", sync: "Tempo", division: "1/4", polarity: "Unipolar", pw: 0.1 }, { name: "Pulse" });
  p.cable(r, "trig", tom, "trig").cable(r, "out", tom, "tune", 0.3).cable(g, "out", kick, "trig");
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -9, master: 0 });
  const v = p.add("reverb", [3, 0], { size: 0.45, decay: 2, mix: 0.2, quality: "Eco (8 lines)" });
  p.cable(tom, "out", mix, "in1l").cable(tom, "out", mix, "in1r").cable(kick, "out", mix, "in2l").cable(kick, "out", mix, "in2r")
    .stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function bells() {
  const p = patch("Random: Raised Bells", {
    module: "random", tempo: 84,
    description: "A high Bias and a narrow Spread keep the random notes in a bright upper range, like a music box wandering over a held drone. Set Bias to zero and widen Spread to bring the bells down across the whole range.",
    tags: ["bias", "spread", "bells", "ambient"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "G", scale: "Major Pentatonic", octave: 1, gatelength: 0.2 },
    { data: steps([0, 0, ".", 0, 0, ".", 0, 0]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0 }, { name: "Bell" });
  const mod = p.add("oscillator", [1, 1], { shape: 0, coarse: 7, octave: "+1" }, { name: "Overtone" });
  const env = p.add("adsr", [2, 1], { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 }, { name: "Bell Env" });
  const amp = p.add("vca", [3, 0], {});
  const r = p.add("random", [0, 3], { spread: 0.3, bias: 0.55, quantize: true, sync: "1/4", seed: 9 });
  const drone = pad(p, [0, 5], [0, 0, 7, 5], { rate: "1/1", root: "G", scale: "Major Pentatonic", octave: -2, gain: 1, shape: 0.2, filter: { cutoff: 700 } });
  p.cable(seq, "pitch", osc, "pitch").cable(r, "out", osc, "pitch", 0.4).cable(seq, "pitch", mod, "pitch").cable(r, "out", mod, "pitch", 0.4)
    .cable(osc, "out", amp, "l").cable(mod, "out", amp, "r", 0.35).cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(env, "env", amp, "gain");
  const mix = p.add("audio-mixer", [4, 0], { level1: -6, level2: -16, master: 0 });
  const v = p.add("reverb", [5, 0], { size: 0.7, decay: 5, mix: 0.4, quality: "Eco (8 lines)" });
  p.stereo(amp, mix, { to: ["in1l", "in1r"] }).stereo(drone.filt, mix, { to: ["in2l", "in2r"] })
    .stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [steppedMelody, lockedLoop, smoothDrift, toms, bells];
