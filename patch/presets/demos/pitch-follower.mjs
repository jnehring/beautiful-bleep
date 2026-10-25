// SPDX-License-Identifier: GPL-3.0-only
// Pitch Follower: five demo patches. Each plays by itself with the transport.
import { patch } from "../kit.mjs";
import { melody } from "../demo-kit.mjs";

// Mixer to Out 1/2: channels are [node, jack, dB, pan] (mono sources). Optional reverb after the mixer.
function toOut(p, at, chans, o = {}) {
  const v = { master: o.master ?? 0 };
  chans.forEach(([, , db, pan], i) => { v["level" + (i + 1)] = db; v["pan" + (i + 1)] = pan ?? 0; });
  const g = p.add("audio-mixer", at, v, { name: "Out Mix" });
  chans.forEach(([n, j], i) => p.cable(n, j, g, "in" + (i + 1) + "l"));
  if (o.verb === false) { p.stereo(g, p.out, { from: ["outl", "outr"] }); return g; }
  const verb = p.add("reverb", [at[0] + 1, at[1]], { size: 0.5, decay: o.decay ?? 2.2, damping: 0.5, mix: o.mix ?? 0.2, quality: "Eco (8 lines)" });
  p.cable(g, "outl", verb, "l").cable(g, "outr", verb, "r").stereo(verb, p.out);
  return g;
}

// A synth voice driven by a follower: Pitch -> oscillator, Gate -> ADSR -> VCA.
function followed(p, at, f, o = {}) {
  const [c, r] = at;
  const osc = p.add("oscillator", [c, r], { shape: o.shape ?? 0.5, octave: o.octave ?? "0", coarse: o.coarse ?? 0, ...(o.osc || {}) }, { name: o.name || "Follower Voice" });
  const env = p.add("adsr", [c, r + 1], { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.2, ...(o.env || {}) }, { name: "Voice Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "Voice VCA" });
  p.cable(f, "pitch", osc, "pitch").cable(f, "gate", env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  return { osc, env, amp };
}

function voiceToSynth() {
  const p = patch("Pitch Follower: Voice to Synth Bridge", {
    module: "pitch-follower", tempo: 100,
    description: "A bright plucked melody is followed note by note, and two soft synth voices play it for you an octave and a fifth lower, each note opened by the follower's Gate. Try Smooth Glide-like values on Glide to slide between the notes, or raise Confidence to hear the bridge hesitate.",
    tags: ["pitch tracking", "audio to cv", "bass", "bridge"],
  });
  const m = melody(p, [0, 0], [0, ".", 3, 5, ".", 7, 5, 3, 0, ".", 5, ".", 7, ".", 10, 7], { rate: "1/8", shape: 0.7, root: "A", octave: 0,
    scale: "Natural Minor", gatelength: 0.55, env: { decay: 0.2, sustain: 0.5, release: 0.04 } });
  const f = p.add("pitch-follower", [3, 0], { low: 100, high: 1500, glide: 0.02, hold: 0.04, confidence: 0.75, guard: "Light", vote: "Off" });
  p.cable(m.amp, "l", f, "in");
  const a = followed(p, [4, 0], f, { shape: 0.2, octave: "-1", env: { decay: 0.25, sustain: 0.7, release: 0.12 }, name: "Bass Voice" });
  const b = followed(p, [4, 3], f, { shape: 0.65, octave: "-1", coarse: 5, env: { decay: 0.2, sustain: 0.4, release: 0.15 }, name: "Fifth Voice" });
  const flt = p.add("filter", [6, 3], { cutoff: 1500, resonance: 0.25 }, { name: "Soften" });
  p.cable(b.amp, "l", flt, "l");
  toOut(p, [7, 0], [[m.amp, "l", -12, -0.4], [a.amp, "l", -2, 0.1], [flt, "l", -6, 0.4]], { mix: 0.2 });
  return p;
}

function brightnessFollowsNote() {
  const p = patch("Pitch Follower: Brightness Follows Note", {
    module: "pitch-follower", tempo: 92,
    description: "A melody that leaps across two octaves is followed, and its Pitch opens the filter on a held two-note drone: low notes make the drone dark, high notes make it shine. Change the filter's Keytrack to make the effect stronger or gentler.",
    tags: ["filter", "pitch to cutoff", "drone", "timbre"],
  });
  const m = melody(p, [0, 0], [0, ".", 12, ".", 7, ".", 19, ".", 3, ".", 15, ".", 5, ".", 24, "."], { rate: "1/8", shape: 0.35, root: "D", octave: -1,
    scale: "Dorian", gatelength: 0.5, env: { decay: 0.3, sustain: 0.3, release: 0.05 } });
  const f = p.add("pitch-follower", [3, 0], { low: 120, high: 2000, glide: 0.25, hold: 0.1, confidence: 0.7, guard: "Light", vote: "3" });
  p.cable(m.amp, "l", f, "in");
  const d1 = p.add("oscillator", [3, 3], { shape: 0.67, octave: "-2", fine: -7 }, { name: "Drone Low" });
  const d2 = p.add("oscillator", [3, 4], { shape: 0.67, octave: "-1", coarse: 7, fine: 6 }, { name: "Drone Fifth" });
  const mix = p.add("audio-mixer", [4, 3], { level1: -6, level2: -9 }, { name: "Drone Sum" });
  const flt = p.add("filter", [5, 3], { cutoff: 300, resonance: 0.45, type: "Ladder Tanh", keytrack: 1, drive: 0.1 }, { name: "Follower Filter" });
  p.cable(d1, "out", mix, "in1l").cable(d2, "out", mix, "in2l").cable(mix, "outl", flt, "l").cable(mix, "outl", flt, "r").cable(f, "pitch", flt, "pitch");
  toOut(p, [6, 0], [[flt, "l", -9, -0.5], [flt, "r", -9, 0.5], [m.amp, "l", -18, 0]], { mix: 0.25, decay: 3 });
  return p;
}

function onlyClearTonesPass() {
  const p = patch("Pitch Follower: Only Clear Tones Pass", {
    module: "pitch-follower", tempo: 108,
    description: "A source alternates every bar between a clear melody and bursts of noise. The follower's Confidence drops for the noise, so the chime voice it drives plays the tune and falls silent in between. Lower the Confidence knob to let the noise start false notes.",
    tags: ["confidence", "gating", "noise", "pitch tracking"],
  });
  const m = melody(p, [0, 0], [0, 4, 7, 4, 9, 7, 4, 2], { rate: "1/8", shape: 0.5, root: "G", scale: "Major Pentatonic", octave: 0,
    gatelength: 0.6, env: { decay: 0.2, sustain: 0.6, release: 0.05 } });
  const lfo = p.add("lfo", [0, 3], { wave: "Square", sync: "Tempo", division: "1/1", polarity: "Unipolar", pw: 0.5 }, { name: "Bar Switch" });
  const inv = p.add("attenuverter", [1, 3], { scale: -1, offset: 1 }, { name: "Invert" });
  p.cable(lfo, "out", inv, "in1");
  const tone = p.add("vca", [3, 0], {}, { name: "Tone Gate" });
  const noise = p.add("noise", [0, 5], { level: 0.8, colour: 0.2 });
  const nvca = p.add("vca", [3, 5], {}, { name: "Noise Gate" });
  p.cable(m.amp, "l", tone, "l").cable(inv, "out1", tone, "gain").cable(noise, "out", nvca, "l").cable(lfo, "out", nvca, "gain");
  const src = p.add("audio-mixer", [4, 3], { level1: 0, level2: -3 }, { name: "Source Mix" });
  p.cable(tone, "l", src, "in1l").cable(nvca, "l", src, "in2l");
  const f = p.add("pitch-follower", [5, 3], { low: 100, high: 1500, glide: 0.01, hold: 0.03, confidence: 0.85, guard: "Light", vote: "Off" });
  p.cable(src, "outl", f, "in");
  const v = followed(p, [6, 3], f, { shape: 0.0, octave: "+1", env: { attack: 0.003, decay: 0.35, sustain: 0.3, release: 0.4 }, name: "Chime" });
  const conf = p.add("vca", [8, 3], {}, { name: "Confidence VCA" });
  p.cable(v.amp, "l", conf, "l").cable(f, "confidence", conf, "gain");
  const dl = p.add("delay", [9, 3], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.4, highcut: 5000, mix: 0.3, mode: "Ping-Pong" });
  p.cable(conf, "l", dl, "l").cable(conf, "l", dl, "r");
  toOut(p, [10, 0], [[dl, "l", 0, -0.3], [dl, "r", 0, 0.3], [src, "outl", -12, 0]], { mix: 0.15 });
  return p;
}

function guardAndVote() {
  const p = patch("Pitch Follower: Guard and Vote", {
    module: "pitch-follower", tempo: 104,
    description: "A jumpy melody on a sound with a loud second harmonic is the hard case for any pitch tracker. Octave Guard Firm and a Vote of 5 keep the follower on the right note, and a Quantizer tidies it onto the scale for a plucked voice. Set Guard to Off and Vote to Off and listen for octave slips.",
    tags: ["octave guard", "vote", "quantizer", "stability"],
  });
  const m = melody(p, [0, 0], [0, 7, 3, 10, 5, 12, 7, 2, 0, 5, 8, 3], { rate: "1/8", shape: 0.4, root: "C", octave: -1, scale: "Minor Pentatonic",
    gatelength: 0.6, env: { decay: 0.25, sustain: 0.5, release: 0.04 } });
  const h = p.add("oscillator", [1, 3], { shape: 0.4, coarse: 12 }, { name: "2nd Harmonic" });
  p.cable(m.seq, "pitch", h, "pitch");
  const hv = p.add("vca", [2, 3], {}, { name: "Harmonic VCA" });
  p.cable(h, "out", hv, "l").cable(m.env, "env", hv, "gain");
  const rich = p.add("audio-mixer", [3, 3], { level1: -9, level2: -3 }, { name: "Rich Mix" });
  p.cable(m.amp, "l", rich, "in1l").cable(hv, "l", rich, "in2l");
  const f = p.add("pitch-follower", [4, 0], { low: 80, high: 1000, glide: 0.02, hold: 0.05, confidence: 0.7, guard: "Firm", vote: "5" });
  p.cable(rich, "outl", f, "in");
  const q = p.add("quantizer", [5, 0], { root: "C", scale: "Minor Pentatonic", range: 3, hysteresis: 0.15 });
  p.cable(f, "pitch", q, "in");
  const osc = p.add("oscillator", [6, 0], { shape: 0.67, octave: "0" }, { name: "Quantized Voice" });
  const env = p.add("adsr", [6, 1], { attack: 0.003, decay: 0.28, sustain: 0.1, release: 0.15 }, { name: "Pluck Env" });
  const amp = p.add("vca", [7, 0], {}, { name: "Pluck VCA" });
  const flt = p.add("filter", [8, 0], { cutoff: 2200, resonance: 0.3 });
  p.cable(q, "out", osc, "pitch").cable(f, "gate", env, "gate").cable(osc, "out", amp, "l").cable(env, "env", amp, "gain")
    .cable(amp, "l", flt, "l");
  toOut(p, [9, 0], [[flt, "l", 0, 0.2], [rich, "outl", -8, -0.3]], { mix: 0.22 });
  return p;
}

function glideAndEnv() {
  const p = patch("Pitch Follower: Portamento and Env", {
    module: "pitch-follower", tempo: 80,
    description: "A slow, legato melody is followed with a long Glide, so the synth slides from note to note like a portamento voice. The Env output opens a filter and the delay mix with each note's loudness. Shorten Glide for steps, or lengthen Env Release for a longer tail.",
    tags: ["glide", "portamento", "env", "legato"],
  });
  const m = melody(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 12, "_", "_", "_", 10, "_", "_", "_", 3, "_", "_", "_", 7, "_", "_", "_", 0, "_", "_", "_"],
    { rate: "1/8", shape: 0.1, root: "F", octave: 0, scale: "Dorian", gatelength: 1, env: { attack: 0.03, decay: 0.2, sustain: 0.9, release: 0.1 } });
  const f = p.add("pitch-follower", [3, 0], { low: 150, high: 1200, glide: 0.45, hold: 0.4, confidence: 0.7, guard: "Light", vote: "3", release: 0.5 });
  p.cable(m.amp, "l", f, "in");
  const osc = p.add("oscillator", [4, 0], { shape: 0.67, octave: "-1", fine: -5 }, { name: "Glide Voice" });
  const sub = p.add("oscillator", [4, 1], { shape: 0.4, octave: "-1", fine: 6 }, { name: "Glide Voice 2" });
  const mix = p.add("audio-mixer", [5, 0], { level1: -6, level2: -9 }, { name: "Voice Sum" });
  const flt = p.add("filter", [6, 0], { cutoff: 350, resonance: 0.4, type: "Ladder Tanh" }, { name: "Env Filter" });
  const amp = p.add("vca", [7, 0], { gain: 1 }, { name: "Level" });
  p.cable(f, "pitch", osc, "pitch").cable(f, "pitch", sub, "pitch").cable(osc, "out", mix, "in1l").cable(sub, "out", mix, "in2l")
    .cable(mix, "outl", flt, "l").cable(f, "env", flt, "cutoff", 0.5).cable(flt, "l", amp, "l");
  const dl = p.add("delay", [8, 0], { sync: "Tempo", ratel: "1/8.", rater: "1/4", feedback: 0.5, highcut: 4000, mix: 0.2, mode: "Ping-Pong" });
  p.cable(amp, "l", dl, "l").cable(amp, "l", dl, "r").cable(f, "env", dl, "mix", 0.3);
  toOut(p, [9, 0], [[dl, "l", -3, -0.4], [dl, "r", -3, 0.4], [m.amp, "l", -20, 0]], { mix: 0.3, decay: 3.2 });
  return p;
}

export default [voiceToSynth, brightnessFollowsNote, onlyClearTonesPass, guardAndVote, glideAndEnv];
