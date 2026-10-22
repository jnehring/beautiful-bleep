// SPDX-License-Identifier: GPL-3.0-or-later
// transport.js — the Transport module's view shows what the host is really doing: the Tempo knob follows the
// running tempo (Link peers, MIDI clock, the app's own control), and Play is lit while the song plays.
(function () {
  "use strict";
  BleepViews.register("transport", {
    width: 540,
    onState(st, view) {
      if (typeof st.bpm === "number") {
        const k = view.knobs.get("tempo");
        if (k && !k.dragging()) {
          const p = k.p, v = Math.min(1, Math.max(0, (st.bpm - p.min) / (p.max - p.min)));
          view.node.params.tempo = v;
          k.value.textContent = st.bpm.toFixed(1) + " BPM";
          k.draw();
        }
      }
      const play = view.root.querySelector('.bv-button[data-command="play"]');
      if (play) play.classList.toggle("on", !!st.playing);
    },
  });
})();
