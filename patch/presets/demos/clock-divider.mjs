// SPDX-License-Identifier: MIT
// Clock Div: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
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

function layers() {
  const p = patch("Clock Div: Layered Percussion", {
    module: "clock-divider", tempo: 108,
    description: "One 16th-note clock is cut into /2, /3, /5, /8 and /16: hats on the fast outputs, a kick every eight steps, a rim every three and a cowbell every five, so the layers drift in and out of line. Edit any Div knob to retune a layer; they all realign on the downbeat of the 16-step cycle.",
    tags: ["divisions", "layers", "percussion", "drums"],
  });
  const cd = p.add("clock-divider", [0, 0], { div1: 8, div2: 2, div3: 3, div4: 5, div5: 16, output: "Trigger", base: "1/16" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85 });
  const hats = p.add("punch-hats", [2, 1], { level: 0.4, closed: 0.035 });
  const rim = p.add("punch-rim", [2, 2], { level: 0.5, tune: 2 });
  const bell = p.add("ring-cowbell", [2, 3], { level: 0.4, decay: 0.2 });
  const clap = p.add("punch-clap", [3, 0], { level: 0.55 });
  p.cable(cd, "out1", kick, "trig").cable(cd, "out2", hats, "closed").cable(cd, "out3", rim, "trig").cable(cd, "out4", bell, "trig").cable(cd, "out5", clap, "trig");
  const mix = bus(p, [5, 0], [{ node: kick, level: -3 }, { node: hats, level: -13, pan: 0.3 }, { node: rim, level: -10, pan: -0.3 },
    { node: bell, level: -13, pan: 0.45 }, { node: clap, level: -9, pan: 0.1 }], 0, "Kit");
  finish(p, mix, [7, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

function chimes() {
  const p = patch("Clock Div: Polyrhythm Chimes", {
    module: "clock-divider", tempo: 84,
    description: "Four outputs divide an eighth-note clock by 3, 4, 5 and 7 and each rings a different bell tone, so a calm major pentatonic cluster slowly rearranges itself. Change one Div by a single step and the whole pattern shifts.",
    tags: ["polyrhythm", "chimes", "pentatonic", "ambient"],
  });
  const cd = p.add("clock-divider", [0, 0], { div1: 3, div2: 4, div3: 5, div4: 7, base: "1/8", output: "Gate", width: 0.2 });
  const vs = [0, 7, 4, 9].map((n, i) => voice(p, [2, i * 2], null, [cd, `out${i + 1}`], { name: `Chime ${i + 1}`, shape: 0, osc: { coarse: n },
    env: { attack: 0.003, decay: 1.4, sustain: 0, release: 1.2 }, octave: i > 1 ? 1 : 0 }));
  const mix = bus(p, [5, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: -3, pan: -0.6 + i * 0.4 })), 3, "Chimes");
  const v = p.add("reverb", [6, 0], { size: 0.8, decay: 6, mix: 0.4 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function counter() {
  const p = patch("Clock Div: Binary Counter Bass", {
    module: "clock-divider", tempo: 120,
    description: "Powers of two (/1, /2, /4, /8) in Trigger mode play a kick, snare, hat and bass in a fixed, regular pattern, a bit like the bits of a counter. Change Base to 1/8T for a rolling feel, or set Realign to 4 bars to snap the layers back together on a longer cycle.",
    tags: ["binary", "powers of two", "bass", "drums"],
  });
  const cd = p.add("clock-divider", [0, 0], { div1: 4, div2: 8, div3: 2, div4: 16, div5: 3, output: "Gate", width: 0.4, base: "1/16", realign: "4 bars" });
  const kick = p.add("punch-kick", [2, 0], { level: 0.85, decay: 0.45 });
  const snare = p.add("punch-snare", [2, 1], { level: 0.6 });
  const hats = p.add("punch-hats", [2, 2], { level: 0.42, closed: 0.04 });
  const bass = voice(p, [2, 3], null, [cd, "out5"], { name: "Bass", shape: 0.25, octave: -2, osc: { coarse: -2 }, env: { decay: 0.25, sustain: 0.2 },
    filter: { cutoff: 450, resonance: 0.35 } });
  p.cable(cd, "out1", kick, "trig").cable(cd, "out2", snare, "trig").cable(cd, "out3", hats, "closed");
  const mix = bus(p, [5, 0], [{ node: kick, level: -3 }, { node: snare, level: -7, pan: 0.1 }, { node: hats, level: -13, pan: 0.3 },
    { node: bass.out, jack: "l", level: -6 }], 0, "Mix");
  finish(p, mix, [6, 0], { size: 0.3, decay: 1, mix: 0.12 });
  return p;
}

function padGates() {
  const p = patch("Clock Div: Slow Gate Pad", {
    module: "clock-divider", tempo: 72,
    description: "With Output set to Gate and Gate Length on Division, the slow outputs (/16, /24, /32 and /48) hold long gates that swell three chord tones in and out at different times. Narrow Width shortens the swells; try Gate Length = Base Step for short blips instead.",
    tags: ["gates", "pad", "slow", "swells"],
  });
  const cd = p.add("clock-divider", [0, 0], { div1: 16, div2: 24, div3: 32, div4: 48, base: "1/16", output: "Gate", gatelength: "Division", width: 0.6 });
  const vs = [-12, -5, 0, 4].map((n, i) => voice(p, [2, i * 2], null, [cd, `out${i + 1}`], { name: `Tone ${i + 1}`, shape: 0.45, osc: { coarse: n },
    env: { attack: 1.2, decay: 1, sustain: 0.8, release: 2 }, filter: { cutoff: 1800, resonance: 0.15 } }));
  const mix = bus(p, [6, 0], vs.map((v, i) => ({ node: v.out, jack: "l", level: -3, pan: -0.5 + i * 0.33 })), 2, "Pad");
  const ch = p.add("chorus", [7, 0], { rate: 0.4, depth: 0.5, mix: 0.4 });
  const v = p.add("reverb", [8, 0], { size: 0.8, decay: 6, mix: 0.35 });
  p.stereo(mix, ch, { from: ["outl", "outr"] }).stereo(ch, v).stereo(v, p.out);
  return p;
}

function polymeter() {
  const p = patch("Clock Div: Clocks for Two Melodies", {
    module: "clock-divider", tempo: 100,
    description: "Two Step Sequencers have no clock of their own: one takes /2 and one takes /3 of the divider, so an 8-note arpeggio and a 5-note bass line run at different speeds and phase against each other. Move a Div knob to speed one of them up or down.",
    tags: ["polymeter", "clock", "melody", "sequencer"],
  });
  const cd = p.add("clock-divider", [0, 0], { div1: 2, div2: 3, base: "1/16", output: "Trigger" });
  const a = melody(p, [2, 0], [0, 4, 7, 11, 9, 7, 4, 2], { root: "E", scale: "Dorian", octave: 0, shape: 0.5, env: { decay: 0.25, sustain: 0 } });
  const b = melody(p, [2, 3], [0, ".", 5, 3, 0], { root: "E", scale: "Dorian", octave: -2, shape: 0.25, env: { decay: 0.4, sustain: 0.1 } });
  p.cable(cd, "out1", a.seq, "clock").cable(cd, "out2", b.seq, "clock");
  const k = p.add("punch-kick", [5, 3], { level: 0.7 });
  const mix = bus(p, [5, 0], [{ node: a.amp, jack: "l", level: -4, pan: 0.3 }, { node: b.amp, jack: "l", level: 0, pan: -0.2 }, { node: k, level: -6 }], 0, "Mix");
  p.cable(cd, "out1", k, "trig");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.35, mix: 0.25, highcut: 6000 });
  p.stereo(mix, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.4, decay: 1.6, mix: 0.2 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

export default [layers, chimes, counter, padGates, polymeter];
