// SPDX-License-Identifier: MIT
// CV to Notes view: one setting, so a compact window.
(function () {
  "use strict";
  BleepViews.register("cv-to-notes", {
    width: 360,
    layout: [{ title: "Notes", params: ["velocity"] }],
  });
})();
