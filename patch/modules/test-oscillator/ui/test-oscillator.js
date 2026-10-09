// SPDX-License-Identifier: MIT
// Test Oscillator view (specs/modules/test-oscillator.md §5): a large
// log-printed dial for Frequency (drag vertically, Shift for fine, double-click
// for the default), a four-button range switch, the lamp glowing with the
// heat (dark at 0, orange at 0.5, white-hot at 1), a scope of two periods of
// Sine triggered on Sync (it freezes when the loop is silent) and the
// frequency readout with drift.
(function () {
  "use strict";
  const RANGES = ["×1", "×10", "×100", "×1k"];
  const MARKS = [1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const START = -135, END = 135;  // dial travel in degrees, 0 = up
  const STYLE = `
    .to { display: flex; flex-direction: column; gap: 6px; flex: 1 1 100%; }
    .to-top { display: flex; gap: 8px; align-items: stretch; }
    .to-dial { flex: 0 0 150px; height: 150px; cursor: ns-resize; touch-action: none; }
    .to-side { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .to-lamprow { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--muted); }
    .to-lamp { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); }
    .to-scope { width: 100%; height: 80px; display: block; }
    .to-bottom { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .to-cap { font-size: 10px; color: var(--muted); margin-right: 2px; letter-spacing: 0.05em; }
    .to-range { border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--muted);
      font-size: 11px; padding: 2px 7px; cursor: pointer; }
    .to-range.on { color: var(--text); border-color: var(--accent); background: var(--panel-3, var(--panel)); }
    .to-readout { margin-left: auto; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text); }
    .to-readout span { color: var(--muted); margin-left: 6px; }
  `;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const param = (view, id) => view.type.params.find((p) => p.id === id);
  const norm = (view, id) => view.node.params[id] ?? (param(view, id) || {}).default ?? 0;

  function canvas2d(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function colours(view) {
    const css = getComputedStyle(view.root);
    const v = (k, d) => css.getPropertyValue(k).trim() || d;
    return { accent: v("--accent", "#f59e0b"), line: v("--line", "#333"), muted: v("--muted", "#888"),
             text: v("--text", "#ddd"), panel: v("--panel-3", "#222") };
  }

  /// Frequency travel is logarithmic: normalised n ↔ 10^n on the 1…10 scale.
  const angleOf = (n) => START + (END - START) * clamp01(n);
  function polar(cx, cy, r, deg) {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function drawDial(view, st) {
    const c = view.to.dial;
    if (!c || !c.clientWidth) return;
    const { g, w, h } = canvas2d(c);
    const col = colours(view);
    const cx = w / 2, cy = h / 2 + 6, r = Math.min(w, h) / 2 - 18;
    // scale: ticks every 0.1 decade, numbers at the marks
    g.strokeStyle = col.muted; g.fillStyle = col.text; g.lineWidth = 1;
    g.font = "10px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let k = 10; k <= 100; k++) {
      const v = k / 10, n = Math.log10(v), a = angleOf(n);
      const major = MARKS.includes(v);
      const [x0, y0] = polar(cx, cy, r, a), [x1, y1] = polar(cx, cy, r - (major ? 7 : 3), a);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (major) {
        const [tx, ty] = polar(cx, cy, r + 10, a);
        g.fillText(String(v), tx, ty);
      }
    }
    // knob body and pointer (the modulated value), the set value as a faint tick
    g.fillStyle = col.panel; g.strokeStyle = col.line;
    g.beginPath(); g.arc(cx, cy, r - 12, 0, 2 * Math.PI); g.fill(); g.stroke();
    const set = norm(view, "freq"), eff = view.value(st, "freq");
    if (Math.abs(eff - set) > 1e-3) {
      g.strokeStyle = col.muted; g.globalAlpha = 0.5; g.lineWidth = 2;
      const [a0, b0] = polar(cx, cy, r - 14, angleOf(set)), [a1, b1] = polar(cx, cy, r - 24, angleOf(set));
      g.beginPath(); g.moveTo(a0, b0); g.lineTo(a1, b1); g.stroke();
      g.globalAlpha = 1;
    }
    g.strokeStyle = col.accent; g.lineWidth = 3; g.lineCap = "round";
    const [px, py] = polar(cx, cy, r - 14, angleOf(eff)), [qx, qy] = polar(cx, cy, 6, angleOf(eff));
    g.beginPath(); g.moveTo(qx, qy); g.lineTo(px, py); g.stroke();
    g.lineCap = "butt";
    g.fillStyle = col.text;
    g.fillText(Math.pow(10, clamp01(eff)).toFixed(2), cx, cy + r * 0.45);
  }

  /// Lamp colour: dark → orange (0.5) → white-hot (1).
  function lampColour(x) {
    x = clamp01(x);
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const dark = [40, 26, 12], orange = [251, 146, 60], white = [255, 250, 230];
    return x < 0.5 ? mix(dark, orange, x / 0.5) : mix(orange, white, (x - 0.5) / 0.5);
  }
  function drawLamp(view, st) {
    const x = st && typeof st.lamp === "number" ? st.lamp : 0;
    const [r, g, b] = lampColour(x);
    const el = view.to.lamp;
    el.style.background = `rgb(${r},${g},${b})`;
    el.style.boxShadow = x > 0.02 ? `0 0 ${Math.round(4 + 14 * clamp01(x))}px rgba(${r},${g},${b},${(0.3 + 0.6 * clamp01(x)).toFixed(2)})` : "none";
    view.to.lampText.textContent = "lamp " + Math.round(100 * clamp01(x)) + " %";
  }

  function drawScope(view, st) {
    const c = view.to.scope;
    if (!c || !c.clientWidth) return;
    const { g, w, h } = canvas2d(c);
    const col = colours(view);
    g.strokeStyle = col.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5);
    g.moveTo(w / 2 + 0.5, 0); g.lineTo(w / 2 + 0.5, h); g.stroke();
    const arr = st && st.arrays && st.arrays.scope;
    if (arr && arr.length) view.to.last = arr;  // keep the last capture between states
    const a = view.to.last;
    if (!a || !a.length) return;
    g.strokeStyle = col.accent; g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < a.length; i++) {
      const x = (i / (a.length - 1)) * w, y = h / 2 - (Math.max(-1.1, Math.min(1.1, a[i])) / 1.1) * (h / 2 - 2);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  function drawRange(view) {
    const r = view.units("range");
    view.to.ranges.forEach((b, i) => b.classList.toggle("on", i === r));
  }
  function drawReadout(view, st) {
    if (!st || typeof st.freq !== "number") return;
    const f = st.freq;
    const hz = f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 2 : 3) + " kHz" : f.toFixed(f >= 100 ? 1 : 2) + " Hz";
    const ct = Math.round(st.drift || 0);
    view.to.hz.textContent = hz;
    view.to.ct.textContent = (ct > 0 ? "+" : ct < 0 ? "−" : "±") + Math.abs(ct) + " ct";
  }

  function draw(view, st) {
    if (!view.to) return;
    drawDial(view, st);
    drawLamp(view, st);
    drawScope(view, st);
    drawRange(view);
    drawReadout(view, st);
  }

  BleepViews.register("test-oscillator", {
    top: true,
    width: 380,
    hideParams: ["freq", "range"],
    template:
      "<style>" + STYLE + "</style>" +
      '<div class="to"><div class="to-top">' +
      '<canvas class="to-dial" title="Frequency: drag up and down (Shift: fine), double-click: default"></canvas>' +
      '<div class="to-side"><div class="to-lamprow"><div class="to-lamp"></div><span class="to-lamptext">lamp</span></div>' +
      '<canvas class="to-scope" title="Two periods of Sine, triggered on Sync"></canvas></div></div>' +
      '<div class="to-bottom"><span class="to-cap">RANGE</span></div></div>',
    afterBuild(view, el) {
      const bottom = el.querySelector(".to-bottom");
      const ranges = RANGES.map((name, i) => {
        const b = document.createElement("button");
        b.className = "to-range";
        b.textContent = name;
        b.title = ["2–20 Hz", "20–200 Hz", "200 Hz – 2 kHz", "2–20 kHz"][i];
        b.addEventListener("click", () => {
          view.api.beginGesture();
          view.node.params.range = i / (RANGES.length - 1);
          view.api.setParam("range", i / (RANGES.length - 1));
          draw(view, null);
        });
        bottom.appendChild(b);
        return b;
      });
      const readout = document.createElement("div");
      readout.className = "to-readout";
      readout.innerHTML = '<b class="to-hz">–</b><span class="to-ct"></span>';
      bottom.appendChild(readout);
      view.to = {
        dial: el.querySelector(".to-dial"), scope: el.querySelector(".to-scope"),
        lamp: el.querySelector(".to-lamp"), lampText: el.querySelector(".to-lamptext"),
        ranges, hz: readout.querySelector(".to-hz"), ct: readout.querySelector(".to-ct"), last: null,
      };

      // The dial: 200 px for the whole travel, Shift 1000 px.
      const dial = view.to.dial;
      let startY = 0, startV = 0, dragging = false;
      const setFreq = (v) => {
        v = clamp01(v);
        view.node.params.freq = v;
        view.api.setParam("freq", v);
        drawDial(view, null);
      };
      dial.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        dial.setPointerCapture(e.pointerId);
        startY = e.clientY; startV = norm(view, "freq"); dragging = true;
        view.api.beginGesture();
      });
      dial.addEventListener("pointermove", (e) => {
        if (dragging) setFreq(startV + (startY - e.clientY) / (e.shiftKey ? 1000 : 200));
      });
      const end = () => { dragging = false; };
      dial.addEventListener("pointerup", end);
      dial.addEventListener("pointercancel", end);
      dial.addEventListener("dblclick", () => { view.api.beginGesture(); setFreq(param(view, "freq").default); });
      dial.addEventListener("wheel", (e) => {
        e.preventDefault();
        view.api.beginGesture();
        setFreq(norm(view, "freq") - e.deltaY / (e.shiftKey ? 3000 : 600));
      }, { passive: false });
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) { draw(view, st); },
    onRefresh(view) { draw(view, null); },
  });
})();
