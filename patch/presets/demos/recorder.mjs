// recorder: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// chans: [{n, l, r?, level (dB), pan}] -> Audio Mixer -> Verb -> Out 1/2.  Returns {mix, verb}.
function finish(p, at, chans, o = {}) {
  const vals = { master: o.master ?? -3 };
  chans.forEach((c, i) => { vals[`level${i + 1}`] = c.level ?? -6; vals[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, vals, { name: "Mix" });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "l", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.22, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return { mix, verb };
}
const drumsOf = (m, level = -8, pan) => ({ n: m, l: "outl", r: "outr", level, pan: pan ?? 0 });

/// A small band: melody + drums on a mixer. Returns {mix, flt, drums, m}.
function band(p, at, o = {}) {
  const m = melody(p, [at[0], at[1]], o.notes || [0, ".", 3, 5, 7, ".", 5, 3, 10, ".", 7, 5, 3, ".", 0, "."], {
    rate: "1/8", root: o.root || "E", scale: "Minor Pentatonic", octave: o.octave ?? 0, shape: o.shape ?? 0.8, gatelength: 0.5,
    env: { decay: 0.25, sustain: 0.1, release: 0.2 },
  });
  const flt = p.add("filter", [at[0] + 3, at[1]], { cutoff: o.cutoff ?? 2400, resonance: 0.25 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  const drums = beat(p, [at[0], at[1] + 3], { style: o.style || "half", level: -8 });
  const mix = p.add("audio-mixer", [at[0] + 4, at[1]], { level1: o.lead ?? 2, level2: o.drum ?? 0, master: o.master ?? 0 }, { name: "Band" });
  p.cable(flt, "l", mix, "in1l").cable(flt, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  return { mix, flt, drums, m };
}
/// A one-lane gate pattern (notes: 0 = hit, "_" = tie, "." = rest).
const gateSeq = (p, at, pat, rate, name, o = {}) => p.add("step-sequencer", at, { length: pat.length, rate, root: "A", scale: "Minor Pentatonic", octave: 0, gatelength: o.gatelength ?? 0.9 }, { data: steps(pat) }, { name });
/// Band -> Recorder (stereo in, Gate from `gate`) -> returns {b, rec}. The Recorder passes the band through.
function recorded(p, at, o = {}) {
  const b = band(p, at, { style: o.style || "half", master: -2 });
  const rec = p.add("recorder", [at[0] + 5, at[1]], { limit: o.limit || "30 s", start: o.start || "On Signal", threshold: -36, preroll: o.preroll ?? 0.25, gatecontrol: o.gatecontrol || "Ignored" });
  p.stereo(b.mix, rec, { from: ["outl", "outr"] });
  return { b, rec };
}

function patternTakes() {
  const p = patch("Recorder: A Take per Phrase", {
    module: "recorder", tempo: 108,
    description: "A gate pattern starts a take at the start of each phrase and ends it when the phrase ends (Gate Input is Starts and Ends); a rim click answers each finished take. Each new take replaces the last one in the Recorder's view. Change Pre-roll to catch the notes before the gate.",
    tags: ["gate", "takes", "starts and ends", "bounce"],
  });
  const gate = gateSeq(p, [0, 6], [0, "_", "_", "_", "_", "_", "_", ".", ".", ".", ".", ".", ".", ".", ".", "."], "1/4", "Take Gate");
  const { rec } = recorded(p, [0, 0], { gatecontrol: "Starts and Ends", preroll: 0.1 });
  p.cable(gate, "gate", rec, "gate");
  const rim = p.add("punch-rim", [6, 1], { level: 0.6 });
  p.cable(rec, "done", rim, "trig");
  finish(p, [7, 0], [{ n: rec, l: "l", r: "r", level: 3 }, { n: rim, l: "out", level: -3, pan: -0.3 }], { vmix: 0.15, master: 3 });
  return p;
}

function recordingBlip() {
  const p = patch("Recorder: Recording Lamp and Whistle", {
    module: "recorder", tempo: 100,
    description: "While a take runs, the Recording gate sounds a steady tone and Progress raises the pitch of a whistle as the take fills toward its 10 s limit. The takes are started by a gate pattern every few bars. Change Length Limit to 30 s and the whistle rises more slowly.",
    tags: ["recording gate", "progress", "feedback", "length limit"],
  });
  const gate = gateSeq(p, [0, 6], [0, "_", "_", "_", "_", "_", "_", "_", "_", "_", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "."], "1/4", "Take Gate");
  const { rec } = recorded(p, [0, 0], { gatecontrol: "Starts and Ends", limit: "10 s", preroll: 0 });
  p.cable(gate, "gate", rec, "gate");
  const lamp = p.add("oscillator", [6, 1], { shape: 0, octave: "+1" }, { name: "Lamp Tone" });
  const env = p.add("adsr", [6, 2], { attack: 0.05, decay: 0.1, sustain: 1, release: 0.3 }, { name: "Lamp Env" });
  const lv = p.add("vca", [7, 1], {}, { name: "Lamp VCA" });
  p.cable(rec, "rec", env, "gate").cable(lamp, "out", lv, "l").cable(env, "env", lv, "gain");
  const wh = p.add("oscillator", [6, 3], { shape: 0, octave: "+2", coarse: 4 }, { name: "Progress Whistle" });
  const wenv = p.add("adsr", [6, 4], { attack: 0.2, decay: 0.1, sustain: 1, release: 0.5 }, { name: "Whistle Env" });
  const wv = p.add("vca", [7, 3], {}, { name: "Whistle VCA" });
  p.cable(rec, "progress", wh, "pitch", 1).cable(rec, "rec", wenv, "gate").cable(wh, "out", wv, "l").cable(wenv, "env", wv, "gain");
  finish(p, [8, 0], [{ n: rec, l: "l", r: "r", level: 3 }, { n: lv, level: -17, pan: -0.3 }, { n: wv, level: -17, pan: 0.3 }], { vmix: 0.15, master: 1 });
  return p;
}

function armedOnSignal() {
  const p = patch("Recorder: Armed, Waiting for Sound", {
    module: "recorder", tempo: 92,
    description: "After a bar of nothing a melody begins and the band joins later. Press Arm and the take starts by itself on the first note, with a half second of pre-roll, and a soft bell marks Done when you press Stop. Raise Signal Level to wait for a louder moment.",
    tags: ["armed", "on signal", "pre-roll", "threshold"],
  });
  const m = melody(p, [0, 0], [".", ".", ".", ".", ".", ".", ".", ".", 0, ".", 3, 5, 7, ".", 5, 3, 10, ".", 7, 5, 3, ".", 0, ".", 0, 3, 5, 7, 10, 7, 5, 3], { rate: "1/8", root: "E", scale: "Minor Pentatonic", octave: 0, shape: 0.7, gatelength: 0.5, env: { decay: 0.3, sustain: 0.2, release: 0.3 } });
  const flt = p.add("filter", [3, 0], { cutoff: 2000, resonance: 0.25 }, { name: "Filter" });
  p.cable(m.amp, "l", flt, "l");
  const rec = p.add("recorder", [4, 0], { limit: "30 s", start: "On Signal", threshold: -40, preroll: 0.5, gatecontrol: "Ignored" });
  p.cable(flt, "l", rec, "l").cable(flt, "l", rec, "r");
  const drums = beat(p, [0, 4], { style: "sparse", level: -8 });
  const bell = p.add("oscillator", [5, 1], { shape: 0, octave: "+2" }, { name: "Done Bell" });
  const env = p.add("adsr", [5, 2], { attack: 0.003, decay: 1.5, sustain: 0, release: 1 }, { name: "Done Env" });
  const bv = p.add("vca", [6, 1], {}, { name: "Done VCA" });
  p.cable(rec, "done", env, "gate").cable(rec, "done", env, "retrig").cable(bell, "out", bv, "l").cable(env, "env", bv, "gain");
  finish(p, [7, 0], [{ n: rec, l: "l", r: "r", level: 1 }, drumsOf(drums, -2), { n: bv, level: -8, pan: 0.3 }], { vmix: 0.25, master: 2 });
  return p;
}

function loopBounce() {
  const p = patch("Recorder: Bounce a Four Bar Loop", {
    module: "recorder", tempo: 112,
    description: "A gate that stays high for four bars records exactly one loop of the band into a take, then a crash rings out when the Done trigger fires. The loop repeats every eight bars with the take replaced each time. Press Show File after the first take to see the WAV.",
    tags: ["bounce", "loop", "done trigger", "crash"],
  });
  const tie = [0]; for (let i = 0; i < 15; i++) tie.push("_");
  const gate = gateSeq(p, [0, 6], [...tie, ...new Array(16).fill(".")], "1/4", "Loop Gate");
  const { rec } = recorded(p, [0, 0], { style: "four", gatecontrol: "Starts and Ends", limit: "30 s", preroll: 0 });
  p.cable(gate, "gate", rec, "gate");
  const crash = p.add("punch-cymbal", [6, 1], { level: 0.6, decay: 3 });
  p.cable(rec, "done", crash, "trig");
  finish(p, [7, 0], [{ n: rec, l: "l", r: "r", level: 3 }, { n: crash, l: "out", level: -12, pan: 0.25 }], { vmix: 0.2, master: 1 });
  return p;
}

function limitSweep() {
  const p = patch("Recorder: Ten Second Sweep", {
    module: "recorder", tempo: 120,
    description: "A pad's filter opens as Progress climbs to the 10 s limit of a gate-started take; at the limit Done fires a kick and the take ends even though the gate is still high. Choose a longer Length Limit and the sweep slows down.",
    tags: ["progress", "length limit", "filter", "sweep"],
  });
  const tie = [0]; for (let i = 0; i < 23; i++) tie.push("_");
  const gate = gateSeq(p, [0, 6], [...tie, ".", ".", ".", ".", ".", ".", ".", "."], "1/4", "Long Gate");
  const mix = p.add("audio-mixer", [2, 0], { level1: -6, level2: -6, level3: -6, master: -2, pan1: -0.5, pan2: 0.5 }, { name: "Pad Mix" });
  [0, 7, 12].forEach((s, i) => {
    const o = p.add("oscillator", [1, i], { shape: 1, coarse: s, fine: (i - 1) * 8, octave: "-1" }, { name: `Pad ${i + 1}` });
    p.cable(o, "out", mix, `in${i + 1}l`).cable(o, "out", mix, `in${i + 1}r`);
  });
  const rec = p.add("recorder", [3, 0], { limit: "10 s", start: "By Hand", preroll: 0, gatecontrol: "Starts and Ends" });
  p.stereo(mix, rec, { from: ["outl", "outr"] }).cable(gate, "gate", rec, "gate");
  const flt = p.add("filter", [4, 0], { cutoff: 200, resonance: 0.35 }, { name: "Progress Filter" });
  p.stereo(rec, flt).cable(rec, "progress", flt, "cutoff", 0.9);
  const kick = p.add("punch-kick", [4, 2], { level: 0.9 });
  p.cable(rec, "done", kick, "trig");
  const drums = beat(p, [0, 8], { style: "sparse", level: -10 });
  finish(p, [6, 0], [{ n: flt, level: -9 }, { n: kick, l: "out", level: -8 }, drumsOf(drums, -8)], { vmix: 0.25, decay: 3.5 });
  return p;
}

export default [patternTakes, recordingBlip, armedOnSignal, loopBounce, limitSweep];
