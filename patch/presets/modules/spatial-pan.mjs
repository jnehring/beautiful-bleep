// SPDX-License-Identifier: MIT
// Spatial Pan (spatial-pan): factory presets.
export default [
  ["Front Centre", { room: 0.15 }, "Straight ahead, a little room."],
  ["Hard Left", { azimuth: -90 }, "At the left ear."],
  ["Hard Right", { azimuth: 90 }, "At the right ear."],
  ["Behind", { azimuth: 180, distance: 0.3 }, "Behind you: duller, with the highs rolled off."],
  ["Above", { elevation: 70, distance: 0.3 }, "Overhead: the pinna notch moves up."],
  ["Below Left", { azimuth: -60, elevation: -45 }, "Low and to the left."],
  ["Slow Orbit", { orbit: 0.15 }, "A source circling the head every seven seconds."],
  ["Fast Orbit", { orbit: 0.8, distance: 0.25, doppler: 0.3 }, "A quick spin, close in."],
  ["Distant", { distance: 0.8, air: 0.8, room: 0.6 }, "Far away: quiet, soft and reverberant."],
  ["Close Whisper", { distance: 0.05, room: 0.1 }, "At the ear, almost dry."],
  ["Big Room", { room: 0.8, size: 1, distance: 0.5 }, "A large space of long reflections."],
  ["Dry Booth", { room: 0, air: 0.2 }, "No reflections: pure head cues."],
  ["Giant Head", { head: 11, azimuth: 70 }, "A large head: longer time differences."],
];
