// SPDX-License-Identifier: MIT
// Splice: five demo patches. Each plays by itself with the transport.
// Every patch records its own audio into the reel with a Record gate from an LFO, so there is nothing to load.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// A Record gate: high from the very start for `bars` out of `every`, then low (a square LFO, unipolar).
function recordGate(p, at, every, pw, name = "Record") {
  return p.add("lfo", at, { wave: "Square", sync: every, polarity: "Unipolar", pw }, { name });
}

function phraseLooper() {
  const p = patch("Splice: Phrase Looper", {
    module: "splice", tempo: 96,
    description: "A plucked phrase is recorded into the reel for one bar, then the splice loops it back, locked to the bars by Sync, and you hear the live phrase pass through while it is recorded. Try Sync, Speed or Window Size to bend the loop.",
    tags: ["looper", "sync", "phrase", "tape"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, 5, 3, ".", 7, 10], { rate: "1/8", root: "D", scale: "Dorian",
    env: { decay: 0.35, sustain: 0.3, release: 0.2 }, gatelength: 0.6, shape: 0.5 });
  const rec = recordGate(p, [2, 1], "4 bars", 0.25);
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Input while recording", sync: "1 bar", loop: "Loop",
    window: 1, overlap: 0.4, speed: 1, level: 1 });
  p.cable(m.amp, "l", s, "l").cable(m.amp, "l", s, "r").cable(rec, "out", s, "record").stereo(s, p.out);
  return p;
}

function microTexture() {
  const p = patch("Splice: Micro Cloud", {
    module: "splice", tempo: 80,
    description: "A short recorded chord arpeggio is chopped into 3 % windows with high Overlap, turning it into a granular cloud that a slow LFO scrubs across the splice via Position. Raise Window Size to hear the phrase re-emerge.",
    tags: ["texture", "granular", "windows", "ambient"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 14, 11, 7, 4], { rate: "1/8", shape: 0.5, root: "C", scale: "Major",
    env: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 0.4 } });
  const rec = recordGate(p, [2, 1], "8 bars", 0.15);
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Off", window: 0.03, overlap: 0.9, speed: 1,
    level: 1.3 });
  const scrub = p.add("lfo", [3, 1], { rate: 0.08, wave: "Triangle", polarity: "Unipolar" }, { name: "Scrub" });
  p.cable(m.amp, "l", s, "l").cable(m.amp, "l", s, "r").cable(rec, "out", s, "record").stereo(s, p.out)
    .cable(scrub, "out", s, "position", 0.9);
  return p;
}

function melodicSampler() {
  const p = patch("Splice: Reel Keyboard", {
    module: "splice", tempo: 100,
    description: "One recorded note is replayed as an instrument: a sequencer's Pitch drives the Speed input (1 V per octave) and its trigger restarts the splice, with Loop on One-shot. Change the sequence, or Window Size, for different timbres.",
    tags: ["sampler", "melodic", "speed", "one-shot"],
  });
  const src = p.add("oscillator", [0, 0], { shape: 0.2 }, { name: "Note" });
  const env = p.add("adsr", [0, 1], { attack: 0.003, decay: 0.5, sustain: 0.4, release: 0.2 }, { name: "Note Env" });
  const amp = p.add("vca", [1, 0], {}, { name: "VCA" });
  const gate = p.add("lfo", [1, 1], { wave: "Square", sync: "8 bars", polarity: "Unipolar", pw: 0.15 }, { name: "Record" });
  const nseq = p.add("step-sequencer", [0, 2], { length: 1, rate: "1/1", root: "C", octave: -1 }, { data: { steps: [{ g: 1, p: 0, v: 100 }, ...Array(31).fill({ g: 0, p: 0, v: 100 })] } });
  p.cable(nseq, "pitch", src, "pitch").cable(nseq, "gate", env, "gate").cable(src, "out", amp, "l").cable(env, "env", amp, "gain");
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Off", window: 1, overlap: 0.4, loop: "One-shot",
    speed: 1, level: 1.5, fade: 0.004 });
  const seq = melody(p, [0, 3], [0, 3, 7, 12, 10, 7, 3, 5], { rate: "1/8", root: "C", scale: "Minor Pentatonic", octave: 0 }).seq;
  p.cable(amp, "l", s, "l").cable(amp, "l", s, "r").cable(gate, "out", s, "record")
    .cable(seq, "pitch", s, "speed").cable(seq, "trigger", s, "play").stereo(s, p.out);
  return p;
}

function choppedBreak() {
  const p = patch("Splice: Chopped Break", {
    module: "splice", tempo: 110,
    description: "A drum beat is recorded to the reel, then a stepped random source on Select and a clock on Next hop through its splices and a fast random Position, re-cutting the groove on the fly. Try Shift (Immediate against End of window) and Overlap.",
    tags: ["drums", "chop", "random", "select"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -6 });
  const rec = recordGate(p, [3, 1], "8 bars", 0.25);
  const s = p.add("splice", [4, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Always", sync: "2 bars", window: 0.25, overlap: 0.15,
    shift: "Immediate", level: 1.2 });
  const jump = p.add("random", [4, 1], { sync: "1/8", spread: 1, seed: 11 }, { name: "Position Jumps" });
  const mark = p.add("lfo", [5, 1], { wave: "Square", sync: "1/2", polarity: "Unipolar", pw: 0.1 }, { name: "Cut" });
  p.cable(mix, "outl", s, "l").cable(mix, "outr", s, "r").cable(rec, "out", s, "record").cable(jump, "out", s, "position", 0.5)
    .cable(mark, "out", s, "mark").stereo(s, p.out);
  return p;
}

function tapeDrift() {
  const p = patch("Splice: Reverse Tape Drift", {
    module: "splice", tempo: 70,
    description: "A slow melody is caught on the reel and played back at a speed that a slow LFO sweeps from forward through standstill to reverse, like a tape dragged by hand. Change the LFO's depth or fix Speed at -1 for plain reverse.",
    tags: ["tape", "reverse", "speed", "ambient"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 9, ".", 4, "."], { rate: "1/4", shape: 0.3, root: "G", scale: "Major Pentatonic",
    env: { attack: 0.02, decay: 0.7, sustain: 0.3, release: 0.5 } });
  const rec = recordGate(p, [2, 1], "8 bars", 0.5);
  const s = p.add("splice", [3, 0], { recmode: "Gate", rectarget: "Whole reel", monitor: "Always", window: 1, overlap: 0.45, speed: 0.1, level: 1.2 });
  const lfo = p.add("lfo", [3, 1], { rate: 0.07, wave: "Sine" }, { name: "Tape Hand" });
  p.cable(m.amp, "l", s, "l").cable(m.amp, "l", s, "r").cable(rec, "out", s, "record").stereo(s, p.out)
    .cable(lfo, "out", s, "speed", 0.25);
  return p;
}

export default [phraseLooper, microTexture, melodicSampler, choppedBreak, tapeDrift];
