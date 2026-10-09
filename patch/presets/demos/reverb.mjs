// SPDX-License-Identifier: MIT
// Verb: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

function cathedral() {
  const p = patch("Verb: Cathedral", {
    module: "reverb", tempo: 66,
    description: "A slow, soft melody disappears into a huge room: Size and Decay are high, Damping rolls the tail dark, and Pre-delay keeps each note clear before the bloom. Try Decay and Size together, or push Mix to 100 %.",
    tags: ["cathedral", "ambient", "long decay", "pad"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, "."], { rate: "1/4", shape: 0.35, root: "D", scale: "Major Pentatonic",
    env: { attack: 0.03, decay: 0.8, sustain: 0.3, release: 0.6 } });
  const v = p.add("reverb", [3, 0], { size: 0.92, decay: 14, preDelay: 0.08, diffusion: 0.85, damping: 0.55, bass: 1.1, modDepth: 0.3, mix: 0.7 });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r").stereo(v, p.out);
  return p;
}

function tightRoom() {
  const p = patch("Verb: Tight Room", {
    module: "reverb", tempo: 104,
    description: "A drum beat in a small, dry room: low Size, a short Decay and high Damping glue the kit together like a booth. Raise Size and Decay to move the same beat into a hall.",
    tags: ["room", "drums", "short", "glue"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -4 });
  const v = p.add("reverb", [3, 0], { size: 0.18, decay: 0.45, preDelay: 0.01, diffusion: 0.6, damping: 0.65, bass: 0.9, modDepth: 0.1, mix: 0.3, width: 1.2 });
  p.cable(mix, "outl", v, "l").cable(mix, "outl", v, "r").stereo(v, p.out);
  return p;
}

function freezePad() {
  const p = patch("Verb: Freeze Pad", {
    module: "reverb", tempo: 80,
    description: "A square LFO opens the Freeze gate for a couple of bars at a time, holding whatever is in the tank as an endless chord, then lets it go so the next phrase can be caught. Edit the LFO's Sync, or latch Freeze yourself.",
    tags: ["freeze", "infinite", "pad", "drone"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 9, 7, 4, 2], { rate: "1/8", shape: 0.5, root: "E", scale: "Dorian",
    env: { attack: 0.01, decay: 0.4, sustain: 0.15, release: 0.3 } });
  const v = p.add("reverb", [3, 0], { size: 0.8, decay: 40, preDelay: 0.03, diffusion: 0.9, damping: 0.4, modDepth: 0.4, mix: 0.9, width: 1.3 });
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "4 bars", pw: 0.5, polarity: "Unipolar", phase: 180 }, { name: "Hold" });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r").stereo(v, p.out).cable(hold, "out", v, "freeze");
  return p;
}

function breathingSpace() {
  const p = patch("Verb: Breathing Space", {
    module: "reverb", tempo: 72,
    description: "Slow LFOs ride Size and Decay while Mod Depth swirls the tail, so the room itself seems to inhale and exhale around a gentle arpeggio. Every Verb knob modulates click-free: try patching your own LFO into Tone.",
    tags: ["modulation", "evolving", "size", "ambient"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 4, 7, 9, 7], { rate: "1/8", shape: 0.6, root: "A", scale: "Minor Pentatonic",
    env: { decay: 0.3, sustain: 0.1, release: 0.4 } });
  const v = p.add("reverb", [3, 0], { size: 0.5, decay: 8, preDelay: 0.03, diffusion: 0.8, damping: 0.35, modRate: 1.2, modDepth: 0.7, mix: 0.6 });
  const l1 = p.add("lfo", [2, 1], { rate: 0.08 }, { name: "Size LFO" });
  const l2 = p.add("lfo", [3, 1], { rate: 0.05, wave: "Triangle", phase: 90 }, { name: "Decay LFO" });
  const l3 = p.add("lfo", [4, 1], { rate: 0.11 }, { name: "Tone LFO" });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r").stereo(v, p.out)
    .cable(l1, "out", v, "size", 0.35).cable(l2, "out", v, "decay", 0.2).cable(l3, "out", v, "tone", 0.4);
  return p;
}

function predelayEchoes() {
  const p = patch("Verb: Pre-delay Echoes", {
    module: "reverb", tempo: 100,
    description: "Pre-delay is locked to a dotted eighth, so a bright plucked tune is followed by one clear rhythmic echo and then a short, diffuse bloom. Change Pre-delay Sync, or lower Diffusion to hear the individual reflections.",
    tags: ["pre-delay", "sync", "plucks", "echo"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, 5, ".", 3, 7, "."], { rate: "1/16", shape: 0.9, root: "C", scale: "Natural Minor",
    env: { decay: 0.12, sustain: 0, release: 0.1 }, gatelength: 0.3 });
  const v = p.add("reverb", [3, 0], { size: 0.45, decay: 2.2, preSync: "1/8.", diffusion: 0.5, damping: 0.5, modDepth: 0.2, mix: 0.5, tone: 0.2 });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r").stereo(v, p.out);
  return p;
}

export default [cathedral, tightRoom, freezePad, breathingSpace, predelayEchoes];
