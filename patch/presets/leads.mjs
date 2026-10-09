// SPDX-License-Identifier: MIT
// Leads: monophonic and few-voice Voice Cells for melodies. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Two saws into a ladder, a vibrato that fades in on held notes.
function vibratoBloom() {
  const p = voice("Vibrato Bloom", {
    description: "Two slightly detuned saws into a warm ladder with a vibrato that fades in on held notes; legato notes glide. Shared inputs Cutoff and Bend (±2 semitones).",
    tags: ["mono", "lead", "analog", "vibrato", "classic"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.05, glidemode: "Legato only" }).input("cut", "Cutoff").input("bend", "Bend");
  const o1 = p.add("oscillator", [0, 0], { fine: -5 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [0, 1], { fine: 5 }, { name: "Saw 2" });
  const vib = p.add("lfo", [0, 2], { rate: 5.6, fade: 0.9 }, { name: "Vibrato" });
  const envf = envelope(p, [0, 3], { attack: 0.005, decay: 0.5, sustain: 0.5, release: 0.3, velamount: 0.5 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 1100, resonance: 0.3, drive: 0.25, keytrack: 0.5, type: "Ladder Tanh" });
  for (const o of [o1, o2])
    p.cable(p.vin, "pitch", o, "pitch").cable(vib, "sine", o, "pitch", semis(0.3)).cable(p.cin, "bend", o, "pitch", semis(2))
      .cable(o, "out", flt, "l", 0.55);
  p.cable(p.vin, "pitch", flt, "pitch").cable(envf, "env", flt, "cutoff", 0.3).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.006, decay: 0.4, sustain: 0.85, release: 0.25 });
  return p;
}

// Pulse width swept by an LFO and by aftertouch, filter opened by pressure.
function pressurePulse() {
  const p = voice("Pressure Pulse", {
    description: "A slowly swept PWM square whose width and brightness follow aftertouch; the shared Mod input adds vibrato depth, as a mod wheel would. Shared inputs Mod and Cutoff.",
    tags: ["mono", "lead", "pwm", "expressive", "pressure"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.03 }).input("mod", "Mod").input("cut", "Cutoff");
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.5 });
  const pwm = p.add("lfo", [0, 1], { rate: 0.7 }, { name: "PWM LFO" });
  const vib = p.add("lfo", [0, 2], { rate: 5.2 }, { name: "Vibrato" });
  const depth = p.add("multiplier", [1, 2], {}, { name: "Mod Depth" });
  const flt = p.add("filter", [1, 0], { cutoff: 1500, resonance: 0.25, keytrack: 0.5, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(pwm, "triangle", osc, "pw", 0.3).cable(p.vin, "pressure", osc, "pw", -0.25)
    .cable(vib, "sine", depth, "x1").cable(p.cin, "mod", depth, "y1").cable(depth, "out1", osc, "pitch", semis(0.6))
    .cable(osc, "out", flt, "l").cable(p.vin, "pitch", flt, "pitch")
    .cable(p.vin, "pressure", flt, "cutoff", 0.25).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.2 });
  return p;
}

// Hard sync swept by an envelope and an LFO into a driven filter.
function syncScream() {
  const p = voice("Sync Scream", {
    description: "Dual Osc in hard sync: an envelope rips the synced core's pitch up and a slow LFO keeps it tearing while held, into a driven filter. Shared input Sync Sweep.",
    tags: ["mono", "lead", "sync", "aggressive", "rock"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.04 }).input("sweep", "Sync Sweep");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0.67, octaveB: 0, sync: 1, balance: 0, tuneA: 7, drift: 0.15 });
  const envs = envelope(p, [0, 1], { attack: 0.001, decay: 0.6, sustain: 0.25, release: 0.3, velamount: 0.6 }, "Sync Env");
  const lfo = p.add("lfo", [0, 2], { rate: 0.35, fade: 0.5 }, { name: "Sweep LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 4500, resonance: 0.25, drive: 0.6, keytrack: 0.3, type: "Ladder Hyperbolic" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(envs, "env", osc, "tuneA", 0.35).cable(lfo, "triangle", osc, "tuneA", 0.12)
    .cable(p.cin, "sweep", osc, "tuneA", 0.3).cable(osc, "a", flt, "l").cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.3, sustain: 0.9, release: 0.25 });
  return p;
}

// Macro Osc FM at an inharmonic ratio with a ringing tail: a bell lead.
function carillonLead() {
  const p = voice("Carillon Lead", {
    description: "Macro Osc in FM mode at a bell-like ratio, its index bright on the strike and mellowing as the note rings: a chiming bell lead for slow melodies.",
    tags: ["lead", "fm", "bell", "chime"],
  }).settings({ voices: 3, spread: 0.3 });
  const fm = p.add("macro-osc", [0, 0], { model: "FM", tone: 0.85, shape: 0.25, blend: 0.05, level: 0.8 });
  const envi = envelope(p, [0, 1], { attack: 0.001, decay: 1.2, sustain: 0.15, release: 0.8, velamount: 0.8 }, "Index Env");
  const vib = p.add("lfo", [0, 2], { rate: 4.5, fade: 1.2 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", fm, "pitch").cable(envi, "env", fm, "shape", 0.35).cable(vib, "sine", fm, "pitch", semis(0.15));
  ampEnvelope(p, { node: fm }, [1, 1], { attack: 0.001, decay: 2.5, sustain: 0.35, release: 1.2, velamount: 0.6 });
  return p;
}

// The Folder's own oscillator, folds following pressure, symmetry drifting.
function origamiLead() {
  const p = voice("Origami Lead", {
    description: "The Folder's internal triangle folded more with velocity and aftertouch while a slow LFO bends its symmetry: a glassy-to-gnarly West Coast lead. Shared input Fold.",
    tags: ["mono", "lead", "wavefolder", "west coast", "expressive"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.04 }).input("fold", "Fold");
  const wf = p.add("wavefolder", [0, 0], { fold: 0.2, wave: 0.5, spread: 0.4, source: "Internal", level: 0.75 });
  const envw = envelope(p, [0, 1], { attack: 0.01, decay: 0.6, sustain: 0.4, release: 0.3, velamount: 0.8 }, "Fold Env");
  const lfo = p.add("lfo", [0, 2], { rate: 0.4 }, { name: "Symmetry LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 7000, resonance: 0.05, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", wf, "pitch").cable(envw, "env", wf, "fold", 0.35).cable(p.vin, "pressure", wf, "fold", 0.3)
    .cable(lfo, "sine", wf, "symmetry", 0.15).cable(p.cin, "fold", wf, "fold", 0.4).stereo(wf, flt);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.008, decay: 0.4, sustain: 0.85, release: 0.3 });
  return p;
}

// Macro Osc's vowel model, the vowel drifting and singing with vibrato.
function vowelDiva() {
  const p = voice("Vowel Diva", {
    description: "Macro Osc's sung-vowel model: each note opens from \"o\" towards \"a\", with a delayed vibrato and a touch of breath. A wordless solo voice. Shared input Vowel.",
    tags: ["mono", "lead", "vocal", "formant", "choir"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.08 }).input("vow", "Vowel");
  const vo = p.add("macro-osc", [0, 0], { model: "Vowel", tone: 0.55, shape: 0.5, blend: 0.15, level: 0.8 });
  const envv = envelope(p, [0, 1], { attack: 0.25, decay: 0.8, sustain: 0.3, release: 0.4, velamount: 0.3 }, "Vowel Env");
  const vib = p.add("lfo", [0, 2], { rate: 5.4, fade: 0.7 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", vo, "pitch").cable(envv, "env", vo, "tone", -0.4).cable(vib, "sine", vo, "pitch", semis(0.35))
    .cable(p.cin, "vow", vo, "tone", 0.4);
  ampEnvelope(p, { node: vo }, [1, 1], { attack: 0.06, decay: 0.4, sustain: 0.9, release: 0.35, velamount: 0.4 });
  return p;
}

// Always-on portamento on a soft triangle-saw: long sliding melodies.
function slideRibbon() {
  const p = voice("Slide Ribbon", {
    description: "A rounded triangle-and-saw blend that slides slowly to every new note, theremin-like with a gentle vibrato: for long, singing portamento lines. Shared input Bend (±12 semitones).",
    tags: ["mono", "lead", "glide", "portamento", "theremin"],
  }).settings({ voices: 1, mode: "Mono", glide: 0.3, glidemode: "Always" }).input("bend", "Bend");
  const osc = p.add("oscillator", [0, 0], { shape: 0.45 });
  const vib = p.add("lfo", [0, 1], { rate: 6, fade: 0.4 }, { name: "Vibrato" });
  const flt = p.add("filter", [1, 0], { cutoff: 2400, resonance: 0.15, keytrack: 0.6, type: "SVF Atanh Damping" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(vib, "sine", osc, "pitch", semis(0.25)).cable(p.cin, "bend", osc, "pitch", semis(12))
    .cable(osc, "out", flt, "l").cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.03, decay: 0.5, sustain: 0.9, release: 0.4, velamount: 0.2 });
  return p;
}

// Thin pulse flipping between 12.5 % and 25 %, fast vibrato, no filter.
function eightBitHero() {
  const p = voice("8-Bit Hero", {
    description: "A raw, unfiltered 12.5 % pulse whose width flips with the tempo in sixteenths and a quick delayed vibrato: a game-console chiptune lead.",
    tags: ["mono", "lead", "chiptune", "8-bit", "retro"],
  }).settings({ voices: 1, mode: "Mono" });
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.18 });
  const flip = p.add("lfo", [0, 1], { rate: 8, sync: "1/16", wave: "Square" }, { name: "Duty Flip" });
  const vib = p.add("lfo", [0, 2], { rate: 7.5, fade: 0.3 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(flip, "square", osc, "pw", 0.07).cable(vib, "triangle", osc, "pitch", semis(0.4));
  ampEnvelope(p, { node: osc }, [1, 1], { attack: 0.001, decay: 0.15, sustain: 0.7, release: 0.04, velamount: 0 }, { vca: { response: "Linear" } });
  return p;
}

// Six detuned oscillators in unison per note, stereo wide.
function unisonHornet() {
  const p = voice("Unison Hornet", {
    description: "Swarm in unison: six detuned, drifting saws per note spread wide, through a resonant low-pass with a filter envelope: a buzzing, huge trance lead. Shared input Cutoff.",
    tags: ["lead", "supersaw", "unison", "trance", "wide"],
  }).settings({ voices: 2, mode: "Legato", glide: 0.03 }).input("cut", "Cutoff");
  const sw = p.add("swarm", [0, 0], { chord: "Unison", count: 6, detune: 16, drift: 0.25, width: 1, glide: 0 });
  const envf = envelope(p, [0, 1], { attack: 0.003, decay: 0.4, sustain: 0.6, release: 0.3, velamount: 0.5 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 2500, resonance: 0.3, keytrack: 0.4, type: "SVF Saturating (Rough)" });
  p.cable(p.vin, "pitch", sw, "pitch").stereo(sw, flt).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.2).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.004, decay: 0.4, sustain: 0.9, release: 0.3 });
  return p;
}

// Breath noise band-passed at the note's pitch plus a soft triangle: a flute.
function bambooBreath() {
  const p = voice("Bamboo Breath", {
    description: "A soft triangle with pink breath noise band-passed at the note, a slow attack and pressure-controlled breathiness: an airy, flute-like lead. Shared input Breath.",
    tags: ["mono", "lead", "flute", "breathy", "organic"],
  }).settings({ voices: 1, mode: "Legato", glide: 0.02 }).input("breath", "Breath");
  const osc = p.add("oscillator", [0, 0], { shape: 0.3 }, { name: "Tone" });
  const noise = p.add("noise", [0, 1], { colour: -0.2, level: 1 });
  const bp = p.add("filter", [1, 1], { cutoff: 262, resonance: 0.75, keytrack: 1, type: "SVF Bandpass (unit gain)" }, { name: "Breath Band" });
  const vib = p.add("lfo", [0, 2], { rate: 4.8, fade: 0.8 }, { name: "Vibrato" });
  const breath = p.add("vca", [2, 2], { gain: 0.35 }, { name: "Breath Level" });
  const tone = p.add("filter", [1, 0], { cutoff: 3500, resonance: 0.1, keytrack: 0.4, type: "1-Pole Low-pass" }, { name: "Tone LP" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(vib, "sine", osc, "pitch", semis(0.2))
    .cable(noise, "pink", bp, "l").cable(p.vin, "pitch", bp, "pitch").cable(bp, "l", breath, "l")
    .cable(p.vin, "pressure", breath, "gain", 0.4).cable(p.cin, "breath", breath, "gain", 0.5)
    .cable(osc, "out", tone, "l", 0.6).cable(breath, "l", tone, "l", 0.6).cable(p.vin, "pitch", tone, "pitch");
  ampEnvelope(p, { node: tone, stereo: true }, [2, 0], { attack: 0.08, decay: 0.3, sustain: 0.9, release: 0.25, velamount: 0.4 });
  return p;
}

export default category("Leads", "Monophonic and few-voice Voice Cells for melodies and solos, from vintage saws to sync, FM, vocal and chip leads: patch Notes in and Out L/R out.", [
  vibratoBloom, pressurePulse, syncScream, carillonLead, origamiLead, vowelDiva, slideRibbon, eightBitHero, unisonHornet, bambooBreath,
]);
