// SPDX-License-Identifier: MIT
// Organic LFOs: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Four filtered oscillators holding a chord: returns {oscs, filts} (mono filter outs on "l").
function chord(p, at, semis, o = {}) {
  const [c, r] = at;
  const oscs = [], filts = [];
  semis.forEach((s, i) => {
    const osc = p.add("oscillator", [c, r + i], { coarse: s, fine: (i - 1.5) * 4, shape: o.shape ?? 0.7, octave: o.octave ?? "-1" },
      { name: `Voice ${i + 1}` });
    const f = p.add("filter", [c + 1, r + i], { cutoff: o.cutoff ?? 700, resonance: o.res ?? 0.25 }, { name: `Filter ${i + 1}` });
    p.cable(osc, "out", f, "l");
    oscs.push(osc); filts.push(f);
  });
  return { oscs, filts };
}

/// Mixer: channel i takes `srcs[i]` = [node, jack]; mono sources feed both sides. Reverb on the send, out to Out 1/2.
function finish(p, at, srcs, o = {}) {
  const [c, r] = at;
  const v = { master: o.master ?? -3, return: o.ret ?? -6 };
  srcs.forEach((s, i) => { v[`level${i + 1}`] = (o.levels || [])[i] ?? -9; v[`pan${i + 1}`] = (o.pans || [])[i] ?? 0; v[`send${i + 1}`] = (o.sends || [])[i] ?? -12; });
  const mix = p.add("audio-mixer", [c, r], v, { name: "Mix" });
  srcs.forEach(([n, j, j2], i) => {
    p.cable(n, j, mix, `in${i + 1}l`).cable(n, j2 || j, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [c + 1, r], { size: 0.6, decay: o.decay ?? 3.5, damping: 0.5, mix: 1, quality: "Eco (8 lines)" }, { name: "Room" });
  p.cable(mix, "sendl", verb, "l").cable(mix, "sendr", verb, "r").cable(verb, "l", mix, "returnl").cable(verb, "r", mix, "returnr");
  p.stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

function livingPad() {
  const p = patch("Organic LFOs: Living Pad", {
    module: "organic-lfos", tempo: 70,
    description: "Eight slow, related LFOs move a four-note chord: four of them open and close the filters, four more shift each voice's waveform, and the level of each voice drifts too. Raise Drift or Spread in the view and the pad starts to breathe unevenly.",
    tags: ["pad", "evolving", "ambient", "drift"],
  });
  const ch = chord(p, [0, 0], [0, 3, 7, 10]);
  const ol = p.add("organic-lfos", [3, 0], { rate: 0.09, spread: 0.45, drift: 0.4, twist: 0.1, scatter: 1, seed: 4 });
  ch.filts.forEach((f, i) => p.cable(ol, `out${i + 1}`, f, "cutoff", 0.55).cable(ol, `out${i + 5}`, ch.oscs[i], "shape", 0.25));
  const mix = finish(p, [4, 0], ch.filts.map((f) => [f, "l"]), { levels: [-12, -12, -12, -12], pans: [-0.6, -0.2, 0.2, 0.6], sends: [-8, -8, -8, -8], decay: 4.5 });
  ol.name = "Eight Lives";
  // the sum slowly swells the reverb return of the whole mix
  p.cable(ol, "sum", mix, "return", 0.15);
  return p;
}

function breathingInTime() {
  const p = patch("Organic LFOs: Breathing in Time", {
    module: "organic-lfos", tempo: 96,
    description: "Lock is on Bars, so LFO 1 breathes once every two bars and the other seven float loosely around the song. They open the filter of a plucked line and pan its echoes while a light beat keeps time. Try Anchor off or a higher Drift to let it slip out of step.",
    tags: ["bars", "locked", "filter", "groove"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 7, 10, 7, 5, 3, 0, 7, 12, 7, 10, 7, 5, 3], { rate: "1/8", root: "D", scale: "Dorian", octave: -1, shape: 0.85 });
  const flt = p.add("filter", [3, 0], { cutoff: 900, resonance: 0.3 }, { name: "Wah" });
  const ol = p.add("organic-lfos", [3, 1], { rate: 0.14, spread: 0.3, drift: 0.3, lock: "Bars", anchor: true, polarity: "Unipolar", twist: 0.4, seed: 9 });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r");
  p.cable(ol, "out1", flt, "cutoff", 0.7).cable(ol, "max", flt, "cutoff", 0.3);
  const drums = beat(p, [0, 3], { style: "half", level: -10 });
  const mix = finish(p, [5, 0], [[flt, "l", "r"], [drums, "outl", "outr"]], { levels: [0, 0], pans: [0, 0], sends: [-9, -22], decay: 2, master: 2 });
  p.cable(ol, "out3", mix, "pan1", 0.5);
  return p;
}

function brightnessPeaks() {
  const p = patch("Organic LFOs: Brightness Peaks", {
    module: "organic-lfos", tempo: 110,
    description: "Max follows whichever of the eight LFOs is highest and drives the cutoff of a saw arpeggio, so the sound flares open every time one of them peaks. The Sum output slowly widens the reverb. Turn Twist up for sharper flares and Scatter down to make them line up.",
    tags: ["max", "arpeggio", "filter", "unipolar"],
  });
  const m = melody(p, [0, 0], [0, 3, 7, 12, 7, 3, 10, 7, 0, 5, 8, 12, 8, 5, 3, 7], { rate: "1/16", root: "A", scale: "Natural Minor", octave: 0, shape: 1, env: { decay: 0.16, sustain: 0.1 } });
  const flt = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.4 }, { name: "Flare" });
  const ol = p.add("organic-lfos", [3, 1], { rate: 0.5, spread: 0.6, drift: 0.5, twist: 0.7, scatter: 1, polarity: "Unipolar", seed: 21 });
  p.cable(m.amp, "l", flt, "l").cable(m.amp, "l", flt, "r").cable(ol, "max", flt, "cutoff", 0.9);
  const mix = finish(p, [4, 0], [[flt, "l", "r"]], { levels: [-3], sends: [-5], decay: 2.5 });
  p.cable(ol, "sum", mix, "send1", 0.4);
  return p;
}

function detunedSwarm() {
  const p = patch("Organic LFOs: Detuned Swarm", {
    module: "organic-lfos", tempo: 80,
    description: "Four sawtooth voices on one note are each detuned by their own LFO, running at a lively 0.6 Hz with high Drift: a restless, chorusing swarm. Try a negative Spread to slow the LFOs down along the row.",
    tags: ["detune", "chorus", "swarm", "drone"],
  });
  const ch = chord(p, [0, 0], [0, 0, 7, 12], { shape: 0.9, octave: "-2", cutoff: 1400, res: 0.15 });
  const ol = p.add("organic-lfos", [3, 0], { rate: 0.6, spread: 0.35, drift: 0.8, twist: -0.3, seed: 33 });
  ch.oscs.forEach((o, i) => p.cable(ol, `out${i + 1}`, o, "fine", 0.18).cable(ol, `out${i + 5}`, ch.filts[i], "cutoff", 0.25));
  finish(p, [4, 0], ch.filts.map((f) => [f, "l"]), { levels: [-12, -12, -12, -12], pans: [-0.8, -0.3, 0.3, 0.8], sends: [-14, -14, -14, -14], decay: 3 });
  return p;
}

function rainOfTones() {
  const p = patch("Organic LFOs: Rain of Tones", {
    module: "organic-lfos", tempo: 100,
    description: "Four bell-like tones, each gated by its own fast, sharp-peaked Organic LFO (Twist +1, Unipolar): irregular pulses fall like rain and never repeat. Move Rate or Spread to make the shower faster or more uneven.",
    tags: ["rhythmic", "tremolo", "bells", "gate"],
  });
  const oscs = [], vcas = [];
  [0, 7, 12, 16, 19, 24].slice(0, 4).forEach((s, i) => {
    const o = p.add("oscillator", [0, i], { coarse: s % 12, octave: s >= 12 ? "+1" : "0", shape: 0.05 }, { name: `Bell ${i + 1}` });
    const v = p.add("vca", [1, i], {}, { name: `Gate ${i + 1}` });
    p.cable(o, "out", v, "l").cable(o, "out", v, "r");
    oscs.push(o); vcas.push(v);
  });
  const ol = p.add("organic-lfos", [2, 0], { rate: 1.6, spread: 0.5, drift: 0.5, twist: 1, scatter: 1, polarity: "Unipolar", level: 0.9, seed: 7 });
  vcas.forEach((v, i) => p.cable(ol, `out${i + 1}`, v, "gain"));
  finish(p, [3, 0], vcas.map((v) => [v, "l", "r"]), { levels: [-8, -8, -8, -8], pans: [-0.7, -0.25, 0.25, 0.7], sends: [-6, -6, -6, -6], decay: 5 });
  return p;
}

export default [livingPad, breathingInTime, brightnessPeaks, detunedSwarm, rainOfTones];
