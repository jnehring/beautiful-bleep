// SPDX-License-Identifier: MIT
// Level Meter view (doc/specs/modules/level-meter.md §5): a bar per channel with
// the RMS level inside the peak level, a peak-hold line, a dB scale, the
// held peak in numbers and a clip light. A click resets holds and lights.
(function () {
  "use strict";
  const FLOORS = [-24, -36, -48, -60, -72, -96];   // LevelMeterDsp.h kLevelMeterFloors
  const HOLDS = [0, 1, 3, Infinity];               // Peak Hold, seconds
  const TICKS = [0, -3, -6, -12, -18, -24, -36, -48, -60, -72, -84, -96];
  const FALL = 24;                                  // dB per second, the bar's fall
  const toDb = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
  const choice = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round((view.node.params[id] ?? p.default) * (p.steps - 1));
  };
  const text = (db, floor) => (db <= floor ? "−∞" : (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1));

  function channel() {
    return { bar: -200, rms: -200, hold: -200, holdAt: 0, clip: false };
  }
  function reset(view) {
    const m = view.meter;
    for (const ch of m.ch) { ch.hold = -200; ch.clip = false; }
    draw(view);
  }

  function draw(view) {
    const m = view.meter;
    if (!m) return;
    const c = m.canvas;
    if (!c.clientWidth) return;
    const floor = FLOORS[choice(view, "floor")];
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const colour = (v) => css.getPropertyValue(v).trim();
    const top = 6, bottom = h - 6, y = (db) => top + (bottom - top) * Math.min(1, Math.max(0, db / floor));

    // Scale on the left
    const scaleW = 30;
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    let lastY = -Infinity;
    for (const t of TICKS) {
      if (t < floor || y(t) - lastY < 14) continue;  // no crowding near 0 dB
      lastY = y(t);
      g.fillStyle = colour("--muted");
      g.fillText(t === 0 ? "0" : "−" + -t, scaleW - 6, y(t));
      g.fillStyle = colour("--line");
      g.fillRect(scaleW - 3, Math.round(y(t)), w - scaleW + 3, 1);
    }

    const shown = m.stereo ? m.ch : [m.ch[0]];
    const gap = 8, bw = Math.min(48, (w - scaleW - gap * (shown.length + 1)) / shown.length);
    const x0 = scaleW + (w - scaleW - shown.length * bw - (shown.length - 1) * gap) / 2;
    shown.forEach((ch, k) => {
      const x = x0 + k * (bw + gap);
      g.fillStyle = colour("--panel-3");
      g.fillRect(x, top, bw, bottom - top);
      // Peak bar, coloured by zone: green, then −6 dB amber, then over 0 red.
      const zones = [[floor, -6, colour("--sig-gate")], [-6, 0, colour("--mod")], [0, 6, colour("--warn")]];
      for (const [lo, hi, col] of zones) {
        if (ch.bar <= lo) continue;
        const y0 = y(Math.min(hi, ch.bar)), y1 = y(lo);
        g.globalAlpha = 0.45;
        g.fillStyle = col;
        g.fillRect(x, y0, bw, y1 - y0);
        // RMS: the solid inner part
        if (ch.rms > lo) {
          const r0 = y(Math.min(hi, ch.rms));
          g.globalAlpha = 1;
          g.fillRect(x, r0, bw, y1 - r0);
        }
      }
      g.globalAlpha = 1;
      if (ch.hold > floor) {
        g.fillStyle = ch.hold > 0 ? colour("--warn") : colour("--text");
        g.fillRect(x, Math.round(y(Math.min(0, ch.hold))) - 1, bw, 2);
      }
    });

    m.labels.forEach((l, k) => {
      const ch = m.ch[k], on = k === 0 || m.stereo;
      l.box.style.display = on ? "" : "none";
      l.name.textContent = m.stereo ? (k ? "R" : "L") : "Mono";
      l.peak.textContent = text(ch.hold, floor);
      l.rms.textContent = text(ch.rms, floor);
      l.clip.classList.toggle("on", ch.clip);
    });
  }

  BleepViews.register("level-meter", {
    top: true,
    template:
      "<style>" +
      ".lm{display:flex;flex-direction:column;gap:6px;flex:1 1 100%}" +
      ".lm canvas{width:100%;height:180px;cursor:pointer}" +
      ".lm-row{display:flex;gap:10px;justify-content:center}" +
      ".lm-ch{display:grid;grid-template-columns:auto auto auto;gap:2px 8px;align-items:center;font-size:11px}" +
      ".lm-ch b{grid-row:span 2;font-weight:600;min-width:2.6em}" +
      ".lm-num{font-variant-numeric:tabular-nums;text-align:right;min-width:3.6em}" +
      ".lm-cap{color:var(--muted);font-size:10px}" +
      ".lm-clip{grid-column:1;width:10px;height:10px;border-radius:50%;border:1px solid var(--line);" +
      "background:var(--panel-3);padding:0;cursor:pointer}" +
      ".lm-clip.on{background:var(--warn);border-color:var(--warn)}" +
      "</style>" +
      '<div class="lm"><canvas title="Click to reset the peak hold and clip lights"></canvas><div class="lm-row"></div></div>',
    afterBuild(view, el) {
      const row = el.querySelector(".lm-row");
      const labels = [0, 1].map(() => {
        const box = document.createElement("div");
        box.className = "lm-ch";
        box.innerHTML =
          '<b></b><span class="lm-num lm-peak"></span><span class="lm-cap">peak</span>' +
          '<span class="lm-num lm-rms"></span><span class="lm-cap">rms</span>' +
          '<button class="lm-clip" title="Clip: a sample over 0 dBFS. Click to reset."></button>';
        row.appendChild(box);
        return { box, name: box.querySelector("b"), peak: box.querySelector(".lm-peak"),
                 rms: box.querySelector(".lm-rms"), clip: box.querySelector(".lm-clip") };
      });
      const canvas = el.querySelector("canvas");
      view.meter = { canvas, labels, ch: [channel(), channel()], stereo: false, last: 0 };
      canvas.addEventListener("click", () => reset(view));
      for (const l of labels) l.clip.addEventListener("click", (e) => { e.stopPropagation(); reset(view); });
      draw(view);
    },
    onState(st, view) {
      const m = view.meter;
      if (!m || !st) return;
      const now = performance.now() / 1000, dt = m.last ? Math.min(0.5, now - m.last) : 0;
      m.last = now;
      m.stereo = !!st.stereo;
      const holdFor = HOLDS[choice(view, "hold")];
      [["peakL", "rmsL", "clipL"], ["peakR", "rmsR", "clipR"]].forEach(([pk, rk, ck], k) => {
        const ch = m.ch[k], peak = toDb(st[pk] || 0);
        ch.bar = Math.max(peak, ch.bar - FALL * dt);
        ch.rms = toDb(st[rk] || 0);
        if (peak >= ch.hold) { ch.hold = peak; ch.holdAt = now; }
        else if (now - ch.holdAt > holdFor) ch.hold = ch.bar;
        if (st[ck]) ch.clip = true;
      });
      draw(view);
    },
    onRefresh: draw,
  });
})();
