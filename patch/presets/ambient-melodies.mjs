// SPDX-License-Identifier: MIT
// Ambient Melodies: slow generative notes. Random gates and voltages from modules that run on their own clock are held to a
// scale, so whatever happens sounds right. They sound on their own as soon as they are placed and need no transport. Out L/R out.
import { cell, category } from "./kit.mjs";
import { bed, sendReturn, hall } from "./ambient-kit.mjs";

// A sine voice through a slow low pass gate, pinged at random, in D major pentatonic.
function slowPentatonicDrift() {
  const p = cell("Slow Pentatonic Drift", {
    description: "Soft sine notes from D major pentatonic arrive at random, a few seconds apart, each opening a slow low pass gate and trailing off into a dark echo: a melody that never repeats itself. Shared input Chance (more notes).",
    tags: ["ambient", "generative", "pentatonic", "sine", "sparse"],
    help: "A Recall module running free makes random gates and random voltages every few seconds. A Quantizer holds the voltage to D major pentatonic " +
      "and sets the pitch of a sine Oscillator. Each gate pings a Low Pass Gate in its slow-memory mode and starts an ADSR that opens it, which swells the note " +
      "and lets it dim away. A Delay Network and a hall behind it make the notes ring on.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Chance input is added to the gate bias of Recall: " +
      "higher means notes more often.\n\n" +
      "Tip: change Recall's Rate to set the pace of the whole piece; its Seed gives you a different melody.",
  }).input("chance", "Chance").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.45, trecall: 0.15, tloop: 8, gatelength: 0.2, xspread: 0.7, rate: 0.35, sync: "Free", seed: 61 });
  const q = p.add("quantizer", [1, 1], { root: "D", scale: "Major Pentatonic", range: 1, hysteresis: 0.05 });
  const o = p.add("oscillator", [2, 0], { octave: "0", shape: 0.05 }, { name: "Sine" });
  const lpg = p.add("low-pass-gate", [3, 0], { level: 0, response: 0.7, ping: 1, resonance: 0.1, brightness: 0.8, mode: "Both", cell: "Slow memory" });
  const env = p.add("adsr", [2, 1], { attack: 0.6, decay: 3, sustain: 0, release: 2 }, { name: "Swell" });
  p.cable(p.cin, "chance", rc, "tbias", 0.3).cable(rc, "x1", q, "in").cable(q, "out", o, "pitch").cable(rc, "t1", lpg, "ping").cable(rc, "t1", env, "gate").cable(env, "env", lpg, "cv")
    .cable(o, "out", lpg, "l").cable(o, "out", lpg, "r");
  const mix = bed(p, [4, 0], [{ node: lpg, level: -6, send: -6 }], { return: -3, master: -1 });
  const dly = p.add("delay-network", [5, 1], { time: 0.9, taps: 4, feedback: 0.6, scatter: 0.35, jitter: 0.1, tone: -0.45, character: 0.3, width: 1, mix: 1, routing: "Ring" });
  sendReturn(p, mix, dly);
  hall(p, mix, [6, 0], { size: 0.9, decay: 11, mix: 0.4 });
  return p;
}

// Two struck bell bodies, each with its own random gates, in D Lydian.
function bellGarden() {
  const p = cell("Bell Garden", {
    description: "Two big bells in D Lydian struck at random by their own gates, a low one rarely and a high one a little more often, so they ring over each other for many seconds in a hall. Shared input Wind (more strikes).",
    tags: ["ambient", "generative", "bells", "lydian", "ringing"],
    help: "A Recall module running free makes two streams of random gates and random voltages. Each gate strikes a Modal Voice in a bell geometry with " +
      "long ringing, one an octave below the other; each voltage goes through a Quantizer (D Lydian) to its pitch. The strikes land " +
      "at random times, so the two bells ring into each other. A huge hall carries them.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Wind input is added to the gate bias of Recall: " +
      "higher means more strikes.\n\n" +
      "Tip: Damping on the voices sets how long they ring: lower is longer.",
  }).input("wind", "Wind").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.25, trecall: 0.2, tloop: 8, gatelength: 0.1, xspread: 0.8, rate: 0.3, sync: "Free", seed: 72 });
  p.cable(p.cin, "wind", rc, "tbias", 0.3);
  const mix = p.add("audio-mixer", [3, 1], { level1: -6, pan1: -0.4, level2: -8, pan2: 0.4, master: -2 });
  [["Low Bell", -12, 0.55, "t1", "x1", 0.1], ["High Bell", 0, 0.4, "t2", "x2", 0.1]].forEach(([name, coarse, size, gate, volts, damping], i) => {
    const q = p.add("quantizer", [1, i * 2], { root: "D", scale: "Lydian", range: 1, hysteresis: 0.05 }, { name: `${name} Notes` });
    const mv = p.add("modal-voice", [2, i * 2], { strike: 1, strikeTimbre: 0.55, geometry: 0.68, brightness: 0.6, damping, size, coarse, position: 0.3, space: 0.4, partials: "32", seed: 70 + i }, { name });
    p.cable(rc, volts, q, "in").cable(q, "out", mv, "pitch").cable(rc, gate, mv, "strike").stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  hall(p, mix, [4, 1], { size: 0.95, decay: 14, damping: 0.45, mix: 0.5 });
  return p;
}

// Three formant voices that glide to new notes of A minor every few seconds.
function eveningChoir() {
  const p = cell("Evening Choir", {
    description: "Three voices on slow glides that each pick a new note of A natural minor every eight seconds or so, singing a vowel that wanders: a choir at the end of the day that never quite resolves. Shared input Vowel.",
    tags: ["ambient", "generative", "choir", "formant", "glide", "minor"],
    help: "A Recall module running free makes three random voltages, one for each voice, a new set every few seconds. Three Quantizers (A natural minor) " +
      "round them to notes with a long glide, and three Formant Osc voices sing them, an octave apart. Organic LFOs move each voice's formant " +
      "so the vowel wanders. Chorus and a hall finish the choir.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Vowel input is added to the formant of all three voices.\n\n" +
      "Tip: Glide on each Quantizer decides how long a change takes; at zero the voices jump.",
  }).input("vowel", "Vowel").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.5, xspread: 0.6, xsteps: 0.5, rate: 0.12, sync: "Free", seed: 83 });
  const life = p.add("organic-lfos", [0, 3], { rate: 0.04, spread: 0.6, drift: 0.5, seed: 12 });
  const mix = p.add("audio-mixer", [3, 1], { level1: -9, pan1: -0.5, level2: -8, pan2: 0.4, level3: -10, pan3: 0, master: -2 });
  [[-2, 0, "x1", 1.2], [-1, 0, "x2", 2.2], [-2, 7, "x3", 0.8]].forEach(([octave, coarse, volts, formant], i) => {
    const q = p.add("quantizer", [1, i], { root: "A", scale: "Natural Minor", range: 0.6, hysteresis: 0.1, glide: 0.9 }, { name: `Voice ${i + 1} Notes` });
    const fo = p.add("formant-osc", [2, i], { octave, coarse, formant, narrow: 0.35, body: 0.7, spread: 0.3 }, { name: `Voice ${i + 1}` });
    p.cable(rc, volts, q, "in").cable(q, "out", fo, "pitch").cable(life, `out${i + 1}`, fo, "formant", 0.2).cable(p.cin, "vowel", fo, "formant", 0.25)
      .stereo(fo, mix, { from: ["outL", "outR"], to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const ch = p.add("chorus", [4, 1], { rate: 0.25, depth: 0.4, delay: 13, mix: 0.4 });
  p.stereo(mix, ch, { from: ["outl", "outr"] });
  hall(p, ch, [5, 1], { size: 0.85, decay: 9, mix: 0.45 }, ["l", "r"]);
  return p;
}

// A plucked-string model struck now and then, pitches in E minor pentatonic, into a long echo.
function moonlitPlucks() {
  const p = cell("Moonlit Plucks", {
    description: "Single plucked notes in E minor pentatonic, falling one by one into a long echo and a deep hall: a lone instrument in an empty hall at night. Shared input Touch (more plucks).",
    tags: ["ambient", "generative", "pluck", "echo", "sparse", "night"],
    help: "A Recall module running free makes random gates and random voltages. A gate plucks a Macro Osc in its Pluck model; the voltage " +
      "goes through a Quantizer (E minor pentatonic) to the pitch, A Delay Network with a lot of feedback and " +
      "a dark tone repeats each note, and a hall holds the echoes.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Touch input is added to the gate bias of Recall: " +
      "more is more plucks.\n\n" +
      "Tip: Decay on the Macro Osc sets how long a string rings; Tone and Shape change the instrument.",
  }).input("touch", "Touch").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.4, trecall: 0.2, gatelength: 0.1, xspread: 0.8, rate: 0.4, sync: "Free", seed: 94 });
  const q = p.add("quantizer", [1, 1], { root: "E", scale: "Minor Pentatonic", range: 1, hysteresis: 0.05 });
  const pl = p.add("macro-osc", [2, 1], { model: "Pluck", octave: 0, tone: 0.5, shape: 0.55, blend: 0.4, decay: 2.5, level: 0.8 });
  p.cable(p.cin, "touch", rc, "tbias", 0.3).cable(rc, "x1", q, "in").cable(q, "out", pl, "pitch").cable(rc, "t1", pl, "trig");
  const mix = bed(p, [3, 1], [{ node: pl, mono: "out", level: -4, send: -4 }], { return: -4, master: -2 });
  const dly = p.add("delay-network", [4, 2], { time: 1.2, taps: 3, feedback: 0.62, scatter: 0.3, jitter: 0.1, tone: -0.4, character: 0.25, width: 1, mix: 1, routing: "Ring" });
  sendReturn(p, mix, dly);
  hall(p, mix, [5, 1], { size: 0.9, decay: 10, mix: 0.4 });
  return p;
}

// A Chord Osc that is moved from chord to chord by a slow random walk, with a long glide.
function cloudChords() {
  const p = cell("Cloud Chords", {
    description: "A single chord oscillator carried from chord to chord of D Dorian by a slow random walk with long glides, so seventh chords melt into one another every ten seconds or so. Shared input Colour (brightness).",
    tags: ["ambient", "generative", "chords", "dorian", "pad", "evolving"],
    help: "A Random module makes a new voltage every ten seconds or so; a Quantizer (D Dorian, with a long glide) turns it into the pitch that drives a " +
      "Chord Osc in Scale mode, so every chord is built from the notes of the scale: a different seventh chord each time, with the notes sliding " +
      "into place. A low-pass Multi Filter opens and closes with an Organic LFO, then a chorus and a large hall.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Colour input is added to the filter cutoff.\n\n" +
      "Tip: Chord on the Chord Osc chooses the kind of chords; Sus2 or Sus4 give a more open sound.",
  }).input("colour", "Colour").stereoOut();
  const walk = p.add("random", [0, 1], { rate: 0.09, sync: "Free", spread: 0.8, length: "8 steps", loop: 0, seed: 105 }, { name: "Walk" });
  const lfo = p.add("organic-lfos", [0, 3], { rate: 0.03, spread: 0.6, drift: 0.5, seed: 6 });
  const q = p.add("quantizer", [1, 1], { root: "D", scale: "Dorian", range: 0.8, hysteresis: 0.1, glide: 1.2 });
  const ch = p.add("chord-osc", [2, 1], { mode: "Scale", key: "D", scale: "Dorian", chord: "Major 7", stack: "Seventh", octave: "-1", voices: 4, detune: 10, stereo: 0.8, shape: 0.45, glide: 0.6 }, { name: "Chord" });
  const flt = p.add("filter", [3, 1], { cutoff: 1100, resonance: 0.15, type: "Ladder Tanh" }, { name: "Soft Top" });
  p.cable(walk, "out", q, "in").cable(q, "out", ch, "pitch").cable(lfo, "out1", flt, "cutoff", 0.2).cable(p.cin, "colour", flt, "cutoff", 0.3).stereo(ch, flt);
  const mix = bed(p, [4, 1], [{ node: flt, level: -6 }], { master: -2 });
  const chorus = p.add("chorus", [5, 1], { rate: 0.2, depth: 0.4, delay: 14, mix: 0.4 });
  p.stereo(mix, chorus, { from: ["outl", "outr"] });
  hall(p, chorus, [6, 1], { size: 0.9, decay: 11, mix: 0.45 }, ["l", "r"]);
  return p;
}

// Two neurons that excite each other make irregular spikes, which strike two soft bars in G major pentatonic.
function neuronLullaby() {
  const p = cell("Neuron Lullaby", {
    description: "Two leaky neurons that excite and inhibit each other fire in an irregular rhythm that is never the same, striking two soft wooden bars in G major pentatonic, like a lullaby played by a sleepy machine. Shared input Excite.",
    tags: ["ambient", "generative", "neuron", "irregular", "lullaby", "bars"],
    help: "A Neuron module with a steady bias fires two neurons whose spikes feed each other, so the rhythm is irregular but has a character. " +
      "Each spike strikes a Modal Voice tuned like a soft wooden bar; the pitches come from a Wobble module's stepped random stream, held by a Quantizer " +
      "to G major pentatonic. A Zone Delay on tape gives each note a soft echo and a hall sits behind.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Excite input is added to the bias of the first neuron: " +
      "higher fires faster.\n\n" +
      "Tip: Leak on each neuron sets how fast it forgets; change it to change the rhythm's feel.",
  }).input("excite", "Excite").stereoOut();
  const bias = p.add("utility", [0, 0], { scalex: 0, offset: 0.9 }, { name: "Bias" });
  const nn = p.add("neuron", [1, 0], { aw1: 1.0, aw2: 0.6, aw3: 0.4, athreshold: 0.5, aleak: 0.5, bw1: 0.5, bw2: 0.9, bw3: -0.4, bthreshold: 0.5, bleak: 0.4, cross: "Out" });
  const wob = p.add("wobble", [0, 2], { rate: 0.4, smooth: 0.2, chaos: 0.3, seed: 18 });
  const q = p.add("quantizer", [1, 2], { root: "G", scale: "Major Pentatonic", range: 1, hysteresis: 0.05 });
  p.cable(bias, "out", nn, "a1").cable(bias, "out", nn, "b1", 0.7).cable(p.cin, "excite", nn, "a1", 0.5).cable(wob, "stepped", q, "in");
  const mix = p.add("audio-mixer", [3, 0], { level1: -6, pan1: -0.3, send1: -10, level2: -8, pan2: 0.3, send2: -10, return: -5, master: -2 });
  [["Bar 1", "aspike", 0], ["Bar 2", "bspike", -12]].forEach(([name, spike, coarse], i) => {
    const mv = p.add("modal-voice", [2, i], { strike: 1, strikeTimbre: 0.5, geometry: 0.3, brightness: 0.55, damping: 0.4, size: 0.2, coarse, position: 0.25, space: 0.3, partials: "16", seed: 100 + i }, { name });
    p.cable(nn, spike, mv, "strike").cable(q, "out", mv, "pitch").stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  const tape = p.add("zone-delay", [4, 1], { zone: 3, time: 0.45, feedback: 0.5, character: 0.5, tone: -0.35, wobble: 0.5, mix: 1 });
  sendReturn(p, mix, tape);
  hall(p, mix, [5, 0], { size: 0.8, decay: 8, mix: 0.4 });
  return p;
}

// A struck bar with a rate that swells and relaxes: a kalimba in a tidal pool.
function kalimbaTides() {
  const p = cell("Kalimba Tides", {
    description: "Soft kalimba-like notes in A major pentatonic whose density rises and falls in a slow tide: sometimes one note every few seconds, sometimes a shimmering handful, always in a tape echo. Shared input Tide.",
    tags: ["ambient", "generative", "kalimba", "pentatonic", "tide", "tape"],
    help: "A Recall module running free makes random gates and voltages at a quick pace; an Organic LFO moves the gate bias in a slow tide, " +
      "so the notes come in clusters and then die away. The voltages go through a Quantizer (A major pentatonic) to the pitch of a Modal Voice " +
      "tuned like a small tine, and a tape echo and a hall hold the notes.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Tide input is added to the gate bias: lifts the whole level of activity.\n\n" +
      "Tip: Rate on Recall sets the fastest note rate a cluster can reach.",
  }).input("tide", "Tide").stereoOut();
  const tide = p.add("organic-lfos", [0, 3], { rate: 0.025, spread: 0.5, drift: 0.4, seed: 14 });
  const rc = p.add("recall", [0, 1], { tmode: "Coin", tbias: 0.3, trecall: 0.1, gatelength: 0.2, xspread: 0.8, rate: 1.6, sync: "Free", seed: 117 });
  const q = p.add("quantizer", [1, 1], { root: "A", scale: "Major Pentatonic", range: 1, hysteresis: 0.05 });
  const mv = p.add("modal-voice", [2, 1], { strike: 1, strikeTimbre: 0.6, geometry: 0.2, brightness: 0.7, damping: 0.5, size: 0.1, position: 0.2, space: 0.25, partials: "16", seed: 111 }, { name: "Tine" });
  p.cable(tide, "out1", rc, "tbias", 0.35).cable(p.cin, "tide", rc, "tbias", 0.3).cable(rc, "x1", q, "in").cable(q, "out", mv, "pitch").cable(rc, "t1", mv, "strike");
  const mix = bed(p, [3, 1], [{ node: mv, level: -5, send: -8 }], { return: -4, master: -2 });
  const tape = p.add("zone-delay", [4, 2], { zone: 3, time: 0.5, feedback: 0.55, character: 0.5, tone: -0.35, wobble: 0.5, mix: 1 });
  sendReturn(p, mix, tape);
  hall(p, mix, [5, 1], { size: 0.8, decay: 8, mix: 0.4 });
  return p;
}

// Two bowed string bodies, each swelling in on its own long loop, choosing new notes of E harmonic minor.
function weepingStrings() {
  const p = cell("Weeping Strings", {
    description: "Two bowed string bodies that swell in and out on loops of 21 and 29 seconds, each picking a new note of E harmonic minor as it starts: a slow, plaintive duet that is never twice the same. Shared input Bow (pressure).",
    tags: ["ambient", "generative", "bowed", "strings", "harmonic minor", "slow"],
    help: "Two Modal Voices in a string geometry are bowed while their gate is high. Each gate is a free LFO square at a loop length of 21 or 29 seconds, so " +
      "the two swell in and out in changing combinations. A Wobble module's stepped stream, held by a Quantizer in E harmonic minor, supplies each " +
      "voice with a note, sampled when the bow starts. A hall holds the tone.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Bow input is added to the pressure of both voices.\n\n" +
      "Tip: Contour sets how slowly the bow swells in; raise it for a gentler start.",
  }).input("bow", "Bow").stereoOut();
  const wob = p.add("wobble", [0, 1], { rate: 0.1, smooth: 0.1, chaos: 0.3, seed: 120 });
  const qs = p.add("quantizer-suite", [1, 1], {
    "a.mode": "Quantize", "a.root": "E", "a.scale": "Harmonic Minor", "a.sample": "Trigger", "a.octave": -1,
    "b.mode": "Quantize", "b.root": "E", "b.scale": "Harmonic Minor", "b.sample": "Trigger", "b.octave": 0,
    "c.notes": false, "d.notes": false,
  });
  const mix = p.add("audio-mixer", [3, 1], { level1: -11, pan1: -0.4, level2: -12, pan2: 0.4, master: -3 });
  p.cable(wob, "stepped", qs, "ina").cable(wob, "wobble", qs, "inb");
  [[21, "a", 0.7, 0], [29, "b", 0.7, 120]].forEach(([secs, ch, pw, phase], i) => {
    const loop = p.add("lfo", [0, i * 2 + 2], { rate: 1 / secs, phase, pw, wave: "Square", polarity: "Unipolar" }, { name: `Loop ${i + 1}` });
    const mv = p.add("modal-voice", [2, i], { bow: 0.6, bowTimbre: 0.65, strike: 0, geometry: 0.1, brightness: 0.55, damping: 0.25, position: 0.3, size: 0.35, space: 0.3, contour: 0.6, partials: "32", seed: 120 + i }, { name: `String ${i + 1}` });
    p.cable(loop, "out", qs, `trig${ch}`).cable(qs, `out${ch}`, mv, "pitch").cable(loop, "out", mv, "gate").cable(p.cin, "bow", mv, "bow", 0.3)
      .stereo(mv, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
  });
  hall(p, mix, [4, 1], { size: 0.9, decay: 10, mix: 0.45 });
  return p;
}

// A Swarm that reshuffles itself on a slow cycle, over notes picked by a random walk.
function dawnChorale() {
  const p = cell("Dawn Chorale", {
    description: "A Swarm of fifths on a slow random walk through C major pentatonic that reshuffles its voices every minute or so, so the choir keeps finding a new arrangement of the same few notes. Shared input Light (brightness).",
    tags: ["ambient", "generative", "swarm", "fifths", "choir", "morning"],
    help: "A Random module walks very slowly through voltages that a Quantizer rounds to C major pentatonic, with a long glide, as the pitch of a Swarm in " +
      "Fifths mode with ten oscillators. An LFO's cycle pulse, once a minute or so, reshuffles which oscillator plays which note. A low-pass Multi Filter opens with an " +
      "Organic LFO, then chorus and a hall.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Light input is added to the filter cutoff.\n\n" +
      "Tip: Pattern on the Swarm changes how the notes are laid across the stereo field.",
  }).input("light", "Light").stereoOut();
  const walk = p.add("random", [0, 1], { rate: 0.06, sync: "Free", spread: 0.7, length: "12 steps", loop: 0, seed: 130 }, { name: "Walk" });
  const turn = p.add("lfo", [0, 2], { rate: 0.017, wave: "Sine", polarity: "Unipolar" }, { name: "Reshuffle" });
  const lfo = p.add("organic-lfos", [0, 3], { rate: 0.03, spread: 0.6, drift: 0.5, seed: 9 });
  const q = p.add("quantizer", [1, 1], { root: "C", scale: "Major Pentatonic", range: 0.8, hysteresis: 0.1, glide: 1.4 });
  const sw = p.add("swarm", [2, 1], { octave: -1, count: 10, chord: "Fifths", spread: 0.6, detune: 12, drift: 0.4, width: 0.9, glide: 0.8 });
  const flt = p.add("filter", [3, 1], { cutoff: 1600, resonance: 0.1, type: "SVF Multimode" }, { name: "Soft Top" });
  p.cable(walk, "out", q, "in").cable(q, "out", sw, "pitch").cable(turn, "cycle", sw, "reshuffle").cable(lfo, "out1", flt, "cutoff", 0.2)
    .cable(p.cin, "light", flt, "cutoff", 0.3).stereo(sw, flt);
  const mix = bed(p, [4, 1], [{ node: flt, level: -7 }], { master: -2 });
  const ch = p.add("chorus", [5, 1], { rate: 0.2, depth: 0.4, delay: 14, mix: 0.35 });
  p.stereo(mix, ch, { from: ["outl", "outr"] });
  hall(p, ch, [6, 1], { size: 0.9, decay: 10, mix: 0.45 }, ["l", "r"]);
  return p;
}

// Additive stretched-partial tones struck at random, in D Lydian, high and glassy.
function glassHarmonics() {
  const p = cell("Glass Harmonics", {
    description: "High, glassy tones with stretched overtones appear at random in D Lydian, each one blooming and dying over several seconds into a big hall: wet fingers on the rims of wine glasses. Shared input Touch (more tones).",
    tags: ["ambient", "generative", "glass", "additive", "bells", "sparse"],
    help: "A Recall module running free makes random gates and voltages. Each gate triggers an Additive Osc with a stretched, bell-like spectrum " +
      "and a long decay; each voltage goes through a Quantizer (D Lydian) to its pitch. The tones are sent to a Pitch Shifter an octave up " +
      "as well and to a very large hall.\n\n" +
      "It sounds on its own from Out L/R; it is not tied to the tempo. The Touch input is added to the gate bias of Recall: more is more tones.\n\n" +
      "Tip: Stretch on the Additive Osc changes the metal: lower is more string, higher more bell.",
  }).input("touch", "Touch").stereoOut();
  const rc = p.add("recall", [0, 1], { tmode: "Chance", tbias: 0.3, trecall: 0.2, gatelength: 0.1, xspread: 0.8, rate: 0.3, sync: "Free", seed: 140 });
  const q = p.add("quantizer", [1, 1], { root: "D", scale: "Lydian", range: 1, hysteresis: 0.05 });
  const ad = p.add("additive-osc", [2, 1], { octave: 1, partials: 30, tilt: -5, stretch: 0.45, decay: 4, damp: 0.6, chorus: 10, width: 0.8, base: "Flat", phases: "Aligned" }, { name: "Glass" });
  p.cable(p.cin, "touch", rc, "tbias", 0.3).cable(rc, "x1", q, "in").cable(q, "out", ad, "pitch").cable(rc, "t1", ad, "trigger");
  const mix = bed(p, [3, 1], [{ node: ad, jacks: ["outL", "outR"], level: -8, send: -8 }], { return: -4, master: -2 });
  const shift = p.add("pitch-shifter", [4, 2], { pitch: 12, window: 100, drift: 0.2, mix: 1 });
  sendReturn(p, mix, shift);
  hall(p, mix, [5, 1], { size: 0.95, decay: 13, mix: 0.5 });
  return p;
}

export default category("Ambient Melodies", "Slow generative notes held to a scale: sparse, ringing and never the same twice. Nothing to play, no transport needed. Out L/R out.", [
  slowPentatonicDrift, bellGarden, eveningChoir, moonlitPlucks, cloudChords, neuronLullaby, kalimbaTides, weepingStrings, dawnChorale, glassHarmonics,
]);
