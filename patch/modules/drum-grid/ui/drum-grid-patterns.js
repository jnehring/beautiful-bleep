// SPDX-License-Identifier: GPL-3.0-or-later
// Factory patterns for the Drum Grid (doc/specs/modules/drum-grid.md §4.6), in
// the same shape as a saved library preset. Our own, generic patterns.
// Rows: Kick, Snare, Closed Hat, Open Hat, Clap, Low Tom, High Tom, Perc;
// `.` Off, `x` On, `X` Accent.
(function () {
  "use strict";
  const ROWS = ["k", "s", "ch", "oh", "cl", "lt", "ht", "pc"];
  const p = (category, name, length, rows) => ({
    name,
    preset: { category, version: 1, pattern: { name, length, steps: ROWS.map((r) => rows[r] || "") } },
  });

  window.BleepDrumPatterns = [
    p("Basics", "Four on the Floor", 16, { k: "x...x...x...x...", ch: "..x...x...x...x." }),
    p("Basics", "Backbeat", 16, { k: "x.......x.x.....", s: "....X.......X...", ch: "x.x.x.x.x.x.x.x." }),
    p("Basics", "Half-Time", 16, { k: "x.........x.....", s: "........X.......", ch: "x.x.x.x.x.x.x.x." }),
    p("House", "Classic House", 16, { k: "x...x...x...x...", cl: "....X.......X...", ch: "xx.xxx.xxx.xxx.x", oh: "..x...x...x...x." }),
    p("House", "Deep House", 16, { k: "x...x...x...x...", s: "....x.......x..x", ch: "..x...x...x...x.", pc: "...x..x....x..x." }),
    p("Techno", "Driving", 16, { k: "X...x...X...x...", ch: "xxXxxxXxxxXxxxXx", cl: "....x.......x..." }),
    p("Techno", "Rolling", 16, { k: "x...x...x...x...", oh: "..x...x...x...x.", lt: "...x..x...x..x..", pc: "x..x..x..x..x..x" }),
    p("Breaks", "Breakbeat", 16, { k: "x.........x.x...", s: "....X..x.x..X..x", ch: "x.x.x.x.x.x.x.x." }),
    p("Breaks", "Two-Step", 16, { k: "x......x..x.....", s: "....X.......X...", ch: "x.xxx.x.x.xxx.x." }),
    p("Electro", "Electro", 16, { k: "x.....x.x...x...", s: "....X.......X...", ch: "xxxxxxxxxxxxxxxx", ht: "..............xx" }),
    p("Hip-Hop", "Boom Bap", 16, { k: "x......x.xx.....", s: "....X.......X...", ch: "x.x.x.x.x.x.x.x." }),
    p("Hip-Hop", "Laid Back", 16, { k: "x.....x...x.....", s: "....X.......X..x", ch: "x.xxx.x.x.x.x.xx" }),
    p("Latin", "Tresillo", 16, { k: "x..x..x.x..x..x.", ch: "x.x.x.x.x.x.x.x.", pc: "x..x..x...x.x..." }),
    p("Latin", "Bossa", 16, { k: "x..xx..xx..xx..x", ch: "xxxxxxxxxxxxxxxx", pc: "x..x..x...x..x.." }),
    p("Odd Meters", "Five Four", 20, { k: "x.....x...x.........", s: "....X.......X...X...", ch: "x.x.x.x.x.x.x.x.x.x." }),
    p("Odd Meters", "Seven Eight", 14, { k: "x.....x...x...", s: "....X.....X...", ch: "x.x.x.x.x.x.x." }),
  ];
})();
