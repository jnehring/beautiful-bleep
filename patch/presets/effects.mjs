// SPDX-License-Identifier: MIT
// Effects: space, time and movement. Stereo cells: In L/R → processing → Out L/R.
import { cell, category } from "./kit.mjs";

// Bright, dense plate with a touch of pre-delay and a little modulation.
function glassPlate() {
  const p = cell("Glass Plate", {
    description: "A dense, bright plate reverb with a short pre-delay and a two-second tail: vocals, snares and keys gain a polished sheen. Shared inputs Mix and Decay.",
    tags: ["reverb", "plate", "bright", "vocal"],
    help: "A single Reverb with high diffusion, little damping and a tone tilted bright. Pre-delay is 12 ms so the " +
      "attack of the sound stays clear before the plate blooms. The reverb is 30 percent wet.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Mix is added to the reverb's Mix knob and Decay to " +
      "its Decay knob, which stretches the tail from a tight plate towards a hall.\n\n" +
      "Tip: put it on a snare and pull Decay down for a classic gated-feeling splash.",
  }).stereoIn().stereoOut().input("mix", "Mix").input("decay", "Decay")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 8 } });
  const verb = p.add("reverb", [1, 0], { size: 0.4, decay: 2.2, preDelay: 0.012, diffusion: 0.95, damping: 0.2,
                                         modRate: 0.8, modDepth: 0.2, tone: 0.3, width: 1.2, mix: 0.3 });
  p.stereo(p.cin, verb).stereo(verb, p.cout)
    .cable(p.cin, "mix", verb, "mix", 0.5).cable(p.cin, "decay", verb, "decay", 0.3);
  return p;
}

// Short, dark, single repeat: the slapback.
function slapSmear() {
  const p = cell("Slap & Smear", {
    description: "A single dark 110 ms slapback with a whisper of feedback, smeared by a short room: it thickens guitars and vocals without becoming an echo. Shared inputs Mix and Time.",
    tags: ["delay", "slapback", "rockabilly", "short"],
    help: "A Delay at 110 ms on the left and 135 ms on the right, with very little feedback, a high cut at " +
      "3.5 kHz so the repeat sits behind the sound, and a small Room reverb after it.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Mix is added to the delay's Mix and Time to both " +
      "delay times, so you can slide between a doubling and a clear slap.\n\n" +
      "Tip: use it on a dry guitar or a vocal, and turn Mix down until you only notice it when it is gone.",
  }).stereoIn().stereoOut().input("mix", "Mix").input("time", "Time")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 3 } });
  const dly = p.add("delay", [1, 0], { timel: 110, timer: 135, feedback: 0.12, lowcut: 180, highcut: 3500, mix: 0.28 });
  const room = p.add("reverb", [2, 0], { size: 0.2, decay: 0.6, damping: 0.6, mix: 0.18 }, { name: "Room" });
  p.stereo(p.cin, dly).stereo(dly, room).stereo(room, p.cout)
    .cable(p.cin, "mix", dly, "mix", 0.5).cable(p.cin, "time", dly, "timel", 0.2).cable(p.cin, "time", dly, "timer", 0.2);
  return p;
}

// Triplet on the left, quarter on the right, ping-pong.
function tripletBounce() {
  const p = cell("Triplet Bounce", {
    description: "Tempo-synced echoes that bounce between the ears: eighth-triplets on the left, dotted eighths on the right, each repeat a little darker. Shared inputs Feedback and Mix.",
    tags: ["delay", "ping-pong", "triplet", "tempo", "rhythmic"],
    help: "A Delay in tempo-sync mode and Ping-Pong mode, with 1/8T on the left and 1/8. on the right. Low and " +
      "high cut shape every repeat, so the echoes thin out as they fade. The delay follows the transport tempo.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Feedback is added to the delay's Feedback and Mix to " +
      "its Mix.\n\n" +
      "Tip: it is made for sparse plucks and short hits; with a busy part, keep Mix low.",
  }).stereoIn().stereoOut().input("fb", "Feedback").input("mix", "Mix")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 12 } });
  const dly = p.add("delay", [1, 0], { sync: "Tempo", ratel: "1/8T", rater: "1/8.", mode: "Ping-Pong",
                                       feedback: 0.5, lowcut: 200, highcut: 5500, mix: 0.35 });
  p.stereo(p.cin, dly).stereo(dly, p.cout)
    .cable(p.cin, "fb", dly, "feedback", 0.4).cable(p.cin, "mix", dly, "mix", 0.5);
  return p;
}

// Eight scattered, jittered lines in a mesh.
function scatterLab() {
  const p = cell("Scatter Lab", {
    description: "Six delay lines fed back into each other in a mesh, with scattered and jittered times and some reversed taps: a cloud of echoes that never repeats itself the same way. Shared inputs Feedback and Scatter.",
    tags: ["delay", "scatter", "texture", "experimental", "ambient"],
    help: "A Delay Net with six taps in Mesh routing. Scatter spreads the tap times, Jitter makes them wander, a " +
      "share of the taps play backwards, and every feedback pass picks up a little character and darkness.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Feedback is added to the feedback knob (above about " +
      "90 percent it sustains for a long time) and Scatter to the scatter knob.\n\n" +
      "Tip: feed it short notes and sweep Scatter slowly while the cloud rings.",
  }).stereoIn().stereoOut().input("fb", "Feedback").input("scatter", "Scatter")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 16 } });
  const net = p.add("delay-network", [1, 0], { time: 0.45, taps: 6, scatter: 0.5, jitter: 0.25, reverse: 0.25,
                                               feedback: 0.55, character: 0.4, tone: -0.2, width: 0.9, routing: "Mesh", mix: 0.4 });
  p.stereo(p.cin, net).stereo(net, p.cout)
    .cable(p.cin, "fb", net, "feedback", 0.3).cable(p.cin, "scatter", net, "scatter", 0.5);
  return p;
}

// Two choruses at different speeds, one dark.
function lushEnsemble() {
  const p = cell("Lush Ensemble", {
    description: "Two choruses at unrelated slow speeds, one with a longer delay, blended and widened: strings, pads and electric pianos melt into a big ensemble. Shared inputs Depth and Mix.",
    tags: ["chorus", "ensemble", "strings", "wide", "pad"],
    help: "Two Chorus modules in a row. The first is quick and shallow with a short delay, the second is slow and " +
      "deep with a longer delay, and both spread their voices wide. Together they smear the pitch in two " +
      "different time scales, like a string ensemble.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Depth is added to the depth of both choruses; Mix " +
      "to the mix of the second one.\n\n" +
      "Tip: it is made for chords and sustained sounds; single notes get a seasick detune.",
  }).stereoIn().stereoOut().input("depth", "Depth").input("mix", "Mix");
  const a = p.add("chorus", [1, 0], { rate: 0.9, depth: 0.3, delay: 7, spread: 0.9, mix: 0.5 }, { name: "Fast Chorus" });
  const b = p.add("chorus", [2, 0], { rate: 0.23, depth: 0.55, delay: 17, spread: 1, mix: 0.5 }, { name: "Slow Chorus" });
  p.stereo(p.cin, a).stereo(a, b).stereo(b, p.cout)
    .cable(p.cin, "depth", a, "depth", 0.4).cable(p.cin, "depth", b, "depth", 0.4).cable(p.cin, "mix", b, "mix", 0.5);
  return p;
}

// Twelve stages with negative feedback.
function hollowSwirl() {
  const p = cell("Hollow Swirl", {
    description: "Twelve allpass stages with negative feedback, swept wide and slowly: a hollow, glassy phaser that rolls through guitars, synth pads and drum loops. Shared inputs Speed and Centre.",
    tags: ["phaser", "swirl", "hollow", "guitar", "modulation"],
    help: "A Phaser with twelve stages, negative feedback, a wide sweep and the right ear offset from the left. " +
      "Negative feedback gives the hollow, glassy colour instead of the nasal sound of positive feedback.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Speed is added to the Rate knob and Centre moves the " +
      "middle of the sweep up or down. It does not follow the transport.\n\n" +
      "Tip: raise Centre for a brighter, airier sweep on pads; lower it for a heavy, dark roll on bass-rich loops.",
  }).stereoIn().stereoOut().input("speed", "Speed").input("centre", "Centre");
  const ph = p.add("phaser", [1, 0], { rate: 0.14, depth: 0.85, centre: 900, feedback: -0.7, stages: "12", spread: 0.8, mix: 0.55 });
  p.stereo(p.cin, ph).stereo(ph, p.cout)
    .cable(p.cin, "speed", ph, "rate", 0.4).cable(p.cin, "centre", ph, "centre", 0.4);
  return p;
}

// The reverb tail goes up an octave and returns into the reverb.
function octaveCloud() {
  const p = cell("Octave Cloud", {
    description: "The reverb's tail is sent up an octave and back into the reverb so every echo climbs: a bright, celestial halo above pads and single notes. Shared inputs Mix, Climb and Freeze.",
    tags: ["shimmer", "octave", "reverb", "ambient", "celestial"],
    help: "A Reverb whose wet signal goes through a Pitch Shifter (up twelve semitones), a VCA named Climb and a " +
      "Limiter, and back into the reverb. Each echo is an octave higher than the last, and the limiter keeps the " +
      "loop from running away.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Mix is added to the reverb mix, Climb to the loop " +
      "gain (more means more ascending echoes) and a gate into Freeze holds the tail. The tail is long, about " +
      "twenty seconds.\n\n" +
      "Tip: play sustained chords, then raise Climb slowly for a rising wall.",
  }).stereoIn().stereoOut().input("mix", "Mix").input("climb", "Climb").input("freeze", "Freeze", "gate")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 20 } });
  const verb = p.add("reverb", [1, 0], { size: 0.85, decay: 7, preDelay: 0.02, damping: 0.35, modDepth: 0.35, tone: 0.1, mix: 0.5 });
  const gain = p.add("vca", [2, 1], { gain: 0.33 }, { name: "Climb" });
  const shift = p.add("pitch-shifter", [3, 1], { pitch: 12, window: 100, drift: 0.12, mix: 1 });
  const lim = p.add("limiter", [4, 1], { ceiling: -6, release: 150, input: 0 });
  p.stereo(p.cin, verb).stereo(verb, gain, { from: ["wetL", "wetR"] }).stereo(gain, shift).stereo(shift, lim)
    .stereo(lim, verb).stereo(verb, p.cout)
    .cable(p.cin, "mix", verb, "mix", 0.5).cable(p.cin, "climb", gain, "gain", 0.5).cable(p.cin, "freeze", verb, "freeze");
  return p;
}

// Two opposed LFO gains: the sound swings left and right.
function swayingAutoPan() {
  const p = cell("Swaying Auto-Pan", {
    description: "A slow sine swells the left channel while it fades the right, and the other way round: the whole image sways between the ears. Shared inputs Rate and Depth.",
    tags: ["auto-pan", "tremolo", "stereo", "movement"],
    help: "An LFO feeds a Multiplier named Depth. One output drives a VCA on the left channel, the other, " +
      "inverted, drives a VCA on the right, so the loudness of the two sides moves in opposite directions.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Rate is added to the LFO rate and Depth is added to " +
      "the Multiplier, so zero depth leaves the sound still and centred. It does not follow the transport.\n\n" +
      "Tip: a stereo source works best; with a mono source, the pan is more obvious than with a wide one.",
  }).stereoIn().stereoOut().input("rate", "Rate").input("depth", "Depth");
  const lfo = p.add("lfo", [0, 1], { rate: 0.28, wave: "Sine" }, { name: "Sway" });
  const amt = p.add("multiplier", [1, 1], { biasy1: 0.4, biasy2: 0.4, gain2: -1 }, { name: "Depth" });
  const left = p.add("vca", [2, 0], { gain: 0.75, response: "Linear" }, { name: "Left Gain" });
  const right = p.add("vca", [2, 2], { gain: 0.75, response: "Linear" }, { name: "Right Gain" });
  p.cable(lfo, "out", amt, "x1").cable(lfo, "out", amt, "x2")
    .cable(p.cin, "depth", amt, "y1", 0.3).cable(p.cin, "depth", amt, "y2", 0.3)
    .cable(p.cin, "rate", lfo, "rate", 0.4)
    .cable(p.cin, "l", left, "l").cable(p.cin, "r", left, "r")
    .cable(p.cin, "l", right, "l").cable(p.cin, "r", right, "r")
    .cable(amt, "out1", left, "gain", 0.5).cable(amt, "out2", right, "gain", 0.5)
    .cable(left, "l", p.cout, "l").cable(right, "r", p.cout, "r");
  return p;
}

// Grains frozen into a drifting cloud under a long reverb.
function frozenMoment() {
  const p = cell("Frozen Moment", {
    description: "A gate holds whatever the grains have just heard and spreads it into a slowly drifting, endless cloud under a deep reverb. Shared inputs Freeze, Mix and Drift.",
    tags: ["freeze", "granular", "drone", "ambient", "texture"],
    help: "Grains records the input into a buffer and plays it back as a soft cloud with generous blur. A Reverb " +
      "follows with a long decay. When Freeze is high, the buffer stops recording and the cloud keeps playing " +
      "what it holds.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. A gate into Freeze holds the moment; Mix is added to " +
      "the Grains mix and Drift to its Texture knob, which changes how scattered the cloud is. The tail is long.\n\n" +
      "Tip: play a chord, hold Freeze, then play something new over the drone.",
  }).stereoIn().stereoOut().input("freeze", "Freeze", "gate").input("mix", "Mix").input("drift", "Drift")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 18 } });
  const gr = p.add("grains", [1, 0], { size: 0.5, density: 0.55, texture: 0.4, spread: 0.7, pitch: 0, feedback: 0.15, blur: 0.6, mix: 0.6 });
  const verb = p.add("reverb", [2, 0], { size: 0.8, decay: 6, damping: 0.4, modDepth: 0.3, mix: 0.3 });
  p.stereo(p.cin, gr).stereo(gr, verb).stereo(verb, p.cout)
    .cable(p.cin, "freeze", gr, "freeze").cable(p.cin, "mix", gr, "mix", 0.5).cable(p.cin, "drift", gr, "texture", 0.5);
  return p;
}

// Frequency shifter with feedback: metallic, bell-like spirals.
function bellSpiral() {
  const p = cell("Bell Spiral", {
    description: "A frequency shifter whose echoes feed back through a delay, so each pass lifts the spectrum a little: inharmonic bell spirals that climb out of any note. Shared inputs Shift and Feedback.",
    tags: ["frequency shifter", "spiral", "metallic", "bell", "experimental"],
    help: "A Frequency Shifter moves the whole spectrum up by a fixed number of hertz, not by a musical interval, " +
      "and feeds it back through a short delay. Every pass shifts again, so a plucked note turns into a " +
      "spiral of inharmonic partials. Spread makes the two ears go in opposite directions.\n\n" +
      "Patch a sound into In L/R and take Out L/R onwards. Shift is added to the shifter's Shift knob and " +
      "Feedback to its Feedback knob. The tail rings for a while.\n\n" +
      "Tip: use single plucks or drum hits, and keep Feedback below the point where it starts to sing on its own.",
  }).stereoIn().stereoOut().input("shift", "Shift").input("fb", "Feedback")
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: 6 } });
  const fs = p.add("freq-shifter", [1, 0], { shift: 0.2, fine: 0, feedback: 0.6, fbDelay: 0.3, spread: 0.6, mix: 0.45 });
  p.stereo(p.cin, fs).stereo(fs, p.cout)
    .cable(p.cin, "shift", fs, "shift", 0.2).cable(p.cin, "fb", fs, "feedback", 0.3);
  return p;
}

export default category("Effects", "Space, time and movement: reverbs, delays, choruses, phasers, shimmer and textures. Patch In L/R from any sound and take Out L/R onwards.", [
  glassPlate, slapSmear, tripletBounce, scatterLab, lushEnsemble, hollowSwirl, octaveCloud, swayingAutoPan,
  frozenMoment, bellSpiral,
]);
