// SPDX-License-Identifier: MIT
// Plucks & Mallets: struck, plucked and pinged Voice Cells. Notes in, Out L/R; velocity plays the hit.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Modal Voice striking a bar body: marimba, harder mallets with velocity.
function rosewoodMarimba() {
  const p = voice("Rosewood Marimba", {
    description: "Modal Voice strikes a wooden bar: soft felt mallets that harden and brighten with velocity, a warm, short ring. Shared input Brightness.",
    tags: ["mallet", "marimba", "physical", "wood"],
  }).settings({ voices: 10, spread: 0.4 }).input("bright", "Brightness");
  const mv = p.add("modal-voice", [1, 0], { strike: 0.9, strikeTimbre: 0.3, geometry: 0.5, brightness: 0.45, damping: 0.42,
    position: 0.22, space: 0 });
  p.cable(p.vin, "pitch", mv, "pitch").cable(p.vin, "gate", mv, "gate").cable(p.vin, "trigger", mv, "strike")
    .cable(p.vin, "velocity", mv, "velocity").cable(p.vin, "velocity", mv, "strikeTimbre", 0.3)
    .cable(p.cin, "bright", mv, "brightness", 0.4)
    .stereo(mv, p.vout).cable(mv, "active", p.vout, "active");
  return p;
}

// Modal Voice on a metal bar with a long ring and a motor tremolo: vibraphone.
function midnightVibraphone() {
  const p = voice("Midnight Vibraphone", {
    description: "Modal Voice strikes long-ringing metal bars, with a motor tremolo on the amp: a mellow vibraphone; velocity hardens the mallet. Shared input Tremolo Rate.",
    tags: ["mallet", "vibraphone", "physical", "jazz"],
  }).settings({ voices: 10, spread: 0.5 }).input("motor", "Tremolo Rate");
  const mv = p.add("modal-voice", [1, 0], { strike: 0.85, strikeTimbre: 0.5, geometry: 0.55, brightness: 0.62, damping: 0.22,
    position: 0.25, space: 0 });
  const trem = p.add("lfo", [1, 1], { rate: 5 }, { name: "Motor" });
  const amp = p.add("vca", [2, 0], { gain: 0.75, response: "Linear" }, { name: "Tremolo" });
  p.cable(p.vin, "pitch", mv, "pitch").cable(p.vin, "gate", mv, "gate").cable(p.vin, "trigger", mv, "strike")
    .cable(p.vin, "velocity", mv, "velocity").cable(p.vin, "velocity", mv, "strikeTimbre", 0.2)
    .cable(trem, "sine", amp, "gain", 0.25).cable(p.cin, "motor", trem, "rate", 0.2)
    .stereo(mv, amp).stereo(amp, p.vout).cable(mv, "active", p.vout, "active");
  return p;
}

// Resonator's plucked-string model strummed by each note: a harp.
function celticHarp() {
  const p = voice("Celtic Harp", {
    description: "Resonator's String model plucked near the end on every note, odd and even partials split left and right; velocity plucks brighter and the strings ring on after release. Shared input Brightness.",
    tags: ["pluck", "harp", "string", "physical"],
  }).settings({ voices: 12 }).input("bright", "Brightness");
  const res = p.add("resonator", [0, 0], { model: "String", structure: 0.1, brightness: 0.5, damping: 0.35, position: 0.2,
    exciter: 0.8, width: 0.5 });
  p.cable(p.vin, "pitch", res, "pitch").cable(p.vin, "trigger", res, "strum")
    .cable(p.vin, "velocity", res, "brightness", 0.25).cable(p.cin, "bright", res, "brightness", 0.4);
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [1, 1],
    { attack: 0.001, decay: 0.5, sustain: 1, release: 2.5, velamount: 0.6 });
  return p;
}

// Macro Osc Pluck with a little pitch press at the start and a late vibrato: koto.
function silkKoto() {
  const p = voice("Silk Koto", {
    description: "Macro Osc's plucked string picked hard near the bridge, starting a shade sharp and settling, with a vibrato that fades in on held notes: a koto-like pluck.",
    tags: ["pluck", "koto", "string", "eastern"],
  }).settings({ voices: 8, spread: 0.3 });
  const mo = p.add("macro-osc", [1, 0], { model: "Pluck", tone: 0.75, shape: 0.35, blend: 0.12, decay: 1.6, level: 0.8 });
  const bend = envelope(p, [0, 1], { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05, velamount: 0.6 }, "Press");
  const vib = p.add("lfo", [0, 2], { rate: 5.5, fade: 0.7 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", mo, "pitch").cable(bend, "env", mo, "pitch", semis(0.5)).cable(vib, "sine", mo, "pitch", semis(0.2))
    .cable(p.vin, "trigger", mo, "trig").cable(p.vin, "velocity", mo, "accent");
  ampEnvelope(p, { node: mo }, [2, 1], { attack: 0.001, decay: 0.5, sustain: 1, release: 1.2, velamount: 0.2 });
  return p;
}

// Perc Voice Modal engine on bar partials: kalimba tines.
function thumbKalimba() {
  const p = voice("Thumb Kalimba", {
    description: "Perc Voice strikes metal tines (bar partials) with a soft click and a short, woody ring; velocity is the accent and every voice is struck a little differently.",
    tags: ["pluck", "kalimba", "percussive", "tines"],
  }).settings({ voices: 10, spread: 0.4 }).input("decay", "Decay");
  const pv = p.add("perc-voice", [1, 0], { engine: "Modal", pitch: 261.63, tone: 0.67, morph: 0.3, click: 0.4, decay: 1.2,
    damp: 0.65, sweep: 0.03, spread: 0.3, level: 0.8 });
  p.cable(p.vin, "pitch", pv, "pitch").cable(p.vin, "trigger", pv, "trig").cable(p.vin, "velocity", pv, "accent")
    .cable(p.vin, "random", pv, "morph", 0.08).cable(p.cin, "decay", pv, "decay", 0.4)
    .stereo(pv, p.vout).cable(pv, "active", p.vout, "active");
  return p;
}

// Perc Voice FM between membrane and bar partials: a steel pan.
function islandSteelpan() {
  const p = voice("Island Steelpan", {
    description: "Perc Voice's FM engine between membrane and bar ratios, a bright attack that mellows into a hollow ring: a steel drum; harder hits are brighter.",
    tags: ["mallet", "steel drum", "fm", "tropical"],
  }).settings({ voices: 8, spread: 0.5 }).input("bright", "Brightness");
  const pv = p.add("perc-voice", [1, 0], { engine: "FM", pitch: 261.63, tone: 0.5, morph: 0.25, click: 0.15, decay: 1.1,
    damp: 0.5, sweep: 0.03, spread: 0.4, level: 0.75, drive: "Warm" });
  p.cable(p.vin, "pitch", pv, "pitch").cable(p.vin, "trigger", pv, "trig").cable(p.vin, "velocity", pv, "accent")
    .cable(p.vin, "velocity", pv, "morph", 0.15).cable(p.cin, "bright", pv, "morph", 0.3)
    .stereo(pv, p.vout).cable(pv, "active", p.vout, "active");
  return p;
}

// Macro Osc FM at an inharmonic 3.5 ratio, index from velocity: a temple bell.
function templeFmBell() {
  const p = voice("Temple FM Bell", {
    description: "Macro Osc's two-operator FM at an inharmonic 3.5 ratio, struck by each note with a long decay that darkens as it fades; velocity raises the index. Shared input Index.",
    tags: ["mallet", "bell", "fm", "metallic"],
  }).settings({ voices: 8, spread: 0.5 }).input("index", "Index");
  const mo = p.add("macro-osc", [1, 0], { model: "FM", tone: 0.59, shape: 0.4, blend: 0.05, decay: 4, gateColour: 0.6, level: 0.75 });
  p.cable(p.vin, "pitch", mo, "pitch").cable(p.vin, "trigger", mo, "trig").cable(p.vin, "velocity", mo, "accent")
    .cable(p.vin, "velocity", mo, "shape", 0.2).cable(p.cin, "index", mo, "shape", 0.4);
  ampEnvelope(p, { node: mo }, [2, 1], { attack: 0.001, decay: 1, sustain: 1, release: 3, velamount: 0.2 });
  return p;
}

// A folded triangle pinged through a Low Pass Gate: West-coast bongo.
function vactrolBongo() {
  const p = voice("Vactrol Bongo", {
    description: "A lightly folded, FM'd Dual Osc pinged through a resonant Low Pass Gate whose light also opens the folder: the woody West-coast bongo. Shared inputs Brightness and Decay.",
    tags: ["pluck", "west coast", "lpg", "bongo"],
  }).settings({ voices: 8, spread: 0.4 }).input("bright", "Brightness").input("decay", "Decay");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.33, shapeB: 0, octaveB: 1, fmDepth: 0.12, balance: 0, fold: 0.2, drift: 0.05 });
  const lpg = p.add("low-pass-gate", [1, 0], { response: 0.35, ping: 0.9, resonance: 0.4, brightness: 0.6, mode: "Both", cell: "Classic" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(osc, "a", lpg, "l")
    .cable(p.vin, "trigger", lpg, "ping").cable(p.vin, "velocity", lpg, "velocity")
    .cable(lpg, "light", osc, "fold", 0.4).cable(p.cin, "bright", lpg, "brightness", 0.4).cable(p.cin, "decay", lpg, "response", 0.4)
    .stereo(lpg, p.vout).cable(lpg, "active", p.vout, "active");
  return p;
}

// Macro Osc Modal, an octave up with hard bright tines: music box.
function musicBoxTines() {
  const p = voice("Music Box Tines", {
    description: "Macro Osc's Modal model an octave up, hard and bright with slightly stretched modes: the plinking comb of a music box; velocity is the strike.",
    tags: ["mallet", "music box", "bright", "toy"],
  }).settings({ voices: 12, spread: 0.5 });
  const mo = p.add("macro-osc", [1, 0], { model: "Modal", octave: 1, tone: 0.35, shape: 0.75, blend: 0.08, decay: 1.5, level: 0.8,
    quality: "High" });
  p.cable(p.vin, "pitch", mo, "pitch").cable(p.vin, "trigger", mo, "trig").cable(p.vin, "velocity", mo, "accent");
  ampEnvelope(p, { node: mo }, [2, 1], { attack: 0.001, decay: 0.5, sustain: 1, release: 1.5, velamount: 0.2 });
  return p;
}

// A noise burst into a stiff-string Resonator body: hammered dulcimer.
function hammeredDulcimer() {
  const p = voice("Hammered Dulcimer", {
    description: "A short noise burst, louder and brighter with velocity, hammers a stiff metal string in the Resonator: a ringing hammered dulcimer. Shared input Brightness.",
    tags: ["mallet", "dulcimer", "string", "physical"],
  }).settings({ voices: 10, spread: 0.4 }).input("bright", "Brightness");
  const nz = p.add("noise", [0, 0], { colour: 0.2 });
  const hit = envelope(p, [0, 1], { attack: 0.001, decay: 0.012, sustain: 0, release: 0.01, velamount: 1 }, "Hammer");
  const burst = p.add("vca", [1, 0], {}, { name: "Burst" });
  const hp = p.add("filter", [2, 0], { cutoff: 1500, resonance: 0.1, mode: 0.5, type: "SVF Multimode" }, { name: "Hammer Tone" });
  const res = p.add("resonator", [3, 0], { model: "Modal", structure: 0.25, brightness: 0.7, damping: 0.3, position: 0.12,
    exciter: 0.15, inputgain: 6, width: 0.7 });
  p.cable(nz, "white", burst, "l").cable(hit, "env", burst, "gain")
    .cable(burst, "l", hp, "l").cable(p.vin, "velocity", hp, "cutoff", 0.15)
    .cable(hp, "l", res, "in").cable(p.vin, "pitch", res, "pitch").cable(p.vin, "trigger", res, "strum")
    .cable(p.cin, "bright", res, "brightness", 0.4);
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [4, 1],
    { attack: 0.001, decay: 0.5, sustain: 1, release: 2, velamount: 0.4 });
  return p;
}

export default category("Plucks & Mallets", "Struck, plucked and pinged Voice Cells (physical models, mallets, strings and bells) that follow velocity: patch Notes in and Out L/R out.", [
  rosewoodMarimba, midnightVibraphone, celticHarp, silkKoto, thumbKalimba, islandSteelpan, templeFmBell, vactrolBongo,
  musicBoxTines, hammeredDulcimer,
]);
