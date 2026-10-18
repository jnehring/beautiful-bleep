// SPDX-License-Identifier: MIT
// Feedback & Pings: Voice Cells in the spirit of lab-bench equipment sessions. A click, a noise burst or a
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
    description: "A pulse edge rings a resonance tuned by the note, giving clean, glassy test-bench pings; play it with single notes or a sequencer.",
    tags: ["ping", "pulse", "glassy", "bench"],
    help: "A Pulse Generator fires one very short pulse per note and its Ring output rings at the note's pitch as a clean, glassy ping. An amp envelope shapes it, and velocity adds to the pulse amplitude, so harder notes ring brighter and longer.\n\nPatch Notes in and take Out L/R. The shared Damping input adds to the Pulse Generator's ring damping.\n\nRaise Damping for short blips, lower it for sustained, bell-like tones.",
  }).settings({ voices: 10, spread: 0.3 }).input("damp", "Damping");
  const pg = pinger(p, [0, 0], { ringfreq: 523.25, damping: 0.55, width: 0.0003 });
  p.cable(p.cin, "damp", pg, "damping", 0.4);
  ampEnvelope(p, { node: pg, jack: "ring" }, [1, 1], AMP(0.4, 1.5));
  return p;
}

// Wide pulses rung at low frequency: small drums thumped on the bench.
function benchThump() {
  const p = voice("Bench Thump", {
    description: "Wide pulses ring a low, quickly damped resonance for tuned thumps like knuckles on a metal cabinet; play it in the low octaves.",
    tags: ["ping", "thump", "drum", "bench"],
    help: "A Pulse Generator with wide pulses rings a low, quickly damped resonance tuned by the note, which gives a short tuned thump. Velocity hits harder.\n\nPatch Notes in and take Out L/R. There are no shared inputs; open the cell to change the pulse width or ring damping.\n\nPlay it in the low octaves as a tuned kick or tom, and drive it from a sequencer for patterns.",
  }).settings({ voices: 8, spread: 0.2 });
  const pg = pinger(p, [0, 0], { ringfreq: 130.81, damping: 0.25, width: 0.003 });
  ampEnvelope(p, { node: pg, jack: "ring" }, [1, 1], AMP(0.25, 0.6));
  return p;
}

// A burst of up to six pulses, each ringing, into a tape loop.
function ratchetPing() {
  const p = voice("Ratchet Ping", {
    description: "Each note fires a burst of six pulses that ring a high resonance into a wobbling tape loop, for stuttering, chattering pings.",
    tags: ["ping", "burst", "tape", "stutter"],
    help: "Each note makes the Pulse Generator fire a burst of six pulses 28 ms apart. They ring a high resonance into a Zone Delay with 70% feedback, a dark tone and some wobble, so the ping stutters and smears.\n\nPatch Notes in and take Out L/R. The shared Feedback input adds to the Zone Delay's feedback and lengthens the loop.\n\nSend a slow LFO to Feedback to let the repeats bloom and die, but keep single notes short, as the loop can run on.",
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
    description: "A noise burst kicks a filter held just short of self-oscillation, giving a pure whistling sine at the note that blooms and fades.",
    tags: ["ping", "filter", "whistle", "sine"],
    help: "A short noise burst excites a State Variable filter with its resonance set very high, close to self-oscillation, and the filter tracks the keyboard. The result is a nearly pure sine at the note's pitch that blooms and fades.\n\nPatch Notes in and take Out L/R. The shared Resonance input adds a small amount to the filter resonance and pushes it nearer to oscillation.\n\nTry a slow LFO on Resonance, or play a chord to hear several whistles at once.",
  }).settings({ voices: 10, spread: 0.3 }).input("res", "Resonance");
  const b = burst(p, [0, 0], 0.01);
  const f = p.add("filter", [2, 0], { cutoff: 261.63, resonance: 0.985, keytrack: 1, type: "SVF Multimode", mode: "BP", drive: 0.1 });
  p.cable(b, "l", f, "l").cable(p.vin, "pitch", f, "pitch").cable(p.cin, "res", f, "resonance", 0.03);
  ampEnvelope(p, { node: f, jack: "l" }, [3, 1], AMP(0.5, 2));
  return p;
}

// A ladder filter driven into self-oscillation by a click.
function ladderSnap() {
  const p = voice("Ladder Snap", {
    description: "A single click rings a ladder filter at full resonance: a fat, saturating sine that is struck rather than held; play it with varied velocity.",
    tags: ["ping", "filter", "ladder", "snap"],
    help: "A single click from the Pulse Generator (Ring off) hits a Ladder Tanh filter with its resonance almost fully up, so it rings as a self-oscillating sine that follows the keyboard. The amp envelope keeps the tail short.\n\nPatch Notes in and take Out L/R. There are no shared inputs; velocity pushes into the filter's drive, so harder notes are fatter and more saturated.\n\nPlay with varying velocity to change how fat each snap is.",
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
    description: "A noise burst runs through a band-pass filter and a tuned comb that feeds back into the filter, ringing and squealing before it settles on the note.",
    tags: ["feedback", "loop", "comb", "squeal"],
    help: "A noise burst enters a Band Pass filter. Its output goes to a Zone Delay comb tuned to the note, and the comb feeds back into the filter on a cable at 55%. The loop rings, squeals and settles at the note, and a limiter before the output catches overload.\n\nPatch Notes in and take Out L/R. The shared Loop Amount input adds to the comb's feedback.\n\nRaise Loop Amount carefully for longer, screechier loops, and watch your monitor level.",
  }).settings({ voices: 6, spread: 0.3 }).input("loop", "Loop Amount");
  const b = burst(p, [0, 0], 0.008);
  const f = p.add("filter", [2, 0], { cutoff: 800, resonance: 0.6, type: "SVF Multimode", mode: "BP", keytrack: 1 }, { name: "Loop Filter" });
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
    description: "A noise burst in a tuned comb with 95% feedback gives Karplus-Strong style plucks; play it like a string, velocity is the pluck.",
    tags: ["feedback", "karplus", "comb", "pluck"],
    help: "A noise burst goes into a Zone Delay used as a single tuned comb with 95% feedback, tuned to the note: a Karplus-Strong pluck. Tone is set a little dark, so the string loses highs as it rings. Velocity makes the burst louder.\n\nPatch Notes in and take Out L/R. The shared Brightness input adds to Tone.\n\nRaise Brightness for a bright, steel-like string, lower it for a dull, nylon-like one.",
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
    description: "A click in a tuned comb with wobble, diffusion and a rough character, so the pitch sags and shimmers like a damaged tape string.",
    tags: ["feedback", "comb", "tape", "wobble"],
    help: "A pulse ping goes into a Zone Delay comb with 93% feedback and a rough Character, plus diffusion and wobble. The wobble modulates the delay time, so the pitch sags and shimmers like a damaged tape string.\n\nPatch Notes in and take Out L/R. The shared Wobble input adds to the Zone Delay's wobble.\n\nPush Wobble up for seasick pitch with short notes, or keep it low for a steadier comb.",
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
    description: "A test oscillator with loop gain just under 100%, kicked by each note, rings like a tuned bench drum; play low notes.",
    tags: ["ping", "drum", "kick", "oscillator"],
    help: "A Test Oscillator with its loop gain just below 100% is kicked by each note. It rings as a stable sine that decays and bounces, like a tuned bench drum. The note sets the pitch and velocity shapes the level.\n\nPatch Notes in and take Out L/R. The shared Loop Gain input adds to the oscillator's loop gain, so it rings longer.\n\nPlay low notes for kick drums. Raise Loop Gain a little for longer tails, but beyond 100% it turns into a hum.",
  }).settings({ voices: 6, spread: 0.2 }).input("gain", "Loop Gain");
  const to = p.add("test-oscillator", [1, 0], { range: "×10", freq: 6, loopgain: 0.93, kick: 0.9, drift: 0.2, level: 0.9 });
  p.cable(p.vin, "pitch", to, "pitch").cable(p.vin, "trigger", to, "kick").cable(p.cin, "gain", to, "loopgain", 0.1);
  ampEnvelope(p, { node: to, jack: "sine" }, [2, 1], AMP(0.6, 1.2));
  return p;
}

// Loop gain over unity: it hums while held.
function lampHum() {
  const p = voice("Lamp Hum", {
    description: "A test oscillator with loop gain over unity warms up and hums while a key is held; hold low chords for an old lab drone.",
    tags: ["drone", "hum", "oscillator", "sustain"],
    help: "A Test Oscillator with loop gain over 100% and a 50 Hz mains hum is kicked once by each note. It warms up and sustains a sine while the key is held. A small reverb adds space and a limiter sits at the output.\n\nPatch Notes in and take Out L/R. The shared Drift input adds to the oscillator's drift.\n\nRaise Drift for a wandering, unstable pitch, and hold a few low notes for the hum.",
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
    description: "A noise burst through a very narrow band-pass tuned by the note leaves a single bare, slightly wavering sine; play intervals to hear pure partials.",
    tags: ["ping", "partial", "sine", "pure"],
    help: "A noise burst goes through a Wave Analyzer set to a very narrow 10 Hz band, tuned by the note. Only one partial survives, so it rings as a bare, slightly wavering sine. The band output goes through the amp envelope.\n\nPatch Notes in and take Out L/R. The shared Gain input adds to the analyzer's gain, which sets how loud the narrow band is.\n\nPlay intervals or chords for several pure sines, and raise Gain if the notes are too quiet.",
  }).settings({ voices: 8, spread: 0.3 }).input("gain", "Gain");
  const b = burst(p, [0, 0], 0.15);
  const wa = p.add("wave-analyzer", [2, 0], { frequency: 261.63, gain: 40, drift: 0.2, bandwidth: "10 Hz", mode: "Manual" });
  p.cable(b, "l", wa, "in").cable(p.vin, "pitch", wa, "pitch").cable(p.cin, "gain", wa, "gain", 0.2);
  ampEnvelope(p, { node: wa, jack: "band" }, [3, 1], AMP(0.9, 2));
  return p;
}

// A drum-room of delays feeding itself past unity, pinged by the resonator.
function runawayRoom() {
  const p = voice("Runaway Room", {
    description: "A tuned ping feeds a delay network with feedback over 100%, so the room builds up and squeals until the envelope reins it in; play short, low notes.",
    tags: ["feedback", "runaway", "delay", "squeal"],
    help: "A pinger fires a tuned pulse into a Delay Network in Mesh routing with feedback over 100%. The room builds on itself and squeals, and the amp envelope, with a limiter after it, keeps it under control.\n\nPatch Notes in and take Out L/R. The shared Feedback input adds to the network's feedback.\n\nPlay short, low notes and expect a loud, unstable result. Lower Feedback to calm the room.",
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
    description: "A pulse knocks a modal resonator with a high Structure, giving metallic, inharmonic plate rings at the note; sweep Structure while playing.",
    tags: ["ping", "plate", "metal", "inharmonic"],
    help: "A short pulse knocks the Resonator in Modal model with a rather high Structure, which gives inharmonic, metallic rings. The note tunes the resonator and velocity makes the tone brighter.\n\nPatch Notes in and take Out L/R. The shared Structure input adds to the Resonator's structure, i.e. how clangorous the plate is.\n\nSweep Structure while you play to move from a tuned bell to a harsh sheet of metal.",
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
    description: "Noise pinged through a slow low pass gate into a string resonator gives soft, organic knocks that bloom into a note; velocity opens the gate wider.",
    tags: ["ping", "gate", "string", "organic"],
    help: "Noise is pinged through a Low Pass Gate, with its slow vactrol response, into a String-model Resonator tuned by the note. The gate opens and closes softly, so the knock blooms into a tone. Velocity sets how far the gate opens.\n\nPatch Notes in and take Out L/R. There are no shared inputs; open the cell to change the gate's response or the resonator's damping.\n\nPlay soft and hard notes to hear the difference: harder ones open the gate wider.",
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
    description: "A noise burst pings two resonators a fifth apart that feed each other, for a self-answering two-note ring; play single notes and let them bloom.",
    tags: ["feedback", "resonator", "fifth", "sympathetic"],
    help: "A noise burst pings two Modal Resonators, Root and Fifth (7 semitones up). Each is also fed back into the other at 45%, so they answer each other and ring sympathetically. Root and Fifth reach the output through separate amps.\n\nPatch Notes in and take Out L/R. The shared Damping input adds to the damping of both resonators.\n\nRaise Damping for a shorter, tighter exchange; lower it for a ring that builds up on repeated notes.",
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
    description: "A band-passed noise burst scrapes a sympathetic-string resonator, which sings at the note's overtones; play chords for several string sets.",
    tags: ["ping", "scrape", "strings", "sympathetic"],
    help: "A noise burst is filtered by a Band Pass filter (the Scrape) and strikes the Resonator in Sympathetic model, whose strings sing at the overtones of the note. Velocity opens the Scrape filter, so harder notes scrape brighter.\n\nPatch Notes in and take Out L/R. The shared Brightness input adds to the Resonator's brightness.\n\nRaise Brightness for a brighter, more metallic scrape, and play chords to excite several string sets.",
  }).settings({ voices: 6, spread: 0.6 }).input("bright", "Brightness");
  const b = burst(p, [0, 0], 0.05, 0.4);
  const bp = p.add("filter", [2, 0], { cutoff: 3500, resonance: 0.4, mode: "BP", type: "SVF Multimode" }, { name: "Scrape" });
  const res = p.add("resonator", [3, 0], { model: "Sympathetic", structure: 0.5, brightness: 0.6, damping: 0.25, inputgain: 6, width: 1 });
  p.cable(b, "l", bp, "l").cable(p.vin, "velocity", bp, "cutoff", 0.15).cable(bp, "l", res, "in")
    .cable(p.vin, "pitch", res, "pitch").cable(p.cin, "bright", res, "brightness", 0.4);
  ampEnvelope(p, { node: res, stereo: true, jacks: ["odd", "even"] }, [4, 1], AMP(0.8, 3));
  return p;
}

// Metal sheet struck through Modal Voice's external input.
function metalSheet() {
  const p = voice("Metal Sheet", {
    description: "A pulse ping drives a plate body in a big room through its external input, a thunder-sheet clang that rings at the note.",
    tags: ["ping", "plate", "clang", "room"],
    help: "A pulse ping goes into Modal Voice's external input (its own strike is off). The plate body in a big room rings at the note like a thunder sheet. The Modal Voice gate follows the key.\n\nPatch Notes in and take Out L/R. The shared Space input adds to the room size, so the clang gets bigger.\n\nRaise Space for a cavernous sheet, or lower it for a tight, dry clang.",
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
    description: "A struck bell resonance goes into a feeding-back frequency shifter, so each repeat climbs a few Hz and the ping curls into inharmonic spirals.",
    tags: ["feedback", "bell", "shifter", "spiral"],
    help: "A pulse pings a Modal Resonator, and its odd and even outputs go into a Frequency Shifter with 78% feedback. Each repeat is shifted up by a few Hz, so the bell curls into inharmonic spirals. A limiter sits before the output.\n\nPatch Notes in and take Out L/R. The shared Shift input adds to the frequency shift amount.\n\nMove Shift for faster or slower spirals, and keep notes short, as the feedback tail is long.",
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
    description: "A ping into a near-endless reverb whose room holds the hiss and the note, so it blooms and hangs in the air; play single notes and let them ring.",
    tags: ["feedback", "reverb", "bloom", "ambient"],
    help: "A pinged pulse enters a very long reverb (40 second decay, 100% mix, wide) and the room holds onto the hiss and the note. The amp envelope has a long release, so the sound blooms and hangs. A limiter sits at the output.\n\nPatch Notes in and take Out L/R. The shared Decay input adds to the reverb's decay time.\n\nPlay single notes and let them ring. Lower Decay if the tail gets in the way of the next note.",
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
    description: "A pitched ping drops into a slow tape loop with 88% feedback and a lurching wobble; each repeat is duller and slightly flat.",
    tags: ["feedback", "tape", "echo", "wobble"],
    help: "A pitched ping goes into a Zone Delay in Tape time mode with 88% feedback, dark Tone and a lot of wobble. Each repeat is duller and slightly out of tune, as in a worn tape loop. A limiter sits at the output.\n\nPatch Notes in and take Out L/R. The shared Feedback input adds to the delay feedback.\n\nRaise Feedback for longer-lasting repeats, or send a slow LFO there for a loop that breathes.",
  }).settings({ voices: 6, spread: 0.5 }).input("fb", "Feedback");
  const pg = pinger(p, [0, 0], { ringfreq: 784, damping: 0.5 });
  const dly = p.add("zone-delay", [1, 0], { zone: 4, time: 0.45, feedback: 0.88, character: 0.55, tone: -0.5, wobble: 0.6, diffuse: 0.15,
    mix: 0.7, timechange: "Tape" });
  p.cable(pg, "ring", dly, "l").cable(pg, "ring", dly, "r").cable(p.cin, "fb", dly, "feedback", 0.1);
  const { amp } = ampEnvelope(p, { node: dly, stereo: true }, [2, 1], { attack: 0.001, decay: 0.8, sustain: 1, release: 4, velamount: 0.3 });
  limited(p, amp, [4, 1]);
  return p;
}

export default category("Feedback & Pings", "Lab-bench pings and feedback loops: a click or noise burst rings a tuned resonance (a self-oscillating filter, comb, resonator, test oscillator, delay loop) and the note tunes it. Voice Cells that follow velocity: patch Notes in and Out L/R out.", [
  labPing, benchThump, ratchetPing, filterWhistle, ladderSnap, loopedBandpass, combString, warpedComb, loopKick, lampHum,
  partialPick, runawayRoom, plateKnock, vactrolKnock, crossFedFifth, sympatheticRattle, metalSheet, spiralBell, hissBloom, tapeLoopPing,
]);
