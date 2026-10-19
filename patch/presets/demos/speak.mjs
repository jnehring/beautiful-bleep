// SPDX-License-Identifier: MIT
// Speak (speak): five demo patches. Each plays by itself with the transport.
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

/// A Step Sequencer playing `notes` (semitones above the root; "." rest, "_" tie).
const seqOf = (p, at, notes, o = {}) => p.add("step-sequencer", at, {
  length: notes.length, rate: o.rate || "1/8", root: o.root || "A", scale: o.scale || "Minor Pentatonic",
  octave: o.octave ?? 0, gatelength: o.gate ?? 0.5,
}, { data: steps(notes) });

/// `src`'s pitch from the sequencer (jack `pitch`, or none), its output (`jack`) through an ADSR-driven VCA.
function gated(p, at, src, seq, jack, pitch, o = {}) {
  const [c, r] = at;
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25, ...(o.env || {}) }, { name: "Amp Env" });
  const amp = p.add("vca", [c + 1, r], {}, { name: "VCA" });
  if (pitch) p.cable(seq, "pitch", src, pitch);
  p.cable(seq, "gate", env, "gate").cable(seq, "trigger", env, "retrig").cable(src, jack, amp, "l").cable(env, "env", amp, "gain");
  return { amp, env };
}

/// Mono or stereo source → trim mixer → reverb → Out 1/2.
function finish(p, at, src, jacks, trim = 0, verb = {}, master = 0) {
  const t = p.add("audio-mixer", [at[0], at[1] + 1], { level1: trim, master }, { name: "Trim" });
  const v = p.add("reverb", at, { size: 0.5, decay: 2.2, damping: 0.5, mix: 0.22, quality: "Eco (8 lines)", ...verb });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return t;
}

/// Mono or stereo source → trim mixer → Out 1/2 (no reverb).
function direct(p, at, src, jacks, trim = 0, master = 0) {
  const t = p.add("audio-mixer", at, { level1: trim, master }, { name: "Trim" });
  p.stereo(src, t, { from: jacks, to: ["in1l", "in1r"] }).stereo(t, p.out, { from: ["outl", "outr"] });
  return t;
}

/// A voice and a drum loop into Out 1/2.
function withDrums(p, at, src, jacks, drums, o = {}) {
  const mix = p.add("audio-mixer", at, { level1: o.l1 ?? -4, level2: o.l2 ?? -8, master: o.master ?? -1 }, { name: "Mix" });
  p.stereo(src, mix, { from: jacks, to: ["in1l", "in1r"] }).stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .stereo(mix, p.out, { from: ["outl", "outr"] });
  return mix;
}

const say = (p, at, text, { name, ...o } = {}) => p.add("speak", at, { speed: 6, coarse: -12, intonation: 0.3, glide: 0.5, level: 0.7, ...o }, { name: name || "Voice", data: { text } });

function robotChoir() {
  const p = patch("Speak: Robot Choir", {
    module: "speak", tempo: 72,
    description: "Sustained vowels on a slowly moving bass line, with no intonation, so the voice sings like a mechanical choir. Change the text to other vowels, raise Glide for smoother changes, or move Formant for a bigger or smaller singer.",
    tags: ["choir", "vowels", "voice", "pad"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", 7, "_", "_", "_", 5, "_", "_", "_", 3, "_", "_", "_"], { rate: "1/4", gate: 1, root: "A", scale: "Minor Pentatonic", octave: 0 });
  const s = say(p, [1, 0], "'a ee oo o ae uh", { speed: 2.2, intonation: 0, glide: 0.9, breath: 0.2, coarse: -7 });
  p.cable(seq, "pitch", s, "pitch");
  finish(p, [2, 0], s, ["out", "out"], -6, { decay: 3.2, mix: 0.35 });
  return p;
}

function spokenBeat() {
  const p = patch("Speak: Spoken Beat", {
    module: "speak", tempo: 110,
    description: "Hisses and stops spoken fast over a drum loop, a percussive layer made only of consonants. Change the text for another rhythm or lower Speed to hear the individual sounds.",
    tags: ["percussion", "consonants", "rhythm", "hats"],
  });
  const s = say(p, [0, 0], "t k t ch . sh t k t s . t t k sh .", { speed: 14, glide: 0.1, breath: 0.1, coarse: 0, level: 0.55 });
  const d = beat(p, [0, 4], { style: "broken", level: -6 });
  withDrums(p, [4, 0], s, ["out", "out"], d, { l1: -6, l2: -3 });
  return p;
}

function stepWords() {
  const p = patch("Speak: Step Words", {
    module: "speak", tempo: 96,
    description: "Mode is Step: every note from the sequencer says the next sound of the text, on the note's pitch, so the tune spells out a phrase. Lengthen the gates to hold the vowels or change the text.",
    tags: ["step", "words", "sequencer", "melody"],
  });
  const seq = seqOf(p, [0, 0], [0, 3, 7, 5, 3, 7, 10, 7, 12, 10, 7, 5, 3, 0, 3, 0], { rate: "1/8", gate: 0.8, root: "G", octave: 0 });
  const s = say(p, [1, 0], "'m 'a r 'ee . 'oo n 'ae 'o l 'a 'e d 'uh", { mode: "Step", speed: 9, intonation: 0, glide: 0.4, coarse: -5 });
  p.cable(seq, "pitch", s, "pitch").cable(seq, "gate", s, "go");
  finish(p, [2, 0], s, ["out", "out"], -4, { mix: 0.25 });
  return p;
}

function giantAndChild() {
  const p = patch("Speak: Giant and Child", {
    module: "speak", tempo: 80,
    description: "Two voices say the same words at different speeds, one with its formants pulled down and one pushed up, so a giant and a child talk over each other. Change Formant on either voice.",
    tags: ["duet", "formant", "voices", "layers"],
  });
  const g = say(p, [0, 0], "'oo 'a oo 'o m . 'a oo", { name: "Giant", speed: 2.4, formant: -8, coarse: -24, intonation: 0.1, glide: 0.8 });
  const c = say(p, [0, 2], "'ee 'ae ee 'a . 'ee 'ae", { name: "Child", speed: 3.3, formant: 7, coarse: 7, intonation: 0.4, glide: 0.7 });
  const mix = p.add("audio-mixer", [1, 0], { level1: -2, pan1: -0.3, level2: -6, pan2: 0.3, master: -3 }, { name: "Mix" });
  p.cable(g, "out", mix, "in1l").cable(g, "out", mix, "in1r").cable(c, "out", mix, "in2l").cable(c, "out", mix, "in2r");
  const v = p.add("reverb", [2, 0], { size: 0.6, decay: 3, damping: 0.5, mix: 0.3, quality: "Eco (8 lines)" });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

function vowelSweep() {
  const p = patch("Speak: Vowel Sweep", {
    module: "speak", tempo: 66,
    description: "One long note while a slow LFO moves Formant up and down and the text walks through all the vowels: a singing, shifting drone. Move Glide for blur or Breath for a husky edge.",
    tags: ["drone", "formant", "vowels", "evolving"],
  });
  const seq = seqOf(p, [0, 0], [0, "_", "_", "_", "_", "_", "_", "_", 7, "_", "_", "_", "_", "_", "_", "_"], { rate: "1/2", gate: 1, root: "D", octave: -1 });
  const l = p.add("lfo", [0, 2], { wave: "Sine", rate: 0.07, polarity: "Bipolar" }, { name: "Formant" });
  const s = say(p, [1, 0], "a e i o u ee oo ae uh er", { speed: 2.5, intonation: 0, glide: 1, breath: 0.25, coarse: 0 });
  p.cable(seq, "pitch", s, "pitch").cable(l, "out", s, "formant", 0.45);
  finish(p, [2, 0], s, ["out", "out"], -5, { decay: 3.5, mix: 0.3 });
  return p;
}

export default [robotChoir, spokenBeat, stepWords, giantAndChild, vowelSweep];
