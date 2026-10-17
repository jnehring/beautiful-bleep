// SPDX-License-Identifier: MIT
// Transport: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

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

function playingPad() {
  const p = patch("Transport: Playing Gate Pad", {
    module: "transport", tempo: 100,
    description: "The Transport's Playing output is high whenever the song runs, and here it opens an envelope that slowly fades in a warm pad under a beat, then lets it ring out when you press Stop. Move the Tempo knob to change the speed of everything, or press Stop and Play to hear the pad breathe in and out.",
    tags: ["playing", "gate", "pad", "start stop"],
  });
  const tr = p.add("transport", [0, 0], { tempo: 100, link: false });
  const drums = beat(p, [2, 0], { style: "half", level: -4 });
  const env = p.add("adsr", [0, 4], { attack: 4, decay: 1, sustain: 1, release: 5, velamount: 0 }, { name: "Fade" });
  p.cable(tr, "playing", env, "gate");
  const oscs = [-12, -5, 0, 4].map((n, i) => p.add("oscillator", [1, 3 + i], { shape: 0.5 + i * 0.1, coarse: n, fine: (i - 1.5) * 6, octave: "0" }, { name: `Pad ${i + 1}` }));
  const sum = p.add("audio-mixer", [2, 4], { level1: -6, level2: -6, level3: -6, level4: -6, pan1: -0.6, pan2: 0.6, pan3: -0.2, pan4: 0.2, master: -4 }, { name: "Pad Mix" });
  oscs.forEach((o, i) => p.cable(o, "out", sum, `in${i + 1}l`));
  const filt = p.add("filter", [3, 4], { cutoff: 1200, resonance: 0.2, type: "Ladder Tanh" }, { name: "Warm" });
  const amp = p.add("vca", [4, 4], {}, { name: "Pad VCA" });
  p.stereo(sum, filt, { from: ["outl", "outr"] }).stereo(filt, amp).cable(env, "env", amp, "gain");
  p.cable(env, "env", filt, "cutoff", 0.3);
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: 0, master: 0 }, { name: "Final" });
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(amp, fin, { to: ["in2l", "in2r"] });
  finish(p, fin, [6, 0], { size: 0.6, decay: 3, mix: 0.25 });
  return p;
}

function tempoBrightness() {
  const p = patch("Transport: Tempo Brightness", {
    module: "transport", tempo: 116,
    description: "The Tempo output carries the speed as a control value (BPM divided by 100) and here it also sets the cutoff of a filter on an arpeggio, so a faster song is automatically a brighter one. Drag the Tempo knob up and down and listen to the tone follow the speed.",
    tags: ["tempo", "control", "filter", "arpeggio"],
  });
  const tr = p.add("transport", [0, 0], { tempo: 116, link: false });
  const m = melody(p, [2, 0], [0, 7, 12, 7, 3, 10, 15, 10], { rate: "1/16", root: "C", scale: "Natural Minor", octave: 0, shape: 0.85, gatelength: 0.5,
    env: { decay: 0.2, sustain: 0.05, release: 0.15 } });
  const filt = p.add("filter", [5, 0], { cutoff: 300, resonance: 0.35, type: "Ladder Tanh", drive: 0.15 }, { name: "Follows Tempo" });
  both(p, m.amp, "l", filt, "l", "r");
  p.cable(tr, "tempo", filt, "cutoff", 0.6);
  const drums = beat(p, [2, 3], { style: "four", level: -5 });
  const fin = p.add("audio-mixer", [6, 0], { level1: -2, level2: 0, pan1: 0.15, master: 0 }, { name: "Final" });
  p.stereo(filt, fin, { to: ["in1l", "in1r"] }).stereo(drums, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  finish(p, fin, [7, 0], { size: 0.35, decay: 1.2, mix: 0.12 });
  return p;
}

function tempoRide() {
  const p = patch("Transport: Tempo Ride", {
    module: "transport", tempo: 104,
    description: "A very slow LFO is patched into the Tempo knob, so the whole song speeds up and slows down by a few BPM over about a minute like a band pushing and pulling. Lower the cable amount on the LFO, or unpatch it to hold the tempo steady.",
    tags: ["tempo", "modulation", "rubato", "accelerando"],
  });
  const tr = p.add("transport", [0, 0], { tempo: 104, link: false });
  const lfo = p.add("lfo", [0, 3], { rate: 0.03, wave: "Sine" }, { name: "Push and Pull" });
  p.cable(lfo, "out", tr, "tempo", 0.04);
  const drums = beat(p, [2, 0], { style: "broken", level: -5 });
  const m = melody(p, [2, 4], [0, ".", 7, ".", 5, 3, ".", 2], { rate: "1/8", root: "G", scale: "Minor Pentatonic", octave: 0, shape: 0.4, env: { decay: 0.3, sustain: 0.1 } });
  const fin = p.add("audio-mixer", [5, 0], { level1: 0, level2: -4, pan2: 0.2, master: 0 }, { name: "Final" });
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] });
  both(p, m.amp, "l", fin, "in2l", "in2r");
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.35, mix: 0.2, highcut: 6000 });
  p.stereo(fin, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.4, decay: 1.5, mix: 0.15 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

function clockOut() {
  const p = patch("Transport: MIDI Clock Out Groove", {
    module: "transport", tempo: 128,
    description: "MIDI Clock Out is switched on, so while this groove plays the Transport also sends clock, start and stop to a connected MIDI Out, keeping outboard gear in time with it. You will hear a driving bass line over a four-on-the-floor kick; use Tap to set the tempo.",
    tags: ["midi clock", "sync", "bass", "groove"],
  });
  const tr = p.add("transport", [0, 0], { tempo: 128, link: false, midiout: true });
  const drums = beat(p, [2, 0], { style: "four", level: -5 });
  const bass = melody(p, [2, 4], [0, 0, ".", 12, 0, ".", 7, 3, 0, 0, ".", 12, 5, ".", 3, 2], { rate: "1/16", root: "A", scale: "Minor Pentatonic", octave: -2, shape: 0.2,
    gatelength: 0.4, env: { decay: 0.2, sustain: 0.2, release: 0.1 }, osc: { fm: 0 } });
  const filt = p.add("filter", [5, 4], { cutoff: 700, resonance: 0.4, type: "Ladder Tanh", drive: 0.2 }, { name: "Bass Filter" });
  both(p, bass.amp, "l", filt, "l", "r");
  const fin = p.add("audio-mixer", [6, 0], { level1: 0, level2: -4, master: 0 }, { name: "Final" });
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in1l", "in1r"] }).stereo(filt, fin, { to: ["in2l", "in2r"] });
  finish(p, fin, [7, 0], { size: 0.3, decay: 1, mix: 0.1 });
  return p;
}

function linkSession() {
  const p = patch("Transport: Link Session Arp", {
    module: "transport", tempo: 90,
    description: "Link is switched on, so this song shares its tempo and start with any other Link-enabled app on the network, while a dreamy arpeggio and a soft beat play. Turn Link off to go solo, or use MIDI Clock In to follow a drum machine instead.",
    tags: ["link", "sync", "arpeggio", "ambient"],
  });
  const tr = p.add("transport", [0, 0], { tempo: 90, link: true });
  const m = melody(p, [2, 0], [0, 4, 7, 11, 14, 11, 7, 4], { rate: "1/8", root: "F", scale: "Lydian", octave: 0, shape: 0.3, env: { decay: 0.5, sustain: 0.1, release: 0.5 }, gatelength: 0.6 });
  const drums = beat(p, [2, 3], { style: "sparse", level: -6 });
  const fin = p.add("audio-mixer", [5, 0], { level1: -3, level2: 0, pan1: 0.1, master: 0 }, { name: "Final" });
  both(p, m.amp, "l", fin, "in1l", "in1r");
  p.stereo(drums, fin, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const dly = p.add("delay", [6, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.45, mix: 0.3, highcut: 5000 });
  p.stereo(fin, dly, { from: ["outl", "outr"] });
  const v = p.add("reverb", [7, 0], { size: 0.7, decay: 4, mix: 0.3 });
  p.stereo(dly, v).stereo(v, p.out);
  return p;
}

export default [playingPad, tempoBrightness, tempoRide, clockOut, linkSession];
