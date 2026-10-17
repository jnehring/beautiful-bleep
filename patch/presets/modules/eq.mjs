// SPDX-License-Identifier: MIT
// EQ: factory presets. Bands 1 and 8 start as switched-off cuts, 2 and 7 as shelves, 3-6 as bells (300, 800, 2000, 5000 Hz).
export default [
  ["Smile Curve", { b2Hz: 100, b2Gain: 4, b7Hz: 8000, b7Gain: 4 }, "Boosted lows and highs: instant polish."],
  ["Bass Boost", { b2Hz: 80, b2Gain: 8, level: -2 }, "More weight below 80 Hz."],
  ["Low Cut Lite", { b1On: true, b1Hz: 90, b3Hz: 300, b3Gain: -2, b3Q: 0.7 }, "Removes rumble below 90 Hz and clears a little mud."],
  ["Mud Remover", { b3Hz: 280, b3Gain: -6, b3Q: 1.5 }, "Cuts the boxy low-mids."],
  ["Presence Lift", { b5Hz: 3500, b5Gain: 5, b5Q: 0.9 }, "Brings the sound forward."],
  ["Air", { b7Hz: 11000, b7Gain: 7 }, "Open, airy top end."],
  ["Warm Darkness", { b7Hz: 5000, b7Gain: -9, b2Hz: 200, b2Gain: 3 }, "Rolls off the top and warms the bottom."],
  ["Vocal Clarity", { b1On: true, b1Hz: 90, b1Slope: "18 dB/oct", b3Hz: 300, b3Gain: -3, b5Hz: 4000, b5Gain: 4, b7Hz: 10000, b7Gain: 3 }, "Cuts the rumble, cleans up and brightens a voice."],
  ["Telephone", { b1On: true, b1Hz: 400, b1Slope: "24 dB/oct", b8On: true, b8Hz: 4000, b8Slope: "24 dB/oct", b4Hz: 1200, b4Gain: 8, b4Q: 1.2, b5Hz: 2500, b5Gain: 5, level: -3 }, "Steep cuts below 400 Hz and above 4 kHz, a nasal band in between."],
  ["Hollow Notch", { b4Type: "Notch", b4Hz: 800, b4Q: 4, b5Type: "Notch", b5Hz: 2400, b5Q: 4 }, "Two deep notches for a phase-like, hollow tone."],
  ["Resonant Peaks", { b3Hz: 500, b3Gain: 10, b3Q: 6, b5Hz: 3000, b5Gain: 9, b5Q: 6, level: -6 }, "Narrow, ringing boosts: formant-like colour."],
  ["Kick Shaper", { b2Hz: 60, b2Gain: 6, b3Hz: 350, b3Gain: -7, b3Q: 1.5, b6Hz: 4500, b6Gain: 4, level: -2 }, "Weight and click for kick drums."],
  ["Lo-Fi Radio", { b1On: true, b1Hz: 300, b8On: true, b8Hz: 5000, b4Hz: 1500, b4Gain: 6, b4Q: 0.6, level: -3 }, "Small-speaker colouration."],
  ["Tilt Down", { b2Hz: 250, b2Gain: 5, b7Hz: 3000, b7Gain: -7 }, "Dark tilt; tames harsh sources."],
  ["Rumble Remover", { b1On: true, b1Hz: 35, b1Slope: "24 dB/oct" }, "A steep cut below 35 Hz: clears sub-bass rumble and DC drift."],
  ["De-Harsh", { b5Hz: 3200, b5Gain: -4, b5Q: 2.5, b6Hz: 6500, b6Gain: -3, b6Q: 3, b8On: true, b8Hz: 16000 }, "Two narrow dips and a soft top cut tame a piercing source."],
];
