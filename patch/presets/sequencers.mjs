// SPDX-License-Identifier: MIT
// Sequencers: plain cells whose main output is Notes, to play any Voice Cell.
// They follow the transport (nothing in Clock); most also offer Pitch and Gate.
import { cell, category, steps } from "./kit.mjs";

// ------------------------------------------------------------ local helpers

/// Notes, Pitch and Gate outputs fed from one node's jacks.
function notesOut(p, node, jacks = {}) {
  p.output("notes", "Notes", "notes").cable(node, jacks.notes || "notes", p.cout, "notes");
  if (jacks.pitch) p.output("pitch", "Pitch", "pitch").cable(jacks.pitchNode || node, jacks.pitch, p.cout, "pitch");
  if (jacks.gate) p.output("gate", "Gate", "gate").cable(jacks.gateNode || node, jacks.gate, p.cout, "gate");
  return p;
}

/// Gate Sequencer data: up to four 32-step tracks as strings. `.` off, `x` hit, `X` accent, `o` ghost,
/// `?` coin-flip hit, `2`/`3` ratchets, `!` hit only while Fill is held, `-` hit only while Fill is NOT held.
function gateTracks(rows) {
  const step = (ch) => {
    const s = { on: 0, p: 100, l: 50, t: 0, r: 1, rs: 0, n: 0, c: [0, 0], v: 100 };
    switch (ch) {
      case "x": Object.assign(s, { on: 1, v: 96 }); break;
      case "X": Object.assign(s, { on: 1, v: 124 }); break;
      case "o": Object.assign(s, { on: 1, v: 48 }); break;
      case "?": Object.assign(s, { on: 1, p: 45, v: 80 }); break;
      case "2": Object.assign(s, { on: 1, r: 2, v: 90 }); break;
      case "3": Object.assign(s, { on: 1, r: 3, rs: 1, v: 90 }); break;
      case "!": Object.assign(s, { on: 1, v: 110, c: [4, 0] }); break;
      case "-": Object.assign(s, { on: 1, v: 96, c: [5, 0] }); break;
      default: break;
    }
    return s;
  };
  return {
    tracks: [0, 1, 2, 3].map((t) => ({ mute: false, steps: [...(rows[t] || "").padEnd(32, ".")].slice(0, 32).map(step) })),
  };
}

/// Stage Seq stages: [pitch, pulses, gate, opts]; gate is Rest/First/Every/Hold/Ratchet.
const STAGE_GATES = ["Rest", "First", "Every", "Hold", "Ratchet"];
function stageData(list) {
  return {
    stages: list.map(([p, n, g, o = {}]) => ({ p, n, g: STAGE_GATES.indexOf(g), r: o.r || 2, s: o.slide ? 1 : 0,
                                               v: o.v || 100, a: o.accent ? 1 : 0 })),
    randomize: { lanes: ["pitch", "pulses", "gate"], octaves: 1, maxPulses: 4, slide: 0.15, accent: 0.15 },
  };
}

/// Cartesian Seq grid: rows of cells (numbers = semitones, "." rest, "_" tie), 8 × 8, row-major.
function cartData(rows, vel = [112, 84, 96, 84]) {
  const cells = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const v = rows[r] ? rows[r][c] : undefined;
      const cellv = { g: 0, p: 0, v: vel[c % vel.length], m: Math.round(-100 + ((r * 8 + c) * 200) / 63), a: 1 };
      if (v === "_") cellv.g = 2;
      else if (typeof v === "number") Object.assign(cellv, { g: 1, p: v });
      cells.push(cellv);
    }
  for (let i = 1; i < cells.length; i++) if (cells[i].g === 2) cells[i].p = cells[i - 1].p;
  return { cells, randomize: { density: 0.6, octaves: 1, skip: 0, velocity: [0.6, 1] } };
}

// ------------------------------------------------------------ presets

// A swung triplet gallop on an E minor bass: three-note figures, one octave jump each beat.
function tripletGallop() {
  const p = cell("Triplet Gallop", {
    description: "A twelve-step triplet bass figure in E minor that gallops root, root, octave: play a short, punchy bass Voice Cell for driving metal and electro-rock lines. Shared inputs Transpose and Reset.",
    tags: ["sequencer", "bass", "triplet", "gallop", "driving"],
    help: "A Step Sequencer with twelve steps on triplet eighths in E natural minor, three octaves down from the " +
      "middle. Every beat is a gallop: root, root, octave, and the last beat climbs through the fifth and the " +
      "seventh. The first note of each group is accented, the others ride lower.\n\n" +
      "Patch Notes into a Voice Cell set to one voice with a short decay; Pitch and Gate are there if you " +
      "would rather drive your own oscillator and envelope. A pitch into Transpose changes the key, a " +
      "trigger into Reset restarts the figure. It follows the transport unless you patch Clock.\n\n" +
      "Tip: distortion after a sawtooth bass makes it sound like a charging bass guitar.",
  }).input("tr", "Transpose", "pitch").input("rst", "Reset", "trigger");
  const seq = p.add("step-sequencer", [1, 1], { length: 12, rate: "1/8T", gatelength: 0.45, root: "E", scale: "Natural Minor", octave: -2 }, {
    data: steps([0, 0, 12, 0, 0, 12, 0, 0, 12, 7, 7, 10], [124, 72, 96]),
  });
  p.cable(p.cin, "tr", seq, "transpose").cable(p.cin, "rst", seq, "reset");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// Eight notes of C major pentatonic played up and back, with a little random variation.
function pendulumClimb() {
  const p = cell("Pendulum Climb", {
    description: "Eight C major pentatonic notes played up and back again in eighths, with a Variation input that nudges random steps by an octave: a bright climbing figure for a pluck or a bell voice.",
    tags: ["sequencer", "pentatonic", "ping-pong", "melodic", "variation"],
    help: "A Step Sequencer with eight steps in C major pentatonic, running in Ping-Pong direction: up the " +
      "scale and back down without repeating the end notes. The Variation knob lets random steps jump by up " +
      "to an octave and a half; at zero the figure is exactly the same every time.\n\n" +
      "Patch Notes into a Voice Cell with a pluck, bell or mallet sound. The Variation input is added to the " +
      "Variation knob, so a slow LFO or a dial brings the figure to life, and a pitch into Transpose moves " +
      "the key. It follows the transport unless you patch Clock.\n\n" +
      "Tip: raise Variation only during the last bar of a phrase for a spontaneous fill.",
  }).input("var", "Variation").input("tr", "Transpose", "pitch");
  const seq = p.add("step-sequencer", [1, 1], { length: 8, rate: "1/8", direction: "Ping-Pong", gatelength: 0.6, variation: 0.1,
                                                varrange: 12, root: "C", scale: "Major Pentatonic", octave: 0 }, {
    data: steps([0, 2, 4, 7, 9, 12, 14, 16], [112, 84, 92, 84, 100, 84, 92, 84]),
  });
  p.cable(p.cin, "var", seq, "variation", 0.6).cable(p.cin, "tr", seq, "transpose");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// Root notes sampled by a chord quantizer: syncopated minor seventh stabs.
function offbeatStabs() {
  const p = cell("Offbeat Stabs", {
    description: "Short syncopated A Dorian chord stabs: a Step Sequencer fires root notes that a Chord Quantizer turns into smooth-voiced seventh chords. Play a keys or organ Voice Cell. Shared inputs Transpose and Strum.",
    tags: ["sequencer", "chords", "stabs", "dorian", "keys"],
    help: "A Step Sequencer places root notes on the off-beats of a bar in A Dorian. A Chord Quantizer in " +
      "Diatonic mode turns every root into a four-note seventh chord from the same scale, voiced Drop 2 with " +
      "voice leading so neighbouring chords move as little as possible.\n\n" +
      "Patch Notes into a polyphonic Voice Cell (electric piano, organ or a short synth chord) and keep the " +
      "release short. Root carries the chord root as a pitch for a bass voice. The Strum input is added to " +
      "the Strum time, spreading each chord into a quick roll, and a pitch into Transpose changes the key. " +
      "It follows the transport unless you patch Clock.\n\n" +
      "Tip: play the Root output on a bass voice an octave down to get the whole rhythm section.",
  }).input("tr", "Transpose", "pitch").input("strum", "Strum");
  const seq = p.add("step-sequencer", [0, 1], { length: 16, rate: "1/16", gatelength: 0.3, swing: 0.55, root: "A", scale: "Dorian", octave: -1 }, {
    data: steps([".", ".", 0, ".", ".", ".", 0, ".", ".", ".", 5, ".", ".", ".", 3, 7], [110, 90, 120, 90]),
  });
  const cq = p.add("chord-quantizer", [1, 1], { mode: "Diatonic", root: "A", scale: "Dorian", stack: "Seventh", voicing: "Drop 2",
                                               lead: "Smooth", velocity: 0.75, strum: 0.01 });
  p.cable(p.cin, "tr", seq, "transpose").cable(p.cin, "strum", cq, "strum", 0.4)
    .cable(seq, "pitch", cq, "pitch").cable(seq, "trigger", cq, "trig").cable(seq, "gate", cq, "gate");
  notesOut(p, cq);
  p.output("root", "Root", "pitch").cable(cq, "root", p.cout, "root");
  return p;
}

// Held notes in, an arpeggio out: converging from the outside to the middle over three octaves.
function convergingArp() {
  const p = cell("Converging Arp", {
    description: "Hold a chord on a keyboard and it plays the notes from the outside in over three octaves, with latch on so you can let go: patch a Keyboard or the host's MIDI into Notes and the output into any Voice Cell.",
    tags: ["sequencer", "arpeggio", "arp", "latch", "keys"],
    help: "An Arpeggiator in Converge pattern over three octaves on sixteenth notes, with swing and Latch on: " +
      "it alternates between the lowest and the highest held note and moves toward the middle, so a chord " +
      "folds in on itself. With Latch on, it keeps playing after you release the keys until you play a new " +
      "chord.\n\n" +
      "Patch a Keyboard (or the host's MIDI notes) into the Notes input, and the Notes output into a Voice " +
      "Cell. Pitch and Gate are there too. A trigger into Reset restarts the pattern. It follows the " +
      "transport unless you patch Clock.\n\n" +
      "Tip: play a four-note chord and change it every bar for a pulsing, ever-shifting texture.",
  }).input("notes", "Notes", "notes").input("rst", "Reset", "trigger");
  const arp = p.add("arpeggiator", [1, 1], { rate: "1/16", pattern: "Converge", octaves: 3, latch: "On", gatelength: 0.55, swing: 0.54 });
  p.cable(p.cin, "notes", arp, "notes").cable(p.cin, "rst", arp, "reset");
  return notesOut(p, arp, { pitch: "pitch", gate: "gate" });
}

// A four-lane Gate Sequencer: kick, snare, hat and an odd-length open-hat lane, with fill steps.
function ratchetDrums() {
  const p = cell("Ratchet Drums", {
    description: "A four-lane drum pattern with ratcheted hats, ghost notes and a fill that appears while its input is held: patch Notes into a drum machine's MIDI input or each Gate into a drum voice. Shared inputs Fill and Hat Mute.",
    tags: ["sequencer", "drums", "ratchet", "fill", "gate sequencer"],
    help: "A Gate Sequencer with four lanes at sixteenth notes: kick, snare, closed hat and an open-hat lane " +
      "that is twelve steps long and so drifts against the other three. The hats ratchet in places, the " +
      "snare has a ghost note and the kick has coin-flip hits. While Fill is held, extra snare hits " +
      "appear and some kicks drop out.\n\n" +
      "Notes carries all four lanes as General MIDI drum notes (kick, snare, closed and open hat): patch it " +
      "into a drum machine cell's Notes input. Or use the Kick, Snare, Hat and Open gates on single drum " +
      "voices. A gate into Fill adds the fill, a gate into Hat Mute silences the hats. It follows the " +
      "transport unless you patch Clock.\n\n" +
      "Tip: hold Fill on the last bar of every four for a turnaround.",
  }).input("fill", "Fill", "gate").input("mute", "Hat Mute", "gate");
  const seq = p.add("gate-sequencer", [1, 1], { swing: 0.55, ratchetdecay: 0.4, length4: 12, dice: "Repeat every 4", seed: 9, chance2: 1 }, {
    data: gateTracks([
      "X..-.?..x.-.x..-X...-.?..x.?x.-.",
      "....X...o...X...-...X..o-...X..!",
      "x.x.x.x.x.x.x.x2x.x.x.x.x.x2x.x3",
      "..o...?...o.....",
    ]),
  });
  p.cable(p.cin, "fill", seq, "fill").cable(p.cin, "mute", seq, "mute3");
  p.output("notes", "Notes", "notes").cable(seq, "notes", p.cout, "notes");
  [["Kick", "gate1"], ["Snare", "gate2"], ["Hat", "gate3"], ["Open", "gate4"]].forEach(([name, jack]) => {
    p.output(jack, name, "gate").cable(seq, jack, p.cout, jack);
  });
  return p;
}

// A slow crosshair wanders an 8 x 8 grid of D Dorian phrases; notes sound as it enters each cell.
function gridPilgrim() {
  const p = cell("Grid Pilgrim", {
    description: "No clock at all: two slow LFOs steer a crosshair over an 8 × 8 grid of D Dorian phrases and a note sounds whenever it enters a new cell. Shared inputs X and Y push the crosshair by hand; Mod rises with the row.",
    tags: ["sequencer", "cartesian", "ambient", "dorian", "wandering"],
    help: "A Cartesian Seq in Cartesian mode: X and Y choose the column and the row directly, and with Sample set " +
      "to Change a note plays as soon as the crosshair moves into a different cell. Two slow triangle LFOs " +
      "steer the crosshair so it drifts across all 64 cells in D Dorian, low rows to high rows.\n\n" +
      "Patch Notes into a Voice Cell with a soft, long-release sound. The X and Y inputs are added to the " +
      "LFO movement: patch an XY Pad or two Dials and you steer the walk yourself. Mod carries the value " +
      "stored in each cell, which is higher in the upper rows; patch it into a filter cutoff. The walk is " +
      "independent of the transport and keeps going when it stops.\n\n" +
      "Tip: make the voice's release long enough that the notes overlap into a slow, pealing melody.",
  }).input("x", "X").input("y", "Y");
  const lx = p.add("lfo", [0, 0], { rate: 0.045, wave: "Triangle", polarity: "Unipolar" }, { name: "X Walk" });
  const ly = p.add("lfo", [0, 1], { rate: 0.0173, wave: "Triangle", polarity: "Unipolar", phase: 90 }, { name: "Y Walk" });
  const seq = p.add("cartesian-sequencer", [1, 1], { mode: "Cartesian", sample: "Change", columns: 8, rows: 8, gatelength: 0.7,
                                                     root: "D", scale: "Dorian", octave: -1, modslew: 0.2 }, {
    data: cartData([
      [0, 0, 7, 0, 3, 0, 5, "."],
      [0, 3, 5, 7, 10, 7, 5, 3],
      [2, 5, 9, 5, 2, ".", 7, 9],
      [7, 10, 12, 10, 7, 5, "_", 3],
      [12, 10, 12, 14, 12, 10, 9, 7],
      [0, ".", 12, ".", 10, ".", 7, "."],
      [5, 7, 9, 12, 9, 7, 5, "_"],
      [14, 12, 10, 12, 7, 10, 5, 3],
    ], [100, 80, 90, 70]),
  });
  p.cable(lx, "out", seq, "x").cable(ly, "out", seq, "y")
    .cable(p.cin, "x", seq, "x", 0.5).cable(p.cin, "y", seq, "y", 0.5);
  notesOut(p, seq, { pitch: "pitch", gate: "gate" });
  p.output("mod", "Mod").cable(seq, "mod", p.cout, "mod");
  return p;
}

// A Brownian walk through eight stages of D Phrygian Dominant, held, repeated and slid.
function bazaarBrownian() {
  const p = cell("Bazaar Brownian", {
    description: "A Stage Seq random-walks one step at a time through eight stages in D Phrygian Dominant, so the riff meanders but never leaps: a winding, eastern-sounding line for a reedy or plucked voice. Shared inputs Transpose and Hold.",
    tags: ["sequencer", "stage sequencer", "phrygian dominant", "random walk", "oriental"],
    help: "A Stage Sequencer with eight stages in D Phrygian Dominant. Mode Brownian moves to a neighbouring " +
      "stage at random each step, never farther, so the line wanders up and down the scale like a snake. " +
      "Stages differ in length (1 to 4 pulses), gate mode (hold, repeat, ratchet) and slide, so a given " +
      "walk sounds varied.\n\n" +
      "Patch Notes into a Voice Cell; with Legato mode and some Glide the slides curve between notes. Pitch " +
      "and Gate are available as well. A pitch into Transpose changes the key; a gate into Hold makes the " +
      "current stage repeat. It follows the transport unless you patch Clock.\n\n" +
      "Tip: change the Seed setting for a different walk with the same notes.",
  }).input("tr", "Transpose", "pitch").input("hold", "Hold", "gate");
  const seq = p.add("stage-sequencer", [1, 1], { stages: 8, mode: "Brownian", rate: "1/8", gatelength: 0.55, slidetime: 0.09, accent: 0.5,
                                                 root: "D", scale: "Phrygian Dominant", octave: -1, seed: 17 }, {
    data: stageData([
      [0, 2, "Every", { accent: true, v: 115 }],
      [1, 1, "Every", { v: 80 }],
      [4, 2, "Hold", { v: 95 }],
      [5, 1, "Every", { slide: true }],
      [7, 2, "Ratchet", { r: 2, v: 90 }],
      [8, 1, "Every", { slide: true, v: 85 }],
      [10, 3, "Hold", { accent: true, v: 110 }],
      [12, 1, "First", { v: 90 }],
    ]),
  });
  p.cable(p.cin, "tr", seq, "transpose").cable(p.cin, "hold", seq, "hold");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// A Euclidean rhythm triggers random notes that are quantized to a scale.
function euclidWalker() {
  const p = cell("Euclid Walker", {
    description: "A Rhythm Bank rhythm decides when to play and a random value, snapped to F Lydian, decides what: a melody over an even, spread-out rhythm that never repeats its notes the same way. Shared inputs Pattern and Transpose.",
    tags: ["sequencer", "euclidean", "random", "lydian", "generative"],
    help: "A Rhythm Bank in the Even family (evenly spread hits over sixteen steps) gives the gate. On every hit a " +
      "Random module picks a new value, a Quantizer snaps it to F Lydian over a range of one and a half " +
      "octaves, and CV to Notes combines pitch and gate into notes.\n\n" +
      "Patch Notes into a Voice Cell. Pitch, Gate and Cycle (a trigger at each pass through the rhythm) are " +
      "also available. The Pattern input is added to the Pattern knob: a slow LFO or a dial moves through the " +
      "library of rhythms, and a pitch into Transpose shifts the key. It follows the transport unless you " +
      "patch Clock.\n\n" +
      "Tip: set Loop on the Random module higher for repeating phrases, or lower for endless variation.",
  }).input("pat", "Pattern").input("tr", "Transpose", "pitch");
  const rb = p.add("rhythm-bank", [0, 1], { pattern: 9, family: "Even", length: "16", rate: "1/16", width: 0.6, output: "Gate" });
  const rnd = p.add("random", [1, 0], { spread: 0.7, loop: 0.3, length: "8 steps" });
  const q = p.add("quantizer", [2, 0], { root: "F", scale: "Lydian", range: 1.5, hysteresis: 0 });
  const cv = p.add("cv-to-notes", [3, 1], { velocity: 0.8 });
  p.cable(p.cin, "pat", rb, "pattern", 0.2).cable(p.cin, "tr", q, "transpose")
    .cable(rb, "out1", rnd, "clock").cable(rnd, "out", q, "in").cable(q, "out", cv, "pitch").cable(rb, "out1", cv, "gate");
  notesOut(p, cv, { pitch: "out", pitchNode: q, gate: "out1", gateNode: rb });
  p.output("cycle", "Cycle", "trigger").cable(rb, "cycle", p.cout, "cycle");
  return p;
}

// A shift register, two note streams: the lead and a bass that echoes the melody later.
function bitCanon() {
  const p = cell("Bit Canon", {
    description: "A Shift Register mutates a melody in A minor pentatonic; bit 1 plays a lead and bit 5 plays a bass two octaves down, so the bass echoes the lead's pattern four steps later. Two Notes outputs: Lead and Bass. Shared inputs Lock and Transpose.",
    tags: ["sequencer", "shift register", "canon", "generative", "two voices"],
    help: "An 8-bit Shift Register clocked on eighth notes in A minor pentatonic. Its first bit plays the lead through " +
      "CV to Notes. Its fifth bit plays a bass: each time it fires, a Quantizer Suite samples the register's " +
      "pitch two octaves lower. Bit 5 is the first bit's pattern delayed by four steps, so the bass is a " +
      "canon of the melody.\n\n" +
      "Patch Lead into a Voice Cell for the melody and Bass into another voice for the bass. Lock is added to the " +
      "Lock knob: up freezes the loop, down mutates it. A pitch into Transpose changes the key. It follows the " +
      "transport unless you patch Clock.\n\n" +
      "Tip: freeze the loop with Lock, then listen: the bass always plays what the lead played four steps ago.",
  }).input("lock", "Lock").input("tr", "Transpose", "pitch");
  const sr = p.add("shift-register", [0, 1], { lock: 0.75, length: 8, sync: "1/8", octaves: 2, root: "A", scale: "Minor Pentatonic",
                                               gatelength: 0.5, seed: 31 });
  const lead = p.add("cv-to-notes", [1, 0], { velocity: 0.8 }, { name: "Lead Notes" });
  const qs = p.add("quantizer-suite", [1, 2], { "a.mode": "Quantize", "a.root": "A", "a.scale": "Minor Pentatonic", "a.sample": "Trigger",
                                               "a.octave": -2, "b.notes": false, "c.notes": false, "d.notes": false, velocity: 0.9 }, { name: "Bass Pitch" });
  const bass = p.add("cv-to-notes", [2, 2], { velocity: 0.9 }, { name: "Bass Notes" });
  p.cable(p.cin, "lock", sr, "lock", 0.5).cable(p.cin, "tr", sr, "transpose")
    .cable(sr, "pitch", lead, "pitch").cable(sr, "bit1", lead, "gate")
    .cable(sr, "pitch", qs, "ina").cable(sr, "bit5", qs, "triga")
    .cable(qs, "outa", bass, "pitch").cable(sr, "bit5", bass, "gate");
  p.output("lead", "Lead", "notes").cable(lead, "notes", p.cout, "lead");
  p.output("bass", "Bass", "notes").cable(bass, "notes", p.cout, "bass");
  p.output("leadpitch", "Lead Pitch", "pitch").cable(sr, "pitch", p.cout, "leadpitch");
  p.output("leadgate", "Lead Gate", "gate").cable(sr, "bit1", p.cout, "leadgate");
  return p;
}

// Drum Map as Notes: a map of rhythms with X, Y and a fill gate.
function mapRider() {
  const p = cell("Map Rider", {
    description: "A map of kick, snare and hat rhythms you travel with X and Y, with General MIDI drum notes out (and a trigger per drum): patch Notes into a drum machine and ride the map with an XY Pad. Shared inputs X, Y and Fill.",
    tags: ["sequencer", "drums", "pattern map", "performance", "generative"],
    help: "A Drum Map holds a map of kick, snare and hat patterns; X and Y pick where you stand on the map and " +
      "the rhythm morphs as you move. The three densities are set to a medium level, the chaos to a slow, " +
      "gentle drift every four bars, and the accent and swing are tuned for a laid-back groove.\n\n" +
      "Notes carries the three drums as General MIDI drum notes: patch it into a drum machine cell's Notes " +
      "input. Kick, Snare and Hats are triggers for single drum voices. The X and Y inputs are added to the " +
      "knobs, so an XY Pad gives you live control; a gate into Fill adds extra hits for a fill. It follows " +
      "the transport unless you patch Clock.\n\n" +
      "Tip: move X and Y slowly across the pad between sections, and hold Fill before each change.",
  }).input("x", "X").input("y", "Y").input("fill", "Fill", "gate");
  const dm = p.add("drum-map", [1, 1], { x: 0.3, y: 0.4, kickdensity: 0.55, snaredensity: 0.5, hatsdensity: 0.6, fillamount: 0.5,
                                         chaos: 0.15, chaosrate: "Every 4 bars", accent: 0.8, swing: 0.55, seed: 5 });
  p.cable(p.cin, "x", dm, "x", 0.7).cable(p.cin, "y", dm, "y", 0.7).cable(p.cin, "fill", dm, "fill");
  p.output("notes", "Notes", "notes").cable(dm, "notes", p.cout, "notes");
  [["Kick", "kick"], ["Snare", "snare"], ["Hats", "hats"]].forEach(([name, jack]) => {
    p.output(jack, name, "trigger").cable(dm, jack, p.cout, jack);
  });
  return p;
}

export default category("Sequencers", "Note sources that follow the transport: patch Notes into any Voice Cell.", [
  tripletGallop, pendulumClimb, offbeatStabs, convergingArp, ratchetDrums, gridPilgrim, bazaarBrownian,
  euclidWalker, bitCanon, mapRider,
]);
