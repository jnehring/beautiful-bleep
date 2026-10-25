// SPDX-License-Identifier: MIT
// Contour: factory presets (see ../build-modules.mjs).
export default [
  ["Short Pluck", { shape: "Pluck 1:8 soft", time: 0.3, mode: "One-shot" }, "Quick plucked decay for synth bass and leads."],
  ["Snappy Click", { shape: "Click", time: 0.03, mode: "One-shot" }, "Tiny transient: for percussive attacks or pitch snaps."],
  ["Long Exp Decay", { shape: "Long exp", time: 2, mode: "One-shot" }, "Slow exponential fade for sustained tails."],
  ["Organ Gate", { shape: "Organ", time: 0.4, mode: "Gated" }, "Held while the key is down: organ-like on and off."],
  ["ADSR Classic", { shape: "ADSR 50%", time: 1.5, mode: "Gated" }, "A conventional attack, decay, sustain, release contour."],
  ["Slow Pad", { shape: "Pad", time: 4, mode: "Gated" }, "Gentle swell and long release for pads."],
  ["Reverse Rise", { shape: "Slow rise", time: 3, mode: "One-shot" }, "Rises slowly toward the end: for risers and swells."],
  ["Bounce Ball", { shape: "Bounce 5", time: 1.2, mode: "One-shot" }, "Bouncing, ever-quicker hits: a dropped ball."],
  ["Echo Taps", { shape: "Echoes 1/8", time: 1, mode: "One-shot" }, "Decaying repeats from one trigger, like a rhythmic echo."],
  ["Heartbeat", { shape: "Heartbeat", time: 1, mode: "Loop" }, "Looping double-thump pulse at about 60 BPM."],
  ["Breathing", { shape: "Breathing", time: 6, mode: "Loop" }, "Slow organic in and out for pads and filters."],
  ["Sine LFO", { shape: "Sine", time: 0.25, mode: "Loop" }, "Plain looping sine at 4 Hz: vibrato or tremolo."],
  ["Synced Stutter", { shape: "x.x.xx.x", time: 1, mode: "Loop", sync: "1/4" }, "Rhythmic gate pattern locked to the tempo."],
  ["Swing Wobble", { shape: "Swing wobble", time: 1, mode: "Loop", sync: "1/8", level: 0.8 }, "Tempo-synced wobble with a shuffle feel."],
  ["Morphing Texture", { shape: "Texture 3", time: 3, mode: "Loop", morph: 0.5, skew: 0.2 }, "Irregular looping texture, shifted by Morph: organic movement."],
  ["Reversed Roll", { shape: "Roll", time: 0.8, mode: "One-shot", reverse: true }, "A drum roll played backwards: builds into the next beat."],
];
