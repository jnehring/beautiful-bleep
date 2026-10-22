// SPDX-License-Identifier: MIT
// Verb: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// Mono source into both inputs of an effect, through a gain stage (dB, up to +12) so the demo sits at a sensible level.
const mono = (p, from, to, db = 0) => {
  const g = p.add("audio-mixer", [2, 2], { level1: Math.min(db, 6), master: db > 6 ? db - 6 : 0 }, { name: "Level" });
  p.cable(from, "l", g, "in1l").cable(g, "outl", to, "l").cable(g, "outl", to, "r");
};

function endlessHall() {
  const p = patch("Verb: Endless Hall", {
    module: "reverb", tempo: 64,
    description: "Sparse, soft notes sink into a huge hall: Size is almost full, Decay is over twenty seconds and Pre-delay leaves each note clean before the bloom. Try Decay and Size together, or push Mix to 100 %.",
    tags: ["hall", "ambient", "long decay", "pad"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 9, "."], { rate: "1/4", shape: 0.35, root: "D", scale: "Major Pentatonic",
    env: { attack: 0.03, decay: 0.8, sustain: 0.3, release: 0.6 } });
  const v = p.add("reverb", [3, 0], { size: 0.95, decay: 22, preDelay: 0.08, diffusion: 0.85, damping: 0.55, bass: 1.1, modDepth: 0.3, mix: 0.7 });
  mono(p, m.amp, v, 6); p.stereo(v, p.out);
  return p;
}

function boothDrums() {
  const p = patch("Verb: Drum Booth", {
    module: "reverb", tempo: 104,
    description: "A drum beat in a tiny, dry room: low Size, a short Decay and high Damping glue the kit together. Raise Size and Decay to move the same beat into a hall, or widen it with Width.",
    tags: ["room", "drums", "short", "glue"],
  });
  const mix = beat(p, [0, 0], { style: "broken", level: -4 });
  const v = p.add("reverb", [3, 0], { size: 0.18, decay: 0.45, preDelay: 0.01, diffusion: 0.6, damping: 0.65, bass: 0.9, modDepth: 0.1, mix: 0.3, width: 1.2 });
  p.cable(mix, "outl", v, "l").cable(mix, "outl", v, "r").stereo(v, p.out);
  return p;
}

function freezeChord() {
  const p = patch("Verb: Frozen Chord", {
    module: "reverb", tempo: 80,
    description: "A square LFO closes the Freeze gate for a couple of bars at a time, holding whatever is in the tank as an endless chord, then lets go so the next phrase can be caught. Edit the LFO's Sync, or latch Freeze yourself.",
    tags: ["freeze", "infinite", "pad", "drone"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 11, 9, 7, 4, 2], { rate: "1/8", shape: 0.5, root: "E", scale: "Dorian",
    env: { attack: 0.01, decay: 0.4, sustain: 0.15, release: 0.3 } });
  const v = p.add("reverb", [3, 0], { size: 0.8, decay: 40, preDelay: 0.03, diffusion: 0.9, damping: 0.4, modDepth: 0.4, mix: 0.9, width: 1.3 });
  const hold = p.add("lfo", [2, 1], { wave: "Square", sync: "Tempo", division: "4 bars", pw: 0.5, polarity: "Unipolar", phase: 180 }, { name: "Hold" });
  mono(p, m.amp, v, 3); p.stereo(v, p.out).cable(hold, "out", v, "freeze");
  return p;
}

function tidePool() {
  const p = patch("Verb: Tide Pool", {
    module: "reverb", tempo: 72,
    description: "Slow LFOs ride Size and Tone while Mod Depth swirls the tail, so the room seems to inhale and exhale around a gentle arpeggio. Every Verb knob modulates click-free: patch your own LFO into Decay.",
    tags: ["modulation", "evolving", "size", "movement"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 4, 7, 9, 7], { rate: "1/8", shape: 0.6, root: "A", scale: "Minor Pentatonic",
    env: { decay: 0.3, sustain: 0.1, release: 0.4 } });
  const v = p.add("reverb", [3, 0], { size: 0.5, decay: 8, preDelay: 0.03, diffusion: 0.8, damping: 0.35, modRate: 1.2, modDepth: 0.7, mix: 0.6 });
  const l1 = p.add("lfo", [2, 1], { rate: 0.08 }, { name: "Size LFO" });
  const l2 = p.add("lfo", [3, 1], { rate: 0.11, wave: "Triangle", phase: 90 }, { name: "Tone LFO" });
  mono(p, m.amp, v, 6); p.stereo(v, p.out);
  p.cable(l1, "out", v, "size", 0.35).cable(l2, "out", v, "tone", 0.5);
  return p;
}

function darkCellar() {
  const p = patch("Verb: Dark Cellar", {
    module: "reverb", tempo: 90,
    description: "A low plucked bass line in a cellar: Bass is boosted, Tone and Damping pull the tail dark, and Eco quality keeps it light. Lower Bass or lift Tone to hear the same room turn into a bright stairwell.",
    tags: ["dark", "bass", "damping", "tone"],
  });
  const m = melody(p, [0, 0], [0, ".", 0, 3, ".", 7, ".", 5], { rate: "1/8", shape: 0.9, root: "A", octave: -1, scale: "Natural Minor",
    env: { decay: 0.25, sustain: 0.1, release: 0.2 } });
  const v = p.add("reverb", [3, 0], { size: 0.4, decay: 3.5, preDelay: 0.015, diffusion: 0.6, damping: 0.8, bass: 1.8, tone: -0.6, modDepth: 0.15, mix: 0.45, quality: "Eco (8 lines)" });
  mono(p, m.amp, v, 2); p.stereo(v, p.out);
  return p;
}

export default [endlessHall, boothDrums, freezeChord, tidePool, darkCellar];
