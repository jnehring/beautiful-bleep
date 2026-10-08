// SPDX-License-Identifier: MIT
// MIDI Device view (standalone app, spec §12): pick the controller this node reads.
(function () {
  "use strict";
  BleepViews.register("midi-device", {
    template: '<div class="bv-panel"><h2>Controller</h2><select class="device" style="width:100%"></select></div>',
    async afterBuild(view, custom) {
      const select = custom.querySelector(".device");
      const names = (await native("midiDevices")) || [];
      const current = view.node.device || "";
      select.appendChild(new Option("— choose a controller —", ""));
      for (const n of names) select.appendChild(new Option(n, n));
      if (current && !names.includes(current)) select.appendChild(new Option(current + " (not connected)", current));
      select.value = current;
      select.addEventListener("change", () => view.api.setNodeProperty("device", select.value));
    },
  });
})();
