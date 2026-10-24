// SPDX-License-Identifier: GPL-3.0-only
// CV to Notes view: two settings, so a compact window.
(function () {
  "use strict";
  BleepViews.register("cv-to-notes", {
    width: 360,
    layout: [{ title: "Notes", params: ["note", "velocity"] }],
  });
})();
