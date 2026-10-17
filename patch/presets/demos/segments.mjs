// SPDX-License-Identifier: MIT
// Segments: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Per-segment node data: defs[i] = {type: "ramp"|"step"|"hold", loop, wait: "time"|"gate"|"trigger"}.
function segData(defs) {
  const segments = [];
  for (let i = 0; i < 8; i++) {
    const d = defs[i] || {};
    segments.push({ type: d.type || "ramp", loop: !!d.loop, wait: d.wait || "time", segIn: "advance", sync: "1/4" });
  }
  return { segments };
}

/// Mono source → trim → reverb → Out.
function finish(p, at, src, jack = "l", trim = 0, verb = {}) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master: 0 }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.5, damping: 0.5, mix: 0.25, quality: "Eco (8 lines)", ...verb });
  p.cable(src, jack, t, "in1l").cable(src, jack, t, "in1r").stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function drawn() {
  const p = patch("Segments: Two-Humped Envelope", {
    module: "segments", tempo: 88,
    description: "Five segments draw an envelope no ADSR can: a quick rise, a dip, a second slower swell and a long fade, and every note of the tune follows that shape. Change a segment's Level or Time and hear the hump move.",
    tags: ["envelope", "custom shape", "swell", "melody"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "G", scale: "Major Pentatonic", octave: 0, gatelength: 0.9 },
    { data: steps([0, 4, 7, "_", 9, 7, 4, "_"]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0.55 });
  const seg = p.add("segments", [1, 1], {
    count: 5, time1: 0.01, level1: 1, shape1: 0, time2: 0.12, level2: 0.25, shape2: 0.4, time3: 0.25, level3: 0.8, shape3: -0.2,
    time4: 0.5, level4: 0.35, shape4: 0.3, time5: 0.6, level5: 0, shape5: 0.5,
  }, { data: segData([]) });
  const f = p.add("filter", [2, 0], { cutoff: 1800, resonance: 0.15, type: "SVF Multimode" });
  const vca = p.add("vca", [3, 0], {});
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", seg, "gate").cable(osc, "out", f, "l").cable(f, "l", vca, "l")
    .cable(seg, "out", vca, "gain").cable(seg, "out", f, "cutoff", 0.3);
  finish(p, [4, 0], vca, "l", -3, { decay: 3 });
  return p;
}

function loopLfo() {
  const p = patch("Segments: Looping Filter Shape", {
    module: "segments", tempo: 100,
    description: "Set to run freely, the chain of four segments repeats like an LFO with a shape you choose: a fast ramp up, a step, a hold and a slide back. It sweeps the filter on a plucked arpeggio; stretch Time Scale or change the Shape knobs to reshape the sweep.",
    tags: ["lfo", "loop", "free run", "filter sweep"],
  });
  const m = melody(p, [0, 0], [0, 7, 12, 7, 3, 10, 15, 10], { rate: "1/8", shape: 0.9, root: "E", scale: "Natural Minor", gatelength: 0.5,
    env: { attack: 0.003, decay: 0.2, sustain: 0.3, release: 0.15 } });
  const seg = p.add("segments", [1, 2], {
    count: 4, run: "Free", time1: 0.3, level1: 0.9, shape1: -0.5, time2: 0.05, level2: 0.15, shape2: 0, time3: 0.35, level3: 0.15, shape3: 0,
    time4: 0.9, level4: 0, shape4: 0.6, timescale: 1,
  }, { data: segData([{ loop: true }, { loop: true }, { loop: true }, { loop: true }]) });
  const f = p.add("filter", [3, 0], { cutoff: 350, resonance: 0.4, type: "Ladder Tanh" });
  p.cable(m.amp, "l", f, "l").cable(seg, "out", f, "cutoff", 0.6);
  finish(p, [4, 0], f, "l", 6, { decay: 2 });
  return p;
}

function ball() {
  const p = patch("Segments: Bouncing Ball", {
    module: "segments", tempo: 90,
    description: "Eight segments alternate between a tiny rise and a fall to zero, each bounce shorter and quieter than the last, so one gate rings out as a dropped ball. Move the Level of a segment to change how high it bounces.",
    tags: ["bounce", "eight segments", "decay", "percussive"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/2", root: "C", scale: "Major Pentatonic", octave: 0, gatelength: 1 },
    { data: steps([0, ".", 7, ".", 4, ".", 9, "."]) });
  const osc = p.add("oscillator", [1, 0], { shape: 0, octave: "+1" });
  const seg = p.add("segments", [1, 1], {
    count: 8, time1: 0.004, level1: 1, shape1: 0, time2: 0.2, level2: 0, shape2: 0.5, time3: 0.004, level3: 0.7, shape3: 0, time4: 0.15, level4: 0, shape4: 0.5,
    time5: 0.004, level5: 0.45, shape5: 0, time6: 0.1, level6: 0, shape6: 0.5, time7: 0.004, level7: 0.25, shape7: 0, time8: 0.07, level8: 0, shape8: 0.5,
  }, { data: segData([]) });
  const vca = p.add("vca", [2, 0], {});
  p.cable(seq, "pitch", osc, "pitch").cable(seq, "gate", seg, "gate").cable(osc, "out", vca, "l").cable(seg, "out", vca, "gain");
  finish(p, [3, 0], vca, "l", 6, { size: 0.6, decay: 3.5, mix: 0.3 });
  return p;
}

function gates() {
  const p = patch("Segments: Segment Gates as Drummer", {
    module: "segments", tempo: 120,
    description: "A free-running chain of four equal segments hands out a gate at each step, and those gates play a kick, hat, snare and hat: the segments are the sequencer. Change a segment's Time to shift the groove, or raise Count to add steps.",
    tags: ["gate outputs", "sequencer", "drums", "rhythm"],
  });
  const seg = p.add("segments", [0, 0], { count: 4, run: "Free", time1: 0.25, time2: 0.25, time3: 0.25, time4: 0.25, level1: 1, level2: 1, level3: 1, level4: 1 },
    { data: segData([{ loop: true }, { loop: true }, { loop: true }, { loop: true }]) });
  const kick = p.add("punch-kick", [1, 0], { level: 0.8 });
  const hats = p.add("punch-hats", [1, 1], { level: 0.5 });
  const snare = p.add("punch-snare", [1, 2], { level: 0.6 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -3, level2: -9, level3: -5, pan2: 0.2, pan3: -0.1, master: -5 });
  p.cable(seg, "seg1", kick, "trig").cable(seg, "seg2", hats, "closed").cable(seg, "seg3", snare, "trig").cable(seg, "seg4", hats, "open")
    .cable(kick, "out", mix, "in1l").cable(kick, "out", mix, "in1r").cable(hats, "out", mix, "in2l").cable(hats, "out", mix, "in2r")
    .cable(snare, "out", mix, "in3l").cable(snare, "out", mix, "in3r");
  const m = melody(p, [0, 4], [0, 3, 7, 10, 7, 3, 5, 7], { rate: "1/8", shape: 0.5, root: "D", scale: "Dorian", octave: 0, gatelength: 0.4,
    env: { decay: 0.2, sustain: 0, release: 0.15 } });
  p.cable(m.amp, "l", mix, "in4l").cable(m.amp, "l", mix, "in4r");
  const v = p.add("reverb", [3, 0], { size: 0.4, decay: 1.8, mix: 0.2, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function inverse() {
  const p = patch("Segments: Swell and Breath", {
    module: "segments", tempo: 70,
    description: "One three-segment shape (rise, hold while the key is down, fall) opens the filter on a pad while its inverted output fades a noise wash down, so the sound turns from airy to tonal and back with every chord. Try Release set to Jump to cut the swell short when the chord ends.",
    tags: ["inverted output", "pad", "noise", "swell"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 4, rate: "1/1", root: "A", scale: "Natural Minor", octave: -1, gatelength: 0.5 },
    { data: steps([0, 5, 3, 7]) });
  const o1 = p.add("oscillator", [1, 0], { shape: 0.8, fine: -6 });
  const o2 = p.add("oscillator", [1, 1], { shape: 0.8, fine: 6, coarse: 7 });
  const mix = p.add("audio-mixer", [2, 0], { level1: -8, level2: -12, master: 0 });
  const f = p.add("filter", [3, 0], { cutoff: 500, resonance: 0.2, type: "SVF Multimode" });
  const seg = p.add("segments", [1, 2], {
    count: 3, release: "Finish", time1: 1.2, level1: 1, shape1: -0.3, time2: 1, level2: 1, shape2: 0, time3: 1.8, level3: 0, shape3: 0.4,
  }, { data: segData([{}, { type: "hold", wait: "gate" }, {}]) });
  const noise = p.add("noise", [2, 2], { colour: 0.2, level: 0.5 });
  const nvca = p.add("vca", [3, 2], {});
  const nf = p.add("filter", [4, 2], { cutoff: 3500, type: "SVF Multimode" });
  const out = p.add("audio-mixer", [5, 0], { level1: 0, level2: -14, master: 4 });
  p.cable(seq, "pitch", o1, "pitch").cable(seq, "pitch", o2, "pitch").cable(o1, "out", mix, "in1l").cable(o1, "out", mix, "in1r")
    .cable(o2, "out", mix, "in2l").cable(o2, "out", mix, "in2r").stereo(mix, f, { from: ["outl", "outr"] })
    .cable(seq, "gate", seg, "gate").cable(seg, "out", f, "cutoff", 0.5)
    .cable(noise, "out", nf, "l").cable(nf, "l", nvca, "l").cable(seg, "inv", nvca, "gain", 0.5).cable(seg, "out", nvca, "gain", 0.0)
    .stereo(f, out, { to: ["in1l", "in1r"] }).cable(nvca, "l", out, "in2l").cable(nvca, "l", out, "in2r");
  const v = p.add("reverb", [6, 0], { size: 0.7, decay: 5, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(out, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

export default [drawn, loopLfo, ball, gates, inverse];
