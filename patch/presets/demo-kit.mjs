// SPDX-License-Identifier: MIT
//
// Shared building blocks for the demo patches (demos/<module>.mjs): a melody
// source and a drum beat, so most of a demo's nodes are the module it shows.
// Everything here plays with the transport and needs no input.
import { steps, drumGrid, pattern } from "./kit.mjs";

/// A plucked melody: Step Sequencer → Oscillator → ADSR-driven VCA. Mono audio out on `amp`'s "l".
///   notes: semitones above the root per step (null/"." rest, "_" tie), see kit.steps()
///   opts:  rate, root, scale, octave, gatelength, shape (0 sine … 1 saw), osc (extra Oscillator knobs),
///          env ({attack, decay, sustain, release}), vel (velocities)
/// Returns {seq, osc, env, amp}: take `seq` "pitch"/"gate"/"trigger"/"notes", or `amp` "l" for sound.
export function melody(p, at, notes, opts = {}) {
  const [c, r] = at;
  const seq = p.add("step-sequencer", [c, r], {
    length: Math.min(32, notes.length), rate: opts.rate || "1/8", root: opts.root || "A",
    scale: opts.scale || "Minor Pentatonic", octave: opts.octave ?? 0, gatelength: opts.gatelength ?? 0.45,
  }, { data: steps(notes, opts.vel) });
  const osc = p.add("oscillator", [c + 1, r], { shape: opts.shape ?? 0.8, ...(opts.osc || {}) }, { name: opts.oscName || "Source" });
  const env = p.add("adsr", [c + 1, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(opts.env || {}) },
    { name: "Amp Env" });
  const amp = p.add("vca", [c + 2, r], {}, { name: "VCA" });
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return { seq, osc, env, amp };
}

const BEATS = {
  four: ["X...x...X...x...", "....X.......X...", "x.x.x.x.x.x.x.x.", "..............x."],
  half: ["X.......x.......", "........X.......", "x...x...x...x...", ""],
  broken: ["X..x..x...X..x..", "....X..x....X...", "x.xxx...x.xxx...", "......x.......x."],
  sparse: ["X.......X.......", "", "..x...x...x...x.", ""],
  shuffle: ["X.....x...X.....", "....X.......X...", "x.xx.xx.xx.xx.x.", ""],
};

/// A drum beat: Drum Grid → Punch Kick, Snare, Hats → Audio Mixer. Stereo audio on the returned mixer's "outl"/"outr".
///   opts: style ("four" | "half" | "broken" | "sparse" | "shuffle"), level (mixer master dB, default −6)
export function beat(p, at, opts = {}) {
  const [c, r] = at;
  const rows = BEATS[opts.style || "four"];
  const grid = p.add("drum-grid", [c, r], {}, { data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Tom", "Tom 2", "Perc"],
    [pattern("Beat", rows)]) });
  const kick = p.add("punch-kick", [c + 1, r], { level: 0.8 });
  const snare = p.add("punch-snare", [c + 1, r + 1], { level: 0.6 });
  const hats = p.add("punch-hats", [c + 1, r + 2], { level: 0.5 });
  const mix = p.add("audio-mixer", [c + 2, r], { level1: -3, level2: -6, pan2: 0.1, level3: -12, pan3: 0.25, master: opts.level ?? -6 },
    { name: "Drum Mix" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity")
    .cable(grid, "gate2", snare, "trig").cable(grid, "velocity2", snare, "velocity")
    .cable(grid, "gate3", hats, "closed").cable(grid, "gate4", hats, "open").cable(grid, "velocity3", hats, "velocity")
    .cable(kick, "out", mix, "in1l").cable(snare, "out", mix, "in2l").cable(hats, "out", mix, "in3l");
  return mix;
}
