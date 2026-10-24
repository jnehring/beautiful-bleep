// SPDX-License-Identifier: GPL-3.0-only
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
    const th = BleepView.theme(view.root);
    const css = getComputedStyle(view.root);
    const colour = (v) => css.getPropertyValue(v).trim();
    const shown = m.stereo ? m.ch : [m.ch[0]];
    // Horizontal bars with the dB scale across the top; the level history glows below.
    const left = 28, right = 10, bw = w - left - right, top = 18, bh = 22, gap = 7;
    const x = (db) => left + bw * Math.min(1, Math.max(0, 1 - db / floor));
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let lastX = -Infinity;
    const histTop = top + shown.length * (bh + gap) + 6, histBot = h - 6;
    for (const t of TICKS) {
      if (t < floor || Math.abs(x(t) - lastX) < 26) continue;
      lastX = x(t);
      g.fillStyle = colour("--muted");
      g.fillText(t === 0 ? "0" : "−" + -t, x(t), 8);
      g.fillStyle = colour("--line");
      g.fillRect(Math.round(x(t)), top - 4, 1, shown.length * (bh + gap) + 2);
    }
    const grad = g.createLinearGradient(left, 0, left + bw, 0);
    const z6 = Math.min(1, Math.max(0, 1 - -6 / floor));
    grad.addColorStop(0, colour("--sig-gate")); grad.addColorStop(Math.max(0.01, z6 - 0.02), colour("--sig-gate"));
    grad.addColorStop(Math.min(0.99, z6 + 0.02), colour("--mod")); grad.addColorStop(1, colour("--warn"));
    shown.forEach((ch, k) => {
      const y = top + k * (bh + gap);
      g.fillStyle = colour("--panel-3");
      g.fillRect(left, y, bw, bh);
      g.fillStyle = grad;
      if (ch.bar > floor) { g.globalAlpha = 0.4; g.fillRect(left, y, x(Math.min(6, ch.bar)) - left, bh); }
      if (ch.rms > floor) {
        g.globalAlpha = 1;
        BleepView.glow(g, colour("--sig-gate"), 10);
        g.fillRect(left, y + 4, x(Math.min(6, ch.rms)) - left, bh - 8);
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;
      if (ch.hold > floor) {
        g.fillStyle = ch.hold > 0 ? colour("--warn") : colour("--text");
        g.fillRect(Math.round(x(Math.min(0, ch.hold))) - 1, y - 2, 2, bh + 4);
      }
      g.fillStyle = colour("--muted");
      g.textAlign = "left";
      g.fillText(m.stereo ? (k ? "R" : "L") : "M", 8, y + bh / 2);
      g.textAlign = "center";
    });
    // History: the louder channel's RMS over the last seconds, newest at the right.
    if (histBot - histTop > 16) {
      const n = m.hist.length, hy = (db) => histBot - (histBot - histTop) * Math.min(1, Math.max(0, 1 - db / floor));
      const area = g.createLinearGradient(0, histTop, 0, histBot);
      area.addColorStop(0, th.accent); area.addColorStop(1, "transparent");
      g.beginPath();
      g.moveTo(left, histBot);
      for (let i = 0; i < n; i++) g.lineTo(left + bw * i / (n - 1), hy(m.hist[(m.hi + i) % n]));
      g.lineTo(left + bw, histBot);
      g.closePath();
      g.globalAlpha = 0.35; g.fillStyle = area; g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const px = left + bw * i / (n - 1), py = hy(m.hist[(m.hi + i) % n]);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.strokeStyle = th.accent; g.lineWidth = 1.5; g.lineJoin = "round";
      BleepView.glow(g, th.accent, 8); g.stroke(); g.shadowBlur = 0;
    }

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
    width: 660,
    partNames: ["Meters"],
    layout: [
      { title: "Detector", params: ["detector", "response"] },
      { title: "Scale", params: ["floor", "hold"] },
    ],
    template:
      "<style>" +
      ".lm{display:flex;flex-direction:column;gap:6px;flex:1 1 100%}" +
      ".bv-custom .lm canvas{width:100%;height:150px;cursor:pointer}" +
      ".lm-row{display:flex;gap:28px;justify-content:center}" +
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
      view.meter = { hist: new Float32Array(240).fill(-200), hi: 0, canvas, labels, ch: [channel(), channel()], stereo: false, last: 0 };
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
      const hot = Math.max(m.ch[0].rms, m.stereo ? m.ch[1].rms : -200);
      m.hist[m.hi] = hot; m.hi = (m.hi + 1) % m.hist.length;
      draw(view);
    },
    onRefresh: draw,
  });
})();
