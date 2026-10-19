// SPDX-License-Identifier: GPL-3.0-or-later
// Verb view (doc/specs/modules/reverb.md §5): decay curves for the low, mid and
// high bands from the effective (modulated) Decay, Bass and Damping on a log
// time axis, with the pre-delay as a gap; "Infinite" in the ∞ region; a
// latching Freeze button (the "freeze" setting, ORed with the gate) lit while
// frozen from either source; and a wet meter (the Env output). Mirrors
// patch/modules/reverb/dsp/ReverbDsp.h (t60) and dsp/Fdn.h (band T60s).
(function () {
  "use strict";
  const LIMIT = 0.92, INF = 0.96, T_MIN = 0.01, T_MAX = 100, DB = -70;
  function t60(x) {
    x = Math.min(Math.max(x, 0), 1);
    if (x <= LIMIT) return 0.1 * Math.pow(600, x / LIMIT);
    if (x >= INF) return Infinity;
    return 60 / (1 - (x - LIMIT) / (INF - LIMIT));
  }
  const secs = (t) => (!isFinite(t) ? "∞" : t < 1 ? Math.round(t * 1000) + " ms" : t < 10 ? t.toFixed(2) + " s" : t.toFixed(0) + " s");

  function draw(view, st) {
    const c = view.root.querySelector(".rv-decay");
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line");
    const muted = css.getPropertyValue("--muted") || line, text = css.getPropertyValue("--text");
    const frozen = !!(st && st.frozen);
    const decayKnob = view.value(st, "decay");
    const mid = t60(decayKnob);
    const damping = view.value(st, "damping"), bass = 0.5 * Math.pow(4, view.value(st, "bass"));
    const lossless = frozen || !isFinite(mid);
    const bands = [
      ["lo", lossless ? Infinity : mid * Math.min(Math.max(bass, 0.25), 4), muted, 1],
      ["mid", lossless ? Infinity : mid, accent, 2],
      ["hi", lossless ? Infinity : mid * (1 - 0.9 * damping), text, 1],
    ];
    const pre = st && typeof st.preDelayMs === "number" ? st.preDelayMs / 1000 : 0;
    const xOf = (t) => Math.log(Math.max(t, T_MIN) / T_MIN) / Math.log(T_MAX / T_MIN) * w;
    const yOf = (db) => Math.min(-db / -DB, 1) * (h - 14) + 2;
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath();
    for (const t of [0.1, 1, 10]) { g.moveTo(xOf(t) + 0.5, 0); g.lineTo(xOf(t) + 0.5, h - 12); }
    g.stroke();
    g.font = "9px system-ui, sans-serif";
    g.fillStyle = muted;
    g.textAlign = "center";
    for (const [t, l] of [[0.1, "100 ms"], [1, "1 s"], [10, "10 s"]]) g.fillText(l, xOf(t), h - 2);
    if (pre > 0) {  // the pre-delay gap
      g.fillStyle = line;
      g.fillRect(0, 0, xOf(pre), h - 12);
    }
    for (const [, T, colour, width] of bands) {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const t = T_MIN * Math.pow(T_MAX / T_MIN, x / w);
        const db = t < pre ? DB : isFinite(T) ? -60 * (t - pre) / T : 0;
        const y = yOf(db);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    const label = view.root.querySelector(".rv-label");
    if (label) {
      label.textContent = frozen ? "Frozen" : !isFinite(mid) ? "Infinite"
        : `T60 ${secs(mid)} · hi ${secs(bands[2][1])} · lo ${secs(bands[0][1])}`;
    }
    const meter = view.root.querySelector(".rv-meter");
    if (meter) meter.style.width = Math.round(100 * Math.min(1, (st && st.env) || 0)) + "%";
    const btn = view.root.querySelector(".rv-freeze");
    if (btn) {
      const latched = (view.node.params.freeze ?? 0) >= 0.5;
      btn.classList.toggle("on", latched || frozen);
      btn.style.background = latched || frozen ? accent : "";
    }
  }

  // The "tank": rings spreading from the centre, one per round trip of the room
  // (period follows Size), each fading at the room's T60; Diffusion thickens them
  // into a haze, Mod Depth wobbles them, the wet level lights them.
  function ripple(view, t) {
    const c = view.root.querySelector(".rv-tank");
    if (!c) return;
    const { g, w, h } = BleepView.fit(c);
    if (!w || !h) return;
    const st = view.lastState || {}, th = BleepView.theme(view.root);
    const size = view.value(st, "size"), diff = view.value(st, "diffusion");
    const mod = view.value(st, "modDepth"), rate = 0.05 + 8 * view.value(st, "modRate");
    const T = t60(view.value(st, "decay")), frozen = !!st.frozen;
    const tail = frozen || !isFinite(T) ? 1e9 : Math.min(T, 12);
    const wet = Math.min(1, (st.env || 0) * 2 + 0.25);
    const period = 0.28 + 0.9 * size, speed = (Math.min(w, h) * 0.5 * 1.1) / (2.2 + 4 * size);
    const cx = w / 2, cy = h / 2, rMax = Math.hypot(w, h) / 2;
    g.globalCompositeOperation = "lighter";
    const k0 = Math.floor(t / period);
    for (let k = k0; k > k0 - 14; k--) {
      const age = t - k * period;
      const a = Math.exp(-6.9 * age / tail);
      if (a < 0.02) continue;
      const r = 6 + age * speed * 1.6;
      if (r > rMax) continue;
      const first = k === k0 ? 0 : 1;
      const layers = 1 + Math.round(diff * 3);
      for (let j = 0; j < layers; j++) {
        const jitter = j ? (Math.sin(k * 12.9898 + j * 78.233) * 43758.5453 % 1) * diff * 10 : 0;
        const wob = mod * 4 * Math.sin(t * rate * 2 + k + j);
        g.beginPath();
        g.ellipse(cx, cy, Math.max(1, r + jitter + wob), Math.max(1, (r + jitter + wob) * 0.62), 0, 0, 6.2832);
        g.strokeStyle = th.accent;
        g.globalAlpha = Math.min(1, a * wet * (j ? 0.45 : 0.9) * (0.5 + 0.5 * (1 - first * 0.0)));
        g.lineWidth = 1 + diff * (j ? 2.5 : 1) * 1.2;
        BleepView.glow(g, th.accent, 6 + diff * 8);
        g.stroke();
      }
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 14);
    gr.addColorStop(0, th.text); gr.addColorStop(1, "transparent");
    g.fillStyle = gr; g.globalAlpha = 0.5 + 0.5 * wet;
    g.beginPath(); g.arc(cx, cy, 14, 0, 6.2832); g.fill();
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  }

  if (!document.getElementById("rv-style")) {
    const st = document.createElement("style");
    st.id = "rv-style";
    st.textContent = ".bleep-view.rv .bv-knob{width:64px}.bleep-view.rv .bv-knob svg{width:42px;height:42px}" +
      ".bleep-view.rv .bv-panel h2{text-transform:none}";
    document.head.appendChild(st);
  }

  BleepViews.register("reverb", {
    parts: [{ id: "decay", name: "Decay", select: ".bv-panel:has(.rv-decay)" }, { id: "tank", name: "Reverb tank", select: ".bv-panel:has(.rv-tank)" }],
    hideParams: ["freeze"],  // the Freeze button below replaces the latch
    layout: [
      { title: "Room", params: ["size", "decay", "preDelay", "diffusion"] },
      { title: "Tone", params: ["damping", "bass", "tone"] },
      { title: "Motion", params: ["modRate", "modDepth"] },
      { title: "Output", params: ["width", "mix"] },
      { title: "Mode", params: ["type", "preSync", "quality", "clearOnPlay", "seed"] },
    ],
    template:
      '<div style="display:flex;gap:8px;flex-wrap:wrap;width:100%">' +
      '<div class="bv-panel" style="flex:2 1 380px"><h2>Decay <span class="rv-label" style="float:right;font-weight:normal"></span></h2>' +
      '<canvas class="rv-decay" style="height:78px;width:100%"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<button class="bv-button rv-freeze" title="Latching freeze (ORed with the Freeze gate)">◉ Freeze</button>' +
      '<span style="flex:1"></span><span style="font-size:11px;color:var(--muted)">wet</span>' +
      '<div style="width:90px;height:6px;border:1px solid var(--line);border-radius:3px;overflow:hidden"><div class="rv-meter" style="height:100%;width:0;background:var(--accent)"></div></div>' +
      '</div></div>' +
      '<div class="bv-panel" style="flex:1 1 200px;padding:0;overflow:hidden;position:relative">' +
      '<canvas class="rv-tank" style="height:100%;min-height:120px;width:100%"></canvas></div></div>',
    afterBuild(view, el) {
      view.root.classList.add("rv");
      const btn = el.querySelector(".rv-freeze");
      btn.addEventListener("click", () => {
        const v = (view.node.params.freeze ?? 0) >= 0.5 ? 0 : 1;
        view.api.beginGesture();
        view.node.params.freeze = v;
        view.api.setParam("freeze", v);
        draw(view, view.lastState);
      });
      BleepView.loop(view.root, (t) => ripple(view, t));
    },
    onState(st, view) {
      view.lastState = st;
      draw(view, st);
    },
    onRefresh(view) { draw(view, view.lastState); },
  });
})();
