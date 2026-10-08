// SPDX-License-Identifier: MIT
// Modal Voice view: an exciter scope (the last 50 ms of the Exciter output:
// mallet pulses, the bow's stick-slip, breath noise), the body's partials on
// a log frequency axis (height = amplitude, brightness = what is still
// ringing) with a Position marker, and an Active LED. The Play button (a
// gate while held) comes from the module's buttons.
(function () {
  "use strict";

  function canvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  BleepViews.register("modal-voice", {
    top: true,
    template:
      '<div class="bv-panel"><h2 style="display:flex;align-items:center;gap:6px">Body ' +
      '<span class="mv-led" style="display:inline-block;width:8px;height:8px;border-radius:50%"></span></h2>' +
      '<canvas class="mv-scope" style="height:44px"></canvas>' +
      '<canvas class="mv-partials" style="height:56px;margin-top:6px"></canvas></div>',
    onState(st, view) {
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line");
      const text = css.getPropertyValue("--text");
      const arrays = (st && st.arrays) || {};
      const led = view.root.querySelector(".mv-led");
      if (led) {
        const on = st && st.active > 0.5;
        led.style.background = on ? accent : "transparent";
        led.style.border = "1px solid " + (on ? accent : line);
      }
      const scope = view.root.querySelector(".mv-scope");
      if (scope && scope.clientWidth && arrays.exciter) {
        const { g, w, h } = canvas(scope);
        const xs = arrays.exciter;
        const peak = Math.max(0.05, ...xs.map(Math.abs));
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
        g.strokeStyle = accent; g.lineWidth = 1.5;
        g.beginPath();
        xs.forEach((v, i) => {
          const x = (i / Math.max(xs.length - 1, 1)) * w, y = h / 2 - (v / peak) * (h / 2 - 3);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke(); g.lineWidth = 1;
      }
      const parts = view.root.querySelector(".mv-partials");
      if (parts && parts.clientWidth && arrays.modeHz) {
        const { g, w, h } = canvas(parts);
        g.strokeStyle = line;
        g.beginPath(); g.moveTo(0, h - 2); g.lineTo(w, h - 2); g.stroke();
        const n = arrays.modeHz.length;
        if (n) {
          const x = (hz) => (Math.log(Math.max(hz, 16) / 16) / Math.log(20000 / 16)) * w;
          const maxAmp = Math.max(...arrays.modeAmp, 1e-6), maxLevel = Math.max(...arrays.modeLevel, 1e-6);
          g.strokeStyle = accent; g.lineWidth = 2;
          for (let k = n - 1; k >= 0; k--) {
            const a = arrays.modeAmp[k] / maxAmp;
            if (a < 0.002) continue;
            g.globalAlpha = 0.25 + 0.75 * Math.sqrt(Math.min(1, arrays.modeLevel[k] / maxLevel));
            const xx = x(arrays.modeHz[k]);
            g.beginPath(); g.moveTo(xx, h - 2); g.lineTo(xx, h - 2 - a * (h - 6)); g.stroke();
          }
          g.globalAlpha = 1; g.lineWidth = 1;
        }
        // Position: where the exciter touches the body (0 … 100 % along it).
        const pos = view.value(st, "position");
        const px = 4 + pos * (w - 8);
        g.fillStyle = text;
        g.beginPath(); g.moveTo(px - 4, 0); g.lineTo(px + 4, 0); g.lineTo(px, 6); g.closePath(); g.fill();
      }
    },
  });
})();
