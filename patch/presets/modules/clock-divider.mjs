// SPDX-License-Identifier: MIT
// Clock Div: factory presets (the eight divisions, width, base, output type).
export default [
  ["Default Ladder", { div1: 2, div2: 3, div3: 4, div4: 5, div5: 6, div6: 8, div7: 16, div8: 32 }, "A mix of even and odd divisions for polyrhythmic gates."],
  ["Powers of Two", { div1: 1, div2: 2, div3: 4, div4: 8, div5: 16, div6: 32, div7: 64, div8: 64 }, "Classic binary divisions: everything lines up on the downbeat."],
  ["Even Grid", { div1: 2, div2: 4, div3: 6, div4: 8, div5: 10, div6: 12, div7: 14, div8: 16 }, "Even divisions only: steady, interlocking pulses."],
  ["Odd Primes", { div1: 2, div2: 3, div3: 5, div4: 7, div5: 11, div6: 13, div7: 17, div8: 19 }, "Primes: the outputs rarely coincide, so the rhythm takes ages to repeat."],
  ["Triggers Only", { div1: 1, div2: 2, div3: 3, div4: 4, div5: 6, div6: 8, div7: 12, div8: 16, output: "Trigger" }, "Short triggers instead of gates, for drums and envelopes."],
  ["Short Pulses", { div1: 2, div2: 3, div3: 4, div4: 5, div5: 6, div6: 7, div7: 8, div8: 9, width: 0.15 }, "Narrow gates: staccato hits on every output."],
  ["Long Gates", { div1: 2, div2: 4, div3: 3, div4: 6, div5: 8, div6: 12, div7: 16, div8: 24, width: 0.9 }, "Nearly full-width gates that sustain between pulses."],
  ["Base Step Gates", { div1: 2, div2: 3, div3: 4, div4: 6, div5: 8, div6: 12, div7: 16, div8: 32, gatelength: "Base Step" }, "Every gate is one base step long, whatever the division."],
  ["Eighth Base Slow", { div1: 2, div2: 3, div3: 4, div4: 6, div5: 8, div6: 12, div7: 16, div8: 32, base: "1/8" }, "The base clock at eighths: a slower, more spacious set."],
  ["Triplet Base", { div1: 1, div2: 2, div3: 3, div4: 4, div5: 6, div6: 8, div7: 12, div8: 16, base: "1/8T" }, "Triplet base clock for shuffling cross-rhythms."],
  ["Bar Realign", { div1: 3, div2: 5, div3: 7, div4: 9, div5: 11, div6: 13, div7: 15, div8: 17, realign: "1 bar" }, "Odd divisions snapped back together every bar."],
  ["Four-Bar Polyrhythm", { div1: 3, div2: 5, div3: 6, div4: 7, div5: 9, div6: 10, div7: 12, div8: 15, realign: "4 bars", width: 0.3 }, "Complex divisions that resync every four bars."],
];
