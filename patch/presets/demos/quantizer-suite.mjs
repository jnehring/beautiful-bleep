// SPDX-License-Identifier: MIT
// Quantizer Suite: five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { beat } from "../demo-kit.mjs";

/// A plucked voice: Oscillator → VCA with its own ADSR; gate/retrig from a trigger. Returns {osc, env, amp}.
function pluckVoice(p, at, pitch, trig, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.5, octave: String(o.octave ?? 0), fine: o.fine ?? 0 }, { name: o.name || "Voice" });
  const env = p.add("adsr", [c, r + 1], { attack: 0.004, decay: o.decay ?? 0.3, sustain: o.sustain ?? 0, release: o.release ?? 0.2 }, { name: "Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  p.cable(pitch.node, pitch.jack, osc, "pitch").cable(trig.node, trig.jack, env, "gate").cable(trig.node, trig.jack, env, "retrig")
    .cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return { osc, env, amp };
}
/// Sum mono signals {node, jack, level (dB), pan} on a mixer.
function sum(p, at, list, master = -3, name = "Mix") {
  const vals = { master };
  list.forEach((x, i) => { vals[`level${i + 1}`] = x.level ?? -3; vals[`pan${i + 1}`] = x.pan ?? 0; });
  const m = p.add("audio-mixer", at, vals, { name });
  list.forEach((x, i) => p.cable(x.node, x.jack || "l", m, `in${i + 1}l`));
  return m;
}
const MASKS = (masks) => ({ masks: [...masks, 4095, 4095, 4095, 4095].slice(0, 4) });

function pentatonicPluck() {
  const p = patch("Quantizer Suite: Pentatonic Mask", {
    module: "quantizer-suite", tempo: 108,
    description: "A stepped Random would wander through every note; the Quantizer Suite's note mask keeps only the five pentatonic notes of D major, so any value lands somewhere beautiful. Channel B quantizes the same notes an octave down for a bass. Click notes on and off on the keyboard in the view.",
    tags: ["mask", "pentatonic", "random melody", "quantize"],
  });
  const rnd = p.add("random", [0, 0], { rate: 2, sync: "1/8", spread: 0.8, bias: 0.1, smooth: 0, seed: 17 }, { name: "Wander" });
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Quantize", "a.root": "D", "a.scale": "Major", "a.sample": "Trigger", "a.octave": 0, "a.notes": false,
    "b.mode": "Quantize", "b.root": "D", "b.scale": "Major", "b.sample": "Trigger", "b.octave": -1, "b.notes": false,
  }, { data: MASKS([0b001010010101]) });
  p.cable(rnd, "out", qs, "ina", 0.6).cable(rnd, "trig", qs, "triga");
  const lead = pluckVoice(p, [2, 0], { node: qs, jack: "outa" }, { node: rnd, jack: "trig" }, { shape: 0.3, decay: 0.35 });
  const bseq = p.add("step-sequencer", [0, 4], { length: 4, rate: "1/4", gatelength: 0.6 }, { data: steps([0, 0, 0, 0]) }, { name: "Bass Pulse" });
  const bass = pluckVoice(p, [2, 3], { node: qs, jack: "outb" }, { node: bseq, jack: "gate" }, { shape: 0.1, decay: 0.4, sustain: 0.2, name: "Bass" });
  const mix = sum(p, [4, 0], [{ node: lead.amp, level: -4, pan: 0.2 }, { node: bass.amp, level: -3, pan: -0.1 }], -1);
  const drums = beat(p, [0, 6], { style: "sparse", level: -14 });
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.4, tone: -0.2, width: 1, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3, mix: 0.25 });
  const out = p.add("audio-mixer", [5, 2], { level1: -1, level2: -5, master: -1 }, { name: "Final" });
  p.stereo(mix, dly, { from: ["outl", "outr"] }).stereo(dly, out, { to: ["in1l", "in1r"] })
    .cable(drums, "outl", out, "in2l").cable(drums, "outr", out, "in2r");
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function parallelHarmony() {
  const p = patch("Quantizer Suite: Four-voice Harmony", {
    module: "quantizer-suite", tempo: 96,
    description: "One E Dorian melody goes into In A only; the unpatched inputs inherit it, and channels B, C and D transpose it by 2, 4 and 7 scale steps, so a single line turns into a moving four-part chord. Change the Steps knobs to reshape the harmony.",
    tags: ["harmoniser", "transpose", "dorian", "parallel"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 16, rate: "1/8", root: "E", scale: "Dorian", gatelength: 0.8 },
    { data: steps([0, "_", 2, 3, 5, "_", 3, 2, 0, "_", 7, 5, 3, 2, 0, "_"]) });
  const base = (ch, steps_, oct) => ({ [`${ch}.mode`]: "Transpose", [`${ch}.root`]: "E", [`${ch}.scale`]: "Dorian", [`${ch}.steps`]: steps_,
    [`${ch}.octave`]: oct, [`${ch}.notes`]: false });
  const qs = p.add("quantizer-suite", [1, 0], {
    ...base("a", 0, 0), "a.mode": "Quantize", ...base("b", 2, 0), ...base("c", 4, 0), ...base("d", 7, 0) });
  p.cable(seq, "pitch", qs, "ina");
  const shapes = [0.75, 0.55, 0.65, 0.35], pans = [-0.5, -0.2, 0.2, 0.5];
  const gains = [0, -3, -4, -6];
  const voices = ["outa", "outb", "outc", "outd"].map((j, i) => {
    const osc = p.add("oscillator", [2, i], { shape: shapes[i], fine: (i - 1.5) * 7 }, { name: `Voice ${"ABCD"[i]}` });
    p.cable(qs, j, osc, "pitch");
    return osc;
  });
  const mixv = voices.map((o, i) => ({ node: o, jack: "out", level: -4 + gains[i], pan: pans[i] }));
  const mix = sum(p, [3, 0], mixv, 3, "Voices");
  const env = p.add("adsr", [3, 5], { attack: 0.01, decay: 0.3, sustain: 0.55, release: 0.4 }, { name: "Amp Env" });
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [5, 0], { cutoff: 1600, resonance: 0.25, type: "Ladder Tanh" });
  const lfo = p.add("lfo", [4, 5], { rate: 0.1 }, { name: "Sweep" });
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain").stereo(vca, flt).cable(lfo, "out", flt, "cutoff", 0.2);
  const verb = p.add("reverb", [6, 0], { size: 0.7, decay: 3.5, mix: 0.3 });
  p.stereo(flt, verb).stereo(verb, p.out);
  return p;
}

function arpMachine() {
  const p = patch("Quantizer Suite: Arp Machine", {
    module: "quantizer-suite", tempo: 116,
    description: "Channels A and B in Arp mode build a seventh chord and a random triad on each slow root and play them as sixteenth-note arpeggios, one up and down over two octaves, one shuffled an octave higher. Try another Order or Chord, or Span 3.",
    tags: ["arpeggio", "arp", "chords", "sixteenth"],
  });
  const seq = p.add("step-sequencer", [0, 0], { length: 8, rate: "1/1", root: "A", scale: "Natural Minor", gatelength: 0.95 },
    { data: steps([0, 5, 3, 7, 0, 5, 10, 7]) });
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Arp", "a.root": "A", "a.scale": "Natural Minor", "a.chord": "Seventh", "a.order": "Up-Down", "a.span": 2, "a.notes": false,
    "b.mode": "Arp", "b.root": "A", "b.scale": "Natural Minor", "b.chord": "Triad", "b.order": "Random", "b.span": 1, "b.octave": 1, "b.notes": false,
  });
  const clk = p.add("step-sequencer", [0, 3], { length: 16, rate: "1/16", gatelength: 0.4 },
    { data: steps([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }, { name: "Arp Clock" });
  p.cable(seq, "pitch", qs, "ina").cable(clk, "trigger", qs, "triga");
  const a = pluckVoice(p, [2, 0], { node: qs, jack: "outa" }, { node: clk, jack: "gate" }, { shape: 0.6, decay: 0.2, name: "Arp A" });
  const b = pluckVoice(p, [2, 3], { node: qs, jack: "outb" }, { node: clk, jack: "gate" }, { shape: 0.2, decay: 0.14, name: "Arp B" });
  const bass = p.add("oscillator", [2, 6], { shape: 0.1, octave: "-2" }, { name: "Root Bass" });
  const bvca = p.add("vca", [3, 6], { gain: 0.5 }, { name: "Bass Level" });
  p.cable(seq, "pitch", bass, "pitch").cable(bass, "out", bvca, "l");
  const mix = sum(p, [4, 0], [{ node: a.amp, level: -3, pan: -0.3 }, { node: b.amp, level: -5, pan: 0.4 }, { node: bvca, level: -6 }], -1);
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 3, feedback: 0.35, tone: -0.2, width: 1, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [6, 0], { size: 0.6, decay: 3, mix: 0.25 });
  p.stereo(mix, dly, { from: ["outl", "outr"] }).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

function followTheChords() {
  const p = patch("Quantizer Suite: Chord Followers", {
    module: "quantizer-suite", tempo: 90,
    description: "Four channels follow a Harmony Master on bus A. A random contour is snapped to the nearest chord tone for a lead, a second channel adds the chord tone two steps above, and a third in Root mode makes a bass line from the same contour. Change a channel's Target to Scale or Chord + Scale.",
    tags: ["follow", "harmony", "bass line", "chord tones"],
  });
  const hm = p.add("harmony-master", [0, 0], { source: "Progression", key: "F", scale: "Major", bus: "A" },
    { data: { slots: [{ deg: 1, q: "diatonic-seventh", len: 4 }, { deg: 6, q: "diatonic-seventh", len: 4 },
                      { deg: 2, q: "diatonic-seventh", len: 4 }, { deg: 5, q: "dominant7", len: 4 }] } });
  const rnd = p.add("random", [0, 2], { rate: 2, sync: "1/8", spread: 0.6, smooth: 0, seed: 4 }, { name: "Contour" });
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Follow", "a.harmony": "Bus A", "a.target": "Chord", "a.sample": "Trigger", "a.octave": 0, "a.steps": 0, "a.notes": false,
    "b.mode": "Follow", "b.harmony": "Bus A", "b.target": "Chord", "b.sample": "Trigger", "b.octave": 0, "b.steps": 2, "b.notes": false,
    "c.mode": "Follow", "c.harmony": "Bus A", "c.target": "Root", "c.sample": "Trigger", "c.octave": -1, "c.steps": 0, "c.notes": false,
  });
  p.cable(rnd, "out", qs, "ina", 0.5).cable(rnd, "trig", qs, "triga");
  const lead = pluckVoice(p, [2, 0], { node: qs, jack: "outa" }, { node: rnd, jack: "trig" }, { shape: 0.4, decay: 0.3, name: "Lead" });
  const harm = pluckVoice(p, [2, 2], { node: qs, jack: "outb" }, { node: rnd, jack: "trig" }, { shape: 0.15, decay: 0.3, name: "Harmony" });
  const bseq = p.add("step-sequencer", [0, 5], { length: 8, rate: "1/8", gatelength: 0.5 }, { data: steps([0, ".", 0, 0, ".", 0, 0, "."]) }, { name: "Bass Rhythm" });
  const bass = pluckVoice(p, [2, 4], { node: qs, jack: "outc" }, { node: bseq, jack: "gate" }, { shape: 0.6, decay: 0.25, sustain: 0.2, name: "Bass" });
  // A soft pad on the chord tones, so the harmony is audible.
  const pad = [1, 2, 3].map((n, i) => {
    const o = p.add("oscillator", [3, 5 + i], { shape: 0.3, fine: (i - 1) * 8 }, { name: `Pad ${n}` });
    p.cable(hm, `tone${n}`, o, "pitch");
    return { node: o, jack: "out", level: -12, pan: (i - 1) * 0.6 };
  });
  const padMix = sum(p, [4, 5], pad, -4, "Pad");
  const mix = sum(p, [4, 0], [{ node: lead.amp, level: -4, pan: 0.2 }, { node: harm.amp, level: -7, pan: -0.3 }, { node: bass.amp, level: -3 }], -1);
  const dly = p.add("delay-network", [5, 0], { sync: "1/8.", taps: 2, feedback: 0.35, tone: -0.3, width: 0.9, mix: 0.25, routing: "Ring" });
  const out = p.add("audio-mixer", [6, 1], { level1: -1, level2: -3, master: -1 }, { name: "Final" });
  const verb = p.add("reverb", [7, 0], { size: 0.7, decay: 3.5, mix: 0.25 });
  p.stereo(mix, dly, { from: ["outl", "outr"] }).stereo(dly, out, { to: ["in1l", "in1r"] }).stereo(padMix, out, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  p.stereo(out, verb, { from: ["outl", "outr"] }).stereo(verb, p.out);
  return p;
}

function glidingLead() {
  const p = patch("Quantizer Suite: Gliding Lines", {
    module: "quantizer-suite", tempo: 80,
    description: "A smooth random curve is quantized to F Lydian and held by Track & Hold, with Slew gliding between the notes; channel B follows a fifth up (Steps +4) with a longer slew. Two singing lines that slide from note to note. Raise a Slew knob for slower glides.",
    tags: ["slew", "glide", "lydian", "track and hold"],
  });
  const rnd = p.add("random", [0, 0], { rate: 1, sync: "1/2", spread: 0.7, smooth: 1, seed: 33 }, { name: "Curve" });
  const gate = p.add("lfo", [0, 1], { wave: "Square", sync: "1/2", pw: 0.55, polarity: "Unipolar" }, { name: "Hold Gate" });
  const qs = p.add("quantizer-suite", [1, 0], {
    "a.mode": "Quantize", "a.root": "F", "a.scale": "Lydian", "a.sample": "Track & Hold", "a.slew": 0.12, "a.notes": false,
    "b.mode": "Transpose", "b.root": "F", "b.scale": "Lydian", "b.sample": "Track & Hold", "b.steps": 4, "b.slew": 0.3, "b.notes": false,
  });
  p.cable(rnd, "out", qs, "ina", 0.55).cable(gate, "out", qs, "triga");
  const env = p.add("adsr", [2, 3], { attack: 0.08, decay: 0.3, sustain: 0.8, release: 0.6 }, { name: "Amp Env" });
  const o1 = p.add("oscillator", [2, 0], { shape: 0.7, fine: -5 }, { name: "Line A" });
  const o2 = p.add("oscillator", [2, 1], { shape: 0.5, fine: 5 }, { name: "Line B" });
  const sub = p.add("oscillator", [2, 2], { shape: 0.05, octave: "-1" }, { name: "Sub" });
  p.cable(qs, "outa", o1, "pitch").cable(qs, "outb", o2, "pitch").cable(qs, "outa", sub, "pitch");
  const mix = sum(p, [3, 0], [{ node: o1, jack: "out", level: -4, pan: -0.3 }, { node: o2, jack: "out", level: -6, pan: 0.4 }, { node: sub, jack: "out", level: -9 }], -2);
  const vca = p.add("vca", [4, 0], {}, { name: "VCA" });
  const flt = p.add("filter", [5, 0], { cutoff: 1800, resonance: 0.3, type: "Ladder Tanh" });
  const lfo = p.add("lfo", [4, 3], { rate: 0.12 }, { name: "Sweep" });
  p.cable(gate, "out", env, "gate");
  p.stereo(mix, vca, { from: ["outl", "outr"] }).cable(env, "env", vca, "gain").stereo(vca, flt).cable(lfo, "out", flt, "cutoff", 0.15);
  const dly = p.add("delay-network", [6, 0], { sync: "1/4.", taps: 3, feedback: 0.45, tone: -0.3, width: 1, mix: 0.3, routing: "Ring" });
  const verb = p.add("reverb", [7, 0], { size: 0.8, decay: 5, mix: 0.35 });
  p.stereo(flt, dly).stereo(dly, verb).stereo(verb, p.out);
  return p;
}

export default [pentatonicPluck, parallelHarmony, arpMachine, followTheChords, glidingLead];
