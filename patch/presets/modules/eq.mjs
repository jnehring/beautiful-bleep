// SPDX-License-Identifier: MIT
// EQ: factory presets. Bands 1 and 6 start as switched-off cuts, 2 and 5 as shelves, 3 and 4 as bells (400 Hz, 2 kHz).
export default [
  ["Smile Curve", { b2Hz: 100, b2Gain: 4, b5Hz: 8000, b5Gain: 4 }, "Boosted lows and highs: instant polish."],
  ["Bass Boost", { b2Hz: 80, b2Gain: 8, level: -2 }, "More weight below 80 Hz."],
  ["Low Cut Lite", { b1On: true, b1Hz: 90, b3Hz: 300, b3Gain: -2, b3Q: 0.7 }, "Removes rumble below 90 Hz and clears a little mud."],
  ["Mud Remover", { b3Hz: 280, b3Gain: -6, b3Q: 1.5 }, "Cuts the boxy low-mids."],
  ["Presence Lift", { b4Hz: 3500, b4Gain: 5, b4Q: 0.9 }, "Brings the sound forward."],
  ["Air", { b5Hz: 11000, b5Gain: 7 }, "Open, airy top end."],
  ["Warm Darkness", { b5Hz: 5000, b5Gain: -9, b2Hz: 200, b2Gain: 3 }, "Rolls off the top and warms the bottom."],
  ["Vocal Clarity", { b1On: true, b1Hz: 90, b1Slope: "18 dB/oct", b3Hz: 300, b3Gain: -3, b4Hz: 4000, b4Gain: 4, b5Hz: 10000, b5Gain: 3 }, "Cuts the rumble, cleans up and brightens a voice."],
  ["Telephone", { b1On: true, b1Hz: 400, b1Slope: "24 dB/oct", b6On: true, b6Hz: 4000, b6Slope: "24 dB/oct", b3Hz: 1200, b3Gain: 8, b3Q: 1.2, b4Hz: 2500, b4Gain: 5, level: -3 }, "Steep cuts below 400 Hz and above 4 kHz, a nasal band in between."],
  ["Hollow Notch", { b3Type: "Notch", b3Hz: 800, b3Q: 4, b4Type: "Notch", b4Hz: 2400, b4Q: 4 }, "Two deep notches for a phase-like, hollow tone."],
  ["Resonant Peaks", { b3Hz: 500, b3Gain: 10, b3Q: 6, b4Hz: 3000, b4Gain: 9, b4Q: 6, level: -6 }, "Narrow, ringing boosts: formant-like colour."],
  ["Kick Shaper", { b2Hz: 60, b2Gain: 6, b3Hz: 350, b3Gain: -7, b3Q: 1.5, b4Hz: 4500, b4Gain: 4, level: -2 }, "Weight and click for kick drums."],
  ["Lo-Fi Radio", { b1On: true, b1Hz: 300, b6On: true, b6Hz: 5000, b3Hz: 1500, b3Gain: 6, b3Q: 0.6, level: -3 }, "Small-speaker colouration."],
  ["Tilt Down", { b2Hz: 250, b2Gain: 5, b5Hz: 3000, b5Gain: -7 }, "Dark tilt; tames harsh sources."],
  ["Rumble Remover", { b1On: true, b1Hz: 35, b1Slope: "24 dB/oct" }, "A steep cut below 35 Hz: clears sub-bass rumble and DC drift."],
  ["De-Harsh", { b3Hz: 3200, b3Gain: -4, b3Q: 2.5, b4Hz: 6500, b4Gain: -3, b4Q: 3, b6On: true, b6Hz: 16000 }, "Two narrow dips and a soft top cut tame a piercing source."],
];
