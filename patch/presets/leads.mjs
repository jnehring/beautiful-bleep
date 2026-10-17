// SPDX-License-Identifier: MIT
// Leads: monophonic and few-voice Voice Cells for melodies and solos. Notes in, Out L/R.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Two saws, a filter that swells open on the attack like a played horn section.
function copperHorn() {
  const p = voice("Copper Horn", {
    description: "Two slightly detuned saws into a ladder that swells open after the attack, with a late vibrato: a bold, brassy solo line. Shared inputs Cutoff and Bend.",
    tags: ["mono", "lead", "brass", "analog", "swell"],
    help: "Two saw Oscillators, a few cents apart, feed a Ladder Tanh filter at 700 Hz. A Filter Env opens it " +
      "to several times that after a short swell, the way a horn section blooms, and velocity pushes it " +
      "further. A Vibrato LFO fades in on held notes. Mono, legato, short glide.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter; Bend bends both saws by up to 2 " +
      "semitones, so patch a pitch-bend source there.\n\n" +
      "Tip: play hard for the bright, blaring side of the filter and soft for a mellow one.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.03, glidemode: "Legato only" }).input("cut", "Cutoff").input("bend", "Bend");
  const o1 = p.add("oscillator", [0, 0], { fine: -6 }, { name: "Saw 1" });
  const o2 = p.add("oscillator", [0, 1], { fine: 6 }, { name: "Saw 2" });
  const vib = p.add("lfo", [0, 2], { rate: 5.2, fade: 1.1 }, { name: "Vibrato" });
  const envf = envelope(p, [0, 3], { attack: 0.09, decay: 0.5, sustain: 0.55, release: 0.25, velamount: 0.7 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 700, resonance: 0.2, drive: 0.3, keytrack: 0.5, type: "Ladder Tanh" });
  for (const o of [o1, o2])
    p.cable(p.vin, "pitch", o, "pitch").cable(vib, "sine", o, "pitch", semis(0.25)).cable(p.cin, "bend", o, "pitch", semis(2))
      .cable(o, "out", flt, "l", 0.6);
  p.cable(p.vin, "pitch", flt, "pitch").cable(envf, "env", flt, "cutoff", 0.35).cable(p.cin, "cut", flt, "cutoff", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.03, decay: 0.3, sustain: 0.95, release: 0.2, velamount: 0.5 });
  return p;
}

// Additive: a few soft partials, chorused, pressure opens the top end.
function glassHarmonica() {
  const p = voice("Glass Harmonica", {
    description: "Additive partials rolled off steeply and chorused wide, with a slow vibrato: a pure, ringing, singing-glass lead; pressure adds upper harmonics. Shared input Brightness.",
    tags: ["mono", "lead", "additive", "glass", "pure"],
    help: "An Additive Osc with only a handful of saw partials and a steep Tilt, so the tone is nearly a sine " +
      "with a halo. Its built-in chorus and width spread it across the stereo field. A slow Vibrato LFO " +
      "fades in, and channel pressure raises the Tilt to add upper partials. Mono, legato.\n\n" +
      "Notes in, Out L/R. The shared input Brightness adds to the Tilt, so turning it up brings in more " +
      "partials.\n\n" +
      "Tip: play high, slow melodies and lean on the key for the bright, glassy edge.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.04, glidemode: "Legato only" }).input("bright", "Brightness");
  const add = p.add("additive-osc", [0, 0], { partials: 10, tilt: -14, chorus: 14, chorusRate: 0.4, width: 0.7 });
  const vib = p.add("lfo", [0, 1], { rate: 5, fade: 1.4 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", add, "pitch").cable(vib, "sine", add, "pitch", semis(0.22))
    .cable(p.vin, "pressure", add, "tilt", 0.25).cable(p.cin, "bright", add, "tilt", 0.3);
  ampEnvelope(p, { node: add, stereo: true, jacks: ["outL", "outR"] }, [1, 1], { attack: 0.07, decay: 0.4, sustain: 0.9, release: 0.5, velamount: 0.4 });
  return p;
}

// Wavetable vowel bank scanned by a swell and by pressure.
function wavetableSiren() {
  const p = voice("Wavetable Siren", {
    description: "A vowel-bank wavetable that scans from one cycle to the next as each note swells, with pressure on the second axis: a vocal, wailing lead. Shared input Scan.",
    tags: ["mono", "lead", "wavetable", "vocal", "evolving"],
    help: "A Wavetable Osc on the Vowel bank. An envelope pushes the X position across the table after each " +
      "note-on, and pressure moves Y. A quiet vibrato is added and a 1-Pole low-pass at 9 kHz tames the " +
      "top. Mono, legato.\n\n" +
      "Notes in, Out L/R. The shared input Scan adds to the X position, so a knob or LFO there picks " +
      "which vowel the lead sits on.\n\n" +
      "Tip: hold a long note and turn Scan to hear the table change shape underneath you.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.05, glidemode: "Legato only" }).input("scan", "Scan");
  const wt = p.add("wavetable-osc", [0, 0], { bank: "Vowel", x: 0.15, y: 0.2, stereo: 0.2, subLevel: 0.15 });
  const envx = envelope(p, [0, 1], { attack: 0.35, decay: 1.2, sustain: 0.5, release: 0.4, velamount: 0.4 }, "Scan Env");
  const vib = p.add("lfo", [0, 2], { rate: 5.6, fade: 0.8 }, { name: "Vibrato" });
  const flt = p.add("filter", [1, 0], { cutoff: 9000, resonance: 0.05, type: "1-Pole Low-pass" });
  p.cable(p.vin, "pitch", wt, "pitch").cable(vib, "sine", wt, "pitch", semis(0.2)).cable(envx, "env", wt, "x", 0.45)
    .cable(p.vin, "pressure", wt, "y", 0.4).cable(p.cin, "scan", wt, "x", 0.5)
    .stereo(wt, flt, { from: ["outL", "outR"] });
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.02, decay: 0.3, sustain: 0.95, release: 0.3, velamount: 0.4 });
  return p;
}

// Ring modulation of two cores, a pitch dive on the attack.
function ringmodComet() {
  const p = voice("Ringmod Comet", {
    description: "Two cores ring-modulated at a tunable interval, falling in from above on every note: a clanging, sci-fi lead with a metallic bite. Shared input Ratio.",
    tags: ["mono", "lead", "ring mod", "metallic", "sci-fi"],
    help: "A Dual Osc whose ring-modulated output carries the sound: the product of both cores, a metallic " +
      "tone whose sidebands depend on the interval between them. A Dive Env drops the pitch by about seven " +
      "semitones in the first moments of each note. A Ladder Linear low-pass at 4 kHz rounds it off. Mono.\n\n" +
      "Notes in, Out L/R. The shared input Ratio adds to the tuning of core B, so turning it changes the " +
      "interval and with it the clang.\n\n" +
      "Tip: sweep Ratio slowly while you hold a note, or park it where the sound turns bell-like.",
  }).settings({ voices: 1, mode: "Mono", glide: 0.02 }).input("ratio", "Ratio");
  const dual = p.add("dual-osc", [0, 0], { octaveB: 0, tuneB: 7, shapeA: 0.5, shapeB: 0.3, drift: 0.2 });
  const dive = envelope(p, [0, 1], { attack: 0.001, decay: 0.14, sustain: 0, release: 0.1, velamount: 0 }, "Dive Env");
  const flt = p.add("filter", [1, 0], { cutoff: 4000, resonance: 0.15, keytrack: 0.4, type: "Ladder Linear" });
  p.cable(p.vin, "pitch", dual, "pitch").cable(dive, "env", dual, "pitch", semis(7)).cable(p.cin, "ratio", dual, "tuneB", 0.3)
    .cable(dual, "ring", flt, "l").cable(dual, "ring", flt, "r").cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.003, decay: 0.4, sustain: 0.8, release: 0.2 });
  return p;
}

// Narrow pulse that plunges onto each note.
function pitchDropPulse() {
  const p = voice("Pitch Drop Pulse", {
    description: "A bright pulse with a sub that lands on each note from a fifth above in a few milliseconds, with a slowly breathing width: a punchy, squelchy electro lead. Shared input Width.",
    tags: ["mono", "lead", "pulse", "electro", "punchy"],
    help: "A pulse Oscillator plus its own sub, through an SVF low-pass at 3.2 kHz. A very short Drop Env " +
      "adds seven semitones to the pitch and lets it fall away, so every note lands with a chirp. A slow " +
      "LFO makes the pulse width breathe. Mono, short glide.\n\n" +
      "Notes in, Out L/R. The shared input Width adds to the pulse width.\n\n" +
      "Tip: play staccato, rhythmic lines and move Width for thinner or fatter tones.",
  }).settings({ voices: 1, mode: "Mono", glide: 0.02 }).input("pw", "Width");
  const osc = p.add("oscillator", [0, 0], { shape: 1, pw: 0.3 });
  const drop = envelope(p, [0, 1], { attack: 0.001, decay: 0.07, sustain: 0, release: 0.05, velamount: 0 }, "Drop Env");
  const lfo = p.add("lfo", [0, 2], { rate: 0.7, wave: "Triangle" }, { name: "Width LFO" });
  const flt = p.add("filter", [1, 0], { cutoff: 3200, resonance: 0.3, drive: 0.2, keytrack: 0.5, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(drop, "env", osc, "pitch", semis(7)).cable(lfo, "out", osc, "pw", 0.12)
    .cable(p.cin, "pw", osc, "pw", 0.35).cable(osc, "out", flt, "l", 0.55).cable(osc, "sub", flt, "l", 0.4)
    .cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.002, decay: 0.25, sustain: 0.75, release: 0.12 });
  return p;
}

// Formant oscillator whose peak sweeps with a swell and pressure.
function formantCry() {
  const p = voice("Formant Cry", {
    description: "A pulse-formant oscillator whose resonant peak sweeps up on every note and with pressure, with a hint of vibrato: a wah-like, crying lead with no filter. Shared input Formant.",
    tags: ["mono", "lead", "formant", "vocal", "expressive"],
    help: "A Formant Osc: a resonant peak that moves through the harmonics, vocal and filter-like with no " +
      "filter in sight. A Formant Env raises the peak after each note-on, and pressure raises it further. " +
      "A Vibrato LFO fades in. Mono, legato.\n\n" +
      "Notes in, Out L/R. The shared input Formant adds to the peak position, so a knob or mod wheel there " +
      "gives you the wah by hand.\n\n" +
      "Tip: play long notes and ride the pressure for a voice that seems to speak.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.05, glidemode: "Legato only" }).input("form", "Formant");
  const fo = p.add("formant-osc", [0, 0], { formant: 1.5, narrow: 0.4, body: 0.6, spread: 0.3 });
  const envf = envelope(p, [0, 1], { attack: 0.18, decay: 0.8, sustain: 0.35, release: 0.3, velamount: 0.5 }, "Formant Env");
  const vib = p.add("lfo", [0, 2], { rate: 5.3, fade: 0.9 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", fo, "pitch").cable(vib, "sine", fo, "pitch", semis(0.25)).cable(envf, "env", fo, "formant", 0.15)
    .cable(p.vin, "pressure", fo, "formant", 0.12).cable(p.cin, "form", fo, "formant", 0.25);
  ampEnvelope(p, { node: fo, stereo: true, jacks: ["outL", "outR"] }, [1, 1], { attack: 0.05, decay: 0.3, sustain: 0.9, release: 0.3, velamount: 0.4 });
  return p;
}

// Physically modelled bowed string.
function bowedWire() {
  const p = voice("Bowed Wire", {
    description: "A modelled string kept sounding by a bow, with a delayed vibrato: a rosiny, expressive solo-string lead that responds to how hard you play. Shared input Bow Pressure.",
    tags: ["mono", "lead", "bowed", "physical model", "string"],
    help: "A Modal Voice in string geometry driven by its Bow, with the Bow Timbre in the middle and some " +
      "damping so the note dies away cleanly. A Vibrato LFO fades in; velocity and the gate drive the bow. " +
      "An amp envelope shapes the entry and frees the voice. Mono, legato.\n\n" +
      "Notes in, Out L/R. The shared input Bow Pressure adds to the bow, so more of it gives a rougher, " +
      "more insistent tone.\n\n" +
      "Tip: play legato and vary Bow Pressure for the scratch and the singing side of the bow.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.04, glidemode: "Legato only" }).input("bow", "Bow Pressure");
  const mv = p.add("modal-voice", [0, 0], { bow: 0.55, bowTimbre: 0.5, strike: 0, geometry: 0.1, brightness: 0.65, damping: 0.35, position: 0.35, space: 0.15 });
  const vib = p.add("lfo", [0, 1], { rate: 5.4, fade: 1 }, { name: "Vibrato" });
  p.cable(p.vin, "pitch", mv, "pitch").cable(p.vin, "gate", mv, "gate").cable(p.vin, "velocity", mv, "velocity")
    .cable(vib, "sine", mv, "pitch", semis(0.25)).cable(p.cin, "bow", mv, "bow", 0.4);
  ampEnvelope(p, { node: mv, stereo: true }, [1, 1], { attack: 0.04, decay: 0.3, sustain: 0.95, release: 0.35, velamount: 0.3 });
  return p;
}

// Phase-warp model with an envelope sweeping the macro.
function phaseWhip() {
  const p = voice("Phase Whip", {
    description: "A phase-warp oscillator whose shape cracks open on the attack and settles to a hollow, nasal tone: a snappy, vocal-edged mono lead. Shared input Warp.",
    tags: ["mono", "lead", "phase warp", "snappy", "nasal"],
    help: "A Macro Osc in Phase Warp mode. A Warp Env pushes Shape up at each note-on and lets it fall to a " +
      "sustained level, giving a quick whip of harmonics. An SVF filter at 5 kHz smooths the top. Mono, " +
      "legato.\n\n" +
      "Notes in, Out L/R. The shared input Warp adds to the Tone macro, which changes the character of the " +
      "warp itself.\n\n" +
      "Tip: play staccato to hear the whip on every note, legato for a smoother line.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.04, glidemode: "Legato only" }).input("warp", "Warp");
  const mo = p.add("macro-osc", [0, 0], { model: "Phase Warp", tone: 0.4, shape: 0.25, blend: 0.2, level: 0.8 });
  const envw = envelope(p, [0, 1], { attack: 0.002, decay: 0.35, sustain: 0.3, release: 0.2, velamount: 0.8 }, "Warp Env");
  const flt = p.add("filter", [1, 0], { cutoff: 5000, resonance: 0.1, keytrack: 0.4, type: "SVF Multimode" });
  p.cable(p.vin, "pitch", mo, "pitch").cable(envw, "env", mo, "shape", 0.5).cable(p.cin, "warp", mo, "tone", 0.5)
    .cable(mo, "out", flt, "l").cable(mo, "out", flt, "r").cable(p.vin, "pitch", flt, "pitch");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.004, decay: 0.3, sustain: 0.9, release: 0.2 });
  return p;
}

// Chord oscillator locked to a fifth: a one-finger power-chord lead.
function powerFifthLead() {
  const p = voice("Power Fifth Lead", {
    description: "Each note sounds with its fifth and octave through a driven ladder: one-finger power chords that turn single notes into a stadium-sized rock lead. Shared inputs Cutoff and Drive.",
    tags: ["lead", "rock", "power chord", "chord", "driven"],
    help: "A Chord Osc set to a fifth with three voices, a little detune and wide stereo, so every key gives " +
      "root, fifth and octave. They pass through a Ladder Hyperbolic filter at 3 kHz with its Drive turned up. " +
      "Two voices, legato.\n\n" +
      "Notes in, Out L/R. The shared input Cutoff moves the filter and Drive adds more grit.\n\n" +
      "Tip: play simple, strong melodies; the chord is already in the sound.",
  }).settings({ voices: 2, mode: "Legato", glide: 0.03, glidemode: "Legato only", spread: 0.3 }).input("cut", "Cutoff").input("drive", "Drive");
  const ch = p.add("chord-osc", [0, 0], { chord: "Fifth", voices: 3, detune: 9, stereo: 0.7, shape: 0.67 });
  const envf = envelope(p, [0, 1], { attack: 0.004, decay: 0.4, sustain: 0.6, release: 0.25, velamount: 0.5 }, "Filter Env");
  const flt = p.add("filter", [1, 0], { cutoff: 3000, resonance: 0.2, drive: 0.5, keytrack: 0.4, type: "Ladder Hyperbolic" });
  p.cable(p.vin, "pitch", ch, "pitch").stereo(ch, flt).cable(p.vin, "pitch", flt, "pitch")
    .cable(envf, "env", flt, "cutoff", 0.15).cable(p.cin, "cut", flt, "cutoff", 0.5).cable(p.cin, "drive", flt, "drive", 0.5);
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.004, decay: 0.3, sustain: 0.9, release: 0.25 });
  return p;
}

// Two high carriers mixed to their difference: a heterodyne whistle.
function heterodyneWhistle() {
  const p = voice("Heterodyne Whistle", {
    description: "Two high carriers beat against each other to give an eerie, whistling tone that wobbles in and out of lock: a ghostly, lab-instrument lead. Shared input Beat.",
    tags: ["mono", "lead", "heterodyne", "eerie", "theremin"],
    help: "A Beat Oscillator: two high carriers mixed down to the difference between them, with drift so that " +
      "the pitch never sits perfectly still and a slow vibrato on top. A Ladder Linear low-pass at 6 kHz " +
      "smooths the edges. Mono, legato with a glide.\n\n" +
      "Notes in, Out L/R. The shared input Beat adds to the beat knob, shifting the whistle off its pitch.\n\n" +
      "Tip: play long, slow phrases and nudge Beat to bring the pitch in and out of focus.",
  }).settings({ voices: 1, mode: "Legato", glide: 0.12, glidemode: "Always" }).input("beat", "Beat");
  const bo = p.add("beat-oscillator", [0, 0], { carrier: 8000, beat: 0.45, drift: 0.2, pull: 0.1 });
  const vib = p.add("lfo", [0, 1], { rate: 5.5, fade: 1.2 }, { name: "Vibrato" });
  const flt = p.add("filter", [1, 0], { cutoff: 6000, resonance: 0.1, type: "Ladder Linear" });
  p.cable(p.vin, "pitch", bo, "pitch").cable(vib, "sine", bo, "pitch", semis(0.3)).cable(p.cin, "beat", bo, "beat", 0.15)
    .cable(bo, "out", flt, "l").cable(bo, "out", flt, "r");
  ampEnvelope(p, { node: flt, stereo: true }, [2, 1], { attack: 0.06, decay: 0.3, sustain: 0.9, release: 0.35, velamount: 0.3 });
  return p;
}

export default category("Leads", "Monophonic and few-voice Voice Cells for melodies and solos, from brass swells and glass partials to ring-mod, vowel, bowed and heterodyne voices: patch Notes in and Out L/R out.", [
  copperHorn, glassHarmonica, wavetableSiren, ringmodComet, pitchDropPulse, formantCry, bowedWire, phaseWhip, powerFifthLead, heterodyneWhistle,
]);
