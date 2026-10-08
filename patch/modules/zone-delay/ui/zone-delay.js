// SPDX-License-Identifier: MIT
// Zone Delay view (specs/modules/zone-delay.md §5): the zone strip, the
// effective left/right times (with the synced note value), a scrolling strip
// of the wet signal's level with a marker at every delay time, and the
// latched Reverse / Hold / Ping-Pong buttons (kept in the node's data, ORed
// with the gate inputs). Note names mirror zone::notes in ZoneDelayDsp.h.
(function () {
  "use strict";
  const ZONES = ["Comb", "Short", "Echo", "Long", "Vast"];
  const NOTES = [
    [],
    ["1/128", "1/64T", "1/64", "1/32T", "1/64.", "1/32"],
    ["1/32", "1/16T", "1/32.", "1/16", "1/8T", "1/16.", "1/8", "1/4T", "1/8.", "1/4", "1/2T", "1/4.", "1/2"],
    ["1/4", "1/2T", "1/4.", "1/2", "1/1T", "1/2.", "1/1", "1/1.", "2 bars"],
    ["1/1", "1/1.", "2 bars", "4 bars", "8 bars"],
  ];
  const LATCHES = [["reverse", "◀◀ Reverse"], ["hold", "■ Hold"], ["pingPong", "⇄ Ping-Pong"]];
  const SPAN = 4;  // seconds shown in the echo strip

  const fmt = (s) => (s < 1 ? (s * 1000 < 10 ? (s * 1000).toFixed(2) : Math.round(s * 1000)) + " ms" : s.toFixed(2) + " s");
  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    return { reverse: !!d.reverse, hold: !!d.hold, pingPong: !!d.pingPong };
  }

  function draw(view) {
    const z = view.zd, c = z.canvas;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const now = performance.now() / 1000;
    const x = (t) => w - ((now - t) / SPAN) * w;
    g.strokeStyle = css.getPropertyValue("--line");
    const tl = z.timeL || 0;
    if (tl > 0.02) {  // a marker at every delay time back from now
      g.beginPath();
      for (let k = 1; k * tl < SPAN && k < 64; k++) { g.moveTo(Math.round(x(now - k * tl)) + 0.5, 0); g.lineTo(Math.round(x(now - k * tl)) + 0.5, h); }
      g.stroke();
    }
    g.fillStyle = css.getPropertyValue("--accent");
    for (let i = 1; i < z.hist.length; i++) {
      const [t0] = z.hist[i - 1], [t1, e] = z.hist[i];
      const v = Math.min(1, Math.sqrt(e)) * (h - 4);
      g.fillRect(x(t0), (h - v) / 2, Math.max(1, x(t1) - x(t0)), Math.max(1, v));
    }
  }

  BleepViews.register("zone-delay", {
    top: true,
    template:
      '<div class="bv-panel"><div class="zd-zones" style="display:flex;gap:4px;align-items:center"></div>' +
      '<div class="zd-time" style="margin:6px 0;font-variant-numeric:tabular-nums"></div>' +
      '<canvas class="zd-echo" style="height:56px"></canvas>' +
      '<div class="zd-latches bv-buttons" style="margin-top:6px"></div></div>',
    afterBuild(view, el) {
      const zones = el.querySelector(".zd-zones"), latches = el.querySelector(".zd-latches");
      view.zd = { canvas: el.querySelector(".zd-echo"), time: el.querySelector(".zd-time"), hist: [], zoneButtons: [], latchButtons: [] };
      ZONES.forEach((name, i) => {
        const b = document.createElement("button");
        b.className = "bv-button";
        b.textContent = i + 1 + " " + name;
        b.title = name;
        b.addEventListener("click", () => {
          view.api.beginGesture();
          view.node.params.zone = i / 4;
          view.api.setParam("zone", i / 4);
        });
        zones.appendChild(b);
        view.zd.zoneButtons.push(b);
      });
      for (const [key, label] of LATCHES) {
        const b = document.createElement("button");
        b.className = "bv-button";
        b.textContent = label;
        b.addEventListener("click", () => {
          const d = data(view);
          d[key] = !d[key];
          view.node.data = d;
          view.api.setData(d);
          b.classList.toggle("on", d[key]);
        });
        latches.appendChild(b);
        view.zd.latchButtons.push([key, b]);
      }
    },
    onState(st, view) {
      const z = view.zd;
      if (!z || !st) return;
      const zone = typeof st.zone === "number" ? st.zone : 3;
      z.zoneButtons.forEach((b, i) => b.classList.toggle("on", i + 1 === zone));
      const d = data(view);
      for (const [key, b] of z.latchButtons) {
        b.classList.toggle("on", d[key]);
        b.style.opacity = !d[key] && st[key] ? 0.75 : "";  // held by the gate input
      }
      z.timeL = st.timeL || 0;
      let text = fmt(z.timeL);
      const names = NOTES[zone - 1] || [];
      if (st.note >= 0 && names[st.note]) text += "  (" + names[st.note] + ")";
      if (Math.abs((st.timeR || 0) - z.timeL) > 0.0005) text += "   R " + fmt(st.timeR || 0);
      z.time.textContent = text;
      const now = performance.now() / 1000;
      z.hist.push([now, st.env || 0]);
      while (z.hist.length > 2 && z.hist[0][0] < now - SPAN - 0.5) z.hist.shift();
      draw(view);
    },
  });
})();
