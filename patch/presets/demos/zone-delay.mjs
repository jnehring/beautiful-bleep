// SPDX-License-Identifier: MIT
// Zone Delay: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// Mono source into both inputs of an effect, through a gain stage (dB, up to +12) so the demo sits at a sensible level.
const mono = (p, from, to, db = 0) => {
  const g = p.add("audio-mixer", [2, 2], { level1: Math.min(db, 6), master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.cable(from, "l", g, "in1l").cable(g, "outl", to, "l").cable(g, "outl", to, "r");
};

function tunedComb() {
  const p = patch("Zone Delay: Tuned Combs", {
    module: "zone-delay", tempo: 100,
    description: "Zone 1 turns the delay into a tuned comb: a drum loop is pushed through it while a sequencer plays its Pitch input, so the beat rings out a melody. Change Feedback for a longer ring, or Zone to leave the comb behind.",
    tags: ["comb", "pitched", "drums", "resonance"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -14 });
  const seq = p.add("step-sequencer", [0, 4], { length: 8, rate: "1/8", root: "A", scale: "Minor Pentatonic", octave: 1 },
    { data: steps([0, 0, 7, 7, 3, 3, 5, 10]), name: "Comb Pitch" });
  const z = p.add("zone-delay", [3, 0], { zone: 1, feedback: 0.8, character: 0.15, tone: 0.1, mix: 0.7, timechange: "Crossfade" });
  p.cable(mix, "outl", z, "l").cable(mix, "outl", z, "r").stereo(z, p.out).cable(seq, "pitch", z, "pitch");
  return p;
}

function tapeEcho() {
  const p = patch("Zone Delay: Tape Echo", {
    module: "zone-delay", tempo: 88,
    description: "Zone 3 in Tape mode with a little Wobble: a plucked line is followed by warm, drifting echoes that darken as they repeat. Raise Wobble and Character for a worn tape, or move Time while it plays to hear the pitch slide.",
    tags: ["tape", "echo", "wobble", "analog"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.8, root: "G", scale: "Minor Pentatonic",
    env: { decay: 0.3, sustain: 0.3, release: 0.2 }, gatelength: 0.5 });
  const z = p.add("zone-delay", [3, 0], { zone: 3, sync: "Transport", time: 0.5, feedback: 0.55, character: 0.45, tone: -0.25, wobble: 0.35, mix: 0.45, timechange: "Tape" });
  mono(p, m.amp, z, 10); p.stereo(z, p.out);
  return p;
}

function loopHold() {
  const p = patch("Zone Delay: Loop Catcher", {
    module: "zone-delay", tempo: 84,
    description: "In the longest zone a square LFO raises Hold every other bar group, so the delay stops listening and loops what it just heard while the live melody plays over it. Change the LFO's Sync, or fire Hold from a Button.",
    tags: ["hold", "looper", "long", "layers"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2], { rate: "1/8", shape: 0.6, root: "C", scale: "Major Pentatonic",
    env: { decay: 0.25, sustain: 0.2, release: 0.2 } });
  const z = p.add("zone-delay", [3, 0], { zone: 5, sync: "Transport", time: 0.35, feedback: 0.5, character: 0.1, mix: 0.6, timechange: "Crossfade" });
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "2 bars", polarity: "Unipolar", pw: 0.5 }, { name: "Hold Gate" });
  mono(p, m.amp, z, 1); p.stereo(z, p.out).cable(hold, "out", z, "hold");
  return p;
}

function reverseBounce() {
  const p = patch("Zone Delay: Reverse Bounce", {
    module: "zone-delay", tempo: 96,
    description: "Two square LFOs gate Reverse and Ping-Pong on their own cycles, so the echoes of an arpeggio flip backwards and hop between the speakers in changing combinations. Edit either LFO, or turn Diffuse up to blur the reversals.",
    tags: ["reverse", "ping-pong", "gates", "stereo"],
  });
  const m = melody(p, [0, 0], [0, 7, ".", 3, 10, ".", 5, "."], { rate: "1/8", shape: 0.7, root: "D", scale: "Dorian",
    env: { decay: 0.2, sustain: 0.2, release: 0.15 } });
  const z = p.add("zone-delay", [3, 0], { zone: 3, sync: "Transport", time: 0.4, feedback: 0.6, character: 0.2, diffuse: 0.2, mix: 0.55 });
  const rv = p.add("lfo", [2, 1], { wave: "Square", sync: "2 bars", polarity: "Unipolar" }, { name: "Reverse Gate" });
  const pp = p.add("lfo", [3, 1], { wave: "Square", sync: "1 bar", polarity: "Unipolar", phase: 90 }, { name: "Ping-Pong Gate" });
  mono(p, m.amp, z, 6); p.stereo(z, p.out).cable(rv, "out", z, "reverse").cable(pp, "out", z, "pingpong");
  return p;
}

function diffuseSmear() {
  const p = patch("Zone Delay: Smeared Pad", {
    module: "zone-delay", tempo: 70,
    description: "Zone 2 with Diffuse and Character turned up blurs a slow chord progression into a soft, slowly shifting wash. Lower Diffuse to bring back distinct echoes, or change Offset to push the left and right times apart.",
    tags: ["diffuse", "pad", "smear", "ambient"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", shape: 0.5, root: "F", scale: "Major Pentatonic",
    env: { attack: 0.1, decay: 0.5, sustain: 0.6, release: 0.6 }, gatelength: 0.9 });
  const z = p.add("zone-delay", [3, 0], { zone: 2, time: 0.55, feedback: 0.7, character: 0.55, tone: -0.1, diffuse: 0.85, offset: 0.2, wobble: 0.3, mix: 0.6, timechange: "Crossfade" });
  mono(p, m.amp, z, 0); p.stereo(z, p.out);
  return p;
}

export default [tunedComb, tapeEcho, loopHold, reverseBounce, diffuseSmear];
