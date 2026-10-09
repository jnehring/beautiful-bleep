// SPDX-License-Identifier: MIT
// Test Oscillator: five demo patches. Each plays by itself with the transport.
import { patch, steps, drumGrid, pattern } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// Channels → Audio Mixer → Verb → Out 1/2. chans: {n, l (jack), r (optional jack), level, pan}
function finish(p, at, chans, o = {}) {
  const lv = {};
  chans.forEach((c, i) => { lv[`level${i + 1}`] = c.level ?? -6; lv[`pan${i + 1}`] = c.pan ?? 0; });
  const mix = p.add("audio-mixer", at, { ...lv, master: o.master ?? -3 });
  chans.forEach((c, i) => {
    p.cable(c.n, c.l || "out", mix, `in${i + 1}l`);
    if (c.r) p.cable(c.n, c.r, mix, `in${i + 1}r`);
    for (const [n, j] of c.also || []) p.cable(n, j, mix, `in${i + 1}l`);
  });
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: o.size ?? 0.5, decay: o.decay ?? 2.5, damping: 0.5, mix: o.vmix ?? 0.25, quality: "Eco (8 lines)" });
  p.cable(mix, "outl", verb, "l").cable(mix, "outr", verb, "r").stereo(verb, p.out);
  return mix;
}



function drone() {
  const p = patch("Test Oscillator: Living Drone", {
    module: "test-oscillator", tempo: 60,
    description: "Three lamp-stabilised sines tuned to a root, a fifth and an octave, each with a long Settle and plenty of Drift: they warm up from flat, swell and bounce against each other, with a slow wobble on one dial. Try Loop Gain between 100 % and 150 %, or Settle at 0.1 s for faster bounces.",
    tags: ["drone", "drift", "warm-up", "sine"],
  });
  const mk = (at, name, f, extra = {}) => p.add("test-oscillator", at, { range: "×100", freq: f, loopgain: 1.4, settle: 1.1, drift: 0.6, warmup: true, powerup: "On play", level: 0.8, ...extra }, { name });
  const a = mk([0, 0], "Root", 1.1, { seed: 1 });
  const b = mk([0, 1], "Fifth", 1.65, { seed: 2, settle: 0.8 });
  const c = mk([0, 2], "Octave", 2.2, { seed: 3, settle: 1.6, level: 0.5 });
  const lfo = p.add("lfo", [1, 2], { rate: 0.04 }, { name: "Dial Hand" });
  p.cable(lfo, "out", b, "freq", 0.02);
  finish(p, [2, 0], [{ n: a, l: "sine", level: -4, pan: -0.3 }, { n: b, l: "sine", level: -6, pan: 0.3 }, { n: c, l: "square", level: -16, also: [[c, "sine"]] }], { vmix: 0.4, decay: 5, size: 0.8 });
  return p;
}

function drums() {
  const p = patch("Test Oscillator: Ringing Drums", {
    module: "test-oscillator", tempo: 94,
    description: "With Loop Gain below 100 % the oscillator does not run: it rings when kicked, so each Drum Grid hit becomes a tuned drum, a deep kick on Range ×10, a tom on ×100 and a rim tick on ×1k. Raise Loop Gain towards 100 % for longer rings, or lower Kick for softer hits.",
    tags: ["drums", "kick", "resonator", "percussion"],
  });
  const grid = p.add("drum-grid", [0, 0], {}, { data: drumGrid(["Kick", "Tom", "Rim", "Hat", "", "", "", ""],
    [pattern("Ring", ["X.....x.X..x....", "....x.......x.x.", "x.x.x.xxx.x.x.x.", "..x...x...x...x."])]) });
  const k = p.add("test-oscillator", [1, 0], { range: "×10", freq: 5.2, loopgain: 0.97, settle: 0.1, kick: 0.9, drift: 0.1, level: 1, warmup: false }, { name: "Kick Ring" });
  const t = p.add("test-oscillator", [1, 1], { range: "×100", freq: 1.7, loopgain: 0.95, kick: 0.8, drift: 0.1, warmup: false }, { name: "Tom Ring" });
  const r = p.add("test-oscillator", [1, 2], { range: "×1k", freq: 2.6, loopgain: 0.85, kick: 0.6, drift: 0.1, warmup: false }, { name: "Rim Ring" });
  p.cable(grid, "gate1", k, "kick").cable(grid, "gate2", t, "kick").cable(grid, "gate3", r, "kick");
  const hats = p.add("punch-hats", [1, 3], { level: 0.4 });
  p.cable(grid, "gate4", hats, "closed");
  const m = melody(p, [2, 0], [0, ".", ".", 7, ".", 5, ".", 3], { rate: "1/8", root: "F", scale: "Dorian", octave: -1, shape: 0.2, env: { decay: 0.5 } });
  finish(p, [3, 1], [{ n: k, l: "sine", level: 3 }, { n: t, l: "sine", level: 0, pan: -0.2, also: [[r, "sine"]] }, { n: hats, l: "out", level: -9, pan: 0.3 }, { n: m.amp, l: "l", level: 2 }], { vmix: 0.18, master: -6 });
  return p;
}

function resonator() {
  const p = patch("Test Oscillator: Drum Resonator", {
    module: "test-oscillator", tempo: 104,
    description: "A drum loop goes into Audio In of a test oscillator held just below self-oscillation at 95 %, and a sequencer steers its Pitch: the loop plays a melody through the tuned resonator. Change Loop Gain for a shorter or longer ring, or Frequency for a different key.",
    tags: ["resonator", "filter", "audio in", "melody"],
  });
  const bt = beat(p, [0, 2], { style: "broken", level: -6 });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/8", root: "C", scale: "Minor Pentatonic", octave: 0 },
    { data: steps([0, 3, 7, 3, 10, 7, 12, 10]) });
  const t = p.add("test-oscillator", [2, 0], { range: "×100", freq: 2.6, loopgain: 0.97, settle: 0.2, drift: 0.1, level: 1, warmup: false });
  const boost = p.add("audio-mixer", [1, 2], { level1: 6, master: 6, limiter: false }, { name: "Drive In" });
  const boost2 = p.add("audio-mixer", [1, 3], { level1: 6, master: 6, limiter: false }, { name: "Drive In 2" });
  p.cable(bt, "outl", boost, "in1l").cable(boost, "outl", boost2, "in1l").cable(boost2, "outl", t, "audio").cable(seq, "pitch", t, "pitch");
  const lfo = p.add("lfo", [1, 1], { rate: 0.1 }, { name: "Dial" });
  p.cable(lfo, "out", t, "freq", 0.01);
  finish(p, [3, 0], [{ n: t, l: "sine", level: 6, pan: 0.1 }, { n: bt, l: "outl", r: "outr", level: -9 }], { vmix: 0.25, master: 4 });
  return p;
}

function squeal() {
  const p = patch("Test Oscillator: Squeal Tremolo", {
    module: "test-oscillator", tempo: 126,
    description: "A tiny Settle lets the lamp chase the waveform itself, and Loop Gain at 210 % clips it: the sine turns into a squealing, fluttering square-ish tone that stutters between bursts. A bass line steers the pitch; try Settle between 5 and 50 ms and Loop Gain near 150 % for gentler flutter.",
    tags: ["squeal", "tremolo", "distortion", "bass"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/16", root: "E", scale: "Phrygian", octave: -1, gatelength: 0.6 },
    { data: steps([0, 0, ".", 0, 7, ".", 0, ".", 3, 3, ".", 5, ".", 1, 0, "."]) });
  const t = p.add("test-oscillator", [1, 0], { range: "×100", freq: 1.6, loopgain: 2.1, settle: 0.012, drift: 0.2, level: 0.55, warmup: false });
  const lfo = p.add("lfo", [0, 1], { rate: 0.12 }, { name: "Squeal Sweep" });
  p.cable(seq, "pitch", t, "pitch").cable(lfo, "out", t, "settle", 0.3);
  const flt = p.add("filter", [2, 0], { cutoff: 1200, resonance: 0.3, drive: 0.2 });
  p.cable(t, "sine", flt, "l");
  const env = p.add("adsr", [2, 1], { attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.1 });
  const amp = p.add("vca", [3, 0], {});
  p.cable(seq, "gate", env, "gate").cable(flt, "l", amp, "l").cable(env, "env", amp, "gain");
  const bt = beat(p, [0, 2], { style: "four", level: -9 });
  finish(p, [4, 0], [{ n: amp, l: "l", level: 0 }, { n: bt, l: "outl", r: "outr", level: -3 }], { vmix: 0.18 });
  return p;
}

function bounce() {
  const p = patch("Test Oscillator: Bouncing Bass", {
    module: "test-oscillator", tempo: 88,
    description: "A bass line jumps the dial of a lamp-regulated sine: each leap dips the amplitude and it surges back, a living bounce. The Lamp output follows that heat and sweeps the cutoff of a saw lead, so the lead breathes with the bass. Try Settle to change the bounce time.",
    tags: ["bass", "lamp", "bounce", "modulation"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/4", root: "A", scale: "Natural Minor", octave: -1, gatelength: 0.95 },
    { data: steps([0, "_", 7, "_", 3, "_", 5, 10]) });
  const t = p.add("test-oscillator", [1, 0], { range: "×10", freq: 5.5, loopgain: 1.3, settle: 0.35, drift: 0.3, level: 1, warmup: false });
  p.cable(seq, "pitch", t, "pitch");
  const lead = melody(p, [2, 1], [0, 7, 12, 7, 5, 10, 7, 3], { rate: "1/8", root: "A", scale: "Natural Minor", octave: 1, shape: 1, env: { decay: 0.2 } });
  const flt = p.add("filter", [4, 1], { cutoff: 500, resonance: 0.4 });
  p.cable(lead.amp, "l", flt, "l").cable(t, "lamp", flt, "cutoff", 0.5);
  finish(p, [5, 0], [{ n: t, l: "sine", level: -10 }, { n: flt, l: "l", level: -8, pan: 0.2 }], { vmix: 0.25 });
  return p;
}

export default [drone, drums, resonator, squeal, bounce];
