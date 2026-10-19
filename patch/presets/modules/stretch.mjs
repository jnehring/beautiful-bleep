// SPDX-License-Identifier: GPL-3.0-or-later
// Stretch: factory presets (see ../build-modules.mjs).
export default [
  ["Half Speed", { stretch: 2, engine: "Smear", pitch: 0, window: "2048", record: "Once", length: 8, mix: 1 }, "Plays the recording at half speed with the pitch where it was."],
  ["Slow Motion", { stretch: 4, engine: "Smear", window: "2048" }, "Four times as long: transients melt, tones hold."],
  ["Crawl", { stretch: 8, engine: "Smear", window: "4096" }, "The longest stretch with the finest frequency resolution."],
  ["Double Time", { stretch: 0.5, engine: "Grains", grain: 90, overlap: "3×", scatter: 0.05 }, "Twice as fast, same pitch."],
  ["Granular Cloud", { stretch: 3, engine: "Grains", grain: 200, overlap: "4×", scatter: 0.6 }, "Long scattered grains: a cloud made from the recording."],
  ["Freeze Frame", { stretch: 1, freeze: true, engine: "Smear", window: "4096" }, "Stops time at the head and holds that moment as a drone."],
  ["Scrub Pad", { engine: "Smear", mode: "Scrub", position: 0.3, window: "2048" }, "Position is the play head: move it by hand or with a CV to scrub."],
  ["Loop Window", { stretch: 1.5, engine: "Grains", grain: 60, overlap: "3×", scatter: 0.05, hold: true, start: 0.3, range: 0.12 }, "Loops a small window of the recording over and over."],
  ["Time Wobble", { stretch: 1.5, engine: "Smear", wobble: 0.5, wobblerate: 0.5, wobbleshape: "Sine" }, "Time itself sways: the sound speeds up and slows down but never changes pitch."],
  ["Drunk Time", { stretch: 2, engine: "Grains", grain: 150, overlap: "3×", scatter: 0.2, wobble: 0.8, wobblerate: 1.5, wobbleshape: "Random" }, "Time takes an uneven walk around a slow stretch."],
  ["Backwards Smear", { stretch: 2, reverse: true, engine: "Smear", window: "2048" }, "The recording plays backwards, slowly."],
  ["Octave Down Slow", { stretch: 2, pitch: -12, engine: "Smear", window: "2048" }, "Half speed, an octave lower: the classic slowed-down sound."],
  ["Shimmer Stretch", { stretch: 4, pitch: 12, engine: "Smear", window: "4096", mix: 0.6 }, "A slow sheen an octave above, mixed under the live sound."],
  ["Rolling Capture", { stretch: 1.5, engine: "Smear", record: "Rolling", length: 4, window: "2048" }, "Keeps recording round a four-second loop while the head stretches through it."],
  ["Stutter Loop", { stretch: 1, engine: "Grains", grain: 40, overlap: "2×", scatter: 0, hold: true, start: 0.1, range: 0.02, record: "Rolling", length: 3 }, "A tiny window of the last seconds on repeat."],
];
