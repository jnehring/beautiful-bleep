// SPDX-License-Identifier: GPL-3.0-or-later
// Scene Arranger: five demo patches. Each plays by itself with the transport.
import { patch, drumGrid, pattern } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

const oct = (n) => (n > 0 ? "+" : "") + n;
/// Oscillator -> ADSR -> VCA (optional filter), played by a pitch jack and a gate jack: [node, jack] pairs.
function voice(p, at, pitch, gate, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.6, octave: oct(o.octave ?? 0), ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.004, decay: 0.3, sustain: 0, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  if (pitch) p.cable(pitch[0], pitch[1], osc, "pitch", pitch[2] ?? 1);
  p.cable(gate[0], gate[1], env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (o.retrig) p.cable(o.retrig[0], o.retrig[1], env, "retrig");
  if (!o.filter) return { osc, env, amp, out: amp, jack: "l" };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter, jack: "l" };
}
/// Up to eight mono sources into one stereo mix. list: {node, jack, level, pan}.
function bus(p, at, list, master = -3, name = "Mix") {
  const [c, r] = at;
  const mk = (items, col, row, nm, m) => {
    const vals = { master: m };
    items.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -6; vals[`pan${i + 1}`] = x.pan ?? 0; });
    const mx = p.add("audio-mixer", [col, row], vals, { name: nm });
    items.forEach((x, i) => p.cable(x.node, x.jack || "out", mx, `in${i + 1}l`));
    return mx;
  };
  if (list.length <= 4) return mk(list, c, r, name, master);
  const a = mk(list.slice(0, 4), c, r, `${name} A`, 0), b = mk(list.slice(4), c, r + 1, `${name} B`, 0);
  const fin = p.add("audio-mixer", [c + 1, r], { level1: 0, level2: 0, master }, { name });
  p.stereo(a, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(b, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return fin;
}
/// Mono jack to both sides of a stereo input pair.
const both = (p, from, jack, to, l = "l", r = "r") => p.cable(from, jack, to, l).cable(from, jack, to, r);
/// A reverb after a stereo mixer (outl/outr) and then the patch output.
function finish(p, mixer, at, verb = {}) {
  const v = p.add("reverb", at, { size: 0.4, decay: 1.4, mix: 0.15, ...verb });
  p.stereo(mixer, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

const NAMES = ["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Rim", "", ""];
const grid = (rows, len = 16) => rows.map((r) => r.padEnd(len, ".").slice(0, len));

/// A drum grid with kick, snare, hats and a clap, plus the kit and its mix: returns {grid, mix}.
function kit(p, at, patterns, level = -4) {
  const [c, r] = at;
  const g = p.add("drum-grid", [c, r], { velocity: 0.7, gatelength: 0.2 }, { data: drumGrid(NAMES, patterns) });
  const kick = p.add("punch-kick", [c + 1, r], { level: 0.85 });
  const snare = p.add("punch-snare", [c + 1, r + 1], { level: 0.6 });
  const hats = p.add("punch-hats", [c + 1, r + 2], { level: 0.45, closed: 0.035, open: 0.22 });
  const clap = p.add("punch-clap", [c + 1, r + 3], { level: 0.55 });
  p.cable(g, "gate1", kick, "trig").cable(g, "velocity1", kick, "velocity").cable(g, "gate2", snare, "trig").cable(g, "velocity2", snare, "velocity")
    .cable(g, "gate3", hats, "closed").cable(g, "gate4", hats, "open").cable(g, "velocity3", hats, "velocity").cable(g, "gate5", clap, "trig");
  const mix = bus(p, [c + 2, r], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -12, pan: 0.3 }, { node: clap, level: -9, pan: -0.2 }], level, "Drums");
  return { g, mix };
}

const INTRO = pattern("Intro", grid(["X...............", "", "x.x.x.x.x.x.x.x.", ""]));
const GROOVE = pattern("Groove", grid(["X...x...X...x...", "....X.......X...", "x.x.x.x.x.x.x.x.", "..............x."]));
const FILL = pattern("Fill", grid(["X.......X.X.X.XX", "..X...X.X.XXXXXX", "xxxxxxxxxxxxxxxx", "", "..............X."]));
const BREAK = pattern("Break", grid(["X.......", "", "....x...", "", "........X......."]));
const SPARSE = pattern("Sparse", grid(["X.......X.......", "........X.......", "..x...x...x...x.", ""]));

function songForm() {
  const p = patch("Scene Arranger: Song Form", {
    module: "scene-arranger", tempo: 122,
    description: "The Scene output drives the Drum Grid's Pattern input: intro, groove, fill and break are four patterns, played in the order intro, groove x2, fill, groove x2, break by the arranger's play order. Change Repeat or Slot knobs to rewrite the song; the Cycle trigger marks each time round.",
    tags: ["arrangement", "song form", "drums", "patterns"],
  });
  const arr = p.add("scene-arranger", [0, 0], { scenes: 4, steps: 6, length: "1 bar", slot1: 1, slot2: 2, slot3: 3, slot4: 2, slot5: 4, slot6: 2, rep2: 2, rep4: 2 });
  const k = kit(p, [2, 0], [INTRO, GROOVE, FILL, BREAK]);
  p.cable(arr, "scene", k.g, "pattern");
  finish(p, k.mix, [6, 0], { size: 0.3, decay: 1.0, mix: 0.1 });
  return p;
}

function chanceFills() {
  const p = patch("Scene Arranger: Chance Fills", {
    module: "scene-arranger", tempo: 118,
    description: "Scene 2 is the groove and holds on a Chance follow action: each time round there is a one in three chance of jumping to the fill scene, otherwise it plays on. The fill always returns to the groove. Raise Chance 2 for busier fills, or change the Seed for another sequence.",
    tags: ["follow actions", "chance", "fills", "generative"],
  });
  const arr = p.add("scene-arranger", [0, 0], { scenes: 3, steps: 2, length: "1 bar", slot1: 1, slot2: 2, follow2: "Chance", jump2: 3, chance2: 0.33, rep2: 2, follow3: "Jump", jump3: 2, seed: 4 });
  const k = kit(p, [2, 0], [SPARSE, GROOVE, FILL]);
  p.cable(arr, "scene", k.g, "pattern");
  finish(p, k.mix, [6, 0], { size: 0.3, decay: 1.0, mix: 0.1 });
  return p;
}

function laneMixer() {
  const p = patch("Scene Arranger: Lane Arrangement", {
    module: "scene-arranger", tempo: 104,
    description: "Four scenes of four bars bring layers in and out through the lane gates: the pad from the start, the bass from scene 2, the lead from scene 3 and the bells only in scene 4. Edit a lane's From and To to rearrange who plays when.",
    tags: ["lanes", "layers", "arrangement", "ambient"],
  });
  const arr = p.add("scene-arranger", [0, 0], { scenes: 4, steps: 4, length: "4 bars", from1: 1, to1: 4, from2: 2, to2: 4, from3: 3, to3: 4, from4: 4, to4: 4 });
  const layer = (name, at, notes, o, lane) => {
    const m = melody(p, at, notes, o);
    const env = p.add("adsr", [at[0] + 3, at[1]], { attack: 0.6, decay: 0.2, sustain: 1, release: 1.2 }, { name: `${name} Swell` });
    const amp = p.add("vca", [at[0] + 4, at[1]], {}, { name });
    p.cable(arr, lane, env, "gate").cable(m.amp, "l", amp, "l").cable(env, "env", amp, "gain");
    return amp;
  };
  const pad = layer("Pad", [2, 0], [0, "_", "_", "_", 7, "_", "_", "_"], { rate: "1/4", octave: 0, shape: 0.3, env: { attack: 0.05, decay: 0.8, sustain: 0.6, release: 0.6 }, gatelength: 0.95 }, "lane1");
  const bass = layer("Bass", [2, 2], [0, null, 0, null, -5, null, -2, null], { rate: "1/8", octave: -1, shape: 0.9, env: { decay: 0.3, sustain: 0.1 } }, "lane2");
  const lead = layer("Lead", [2, 4], [12, null, 10, 7, null, 12, null, 15, 14, null, 10, null, 7, null, 5, null], { rate: "1/8", octave: 0, shape: 0.6, env: { decay: 0.25, sustain: 0 } }, "lane3");
  const bell = layer("Bells", [2, 6], [19, null, null, 24, null, null, 22, null], { rate: "1/8", octave: 0, shape: 0, env: { decay: 1.2, sustain: 0, release: 1 } }, "lane4");
  const mix = bus(p, [8, 0], [{ node: pad, jack: "l", level: -2 }, { node: bass, jack: "l", level: 0 }, { node: lead, jack: "l", level: -4, pan: 0.2 }, { node: bell, jack: "l", level: -6, pan: -0.3 }], 4, "Layers");
  const v = p.add("reverb", [9, 0], { size: 0.7, decay: 3.5, mix: 0.3 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function randomBells() {
  const p = patch("Scene Arranger: Random Bells", {
    module: "scene-arranger", tempo: 88,
    description: "Six scenes that all follow Random: the arranger wanders between them and each scene's lane fires a trigger into its own bell tone, so the tune is a random walk that repeats exactly while the Seed stays put. Change the Seed for a new walk or the Scene Length for a faster one.",
    tags: ["random", "bells", "generative", "follow actions"],
  });
  const arr = p.add("scene-arranger", [0, 0], { scenes: 6, steps: 1, length: "1 beat", quantize: "Immediate", laneout: "Trigger", seed: 11,
    follow1: "Random", follow2: "Random", follow3: "Random", follow4: "Random", follow5: "Random", follow6: "Random" });
  const tones = [0, 3, 5, 7, 10, 12];
  const vs = tones.map((n, i) => voice(p, [2, i], null, [arr, `lane${i + 1}`], { name: `Bell ${i + 1}`, shape: 0, osc: { coarse: n }, octave: 1,
    env: { attack: 0.003, decay: 1.8, sustain: 0, release: 1.4 } }));
  const mix = bus(p, [5, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: 3, pan: -0.7 + i * 0.28 })), 5, "Bells");
  const v = p.add("reverb", [7, 0], { size: 0.8, decay: 6, mix: 0.4 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function filterStaircase() {
  const p = patch("Scene Arranger: Filter Staircase", {
    module: "scene-arranger", tempo: 110,
    description: "Eight scenes of one bar each, and the linear Scene output climbs a staircase that opens a low-pass filter on the arp; the Cycle trigger plays a clap when the staircase starts again. Change Scenes to shorten the climb or Follow on a scene to Previous to make it zigzag.",
    tags: ["cv", "staircase", "filter", "modulation"],
  });
  const arr = p.add("scene-arranger", [0, 0], { scenes: 8, steps: 8, length: "1 bar", cvmode: "Linear 0-1" });
  const m = melody(p, [2, 0], [0, 7, 12, 7, 3, 10, 15, 10, 0, 7, 12, 7, 5, 12, 17, 12], { rate: "1/16", octave: 0, shape: 0.9, env: { decay: 0.18, sustain: 0.2 } });
  const flt = p.add("filter", [5, 0], { cutoff: 150, resonance: 0.45, type: "Ladder Tanh" });
  p.cable(m.amp, "l", flt, "l").cable(arr, "scene", flt, "cutoff", 1);
  const kick = p.add("punch-kick", [2, 3], { level: 0.8 });
  const clap = p.add("punch-clap", [3, 3], { level: 0.5 });
  const hats = p.add("punch-hats", [4, 3], { level: 0.35, closed: 0.03 });
  const k = p.add("drum-grid", [0, 4], { velocity: 0.7, gatelength: 0.2 }, { data: drumGrid(NAMES, [pattern("Pulse", grid(["X...X...X...X...", "", "..x...x...x...x."]))]) });
  p.cable(k, "gate1", kick, "trig").cable(k, "gate3", hats, "closed").cable(arr, "cycle", clap, "trig");
  const mix = bus(p, [7, 0], [{ node: flt, jack: "l", level: -8, pan: 0.15 }, { node: kick, level: -4 }, { node: clap, level: -9, pan: -0.2 }, { node: hats, level: -14, pan: 0.3 }], 0, "Mix");
  finish(p, mix, [9, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

export default [songForm, chanceFills, laneMixer, randomBells, filterStaircase];
