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

  // The echo diagram: every tap at its time (height = level, colour = side,
  // a saw ramp for reversed taps), repeated each Time with the Feedback gain
  // (fb^generation). A playhead sweeps the line and each tap flashes as it passes.
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function tapList(view, st, span) {
    const arr = st && st.arrays && st.arrays.taps;
    const out = [];
    if (arr && arr.length) {
      for (let i = 0; i < 8; i++) {
        const [t, level, rev, pan, peak] = arr.slice(i * 5, i * 5 + 5);
        if (level > 0.001) out.push({ t: Math.min(t, span), level, rev: rev > 0.5, pan, i });
      }
      return out;
    }
    const n = Math.max(1, Math.ceil(view.value(st, "taps") * 7 + 1 - 1e-6));  // demo: even taps
    const rev = view.value(st, "reverse"), sc = view.value(st, "scatter");
    for (let i = 0; i < n; i++) out.push({ t: span * Math.pow((i + 1) / n, 1 + sc * 0.6), level: 1 - 0.5 * i / n, rev: hash(i + 3) < rev, pan: i % 2 ? 0.5 : -0.5, i });
    return out;
  }
  function drawTimeline(view, st, tm) {
    const c = view.dn.timeline;
    const { g, w, h } = BleepView.fit(c);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const span = Math.max((st && st.time) || 0.6, 0.005);
    const fb = Math.min(2, view.value(st, "feedback") * 2), jit = view.value(st, "jitter");
    const taps = tapList(view, st, span);
    const gens = 3, X0 = 14, X1 = w - 14, base = h - 28, H = base - 14;
    const total = span * gens;
    const x = (t) => X0 + (t / total) * (X1 - X0);
    // baseline + generation guides
    g.lineWidth = 1;
    g.strokeStyle = th.line;
    g.beginPath(); g.moveTo(X0, base + 0.5); g.lineTo(X1, base + 0.5); g.stroke();
    g.setLineDash([2, 4]);
    for (let k = 1; k < gens; k++) { g.beginPath(); g.moveTo(Math.round(x(k * span)) + 0.5, 6); g.lineTo(Math.round(x(k * span)) + 0.5, base); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = th.muted; g.font = "10px system-ui, sans-serif";
    g.textAlign = "left"; g.fillText("0", X0, h - 3);
    g.textAlign = "center";
    for (let k = 1; k <= gens; k++) g.fillText(fmt(k * span), k === gens ? X1 - 18 : x(k * span), h - 3);
    const head = (tm % (total * 1.0 + 0.0001)) ;  // seconds along the line
    const sweep = (tm * Math.max(0.5, 1 / total * 1.2) * total * 0.5) % total;
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < gens; k++) {
      const gain = Math.pow(Math.max(fb, 0.02), k);
      for (const tp of taps) {
        const wob = jit * 5 * Math.sin(tm * 3 + tp.i * 2.1 + k);
        const px = x(k * span + tp.t) + wob;
        const lv = tp.level * gain;
        const hh = Math.max(4, lv * H);
        const age = sweep - (k * span + tp.t);
        const flash = age >= 0 ? Math.exp(-age / (total * 0.12)) : 0;
        const col = tp.pan < -0.05 ? th.accent : tp.pan > 0.05 ? th.text : th.muted;
        g.globalAlpha = Math.min(1, 0.25 + 0.75 * lv + flash * 0.5);
        const gr = g.createLinearGradient(0, base, 0, base - hh);
        gr.addColorStop(0, col); gr.addColorStop(1, "transparent");
        g.strokeStyle = tp.rev ? col : gr;
        g.lineWidth = 2 + flash * 2;
        BleepView.glow(g, col, 4 + flash * 14);
        g.beginPath();
        if (tp.rev) {  // a reversed echo swells up to the tap, then cuts
          g.moveTo(px - 12, base); g.lineTo(px, base - hh); g.lineTo(px, base);
        } else { g.moveTo(px, base); g.lineTo(px, base - hh); }
        g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = col;
        g.beginPath(); g.arc(px, base - hh, 2.5 + flash * 2, 0, 6.2832); g.fill();
        if (k === 0) { g.globalAlpha = 0.8; g.fillStyle = th.muted; g.textAlign = "center"; g.fillText((tp.rev ? "◀" : "") + (tp.i + 1), px, base + 11); }
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    // playhead
    const hx = x(sweep);
    const lg = g.createLinearGradient(hx - 26, 0, hx, 0);
    lg.addColorStop(0, "transparent"); lg.addColorStop(1, th.accent);
    g.globalAlpha = 0.22; g.fillStyle = lg; g.fillRect(hx - 26, 6, 26, base - 6);
    g.globalAlpha = 0.9; g.fillStyle = th.text; g.fillRect(hx - 0.5, 6, 1.5, base - 6);
    g.globalAlpha = 1;
  }

  function drawRouting(view) {
    const c = view.dn.routing;
    if (!c.clientWidth) return;
    const n = Math.max(1, Math.min(8, Math.ceil(view.dn.taps || 4)));
    const r = routing(view);
    const { g, w, h } = BleepView.fit(c);
    const th = BleepView.theme(view.root), accent = th.accent, muted = th.muted;
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

  if (!document.getElementById("dn-style")) {
    const st = document.createElement("style");
    st.id = "dn-style";
    st.textContent = ".bleep-view.dn .bv-knob{width:64px}.bleep-view.dn .bv-knob svg{width:42px;height:42px}";
    document.head.appendChild(st);
  }

  BleepViews.register("delay-network", {
    parts: [{ id: "taps", name: "Taps", select: ".bv-panel:has(.dn-timeline)" }, { id: "routing", name: "Routing and freeze", select: ".bv-panel:has(.dn-routing)" }],
    layout: [
      { title: "Time & taps", params: ["time", "taps", "scatter", "jitter", "reverse"] },
      { title: "Repeats", params: ["feedback", "character", "tone", "width"] },
      { title: "Mix", params: ["mix"] },
      { title: "Mode", params: ["routing", "sync", "timechange", "clearonplay", "seed"] },
    ],
    template:
      '<div style="display:flex;gap:8px;width:100%"><div class="bv-panel" style="flex:1 1 auto;min-width:0"><canvas class="dn-timeline" style="height:128px"></canvas></div>' +
      '<div class="bv-panel" style="flex:0 0 130px;display:flex;flex-direction:column;align-items:center;gap:4px">' +
      '<canvas class="dn-routing" style="width:84px;height:84px;flex:none"></canvas>' +
      '<span class="dn-routing-name" style="color:var(--muted);font-size:11px"></span>' +
      '<button class="bv-button dn-freeze">◉ Freeze</button></div></div>',
    afterBuild(view, el) {
      view.root.classList.add("dn");
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
      BleepView.loop(view.root, (t) => { if (view.dn.last) drawTimeline(view, view.dn.last, t); });
    },
    onState(st, view) {
      if (!view.dn || !st) return;
      view.dn.last = st;
      view.dn.taps = st.taps || view.dn.taps;
      view.dn.freeze.classList.toggle("on", frozenLatched(view) || st.freeze > 0.5);
      drawRouting(view);
    },
    onRefresh(view) { if (view.dn) drawRouting(view); },
  });
})();
