// SPDX-License-Identifier: MIT
// Wave Analyzer view (specs/modules/wave-analyzer.md §5): a moving-coil
// needle meter (Floor … 0 dB, Threshold as a red tick), the big calibrated
// Frequency dial printed with the Range scale (its pointer shows the actual
// tuned frequency), Locked and Too Fast lights, and the plotter strip: level
// against log frequency in 384 columns, the current pass in ink over the
// previous one faded. A click on the strip clears it.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const FLOORS = [-24, -36, -48, -60, -72, -96];          // WaveAnalyzerDsp.h kWaveAnalyzerFloors
  const RANGES = [[20, 20000], [20, 200], [200, 2000], [2000, 20000]];  // WaveAnalyzerDsp::dialHz
  const COLUMNS = 384, PLOT_LO = 20, PLOT_HI = 20000;
  const START = -135, END = 135, C = 60;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const svg = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const polar = (cx, cy, r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  function arc(cx, cy, r, from, to) {
    if (to < from) [from, to] = [to, from];
    if (to - from < 0.5) to = from + 0.5;
    const [x1, y1] = polar(cx, cy, r, from), [x2, y2] = polar(cx, cy, r, to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }
  const hzText = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + " kHz" : f.toFixed(f < 100 ? 1 : 0) + " Hz");
  const shortHz = (f) => (f >= 1000 ? f / 1000 + "k" : String(f));
  function param(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return { p, v: view.node.params[id] ?? p.default };
  }
  const rangeOf = (view) => RANGES[Math.max(0, Math.min(3, view.units("range")))];
  /// Dial position (0..1) of a frequency on a range.
  const dialPos = (f, [lo, hi]) => Math.log(f / lo) / Math.log(hi / lo);
  /// Plotter column of a frequency.
  const column = (f) => Math.floor((Math.log(Math.max(f, 1) / PLOT_LO) / Math.log(PLOT_HI / PLOT_LO)) * COLUMNS);

  // ---- needle meter -------------------------------------------------------
  const M_CX = 80, M_CY = 78, M_R = 62, M_FROM = -60, M_TO = 60;
  const meterAngle = (m) => M_FROM + (M_TO - M_FROM) * clamp01(m);

  function drawMeterScale(view) {
    const w = view.wa, floor = FLOORS[view.units("floor")] ?? -60;
    if (w.meterFloor === floor) return;
    w.meterFloor = floor;
    w.meterTicks.innerHTML = "";
    const marks = [0, -3, -6, -10, -20, -30, -40, -50, -60, -70, -80, -90].filter((d) => d >= floor);
    let last = Infinity;
    for (const d of marks) {
      const a = meterAngle((d - floor) / -floor);
      const major = d % 10 === 0 || d === -3 || d === -6;
      const [x1, y1] = polar(M_CX, M_CY, M_R, a), [x2, y2] = polar(M_CX, M_CY, M_R - (major ? 7 : 4), a);
      w.meterTicks.appendChild(svg("line", { x1, y1, x2, y2, class: "wa-tick" }));
      if (Math.abs(last - a) < 11) continue;  // no crowding at narrow floors
      last = a;
      const [tx, ty] = polar(M_CX, M_CY, M_R + 9, a);
      const t = svg("text", { x: tx, y: ty, class: "wa-scale" });
      t.textContent = d === 0 ? "0" : "−" + -d;
      w.meterTicks.appendChild(t);
    }
    const [fx, fy] = polar(M_CX, M_CY, M_R + 9, meterAngle(0));
    const ft = svg("text", { x: fx, y: fy, class: "wa-scale" });
    ft.textContent = String(floor).replace("-", "−");
    w.meterTicks.appendChild(ft);
  }

  function drawMeter(view, st) {
    const w = view.wa;
    drawMeterScale(view);
    const thr = clamp01(view.value(st, "threshold"));
    const ta = meterAngle(thr);
    const [a1, b1] = polar(M_CX, M_CY, M_R + 1, ta), [a2, b2] = polar(M_CX, M_CY, M_R - 9, ta);
    w.thr.setAttribute("x1", a1); w.thr.setAttribute("y1", b1);
    w.thr.setAttribute("x2", a2); w.thr.setAttribute("y2", b2);
    const na = meterAngle(w.level);
    const [nx, ny] = polar(M_CX, M_CY, M_R - 2, na), [bx, by] = polar(M_CX, M_CY, 10, na);
    w.needle.setAttribute("x1", bx); w.needle.setAttribute("y1", by);
    w.needle.setAttribute("x2", nx); w.needle.setAttribute("y2", ny);
  }

  // ---- frequency dial -----------------------------------------------------
  const dialAngle = (v) => START + (END - START) * v;

  function drawDialScale(view) {
    const w = view.wa, r = rangeOf(view), key = r.join("-");
    if (w.dialKey === key) return;
    w.dialKey = key;
    w.dialTicks.innerHTML = "";
    const [lo, hi] = r;
    const full = hi / lo > 100;
    const labels = full ? [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : [1, 1.5, 2, 3, 5, 7, 10].map((k) => lo * k);
    // Minor ticks at every 1…9 of each decade.
    for (let dec = lo; dec < hi; dec *= 10)
      for (let k = 1; k < 10; k++) {
        const f = dec * k;
        if (f < lo || f > hi) continue;
        const a = dialAngle(dialPos(f, r));
        const [x1, y1] = polar(C, C, 47, a), [x2, y2] = polar(C, C, k === 1 ? 52 : 50, a);
        w.dialTicks.appendChild(svg("line", { x1, y1, x2, y2, class: "wa-tick" }));
      }
    for (const f of labels) {
      const a = dialAngle(dialPos(f, r));
      const [tx, ty] = polar(C, C, 58, a);
      const t = svg("text", { x: tx, y: ty, class: "wa-scale" });
      t.textContent = shortHz(Math.round(f * 10) / 10);
      w.dialTicks.appendChild(t);
    }
  }

  function drawDial(view) {
    const w = view.wa;
    drawDialScale(view);
    const v = param(view, "frequency").v;
    w.dialArc.setAttribute("d", arc(C, C, 44, START, dialAngle(v)));
    const r = rangeOf(view);
    const pos = dialPos(w.f, r), inside = pos >= 0 && pos <= 1;
    const a = dialAngle(clamp01(pos));
    const [x1, y1] = polar(C, C, 12, a), [x2, y2] = polar(C, C, 40, a);
    w.pointer.setAttribute("x1", x1); w.pointer.setAttribute("y1", y1);
    w.pointer.setAttribute("x2", x2); w.pointer.setAttribute("y2", y2);
    w.pointer.setAttribute("opacity", inside ? 1 : 0.35);
    w.readout.textContent = hzText(w.f);
  }

  // ---- plotter ------------------------------------------------------------
  function drawPlot(view) {
    const w = view.wa, c = w.canvas;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const css = getComputedStyle(view.root);
    const col = (v) => css.getPropertyValue(v).trim();
    const left = 26, bottom = ch - 13, top = 4, pw = cw - left - 2;
    const y = (m) => bottom - (bottom - top) * clamp01(m);
    const x = (f) => left + pw * (Math.log(f / PLOT_LO) / Math.log(PLOT_HI / PLOT_LO));
    const floor = FLOORS[view.units("floor")] ?? -60;
    g.font = "9px system-ui, sans-serif";
    g.lineWidth = 1;
    g.strokeStyle = col("--line");
    g.fillStyle = col("--muted");
    g.textAlign = "right"; g.textBaseline = "middle";
    for (const m of [1, 0.5, 0]) {
      g.beginPath(); g.moveTo(left, Math.round(y(m)) + 0.5); g.lineTo(cw, Math.round(y(m)) + 0.5); g.stroke();
      const d = Math.round(floor * (1 - m));
      g.fillText(d === 0 ? "0" : "−" + -d, left - 3, y(m));
    }
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    for (const f of [20, 100, 1000, 10000]) {
      g.beginPath(); g.moveTo(Math.round(x(f)) + 0.5, top); g.lineTo(Math.round(x(f)) + 0.5, bottom); g.stroke();
      g.fillText(shortHz(f), Math.min(cw - 8, Math.max(left + 6, x(f))), ch - 2);
    }
    const bw = pw / COLUMNS;
    const bars = (arr, colour, alpha) => {
      g.globalAlpha = alpha;
      g.fillStyle = colour;
      for (let k = 0; k < COLUMNS; k++) {
        const v = arr[k];
        if (v > 0.002) g.fillRect(left + k * bw, y(v), Math.max(1, bw), bottom - y(v));
      }
    };
    bars(w.prev, col("--muted"), 0.35);
    bars(w.cur, col("--accent"), 0.9);
    g.globalAlpha = 1;
    // The pen
    if (w.f > 0) {
      const px = x(Math.min(PLOT_HI, Math.max(PLOT_LO, w.f)));
      g.fillStyle = col("--text");
      g.beginPath(); g.moveTo(px, y(w.level) - 1); g.lineTo(px - 4, y(w.level) - 8); g.lineTo(px + 4, y(w.level) - 8); g.closePath(); g.fill();
    }
  }

  function draw(view, st) {
    if (!view.wa) return;
    drawMeter(view, st);
    drawDial(view);
    drawPlot(view);
    const w = view.wa, now = performance.now();
    w.lockLight.classList.toggle("on", w.locked);
    w.lockLight.classList.toggle("hunt", !w.locked && w.hunting);
    w.fastLight.classList.toggle("on", now - w.fastAt < 400);
  }

  BleepViews.register("wave-analyzer", {
    top: true,
    width: 400,
    hideParams: ["frequency"],
    template:
      "<style>" +
      ".wa{display:flex;flex-direction:column;gap:6px;flex:1 1 100%}" +
      ".wa-row{display:flex;align-items:center;justify-content:space-between;gap:6px}" +
      ".wa svg{display:block;touch-action:none}" +
      ".wa .wa-face{fill:var(--panel-3);stroke:var(--line)}" +
      ".wa .wa-track{stroke:var(--line);fill:none;stroke-width:5;stroke-linecap:round}" +
      ".wa .wa-arc{stroke:var(--accent);fill:none;stroke-width:5;stroke-linecap:round}" +
      ".wa .wa-tick{stroke:var(--muted);stroke-width:1}" +
      ".wa .wa-scale{fill:var(--muted);font:8px system-ui,sans-serif;text-anchor:middle;dominant-baseline:middle}" +
      ".wa .wa-thr{stroke:var(--warn);stroke-width:2.5}" +
      ".wa .wa-needle{stroke:var(--text);stroke-width:1.6;stroke-linecap:round}" +
      ".wa .wa-cap{fill:var(--panel-3);stroke:var(--line)}" +
      ".wa .wa-pointer{stroke:var(--text);stroke-width:3.5;stroke-linecap:round}" +
      ".wa-dial{cursor:ns-resize}" +
      ".wa-side{display:flex;flex-direction:column;gap:6px;font-size:11px;min-width:76px}" +
      ".wa-read{font-size:15px;font-variant-numeric:tabular-nums;text-align:center}" +
      ".wa-light{display:flex;align-items:center;gap:5px;color:var(--muted)}" +
      ".wa-light i{width:9px;height:9px;border-radius:50%;border:1px solid var(--line);background:var(--panel-3)}" +
      ".wa-light.on{color:var(--text)}" +
      ".wa-light.on i{background:var(--accent);border-color:var(--accent)}" +
      ".wa-light.fast.on i{background:var(--warn);border-color:var(--warn)}" +
      ".wa-light.hunt i{animation:wa-blink .5s steps(2) infinite;background:var(--accent)}" +
      "@keyframes wa-blink{50%{opacity:.15}}" +
      ".wa canvas{width:100%;height:96px;cursor:pointer}" +
      ".wa-hint{font-size:10px;color:var(--muted)}" +
      "</style>" +
      '<div class="wa"><div class="wa-row"></div>' +
      '<canvas title="Plotter: level against frequency. Click to clear."></canvas></div>',
    afterBuild(view, el) {
      const row = el.querySelector(".wa-row");
      // Needle meter
      const meter = svg("svg", { viewBox: "0 0 160 96", width: 150, height: 90 });
      meter.append(svg("rect", { class: "wa-face", x: 1, y: 1, width: 158, height: 94, rx: 6 }));
      const meterTicks = svg("g", {});
      meter.append(svg("path", { class: "wa-tick", fill: "none", d: arc(M_CX, M_CY, M_R, M_FROM, M_TO) }), meterTicks);
      const thr = svg("line", { class: "wa-thr" }), needle = svg("line", { class: "wa-needle" });
      const dB = svg("text", { x: M_CX, y: M_CY - 22, class: "wa-scale" });
      dB.textContent = "dB";
      meter.append(dB, thr, needle, svg("circle", { class: "wa-cap", cx: M_CX, cy: M_CY, r: 5 }));
      // Frequency dial
      const dial = svg("svg", { viewBox: "-8 -8 136 136", width: 124, height: 124, class: "wa-dial" });
      const dialTicks = svg("g", {});
      const dialArc = svg("path", { class: "wa-arc" });
      const pointer = svg("line", { class: "wa-pointer" });
      dial.append(dialTicks, svg("path", { class: "wa-track", d: arc(C, C, 44, START, END) }), dialArc,
                  svg("circle", { class: "wa-cap", cx: C, cy: C, r: 36 }), pointer);
      // Readout and lights
      const side = document.createElement("div");
      side.className = "wa-side";
      side.innerHTML =
        '<div class="wa-read"></div>' +
        '<div class="wa-light lock" title="Locked: the lock loop holds a partial (blinks while hunting)"><i></i>Locked</div>' +
        '<div class="wa-light fast" title="The sweep is faster than the band can follow (B²/2 Hz per second)"><i></i>Too Fast</div>' +
        '<div class="wa-hint">drag the dial · double-click resets</div>';
      row.append(meter, dial, side);
      const canvas = el.querySelector("canvas");
      view.wa = {
        canvas, meterTicks, thr, needle, dialTicks, dialArc, pointer,
        readout: side.querySelector(".wa-read"), lockLight: side.querySelector(".lock"), fastLight: side.querySelector(".fast"),
        cur: new Float32Array(COLUMNS), prev: new Float32Array(COLUMNS), pass: null,
        f: 0, level: 0, locked: false, hunting: false, fastAt: -1e9, meterFloor: null, dialKey: null,
      };
      canvas.addEventListener("click", () => {
        view.wa.cur.fill(0);
        view.wa.prev.fill(0);
        drawPlot(view);
      });

      const set = (v) => {
        v = clamp01(v);
        view.node.params.frequency = v;
        view.api.setParam("frequency", v);
        drawDial(view);
      };
      let startY = 0, startV = 0, dragging = false;
      dial.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        dial.setPointerCapture(e.pointerId);
        startY = e.clientY;
        startV = param(view, "frequency").v;
        dragging = true;
        view.api.beginGesture();
      });
      dial.addEventListener("pointermove", (e) => {
        if (dragging) set(startV + (startY - e.clientY) / (e.shiftKey ? 2400 : 300));
      });
      const end = () => (dragging = false);
      dial.addEventListener("pointerup", end);
      dial.addEventListener("pointercancel", end);
      dial.addEventListener("dblclick", () => { view.api.beginGesture(); set(param(view, "frequency").p.default); });
      dial.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        set(param(view, "frequency").v - e.deltaY / (e.shiftKey ? 6000 : 1200));
      }, { passive: false });
      view.wa.dragging = () => dragging;
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) {
      const w = view.wa;
      if (!w || !st) return;
      const ps = st.params && st.params.frequency;
      if (ps && !w.dragging()) view.node.params.frequency = ps.v;
      if (typeof st.f === "number") w.f = st.f;
      if (typeof st.level === "number") w.level = st.level;
      w.locked = !!st.locked;
      w.hunting = !!st.hunting;
      if (st.tooFast) w.fastAt = performance.now();
      // A new sweep pass: the current ink fades, a fresh pass starts.
      if (typeof st.pass === "number" && st.pass !== w.pass) {
        if (w.pass !== null) { w.prev.set(w.cur); w.cur.fill(0); }
        w.pass = st.pass;
      }
      const ink = st.arrays && st.arrays.ink;
      if (ink) for (let k = 0; k < COLUMNS && k < ink.length; k++) if (ink[k] > w.cur[k]) w.cur[k] = ink[k];
      // The pen also marks where it is now (between reads it may not have left a column).
      const k = column(w.f);
      if (k >= 0 && k < COLUMNS && w.level > w.cur[k]) w.cur[k] = w.level;
      draw(view, st);
    },
    onRefresh(view) { draw(view, null); },
  });
})();
