// SPDX-License-Identifier: MIT
// Feedback & Pings: Voice Cells in the manner of Hainbach's lab-equipment sessions. A click, a noise burst or a
// pulse "pings" something that rings or feeds back on itself (a self-oscillating filter, a tuned comb, a resonator,
// a delay loop, a test oscillator), and the note tunes the ring. Notes in, Out L/R; velocity is how hard the ping hits.
import { voice, category, ampEnvelope, envelope } from "./kit.mjs";

/// A noise burst: Noise → VCA, opened by a very short envelope on each trigger (velocity makes it louder).
function burst(p, at, decay = 0.012, colour = 0) {
  const nz = p.add("noise", [at[0], at[1]], { colour });
  const hit = envelope(p, [at[0], at[1] + 1], { attack: 0.001, decay, sustain: 0, release: 0.01, velamount: 1 }, "Ping");
  const vca = p.add("vca", [at[0] + 1, at[1]], {}, { name: "Burst" });
  p.cable(nz, "white", vca, "l").cable(hit, "env", vca, "gain");
  return vca;
}

/// A pulse generator that fires once per note, pitched through its ring (Triggered, one pulse, Ring output).
function pinger(p, at, values = {}) {
  const pg = p.add("pulse-generator", at, { mode: "Triggered", width: 0.0002, ring: 1, ringfreq: 1200, damping: 0.5,
    ...values }, { name: "Pinger" });
  p.cable(p.vin, "trigger", pg, "trigger").cable(p.vin, "pitch", pg, "pitch").cable(p.vin, "velocity", pg, "amplitude", 0.3);
  return pg;
}


/// Puts the Audio Mixer's limiter (on by default) between `src` (a node with l/r outputs) and Voice Out, for the
/// loops that can run away. Replaces the direct cables from `src` to Voice Out.
function limited(p, src, at, outs = ["l", "r"]) {
  p.cables = p.cables.filter((c) => !(c.from.node === src.id && c.to.node === "vo" && c.to.jack !== "active"));
  p.cables.forEach((c, i) => { c.id = `k${i + 1}`; });
  const mix = p.add("audio-mixer", at, { level1: 0, master: 0, limiter: true }, { name: "Limiter" });
  p.cable(src, outs[0], mix, "in1l").cable(src, outs[1], mix, "in1r").stereo(mix, p.vout, { from: ["outl", "outr"] });
  return mix;
}

const AMP = (decay, release) => ({ attack: 0.001, decay, sustain: 1, release, velamount: 0.3 });

// A pulse's edges ring a resonance, tuned by the note: the plain lab ping.
function labPing() {
  const p = voice("Lab Ping", {
    description: "A pulse generator's edge rings a resonance tuned by the note: clean, glassy test-bench pings, longer and brighter with velocity. Shared input Damping.",
    tags: ["ping", "pulse", "lab", "hainbach"],
  }).settings({ voices: 10, spread: 0.3 }).input("damp", "Damping");
  const pg = pinger(p, [0, 0], { ringfreq: 523.25, damping: 0.55, width: 0.0003 });
  p.cable(p.cin, "damp", pg, "damping", 0.4);
  ampEnvelope(p, { node: pg, jack: "ring" }, [1, 1], AMP(0.4, 1.5));
  return p;
}

// Wide pulses rung at low frequency: small drums thumped on the bench.
function benchThump() {
  const p = voice("Bench Thump", {
    description: "Wide pulses ring a low, quickly damped resonance: tuned thumps like knuckles on a metal cabinet. Velocity hits harder.",
    tags: ["ping", "pulse", "thump", "hainbach"],
  }).settings({ voices: 8, spread: 0.2 });
  const pg = pinger(p, [0, 0], { ringfreq: 130.81, damping: 0.25, width: 0.003 });
  ampEnvelope(p, { node: pg, jack: "ring" }, [1, 1], AMP(0.25, 0.6));
  return p;
}

// A burst of up to six pulses, each ringing, into a tape loop.
function ratchetPing() {
  const p = voice("Ratchet Ping", {
    description: "Every note fires a burst of six pulses that ring a high resonance, smeared into a tape loop with a wobble: a stuttering, chattering ping. Shared input Feedback.",
    tags: ["ping", "burst", "tape", "hainbach"],
  }).settings({ voices: 6, spread: 0.4 }).input("fb", "Feedback");
  const pg = pinger(p, [0, 0], { ringfreq: 1046.5, damping: 0.45, burst: 6, period: 0.028 });
  const dly = p.add("zone-delay", [1, 0], { zone: 3, time: 0.4, feedback: 0.7, character: 0.4, tone: -0.35, wobble: 0.4,
    diffuse: 0.25, mix: 0.55 });
  p.cable(pg, "ring", dly, "l").cable(pg, "ring", dly, "r").cable(p.cin, "fb", dly, "feedback", 0.25);
  ampEnvelope(p, { node: dly, stereo: true }, [2, 1], AMP(0.6, 3));
  return p;
}

// A noise burst kicks a filter with its resonance at the top: it rings at the note.
function filterWhistle() {
  const p = voice("Filter Whistle", {
    description: "A noise burst kicks a state-variable filter whose resonance is almost closed: a pure, whistling sine at the note that blooms and dies. Shared input Resonance.",
    tags: ["ping", "filter", "self-oscillation", "hainbach"],
  }).settings({ voices: 10, spread: 0.3 }).input("res", "Resonance");
  const b = burst(p, [0, 0], 0.01);
  const f = p.add("filter", [2, 0], { cutoff: 261.63, resonance: 0.985, keytrack: 1, type: "SVF Multimode", mode: 0.5, drive: 0.1 });
  p.cable(b, "l", f, "l").cable(p.vin, "pitch", f, "pitch").cable(p.cin, "res", f, "resonance", 0.03);
  ampEnvelope(p, { node: f, jack: "l" }, [3, 1], AMP(0.5, 2));
  return p;
}

// A ladder filter driven into self-oscillation by a click.
function ladderSnap() {
  const p = voice("Ladder Snap", {
    description: "A single click rings a Ladder Tanh filter at full resonance: the fat, saturating sine of a self-oscillating ladder, struck rather than held. Velocity drives it harder into the tanh.",
    tags: ["ping", "filter", "ladder", "hainbach"],
  }).settings({ voices: 8, spread: 0.25 });
  const pg = pinger(p, [0, 0], { ringfreq: 8000, ring: 0, width: 0.0001, damping: 0.1 });
  const f = p.add("filter", [1, 0], { cutoff: 130.81, resonance: 0.99, drive: 0.35, keytrack: 1, type: "Ladder Tanh" });
  p.cable(pg, "out", f, "l").cable(p.vin, "pitch", f, "pitch").cable(p.vin, "velocity", f, "drive", 0.3);
  ampEnvelope(p, { node: f, jack: "l" }, [2, 1], AMP(0.35, 1.2));
  return p;
}

// A band-pass filter and a tuned comb patched in a loop with an explicit feedback cable.
function loopedBandpass() {
  const p = voice("Looped Bandpass", {
    description: "A noise burst enters a band-pass filter whose output goes through a tuned comb and straight back into the filter on a feedback cable: a loop that rings, squeals and settles at the note. Shared input Loop Amount.",
    tags: ["feedback", "loop", "comb", "hainbach"],
  }).settings({ voices: 6, spread: 0.3 }).input("loop", "Loop Amount");
  const b = burst(p, [0, 0], 0.008);
  const f = p.add("filter", [2, 0], { cutoff: 800, resonance: 0.6, type: "SVF Multimode", mode: 0.5, keytrack: 1 }, { name: "Loop Filter" });
  const comb = p.add("zone-delay", [3, 0], { zone: 1, feedback: 0.8, character: 0.3, tone: 0, mix: 1 }, { name: "Loop Comb" });
  p.cable(b, "l", f, "l").cable(p.vin, "pitch", f, "pitch").cable(f, "l", comb, "l").cable(f, "r", comb, "r")
    .cable(p.vin, "pitch", comb, "pitch").cable(comb, "l", f, "l", 0.55).cable(p.cin, "loop", comb, "feedback", 0.1);
  const { amp } = ampEnvelope(p, { node: comb, stereo: true }, [4, 1], AMP(0.5, 1.8));
  limited(p, amp, [6, 1]);
  return p;
}

// Karplus: a noise burst in a one-zone comb with feedback at 95%.
function combString() {
  const p = voice("Comb String", {
    description: "A noise burst in Zone Delay's tuned comb with 95% feedback: Karplus-Strong plucks that ring in feedback, darker as Tone falls. Velocity is the pluck. Shared input Brightness.",
    tags: ["feedback", "karplus", "comb", "hainbach"],
  }).settings({ voices: 10, spread: 0.4 }).input("tone", "Brightness");
  const b = burst(p, [0, 0], 0.004);
  const dly = p.add("zone-delay", [2, 0], { zone: 1, feedback: 0.95, character: 0.2, tone: -0.2, mix: 1 });
  p.cable(b, "l", dly, "l").cable(b, "l", dly, "r").cable(p.vin, "pitch", dly, "pitch").cable(p.cin, "tone", dly, "tone", 0.5);
  ampEnvelope(p, { node: dly, stereo: true }, [3, 1], AMP(1, 2.5));
  return p;
}

// The same comb drifting like tape: wobble, diffusion and character.
function warpedComb() {
  const p = voice("Warped Comb", {
    description: "A click in a tuned comb with wobble, diffusion and a rough Character on the loop: the pitch sags and shimmers like a damaged tape string. Shared input Wobble.",
    tags: ["feedback", "comb", "tape", "hainbach"],
  }).settings({ voices: 8, spread: 0.5 }).input("wobble", "Wobble");
  const pg = pinger(p, [0, 0], { ringfreq: 6000, ring: 1, damping: 0.2, width: 0.0001 });
  const dly = p.add("zone-delay", [1, 0], { zone: 1, feedback: 0.93, character: 0.7, tone: -0.4, diffuse: 0.35, wobble: 0.5, mix: 1 });
  p.cable(pg, "ring", dly, "l").cable(pg, "ring", dly, "r").cable(p.vin, "pitch", dly, "pitch").cable(p.cin, "wobble", dly, "wobble", 0.4);
  ampEnvelope(p, { node: dly, stereo: true }, [2, 1], AMP(0.8, 2.5));
  return p;
}

// A Test Oscillator kicked below unity loop gain: a tuned bench drum.
function loopKick() {
  const p = voice("Loop Kick", {
    description: "Test Oscillator with its loop gain just below 100%, kicked by each note: a lamp-stabilised sine that rings like a tuned drum and bounces as it dies. Velocity is the kick. Shared input Loop Gain.",
    tags: ["ping", "test oscillator", "drum", "hainbach"],
  }).settings({ voices: 6, spread: 0.2 }).input("gain", "Loop Gain");
  const to = p.add("test-oscillator", [1, 0], { range: "×10", freq: 6, loopgain: 0.93, kick: 0.9, drift: 0.2, level: 0.9 });
  p.cable(p.vin, "pitch", to, "pitch").cable(p.vin, "trigger", to, "kick").cable(p.cin, "gain", to, "loopgain", 0.1);
  ampEnvelope(p, { node: to, jack: "sine" }, [2, 1], AMP(0.6, 1.2));
  return p;
}

// Loop gain over unity: it hums while held.
function lampHum() {
  const p = voice("Lamp Hum", {
    description: "Test Oscillator with loop gain over unity: a lamp-stabilised sine that warms up and hums while the key is held, pinged at the start. Mains hum underneath. Shared input Drift.",
    tags: ["drone", "test oscillator", "hum", "hainbach"],
  }).settings({ voices: 4, spread: 0.2 }).input("drift", "Drift");
  const to = p.add("test-oscillator", [1, 0], { range: "×100", freq: 2.6, loopgain: 1.15, settle: 0.4, kick: 0.6, drift: 0.5,
    mains: "50 Hz", level: 0.8 });
  const rev = p.add("reverb", [3, 0], { size: 0.4, decay: 4, damping: 0.5, mix: 0.25 });
  p.cable(p.vin, "pitch", to, "pitch").cable(p.vin, "trigger", to, "kick").cable(p.cin, "drift", to, "drift", 0.4);
  const { amp } = ampEnvelope(p, { node: to, jack: "sine" }, [2, 1], { attack: 0.02, decay: 0.3, sustain: 1, release: 2, velamount: 0.2 });
  p.cable(amp, "l", rev, "l").cable(amp, "r", rev, "r");
  const dry = p.add("audio-mixer", [5, 2], { level1: 0, master: 0, limiter: true }, { name: "Limiter" });
  p.cables = p.cables.filter((c) => !(c.from.node === amp.id && c.to.node === "vo" && c.to.jack !== "active"));
  p.cables.forEach((c, i) => { c.id = `k${i + 1}`; });
  p.cable(amp, "l", dry, "in2l").cable(amp, "r", dry, "in2r").cable(rev, "l", dry, "in1l").cable(rev, "r", dry, "in1r")
    .stereo(dry, p.vout, { from: ["outl", "outr"] });
  return p;
}

// Square wave through a wave analyzer: one partial at a time.
function partialPick() {
  const p = voice("Partial Pick", {
    description: "A noise burst through Wave Analyzer's 3 Hz band-pass tuned by the note: only a single narrow partial survives, ringing out as a bare, slightly wavering sine. Shared input Gain.",
    tags: ["ping", "wave analyzer", "partial", "hainbach"],
  }).settings({ voices: 8, spread: 0.3 }).input("gain", "Gain");
  const b = burst(p, [0, 0], 0.03);
  const wa = p.add("wave-analyzer", [2, 0], { frequency: 261.63, gain: 28, drift: 0.2, bandwidth: "3 Hz", mode: "Manual" });
  p.cable(b, "l", wa, "in").cable(p.vin, "pitch", wa, "pitch").cable(p.cin, "gain", wa, "gain", 0.2);
  ampEnvelope(p, { node: wa, jack: "band" }, [3, 1], AMP(0.9, 2));
  return p;
}

// A drum-room of delays feeding itself past unity, pinged by the resonator.
function runawayRoom() {
  const p = voice("Runaway Room", {
    description: "A tuned ping is fed into a Delay Net in Mesh routing with feedback over 100%: the room builds on the ping, squeals and is held down by the envelope. Shared input Feedback.",
    tags: ["feedback", "delay network", "runaway", "hainbach"],
  }).settings({ voices: 4, spread: 0.5 }).input("fb", "Feedback");
  const pg = pinger(p, [0, 0], { ringfreq: 800, damping: 0.4 });
  const dn = p.add("delay-network", [1, 0], { time: 0.07, taps: 5, scatter: 0.5, jitter: 0.1, feedback: 1.04, character: 0.5, tone: -0.2,
    width: 1, mix: 1, routing: "Mesh" });
  p.cable(pg, "ring", dn, "l").cable(pg, "ring", dn, "r").cable(p.cin, "fb", dn, "feedback", 0.1);
  const { amp } = ampEnvelope(p, { node: dn, stereo: true }, [2, 1], { attack: 0.001, decay: 0.8, sustain: 0.8, release: 1.5, velamount: 0.3 });
  limited(p, amp, [4, 1]);
  return p;
}

// Plate ringing under a pulse train.
function plateKnock() {
  const p = voice("Plate Knock", {
    description: "A pulse knocks the Resonator's plate model: metallic, inharmonic rings at the note with a bright start. Structure sets how clangorous the plate is. Shared input Structure.",
    tags: ["ping", "resonator", "plate", "hainbach"],
  }).settings({ voices: 8, spread: 0.4 }).input("structure", "Structure");
  const pg = pinger(p, [0, 0], { ringfreq: 3000, damping: 0.35, width: 0.0004 });
  const res = p.add("resonator", [1, 0], { model: "Modal", structure: 0.65, brightness: 0.7, damping: 0.25, position: 0.3, inputgain: 6, width: 0.8 });
  p.cable(pg, "ring", res, "in").cable(p.vin, "pitch", res, "pitch").cable(p.vin, "velocity", res, "brightness", 0.2)
    .cable(p.cin, "structure", res, "structure", 0.4);
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [2, 1], AMP(0.7, 2.5));
  return p;
}

// Noise through a vactrol gate into a resonant body.
function vactrolKnock() {
  const p = voice("Vactrol Knock", {
    description: "Noise pinged through a Low Pass Gate with the vactrol response in the loop, into a string-model Resonator: soft, organic knocks that bloom into a note. Velocity opens the gate wider.",
    tags: ["ping", "low pass gate", "resonator", "hainbach"],
  }).settings({ voices: 8, spread: 0.3 });
  const nz = p.add("noise", [0, 0], { colour: -0.3 });
  const lpg = p.add("low-pass-gate", [1, 0], { response: 0.3, ping: 0.9, resonance: 0.6, brightness: 0.6, mode: "Both", cell: "Classic" });
  const res = p.add("resonator", [2, 0], { model: "String", structure: 0.2, brightness: 0.55, damping: 0.4, position: 0.25, inputgain: 6 });
  p.cable(nz, "white", lpg, "l").cable(p.vin, "trigger", lpg, "ping").cable(p.vin, "velocity", lpg, "velocity")
    .cable(lpg, "l", res, "in").cable(p.vin, "pitch", res, "pitch");
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [3, 1], AMP(0.6, 2));
  return p;
}

// Two resonators a fifth apart, each fed from the other.
function crossFedFifth() {
  const p = voice("Cross-fed Fifth", {
    description: "A noise burst pings two Resonators a fifth apart, each feeding the other over feedback cables: a self-answering two-note ring that blooms sympathetically. Shared input Damping.",
    tags: ["feedback", "resonator", "fifth", "hainbach"],
  }).settings({ voices: 6, spread: 0.6 }).input("damp", "Damping");
  const b = burst(p, [0, 0], 0.008);
  const a = p.add("resonator", [2, 0], { model: "Modal", structure: 0.3, brightness: 0.6, damping: 0.3, inputgain: 4, width: 1 }, { name: "Root" });
  const f = p.add("resonator", [2, 1], { model: "Modal", frequency: 7, structure: 0.3, brightness: 0.5, damping: 0.3, inputgain: 4, width: 1 }, { name: "Fifth" });
  p.cable(b, "l", a, "in").cable(b, "l", f, "in").cable(p.vin, "pitch", a, "pitch").cable(p.vin, "pitch", f, "pitch")
    .cable(a, "mix", f, "in", 0.45).cable(f, "mix", a, "in", 0.45).cable(p.cin, "damp", a, "damping", 0.3).cable(p.cin, "damp", f, "damping", 0.3);
  const { env } = ampEnvelope(p, { node: a, stereo: true, jacks: ["odd", "even"] }, [3, 0], AMP(0.8, 3));
  const amp2 = p.add("vca", [4, 1], {}, { name: "Fifth VCA" });
  p.cable(f, "odd", amp2, "l").cable(f, "even", amp2, "r").cable(env, "env", amp2, "gain").stereo(amp2, p.vout);
  return p;
}

// Strum a sympathetic string set with a filtered noise burst.
function sympatheticRattle() {
  const p = voice("Sympathetic Rattle", {
    description: "A band-passed noise burst rattles the Resonator's sympathetic strings, which sing at the note's overtones: a contact-mic scrape on a bowl of strings. Shared input Brightness.",
    tags: ["ping", "resonator", "sympathetic", "hainbach"],
  }).settings({ voices: 6, spread: 0.6 }).input("bright", "Brightness");
  const b = burst(p, [0, 0], 0.05, 0.4);
  const bp = p.add("filter", [2, 0], { cutoff: 3500, resonance: 0.4, mode: 0.5, type: "SVF Multimode" }, { name: "Scrape" });
  const res = p.add("resonator", [3, 0], { model: "Sympathetic", structure: 0.5, brightness: 0.6, damping: 0.25, inputgain: 6, width: 1 });
  p.cable(b, "l", bp, "l").cable(p.vin, "velocity", bp, "cutoff", 0.15).cable(bp, "l", res, "in")
    .cable(p.vin, "pitch", res, "pitch").cable(p.cin, "bright", res, "brightness", 0.4);
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [4, 1], AMP(0.8, 3));
  return p;
}

// Metal sheet struck through Modal Voice's external input.
function metalSheet() {
  const p = voice("Metal Sheet", {
    description: "A pinged pulse drives Modal Voice's plate body in a big room through its external input: a thunder-sheet clang that rings at the note. Shared input Space.",
    tags: ["ping", "modal", "plate", "hainbach"],
  }).settings({ voices: 6, spread: 0.5 }).input("space", "Space");
  const pg = pinger(p, [0, 0], { ringfreq: 2000, damping: 0.4 });
  const mv = p.add("modal-voice", [1, 0], { strike: 0, geometry: 0.8, brightness: 0.7, damping: 0.28, position: 0.18, size: 0.6, space: 0.55,
    extLevel: 1 });
  p.cable(pg, "ring", mv, "ext").cable(p.vin, "pitch", mv, "pitch").cable(p.vin, "gate", mv, "gate")
    .cable(p.cin, "space", mv, "space", 0.4).stereo(mv, p.vout).cable(mv, "active", p.vout, "active");
  return p;
}

// A resonator ping into a frequency shifter with feedback: spiralling bells.
function spiralBell() {
  const p = voice("Spiral Bell", {
    description: "A struck bell resonance goes into a frequency shifter with feedback: each repeat climbs a few Hz, so the ping curls into inharmonic spirals. Shared input Shift.",
    tags: ["feedback", "frequency shifter", "bell", "hainbach"],
  }).settings({ voices: 6, spread: 0.5 }).input("shift", "Shift");
  const pg = pinger(p, [0, 0], { ringfreq: 1500, damping: 0.45 });
  const res = p.add("resonator", [1, 0], { model: "Modal", structure: 0.55, brightness: 0.65, damping: 0.4, inputgain: 6 });
  const fs = p.add("freq-shifter", [2, 0], { shift: 0.1, fine: 1.5, feedback: 0.78, fbDelay: 0.1, spread: 0.6, mix: 0.8, range: "±200 Hz" });
  p.cable(pg, "ring", res, "in").cable(p.vin, "pitch", res, "pitch")
    .cable(res, "odd", fs, "l").cable(res, "even", fs, "r").cable(p.cin, "shift", fs, "shift", 0.3);
  const { amp } = ampEnvelope(p, { node: fs, stereo: true }, [3, 1], AMP(0.9, 3));
  limited(p, amp, [5, 1]);
  return p;
}

// A hum into a long reverb held on freeze: a bloom of feedback.
function hissBloom() {
  const p = voice("Hiss Bloom", {
    description: "A ping into a near-infinite Verb: the room keeps the hiss and the note, and the envelope lets it bloom and hang in the air. A long release. Shared input Decay.",
    tags: ["feedback", "reverb", "bloom", "hainbach"],
  }).settings({ voices: 4, spread: 0.6 }).input("decay", "Decay");
  const pg = pinger(p, [0, 0], { ringfreq: 1046.5, damping: 0.3 });
  const rev = p.add("reverb", [1, 0], { size: 0.8, decay: 40, damping: 0.55, diffusion: 0.9, modDepth: 0.4, mix: 1, width: 1.2 });
  p.cable(pg, "ring", rev, "l").cable(pg, "ring", rev, "r").cable(p.cin, "decay", rev, "decay", 0.3);
  const { amp } = ampEnvelope(p, { node: rev, stereo: true }, [2, 1], { attack: 0.005, decay: 1.5, sustain: 0.9, release: 5, velamount: 0.3 });
  limited(p, amp, [4, 1]);
  return p;
}

// A pulse ping into a slow tape echo recirculating at 90%.
function tapeLoopPing() {
  const p = voice("Tape Loop Ping", {
    description: "A pitched ping drops into a slow tape loop with 88% feedback, dark Tone and a lurching wobble: each repeat is duller and slightly flat, the way a worn loop forgets. Shared input Feedback.",
    tags: ["feedback", "tape", "echo", "hainbach"],
  }).settings({ voices: 6, spread: 0.5 }).input("fb", "Feedback");
  const pg = pinger(p, [0, 0], { ringfreq: 784, damping: 0.5 });
  const dly = p.add("zone-delay", [1, 0], { zone: 4, time: 0.45, feedback: 0.88, character: 0.55, tone: -0.5, wobble: 0.6, diffuse: 0.15,
    mix: 0.7, timechange: "Tape" });
  p.cable(pg, "ring", dly, "l").cable(pg, "ring", dly, "r").cable(p.cin, "fb", dly, "feedback", 0.1);
  const { amp } = ampEnvelope(p, { node: dly, stereo: true }, [2, 1], { attack: 0.001, decay: 0.8, sustain: 1, release: 4, velamount: 0.3 });
  limited(p, amp, [4, 1]);
  return p;
}

export default category("Feedback & Pings", "Lab-bench pings and feedback loops in the manner of Hainbach: a click or noise burst rings a tuned resonance (a self-oscillating filter, comb, resonator, test oscillator, delay loop) and the note tunes it. Voice Cells that follow velocity: patch Notes in and Out L/R out.", [
  labPing, benchThump, ratchetPing, filterWhistle, ladderSnap, loopedBandpass, combString, warpedComb, loopKick, lampHum,
  partialPick, runawayRoom, plateKnock, vactrolKnock, crossFedFifth, sympatheticRattle, metalSheet, spiralBell, hissBloom, tapeLoopPing,
]);
