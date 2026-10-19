// spectrum: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

/// A small band: melody + drums on a mixer. Returns {mix, flt, drums, m}.
function band(p, at, o = {}) {
  const m = melody(p, [at[0], at[1]], o.notes || [0, ".", 3, 5, 7, ".", 5, 3, 10, ".", 7, 5, 3, ".", 0, "."], {
    rate: "1/8", root: o.root || "E", scale: "Minor Pentatonic", octave: o.octave ?? 0, shape: o.shape ?? 0.8, gatelength: 0.5,
    env: { decay: 0.25, sustain: 0.1, release: 0.2 },
  });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: o.cutoff ?? 2400, resonance: 0.25 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  const drums = beat(p, [at[0], at[1] + 3], { style: o.style || "half", level: -8 });
  const mix = p.add("audio-mixer", [at[0] + 4, at[1]], { level1: o.lead ?? 2, level2: o.drum ?? 0, master: o.master ?? 0 }, { name: "Band" });
  p.cable(flt, "l", mix, "in1l").cable(flt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { mix, flt, drums, m };
}
/// A one-lane gate pattern (notes: 0 = hit, "_" = tie, "." = rest).
const gateSeq = (p, at, pat, rate, name, o = {}) => p.add("step-sequencer", at, { length: pat.length, rate, root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: o.gatelength ?? 0.9 }, { data: steps(pat) }, { name });
function bandGlance() {
  const p = patch("Spectrum: The Band at a Glance", {
    module: "spectrum", tempo: 108,
    description: "A small band plays through the Spectrum: the kick and bass fill the left, the lead and hats the right, and the dashed line follows the strongest partial. Change Tilt to +4.5 dB/oct to flatten the slope, or Peak Line to Hold to keep the highest marks.",
    tags: ["analyser", "overview", "tilt", "peak line"],
  });
  const b = band(p, [0, 0], { style: "four", lead: 0, drum: 0 });
  const sp = p.add("spectrum", [5, 0], { size: "4096", average: 0.3, tilt: 3, peak: "Falling", sensitivity: 0.5, floor: -90 });
  p.stereo(b.mix, sp, { from: ["outl", "outr"] });
  const verb = p.add("reverb", [6, 0], { size: 0.5, decay: 2, mix: 0.18, quality: "Eco (8 lines)" });
  p.stereo(sp, verb).stereo(verb, p.out);
  return p;
}

function sirenBells() {
  const p = patch("Spectrum: Siren to Bells", {
    module: "spectrum", tempo: 90,
    description: "A quiet siren glides up and down; the Spectrum's Dominant output hears its strongest partial and a Quantizer turns that into bell notes of a minor scale, struck whenever the note changes. Change the Quantizer's Scale, or slow the siren down.",
    tags: ["dominant", "quantizer", "pitch tracking", "bells"],
  });
  const lfo = p.add("lfo", [0, 0], { rate: 0.17, wave: "Triangle" }, { name: "Siren Sweep" });
  const siren = p.add("oscillator", [1, 0], { shape: 0, octave: "0" }, { name: "Siren" });
  p.cable(lfo, "out", siren, "pitch", 1);
  const sv = p.add("vca", [2, 0], { gain: 0.3 }, { name: "Siren Level" });
  p.cable(siren, "out", sv, "l");
  const sp = p.add("spectrum", [3, 0], { size: "2048", average: 0.05, peak: "Off" });
  p.cable(sv, "l", sp, "l");
  const q = p.add("quantizer", [4, 0], { root: "A", scale: "Minor Pentatonic", hysteresis: 0.15, glide: 0 });
  p.cable(sp, "dominant", q, "in");
  const bell = p.add("oscillator", [5, 0], { shape: 0, octave: "+1" }, { name: "Bell" });
  const env = p.add("adsr", [5, 1], { attack: 0.003, decay: 1.2, sustain: 0, release: 0.8 }, { name: "Bell Env" });
  const amp = p.add("vca", [6, 0], {}, { name: "Bell VCA" });
  p.cable(q, "out", bell, "pitch").cable(q, "gate", env, "gate").cable(q, "trigger", env, "retrig").cable(bell, "out", amp, "l").cable(env, "env", amp, "gain");
  const drone = p.add("oscillator", [1, 2], { shape: 0.2, octave: "-2" }, { name: "Drone" });
  const dv = p.add("vca", [2, 2], { gain: 0.35 }, { name: "Drone Level" });
  p.cable(drone, "out", dv, "l");
  finish(p, [7, 0], [{ n: sp, level: -8 }, { n: amp, level: -6, pan: 0.2 }, { n: dv, level: -6 }], { vmix: 0.45, decay: 4, master: 0 });
  return p;
}

function centroidPad() {
  const p = patch("Spectrum: Brightness Drives the Pad", {
    module: "spectrum", tempo: 100,
    description: "A drum loop is analysed and its Centroid, the spectrum's centre of gravity, sets the filter cutoff of a saw pad: when hats and snares crowd in the pad opens, when only the kick is left it dulls. Turn the pad filter's Key Track down to lessen the effect.",
    tags: ["centroid", "brightness", "filter", "follower"],
  });
  const drums = beat(p, [0, 0], { style: "broken", level: -6 });
  const sp = p.add("spectrum", [3, 0], { size: "2048", average: 0.12, peak: "Off" });
  p.stereo(drums, sp, { from: ["outl", "outr"] });
  const seq = gateSeq(p, [0, 4], [0, "_", "_", "_", 3, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"], "1/4", "Pad Chords");
  const mix = p.add("audio-mixer", [3, 4], { level1: -6, level2: -6, level3: -6, master: -2, pan1: -0.4, pan2: 0.4 }, { name: "Pad Mix" });
  [0, 7, 12].forEach((s, i) => {
    const o = p.add("oscillator", [1, 4 + i], { shape: 1, coarse: s, fine: (i - 1) * 9, octave: "-1" }, { name: `Pad ${i + 1}` });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const flt = p.add("filter", [4, 4], { cutoff: 300, resonance: 0.3, keytrack: 1 }, { name: "Brightness Filter" });
  p.stereo(mix, flt, { from: ["outl", "outr"] }).cable(sp, "centroid", flt, "pitch");
  const out = p.add("audio-mixer", [6, 0], { level1: -3, level2: -6, master: -3 }, { name: "Out Mix" });
  p.stereo(sp, out, { from: ["l", "r"], to: ["in1l", "in1r"] }).stereo(flt, out, { to: ["in2l", "in2r"] });
  const verb = p.add("reverb", [7, 0], { size: 0.6, decay: 3, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function fluxHats() {
  const p = patch("Spectrum: Flux Plays the Hats", {
    module: "spectrum", tempo: 110,
    description: "Plucked notes go through the Spectrum, whose Flux trigger fires whenever new energy appears: it plays a closed hat and a rim click on every note, so the percussion follows the melody. Raise Flux Sensitivity to catch the quiet notes too.",
    tags: ["flux", "onset", "trigger", "percussion"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", 5, ".", 7, ".", ".", 3, ".", 5, ".", ".", 10, ".", "."], { rate: "1/8", root: "C", scale: "Major Pentatonic", octave: 0, shape: 0.5, gatelength: 0.3, env: { decay: 0.35, sustain: 0, release: 0.2 } });
  const sp = p.add("spectrum", [3, 0], { size: "1024", average: 0.05, sensitivity: 0.65, peak: "Off" });
  p.cable(m.amp, "l", sp, "l");
  const hats = p.add("punch-hats", [4, 0], { level: 0.5 });
  const rim = p.add("punch-rim", [4, 1], { level: 0.5 });
  p.cable(sp, "flux", hats, "closed").cable(sp, "flux", rim, "trig");
  const hm = p.add("audio-mixer", [5, 0], { level1: -8, level2: -10, pan1: 0.3, pan2: -0.3, master: -2 }, { name: "Percussion" });
  p.cable(hats, "out", hm, "in1l").cable(hats, "out", hm, "in1r").cable(rim, "out", hm, "in2l").cable(rim, "out", hm, "in2r");
  const kick = beat(p, [0, 4], { style: "sparse", level: -8 });
  finish(p, [6, 0], [{ n: sp, level: 0 }, { n: hm, l: "outl", r: "outr", level: 0 }, drumsOf(kick, -2)], { vmix: 0.22, master: 3 });
  return p;
}

function tiltedPad() {
  const p = patch("Spectrum: Sweeping Pad, Tilted", {
    module: "spectrum", tempo: 72,
    description: "A saw pad with a slowly sweeping filter, seen on a long 8192 point average with the Tilt at +4.5 dB/oct so the slope looks level and the peak line stays up in Hold. Press Reset Peaks to clear the line, or lower Average for a jumpier picture.",
    tags: ["pad", "sweep", "tilt", "peak hold", "resolution"],
  });
  const seq = gateSeq(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 5, "_", "_", "_", "_", "_", "_", "_"], "1/2", "Pad Roots");
  const mix = p.add("audio-mixer", [3, 0], { level1: -6, level2: -6, level3: -6, master: -2, pan1: -0.5, pan2: 0.5 }, { name: "Pad Mix" });
  [0, 7, 12].forEach((s, i) => {
    const o = p.add("oscillator", [1, i], { shape: 1, coarse: s, fine: (i - 1) * 8, octave: "-1" }, { name: `Pad ${i + 1}` });
    p.cable(seq, "pitch", o, "pitch").cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const lfo = p.add("lfo", [3, 3], { rate: 0.07, wave: "Triangle" }, { name: "Sweep" });
  const flt = p.add("filter", [4, 0], { cutoff: 900, resonance: 0.35 }, { name: "Sweep Filter" });
  p.stereo(mix, flt, { from: ["outl", "outr"] }).cable(lfo, "out", flt, "cutoff", 0.8);
  const sp = p.add("spectrum", [5, 0], { size: "8192", average: 0.6, tilt: 4.5, peak: "Hold", floor: -80 });
  p.stereo(flt, sp);
  const verb = p.add("reverb", [6, 0], { size: 0.8, decay: 5, mix: 0.3, quality: "Eco (8 lines)" });
  const tm = p.add("audio-mixer", [6, 1], { level1: -14, master: -3 }, { name: "Trim" });
  p.stereo(sp, tm, { to: ["in1l", "in1r"] });
  p.stereo(tm, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

export default [bandGlance, sirenBells, centroidPad, fluxHats, tiltedPad];
