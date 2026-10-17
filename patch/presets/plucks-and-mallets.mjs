// SPDX-License-Identifier: MIT
// Plucks & Mallets: struck, plucked and pinged Voice Cells. Notes in, Out L/R; velocity plays the hit.
import { voice, category, ampEnvelope, envelope, semis } from "./kit.mjs";

// Additive Osc with a fast-decaying top end: celesta.
function feltCelesta() {
  const p = voice("Felt Celesta", {
    description: "Additive Osc partials with a steep tilt and a short decay, an octave up: the soft, glassy ping of a celesta; velocity opens the top partials. Shared input Brightness.",
    tags: ["mallet", "celesta", "additive", "bell-like", "soft"],
    help: "An Additive Osc an octave up with a downward spectral tilt and a short built-in decay, so every note is a " +
      "quick glassy ping that dies away. A small amount of velocity is cabled to Tilt, so harder keys have more " +
      "upper partials. An amp envelope with a one second release lets the tail fade out.\n\n" +
      "Patch Notes in and take Out L/R. The Brightness input adds to the Tilt: turn it up for a harder, " +
      "more metallic celesta, down for a dull felt tone.\n\n" +
      "Tip: play two-handed octaves in the upper half of the keyboard; the sound is already shifted up.",
  }).settings({ voices: 12, spread: 0.45 }).input("bright", "Brightness");
  const osc = p.add("additive-osc", [0, 0], { octave: 1, partials: 24, tilt: -9, oddEven: 0.15, stretch: 0.04, decay: 0.9, damp: 0.7,
    base: "Saw" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(p.vin, "trigger", osc, "trigger")
    .cable(p.vin, "velocity", osc, "tilt", 0.12).cable(p.cin, "bright", osc, "tilt", 0.3);
  ampEnvelope(p, { node: osc, stereo: true, jacks: ["outL", "outR"] }, [1, 1],
    { attack: 0.001, decay: 0.6, sustain: 0, release: 1, velamount: 0.5 });
  return p;
}

// Resonator String model, damped and plucked in the middle of the string: nylon guitar.
function nylonGuitarPluck() {
  const p = voice("Nylon Guitar Pluck", {
    description: "Resonator's String model plucked mid-string with firm damping and a soft low-pass for the body: a warm nylon-string guitar pluck. Shared inputs Brightness and Body.",
    tags: ["pluck", "guitar", "string", "acoustic", "warm"],
    help: "A Resonator in String model, strummed by each note. Its damping is high so the string decays in about a " +
      "second, and the pluck is in the middle of the string for a round tone. The result goes through a low-pass " +
      "filter named Body, which acts as the guitar's wooden box.\n\n" +
      "Patch Notes in and take Out L/R. Brightness raises the string's brightness, Body opens or closes the " +
      "filter. Velocity plucks harder and brighter.\n\n" +
      "Tip: play three- and four-note chords with a little roll between the keys for a strummed feel.",
  }).settings({ voices: 8, spread: 0.3 }).input("bright", "Brightness").input("body", "Body");
  const res = p.add("resonator", [0, 0], { model: "String", structure: 0.05, brightness: 0.38, damping: 0.62, position: 0.5,
    exciter: 0.85, width: 0.3 });
  const body = p.add("filter", [1, 0], { cutoff: 2600, resonance: 0.12, type: "SVF Multimode" }, { name: "Body" });
  p.cable(p.vin, "pitch", res, "pitch").cable(p.vin, "trigger", res, "strum")
    .cable(p.vin, "velocity", res, "brightness", 0.3).cable(p.cin, "bright", res, "brightness", 0.4)
    .cable(p.cin, "body", body, "cutoff", 0.3).cable(p.vin, "velocity", body, "cutoff", 0.08)
    .stereo(res, body, { from: ["odd", "even"] });
  ampEnvelope(p, { node: body, stereo: true }, [2, 1], { attack: 0.001, decay: 0.8, sustain: 0.5, release: 0.8, velamount: 0.5 });
  return p;
}

// Macro Osc Pluck with a snappy band-pass for the drum-head body: banjo.
function banjoSnap() {
  const p = voice("Banjo Snap", {
    description: "Macro Osc's plucked string, picked hard and bright, through a nasal band-pass that stands in for the drum-head: a short, twangy banjo. Shared input Twang.",
    tags: ["pluck", "banjo", "string", "folk", "bright"],
    help: "A Macro Osc in Pluck model with a high Tone and a short decay, struck by each note. The signal goes " +
      "through a band-pass filter named Head, which gives the nasal, tight banjo drum-head sound. Velocity " +
      "sets the pick accent and nudges the filter up a little.\n\n" +
      "Patch Notes in and take Out L/R. The Twang input moves the centre frequency of the Head filter: a mod " +
      "wheel there turns a mellow banjo into a sharp one.\n\n" +
      "Tip: play fast alternating notes, as in a roll, with a short gate.",
  }).settings({ voices: 8, spread: 0.2 }).input("twang", "Twang");
  const mo = p.add("macro-osc", [0, 0], { model: "Pluck", tone: 0.85, shape: 0.55, blend: 0.1, decay: 0.55, level: 0.85 });
  const head = p.add("filter", [1, 0], { cutoff: 1900, resonance: 0.4, mode: 0.33, type: "SVF Multimode" }, { name: "Head" });
  p.cable(p.vin, "pitch", mo, "pitch").cable(p.vin, "trigger", mo, "trig").cable(p.vin, "velocity", mo, "accent")
    .cable(p.cin, "twang", head, "cutoff", 0.3).cable(p.vin, "velocity", head, "cutoff", 0.06)
    .cable(mo, "out", head, "l").cable(mo, "out", head, "r");
  ampEnvelope(p, { node: head, stereo: true }, [2, 1], { attack: 0.001, decay: 0.45, sustain: 0.2, release: 0.35, velamount: 0.4 });
  return p;
}

// Two detuned modal bars, the beating pair of a gamelan metallophone.
function gamelanTwinBars() {
  const p = voice("Gamelan Twin Bars", {
    description: "Two Modal Voices strike metal bars tuned a few cents apart, so every note shimmers with a slow beating: a paired-bar metallophone. Shared input Beating.",
    tags: ["mallet", "gamelan", "metallophone", "shimmer", "world"],
    help: "Two Modal Voices in a bar geometry strike with a medium-hard mallet, tuned slightly apart (about 7 cents " +
      "up and down), and a small Audio Mixer pans one a little left and the other right. The pair beats slowly, " +
      "the shimmer typical of paired gamelan bars. Velocity strikes harder.\n\n" +
      "Patch Notes in and take Out L/R. The Beating input adds fine detune to the second voice (in effect " +
      "faster or slower shimmer).\n\n" +
      "Tip: play slow, ringing melodies in the middle of the keyboard and let the notes overlap.",
  }).settings({ voices: 8, spread: 0.2 }).input("beat", "Beating");
  const a = p.add("modal-voice", [0, 0], { strike: 0.8, strikeTimbre: 0.55, geometry: 0.55, brightness: 0.62, damping: 0.3,
    position: 0.3, space: 0, fine: -7 }, { name: "Bar A" });
  const b = p.add("modal-voice", [0, 1], { strike: 0.8, strikeTimbre: 0.55, geometry: 0.55, brightness: 0.62, damping: 0.3,
    position: 0.3, space: 0, fine: 7 }, { name: "Bar B" });
  const mix = p.add("audio-mixer", [1, 0], { level1: 4, pan1: -0.3, level2: 4, pan2: 0.3, limiter: false }, { name: "Pair" });
  for (const v of [a, b]) {
    p.cable(p.vin, "pitch", v, "pitch").cable(p.vin, "gate", v, "gate").cable(p.vin, "trigger", v, "strike")
      .cable(p.vin, "velocity", v, "velocity");
  }
  p.cable(p.cin, "beat", b, "fine", 0.1)
    .stereo(a, mix, { to: ["in1l", "in1r"] }).stereo(b, mix, { to: ["in2l", "in2r"] })
    .stereo(mix, p.vout, { from: ["outl", "outr"] }).cable(a, "active", p.vout, "active");
  return p;
}

// Modal Voice in a bell body with a big room and long ring: tubular chime.
function cathedralChime() {
  const p = voice("Cathedral Chime", {
    description: "Modal Voice struck hard as a long bell tube with almost no damping and a wide room: a slow, ringing orchestral chime; velocity brightens the strike. Shared input Ring.",
    tags: ["mallet", "chime", "bell", "orchestral", "long"],
    help: "A Modal Voice with a hard strike on a bell-like body: low damping and a large size give the long, " +
      "metallic ring of a tubular chime, and the space knob adds a wide room. Velocity strikes harder and " +
      "raises the strike timbre. The amp release is long, so keys can be released without cutting the ring.\n\n" +
      "Patch Notes in and take Out L/R. The Ring input adds to the damping (turn it up for a shorter, drier " +
      "chime, or leave it down for the full ring).\n\n" +
      "Tip: play single low notes; chords of many bells turn to wash quickly.",
  }).settings({ voices: 6, spread: 0.5 }).input("ring", "Ring");
  const mv = p.add("modal-voice", [0, 0], { strike: 0.95, strikeTimbre: 0.65, geometry: 0.85, brightness: 0.7, damping: 0.1,
    position: 0.18, size: 0.8, space: 0.45 });
  p.cable(p.vin, "pitch", mv, "pitch").cable(p.vin, "gate", mv, "gate").cable(p.vin, "trigger", mv, "strike")
    .cable(p.vin, "velocity", mv, "velocity").cable(p.vin, "velocity", mv, "strikeTimbre", 0.25)
    .cable(p.cin, "ring", mv, "damping", 0.4);
  ampEnvelope(p, { node: mv, stereo: true }, [1, 1], { attack: 0.001, decay: 3, sustain: 0.25, release: 4, velamount: 0.3 });
  return p;
}

// Perc Voice Modal engine set to a dry wood: pitched wood block.
function pentatonicWoodblock() {
  const p = voice("Pentatonic Woodblock", {
    description: "Perc Voice's Modal engine with heavy damping and a hard click: a dry, hollow, pitched wood block that follows the keyboard; velocity is the accent. Shared input Hollowness.",
    tags: ["mallet", "wood block", "percussive", "dry", "marimba-like"],
    help: "A Perc Voice in Modal engine with a very short decay, strong damping and a hard click. The pitch follows " +
      "the keyboard, so you can play tuned wood blocks and melodies. Velocity is the accent, and a little " +
      "Random on Morph makes each hit slightly different.\n\n" +
      "Patch Notes in and take Out L/R. Hollowness adds to Tone: low is a thick block, high a thin, hollow " +
      "tube.\n\n" +
      "Tip: stick to a pentatonic scale of black keys for an instant tuned-percussion groove.",
  }).settings({ voices: 8, spread: 0.5 }).input("hollow", "Hollowness");
  const pv = p.add("perc-voice", [1, 0], { engine: "Modal", pitch: 261.63, tone: 0.45, morph: 0.4, click: 0.6, decay: 0.16,
    damp: 0.85, sweep: 0.05, spread: 0.2, level: 0.9 });
  p.cable(p.vin, "pitch", pv, "pitch").cable(p.vin, "trigger", pv, "trig").cable(p.vin, "velocity", pv, "accent")
    .cable(p.vin, "random", pv, "morph", 0.1).cable(p.cin, "hollow", pv, "tone", 0.4)
    .stereo(pv, p.vout).cable(pv, "active", p.vout, "active");
  return p;
}

// A sine through a Fast-cell Low Pass Gate with a ringing filter: water-drop pings.
function raindropPings() {
  const p = voice("Raindrop Pings", {
    description: "A pure sine pinged through a fast, resonant Low Pass Gate with a small pitch drop: round, liquid water-drop plinks. Shared inputs Resonance and Drop.",
    tags: ["pluck", "west coast", "lpg", "water", "ambient"],
    help: "An Oscillator sine goes into a Low Pass Gate in the Fast cell setting, in Both mode (filter and level " +
      "together). Every note pings the gate, which opens in a snap and closes in a short, darkening decay. " +
      "A short envelope lowers the pitch by a few semitones at the start for the 'plop' of a drop. Velocity " +
      "sets the ping strength.\n\n" +
      "Patch Notes in and take Out L/R. Resonance rings the gate's filter, Drop sets how far the pitch " +
      "falls at the start of each note.\n\n" +
      "Tip: play fast random notes high on the keyboard, with a reverb after the cell, for a rain texture.",
  }).settings({ voices: 10, spread: 0.7 }).input("res", "Resonance").input("drop", "Drop");
  const osc = p.add("oscillator", [0, 0], { shape: 0, octave: "+1" });
  const fall = envelope(p, [0, 1], { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05, velamount: 0 }, "Drop Env");
  const lpg = p.add("low-pass-gate", [1, 0], { response: 0.3, ping: 0.85, resonance: 0.45, brightness: 0.55, mode: "Both", cell: "Fast" });
  p.cable(p.vin, "pitch", osc, "pitch").cable(fall, "env", osc, "pitch", -semis(4)).cable(p.cin, "drop", osc, "pitch", -semis(6))
    .cable(osc, "sine", lpg, "l")
    .cable(p.vin, "trigger", lpg, "ping").cable(p.vin, "velocity", lpg, "velocity")
    .cable(p.cin, "res", lpg, "resonance", 0.4)
    .stereo(lpg, p.vout).cable(lpg, "active", p.vout, "active");
  return p;
}

// Dual Osc as sine FM pair with velocity into the index: tine piano.
function tinePiano() {
  const p = voice("Tine Piano", {
    description: "Two sine oscillators in FM with a quick-fading index and a touch of fold: the bark-then-bell of an electric tine piano; velocity sets how hard it barks. Shared input Bark.",
    tags: ["mallet", "electric piano", "fm", "tine", "keys"],
    help: "A Dual Osc with two sines at a 1:1 ratio, B frequency-modulating A. An envelope named Bark controls " +
      "the FM depth: a strong index at the strike that quickly falls to a clean tone, which is the bark that " +
      "turns into a bell. Velocity adds to the Bark envelope. A little fold adds harmonics. The amp envelope " +
      "decays gently while the key is held.\n\n" +
      "Patch Notes in and take Out L/R. The Bark input adds to the base FM depth for a brighter or softer " +
      "piano.\n\n" +
      "Tip: play slow chord voicings in the lower middle range, hard for bark and soft for a mellow tone.",
  }).settings({ voices: 10, spread: 0.35 }).input("bark", "Bark");
  const osc = p.add("dual-osc", [0, 0], { shapeA: 0, shapeB: 0, octaveA: 0, octaveB: 0, fmDepth: 0.08, balance: 0, fold: 0.1,
    drift: 0.02, width: 0.4 });
  const bark = envelope(p, [0, 1], { attack: 0.001, decay: 0.35, sustain: 0.1, release: 0.2, velamount: 0.8 }, "Bark Env");
  p.cable(p.vin, "pitch", osc, "pitch").cable(bark, "env", osc, "fmDepth", 0.35).cable(p.cin, "bark", osc, "fmDepth", 0.25);
  ampEnvelope(p, { node: osc, stereo: true, jacks: ["outL", "outR"] }, [1, 1],
    { attack: 0.002, decay: 2.2, sustain: 0.1, release: 0.5, velamount: 0.5 });
  return p;
}

// Macro Osc Pluck feeding the Resonator's sympathetic strings: sitar.
function sympatheticSitar() {
  const p = voice("Sympathetic Sitar", {
    description: "A bright plucked string excites the Resonator's sympathetic strings, which ring and buzz around the note like the drone strings of a sitar. Shared inputs Buzz and Sympathy.",
    tags: ["pluck", "sitar", "sympathetic", "world", "drone"],
    help: "A Macro Osc in Pluck model, bright and hard, plays into a Resonator in Sympathetic model, which adds a " +
      "cloud of resonating strings that follow the played pitch. Both the pluck and the resonance sound; odd " +
      "and even partials go to the two sides of the stereo field. Velocity sets the pick accent.\n\n" +
      "Patch Notes in and take Out L/R. Sympathy sets how much of the dry pluck feeds the strings, Buzz adds " +
      "to the Resonator's brightness for a sharper edge.\n\n" +
      "Tip: play a drone note with your thumb while a melody runs above it.",
  }).settings({ voices: 6, spread: 0.3 }).input("buzz", "Buzz").input("sym", "Sympathy");
  const mo = p.add("macro-osc", [0, 0], { model: "Pluck", tone: 0.8, shape: 0.6, blend: 0.2, decay: 0.9, level: 0.7 });
  const res = p.add("resonator", [1, 0], { model: "Sympathetic", structure: 0.55, brightness: 0.7, damping: 0.3, position: 0.25,
    inputgain: 6, width: 0.8, dry: 0.5 });
  p.cable(p.vin, "pitch", mo, "pitch").cable(p.vin, "trigger", mo, "trig").cable(p.vin, "velocity", mo, "accent")
    .cable(mo, "out", res, "in").cable(p.vin, "pitch", res, "pitch").cable(p.cin, "buzz", res, "brightness", 0.4)
    .cable(p.cin, "sym", res, "inputgain", 0.3);
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [2, 1],
    { attack: 0.001, decay: 1.2, sustain: 0.3, release: 1.5, velamount: 0.4 });
  return p;
}

// Perc Voice FM with a big pitch sweep: tuned hand drum.
function tunedHandDrum() {
  const p = voice("Tuned Hand Drum", {
    description: "Perc Voice's FM engine with a quick pitch sweep and a warm skin: a tuned conga-like hand drum you can play melodies on; velocity is the slap. Shared input Skin.",
    tags: ["mallet", "conga", "hand drum", "percussive", "fm"],
    help: "A Perc Voice in FM engine with a medium decay, a generous pitch Sweep (the skin tightens as it is " +
      "hit) and a moderate click. The pitch follows the keyboard, so you can tune the drum to a melody. " +
      "Velocity is the accent and also adds to the click, so soft is a warm tone and hard is a slap.\n\n" +
      "Patch Notes in and take Out L/R. The Skin input adds to the Tone and Morph for a brighter, tighter " +
      "drum head.\n\n" +
      "Tip: play octaves of two or three notes in a pattern, like a hand drummer, across the low keys.",
  }).settings({ voices: 8, spread: 0.5 }).input("skin", "Skin");
  const pv = p.add("perc-voice", [1, 0], { engine: "FM", pitch: 130.81, tone: 0.25, morph: 0.35, click: 0.3, decay: 0.45,
    damp: 0.5, sweep: 0.55, spread: 0.2, level: 0.85, drive: "Warm" });
  p.cable(p.vin, "pitch", pv, "pitch").cable(p.vin, "trigger", pv, "trig").cable(p.vin, "velocity", pv, "accent")
    .cable(p.vin, "velocity", pv, "click", 0.25).cable(p.cin, "skin", pv, "tone", 0.3).cable(p.cin, "skin", pv, "morph", 0.3)
    .stereo(pv, p.vout).cable(pv, "active", p.vout, "active");
  return p;
}

export default category("Plucks & Mallets", "Struck, plucked and pinged Voice Cells (physical models, mallets, strings and bells) that follow velocity: patch Notes in and Out L/R out.", [
  feltCelesta, nylonGuitarPluck, banjoSnap, gamelanTwinBars, cathedralChime, pentatonicWoodblock, raindropPings, tinePiano,
  sympatheticSitar, tunedHandDrum,
]);
