// SPDX-License-Identifier: GPL-3.0-or-later
// CV to MIDI view (doc/specs/modules/cv-to-midi.md §5): one bar per lane, 0 to
// 127. The lit band is the lane's Min to Max range, the marker the CC value
// last sent (live), and the label says CC, channel and value. A lane without
// a cable is dimmed.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".cm-cv{height:132px!important}";
  document.head.appendChild(style);

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st || {};
    const left = 96, right = 40, pw = w - left - right, rowH = h / 4, bar = 16;
    const X = (d) => left + pw * Math.max(0, Math.min(127, d)) / 127;
    g.font = "10px system-ui, sans-serif"; g.textBaseline = "middle";
    for (let k = 0; k < 4; k++) {
      const n = k + 1, y = k * rowH + (rowH - bar) / 2, cy = y + bar / 2;
      const live = typeof st["lane" + n] === "number" ? st["lane" + n] : -1;
      const on = live >= 0 || view.api.isPatched("in" + n);
      const lo = view.units("min" + n), hi = view.units("max" + n);
      g.globalAlpha = on ? 1 : 0.4;
      g.fillStyle = th.panel2; g.fillRect(left, y, pw, bar);
      g.fillStyle = th.accent; g.globalAlpha = on ? 0.28 : 0.12;
      g.fillRect(X(Math.min(lo, hi)), y, Math.abs(X(hi) - X(lo)), bar);
      g.globalAlpha = on ? 1 : 0.4;
      if (live >= 0) {
        g.fillStyle = th.accent; BleepView.glow(g, th.accent, 9);
        g.fillRect(left, y + 5, X(live) - left, bar - 10); g.shadowBlur = 0;
        g.fillStyle = th.text; g.fillRect(Math.round(X(live)) - 1, y - 2, 2, bar + 4);
      }
      g.textAlign = "left"; g.fillStyle = th.text;
      g.fillText("CC " + view.units("cc" + n), 8, cy - 6);
      g.fillStyle = th.muted; g.fillText("ch " + view.units("channel" + n), 8, cy + 7);
      g.textAlign = "right"; g.fillStyle = th.text;
      g.fillText(live >= 0 ? String(Math.round(live)) : "–", w - 8, cy);
      g.globalAlpha = 1;
    }
  }

  BleepViews.register("cv-to-midi", {
    width: 680,
    template: '<div class="bv-panel"><h2>Lanes</h2><canvas class="cm-cv"></canvas></div>',
    layout: [
      { title: "Lane 1", params: ["cc1", "channel1", "min1", "max1"], columns: true },
      { title: "Lane 2", params: ["cc2", "channel2", "min2", "max2"], columns: true },
      { title: "Lane 3", params: ["cc3", "channel3", "min3", "max3"], columns: true },
      { title: "Lane 4", params: ["cc4", "channel4", "min4", "max4"], columns: true },
      { title: "Output", params: ["range", "resolution", "rate"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
