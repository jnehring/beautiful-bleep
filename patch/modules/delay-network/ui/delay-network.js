// SPDX-License-Identifier: MIT
// Delay Net view (doc/specs/modules/delay-network.md §5): a timeline with every
// active tap at its effective time (height = its level, colour = side, ◀ for
// reversed taps), a small diagram of the routing, and the latched Freeze
// button (kept in the node's data, ORed with the gate input). The Clear
// button comes from the module's buttons.
(function () {
  "use strict";
  const ROUTINGS = ["Parallel", "Chain", "Ring", "Mesh"];
  const fmt = (s) => (s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(2) + " s");

  function routing(view) {
    const p = view.type.params.find((x) => x.id === "routing");
    return Math.round((view.node.params.routing ?? p.default) * (p.steps - 1));
  }
  function frozenLatched(view) { return !!(view.node.data && view.node.data.freezeLatched); }

  function drawTimeline(view, st) {
    const c = view.dn.timeline;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), muted = css.getPropertyValue("--muted").trim();
    const text = css.getPropertyValue("--text").trim(), line = css.getPropertyValue("--line").trim();
    const taps = (st.arrays && st.arrays.taps) || [];
    const span = Math.max(st.time || 0.6, 0.005);
    const x = (t) => 8 + (Math.min(t, span) / span) * (w - 16);
    g.strokeStyle = line;
    g.beginPath(); g.moveTo(8, h - 14.5); g.lineTo(w - 8, h - 14.5); g.stroke();
    g.fillStyle = muted;
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "left"; g.fillText("0", 8, h - 2);
    g.textAlign = "right"; g.fillText(fmt(span), w - 8, h - 2);
    g.textAlign = "center";
    for (let i = 0; i < 8; i++) {
      const [t, level, rev, pan, peak] = taps.slice(i * 5, i * 5 + 5);
      if (!(level > 0.001)) continue;
      const px = x(t), top = h - 16 - Math.max(3, Math.min(1, Math.sqrt(peak || 0)) * (h - 34));
      g.globalAlpha = 0.35 + 0.65 * level;
      g.strokeStyle = pan < -0.05 ? accent : pan > 0.05 ? text : muted;
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(px, h - 15); g.lineTo(px, top); g.stroke();
      g.fillStyle = g.strokeStyle;
      g.fillText((rev > 0.5 ? "◀" : "▲") + (i + 1), px, 11);
    }
    g.globalAlpha = 1;
    g.lineWidth = 1;
  }

  function drawRouting(view) {
    const c = view.dn.routing;
    if (!c.clientWidth) return;
    const n = Math.max(1, Math.min(8, Math.ceil(view.dn.taps || 4)));
    const r = routing(view);
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), muted = css.getPropertyValue("--muted").trim();
    const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2 - 10;
    const at = (i) => [cx + rad * Math.sin((i / n) * 2 * Math.PI), cy - rad * Math.cos((i / n) * 2 * Math.PI)];
    g.strokeStyle = muted;
    g.lineWidth = 1;
    const arrow = (a, b) => {
      const [x0, y0] = at(a), [x1, y1] = at(b);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    };
    if (r === 1 || r === 2) for (let i = 0; i + 1 < n; i++) arrow(i, i + 1);
    if (r === 2 && n > 1) arrow(n - 1, 0);
    if (r === 3) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) arrow(i, j);
    for (let i = 0; i < n; i++) {
      const [px, py] = at(i);
      g.fillStyle = accent;
      g.beginPath(); g.arc(px, py, 6, 0, 2 * Math.PI); g.fill();
      if (r === 0) { g.beginPath(); g.arc(px, py - 8, 4, 0.2 * Math.PI, 2.8 * Math.PI); g.stroke(); }
    }
    view.dn.routingName.textContent = ROUTINGS[r] || "";
  }

  BleepViews.register("delay-network", {
    top: true,
    template:
      '<div class="bv-panel"><canvas class="dn-timeline" style="height:84px"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<canvas class="dn-routing" style="width:70px;height:70px;flex:none"></canvas>' +
      '<span class="dn-routing-name" style="flex:1;color:var(--muted)"></span>' +
      '<button class="bv-button dn-freeze">◉ Freeze</button></div></div>',
    afterBuild(view, el) {
      view.dn = {
        timeline: el.querySelector(".dn-timeline"), routing: el.querySelector(".dn-routing"),
        routingName: el.querySelector(".dn-routing-name"), freeze: el.querySelector(".dn-freeze"), taps: 4,
      };
      view.dn.freeze.addEventListener("click", () => {
        const d = { freezeLatched: !frozenLatched(view) };
        view.node.data = d;
        view.api.setData(d);
        view.dn.freeze.classList.toggle("on", d.freezeLatched);
      });
    },
    onState(st, view) {
      if (!view.dn || !st) return;
      view.dn.taps = st.taps || view.dn.taps;
      view.dn.freeze.classList.toggle("on", frozenLatched(view) || st.freeze > 0.5);
      drawTimeline(view, st);
      drawRouting(view);
    },
    onRefresh(view) { if (view.dn) drawRouting(view); },
  });
})();
