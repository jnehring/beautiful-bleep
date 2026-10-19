// Note Looper: five demo patches. Each plays by itself with the transport: the loops are already recorded
// (they are the node's data), so there is something to change from the first bar.
// SPDX-License-Identifier: MIT
import { patch } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A loop for the Note Looper's data: `list` is [start, length, MIDI note, velocity 0–1] in quarter notes from the loop start.
const loopData = (list) => ({ notes: list.map(([s, l, n, v = 0.8]) => [s, l, n, v, 1]) });

/// Notes in → pitch/gate/velocity → Oscillator → ADSR → VCA (→ Filter). Returns {out, ntc, osc, env, amp}.
function mono(p, at, src, o = {}) {
  const [c, r] = at;
  const ntc = p.add("notes-to-cv", [c, r], { retrigger: "On", ...(o.ntc || {}) });
  const osc = p.add("oscillator", [c + 1, r], { shape: 0.8, ...(o.osc || {}) }, { name: o.name || "Voice" });
  const env = p.add("adsr", [c + 1, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.25, ...(o.env || {}) }, { name: "Voice Env" });
  const amp = p.add("vca", [c + 2, r], {}, { name: "Voice VCA" });
  p.cable(src.node, src.jack || "notes", ntc, "notes").cable(ntc, "pitch", osc, "pitch").cable(ntc, "gate", env, "gate")
    .cable(ntc, "trigger", env, "retrig").cable(ntc, "velocity", env, "velocity").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  let out = amp, jack = "l";
  if (o.filter) {
    out = p.add("filter", [c + 3, r], o.filter, { name: "Voice Filter" });
    p.cable(amp, "l", out, "l");
  }
  return { out, jack: o.filter ? "l" : jack, ntc, osc, env, amp };
}

/// Mono audio → Level → (Delay) → Reverb → Out 1/2.
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

function groove() {
  const p = patch("Note Looper: Recorded Groove", {
    module: "note-looper", tempo: 110,
    description: "A two-bar bass line, recorded earlier, loops over a beat. Set Mode to Overdub and play along to add notes on top, press Undo to take the last layer off again, or Clear to start over.",
    tags: ["loop", "bass", "overdub", "groove"],
  });
  const loop = loopData([[0, 0.5, 45, 0.95], [1, 0.5, 45, 0.7], [1.5, 0.5, 48, 0.8], [2, 0.5, 50, 0.85], [3, 0.5, 52, 0.8], [3.5, 0.5, 50, 0.7],
    [4, 0.5, 45, 0.95], [5, 0.5, 45, 0.7], [5.5, 0.5, 52, 0.85], [6, 0.5, 50, 0.8], [7, 0.5, 48, 0.8], [7.5, 0.5, 45, 0.75]]);
  const l = p.add("note-looper", [2, 0], { bars: 2, mode: "Play" }, { data: loop });
  const v = mono(p, [4, 0], { node: l }, { osc: { shape: 0.95 }, env: { decay: 0.18, sustain: 0.45, release: 0.08 }, filter: { cutoff: 520, resonance: 0.35, drive: 0.15 } });
  withBeat(p, [8, 0], v.out, v.jack, "four", { lead: -2 });
  return p;
}

function ghostNotes() {
  const p = patch("Note Looper: Ghost Notes", {
    module: "note-looper", tempo: 118,
    description: "A one-bar sixteenth-note figure is played with 55 % Probability, so every pass keeps a different set of its notes. Change Seed for another sequence of passes, or raise Probability to 100 % for the full figure.",
    tags: ["probability", "arpeggio", "generative", "pluck"],
  });
  const pitches = [57, 60, 64, 67, 64, 60, 69, 67, 64, 60, 57, 60, 64, 72, 69, 67];
  const loop = loopData(pitches.map((n, i) => [i * 0.25, 0.2, n, i % 4 === 0 ? 0.95 : 0.65]));
  const l = p.add("note-looper", [2, 0], { bars: 1, probability: 0.55, seed: 5 }, { data: loop });
  const v = mono(p, [4, 0], { node: l }, { osc: { shape: 0.5 }, env: { decay: 0.15, sustain: 0, release: 0.15 }, filter: { cutoff: 3600, resonance: 0.2 } });
  space(p, [8, 0], v.out, v.jack, { level: 4, delay: { zone: 3, time: 0.375, feedback: 0.45, mix: 0.3 }, verb: { size: 0.5, decay: 2.5, mix: 0.25 } });
  return p;
}

function halfSpeed() {
  const p = patch("Note Looper: Half Speed Drift", {
    module: "note-looper", tempo: 120,
    description: "A two-bar tune loops at half speed, so it takes four bars to come round and every note is twice as long. Set Speed to Double or Normal to hear the same notes at other speeds.",
    tags: ["speed", "slow", "melody", "ambient"],
  });
  const loop = loopData([[0, 1, 69, 0.8], [1, 0.5, 72, 0.6], [1.5, 0.5, 76, 0.7], [2, 1.5, 74, 0.8], [4, 1, 72, 0.7], [5, 1, 67, 0.6], [6, 2, 69, 0.8]]);
  const l = p.add("note-looper", [2, 0], { bars: 2, speed: "Half" }, { data: loop });
  const v = mono(p, [4, 0], { node: l }, { osc: { shape: 0.1 }, env: { attack: 0.03, decay: 1, sustain: 0.3, release: 1.2 } });
  space(p, [8, 0], v.out, v.jack, { level: 5, delay: { zone: 4, time: 0.75, feedback: 0.5, mix: 0.3, tone: -0.3 }, verb: { size: 0.85, decay: 7, mix: 0.45 } });
  return p;
}

function tidiedTake() {
  const p = patch("Note Looper: Tidied Take", {
    module: "note-looper", tempo: 104,
    description: "A loosely played one-bar riff, quantized to sixteenths by a Strength that a slow LFO sweeps from none to full: you hear the take tighten and loosen again. Turn Strength up for a fixed amount, or try Quantize 1/8T.",
    tags: ["quantize", "strength", "humanise", "riff"],
  });
  const raw = [[0.03, 0.4, 57], [0.58, 0.3, 60], [1.04, 0.4, 64], [1.47, 0.25, 60], [2.07, 0.4, 67], [2.55, 0.3, 64], [3.02, 0.35, 60], [3.58, 0.3, 62]];
  const loop = loopData(raw.map(([s, l, n], i) => [s, l, n, i % 2 ? 0.65 : 0.9]));
  const l = p.add("note-looper", [2, 0], { bars: 1, quantize: "1/8", strength: 0 }, { data: loop });
  const lfo = p.add("lfo", [1, 2], { rate: 0.12, wave: "Triangle", polarity: "Unipolar" }, { name: "Strength LFO" });
  p.cable(lfo, "out", l, "strength");
  const v = mono(p, [4, 0], { node: l }, { osc: { shape: 0.7 }, env: { decay: 0.22, sustain: 0.1, release: 0.15 }, filter: { cutoff: 2400, resonance: 0.25 } });
  withBeat(p, [8, 0], v.out, v.jack, "broken", { lead: 0, verb: { size: 0.4, decay: 1.6, mix: 0.15 } });
  return p;
}

function loopIntoEcho() {
  const p = patch("Note Looper: Loop Into Echo", {
    module: "note-looper", tempo: 96,
    description: "A sparse two-bar loop feeds a Note Echo that climbs the scale and fans into chord tones, so a handful of recorded notes becomes a shimmering figure. Mute the Echo's Original or change its Rate to reshape it.",
    tags: ["chain", "echo", "ambient", "figure"],
  });
  const loop = loopData([[0, 1, 57, 0.9], [2.5, 0.5, 64, 0.7], [4, 1, 60, 0.85], [6, 1.5, 67, 0.75]]);
  const l = p.add("note-looper", [2, 0], { bars: 2 }, { data: loop });
  const e = p.add("note-echo", [4, 0], { rate: "1/8", repeats: 6, decay: 0.18, steps: 1, spread: 0.5, fan: "Up-Down", length: 0.6, root: "A", scale: "Minor Pentatonic" });
  p.cable(l, "notes", e, "notes");
  const v = mono(p, [6, 0], { node: e }, { osc: { shape: 0.3 }, env: { decay: 0.45, sustain: 0.05, release: 0.4 }, filter: { cutoff: 3000 } });
  space(p, [10, 0], v.out, v.jack, { level: 4, delay: { zone: 4, time: 0.5, feedback: 0.4, mix: 0.25 }, verb: { size: 0.8, decay: 5, mix: 0.4 } });
  return p;
}

export default [groove, ghostNotes, halfSpeed, tidiedTake, loopIntoEcho];
