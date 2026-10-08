// SPDX-License-Identifier: MIT
// Verb view (specs/modules/reverb.md §5): decay curves for the low, mid and
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

  BleepViews.register("reverb", {
    template:
      '<div class="bv-panel"><h2>Decay <span class="rv-label" style="float:right;font-weight:normal"></span></h2>' +
      '<canvas class="rv-decay" style="height:84px;width:100%"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<button class="rv-freeze" title="Latching freeze (ORed with the Freeze gate)">◉ Freeze</button>' +
      '<span style="flex:1"></span><span style="font-size:11px">wet</span>' +
      '<div style="width:80px;height:6px;border:1px solid var(--line)"><div class="rv-meter" style="height:100%;width:0;background:var(--accent)"></div></div>' +
      "</div></div>",
    afterBuild(view, el) {
      const btn = el.querySelector(".rv-freeze");
      btn.addEventListener("click", () => {
        const v = (view.node.params.freeze ?? 0) >= 0.5 ? 0 : 1;
        view.api.beginGesture();
        view.node.params.freeze = v;
        view.api.setParam("freeze", v);
        draw(view, view.lastState);
      });
    },
    onState(st, view) {
      view.lastState = st;
      draw(view, st);
    },
    onRefresh(view) { draw(view, view.lastState); },
  });
})();
