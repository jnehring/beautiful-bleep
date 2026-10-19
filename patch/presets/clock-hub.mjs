// SPDX-License-Identifier: GPL-3.0-or-later
// Clock Hubs: plain cells that turn one clock into a bank of related clocks, to patch into drums, sequencers and envelopes.
import { cell, category } from "./kit.mjs";

// Twelve clocks from one: four multiplied, four thinned and swung, four divided.
function rhythmHub() {
  const p = cell("Rhythm Hub", {
    description: "One clock in, twelve related clocks out: x2, x3, x4 and 3/2 per clock, four swung and thinned fast clocks, and four divisions (/2 to /16). Shared inputs Clock, Reset, Swing, Thin and Loose.",
    tags: ["clock", "rhythm", "multiply", "divide", "swing"],
    help: "A Clock Mult makes the multiplied bank (2, 3, 4 and 3/2 ticks per clock). A second Clock Mult makes the " +
      "fast bank: a sixteenth line with swing, and three busier lines that drop ticks by chance, with Keep Beat on " +
      "so the beat itself always plays. A Clock Div makes the divided bank (/2, /4, /8, /16 of the incoming pulses). " +
      "All outputs are short triggers.\n\n" +
      "Patch a trigger into Clock, or leave it empty and the hub follows the transport. Reset restarts all three modules. " +
      "Swing is added to the fast bank's Swing knob (it moves only the in-between ticks), Thin is added to the three " +
      "skip knobs (more ticks drop out), and Loose is added to Humanize (the in-between ticks land late, differently each time).\n\n" +
      "Tip: put the x4 output on hats, 3/2 on a rim, /4 on a snare and /16 on a crash, then raise Thin with a slow LFO.",
  }).input("clock", "Clock", "trigger").input("reset", "Reset", "trigger")
    .input("swing", "Swing").input("thin", "Thin").input("loose", "Loose");

  const mult = p.add("clock-multiplier", [0, 0], { ratio1: "2", ratio2: "3", ratio3: "4", ratio4: "3/2", ratio5: "5/4", ratio6: "8", output: "Trigger" }, { name: "Multiplied" });
  const fast = p.add("clock-multiplier", [0, 1], { ratio1: "4", ratio2: "8", ratio3: "8", ratio4: "16", ratio5: "1", ratio6: "2",
    skip2: 0.25, skip3: 0.45, skip4: 0.6, swing: 0.3, humanize: 0.1, output: "Trigger" }, { name: "Swung and Thinned" });
  const div = p.add("clock-divider", [0, 2], { div1: 2, div2: 4, div3: 8, div4: 16, output: "Trigger" }, { name: "Divided" });

  for (const n of [mult, fast, div]) p.cable(p.cin, "clock", n, "clock").cable(p.cin, "reset", n, "reset");
  p.cable(p.cin, "swing", fast, "swing").cable(p.cin, "swing", mult, "swing");
  p.cable(p.cin, "thin", fast, "skip2").cable(p.cin, "thin", fast, "skip3").cable(p.cin, "thin", fast, "skip4");
  p.cable(p.cin, "loose", fast, "humanize");

  const outs = [
    ["x2", "x2", mult, "out1"], ["x3", "x3", mult, "out2"], ["x4", "x4", mult, "out3"], ["x32", "x3/2", mult, "out4"],
    ["fast", "Swung 16th", fast, "out1"], ["thin1", "Thin 8th A", fast, "out2"], ["thin2", "Thin 8th B", fast, "out3"], ["ghost", "Ghost 32nd", fast, "out4"],
    ["d2", "Div 2", div, "out1"], ["d4", "Div 4", div, "out2"], ["d8", "Div 8", div, "out3"], ["d16", "Div 16", div, "out4"],
  ];
  for (const [id, name, node, jack] of outs) p.output(id, name, "trigger").cable(node, jack, p.cout, id);
  return p;
}

export default category("Clock Hubs", "One clock in, a bank of related clocks out: multiplied, divided, thinned and swung.", [rhythmHub]);
