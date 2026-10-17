// Dial: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A Step Sequencer: `notes` as in steps(); `knobs` are its settings; `vel` the velocities.
function sq(p, at, notes, knobs = {}, vel) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: "1/8", gatelength: 0.45, ...knobs }, { data: steps(notes, vel) });
}

/// Oscillator → ADSR → VCA from a pitch and gate source ({node, pitch, gate, trigger, velocity}), optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger !== false) p.cable(src.node, src.trigger || "trigger", env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Mono source → optional delay → reverb → Out 1/2. Returns the reverb.
function space(p, at, from, jack, { level = 3, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: true }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    node = p.add("zone-delay", [c, r], delay);
    p.stereo(m, node, { from: out });
    out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

/// Mono voice + drums → mixer → short reverb → Out 1/2.
function withBeat(p, at, from, jack, style, { lead = -2, drums = -4, level = -9, verb = {} } = {}) {
  const [c, r] = at;
  const d = beat(p, [c, r + 1], { style, level });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: lead, level2: drums, master: -2 }, { name: "Mix" });
  p.cable(from, jack, mix, "in1l").cable(from, jack, mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [c + 2, r], { size: 0.3, decay: 1.2, mix: 0.12, ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

function filterSweep() {
  const p = patch("Dial: Filter Sweep", {
    module: "dial", tempo: 108,
    description: "One Dial, set to the middle of its range, opens the cutoff of a dark saw riff. Drag the big knob up and down while it plays to sweep the filter, or raise Smooth to make the knob glide between positions.",
    tags: ["filter", "sweep", "control", "manual"],
  });
  const s = sq(p, [0, 0], [0, ".", 0, 7, ".", 5, 3, "."], { rate: "1/16", root: "D", scale: "Natural Minor", octave: -1 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.95 }, env: { decay: 0.2, sustain: 0.3, release: 0.1 }, filter: { cutoff: 260, resonance: 0.35, gain: -6 } });
  const d = p.add("dial", [1, 2], { value: 0.55, min: 0, max: 1, smooth: 0.1 }, { name: "Cutoff Dial" });
  p.cable(d, "out", v.filter, "cutoff", 0.7);
  space(p, [4, 0], v.out, "l", { level: 0, delay: { zone: 3, time: 0.4, feedback: 0.35, mix: 0.25 }, verb: { size: 0.4, decay: 1.8, mix: 0.2 } });
  return p;
}

function steppedTranspose() {
  const p = patch("Dial: Stepped Transpose", {
    module: "dial", tempo: 100,
    description: "With Steps set to 12 the Dial jumps between fixed positions instead of sliding, and it feeds the sequencer's Transpose input so the whole tune moves up and down in whole notes. Set Steps to 0 to get a smooth slide, or change Steps to 5 for coarser jumps.",
    tags: ["steps", "transpose", "quantised", "melody"],
  });
  const s = sq(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2], { rate: "1/8", root: "C", scale: "Major Pentatonic" });
  const d = p.add("dial", [0, 2], { value: 0.33, min: 0, max: 1, smooth: 0.02, steps: 12 }, { name: "Transpose Dial" });
  p.cable(d, "out", s, "transpose", 0.5);
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.5 }, env: { decay: 0.35, sustain: 0.15, release: 0.3 }, filter: { cutoff: 2800, resonance: 0.15 } });
  space(p, [4, 0], v.out, "l", { delay: { zone: 3, time: 0.45, feedback: 0.4, mix: 0.3 }, verb: { size: 0.5, decay: 2.5, mix: 0.3 } });
  return p;
}

function reverbBlend() {
  const p = patch("Dial: Reverb Blend", {
    module: "dial", tempo: 76,
    description: "The Dial rides the Mix knob of a very long reverb behind a slow bell tune: at the bottom you hear the dry notes, at the top only their wash. Move it slowly and listen to the tune sink into the room.",
    tags: ["reverb", "mix", "ambient", "blend"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 12, ".", 9, 4], { rate: "1/4", shape: 0.25, root: "F", scale: "Lydian", env: { attack: 0.01, decay: 0.9, sustain: 0.1, release: 0.8 } });
  const v = p.add("reverb", [3, 0], { size: 0.85, decay: 9, preDelay: 0.04, damping: 0.5, mix: 0.2 });
  const d = p.add("dial", [3, 2], { value: 0.55, min: 0, max: 1, smooth: 0.4 }, { name: "Wash Dial" });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r").stereo(v, p.out).cable(d, "out", v, "mix", 0.8);
  return p;
}

function flippedRange() {
  const p = patch("Dial: Flipped Range", {
    module: "dial", tempo: 120,
    description: "Min is higher than Max, so turning the Dial up closes the filter and eases off the drive while the bass sits on a beat. Swap Min and Max to turn the action around, or narrow them to limit how far the knob can go.",
    tags: ["inverted", "min max", "bass", "scaling"],
  });
  const s = sq(p, [0, 0], [0, 0, ".", 12, 0, ".", 7, 10], { rate: "1/16", root: "G", scale: "Minor Pentatonic", octave: -2, gatelength: 0.55 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.97 }, env: { decay: 0.16, sustain: 0.4, release: 0.08 }, filter: { cutoff: 300, resonance: 0.4, drive: 0.2, gain: -4 } });
  const d = p.add("dial", [1, 2], { value: 0.4, min: 1, max: 0, smooth: 0.05 }, { name: "Flipped Dial" });
  p.cable(d, "out", v.filter, "cutoff", 0.6).cable(d, "out", v.filter, "drive", 0.5);
  withBeat(p, [3, 0], v.out, "l", "four", { lead: -5 });
  return p;
}

function morphMacro() {
  const p = patch("Dial: Morph Macro", {
    module: "dial", tempo: 92,
    description: "One Dial fans out to three destinations at different strengths: the oscillator shape, the filter cutoff and the delay mix, so a single gesture takes a soft sine pluck to a bright, echoing saw. Change the cable amounts to rebalance the macro.",
    tags: ["macro", "multi", "morph", "performance"],
  });
  const s = sq(p, [0, 0], [0, 3, 7, 10, 7, 3, 5, 2], { rate: "1/8", root: "A", scale: "Natural Minor" });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.1 }, env: { decay: 0.3, sustain: 0.15, release: 0.2 }, filter: { cutoff: 900, resonance: 0.2 } });
  const d = p.add("dial", [1, 2], { value: 0.45, min: 0, max: 1, smooth: 0.15 }, { name: "Macro Dial" });
  const dl = p.add("zone-delay", [4, 0], { zone: 3, time: 0.45, feedback: 0.45, mix: 0.15, tone: -0.2 });
  const vb = p.add("reverb", [5, 0], { size: 0.5, decay: 2.2, mix: 0.25 });
  p.cable(v.out, "l", dl, "l").cable(v.out, "l", dl, "r").stereo(dl, vb).stereo(vb, p.out);
  p.cable(d, "out", v.osc, "shape", 0.8).cable(d, "out", v.filter, "cutoff", 0.5).cable(d, "out", dl, "mix", 0.5);
  return p;
}

export default [filterSweep, steppedTranspose, reverbBlend, flippedRange, morphMacro];
