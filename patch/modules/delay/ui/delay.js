// SPDX-License-Identifier: GPL-3.0-or-later
// Delay view: with Link L/R on, moving either side's time (or rate) moves the other too.
(function () {
  "use strict";
  const PAIRS = { timel: "timer", timer: "timel", ratel: "rater", rater: "ratel" };
  BleepViews.register("delay", {
    linked(id, view) {
      if (view.units("link") < 1 || !PAIRS[id]) return [];
      return [PAIRS[id]];
    },
  });
})();
