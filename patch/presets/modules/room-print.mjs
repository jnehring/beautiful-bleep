// SPDX-License-Identifier: MIT
// Room Print (room-print): factory presets.
export default [
  ["Small Room", { source: "Room", mix: 0.25 }, "A short, close room."],
  ["Warm Hall", { source: "Hall", mix: 0.3, damphigh: 0.4 }, "A hall with the highs fading early."],
  ["Cathedral", { source: "Cathedral", mix: 0.4, predelay: 0.04 }, "A very long, lofty tail."],
  ["Bright Plate", { source: "Plate", mix: 0.3 }, "Dense and bright, without early reflections."],
  ["Spring Tank", { source: "Spring", mix: 0.4 }, "Chirped, boingy echoes."],
  ["Metal Tank", { source: "Tank", mix: 0.35 }, "Ringing metal modes."],
  ["Deep Cave", { source: "Cave", mix: 0.45 }, "Dark, with a few large echoes."],
  ["Swell Bloom", { source: "Swell", mix: 0.5, predelay: 0.08 }, "The reverb grows before the sound."],
  ["Gated Burst", { source: "Gate", mix: 0.5 }, "A dense burst cut off sharply."],
  ["Ping Pong Echoes", { source: "Echoes", mix: 0.35 }, "Repeats that bounce left and right."],
  ["Tight Early", { source: "Hall", balance: 0.15, mix: 0.35 }, "Only the first reflections: room without wash."],
  ["Distant Wash", { source: "Hall", balance: 0.9, damphigh: 0.7, mix: 0.5 }, "Only the late tail, dark and far."],
  ["Big and Dark", { source: "Cathedral", stretch: 0.7, damphigh: 0.6 }, "Stretched to a huge, murky space."],
  ["Closet", { source: "Room", stretch: 1.8, trimend: 0.5, mix: 0.3 }, "A tiny, bright box."],
  ["Wide Plate", { source: "Plate", width: 1.6, mix: 0.35 }, "A plate with exaggerated width."],
];
