// SPDX-License-Identifier: MIT
// Room Print (room-print): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
const seqOf = (p, at, notes, o = {}) => p.add("step-sequencer", at, {
  length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
  octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
}, { data: steps(notes) });

/// `src`'s pitch from the sequencer (jack `pitch`, or none), its output (`jack`) through an ADSR-driven VCA.
function gated(p, at, src, seq, jack, pitch, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(seq, "pitch", src, pitch);
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(src, jack, amp, "l").cable(env, "env", amp, "gain");
  return { amp, env };
}

/// Mono or stereo source → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.22, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// Mono or stereo source → trim mixer → Out 1/2 (no reverb).
function direct(p, at, src, jacks, trim = 0, master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

/// A voice and a drum loop into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

const pluck = (p, at, o = {}) => melody(p, at, o.notes || [0, 3, 7, 10, 7, 3, 5, 7, 12, 10, 7, 3, 5, 3, 0, "."],
  { rate: o.rate || "1/8", shape: o.shape ?? 0.7, root: o.root || "A", scale: "Minor Pentatonic", gatelength: o.gate ?? 0.4, octave: o.octave ?? 0,
    env: o.env || { attack: 0.004, decay: 0.25, sustain: 0.1, release: 0.2 } });

function hallPluck() {
  const p = patch("Room Print: Hall Pluck", {
    module: "room-print", tempo: 96,
    description: "A plucked melody in the built-in Hall response. The late part is cut a little with Early/Late and the highs of the tail damp early, so the hall sounds warm. Raise Mix for a bigger space or switch Impulse to Cathedral.",
    tags: ["hall", "melody", "convolution", "natural"],
  });
  const m = pluck(p, [0, 0]);
  const r = p.add("room-print", [3, 0], { source: "Hall", mix: 0.35, predelay: 0.02, damphigh: 0.4, level: 1 });
  p.cable(m.amp, "l", r, "l");
  direct(p, [4, 0], r, ["l", "r"], 3);
  return p;
}

function drumTank() {
  const p = patch("Room Print: Drum Tank", {
    module: "room-print", tempo: 112,
    description: "A drum loop through the ringing Tank response: every hit excites metal modes and the kit gets a resonant, clanging halo. Early/Late at the low end keeps only the first reflections for a tighter kit.",
    tags: ["drums", "tank", "metal", "resonant"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -5 });
  const r = p.add("room-print", [3, 0], { source: "Tank", mix: 0.3, balance: 0.4, level: 1 });
  p.cable(d, "outl", r, "l").cable(d, "outr", r, "r");
  direct(p, [4, 0], r, ["l", "r"], 3);
  return p;
}

function springBounce() {
  const p = patch("Room Print: Spring Bounce", {
    module: "room-print", tempo: 100,
    description: "A bass-heavy riff through the Spring response: chirping, repeating echoes that bounce behind every note. Stretch changes the pitch and length of the boing, and Damp High softens it.",
    tags: ["spring", "bass", "echoes", "chirp"],
  });
  const m = pluck(p, [0, 0], { notes: [0, ".", 0, 3, ".", 7, ".", 5], rate: "1/8", root: "E", octave: -1, shape: 0.9, gate: 0.3 });
  const r = p.add("room-print", [3, 0], { source: "Spring", mix: 0.45, level: 1, stretch: 1.1 });
  p.cable(m.amp, "l", r, "l");
  direct(p, [4, 0], r, ["l", "r"], 4);
  return p;
}

function swellBloom() {
  const p = patch("Room Print: Swell Bloom", {
    module: "room-print", tempo: 70,
    description: "Short chords go through the Swell response: its tail is played backwards, so each note blooms into a rising wash after the sound has gone. Predelay moves the bloom; Trim Start makes it arrive sooner.",
    tags: ["swell", "reverse", "pad", "ambient"],
  });
  const m = pluck(p, [0, 0], { notes: [0, ".", ".", ".", 5, ".", ".", ".", 7, ".", ".", ".", 3, ".", ".", "."], rate: "1/4", shape: 0.6, root: "D", env: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 0.3 } });
  const r = p.add("room-print", [3, 0], { source: "Swell", mix: 0.6, predelay: 0.06, level: 1 });
  p.cable(m.amp, "l", r, "l");
  direct(p, [4, 0], r, ["l", "r"], 6, 3);
  return p;
}

function gatedKit() {
  const p = patch("Room Print: Gated Kit", {
    module: "room-print", tempo: 118,
    description: "A drum loop in the Gate response: a dense burst that stops abruptly, giving every hit a big, short, cut-off space. Stretch lengthens or shortens the burst, Mix sets how much is added.",
    tags: ["gate", "drums", "big", "burst"],
  });
  const d = beat(p, [0, 0], { style: "shuffle", level: -4 });
  const r = p.add("room-print", [3, 0], { source: "Gate", mix: 0.5, balance: 0.35, level: 1 });
  p.cable(d, "outl", r, "l").cable(d, "outr", r, "r");
  direct(p, [4, 0], r, ["l", "r"], 3);
  return p;
}

export default [hallPluck, drumTank, springBounce, swellBloom, gatedKit];
