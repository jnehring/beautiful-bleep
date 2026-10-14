// SPDX-License-Identifier: MIT
// Zone Delay: factory presets.
export default [
  ["Tape Echo", { zone: 3, time: 0.5, feedback: 0.4, character: 0.35, tone: -0.2, wobble: 0.2, mix: 0.3 }, "Classic mid-range echo with tape colour."],
  ["Dub Echo", { zone: 3, sync: "Transport", time: 0.5, feedback: 0.7, character: 0.3, tone: -0.3, mix: 0.4 }, "Tempo-synced dub repeats; ride Tone and Feedback."],
  ["Slapback", { zone: 2, time: 0.4, feedback: 0.15, character: 0.2, wobble: 0.1, mix: 0.25 }, "Short single repeat."],
  ["Stereo Spread", { zone: 3, time: 0.45, feedback: 0.4, offset: 0.3, mix: 0.35 }, "The right side lags the left for a wide echo."],
  ["Flanger", { zone: 1, time: 0.4, feedback: 0.6, character: 0.1, wobble: 0.3, mix: 0.5 }, "In the comb zone: sweep Time with an LFO."],
  ["Tuned Comb", { zone: 1, time: 0.5, feedback: 0.85, character: 0.15, tone: 0.2, wobble: 0, mix: 0.5 }, "Resonant ring; patch a pitch in to tune it."],
  ["Chorus Double", { zone: 2, time: 0.15, feedback: 0.1, offset: 0.15, wobble: 0.5, mix: 0.4 }, "Short, modulated times thicken a sound."],
  ["Diffuse Cloud", { zone: 4, time: 0.5, feedback: 0.75, character: 0.3, diffuse: 0.9, offset: 0.2, wobble: 0.3, mix: 0.4 }, "Repeats melt into an ambient cloud."],
  ["Ambient Wash", { zone: 4, time: 0.6, feedback: 0.9, diffuse: 0.8, wobble: 0.4, tone: -0.2, mix: 0.45 }, "Long, washy feedback."],
  ["Looper", { zone: 5, time: 0.5, feedback: 0.95, character: 0.4, wobble: 0, mix: 0.5 }, "Multi-second loop: patch Hold to keep a phrase."],
  ["Lo-Fi Loop", { zone: 5, time: 0.4, feedback: 0.85, character: 0.9, tone: -0.4, wobble: 0.5, mix: 0.45 }, "A saturated, degraded loop that gets dirtier with each pass."],
  ["Crossfade Echo", { zone: 3, time: 0.5, feedback: 0.45, character: 0.2, timechange: "Crossfade", wobble: 0, mix: 0.3 }, "Clean time changes without pitch bending."],
  ["Tape Dive", { zone: 3, time: 0.35, feedback: 0.6, character: 0.4, timechange: "Tape", glide: 1.2, wobble: 0.3, mix: 0.4 }, "Slow glide: changing Time bends the echoes."],
  ["Bright Ping", { zone: 2, time: 0.55, feedback: 0.5, tone: 0.6, diffuse: 0.1, offset: 0.1, mix: 0.3 }, "Clear and bright quick repeats."],
];
