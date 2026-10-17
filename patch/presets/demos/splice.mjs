// SPDX-License-Identifier: MIT
// Splice: five demo patches. Each plays by itself with the transport.
// Every patch records its own audio onto the reel with a Record gate from an LFO, so there is nothing to load.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Record gate: high at the start of every `every` for the share `pw` (a square LFO, unipolar).
const recordGate = (p, at, every, pw, name = "Record") => p.add("lfo", at, { wave: "Square", sync: every, polarity: "Unipolar", pw }, { name });

/// Trim mixer → Verb → Out 1/2.
function out(p, at, src, o = {}) {
  const m = p.add("audio-mixer", at, { level1: o.trim ?? 0, pan1: -1, level2: o.trim ?? 0, pan2: 1, master: o.master ?? 0 }, { name: "Level" });
  p.cable(src, "l", m, "in1l").cable(src, "r", m, "in2r");
  const v = p.add("reverb", [at[0] + 1, at[1]], { size: 0.5, decay: 2.2, damping: 0.5, mix: o.mix ?? 0.2, quality: "Eco (8 lines)" });
  p.cable(m, "outl", v, "l").cable(m, "outr", v, "r").stereo(v, p.out);
}

function twoBarLoop() {
  const p = patch("Splice: Two-Bar Loop", {
    module: "splice", tempo: 96,
    description: "A plucked phrase is recorded onto the reel for two bars, then the splice loops it back with Sync on 2 bars, so the loop stays on the beat. The live phrase is heard while it is recorded (Monitor). Try Sync, Speed or Window Size to bend the loop, or set Record Target to Current splice and Overdub to layer more on top.",
    tags: ["looper", "sync", "monitor", "phrase"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, 5, 3, ".", 7, 10, 0, ".", 5, 3, 7, ".", 12, 10], { rate: "1/8", root: "D", scale: "Dorian",
    env: { decay: 0.35, sustain: 0.3, release: 0.2 }, gatelength: 0.6, shape: 0.5 });
  const rec = recordGate(p, [2, 1], "8 bars", 0.25);
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Input while recording", sync: "2 bars", loop: "Loop", window: 1, overlap: 0.4, speed: 1, level: 1 });
  p.cable(m.amp, "l", s, "l").cable(m.amp, "l", s, "r").cable(rec, "out", s, "record");
  out(p, [4, 0], s, { trim: 0, mix: 0.2, master: -2 });
  return p;
}

function tapeStop() {
  const p = patch("Splice: Tape Stop", {
    module: "splice", tempo: 110,
    description: "A drum bar is recorded, then plays from the reel while a ramp pulls Speed down towards zero every two bars: the whole loop slows, drops in pitch and winds to a halt before the tape snaps back to full speed. Edit the ramp's Rate or amount, or try a negative Speed to run the tape backwards.",
    tags: ["tape stop", "speed", "drums", "slow down"],
  });
  const d = beat(p, [0, 0], { style: "broken", level: -3 });
  const rec = recordGate(p, [2, 1], "4 bars", 0.25);
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Off", sync: "1 bar", loop: "Loop", window: 1, overlap: 0.4, speed: 1, level: 1 });
  const ramp = p.add("lfo", [3, 1], { wave: "Saw Up", sync: "2 bars", polarity: "Unipolar" }, { name: "Tape Stop" });
  p.cable(d, "outl", s, "l").cable(d, "outr", s, "r").cable(rec, "out", s, "record").cable(ramp, "out", s, "speed", -0.13);
  out(p, [4, 0], s, { trim: 0, mix: 0.15 });
  return p;
}

function reelKeyboard() {
  const p = patch("Splice: Reel Keyboard", {
    module: "splice", tempo: 100,
    description: "One recorded note is replayed as an instrument: a sequencer's Pitch drives the Speed input (1 V per octave) and its trigger restarts the splice, with Loop on One-shot. Change the sequence for a new tune, or Window Size for another timbre; pitch and speed move together, like tape.",
    tags: ["sampler", "melodic", "speed input", "one-shot"],
  });
  const src = p.add("oscillator", [0, 0], { shape: 0.25 }, { name: "Note" });
  const env = p.add("adsr", [0, 1], { attack: 0.003, decay: 0.8, sustain: 0.3, release: 0.4 }, { name: "Note Env" });
  const amp = p.add("vca", [1, 0], {}, { name: "VCA" });
  const nseq = p.add("step-sequencer", [0, 2], { length: 1, rate: "1/1", root: "C", octave: -1 }, { data: steps([0]), name: "Note Seq" });
  p.cable(nseq, "pitch", src, "pitch").cable(nseq, "gate", env, "gate").cable(src, "out", amp, "l").cable(env, "env", amp, "gain");
  const gate = recordGate(p, [1, 1], "8 bars", 0.12, "Record");
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Off", window: 1, overlap: 0.4, loop: "One-shot", speed: 1, level: 1.5, fade: 0.004 });
  const k = melody(p, [0, 3], [0, 3, 7, 12, 10, 7, 3, 5], { rate: "1/8", root: "C", scale: "Minor Pentatonic", octave: 0 }).seq;
  p.cable(amp, "l", s, "l").cable(amp, "l", s, "r").cable(gate, "out", s, "record").cable(k, "pitch", s, "speed").cable(k, "trigger", s, "play");
  out(p, [4, 0], s, { trim: 0, mix: 0.25, master: -3 });
  return p;
}

function chop() {
  const p = patch("Splice: Break Chopper", {
    module: "splice", tempo: 120,
    description: "A drum bar is recorded and then replayed one eighth at a time: Window Size is 1/8 of the splice and a stepped random source picks Position every eighth note, so the break is re-cut into a stuttering new beat. The random loops after eight steps, so the pattern repeats; raise Loop towards 0 for endless variation.",
    tags: ["chop", "break", "windows", "random"],
  });
  const d = beat(p, [0, 0], { style: "four", level: -3 });
  const rec = recordGate(p, [2, 1], "8 bars", 0.125);
  const rnd = p.add("random", [2, 2], { sync: "1/8", spread: 1, loop: 0.95, length: "8 steps", seed: 6 }, { name: "Slice Picker" });
  const uni = p.add("utility", [3, 2], { scalex: 0.5, offset: 0.5 }, { name: "Unipolar" });
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Off", sync: "1 bar", loop: "Loop", window: 0.125, overlap: 0.4, position: 0, level: 1 });
  p.cable(d, "outl", s, "l").cable(d, "outr", s, "r").cable(rec, "out", s, "record").cable(rnd, "out", uni, "x").cable(uni, "out", s, "position", 0.875);
  out(p, [4, 0], s, { trim: 0, mix: 0.12 });
  return p;
}

function microCloud() {
  const p = patch("Splice: Micro Cloud", {
    module: "splice", tempo: 80,
    description: "A short chord arpeggio is recorded, then replayed in 3 % windows with Overlap at 90 %, which turns it into a granular cloud; a slow LFO scrubs Position across the splice. Raise Window Size to hear the phrase re-emerge, or lower Overlap below 30 % for a rhythmic stutter.",
    tags: ["texture", "granular", "windows", "ambient"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 14, 11, 7, 4], { rate: "1/8", shape: 0.5, root: "C", scale: "Major",
    env: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 0.4 } });
  const rec = recordGate(p, [2, 1], "8 bars", 0.125);
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Off", window: 0.03, overlap: 0.9, speed: 1, level: 1.3 });
  const scrub = p.add("lfo", [3, 1], { rate: 0.08, wave: "Triangle", polarity: "Unipolar" }, { name: "Scrub" });
  p.cable(m.amp, "l", s, "l").cable(m.amp, "l", s, "r").cable(rec, "out", s, "record").cable(scrub, "out", s, "position", 0.9);
  out(p, [4, 0], s, { trim: 0, mix: 0.35 });
  return p;
}

export default [twoBarLoop, tapeStop, reelKeyboard, chop, microCloud];
