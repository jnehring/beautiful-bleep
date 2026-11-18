// SPDX-License-Identifier: GPL-3.0-only
// Dial view (doc/specs/modules/dial.md §5): Value as a normal knob, then the
// range and the feel.
(function () {
  "use strict";
  BleepViews.register("dial", {
    width: 450,
    layout: [
      { title: "Dial", params: ["value"] },
      { title: "Range", params: ["min", "max"] },
      { title: "Feel", params: ["steps", "smooth"] },
    ],
  });
})();
