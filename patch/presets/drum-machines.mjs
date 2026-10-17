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

/// A 32-character track from a sparse map of step index → character.
const at32 = (marks) => {
  const a = Array(32).fill(".");
  for (const [i, c] of Object.entries(marks)) a[+i] = c;
  return a.join("");
};

/// A mixer channel list: each item is [voice, level dB, pan, send dB?]. Mono drum voices feed both sides from L; stereo
/// ones (Perc Voice) use L and R.
function bus(p, at, name, items, extra = {}) {
  const vals = { limiter: false, ...extra };
  items.forEach(([, level, pan, send], i) => {
    vals[`level${i + 1}`] = level;
    vals[`pan${i + 1}`] = pan;
    if (send !== undefined) vals[`send${i + 1}`] = send;
  });
  const mix = p.add("audio-mixer", at, vals, { name });
  items.forEach(([v], i) => {
    if (v.type === "perc-voice") p.stereo(v, mix, { to: [`in${i + 1}l`, `in${i + 1}r`] });
    else p.cable(v, "out", mix, `in${i + 1}l`);
  });
  return mix;
}

/// Sums mixers into a master mixer.
function master(p, at, mixers, vals = {}) {
  const m = p.add("audio-mixer", at, vals, { name: "Master" });
  mixers.forEach((mx, i) => p.stereo(mx, m, { from: ["outl", "outr"], to: [`in${i + 1}l`, `in${i + 1}r`] }));
  return m;
}

/// A Drum Grid track's gate and velocity into a drum voice.
const hit = (p, grid, track, voice, jack = "trig") => {
  p.cable(grid, `gate${track}`, voice, jack).cable(grid, `velocity${track}`, voice, "velocity");
};

/// A Gate Sequencer track's trigger and velocity into a drum voice.
const seqHit = (p, seq, track, voice, jack = "trig", vel = "velocity") => {
  p.cable(seq, `trig${track}`, voice, jack).cable(seq, `vel${track}`, voice, vel);
};

// ------------------------------------------------------------ presets

// Straight house: four on the floor, clap, off-beat open hat, shaker, a glue saturator.
function warehouseHouse() {
  const p = cell("Warehouse House", {
    description: "Four-on-the-floor house on a Drum Grid: round kick, backbeat clap, off-beat open hats, a busy shaker and a little tape-like glue; two patterns, Groove and Peak.",
    tags: ["drums", "house", "four on the floor", "drum grid", "club"],
    help: "A Drum Grid plays a Punch Kick on every beat, a Punch Clap on beats 2 and 4, Ring Hats (closed 16ths and " +
      "open off-beats) and a Perc Voice shaker made from a noise bank. Two patterns are stored: Groove for the " +
      "verse and Peak, which adds clap and shaker fills. The mix goes through a Saturator that glues it together.\n\n" +
      "Run the transport and patch Out L/R. The shared Glue input drives the Saturator harder, so a knob or an " +
      "envelope there makes the whole kit warmer and fatter.\n\n" +
      "Tip: switch the Drum Grid to Peak for the last bar of a phrase and back to Groove after.",
  }).input("glue", "Glue").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.53, gatelength: 0.2 }, {
    data: drumGrid(["Kick", "Clap", "Closed Hat", "Open Hat", "Shaker", "", "", ""], [
      pattern("Groove", ["X...X...X...X...", "....x.......x...", "x.x.x.x.x.x.x.x.", "..x...x...x...x.", "xoxoxoxoxoxoxoxo", "", "", ""]),
      pattern("Peak", ["X...X...X...X..x", "....x.......x.xx", "xxx.xxx.xxx.xxx.", "..x...x...x...x.", "xxxxxxxxxxxxxxxx", "", "", ""]),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 50, decay: 0.55, sweep: 0.4, attack: 0.5, drive: 0.15 });
  const clap = p.add("punch-clap", [1, 1], { tone: 1100, decay: 0.28, level: 0.7 });
  const hats = p.add("ring-hats", [1, 2], { closed: 0.035, open: 0.3, tone: 0.55, level: 0.55 });
  const shaker = p.add("perc-voice", [1, 3], { engine: "Noise Bank", pitch: 3900, tone: 1, morph: 0.8, decay: 0.05, click: 0,
    sweep: 0, level: 0.4 }, { name: "Shaker" });
  const mix = bus(p, [2, 1], "Kit Mixer", [[kick, -1, 0], [clap, -4, 0.1], [hats, -7, -0.25], [shaker, -9, 0.3]]);
  const glue = p.add("saturator", [3, 1], { drive: 0.3, sag: 0.4, age: 0, tone: 12000, character: "Tape", mix: 0.8 }, { name: "Glue" });
  hit(p, grid, 1, kick); hit(p, grid, 2, clap);
  p.cable(grid, "gate3", hats, "closed").cable(grid, "gate4", hats, "open").cable(grid, "velocity3", hats, "velocity");
  p.cable(grid, "gate5", shaker, "trig").cable(grid, "velocity5", shaker, "accent");
  p.cable(p.cin, "glue", glue, "drive", 0.5);
  p.stereo(mix, glue, { from: ["outl", "outr"] }).stereo(glue, p.cout);
  p.gmDrums({ kick: [kick, "trig"], clap: [clap, "trig"], snare: [clap, "trig"], hat: [hats, "closed"], open: [hats, "open"] });
  return p;
}

// Reggae one-drop: kick and rim together on beat three, into a transport-synced echo.
function oneDropEcho() {
  const p = cell("One Drop Echo", {
    description: "A reggae one-drop on a Drum Grid: kick and rim land together on beat three, hats skank on the off-beats, and the rim and tom ride a tempo-synced echo and a spring-like room. Shared input Echo Feedback.",
    tags: ["drums", "reggae", "dub", "one drop", "echo"],
    help: "A Drum Grid plays a Ring Kick and Ring Rim together on the third beat (the one-drop), Ring Hats on the " +
      "off-beats and a Ring Tom for fills. The Kit Mixer sends the rim and the tom into a Zone Delay locked to " +
      "the transport, followed by a short, dark reverb that comes back into the mix. Patterns are Drop and Steppers, " +
      "the latter with a kick on every beat.\n\n" +
      "Run the transport and patch Out L/R. The Echo Feedback input is added to the echo's feedback: turn it up " +
      "for repeats that stack up and wash.\n\n" +
      "Tip: ride the Echo Feedback input at the end of a bar for a classic dub throw.",
  }).input("fb", "Echo Feedback").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.56, gatelength: 0.2 }, {
    data: drumGrid(["Kick", "Rim", "Closed Hat", "Open Hat", "Tom", "", "", ""], [
      pattern("Drop", ["........X.......", "........x......x", "..x...x...x...x.", "..............x.", "..............x.", "", "", ""]),
      pattern("Steppers", ["X...X...X...X...", "........x.......", "..x...x...x...x.", "..x...........x.", "...........x..x.", "", "", ""]),
    ]),
  });
  const kick = p.add("ring-kick", [1, 0], { tune: 52, decay: 0.6, sweep: 0.2, tone: 0.3, drive: 0.1 });
  const rim = p.add("ring-rim", [1, 1], { voice: "Rim", tune: -2, decay: 0.8, level: 0.7 });
  const hats = p.add("ring-hats", [1, 2], { closed: 0.04, open: 0.22, tone: 0.45, level: 0.5 });
  const tom = p.add("ring-tom", [1, 3], { tune: 120, decay: 0.5, bend: 0.2, noise: 0.15, level: 0.7 });
  const mix = bus(p, [2, 1], "Kit Mixer", [[kick, -1, 0], [rim, -4, 0.2, -5], [hats, -8, -0.3, -20], [tom, -6, 0.35, -6]],
    { return: -3 });
  const echo = p.add("zone-delay", [3, 2], { zone: 3, time: 0.6, feedback: 0.5, tone: -0.4, diffuse: 0.15, mix: 1, sync: "Transport" },
    { name: "Dub Echo" });
  const room = p.add("reverb", [4, 2], { size: 0.35, decay: 1.2, damping: 0.7, tone: -0.35, mix: 0.25 }, { name: "Room" });
  hit(p, grid, 1, kick); hit(p, grid, 2, rim); hit(p, grid, 5, tom);
  p.cable(grid, "gate3", hats, "closed").cable(grid, "gate4", hats, "open").cable(grid, "velocity3", hats, "velocity");
  p.cable(p.cin, "fb", echo, "feedback", 0.35);
  p.stereo(mix, echo, { from: ["sendl", "sendr"] }).stereo(echo, room).stereo(room, mix, { to: ["returnl", "returnr"] })
    .stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], rim: [rim, "trig"], snare: [rim, "trig"], hat: [hats, "closed"], open: [hats, "open"], tom: [tom, "trig"] });
  return p;
}

// Two bars of half-time trap: a long sub kick, claps, ratcheted hats from a Gate Sequencer.
function trapRollCall() {
  const p = cell("Trap Roll Call", {
    description: "Half-time trap on a Gate Sequencer: a long sub kick, claps on beat three, rolling ratcheted hats and a coin-flip open hat. Shared inputs Sub Tune and Fill.",
    tags: ["drums", "trap", "808", "gate sequencer", "hi-hat rolls"],
    help: "A two-bar Gate Sequencer plays a Punch Kick with a long decay (the sub), a Punch Clap on the half-time " +
      "backbeat, a Ring Hats voice whose steps are ratcheted into 2 and 3 fast hits for the rolls, and an open " +
      "hat that fires by chance. Some steps only play while Fill is held.\n\n" +
      "Run the transport and patch Out L/R. Sub Tune, at half strength, moves the kick's tune up and down; Fill " +
      "is a gate: while it is high, the extra steps marked as fill-only play too.\n\n" +
      "Tip: tap Fill in the last beat of every second bar for a busier turnaround.",
  }).input("tune", "Sub Tune").input("fill", "Fill", "gate").stereoOut();
  const seq = p.add("gate-sequencer", [0, 1], { swing: 0.5, ratchetdecay: 0.35 }, {
    data: gateTracks([
      at32({ 0: "X", 7: "x", 10: "x", 16: "X", 19: "?", 23: "x", 26: "x", 30: "!" }),
      at32({ 8: "X", 24: "X", 15: "?", 31: "!" }),
      "x.o.x.o.x.o.3.2.x.o.x.o.x.3.3x3x",
      at32({ 6: "x", 14: "?", 22: "x", 29: "!" }),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 42, decay: 1.6, sweep: 0.25, attack: 0.2, drive: 0.3 }, { name: "Sub Kick" });
  const clap = p.add("punch-clap", [1, 1], { tone: 1500, decay: 0.35, level: 0.7 });
  const hats = p.add("ring-hats", [1, 2], { closed: 0.03, open: 0.25, tone: 0.7, level: 0.5 });
  const mix = bus(p, [2, 1], "Kit Mixer", [[kick, -3, 0], [clap, -4, 0.1], [hats, -8, -0.3]]);
  p.cable(p.cin, "fill", seq, "fill").cable(p.cin, "tune", kick, "tune", 0.5);
  seqHit(p, seq, 1, kick); seqHit(p, seq, 2, clap);
  p.cable(seq, "trig3", hats, "closed").cable(seq, "vel3", hats, "velocity")
    .cable(seq, "trig4", hats, "open");
  p.stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], clap: [clap, "trig"], snare: [clap, "trig"], hat: [hats, "closed"], open: [hats, "open"] });
  return p;
}

// Bossa nova / samba: clave, soft kick, shaker, surdo, in a small room.
function bossaClaveBox() {
  const p = cell("Bossa Clave Box", {
    description: "A gentle Brazilian bossa on a Drum Grid: clave, a soft two-note kick, a pulsing shaker, cross-stick and a low surdo, in a small wooden room; patterns Bossa and Samba.",
    tags: ["drums", "bossa nova", "latin", "percussion", "gentle"],
    help: "A Drum Grid with a Ring Rim playing the clave, a Ring Rim in cross-stick voice, a soft Ring Kick, a Perc Voice " +
      "shaker (noise bank) and a Perc Voice surdo (modal skin). The Kit Mixer sends a little of everything to a small " +
      "Room reverb. Patterns: Bossa (the classic clave) and Samba, which is busier and louder.\n\n" +
      "Run the transport and patch Out L/R. Room adds to the reverb's mix: turn it up for a bigger, softer space.\n\n" +
      "Tip: keep the transport slow, around 120 BPM, and pair the cell with a gentle electric piano.",
  }).input("room", "Room").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.51, velocity: 0.6 }, {
    data: drumGrid(["Clave", "Cross-stick", "Kick", "Shaker", "Surdo", "", "", ""], [
      pattern("Bossa", ["x..x..x...x..x..", "..x...x...x...x.", "x..x..x.x..x..x.", "xoxoxoxoxoxoxoxo", "x.....x.x.....x.", "", "", ""]),
      pattern("Samba", ["x..x..x...x..x..", "..x..x..x..x..x.", "x..xx..xx..xx..x", "xxxxxxxxxxxxxxxx", "x..x..x.x..x..x.", "", "", ""]),
    ]),
  });
  const clave = p.add("ring-rim", [1, 0], { voice: "Clave", tune: 2, decay: 0.8, level: 0.7 }, { name: "Clave" });
  const stick = p.add("ring-rim", [1, 1], { voice: "Rim", tune: -3, decay: 0.7, level: 0.55 }, { name: "Cross-stick" });
  const kick = p.add("ring-kick", [1, 2], { tune: 60, decay: 0.35, sweep: 0.2, tone: 0.2, drive: 0 });
  const shaker = p.add("perc-voice", [1, 3], { engine: "Noise Bank", pitch: 3800, tone: 1, morph: 0.7, decay: 0.07, click: 0,
    sweep: 0, level: 0.45 }, { name: "Shaker" });
  const surdo = p.add("perc-voice", [2, 0], { engine: "Modal", pitch: 80, tone: 0.3, morph: 0.2, decay: 0.6, damp: 0.5, sweep: 0.3,
    click: 0.15, level: 0.7 }, { name: "Surdo" });
  const mixA = bus(p, [3, 0], "Drums Mixer", [[clave, -3, -0.3, -18], [stick, -4, 0.3, -12], [kick, -3, 0, -30], [shaker, -9, 0.35, -16]],
    { return: -4 });
  const mixB = bus(p, [3, 2], "Low Mixer", [[surdo, -3, -0.1, -20]]);
  const mst = master(p, [4, 1], [mixA, mixB]);
  const room = p.add("reverb", [4, 2], { size: 0.3, decay: 0.8, damping: 0.55, mix: 1 }, { name: "Room" });
  hit(p, grid, 1, clave); hit(p, grid, 2, stick); hit(p, grid, 3, kick);
  p.cable(grid, "gate4", shaker, "trig").cable(grid, "velocity4", shaker, "accent");
  p.cable(grid, "gate5", surdo, "trig").cable(grid, "velocity5", surdo, "accent");
  p.stereo(mixA, room, { from: ["sendl", "sendr"] }).stereo(room, mixA, { from: ["wetL", "wetR"], to: ["returnl", "returnr"] });
  p.cable(p.cin, "room", room, "mix", 0.3);
  p.stereo(mst, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], snare: [stick, "trig"], rim: [clave, "trig"], hat: [shaker, "trig"], open: [shaker, "trig"], tom: [surdo, "trig"] });
  return p;
}

// Cold industrial: hot kick, tight snare, metal clanks, bit-crushed and compressed.
function foundryClank() {
  const p = cell("Foundry Clank", {
    description: "Cold industrial on a two-bar Drum Grid: a hot, short kick, a tight snare, metal clanks and a bent tom, all crushed and compressed. Shared input Grit.",
    tags: ["drums", "industrial", "ebm", "distorted", "metal"],
    help: "A Drum Grid with a Punch Kick (hot drive, short decay), a Punch Snare, a Ring Cymbal tuned and shortened to " +
      "a clank, and a Ring Tom bent hard for the metal-hit sound. The mix goes through a Crunch (drive and bit " +
      "reduction) and a Compressor that pumps against the kick.\n\n" +
      "Run the transport and patch Out L/R. The Grit input, at half strength, adds Crunch drive: raise it and the " +
      "kit turns from hard to broken.\n\n" +
      "Tip: automate Grit slowly over eight bars and bring the drums in and out of focus.",
  }).input("grit", "Grit").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.5, gatelength: 0.15 }, {
    data: drumGrid(["Kick", "Snare", "Clank", "Tom", "", "", "", ""], [
      pattern("Pound", ["X...X...X..xX...X...X...X.x.X.xX", "............X...........X.......", "x.x.x.x.x.x.x.x.x.x.x.x.x.x.xx.x", "......x...............x.x.......x.",
                        "", "", "", ""], 32),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 56, decay: 0.28, sweep: 0.6, attack: 0.8, drive: 0.7 });
  const snare = p.add("punch-snare", [1, 1], { tune: 260, tone: 0.7, snappy: 0.8, decay: 0.12, level: 0.75 });
  const clank = p.add("ring-cymbal", [1, 2], { tune: 4, decay: 0.3, tone: 0.9, level: 0.5 }, { name: "Clank" });
  const tom = p.add("ring-tom", [1, 3], { tune: 210, decay: 0.2, bend: 0.9, noise: 0.5, level: 0.7 }, { name: "Metal Tom" });
  const mix = bus(p, [2, 1], "Kit Mixer", [[kick, -2, 0], [snare, -4, 0.1], [clank, -9, -0.35], [tom, -6, 0.3]]);
  const crush = p.add("crunch", [3, 1], { drive: 0.45, bits: 10, rate: 0.12, tone: 9000, level: 0.8, mix: 0.85 }, { name: "Crunch" });
  const comp = p.add("compressor", [4, 1], { threshold: -14, ratio: 4, attack: 8, release: 120, makeup: 3 }, { name: "Pump" });
  hit(p, grid, 1, kick); hit(p, grid, 2, snare); hit(p, grid, 3, clank); hit(p, grid, 4, tom);
  p.cable(p.cin, "grit", crush, "drive", 0.5);
  p.stereo(mix, crush, { from: ["outl", "outr"] }).stereo(crush, comp).stereo(comp, p.cout);
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], hat: [clank, "trig"], open: [clank, "trig"], tom: [tom, "trig"] });
  return p;
}

// Drum and bass two-step with a filter sweep input.
function neuroTwoStep() {
  const p = cell("Neuro Two-Step", {
    description: "A fast two-step drum and bass kit on a Drum Grid: tight kick, cracking snare with ghost notes, skittering hats and a ride, through a sweepable low-pass. Shared input Filter.",
    tags: ["drums", "drum and bass", "two-step", "fast", "drum grid"],
    help: "A Drum Grid at 1/16 steps plays a Punch Kick on the one and the 'and of three', a Punch Snare on two and " +
      "four with ghost notes between, Punch Hats and a Punch Cymbal in Ride voice. Patterns: Two-Step and Roller, " +
      "the second with a busier kick and snare. A Multi Filter low-pass closes down the whole mix.\n\n" +
      "Run the transport (it sounds right at about 170 BPM) and patch Out L/R. The Filter input pushes the " +
      "low-pass down from fully open: patch an LFO or a slow envelope to build and release a break.\n\n" +
      "Tip: use Roller for the second half of a phrase and sweep Filter shut over the final bar.",
  }).input("filt", "Filter").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.52, gatelength: 0.15 }, {
    data: drumGrid(["Kick", "Snare", "Closed Hat", "Ride", "", "", "", ""], [
      pattern("Two-Step", ["X.........x.....", "....X..o....X..o", "x.xxx.xxx.xxx.xx", "x...x...x...x...", "", "", "", ""]),
      pattern("Roller", ["X.x.......x..x..", "....X.o.o...X.oo", "xxxxxxxxxxxxxxxx", "..x...x...x...x.", "", "", "", ""]),
    ]),
  });
  const kick = p.add("punch-kick", [1, 0], { tune: 54, decay: 0.25, sweep: 0.5, attack: 0.7, drive: 0.35 });
  const snare = p.add("punch-snare", [1, 1], { tune: 250, tone: 0.65, snappy: 0.75, decay: 0.16 });
  const hats = p.add("punch-hats", [1, 2], { closed: 0.025, crunch: 0.4, level: 0.5 });
  const ride = p.add("punch-cymbal", [1, 3], { voice: "Ride", decay: 1.4, tone: 0.65, crunch: 0.3, level: 0.4 });
  const mix = bus(p, [2, 1], "Kit Mixer", [[kick, -1, 0], [snare, -2, 0.05], [hats, -8, 0.3], [ride, -11, -0.3]]);
  const lp = p.add("filter", [3, 1], { cutoff: 14000, resonance: 0.15, type: "SVF Multimode" }, { name: "Sweep" });
  hit(p, grid, 1, kick); hit(p, grid, 2, snare); hit(p, grid, 4, ride);
  p.cable(grid, "gate3", hats, "closed").cable(grid, "velocity3", hats, "velocity");
  p.cable(p.cin, "filt", lp, "cutoff", -0.6);
  p.stereo(mix, lp, { from: ["outl", "outr"] }).stereo(lp, p.cout);
  p.gmDrums({ kick: [kick, "trig"], snare: [snare, "trig"], hat: [hats, "closed"], open: [hats, "closed"], ride: [ride, "trig"], crash: [ride, "trig"] });
  return p;
}

// 12/8: a twelve-step bar of triplet eighths with the standard bell pattern.
function twelveEightBell() {
  const p = cell("Twelve-Eight Bell", {
    description: "A 12/8 Afro-Cuban groove: a Drum Grid of twelve triplet steps plays the bell pattern, two hand drums, a shaker and a deep kick; patterns Bell A and Bell B.",
    tags: ["drums", "afro-cuban", "12/8", "triplet", "bell pattern"],
    help: "The Drum Grid runs at 1/8 triplets with twelve steps, one bar of four beats in 12/8. A Ring Cowbell plays " +
      "the standard seven-stroke bell pattern, two Ring Toms stand in for a low and a high hand drum, a Perc " +
      "Voice shaker plays the pulse and a Ring Kick marks the main beats. Bell B shifts the pattern and adds a " +
      "clave-like rim.\n\n" +
      "Run the transport and patch Out L/R. The Bell Tone input adds to the cowbell's tone: low is dull and " +
      "woody, high is sharp and metallic.\n\n" +
      "Tip: play a slow bass or a drone against it and let the bell hold the groove.",
  }).input("tone", "Bell Tone").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { rate: "1/8T", swing: 0.5, gatelength: 0.25 }, {
    data: drumGrid(["Bell", "Low Drum", "High Drum", "Shaker", "Kick", "Rim", "", ""], [
      pattern("Bell A", ["X.x.xx.x.x.x", "..x.....x...", "...x.x.....x", "x.xxx.xxx.xx", "X..X..X..X..", "", "", ""], 12),
      pattern("Bell B", ["X.x.xx.x.x.x", "....x.x...x.", "x...x.....x.", "xxxxxxxxxxxx", "X.....X.....", "x..x..x..x.x", "", ""], 12),
    ]),
  });
  const bell = p.add("ring-cowbell", [1, 0], { tune: -2, decay: 0.3, tone: 0.5, level: 0.6 }, { name: "Bell" });
  const low = p.add("ring-tom", [1, 1], { tune: 140, decay: 0.4, bend: 0.15, noise: 0.25, level: 0.75 }, { name: "Low Drum" });
  const high = p.add("ring-tom", [1, 2], { tune: 230, decay: 0.3, bend: 0.15, noise: 0.3, level: 0.7 }, { name: "High Drum" });
  const shaker = p.add("perc-voice", [1, 3], { engine: "Noise Bank", pitch: 3600, tone: 1, morph: 0.75, decay: 0.06, click: 0,
    sweep: 0, level: 0.4 }, { name: "Shaker" });
  const kick = p.add("ring-kick", [2, 0], { tune: 50, decay: 0.45, sweep: 0.25, tone: 0.25, drive: 0.05 });
  const rim = p.add("ring-rim", [2, 1], { voice: "Clave", tune: 1, level: 0.5 });
  const mixA = bus(p, [3, 0], "Perc Mixer", [[bell, -5, -0.35], [low, -3, -0.15], [high, -4, 0.2], [shaker, -9, 0.4]]);
  const mixB = bus(p, [3, 2], "Low Mixer", [[kick, -3, 0], [rim, -7, 0.3]]);
  const mst = master(p, [4, 1], [mixA, mixB]);
  hit(p, grid, 1, bell); hit(p, grid, 2, low); hit(p, grid, 3, high); hit(p, grid, 5, kick); hit(p, grid, 6, rim);
  p.cable(grid, "gate4", shaker, "trig").cable(grid, "velocity4", shaker, "accent");
  p.cable(p.cin, "tone", bell, "tone", 0.4);
  p.stereo(mst, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], rim: [rim, "trig"], snare: [high, "trig"], bell: [bell, "trig"], tom: [low, "trig"], hat: [shaker, "trig"], open: [shaker, "trig"] });
  return p;
}

// Tuned toms in cascades, with a plate-like reverb.
function tribalTomCascade() {
  const p = cell("Tribal Tom Cascade", {
    description: "Four tuned toms tumble down in cascades over a deep kick and a rattling shaker, with a plate-like reverb: a two-bar tribal pattern. Shared inputs Tuning and Wash.",
    tags: ["drums", "toms", "tribal", "cascade", "cinematic"],
    help: "A 32-step Drum Grid plays four Punch Toms (tuned from low to high, bend and noise set for a skin sound), a Ring " +
      "Kick and a Perc Voice shaker. The toms run down in cascades and answer each other across the two bars. The " +
      "mix goes through a reverb with a medium decay.\n\n" +
      "Run the transport and patch Out L/R. Tuning adds to the tune of all four toms together (half strength), Wash " +
      "adds to the reverb mix.\n\n" +
      "Tip: sweep Tuning up a little over eight bars for a rising tension.",
  }).input("tuning", "Tuning").input("wash", "Wash").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { swing: 0.5, gatelength: 0.3 }, {
    data: drumGrid(["Tom 1", "Tom 2", "Tom 3", "Tom 4", "Kick", "Shaker", "", ""], [
      pattern("Cascade", ["X.......x.x.....x.......x...x.x.", "..x.x...........x.x.....x...x..x", "....x.x.x.....x.....x.x.x.....x.",
                           "..........xxx.x...........xxx.x.x", "X.......X.....x.X.......X.......", "x.xxx.xxx.xxx.xxx.xxx.xxx.xxx.xx", "", ""], 32),
    ]),
  });
  const toms = [["High Tom", 330, -0.4], ["Mid Tom", 240, -0.15], ["Low Tom", 170, 0.15], ["Floor Tom", 115, 0.4]].map(([name, tune, pan], i) =>
    p.add("punch-tom", [1, i], { tune, decay: 0.55, bend: 0.4, noise: 0.15, level: 0.8 }, { name }));
  const kick = p.add("ring-kick", [2, 0], { tune: 44, decay: 0.7, sweep: 0.3, tone: 0.3, drive: 0.1 });
  const shaker = p.add("perc-voice", [2, 1], { engine: "Noise Bank", pitch: 3500, tone: 1, morph: 0.7, decay: 0.05, click: 0,
    sweep: 0, level: 0.35 }, { name: "Shaker" });
  const mixA = bus(p, [3, 0], "Toms Mixer", toms.map((t, i) => [t, -3 - i * 0.5, [-0.4, -0.15, 0.15, 0.4][i]]));
  const mixB = bus(p, [3, 2], "Base Mixer", [[kick, -2, 0], [shaker, -10, 0.35]]);
  const mst = master(p, [4, 1], [mixA, mixB]);
  const plate = p.add("reverb", [5, 1], { size: 0.55, decay: 2.2, damping: 0.5, diffusion: 0.85, mix: 0.25 }, { name: "Plate" });
  toms.forEach((t, i) => hit(p, grid, i + 1, t));
  hit(p, grid, 5, kick);
  p.cable(grid, "gate6", shaker, "trig").cable(grid, "velocity6", shaker, "accent");
  toms.forEach((t) => p.cable(p.cin, "tuning", t, "tune", 0.2));
  p.cable(p.cin, "wash", plate, "mix", 0.4);
  p.stereo(mst, plate, { from: ["outl", "outr"] }).stereo(plate, p.cout);
  p.gmDrums({ kick: [kick, "trig"], snare: [toms[1], "trig"], tom: [toms[2], "trig"], hat: [shaker, "trig"], open: [shaker, "trig"] });
  return p;
}

// Micro-percussion: probabilistic clicks and blips through a delay network.
function clicksAndCutsGarden() {
  const p = cell("Clicks & Cuts Garden", {
    description: "Micro-percussion on a Gate Sequencer: tiny clicks, a noise tick and an FM blip, half of them coin flips, scattered through a delay network. Shared inputs Space and Fill.",
    tags: ["drums", "glitch", "microsound", "generative", "idm"],
    help: "A Gate Sequencer plays three Perc Voices: a modal click, a noise tick and an FM blip, plus a small Punch Kick for " +
      "the pulse. Many steps are coin flips and some are ratchets, so the pattern keeps changing in detail but " +
      "stays recognisable. The mix runs into a Delay Net with scattered taps, which turns the clicks into a " +
      "shimmering garden.\n\n" +
      "Run the transport and patch Out L/R. The Space input adds to the delay's mix; Fill is a gate that plays the " +
      "fill-only steps while it is high.\n\n" +
      "Tip: keep Space low for dry clicks, or raise it for an almost ambient wash.",
  }).input("space", "Space").input("fill", "Fill", "gate").stereoOut();
  const seq = p.add("gate-sequencer", [0, 1], { swing: 0.55, ratchetdecay: 0.25 }, {
    data: gateTracks([
      at32({ 0: "x", 6: "?", 11: "x", 19: "?", 26: "x", 28: "!" }),
      at32({ 2: "?", 3: "?", 7: "x", 10: "2", 14: "?", 18: "x", 22: "3", 27: "?", 30: "!" }),
      at32({ 4: "x", 12: "?", 16: "x", 21: "?", 24: "~", 29: "3" }),
      at32({ 0: "X", 16: "x", 23: "?" }),
    ]),
  });
  const click = p.add("perc-voice", [1, 0], { engine: "Modal", pitch: 1400, tone: 0.8, morph: 0.6, decay: 0.04, damp: 0.9, click: 0.7,
    sweep: 0, level: 0.7 }, { name: "Click" });
  const tick = p.add("perc-voice", [1, 1], { engine: "Noise Bank", pitch: 4000, tone: 1, morph: 0.9, decay: 0.02, click: 0,
    sweep: 0, level: 0.5 }, { name: "Tick" });
  const blip = p.add("perc-voice", [1, 2], { engine: "FM", pitch: 780, tone: 0.5, morph: 0.55, decay: 0.09, damp: 0.6, click: 0.2,
    sweep: 0.15, level: 0.5 }, { name: "Blip" });
  const kick = p.add("punch-kick", [1, 3], { tune: 60, decay: 0.2, sweep: 0.3, attack: 0.7, drive: 0.1, level: 0.7 }, { name: "Pulse" });
  const mix = bus(p, [2, 1], "Kit Mixer", [[click, -2, -0.3], [tick, -4, 0.35], [blip, -6, 0.1], [kick, -3, 0]]);
  const net = p.add("delay-network", [3, 1], { time: 0.375, taps: 5, scatter: 0.6, jitter: 0.2, feedback: 0.45, character: 0.3,
    tone: 0.1, width: 0.9, mix: 0.4, routing: "Mesh" }, { name: "Garden" });
  p.cable(p.cin, "fill", seq, "fill").cable(p.cin, "space", net, "mix", 0.4);
  seqHit(p, seq, 1, click, "trig", "accent"); seqHit(p, seq, 2, tick, "trig", "accent"); seqHit(p, seq, 3, blip, "trig", "accent");
  seqHit(p, seq, 4, kick);
  p.stereo(mix, net, { from: ["outl", "outr"] }).stereo(net, p.cout);
  p.gmDrums({ kick: [kick, "trig"], snare: [click, "trig"], rim: [click, "trig"], hat: [tick, "trig"], open: [tick, "trig"], clap: [blip, "trig"] });
  return p;
}

// Swung jazz trio: ride pattern, hat foot, feathered kick and brush ghost notes in 12 triplet steps x 2 bars.
function brushSwingTrio() {
  const p = cell("Brush Swing Trio", {
    description: "A relaxed jazz-trio kit on a Drum Grid of triplets: a skipping ride pattern, foot hats on two and four, a feathered kick and brushed ghost snares, in a warm room.",
    tags: ["drums", "jazz", "swing", "brushes", "acoustic"],
    help: "The Drum Grid runs 24 steps of 1/8 triplets, two bars of 4/4. A Punch Cymbal in Ride voice plays the " +
      "classic skip-beat ride pattern, Ring Hats play the foot on two and four, a soft Ring Kick feathers the " +
      "beats and a Ring Snare with low snap stands for brushes on ghost notes. A Room reverb is mixed in at a " +
      "low level. Patterns: Swing and Comping, the second with more snare answers.\n\n" +
      "Run the transport and patch Out L/R. Room raises the reverb mix; keep it low for a close-miked sound.\n\n" +
      "Tip: play a walking bass or an upright piano over it at 120 to 160 BPM.",
  }).input("room", "Room").stereoOut();
  const grid = p.add("drum-grid", [0, 1], { rate: "1/8T", swing: 0.5, gatelength: 0.3, velocity: 0.55 }, {
    data: drumGrid(["Ride", "Foot Hat", "Kick", "Brush", "", "", "", ""], [
      pattern("Swing", ["X..x.xX..x.xX..x.xX..x.x", "...x.....x.....x.....x..", "x..x..x..x..x..x..x..x..", "..........x.........x.x.", "", "", "", ""], 24),
      pattern("Comping", ["X..x.xX..x.xX..x.xX..x.x", "...x.....x.....x.....x..", "x.....x..x..x.....x..x..", "..x.....x.x...x...x.x.x.", "", "", "", ""], 24),
    ]),
  });
  const ride = p.add("punch-cymbal", [1, 0], { voice: "Ride", decay: 1.1, tone: 0.45, crunch: 0.1, level: 0.5 });
  const foot = p.add("ring-hats", [1, 1], { closed: 0.06, tone: 0.3, level: 0.5 }, { name: "Foot Hat" });
  const kick = p.add("ring-kick", [1, 2], { tune: 62, decay: 0.3, sweep: 0.15, tone: 0.2, drive: 0 });
  const brush = p.add("ring-snare", [1, 3], { tune: 190, tone: 0.3, snappy: 0.35, decay: 0.18, level: 0.5 }, { name: "Brush" });
  const mix = bus(p, [2, 1], "Kit Mixer", [[ride, -4, 0.3, -18], [foot, -8, -0.35, -22], [kick, -5, 0, -26], [brush, -6, -0.1, -14]],
    { return: -3 });
  const room = p.add("reverb", [3, 2], { size: 0.4, decay: 1.0, damping: 0.55, tone: -0.15, mix: 1 }, { name: "Room" });
  hit(p, grid, 1, ride); hit(p, grid, 3, kick); hit(p, grid, 4, brush);
  p.cable(grid, "gate2", foot, "closed").cable(grid, "velocity2", foot, "velocity");
  p.cable(p.cin, "room", mix, "return", 0.15);
  p.stereo(mix, room, { from: ["sendl", "sendr"] }).stereo(room, mix, { from: ["wetL", "wetR"], to: ["returnl", "returnr"] })
    .stereo(mix, p.cout, { from: ["outl", "outr"] });
  p.gmDrums({ kick: [kick, "trig"], snare: [brush, "trig"], ride: [ride, "trig"], crash: [ride, "trig"], hat: [foot, "closed"], open: [foot, "closed"] });
  return p;
}

export default category("Drum Machines", "Whole kits that play by themselves with the transport: patch Out L/R to the output.", [
  warehouseHouse, oneDropEcho, trapRollCall, bossaClaveBox, foundryClank, neuroTwoStep, twelveEightBell, tribalTomCascade,
  clicksAndCutsGarden, brushSwingTrio,
]);
