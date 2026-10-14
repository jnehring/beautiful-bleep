// SPDX-License-Identifier: MIT
// Sweep Generator: factory presets (see ../build-modules.mjs).
export default [
  ["Up Sweep", { start: 100, stop: 5000, time: 4, waveform: "Sine", level: 0.7 }, "A repeating four-second sine rise."],
  ["Riser 4 Bars", { start: 80, stop: 8000, waveform: "Sine", sweepsync: "4 bars", mode: "Continuous", level: 0.6 }, "Tempo-locked rise over four bars."],
  ["Falling Zap", { start: 6000, stop: 80, time: 0.4, mode: "Triggered", waveform: "Triangle", level: 0.7 }, "Short falling zap on every trigger."],
  ["Siren", { start: 400, stop: 1400, time: 2, direction: "Up-Down", waveform: "Sine", level: 0.7 }, "Up-down sweep: an emergency siren."],
  ["Square Siren", { start: 500, stop: 1200, time: 1.5, direction: "Up-Down", waveform: "Square", level: 0.5 }, "Harder, buzzier siren."],
  ["Laser", { start: 8000, stop: 200, time: 0.15, mode: "Triggered", waveform: "Ramp Down", level: 0.6 }, "Very quick falling saw: classic laser shot."],
  ["Noise Whoosh LFO", { start: 0.2, stop: 8, time: 8, waveform: "Triangle", level: 0.8 }, "Sub-audio sweep: use Out as an LFO that accelerates."],
  ["Linear Rush", { start: 50, stop: 4000, time: 6, law: "Lin", waveform: "Sine", level: 0.7 }, "Linear law rushes through the bass and lingers up high."],
  ["Tone Bursts", { start: 200, stop: 4000, time: 8, mode: "Burst", burstcount: 4, waveform: "Sine", level: 0.7 }, "Each trigger plays four cycles at the current sweep position."],
  ["Pulse Riser", { start: 60, stop: 3000, time: 4, waveform: "Pulse", symmetry: -0.5, level: 0.5 }, "Narrow pulse rising: thin, urgent sound."],
  ["Gated Climb", { start: 100, stop: 2000, time: 4, mode: "Gated", waveform: "Ramp Up", level: 0.6 }, "Climbs only while the gate is held."],
  ["Marker Scan", { start: 100, stop: 6000, time: 8, markers: 3, marker1: 250, marker2: 1000, marker3: 4000, waveform: "Sine", level: 0.6 }, "Sine sweep that fires a trigger at three frequencies."],
  ["Glide Retrace", { start: 200, stop: 3000, time: 2, retrace: "Glide", waveform: "Triangle", level: 0.7 }, "Audible flyback after each sweep, like a bench sweeper."],
  ["Wobbly Bench", { start: 300, stop: 3000, time: 6, drift: 0.8, waveform: "Sine", level: 0.7 }, "Strong drift: an unstable old function generator."],
  ["Deep Fall", { start: 1000, stop: 20, time: 5, mode: "Triggered", waveform: "Sine", level: 0.8 }, "Long sub drop for impacts."],
];
