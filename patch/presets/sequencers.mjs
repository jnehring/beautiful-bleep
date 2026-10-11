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

/// Polymeter Seq track as PolymeterSequencerModule's sanitiseData writes it.
function polyTrack(values, div = "1", dir = "fwd") {
  const neutral = { trig: 1, note: 0, oct: 0, gate: 50, prob: 100, ratch: 1 };
  return (key) => {
    const steps = [];
    for (let i = 0; i < 64; i++) {
      const v = i < values.length ? values[i] : neutral[key];
      steps.push(key === "ratch" ? (Array.isArray(v) ? v : [v, 0]) : v);
    }
    return { len: values.length, lo: 0, hi: values.length - 1, div, dir, mute: false, steps };
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

/// Cartesian Seq grid: rows of cells (strings of "pitch" numbers, "." rest, "_" tie), 8 × 8, row-major.
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
  // A tie holds the previous cell's pitch.
  for (let i = 1; i < cells.length; i++) if (cells[i].g === 2) cells[i].p = cells[i - 1].p;
  return { cells, randomize: { density: 0.6, octaves: 1, skip: 0, velocity: [0.6, 1] } };
}

// ------------------------------------------------------------ presets

// A 16-step acid line in A Phrygian: slides from ties, accents from velocity.
function acidSermon() {
  const p = cell("Acid Sermon", {
    description: "A 16-step A Phrygian acid line with ties for slides and loud accents: play a mono Voice Cell with Legato and Glide. Shared inputs Transpose and Reset.",
    tags: ["sequencer", "acid", "bass", "step sequencer", "phrygian"],
    help: "A Step Sequencer with 16 steps in A Phrygian, two octaves down. Ties hold a note into the next step " +
      "and the louder steps carry high velocity, so accents come from the pattern itself. Gate length is 55 " +
      "percent with a little swing.\n\n" +
      "Patch Notes into a Voice Cell set to one voice, Legato mode and some Glide: the ties then become " +
      "slides. Pitch and Gate outputs are there if you want to drive your own oscillator and envelope. " +
      "Transpose shifts the whole line; a trigger into Reset restarts it. It follows the transport unless " +
      "you patch Clock.\n\n" +
      "Tip: send Notes to a resonant filtered voice and move Transpose by a few semitones between sections.",
  }).input("tr", "Transpose", "pitch").input("rst", "Reset", "trigger");
  const seq = p.add("step-sequencer", [1, 1], { gatelength: 0.55, swing: 0.52, root: "A", scale: "Phrygian", octave: -2 }, {
    data: steps([0, 0, 12, "_", 1, 0, ".", 7, 0, 12, ".", 3, "_", 0, 10, 1],
                [127, 80, 110, 80, 90, 80, 80, 127, 80, 110, 80, 127, 80, 80, 110, 90]),
  });
  p.cable(p.cin, "tr", seq, "transpose").cable(p.cin, "rst", seq, "reset");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// A two-bar bassline that jumps octaves and moves to the sixth in bar two.
function octaveBounce() {
  const p = cell("Octave Bounce", {
    description: "A two-bar E minor bassline bouncing between octaves, moving to C in the second bar: disco and house bass. Shared input Transpose follows a key change or a chord sequencer.",
    tags: ["sequencer", "bass", "octave", "house", "disco"],
    help: "A 32-step Step Sequencer in E natural minor, two octaves down. The line alternates a note with its " +
      "octave above; in the second bar it moves up to C with the same bounce. Gates are short (35 percent) " +
      "with a slight swing, and the velocities accent every other step.\n\n" +
      "Patch Notes into a Voice Cell for a house or disco bass; Pitch and Gate outputs are also available. " +
      "Transpose follows a key change, for instance from a chord sequencer or a Quantizer. It follows the " +
      "transport unless you patch Clock.\n\n" +
      "Tip: a short decay on the bass voice keeps the bounce tight.",
  }).input("tr", "Transpose", "pitch");
  const seq = p.add("step-sequencer", [1, 1], { gatelength: 0.35, swing: 0.54, length: 32, root: "E", scale: "Natural Minor",
                                                octave: -2 }, {
    data: steps([0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 3, 15, 5, 17,
                 8, 20, 8, 20, 8, 20, 8, 20, 7, 19, 7, 19, 10, 22, 10, 12],
                [120, 90, 110, 90]),
  });
  p.cable(p.cin, "tr", seq, "transpose");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// A Harmony Master progression on Bus D, played as sustained seventh chords.
function nightDriveChanges() {
  const p = cell("Night Drive Changes", {
    description: "Harmony Master plays Am7 – Fmaj7 – Cmaj7 – G7, two bars each, as sustained chords (and the chord root on Root) on harmony Bus D. Shared inputs Transpose and Reset.",
    tags: ["sequencer", "chords", "progression", "harmony", "pads"],
    help: "A Harmony Master in Progression mode plays Am7, Fmaj7, Cmaj7 and G7, two bars each, as seventh " +
      "chords one octave down. It also publishes the chord on harmony Bus D, so modules set to follow Bus D " +
      "hear the same changes.\n\n" +
      "Patch Notes into a polyphonic Voice Cell (a pad or keys) to play the chords. The Root output carries " +
      "the chord root as pitch: patch it into a bass voice. A pitch into Transpose moves the key; a trigger " +
      "into Reset returns to the first chord. It follows the transport unless you patch Clock.\n\n" +
      "Tip: give the pad voice a slow attack and release for sustained chords.",
  }).input("tr", "Transpose", "pitch").input("rst", "Reset", "trigger");
  const hm = p.add("harmony-master", [1, 1], { source: "Progression", key: "A", scale: "Natural Minor",
                                              quality: "Diatonic Seventh", velocity: 0.6, octave: -1, bus: "D" }, {
    data: { slots: [1, 6, 3, 7].map((deg) => ({ deg, q: "diatonic-seventh", len: 8 })) },
  });
  p.cable(p.cin, "tr", hm, "transpose").cable(p.cin, "rst", hm, "reset");
  notesOut(p, hm);
  p.output("root", "Root", "pitch").cable(hm, "root", p.cout, "root");
  return p;
}

// The chord roots of a Dorian progression arpeggiated in 16ths over two octaves.
function cascadeArp() {
  const p = cell("Cascade Arp", {
    description: "A D Dorian progression (Dm – G – Dm – C) from Harmony Master on Bus D, arpeggiated by Quantizer Suite as seventh chords over two octaves, up and down in 16ths.",
    tags: ["sequencer", "arpeggio", "arp", "dorian", "harmony"],
    help: "A Harmony Master walks D Dorian chords (Dm, G, Dm, C, four beats each) on Bus D. Its chord root " +
      "feeds a Quantizer Suite in Arp mode, which arpeggiates seventh chords over two octaves, up and down, " +
      "from the transport.\n\n" +
      "Patch Notes into any Voice Cell; the Pitch output carries the arpeggio as pitch too, but there is no " +
      "Gate output. A pitch into Transpose shifts the chord progression. Follows the transport unless you " +
      "patch Clock.\n\n" +
      "Tip: a plucky voice with a short decay shows the chord changes best.",
  }).input("tr", "Transpose", "pitch");
  const hm = p.add("harmony-master", [0, 1], { source: "Progression", key: "D", scale: "Dorian", octave: -1, bus: "D" }, {
    data: { slots: [1, 4, 1, 7].map((deg) => ({ deg, q: "diatonic-triad", len: 4 })) },
  });
  const arp = p.add("quantizer-suite", [1, 1], {
    "a.mode": "Arp", "a.root": "D", "a.scale": "Dorian", "a.chord": "Seventh", "a.span": 2, "a.order": "Up-Down",
    "b.notes": false, "c.notes": false, "d.notes": false, velocity: 0.75,
  }, { name: "Arpeggiator" });
  p.cable(p.cin, "tr", hm, "transpose").cable(hm, "root", arp, "ina");
  return notesOut(p, arp, { pitch: "outa" });
}

// A slowly mutating shift register in E minor pentatonic.
function turingSpiral() {
  const p = cell("Turing Spiral", {
    description: "A Turing-machine melody: an 8-bit Shift Register that mutates now and then, quantized to E minor pentatonic over two octaves. Shared inputs Lock (frozen ↔ random) and Transpose.",
    tags: ["sequencer", "generative", "shift register", "turing", "lead"],
    help: "An 8-bit Shift Register (Turing machine) clocked on 16ths, quantized to E minor pentatonic over two " +
      "octaves. At each step the bit that comes back round is kept or flipped by chance, set by Lock; CV to " +
      "Notes turns the pitch into notes, with bit 1 as the gate.\n\n" +
      "Patch Notes into a Voice Cell. Pitch and Gate outputs are also available. The Lock input is added to " +
      "the Lock knob: up freezes the loop, down makes it fully random. Transpose shifts the key. Follows " +
      "the transport unless you patch Clock.\n\n" +
      "Tip: let it mutate, then push Lock up when you like the loop.",
  }).input("lock", "Lock").input("tr", "Transpose", "pitch");
  const sr = p.add("shift-register", [0, 1], { lock: 0.8, length: 8, gatelength: 0.6, sync: "1/16", octaves: 2, root: "E",
                                               scale: "Minor Pentatonic" });
  const cv = p.add("cv-to-notes", [1, 1], { velocity: 0.75 });
  p.cable(p.cin, "lock", sr, "lock", 0.5).cable(p.cin, "tr", sr, "transpose")
    .cable(sr, "pitch", cv, "pitch").cable(sr, "bit1", cv, "gate");
  return notesOut(p, cv, { pitch: "pitch", pitchNode: sr, gate: "bit1", gateNode: sr });
}

// Six tracks of different lengths: a line that takes ages to repeat.
function clockworkPolymeter() {
  const p = cell("Clockwork Polymeter", {
    description: "Polymeter Seq in F Dorian: rhythm 16, notes 5, octaves 7, gates 12 and chances 9 steps long, so the line keeps turning over for hundreds of bars. Shared input Transpose.",
    tags: ["sequencer", "polymeter", "generative", "dorian"],
    help: "A Polymeter Seq in F Dorian with six tracks of different lengths: rhythm 16 steps, notes 5, octaves " +
      "7, gates 12, chances 9, plus a ratchet track. Because the lengths do not divide each other, the " +
      "combined line takes hundreds of bars to repeat.\n\n" +
      "Patch Notes into a Voice Cell; Pitch and Gate outputs are also available. Transpose shifts the key. " +
      "It follows the transport unless you patch Clock.\n\n" +
      "Tip: open the Polymeter Seq and change one track's length to hear how the repeat length changes.",
  }).input("tr", "Transpose", "pitch");
  const tracks = {
    trig: polyTrack([2, 0, 1, 1, 0, 1, 2, 0, 1, 0, 1, 1, 0, 2, 1, 0])("trig"),
    note: polyTrack([0, 2, 4, 1, 3])("note"),
    oct: polyTrack([0, 0, 1, 0, 0, -1, 0])("oct"),
    gate: polyTrack([40, 30, 60, -1, 30, 50, 30, 80, 30, 40, -1, 30])("gate"),
    prob: polyTrack([100, 100, 80, 100, 60, 100, 100, 75, 100])("prob"),
    ratch: polyTrack([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, [3, 1], 1])("ratch"),
  };
  const seq = p.add("polymeter-sequencer", [1, 1], { velocity: 0.8, spread: 0.2, root: "F", scale: "Dorian", octave: -1 }, {
    data: { slot: 0, slots: [{ tracks }], randomize: { density: 0.5, degrees: [0, 7], stepwise: true, ratchet: 0.1 } },
  });
  p.cable(p.cin, "tr", seq, "transpose");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// Eight held, ratcheted and sliding stages in C harmonic minor: one bar, four-bar phrase.
function staircasePhrase() {
  const p = cell("Staircase Phrase", {
    description: "Stage Seq in C harmonic minor: eight stages of held notes, repeats, a ratchet and two slides make a one-bar riff with a four-bar phrase. Shared inputs Transpose and Hold.",
    tags: ["sequencer", "stage sequencer", "riff", "harmonic minor"],
    help: "A Stage Sequencer with eight stages in C harmonic minor. Each stage has a pitch, a number of pulses " +
      "and a gate mode: held notes, repeats, one ratchet and two slides. Together they make a one-bar riff " +
      "that unfolds as a four-bar phrase.\n\n" +
      "Patch Notes into a Voice Cell; use Legato and Glide for the slides. Pitch and Gate outputs are also " +
      "available. A pitch into Transpose shifts the riff. While a gate is high on Hold, the current stage " +
      "keeps repeating instead of moving on. Follows the transport unless you patch Clock.\n\n" +
      "Tip: hold a stage with a button or an LFO square for stutter fills.",
  }).input("tr", "Transpose", "pitch").input("hold", "Hold", "gate");
  const seq = p.add("stage-sequencer", [1, 1], { gatelength: 0.6, slidetime: 0.07, accent: 0.6, stages: 8, root: "C",
                                                 scale: "Harmonic Minor", octave: -1 }, {
    data: stageData([
      [0, 3, "Hold", { accent: true, v: 115 }],
      [0, 1, "Every", { v: 80 }],
      [7, 2, "First"],
      [8, 1, "Every", { slide: true }],
      [7, 2, "Ratchet", { r: 3, v: 90 }],
      [3, 2, "Hold", { accent: true, v: 115 }],
      [2, 1, "Every", { v: 85 }],
      [-1, 4, "Hold", { slide: true }],
    ]),
  });
  p.cable(p.cin, "tr", seq, "transpose").cable(p.cin, "hold", seq, "hold");
  return notesOut(p, seq, { pitch: "pitch", gate: "gate" });
}

// A 4 × 3 corner of the Cartesian grid: twelve-step figure against the bar.
function latticeWalker() {
  const p = cell("Lattice Walker", {
    description: "Cartesian Seq in F Lydian walks a 4 × 3 grid of bright broken chords: a twelve-step figure that shifts against the bar; Mod rises through the grid. Shared input Transpose.",
    tags: ["sequencer", "cartesian", "lydian", "pluck", "melodic"],
    help: "A Cartesian Seq walking a small 4 by 3 corner of its grid in F Lydian: the X axis steps on 16ths " +
      "across four columns and the Y axis moves a row each time X wraps. A twelve-step figure against a " +
      "16-step bar makes it shift against the bar.\n\n" +
      "Patch Notes into a Voice Cell for plucks. Pitch and Gate outputs are also available, and Mod, a " +
      "value that rises through the grid, can go into a filter cutoff or another knob. Transpose shifts the " +
      "key. Follows the transport unless you patch Clock.\n\n" +
      "Tip: use Mod on a cutoff so the sound opens as the figure walks on.",
  }).input("tr", "Transpose", "pitch");
  const seq = p.add("cartesian-sequencer", [1, 1], { gatelength: 0.45, columns: 4, rows: 3, xrate: "1/16", yrate: "Wrap",
                                                     root: "F", scale: "Lydian" }, {
    data: cartData([
      [0, 7, 11, 16],
      [2, 9, "_", 14],
      [4, ".", 11, 19],
    ]),
  });
  p.cable(p.cin, "tr", seq, "transpose");
  notesOut(p, seq, { pitch: "pitch", gate: "gate" });
  p.output("mod", "Mod").cable(seq, "mod", p.cout, "mod");
  return p;
}

// Random steps quantized to D Dorian, gated by a weighted coin on 8ths.
function wanderingMonk() {
  const p = cell("Wandering Monk", {
    description: "A random melodic walk: Random steps on each 8th, quantized to D Dorian, with a looping coin deciding which 8ths play. Shared inputs Loop (new ↔ repeating) and Transpose.",
    tags: ["sequencer", "random", "generative", "dorian", "melody"],
    help: "A random melody built from modules: an LFO square gives 8th clocks, Random picks a value on each " +
      "clock, a Quantizer snaps it to D Dorian, and a looping Coin Toss decides which 8ths actually play.\n\n" +
      "Patch Notes into a Voice Cell; Pitch and Gate outputs are also available. The Loop input is added to " +
      "the Random Loop knob: higher repeats the recent notes, lower gives new ones. Transpose shifts the " +
      "key. The 8th clock follows the transport.\n\n" +
      "Tip: raise Loop until a phrase you like repeats.",
  }).input("loop", "Loop").input("tr", "Transpose", "pitch");
  const clk = p.add("lfo", [0, 0], { pw: 0.5, wave: "Square", sync: "1/8", polarity: "Unipolar" }, { name: "8th Clock" });
  const rnd = p.add("random", [1, 0], { spread: 0.75, loop: 0.6, length: "16 steps" });
  const q = p.add("quantizer", [2, 0], { root: "D", scale: "Dorian", hysteresis: 0 });
  const coin = p.add("coin-toss", [1, 1], { prob1: 0.72, loop: "8 tosses" });
  const cv = p.add("cv-to-notes", [3, 1], { velocity: 0.7 });
  p.cable(clk, "square", rnd, "clock").cable(clk, "square", coin, "in1")
    .cable(p.cin, "loop", rnd, "loop", 0.5).cable(p.cin, "tr", q, "transpose")
    .cable(rnd, "out", q, "in").cable(q, "out", cv, "pitch").cable(coin, "a1", cv, "gate");
  return notesOut(p, cv, { pitch: "out", pitchNode: q, gate: "a1", gateNode: coin });
}

// Recall: random gates and notes that repeat the recent past, with a Memory input.
function dejaVuLine() {
  const p = cell("Deja Vu Line", {
    description: "Recall draws random 16th-note gates and A minor pentatonic notes that keep echoing their recent past: half new, half remembered. Shared inputs Memory (more = repeats) and Reset.",
    tags: ["sequencer", "recall", "generative", "random", "pentatonic"],
    help: "A Recall module on 16ths makes random gates (T1) and random pitches (X1) in A minor pentatonic, and " +
      "CV to Notes turns them into notes. Both are drawn partly from their own recent past, so phrases " +
      "return in changed form.\n\n" +
      "Patch Notes into a Voice Cell; Pitch and Gate outputs are also available. The Memory input is added " +
      "to both Recall knobs: more means more repeats, up to a locked loop. A trigger into Reset restarts " +
      "the loop. Follows the transport unless you patch Clock.\n\n" +
      "Tip: sweep Memory up slowly, then down again to let new notes in.",
  }).input("mem", "Memory").input("rst", "Reset", "trigger");
  const rc = p.add("recall", [1, 1], { tbias: 0.6, trecall: 0.55, gatelength: 0.55, xspread: 0.5, xsteps: 0.62,
                                       xrecall: 0.7, sync: "1/16", tloop: 8, xloop: 8, xsource: "T1", root: "A",
                                       scale: "Minor Pentatonic" });
  const cv = p.add("cv-to-notes", [2, 1], { velocity: 0.75 });
  p.cable(p.cin, "mem", rc, "trecall", 0.5).cable(p.cin, "mem", rc, "xrecall", 0.5).cable(p.cin, "rst", rc, "reset")
    .cable(rc, "x1", cv, "pitch").cable(rc, "t1", cv, "gate");
  return notesOut(p, cv, { pitch: "x1", pitchNode: rc, gate: "t1", gateNode: rc });
}

export default category("Sequencers", "Note sources that follow the transport: patch Notes into any Voice Cell.", [
  acidSermon, octaveBounce, nightDriveChanges, cascadeArp, turingSpiral, clockworkPolymeter, staircasePhrase,
  latticeWalker, wanderingMonk, dejaVuLine,
]);
