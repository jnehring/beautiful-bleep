// SPDX-License-Identifier: MIT
// Perc Voice: factory presets (see ../build-modules.mjs).
export default [
  ["Deep Kick", { pitch: 52, tone: 0.1, click: 0.35, decay: 0.45, sweep: 0.6, level: 0.85, engine: "FM" }, "Round sine kick with a downward pitch sweep."],
  ["Punchy Kick", { pitch: 60, tone: 0.2, click: 0.6, decay: 0.25, sweep: 0.7, level: 0.85, drive: "Warm", engine: "FM" }, "Short, clicky kick with a touch of drive."],
  ["Long Sub Boom", { pitch: 45, tone: 0.05, click: 0.1, decay: 1.8, damp: 0.2, sweep: 0.3, level: 0.8, engine: "FM" }, "Sub-heavy long kick: a decaying sine boom."],
  ["Tight Tom", { pitch: 120, tone: 0.3, click: 0.3, decay: 0.4, sweep: 0.45, spread: 0.3, level: 0.8, engine: "Modal" }, "Membrane tom, mid-pitched."],
  ["Low Floor Tom", { pitch: 80, tone: 0.3, click: 0.25, decay: 0.7, sweep: 0.35, spread: 0.3, level: 0.8, engine: "Modal" }, "Deep floor tom with longer ring."],
  ["Snare Body", { pitch: 190, tone: 0.45, morph: 0.5, click: 0.5, decay: 0.3, damp: 0.5, sweep: 0.2, level: 0.8, engine: "Noise Bank" }, "Bright snare-like hit with noisy body."],
  ["Rim Click", { pitch: 600, tone: 0.55, click: 0.8, decay: 0.06, damp: 0.7, sweep: 0.1, level: 0.75, engine: "Modal" }, "Sharp, very short wooden click."],
  ["Clap Noise", { pitch: 1200, tone: 0.6, morph: 0.7, click: 0.6, decay: 0.25, damp: 0.5, sweep: 0, spread: 0.6, level: 0.75, engine: "Noise Bank" }, "Noisy burst for claps and snaps."],
  ["Closed Hat", { pitch: 3200, tone: 0.9, morph: 0.6, click: 0.4, decay: 0.07, damp: 0.7, sweep: 0, spread: 0.5, level: 0.7, engine: "Noise Bank" }, "Short metallic tick."],
  ["Open Hat", { pitch: 3000, tone: 0.9, morph: 0.6, click: 0.3, decay: 0.6, damp: 0.3, sweep: 0, spread: 0.6, level: 0.7, engine: "Noise Bank" }, "Longer metallic shimmer."],
  ["Wood Block", { pitch: 800, tone: 0.5, click: 0.4, decay: 0.12, damp: 0.6, sweep: 0.05, level: 0.8, engine: "Modal" }, "Dry, pitched wooden knock."],
  ["Bar Marimba", { pitch: 400, tone: 0.55, morph: 0.4, click: 0.2, decay: 0.8, damp: 0.3, sweep: 0, level: 0.75, engine: "Modal", track: true }, "Pitched bar sound that follows the Pitch input."],
  ["Cowbell", { pitch: 560, tone: 0.85, morph: 0.4, click: 0.3, decay: 0.35, damp: 0.45, sweep: 0, spread: 0.2, level: 0.7, engine: "FM" }, "Metallic FM clang."],
  ["Bell Ring", { pitch: 880, tone: 1, morph: 0.5, click: 0.1, decay: 3, damp: 0.15, sweep: 0, spread: 0.3, level: 0.65, engine: "Modal", track: true }, "Long inharmonic bell: play it from the Pitch input."],
  ["Zap Tom", { pitch: 300, tone: 0.2, click: 0.2, decay: 0.35, sweep: 1, level: 0.8, drive: "Hot", engine: "FM" }, "Extreme pitch sweep for sci-fi zaps."],
];
