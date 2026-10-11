// SPDX-License-Identifier: MIT
// Drum Machines: plain cells that play a whole kit with the transport. Out L/R.
// (Punch Machine and Ring Machine live in patch/board/ui/factory-presets.js and
// join this category in the Add menu.)
import { cell, category, drumGrid, pattern } from "./kit.mjs";

// ------------------------------------------------------------ local helpers

/// Gate Sequencer data: up to four 32-step tracks as strings, in the exact
/// shape GateSequencerModule's sanitiseData writes. Characters:
/// `.` off, `x` hit, `X` accent, `o` ghost, `?` coin-flip hit, `2`/`3` ratchets
/// (3 speeds up), `~` hit on the first of every two passes (condition 1:2),
/// `!` hit only while Fill is held.
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
      case "~": Object.assign(s, { on: 1, v: 90, c: [1, 12] }); break;
      case "!": Object.assign(s, { on: 1, v: 110, c: [4, 0] }); break;
      default: break;
    }
    return s;
  };
  const tracks = [];
  for (let t = 0; t < 4; t++) {
    const row = (rows[t] || "").padEnd(32, ".");
    tracks.push({ mute: false, steps: [...row].slice(0, 32).map(step) });
  }
  return { tracks };
}

/// One mono drum voice into a mixer channel (mono in: L feeds both sides).
const toMixer = (p, voice, mix, ch) => p.cable(voice, "out", mix, `in${ch}l`);

// ------------------------------------------------------------ presets

// Drum Map's pattern landscape on a Ring kit; X, Y and Fill shared.
function mapWalker() {
  const p = cell("Map Walker", {
    description: "Drum Map plays a Ring kick, snare, clap and hats; move the shared X and Y inputs to travel between grooves, hold Fill for fills.",
    tags: ["drums", "drum map", "generative", "ring"],
  help: "Drum Map holds a landscape of grooves and fires a Ring Kick, Ring Snare, Ring Clap (on the snare " +
         "accent) and Ring Hats. The kit runs through a small mixer to Out L/R.\n\n" +
         "Start the transport, then patch Out L/R to your output. X and Y are shared inputs, each at half " +
         "strength into Drum Map, so an LFO or knob there moves you through the grooves. Hold a gate on Fill " +
         "for fills.\n\n" +
         "Tip: slow an LFO into X while Y sits still for a groove that evolves over minutes.",
  }).input("x", "X").input("y", "Y").input("fill", "Fill", "gate").stereoOut();
  const map = p.add("drum-map", [0, 1], { x: 0.3, y: 0.55, kickdensity: 0.55, snaredensity: 0.5, hatsdensity: 0.65,
                                          chaos: 0.12, swing: 0.54 });
  const kick = p.add("ring-kick", [1, 0], { tune: 48, decay: 0.55, sweep: 0.4, tone: 0.35, drive: 0.15 });
  const snare = p.add("ring-snare", [1, 1], { tune: 190, snappy: 0.65, decay: 0.22 });
  const clap = p.add("ring-clap", [1, 2], { tone: 1300, decay: 0.25, level: 0.6 });
  const hats = p.add("ring-hats", [1, 3], { closed: 0.045, tone: 0.6, level: 0.7 });
  const mix = p.add("audio-mixer", [3, 1], { level2: -1, pan2: -0.08, level3: -4, pan3: 0.15, level4: -3, pan4: 0.3 },
                    { name: "Kit Mixer" });
  p.cable(p.cin, "x", map, "x", 0.5).cable(p.cin, "y", map, "y", 0.5).cable(p.cin, "fill", map, "fill")
    .cable(map, "kick", kick, "trig").cable(map, "kickvel", kick, "velocity")
    .cable(map, "snare", snare, "trig").cable(map, "snarevel", snare, "velocity")
    .cable(map, "snareacc", clap, "trig")
    .cable(map, "hats", hats, "closed").cable(map, "hatsvel", hats, "velocity");
  toMixer(p, kick, mix, 1); toMixer(p, snare, mix, 2); toMixer(p, clap, mix, 3); toMixer(p, hats, mix, 4);
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], clap: [clap, "trig"], hat: [hats, "closed"], open: [hats, "open"] });
  return p;
}

// Gate Sequencer into Macro Osc's Kick, Snare and Metal models plus an FM blip.
function macroFoundry() {
  const p = cell("Macro Foundry", {
    description: "A Gate Sequencer with probabilities and ratchets plays Macro Osc's Kick, Snare and Metal models and a Perc Voice FM blip. Shared input Fill.",
    tags: ["drums", "gate sequencer", "macro osc", "synthetic"],
  help: "A Gate Sequencer with four 32-step tracks plays three Macro Osc voices (Kick, Snare and Metal " +
         "models) and a Perc Voice FM blip, mixed in a Kit Mixer. Some steps are coin flips, some are " +
         "ratchets.\n\n" +
         "Run the transport and take Out L/R to your output. The Fill input is a gate: while it is high, the " +
         "steps marked as fill-only also play.\n\n" +
         "Tip: send a gate to Fill every fourth bar, or tap it by hand, to get a busier last bar.",
  }).input("fill", "Fill", "gate").stereoOut();
  const seq = p.add("gate-sequencer", [0, 1], { swing: 0.53, ratchetdecay: 0.3 }, {
    data: gateTracks([
      "X......x..X.....X......x..x..?..",
      "....X.......X..o....X.......X.3.",
      "x.x?x.x.x.x?x.32x.x?x.x.x.x?x!x3",
      "...?..~.....?..x...?..~...!.?!!!",
    ]),
  });
  const kick = p.add("macro-osc", [1, 0], { model: "Kick", octave: -2, coarse: 2, tone: 0.55, shape: 0.6, blend: 0.3,
                                            decay: 0.45, level: 0.9 }, { name: "Kick" });
  const snare = p.add("macro-osc", [1, 1], { model: "Snare", octave: -1, coarse: 5, tone: 0.6, shape: 0.45, blend: 0.55,
                                             decay: 0.28, level: 0.8 }, { name: "Snare" });
  const metal = p.add("macro-osc", [1, 2], { model: "Metal", tone: 0.75, shape: 0.5, blend: 0.2, decay: 0.05,
                                             level: 0.6 }, { name: "Metal" });
  const blip = p.add("perc-voice", [1, 3], { engine: "FM", pitch: 440, tone: 0.45, morph: 0.6, click: 0.2, decay: 0.12,
                                             sweep: 0.2, level: 0.6 }, { name: "FM Blip" });
  const mix = p.add("audio-mixer", [3, 1], { level2: -1, pan2: -0.05, level3: -5, pan3: 0.25, level4: -6, pan4: -0.35 },
                    { name: "Kit Mixer" });
  p.cable(p.cin, "fill", seq, "fill")
    .cable(seq, "trig1", kick, "trig").cable(seq, "vel1", kick, "accent")
    .cable(seq, "trig2", snare, "trig").cable(seq, "vel2", snare, "accent")
    .cable(seq, "trig3", metal, "trig").cable(seq, "vel3", metal, "accent")
    .cable(seq, "trig4", blip, "trig").cable(seq, "vel4", blip, "accent");
  toMixer(p, kick, mix, 1); toMixer(p, snare, mix, 2); toMixer(p, metal, mix, 3);
  p.stereo(blip, mix, { to: ["in4l", "in4r"] });
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], hat: [metal, "trig"], open: [metal, "trig"], clap: [blip, "trig"] });
  return p;
}

// Rhythm Bank's even rhythms on four Perc Voices, with a room on the send.
function euclidGarden() {
  const p = cell("Euclid Garden", {
    description: "Rhythm Bank's four related even rhythms play a skin, a wood block, a bar and a shaker from Perc Voices, in a small room. Shared input Pattern browses grooves.",
    tags: ["drums", "percussion", "euclidean", "rhythm bank", "organic"],
  help: "Rhythm Bank (even family, trigger output) turns one pattern number into four related rhythms. They " +
         "play four Perc Voices: a modal skin, a modal wood block, an FM bar and a noise shaker. The mixer " +
         "sends a little of each to a small Room reverb.\n\n" +
         "Run the transport and patch Out L/R. The shared Pattern input, at half strength, picks the groove: " +
         "turn a knob or step a sequencer into it.\n\n" +
         "Tip: change Pattern only now and then; neighbouring numbers give a related feel.",
  }).input("pat", "Pattern").stereoOut();
  const bank = p.add("rhythm-bank", [0, 1], { pattern: 37, family: "Even", output: "Trigger" });
  const skin = p.add("perc-voice", [1, 0], { engine: "Modal", pitch: 72, tone: 0.33, morph: 0.2, decay: 0.5, sweep: 0.35,
                                             click: 0.25 }, { name: "Skin" });
  const wood = p.add("perc-voice", [1, 1], { engine: "Modal", pitch: 640, tone: 0.67, morph: 0.4, decay: 0.12, damp: 0.6,
                                             click: 0.4, level: 0.7 }, { name: "Wood" });
  const bar = p.add("perc-voice", [1, 2], { engine: "FM", pitch: 880, tone: 0.6, morph: 0.35, decay: 0.35, sweep: 0,
                                            level: 0.5 }, { name: "Bar" });
  const shaker = p.add("perc-voice", [1, 3], { engine: "Noise Bank", pitch: 3200, tone: 1, morph: 0.9, decay: 0.06,
                                               click: 0, sweep: 0, level: 0.55 }, { name: "Shaker" });
  const mix = p.add("audio-mixer", [3, 1], { pan1: 0, send1: -24, level2: -2, pan2: -0.4, send2: -12, level3: -4, pan3: 0.4,
                                             send3: -10, level4: -6, pan4: 0.15, send4: -18, return: -6 },
                    { name: "Garden Mixer" });
  const room = p.add("reverb", [3, 2], { size: 0.3, decay: 0.9, damping: 0.5, mix: 1 }, { name: "Room" });
  p.cable(p.cin, "pat", bank, "pattern", 0.5)
    .cable(bank, "out1", skin, "trig").cable(bank, "out2", wood, "trig")
    .cable(bank, "out3", bar, "trig").cable(bank, "out4", shaker, "trig");
  [skin, wood, bar, shaker].forEach((v, i) => p.stereo(v, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] }));
  p.stereo(mix, room, { from: ["sendl", "sendr"] }).stereo(room, mix, { from: ["wetL", "wetR"], to: ["returnl", "returnr"] })
    .stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [skin, "trig"], snare: [wood, "trig"], clap: [bar, "trig"], hat: [shaker, "trig"], open: [shaker, "trig"] });
  return p;
}

// An 808-style electro groove: syncopated kick, claps, cowbell and a zap tom.
function electroPopLock() {
  const p = cell("Electro Pop-Lock", {
    description: "Drum Grid electro: syncopated Punch kick, snare and clap on the backbeat, busy hats, cowbell and a zapping tom; two patterns.",
    tags: ["drums", "electro", "808", "drum grid", "breakdance"],
  help: "A Drum Grid with eight tracks (kick, snare, closed and open hat, clap, cowbell, zap tom, rim) " +
         "triggers Punch drums plus a Ring Cowbell and a Ring Tom bent hard for the zap. Two patterns, Pop and " +
         "Lock, are stored in the grid.\n\n" +
         "Run the transport and patch Out L/R. Switch between Pop and Lock in the Drum Grid; swing is set " +
         "slightly above straight.\n\n" +
         "Tip: use Pop for the verse and Lock for the busier break.",
  }).stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.52 }, {
    data: drumGrid(["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Cowbell", "Zap", "Rim"], [
      pattern("Pop", ["X.....x...X..x..", "....X.......X...", "x.xxx.xxx.xxx.x.", "..............x.",
                      "....x.......x...", "..x....x..x.....", "...........x....", ""]),
      pattern("Lock", ["X.....x...X.x...", "....X.......X..x", "xxx.xxx.xxx.xx..", "...x..........x.",
                       "....x.......x...", "..x.....x.x...x.", "...x.......x...x", ".......x.....x.."]),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 45, decay: 0.9, sweep: 0.35, attack: 0.35, drive: 0.2 });
  const snare = p.add("punch-snare", [1, 1], { tune: 220, snappy: 0.55, decay: 0.2, level: 0.7 });
  const hats = p.add("punch-hats", [1, 2], { closed: 0.035, open: 0.35, crunch: 0.2, level: 0.6 });
  const clap = p.add("punch-clap", [1, 3], { tone: 1200, decay: 0.3, level: 0.7 });
  const bell = p.add("ring-cowbell", [2, 0], { tune: 0, decay: 0.25, level: 0.5 }, { name: "Cowbell" });
  const zap = p.add("ring-tom", [2, 1], { tune: 420, decay: 0.18, bend: 1, noise: 0, level: 0.55 }, { name: "Zap" });
  const rim = p.add("punch-rim", [2, 2], { tune: 3, level: 0.55 });
  const mixA = p.add("audio-mixer", [3, 0], { level2: -2, pan2: -0.05, level3: -3, pan3: 0.2, level4: -2, pan4: 0.08,
                                              limiter: false }, { name: "Drums Mixer" });
  const mixB = p.add("audio-mixer", [3, 2], { level1: -4, pan1: -0.35, level2: -5, pan2: 0.4, level3: -5, pan3: 0.3,
                                              limiter: false }, { name: "Perc Mixer" });
  const master = p.add("audio-mixer", [4, 1], {}, { name: "Master" });
  const hit = (track, v, mix, ch) => {
    p.cable(grid, `gate${track}`, v, "trig").cable(grid, `velocity${track}`, v, "velocity");
    toMixer(p, v, mix, ch);
  };
  hit(1, kick, mixA, 1); hit(2, snare, mixA, 2); hit(5, clap, mixA, 4);
  p.cable(grid, "gate3", hats, "closed").cable(grid, "gate4", hats, "open").cable(grid, "velocity3", hats, "velocity");
  toMixer(p, hats, mixA, 3);
  hit(6, bell, mixB, 1); hit(7, zap, mixB, 2); hit(8, rim, mixB, 3);
  p.stereo(mixA, master, { from: ["outl", "outr"], to: ["in1l", "in1r"] })
    .stereo(mixB, master, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(master, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], clap: [clap, "trig"], hat: [hats, "closed"], open: [hats, "open"],
              bell: [bell, "trig"], tom: [zap, "trig"], rim: [rim, "trig"] });
  return p;
}

// Minimal techno: kick, off-beat hats and a rim that echoes through a synced delay.
function concreteMinimal() {
  const p = cell("Concrete Minimal", {
    description: "Minimal techno on a Drum Grid: a dry Punch kick, off-beat Ring hats and a syncopated rim sent into a tempo-synced dub echo and a dark room.",
    tags: ["drums", "techno", "minimal", "dub", "drum grid", "effects"],
  help: "A Drum Grid plays a Punch kick, Ring hats (closed and open), a Ring rim and a Punch clap. The mixer " +
         "sends mostly the rim, and some clap and hats, into a Zone Delay synced to the transport, then a dark " +
         "Room reverb that returns to the mix.\n\n" +
         "Run the transport and patch Out L/R. Patterns are Floor and Ceiling, picked in the Drum Grid.\n\n" +
         "Tip: turn up the rim's send on the Kit Mixer for a deeper dub wash.",
  }).stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.55, gatelength: 0.2 }, {
    data: drumGrid(["Kick", "Closed Hat", "Open Hat", "Rim", "Clap", "Low Tom", "High Tom", "Perc"], [
      pattern("Floor", ["X...X...X...X...", "..x...x...x...x.", "..............x.", "...x..x....x..x.",
                        "", "", "", ""]),
      pattern("Ceiling", ["X...X...X...X...", "x.x.x.x.x.x.x.x.", "..x...x...x.....", "...x..x..x.x..x.",
                          "............x...", "", "", ""]),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 47, decay: 0.45, sweep: 0.45, attack: 0.6, drive: 0.35 });
  const hats = p.add("ring-hats", [1, 1], { closed: 0.03, open: 0.25, tone: 0.65, level: 0.6 });
  const rim = p.add("ring-rim", [1, 2], { tune: -3, decay: 0.8, level: 0.6 });
  const clap = p.add("punch-clap", [1, 3], { tone: 1000, decay: 0.5, level: 0.5 });
  const mix = p.add("audio-mixer", [3, 1], { level2: -5, pan2: 0.2, send2: -30, level3: -4, pan3: -0.25, send3: -2,
                                             level4: -6, pan4: 0.1, send4: -8, return: -4 }, { name: "Kit Mixer" });
  const echo = p.add("zone-delay", [3, 2], { zone: 3, time: 0.62, feedback: 0.55, tone: -0.35, diffuse: 0.2, mix: 1,
                                             sync: "Transport" }, { name: "Dub Echo" });
  const room = p.add("reverb", [4, 2], { size: 0.55, decay: 1.8, damping: 0.65, tone: -0.3, mix: 0.3 }, { name: "Room" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity")
    .cable(grid, "gate2", hats, "closed").cable(grid, "gate3", hats, "open").cable(grid, "velocity2", hats, "velocity")
    .cable(grid, "gate4", rim, "trig").cable(grid, "velocity4", rim, "velocity")
    .cable(grid, "gate5", clap, "trig").cable(grid, "velocity5", clap, "velocity");
  toMixer(p, kick, mix, 1); toMixer(p, hats, mix, 2); toMixer(p, rim, mix, 3); toMixer(p, clap, mix, 4);
  p.stereo(mix, echo, { from: ["sendl", "sendr"] }).stereo(echo, room).stereo(room, mix, { to: ["returnl", "returnr"] })
    .stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], hat: [hats, "closed"], open: [hats, "open"], rim: [rim, "trig"], clap: [clap, "trig"] });
  return p;
}

// A two-bar break chopped up by Bender: jungle and broken beat.
function breakShredder() {
  const p = cell("Break Shredder", {
    description: "A two-bar breakbeat (kick, ghosted snare, ride) through Bender, which repeats, reverses and reshuffles slices by chance. Shared inputs Chaos and Glitch.",
    tags: ["drums", "jungle", "breakbeat", "glitch", "bender"],
  help: "A Drum Grid plays a two-bar break (Punch kick and snare, ride, closed hats) with a Roller variation. " +
         "The mixed kit then goes through Bender, which repeats, reverses and shuffles 1/16 slices by chance.\n\n" +
         "Run the transport and patch Out L/R. The Chaos input, at half strength, drives Bender's chance of " +
         "mangling a slice. Send a trigger to Glitch to force a glitch on demand.\n\n" +
         "Tip: keep Chaos low and tap Glitch before a bar line.",
  }).input("chaos", "Chaos").input("glitch", "Glitch", "trigger").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.52 }, {
    data: drumGrid(["Kick", "Snare", "Ride", "Closed Hat", "Clap", "Low Tom", "High Tom", "Perc"], [
      pattern("Break", ["X.x.......xx....X.x.......x.....", "....X..x.x..X..x....X..x.x....X.",
                        "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.", "..............x...............xx"], 32),
      pattern("Roller", ["X.........X.....X.x.......x.....", "....X..x.x.xX..x.x..X..x.x..X.xx",
                         "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.", "..x...x...x...x...x...x...x...x."], 32),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 52, decay: 0.35, sweep: 0.55, attack: 0.7, drive: 0.4 });
  const snare = p.add("punch-snare", [1, 1], { tune: 240, tone: 0.6, snappy: 0.7, decay: 0.18 });
  const ride = p.add("punch-cymbal", [1, 2], { voice: "Ride", decay: 1.2, tone: 0.6, crunch: 0.35, level: 0.45 });
  const hats = p.add("punch-hats", [1, 3], { closed: 0.03, crunch: 0.5, level: 0.5 });
  const mix = p.add("audio-mixer", [2, 1], { level2: -1, pan2: -0.05, level3: -6, pan3: 0.3, level4: -6, pan4: -0.3 },
                    { name: "Kit Mixer" });
  const bend = p.add("bender", [3, 1], { chance: 0.22, repeats: 4, bendvar: 0.3, slice: 0.25, corrupt: 0.4,
                                         sync: "1/16", mode: "Shuffle", bendsteps: "Octaves" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity")
    .cable(grid, "gate2", snare, "trig").cable(grid, "velocity2", snare, "velocity")
    .cable(grid, "gate3", ride, "trig").cable(grid, "velocity3", ride, "velocity")
    .cable(grid, "gate4", hats, "closed").cable(grid, "velocity4", hats, "velocity")
    .cable(p.cin, "chaos", bend, "chance", 0.5).cable(p.cin, "glitch", bend, "glitch");
  toMixer(p, kick, mix, 1); toMixer(p, snare, mix, 2); toMixer(p, ride, mix, 3); toMixer(p, hats, mix, 4);
  p.stereo(mix, bend, { from: ["outl", "outr"] }).stereo(bend, p.cout);
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], ride: [ride, "trig"], hat: [hats, "closed"], open: [hats, "closed"] });
  return p;
}

// A swung boom-bap kit, darkened, crushed and hissing like an old sampler.
function dustyTapeKit() {
  const p = cell("Dusty Tape Kit", {
    description: "Lo-fi boom-bap: a lazy swung Ring kit through a saturated ladder low-pass and a light bit crush, over a bed of tape hiss.",
    tags: ["drums", "lo-fi", "hip hop", "boom bap", "dusty"],
  help: "A swung Drum Grid (one 32-step pattern, Nod) plays a Ring kick, snare, closed hats and rim. The mix " +
         "passes a Ladder Tanh low-pass at about 3.8 kHz, then Bender in Crush mode, with pink noise added as " +
         "tape hiss.\n\n" +
         "Run the transport and patch Out L/R. There are no inputs; the sound is shaped inside the cell.\n\n" +
         "Tip: lower the filter cutoff for a muddier sample feel, or raise Bender's mix to crush it harder.",
  }).stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.6, velocity: 0.6 }, {
    data: drumGrid(["Kick", "Snare", "Closed Hat", "Rim", "Clap", "Low Tom", "High Tom", "Perc"], [
      pattern("Nod", ["X.........x.....X.x.......x..x..", "....X.......X.......X.......X..x",
                      "x.x.x.xxx.x.x.x.x.x.x.xxx.x.x.x.", "..............x.......x........."], 32),
    ]),
  });
  const kick = p.add("ring-kick", [1, 0], { tune: 55, decay: 0.5, sweep: 0.25, tone: 0.2, drive: 0.35 });
  const snare = p.add("ring-snare", [1, 1], { tune: 200, tone: 0.4, snappy: 0.45, decay: 0.3 });
  const hats = p.add("ring-hats", [1, 2], { closed: 0.05, tone: 0.3, level: 0.55 });
  const rim = p.add("ring-rim", [1, 3], { voice: "Rim", tune: -2, level: 0.5 });
  const hiss = p.add("noise", [0, 3], { colour: 0.3, level: 1 }, { name: "Tape Hiss" });
  const mix = p.add("audio-mixer", [2, 1], { level2: -1, pan2: 0.05, level3: -5, pan3: 0.25, level4: -3, pan4: -0.3,
                                             return: -40 },
                    { name: "Kit Mixer" });
  const tone = p.add("filter", [3, 1], { cutoff: 3800, resonance: 0.1, drive: 0.35, type: "Ladder Tanh" }, { name: "Dark Tone" });
  const crush = p.add("bender", [4, 1], { chance: 0, corrupt: 0.22, mix: 0.7, mode: "Crush", corruptwhen: "Always" },
                      { name: "Crusher" });
  p.cable(grid, "gate1", kick, "trig").cable(grid, "velocity1", kick, "velocity")
    .cable(grid, "gate2", snare, "trig").cable(grid, "velocity2", snare, "velocity")
    .cable(grid, "gate3", hats, "closed").cable(grid, "velocity3", hats, "velocity")
    .cable(grid, "gate4", rim, "trig").cable(grid, "velocity4", rim, "velocity");
  toMixer(p, kick, mix, 1); toMixer(p, snare, mix, 2); toMixer(p, hats, mix, 3); toMixer(p, rim, mix, 4);
  p.cable(hiss, "pink", mix, "returnl").cable(hiss, "pink", mix, "returnr");  // hiss bed on the return
  p.stereo(mix, tone, { from: ["outl", "outr"] }).stereo(tone, crush).stereo(crush, p.cout);
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], hat: [hats, "closed"], open: [hats, "closed"], rim: [rim, "trig"] });
  return p;
}

// Eight clock divisions of the 16th: interlocking cycles that realign every four bars.
function gearTrain() {
  const p = cell("Gear Train", {
    description: "Rotating Div turns the 16th-note clock into /2 … /7 cycles on kick, hats, conga, clave, cowbell and clap: polyrhythms that realign every four bars. Shared input Rotate.",
    tags: ["drums", "polyrhythm", "rotating divider", "percussion"],
  help: "Rotating Div divides the clock into /2 to /7 cycles, and each cycle plays one sound: punch kick, " +
         "hats, a modal conga, a clave, a cowbell and a clap. The cycles drift against each other and realign " +
         "every four bars.\n\n" +
         "Run the transport and patch Out L/R. The shared Rotate input, at a quarter strength, shifts which " +
         "divisions feed the outputs.\n\n" +
         "Tip: automate Rotate slowly and the polyrhythm keeps changing shape without losing the pulse.",
  }).input("rot", "Rotate").stereoOut();
  const div = p.add("rotating-divider", [0, 1], { set: "Integers", output: "Trigger", realign: "4 bars", sync: "Next Bar" });
  const kick = p.add("punch-kick", [1, 0], { tune: 50, decay: 0.5, drive: 0.25 });
  const hats = p.add("punch-hats", [1, 1], { closed: 0.04, crunch: 0.3, level: 0.5 });
  const conga = p.add("perc-voice", [1, 2], { engine: "Modal", pitch: 190, tone: 0.33, morph: 0.3, decay: 0.3, sweep: 0.2,
                                              level: 0.65 }, { name: "Conga" });
  const clave = p.add("ring-rim", [1, 3], { voice: "Clave", level: 0.5 });
  const bell = p.add("ring-cowbell", [2, 3], { tune: -5, decay: 0.2, level: 0.4 });
  const clap = p.add("ring-clap", [2, 0], { tone: 1500, decay: 0.3, level: 0.5 });
  const mixA = p.add("audio-mixer", [3, 0], { level2: -6, pan2: 0.3, level3: -3, pan3: -0.4, level4: -6, pan4: 0.1,
                                              limiter: false }, { name: "Drums Mixer" });
  const mixB = p.add("audio-mixer", [3, 2], { level1: -4, pan1: 0.45, level2: -7, pan2: -0.15, limiter: false },
                     { name: "Perc Mixer" });
  const master = p.add("audio-mixer", [4, 1], {}, { name: "Master" });
  p.cable(p.cin, "rot", div, "rotate", 0.25)
    .cable(div, "out4", kick, "trig").cable(div, "out2", hats, "closed").cable(div, "out3", conga, "trig")
    .cable(div, "out5", clave, "trig").cable(div, "out7", bell, "trig").cable(div, "out6", clap, "trig");
  toMixer(p, kick, mixA, 1); toMixer(p, hats, mixA, 2); toMixer(p, clap, mixA, 4);
  p.stereo(conga, mixA, { to: ["in3l", "in3r"] });
  toMixer(p, clave, mixB, 1); toMixer(p, bell, mixB, 2);
  p.stereo(mixA, master, { from: ["outl", "outr"], to: ["in1l", "in1r"] })
    .stereo(mixB, master, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(master, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], hat: [hats, "closed"], open: [hats, "closed"], tom: [conga, "trig"], rim: [clave, "trig"],
              bell: [bell, "trig"], clap: [clap, "trig"] });
  return p;
}

export default category("Drum Machines", "Whole kits that play by themselves with the transport: patch Out L/R to the output.", [
  mapWalker, macroFoundry, euclidGarden, electroPopLock, concreteMinimal, breakShredder, dustyTapeKit, gearTrain,
]);
