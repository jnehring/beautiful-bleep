// SPDX-License-Identifier: MIT
// Delay: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// Mono source into both inputs of an effect, through a gain stage (dB) so the demo sits at a sensible level.
const mono = (p, from, to, db = 0) => {
  const g = p.add("audio-mixer", [2, 2], { level1: Math.min(db, 6), master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.cable(from, "l", g, "in1l").cable(g, "outl", to, "l").cable(g, "outl", to, "r");
};

function dottedEcho() {
  const p = patch("Delay: Dotted Echo", {
    module: "delay", tempo: 100,
    description: "A bright pluck line gets a left echo on a dotted eighth and a right echo on a quarter note, so the repeats weave a rhythm of their own. Change Rate L and Rate R, or raise Feedback for longer trails.",
    tags: ["tempo sync", "dotted", "plucks", "echo"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 3, ".", 5, "."], { rate: "1/8", shape: 0.85, root: "A", scale: "Minor Pentatonic",
    env: { decay: 0.3, sustain: 0.3, release: 0.2 }, gatelength: 0.5 });
  const d = p.add("delay", [3, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.5, lowcut: 150, highcut: 6000, mix: 0.45 });
  mono(p, m.amp, d, 6); p.stereo(d, p.out);
  return p;
}

function pingPong() {
  const p = patch("Delay: Ping-Pong Bounce", {
    module: "delay", tempo: 112,
    description: "Ping-Pong mode bounces each note from one side to the other in sixteenth steps while the arpeggio itself stays sparse. Switch Mode to Stereo to hear the same echoes stay put, or push Feedback up.",
    tags: ["ping-pong", "stereo", "arpeggio", "bounce"],
  });
  const m = melody(p, [0, 0], [0, ".", ".", 7, ".", ".", 12, ".", 7, ".", ".", 3, ".", ".", 5, "."], { rate: "1/16", shape: 0.5, root: "D",
    scale: "Dorian", env: { decay: 0.3, sustain: 0.3, release: 0.2 }, gatelength: 0.5 });
  const d = p.add("delay", [3, 0], { sync: "Tempo", mode: "Ping-Pong", ratel: "1/16.", rater: "1/16.", feedback: 0.62, highcut: 7000, mix: 0.55 });
  mono(p, m.amp, d, 12); p.stereo(d, p.out);
  return p;
}

function slapback() {
  const p = patch("Delay: Slapback Kit", {
    module: "delay", tempo: 96,
    description: "A very short free-time delay of about 80 ms with almost no Feedback thickens the drums into a live-room slap. Try Time L and Time R a few milliseconds apart for width, or lengthen both until it becomes an echo.",
    tags: ["slapback", "drums", "short", "free time"],
  });
  const mix = beat(p, [0, 0], { style: "shuffle", level: -5 });
  const d = p.add("delay", [3, 0], { sync: "Free", timel: 78, timer: 96, feedback: 0.12, lowcut: 200, highcut: 5000, mix: 0.3 });
  p.cable(mix, "outl", d, "l").cable(mix, "outl", d, "r"); p.stereo(d, p.out);
  return p;
}

function dubSpiral() {
  const p = patch("Delay: Dub Spiral", {
    module: "delay", tempo: 78,
    description: "High Feedback keeps the echoes spiralling while High Cut slowly closes and opens under an LFO, so each repeat gets darker and then brighter. Edit the LFO rate, or raise Low Cut to thin out the build-up.",
    tags: ["dub", "feedback", "filter", "tape"],
  });
  const m = melody(p, [0, 0], [0, "_", 3, "_", 7, "_", 3, "."], { rate: "1/8", shape: 0.7, root: "G",
    scale: "Natural Minor", env: { decay: 0.5, sustain: 0.7, release: 0.3 }, gatelength: 0.8 });
  const d = p.add("delay", [3, 0], { sync: "Tempo", ratel: "1/4.", rater: "1/4", feedback: 0.78, lowcut: 120, highcut: 5000, mix: 0.6 });
  const l = p.add("lfo", [2, 1], { rate: 0.12 }, { name: "Cut LFO" });
  mono(p, m.amp, d, -4); p.stereo(d, p.out); p.cable(l, "out", d, "highcut", 0.3);
  return p;
}

function wideDouble() {
  const p = patch("Delay: Wide Double", {
    module: "delay", tempo: 84,
    description: "Two unrelated short times, 23 ms on the left and 37 ms on the right, fatten a slow pad into a wide stereo cloud with no audible echo. Move the Time knobs a little, or turn on Link L/R and watch the image collapse.",
    tags: ["stereo widening", "pad", "chorus-like", "short"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", shape: 1, root: "F", scale: "Major Pentatonic",
    env: { attack: 0.15, decay: 0.5, sustain: 0.8, release: 0.8 }, gatelength: 0.95 });
  const d = p.add("delay", [3, 0], { sync: "Free", timel: 23, timer: 37, feedback: 0.15, highcut: 9000, mix: 0.5 });
  mono(p, m.amp, d, -12); p.stereo(d, p.out);
  return p;
}

export default [dottedEcho, pingPong, slapback, dubSpiral, wideDouble];
