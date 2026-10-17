// Arpeggiator: five demo patches. Each plays by itself with the transport.
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

/// Three one-note Step Sequencers, one per chord tone, each moving once a bar: together they hold a chord that changes
/// every bar and feeds an Arpeggiator's Notes input. `chords` are lists of three semitones above A.
function chordSource(p, at, arp, chords, octave = 0) {
  const [c, r] = at;
  for (let i = 0; i < 3; i++) {
    const s = sq(p, [c, r + i], chords.map((ch) => ch[i]), { rate: "1/1", root: "A", scale: "Chromatic", octave, gatelength: 1 });
    p.cable(s, "notes", arp, "notes");
  }
}

function risingPluck() {
  const p = patch("Arpeggiator: Rising Pluck", {
    module: "arpeggiator", tempo: 112,
    description: "A four-bar progression of held chords is broken into a plucked run that climbs through two octaves and starts over. Try Pattern, Octaves and Rate on the Arpeggiator to turn the same chords into a different tune.",
    tags: ["up", "chords", "pluck", "octaves"],
  });
  const a = p.add("arpeggiator", [3, 1], { rate: "1/16", pattern: "Up", octaves: 2, gatelength: 0.4 });
  chordSource(p, [0, 0], a, [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]]);
  const v = voice(p, [4, 0], { node: a, velocity: "velocity" }, { osc: { shape: 0.6 }, env: { decay: 0.22, sustain: 0.05, release: 0.2 }, filter: { cutoff: 3200, resonance: 0.15 } });
  space(p, [7, 0], v.out, "l", { level: 4, delay: { zone: 3, time: 0.4, feedback: 0.4, mix: 0.3 }, verb: { size: 0.5, decay: 2, mix: 0.25 } });
  return p;
}

function tripletPingPong() {
  const p = patch("Arpeggiator: Triplet Up-Down", {
    module: "arpeggiator", tempo: 96,
    description: "The Arpeggiator climbs and falls over three octaves in triplet eighths with a touch of Swing, giving a rolling, harp-like figure behind a slow chord change. Change Rate to 1/8 or 1/16 for straight timing.",
    tags: ["up-down", "triplets", "harp", "ambient"],
  });
  const a = p.add("arpeggiator", [3, 1], { rate: "1/8T", pattern: "Up-Down", octaves: 3, gatelength: 0.6, swing: 0.54 });
  chordSource(p, [0, 0], a, [[0, 7, 15], [8, 15, 19], [3, 10, 14], [10, 14, 21]], -1);
  const v = voice(p, [4, 0], { node: a }, { osc: { shape: 0.25 }, env: { decay: 0.5, sustain: 0.1, release: 0.5 }, filter: { cutoff: 3500 } });
  space(p, [7, 0], v.out, "l", { level: 4, delay: { zone: 3, time: 0.45, feedback: 0.45, mix: 0.3, tone: -0.2 }, verb: { size: 0.7, decay: 4, mix: 0.35 } });
  return p;
}

function randomSparks() {
  const p = patch("Arpeggiator: Random Sparks", {
    module: "arpeggiator", tempo: 122,
    description: "The pattern is Random over four octaves at sixteenth notes, so the chord tones scatter into a glittery, never-quite-repeating line over a beat. The Seed picks the shuffle: change it for a different sequence.",
    tags: ["random", "seed", "glitter", "four octaves"],
  });
  const a = p.add("arpeggiator", [3, 1], { rate: "1/16", pattern: "Random", octaves: 4, gatelength: 0.3, seed: 21 });
  chordSource(p, [0, 0], a, [[0, 7, 12], [5, 12, 15], [3, 10, 15], [7, 14, 19]], -1);
  const v = voice(p, [4, 0], { node: a, velocity: "velocity" }, { osc: { shape: 0.5 }, env: { decay: 0.12, sustain: 0, release: 0.12 }, filter: { cutoff: 3600, resonance: 0.2 } });
  withBeat(p, [7, 0], v.out, "l", "shuffle", { lead: 3 });
  return p;
}

function convergingBass() {
  const p = patch("Arpeggiator: Converging Bass", {
    module: "arpeggiator", tempo: 118,
    description: "A low saw bass takes the outside notes first and works inwards, the Converge pattern over two octaves, with a bit of Swing under a driving beat. Try Diverge for the reverse, or Down for a falling line.",
    tags: ["converge", "bass", "swing", "groove"],
  });
  const a = p.add("arpeggiator", [3, 1], { rate: "1/16", pattern: "Converge", octaves: 2, gatelength: 0.55, swing: 0.56 });
  chordSource(p, [0, 0], a, [[0, 7, 12], [-4, 3, 8], [-2, 5, 10], [-5, 2, 7]], -2);
  const v = voice(p, [4, 0], { node: a, velocity: "velocity" }, { osc: { shape: 0.95 }, env: { decay: 0.16, sustain: 0.4, release: 0.07 }, filter: { cutoff: 450, resonance: 0.4, drive: 0.2 } });
  withBeat(p, [7, 0], v.out, "l", "four", { lead: -3 });
  return p;
}

function slowBellWash() {
  const p = patch("Arpeggiator: Slow Bell Wash", {
    module: "arpeggiator", tempo: 70,
    description: "A downward arpeggio at quarter-note speed with a short Gate Length turns each chord into a few soft bell strikes that fade into a long reverb. Increase Rate to eighth notes for a busier shimmer, or Latch to keep a chord ringing.",
    tags: ["down", "slow", "bells", "ambient"],
  });
  const a = p.add("arpeggiator", [3, 1], { rate: "1/4", pattern: "Down", octaves: 3, gatelength: 0.2 });
  chordSource(p, [0, 0], a, [[0, 7, 14], [8, 15, 19], [3, 10, 17], [10, 14, 19]], 0);
  const v = voice(p, [4, 0], { node: a }, { osc: { shape: 0.05 }, env: { decay: 1, sustain: 0, release: 1 } });
  space(p, [7, 0], v.out, "l", { level: 4, delay: { zone: 4, time: 0.55, feedback: 0.5, mix: 0.3, tone: -0.3 }, verb: { size: 0.85, decay: 8, mix: 0.45 } });
  return p;
}

export default [risingPluck, tripletPingPong, randomSparks, convergingBass, slowBellWash];
