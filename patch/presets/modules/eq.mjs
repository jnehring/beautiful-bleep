// SPDX-License-Identifier: MIT
// EQ: factory presets.
export default [
  ["Smile Curve", { lowHz: 100, lowGain: 4, m1Gain: 0, m2Gain: 0, highHz: 8000, highGain: 4 }, "Boosted lows and highs: instant polish."],
  ["Bass Boost", { lowHz: 80, lowGain: 8, level: -2 }, "More weight below 80 Hz."],
  ["Low Cut Lite", { lowHz: 120, lowGain: -12, m1Hz: 300, m1Gain: -2, m1Q: 0.7 }, "Thins the lows and clears mud."],
  ["Mud Remover", { m1Hz: 280, m1Gain: -6, m1Q: 1.5 }, "Cuts the boxy low-mids."],
  ["Presence Lift", { m2Hz: 3500, m2Gain: 5, m2Q: 0.9 }, "Brings the sound forward."],
  ["Air", { highHz: 11000, highGain: 7 }, "Open, airy top end."],
  ["Warm Darkness", { highHz: 5000, highGain: -9, lowHz: 200, lowGain: 3 }, "Rolls off the top and warms the bottom."],
  ["Vocal Clarity", { lowHz: 100, lowGain: -8, m1Hz: 300, m1Gain: -3, m2Hz: 4000, m2Gain: 4, highHz: 10000, highGain: 3 }, "Cleans up and brightens a voice."],
  ["Telephone", { lowHz: 400, lowGain: -15, m1Hz: 1200, m1Gain: 8, m1Q: 1.2, m2Hz: 2500, m2Gain: 5, highHz: 4000, highGain: -15, level: -3 }, "Narrow, nasal band."],
  ["Hollow Notch", { m1Hz: 800, m1Gain: -12, m1Q: 3, m2Hz: 2400, m2Gain: -10, m2Q: 3 }, "Two deep notches for a phase-like, hollow tone."],
  ["Resonant Peaks", { m1Hz: 500, m1Gain: 10, m1Q: 6, m2Hz: 3000, m2Gain: 9, m2Q: 6, level: -6 }, "Narrow, ringing boosts: formant-like colour."],
  ["Kick Shaper", { lowHz: 60, lowGain: 6, m1Hz: 350, m1Gain: -7, m1Q: 1.5, m2Hz: 4500, m2Gain: 4, level: -2 }, "Weight and click for kick drums."],
  ["Lo-Fi Radio", { lowHz: 300, lowGain: -12, m1Hz: 1500, m1Gain: 6, m1Q: 0.6, highHz: 5000, highGain: -12, level: -3 }, "Small-speaker colouration."],
  ["Tilt Down", { lowHz: 250, lowGain: 5, m1Hz: 1000, m1Gain: 0, highHz: 3000, highGain: -7 }, "Dark tilt; tames harsh sources."],
];
