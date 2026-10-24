// SPDX-License-Identifier: GPL-3.0-only
// Sweep Generator view (doc/specs/modules/sweep-generator.md §5): frequency (log
// axis, 10 Hz – 20 kHz, lower when Start or Stop go below) against time over
// one sweep cycle, drawn from the knobs and settings like SweepGeneratorDsp:
// straight in Log, bowed in Lin, a tent in Up-Down, the retrace faint. Active
// markers are dashed lines, the live position a bright dot, the frequency a
// readout. Drag the curve's ends for Start and Stop, a marker line to move it.
// Waveform is a row of icon buttons (the setting is hidden).
(function () {
  "use strict";
  const MIN = 0.01, MAX = 20000, SPAN = Math.log(MAX / MIN);  // ParamSpec::hertz range of every frequency knob
  const TOP_HZ = 20000, GRAB = 9, PAD_L = 26, PAD_R = 22;
  const SYNC = ["Free", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars", "16 bars"];  // sweepSyncNames()
  const WAVES = ["Sine", "Triangle", "Square", "Ramp Up", "Ramp Down", "Pulse"];
  const ICONS = [  // 24 × 14 paths, one cycle each
    "M2 7 C5 -1 9 -1 12 7 S19 15 22 7",
    "M2 12 L8 2 L16 12 L22 4",
    "M2 12 V2 H12 V12 H22 V2",
    "M2 12 L12 2 V12 L22 2 V12",
    "M2 2 L12 12 V2 L22 12 V2",
    "M2 12 V2 H5 V12 H12 V2 H15 V12 H22",
  ];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const toHz = (n) => MIN * Math.exp(clamp(n, 0, 1) * SPAN);
  const toNorm = (hz) => clamp(Math.log(hz / MIN) / SPAN, 0, 1);
  const position = (p, dir) => (dir === 1 ? 1 - p : dir === 2 ? 1 - Math.abs(2 * p - 1) : p);
  const lawHz = (a, b, s, lin) => (lin ? a + (b - a) * s : a * Math.pow(b / a, s));

  function fmtHz(hz) {
    if (!(hz > 0)) return "–";
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + " kHz";
    if (hz >= 100) return Math.round(hz) + " Hz";
    return hz.toFixed(hz >= 10 ? 1 : 2) + " Hz";
  }
  const fmtTime = (s) => (s < 1 ? Math.round(s * 1000) + " ms" : s < 10 ? s.toFixed(2) + " s" : s.toFixed(1) + " s");
  const decade = (hz) => (hz >= 1000 ? hz / 1000 + "k" : String(hz));

  /// Everything the drawing and the drag need, from the effective knob values.
  function model(view, st) {
    const start = toHz(view.value(st, "start")), stop = toHz(view.value(st, "stop"));
    const markers = view.units("markers");
    const m = [];
    for (let k = 1; k <= Math.min(3, markers); k++) m.push({ id: "marker" + k, hz: toHz(view.value(st, "marker" + k)) });
    const sync = view.units("sweepsync"), dir = view.units("direction"), mode = view.units("mode");
    const live = st && typeof st.length === "number" ? st.length : null;
    const length = sync === 0 ? 0.01 * Math.pow(10000, view.value(st, "time")) : live || 2;  // Sweep Time: 10 ms – 100 s, exponential
    return {
      start, stop, markers: m, dir, mode, sync, length,
      lin: view.units("law") === 1, glide: view.units("retrace") === 1,
      wave: view.units("waveform"),
    };
  }

  function draw(view, st) {
    const sg = view.sg;
    if (!sg) return;
    const c = sg.canvas;
    if (!c.clientWidth) return;
    const m = model(view, st);
    sg.model = m;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#fb923c";
    const line = css.getPropertyValue("--line").trim(), muted = css.getPropertyValue("--muted").trim();
    const text = css.getPropertyValue("--text").trim();

    // Axis: 10 Hz – 20 kHz, extended down by decades for slow sweeps (frozen while dragging).
    if (!sg.drag) {
      const low = Math.min(m.start, m.stop, ...m.markers.map((k) => k.hz));
      sg.lo = Math.pow(10, Math.min(1, Math.floor(Math.log10(Math.max(low, MIN)))));
    }
    const lo = sg.lo, top = 6, bottom = h - 6, x0 = PAD_L, x1 = w - PAD_R;
    const y = (hz) => bottom - (Math.log(clamp(hz, lo, TOP_HZ) / lo) / Math.log(TOP_HZ / lo)) * (bottom - top);
    const x = (p) => x0 + p * (x1 - x0);
    sg.map = { lo, top, bottom, x, y, hzAt: (yy) => lo * Math.pow(TOP_HZ / lo, clamp((bottom - yy) / (bottom - top), 0, 1)) };

    g.font = "9px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.textAlign = "right";
    g.lineWidth = 1;
    for (let d = lo; d <= TOP_HZ; d *= 10) {
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(x0, Math.round(y(d)) + 0.5); g.lineTo(x1, Math.round(y(d)) + 0.5); g.stroke();
      g.fillStyle = muted;
      g.fillText(decade(d), x0 - 4, y(d));
    }
    g.fillText("20k", x0 - 4, y(TOP_HZ) + 4);

    // Markers: dashed, labelled on the right.
    g.textAlign = "left";
    g.setLineDash([3, 3]);
    m.markers.forEach((k, i) => {
      const yy = Math.round(y(k.hz)) + 0.5;
      g.strokeStyle = sg.drag && sg.drag.id === k.id ? text : muted;
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
      g.fillStyle = muted;
      g.fillText("M" + (i + 1), x1 + 3, yy);
    });
    g.setLineDash([]);

    // The retrace, faint: a glide back at the cycle's start, or the instant jump at its end.
    const wraps = m.dir !== 2 && m.mode !== 1;
    const sEnd = m.dir === 0 ? 1 : 0;
    if (wraps) {
      g.globalAlpha = 0.3;
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      if (m.glide) {
        const span = Math.min(0.05 * m.length, 0.25) / m.length, e5 = Math.exp(-5);
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, p = t * span;
          const s = clamp(position(p, m.dir) + (sEnd - position(0, m.dir)) * (Math.exp(-5 * t) - e5) / (1 - e5), 0, 1);
          const yy = y(lawHz(m.start, m.stop, s, m.lin));
          i ? g.lineTo(x(p), yy) : g.moveTo(x(p), yy);
        }
      } else {
        g.setLineDash([2, 3]);
        g.moveTo(x(1), y(lawHz(m.start, m.stop, sEnd, m.lin)));
        g.lineTo(x(1), y(lawHz(m.start, m.stop, 1 - sEnd, m.lin)));
      }
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    // The sweep over one cycle: a glowing line over a faint gradient down to the floor.
    const n = 160;
    const fill = g.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, accent + "55"); fill.addColorStop(1, accent + "00");
    g.fillStyle = fill;
    g.beginPath(); g.moveTo(x(0), bottom);
    for (let i = 0; i <= n; i++) { const p = i / n; g.lineTo(x(p), y(lawHz(m.start, m.stop, position(p, m.dir), m.lin))); }
    g.lineTo(x(1), bottom); g.closePath(); g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 2.2;
    BleepView.glow(g, accent, 10);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const p = i / n, yy = y(lawHz(m.start, m.stop, position(p, m.dir), m.lin));
      i ? g.lineTo(x(p), yy) : g.moveTo(x(p), yy);
    }
    g.stroke();
    g.shadowBlur = 0;

    // Handles at Start and Stop.
    sg.handles = [];
    const handle = (id, p, hz) => sg.handles.push({ id, x: x(p), y: y(hz) });
    if (m.dir === 0) { handle("start", 0, m.start); handle("stop", 1, m.stop); }
    else if (m.dir === 1) { handle("stop", 0, m.stop); handle("start", 1, m.start); }
    else { handle("start", 0, m.start); handle("stop", 0.5, m.stop); handle("start", 1, m.start); }
    for (const hd of sg.handles) {
      g.fillStyle = sg.drag && sg.drag.id === hd.id ? text : css.getPropertyValue("--panel-2").trim() || "#111";
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(hd.x, hd.y, 3.5, 0, 2 * Math.PI); g.fill(); g.stroke();
    }

    // The live position: a bright dot at the real frequency (Pitch and Drift included), with a short comet tail.
    const hz = st && typeof st.hz === "number" ? st.hz : null;
    if (hz !== null && typeof st.p === "number") {
      const px = x(clamp(st.p, 0, 1)), py = y(hz);
      const tail = sg.tail || (sg.tail = []);
      if (!tail.length || tail[tail.length - 1][2] !== st) { tail.push([px, py, st]); if (tail.length > 18) tail.shift(); }
      for (let i = 1; i < tail.length; i++) {
        if (Math.abs(tail[i][0] - tail[i - 1][0]) > w * 0.3) continue;  // a wrap, not a line
        g.strokeStyle = text; g.globalAlpha = (i / tail.length) * 0.6; g.lineWidth = 2;
        g.beginPath(); g.moveTo(tail[i - 1][0], tail[i - 1][1]); g.lineTo(tail[i][0], tail[i][1]); g.stroke();
      }
      g.globalAlpha = 1; g.lineWidth = 1;
      g.fillStyle = accent;
      g.globalAlpha = 0.25;
      g.beginPath(); g.arc(px, py, 7, 0, 2 * Math.PI); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = text;
      g.beginPath(); g.arc(px, py, 3, 0, 2 * Math.PI); g.fill();
    }

    // Readout and summary.
    sg.readout.textContent = hz !== null ? fmtHz(hz) : fmtHz(m.start);
    sg.readout.title = st && st.waiting ? "Waiting for a trigger" : "";
    sg.readout.classList.toggle("sg-waiting", !!(st && st.waiting));
    sg.summary.textContent = [m.lin ? "Lin" : "Log", ["Up", "Down", "Up-Down"][m.dir] || "Up",
      m.sync === 0 ? fmtTime(m.length) : SYNC[m.sync]].join("  ");
    sg.buttons.forEach((b, i) => b.classList.toggle("on", i === m.wave));
  }

  function attach(view, c) {
    const sg = view.sg;
    const set = (id, hz) => {
      const v = toNorm(hz);
      view.node.params[id] = v;
      view.api.setParam(id, v);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !sg.map || !sg.model) return;
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      let best = null, dist = GRAB;
      for (const hd of sg.handles || []) {
        const d = Math.hypot(hd.x - px, hd.y - py);
        if (d < dist) { dist = d; best = hd.id; }
      }
      if (!best) {
        for (const k of sg.model.markers) {
          const d = Math.abs(sg.map.y(k.hz) - py);
          if (d < Math.min(dist, 6)) { dist = d; best = k.id; }
        }
      }
      if (!best) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      sg.drag = { id: best };
      draw(view, view.lastState);
    });
    c.addEventListener("pointermove", (e) => {
      if (!sg.drag) {
        if (!sg.map || !sg.model) return;
        const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        const near = (sg.handles || []).some((hd) => Math.hypot(hd.x - px, hd.y - py) < GRAB) ||
          sg.model.markers.some((k) => Math.abs(sg.map.y(k.hz) - py) < 6);
        c.style.cursor = near ? "ns-resize" : "default";
        return;
      }
      const r = c.getBoundingClientRect();
      set(sg.drag.id, sg.map.hzAt(e.clientY - r.top));
      draw(view, view.lastState);
    });
    const end = () => {
      if (!sg.drag) return;
      sg.drag = null;
      draw(view, view.lastState);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  BleepViews.register("sweep-generator", {
    width: 870,
    hideParams: ["waveform"],  // the icon row sets it
    layout: [
      { title: "Sweep", params: ["start", "stop", "time", "symmetry", "direction", "law", "retrace", "burstcount"] },
      { title: "Markers", params: ["markers", "marker1", "marker2", "marker3", "markerwidth"] },
      { title: "Output", params: ["level", "drift", "fm"] },
      { title: "Trigger", params: ["mode", "sweepsync", "phasereset", "warmup", "seed"] },
    ],
    template:
      "<style>" +
      ".sg-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:2px 0 4px}" +
      ".sg-readout{font-size:20px;font-variant-numeric:tabular-nums;font-weight:600;color:var(--accent);min-width:6.5em}" +
      ".sg-readout.sg-waiting{opacity:.55}" +
      ".sg-summary{color:var(--muted);font-size:11px;white-space:pre;flex:1}" +
      ".sg-waves{display:flex;gap:3px;flex-wrap:wrap}" +
      ".sg-waves .bv-button{padding:2px 4px;line-height:0}" +
      ".sg-waves svg{width:24px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}" +
      ".sg-plot{height:116px!important;touch-action:none;background:rgba(0,0,0,.28);border-radius:4px}" +
      "</style>" +
      '<div class="bv-panel"><h2>Sweep</h2><canvas class="sg-plot"></canvas>' +
      '<div class="sg-head"><span class="sg-readout"></span><span class="sg-summary"></span><span class="sg-waves"></span></div></div>',
    afterBuild(view, el) {
      const waves = el.querySelector(".sg-waves");
      const buttons = WAVES.map((name, i) => {
        const b = document.createElement("button");
        b.className = "bv-button";
        b.title = name;
        b.innerHTML = '<svg viewBox="0 0 24 14"><path d="' + ICONS[i] + '"/></svg>';
        b.addEventListener("click", () => {
          view.api.beginGesture();
          const v = i / (WAVES.length - 1);
          view.node.params.waveform = v;
          view.api.setParam("waveform", v);
          draw(view, view.lastState);
        });
        waves.appendChild(b);
        return b;
      });
      view.sg = {
        canvas: el.querySelector("canvas"), readout: el.querySelector(".sg-readout"),
        summary: el.querySelector(".sg-summary"), buttons, lo: 10,
      };
      attach(view, view.sg.canvas);
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) {
      view.lastState = st;
      draw(view, st);
    },
    onRefresh(view) { draw(view, view.lastState); },
  });
})();
