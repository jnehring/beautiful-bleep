// Button: five demo patches. Each plays by itself with the transport.
// SPDX-License-Identifier: MIT
import { patch, steps } from "../kit.mjs";
import { melody, beat } from "../demo-kit.mjs";

// ------------------------------------------------------------ local helpers

/// A Step Sequencer: `notes` as in steps(); `knobs` are its settings; `vel` the velocities.
function sq(p, at, notes, knobs = {}, vel) {
  return p.add("step-sequencer", at, { length: Math.min(32, notes.length), rate: "1/8", gatelength: 0.45, ...knobs }, { data: steps(notes, vel) });
}

/// Oscillator → ADSR → VCA from a pitch and gate source ({node, pitch, gate, trigger, velocity}), optional filter after.
function voice(p, at, src, o = {}) {
  const [c, r] = at, name = o.name || "Voice";
  const osc = p.add("oscillator", [c, r], { shape: 0.8, ...(o.osc || {}) }, { name });
  const env = p.add("adsr", [c, r + 1], { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2, ...(o.env || {}) }, { name: `${name} Env` });
  const amp = p.add("vca", [c + 1, r], {}, { name: `${name} VCA` });
  p.cable(src.node, src.pitch || "pitch", osc, "pitch").cable(src.node, src.gate || "gate", env, "gate");
  if (src.trigger !== false) p.cable(src.node, src.trigger || "trigger", env, "retrig");
  if (src.velocity) p.cable(src.node, src.velocity, env, "velocity");
  p.cable(osc, "out", amp, "l").cable(env, "env", amp, "gain");
  if (!o.filter) return { osc, env, amp, out: amp };
  const filter = p.add("filter", [c + 2, r], o.filter, { name: `${name} Filter` });
  p.cable(amp, "l", filter, "l");
  return { osc, env, amp, filter, out: filter };
}

/// Mono source → optional delay → reverb → Out 1/2. Returns the reverb.
function space(p, at, from, jack, { level = 3, delay, verb } = {}) {
  const [c, r] = at;
  const m = p.add("audio-mixer", [c - 1, r], { level1: level, master: 0, limiter: true }, { name: "Level" });
  p.cable(from, jack, m, "in1l");
  let node = m, out = ["outl", "outr"];
  if (delay) {
    node = p.add("zone-delay", [c, r], delay);
    p.stereo(m, node, { from: out });
    out = ["l", "r"];
  }
  const v = p.add("reverb", [c + 1, r], { mix: 0.3, ...verb });
  p.stereo(node, v, { from: out }).stereo(v, p.out);
  return v;
}

/// Mono voice + drums → mixer → short reverb → Out 1/2.
function withBeat(p, at, from, jack, style, { lead = -2, drums = -4, level = -9, verb = {} } = {}) {
  const [c, r] = at;
  const d = beat(p, [c, r + 1], { style, level });
  const mix = p.add("audio-mixer", [c + 1, r], { level1: lead, level2: drums, master: -2 }, { name: "Mix" });
  p.cable(from, jack, mix, "in1l").cable(from, jack, mix, "in1r").stereo(d, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] });
  const v = p.add("reverb", [c + 2, r], { size: 0.3, decay: 1.2, mix: 0.12, ...verb });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return v;
}

// ------------------------------------------------------------ patches

function holdToBrighten() {
  const p = patch("Button: Hold To Brighten", {
    module: "button", tempo: 104,
    description: "A dark, muffled saw riff plays on its own; hold the Button and its Gate output opens an envelope that sweeps the filter wide open, then lets it fall back when you let go. Try the Toggle mode to latch the bright sound.",
    tags: ["gate", "momentary", "filter", "performance"],
  });
  const s = sq(p, [0, 0], [0, ".", 0, 7, ".", 5, 3, 0], { rate: "1/16", root: "E", scale: "Phrygian", octave: -1 });
  const v = voice(p, [1, 0], { node: s }, { osc: { shape: 0.95 }, env: { decay: 0.2, sustain: 0.4, release: 0.1 }, filter: { cutoff: 220, resonance: 0.3 } });
  const b = p.add("button", [0, 2], { mode: "Momentary" }, { name: "Open Up" });
  const e = p.add("adsr", [1, 2], { attack: 0.12, decay: 0.3, sustain: 1, release: 0.5 }, { name: "Sweep Env" });
  p.cable(b, "gate", e, "gate").cable(e, "env", v.filter, "cutoff", 0.65);
  space(p, [4, 0], v.out, "l", { level: 0, delay: { zone: 3, time: 0.4, feedback: 0.35, mix: 0.2 }, verb: { size: 0.4, decay: 1.6, mix: 0.2 } });
  return p;
}

function toggleBellLayer() {
  const p = patch("Button: Toggle Bell Layer", {
    module: "button", tempo: 90,
    description: "A warm pad-like line carries the patch; click the Button in Toggle mode and a second, bell-like line fades in on top and stays until you click again. Switch Mode to Momentary to bring the bells in only while you hold it.",
    tags: ["toggle", "layer", "bells", "latch"],
  });
  const a = sq(p, [0, 0], [0, ".", 7, ".", 3, ".", 5, "."], { rate: "1/4", root: "C", scale: "Natural Minor", octave: -1 });
  const base = voice(p, [1, 0], { node: a }, { name: "Base", osc: { shape: 0.4 }, env: { attack: 0.03, decay: 0.8, sustain: 0.4, release: 0.6 }, filter: { cutoff: 1400 } });
  const b = sq(p, [0, 3], [12, 19, 15, 24, 19, 15, 22, 17], { rate: "1/8", root: "C", scale: "Natural Minor", octave: 1, gatelength: 0.3 });
  const bell = voice(p, [1, 3], { node: b }, { name: "Bells", osc: { shape: 0 }, env: { decay: 0.5, sustain: 0, release: 0.5 } });
  const btn = p.add("button", [0, 5], { mode: "Toggle" }, { name: "Bells On" });
  const fade = p.add("adsr", [3, 5], { attack: 1.2, decay: 0.1, sustain: 1, release: 1.5 }, { name: "Fade" });
  const lay = p.add("vca", [3, 3], {}, { name: "Layer VCA" });
  p.cable(btn, "toggle", fade, "gate").cable(bell.out, "l", lay, "l").cable(fade, "env", lay, "gain");
  const mix = p.add("audio-mixer", [4, 0], { level1: 2, level2: -2, master: 0 }, { name: "Mix" });
  p.cable(base.out, "l", mix, "in1l").cable(lay, "l", mix, "in2l");
  const v = p.add("reverb", [5, 0], { size: 0.6, decay: 3.5, mix: 0.3 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
  return p;
}

/// Beat + bass, plus one extra drum fired by a Button output. Returns nothing; wires everything to Out 1/2.
function drumsWith(p, kind, jack, drumKnobs, style, mixLevel) {
  const s = sq(p, [0, 0], [0, ".", 0, 12, ".", 7, 0, "."], { rate: "1/16", root: "A", scale: "Minor Pentatonic", octave: -2, gatelength: 0.5 });
  const bass = voice(p, [1, 0], { node: s }, { osc: { shape: 0.9 }, env: { decay: 0.18, sustain: 0.35, release: 0.08 }, filter: { cutoff: 420, resonance: 0.3 } });
  const drums = beat(p, [0, 3], { style, level: -9 });
  const b = p.add("button", [3, 0], {}, { name: kind === "punch-clap" ? "Clap Pad" : "Cymbal Pad" });
  const extra = p.add(kind, [4, 1], drumKnobs);
  p.cable(b, jack, extra, "trig");
  const mix = p.add("audio-mixer", [5, 0], { level1: -2, level2: -4, level3: mixLevel, pan3: 0.2, master: -1 }, { name: "Mix" });
  p.cable(bass.out, "l", mix, "in1l").cable(bass.out, "l", mix, "in1r").stereo(drums, mix, { from: ["outl", "outr"], to: ["in2l", "in2r"] })
    .cable(extra, "out", mix, "in3l");
  const v = p.add("reverb", [6, 0], { size: 0.4, decay: 1.6, mix: 0.15 });
  p.stereo(mix, v, { from: ["outl", "outr"] }).stereo(v, p.out);
}

function clapOnPress() {
  const p = patch("Button: Clap On Press", {
    module: "button", tempo: 110,
    description: "A bass line and a half-time beat play by themselves; every press of the Button sends a Trigger to a clap, so you add hand claps by tapping it in time. The Trigger fires on the press, not on the release, and its Gate output would stay high while you hold.",
    tags: ["trigger", "clap", "drums", "tap"],
  });
  drumsWith(p, "punch-clap", "trigger", { tone: 1800, decay: 0.4, bursts: 4, level: 0.8 }, "half", -3);
  return p;
}

function cymbalOnRelease() {
  const p = patch("Button: Cymbal On Release", {
    module: "button", tempo: 100,
    description: "Press and hold the Button, then let go: its Release output fires a long crash cymbal at the moment you lift your finger, like a drum-fill finish. Use the Trigger output on the same Button to hit the cymbal on the way down instead.",
    tags: ["release", "cymbal", "drums", "fill"],
  });
  drumsWith(p, "punch-cymbal", "release", { voice: "Crash", decay: 3, tone: 0.45, crunch: 0.2, level: 0.7 }, "broken", -4);
  return p;
}

function freezeHold() {
  const p = patch("Button: Freeze Hold", {
    module: "button", tempo: 76,
    description: "In Toggle mode the Button's Toggle output latches the reverb's Freeze input: click it while a note is ringing and the tail is held as an endless chord under the following notes. Click again to let the room empty.",
    tags: ["freeze", "toggle", "reverb", "ambient"],
  });
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, ".", 11, 9], { rate: "1/4", shape: 0.4, root: "D", scale: "Dorian", env: { attack: 0.02, decay: 0.8, sustain: 0.2, release: 0.6 } });
  const v = p.add("reverb", [3, 0], { size: 0.8, decay: 12, preDelay: 0.05, damping: 0.45, mix: 0.75, width: 1.3 });
  const b = p.add("button", [3, 2], { mode: "Toggle" }, { name: "Freeze" });
  p.cable(m.amp, "l", v, "l").cable(m.amp, "l", v, "r").stereo(v, p.out).cable(b, "toggle", v, "freeze");
  return p;
}

export default [holdToBrighten, toggleBellLayer, clapOnPress, cymbalOnRelease, freezeHold];
