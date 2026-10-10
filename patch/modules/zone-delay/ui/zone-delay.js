// SPDX-License-Identifier: MIT
// Zone Delay view (doc/specs/modules/zone-delay.md §5): the zone strip, the
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

  // The strip: wet level history (scrolling), a marker at every delay time.
  function draw(view) {
    const z = view.zd, c = z.canvas;
    const { g, w, h } = BleepView.fit(c);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const now = performance.now() / 1000;
    const x = (t) => w - ((now - t) / SPAN) * w;
    g.strokeStyle = th.line;
    const tl = z.timeL || 0;
    if (tl > 0.02) {
      g.beginPath();
      for (let k = 1; k * tl < SPAN && k < 64; k++) { g.moveTo(Math.round(x(now - k * tl)) + 0.5, 0); g.lineTo(Math.round(x(now - k * tl)) + 0.5, h); }
      g.stroke();
    }
    g.fillStyle = th.accent;
    for (let i = 1; i < z.hist.length; i++) {
      const [t0] = z.hist[i - 1], [t1, e] = z.hist[i];
      const v = Math.min(1, Math.sqrt(e)) * (h - 4);
      g.fillRect(x(t0), (h - v) / 2, Math.max(1, x(t1) - x(t0)), Math.max(1, v));
    }
  }

  // The echo diagram: a ball hops along the repeats; the left echoes arc above
  // the line, the right ones below (shifted by Offset). Each hop is lower by the
  // Feedback gain; Reverse swells the arcs, Ping-Pong alternates the sides,
  // Hold keeps them at full height, Diffuse blurs them, Wobble wavers them.
  function echoes(view, t) {
    const z = view.zd;
    if (!z || !z.arcs) return;
    const { g, w, h } = BleepView.fit(z.arcs);
    if (!w || !h) return;
    const st = z.last || {}, th = BleepView.theme(view.root);
    const fbv = Math.min(1.1, view.value(st, "feedback") * 1.1);
    const hold = !!(st.hold || data(view).hold), rev = !!(st.reverse || data(view).reverse), pp = !!(st.pingPong || data(view).pingPong);
    const diff = view.value(st, "diffuse"), wob = view.value(st, "wobble"), off = view.value(st, "offset") - 0.5;
    const gain = hold ? 1 : fbv;
    let n = 1;
    while (n < 9 && Math.pow(Math.max(gain, 0.001), n) > 0.04) n++;
    const X0 = 16, X1 = w - 12, mid = h / 2, dx = (X1 - X0) / (n + 0.6), A = mid - 10;
    g.strokeStyle = th.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X0, mid + 0.5); g.lineTo(X1, mid + 0.5); g.stroke();
    const period = 0.55, head = (t / period) % (n + 2);  // hop index (fractional)
    g.globalCompositeOperation = "lighter";
    for (let side = 0; side < 2; side++) {
      const col = side ? th.text : th.accent, dir = side ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const amp = A * Math.pow(Math.max(gain, 0.001), k) * (k === 0 ? 0.85 : 1);
        // arc k goes from echo k to echo k+1 (the source is echo 0)
        const sh = side ? off * dx * 1.6 : 0;
        const x0 = X0 + k * dx + sh, x1 = x0 + dx;
        const flip = pp && k % 2 ? -1 : 1;
        const lit = Math.max(0, 1 - Math.abs(head - k - 0.5) * 0.55);
        g.globalAlpha = Math.min(1, 0.3 + 0.7 * Math.pow(Math.max(gain, 0.001), k)) * (0.5 + 0.5 * lit);
        g.strokeStyle = col; g.lineWidth = 1.5 + diff * 2.5 + lit * 1.2;
        BleepView.glow(g, col, 4 + diff * 12 + lit * 8);
        g.beginPath();
        const N = 28;
        for (let i = 0; i <= N; i++) {
          const u = i / N, wv = wob * 4 * Math.sin(t * 5 + u * 9 + k + side * 2);
          // reversed: the arc swells up to its end instead of falling after its start
          const prof = rev ? Math.pow(u, 1.8) * (1 - 0.35 * u) * 1.3 : Math.sin(Math.PI * u);
          const px = x0 + u * dx, py = mid + dir * flip * (prof * amp + wv * (u > 0 && u < 1));
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
      g.shadowBlur = 0;
      for (let k = 0; k <= n; k++) {  // echo points on the line
        const amp = Math.pow(Math.max(gain, 0.001), k);
        const sh = side ? off * dx * 1.6 : 0;
        const lit = Math.max(0, 1 - Math.abs(head - k) * 0.9);
        g.globalAlpha = 0.25 + 0.75 * amp * (0.5 + 0.5 * lit);
        g.fillStyle = col;
        g.beginPath(); g.arc(X0 + k * dx + (k ? sh : 0), mid, 2 + 3 * amp * (0.5 + lit), 0, 6.2832); g.fill();
      }
    }
    // the travelling ball
    const k = Math.floor(head);
    if (k < n) {
      const u = head - k, amp = A * Math.pow(Math.max(gain, 0.001), k);
      const bx = X0 + k * dx + u * dx, by = mid - (rev ? Math.pow(u, 1.8) * 1.3 : Math.sin(Math.PI * u)) * amp * (pp && k % 2 ? -1 : 1);
      g.globalAlpha = 1; g.fillStyle = th.text; BleepView.glow(g, th.text, 12);
      g.beginPath(); g.arc(bx, by, 3.2, 0, 6.2832); g.fill();
    }
    g.shadowBlur = 0; g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  }

  if (!document.getElementById("zd-style")) {
    const st = document.createElement("style");
    st.id = "zd-style";
    st.textContent = ".bleep-view.zd .bv-knob{width:64px}.bleep-view.zd .bv-knob svg{width:42px;height:42px}" +
      ".zd-zones .bv-button{padding:4px 7px}";
    document.head.appendChild(st);
  }

  BleepViews.register("zone-delay", {
    hideParams: ["zone"],
    layout: [
      { title: "Time", params: ["time", "glide"] },
      { title: "Repeats", params: ["feedback", "character", "tone", "diffuse"] },
      { title: "Stereo", params: ["offset", "wobble"] },
      { title: "Mix", params: ["mix"] },
      { title: "Mode", params: ["sync", "timechange", "clearonplay", "seed"] },
    ],
    template:
      '<div class="bv-panel" style="display:flex;gap:12px;width:100%;flex:1 1 100%">' +
      '<div style="flex:0 0 310px;display:flex;flex-direction:column;gap:6px">' +
      '<div class="zd-zones" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap"></div>' +
      '<div class="zd-time" style="font-variant-numeric:tabular-nums;min-height:1.2em"></div>' +
      '<canvas class="zd-echo" style="height:34px"></canvas>' +
      '<div class="zd-latches bv-buttons"></div></div>' +
      '<canvas class="zd-arcs" style="flex:1 1 auto;min-width:0;height:130px"></canvas></div>',
    afterBuild(view, el) {
      view.root.classList.add("zd");
      const zones = el.querySelector(".zd-zones"), latches = el.querySelector(".zd-latches");
      view.zd = { canvas: el.querySelector(".zd-echo"), arcs: el.querySelector(".zd-arcs"), time: el.querySelector(".zd-time"), hist: [], zoneButtons: [], latchButtons: [] };
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
      z.last = st;
      if (!z.looping) { z.looping = true; BleepView.loop(view.root, (t) => echoes(view, t)); }
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
