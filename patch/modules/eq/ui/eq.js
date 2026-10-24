// SPDX-License-Identifier: GPL-3.0-only
// EQ view (doc/eq.md): the signal going in (grey) and coming out (accent) as live spectra on a log axis
// (20 Hz … 20 kHz), with the equaliser's response curve and its six band points on top. Drag a point to
// change a band's frequency and gain (hold Cmd / Ctrl: its Q, or the slope of a cut); click it to edit the
// band; the six tabs below the display select the band too. The knobs below show the selected band only
// (hook `visible`): its type, and depending on the type its gain, Q or slope. The magnifiers zoom the dB axis,
// the legend switches the in / out / curve drawings on and off (kept in localStorage), and the frequency under
// the pointer is shown at the bottom left. Live arrays from EqModule::liveArrays: spectrumIn, spectrumOut (dB),
// sampleRate. The response curve is computed here from the band params (modulation included), the same RBJ
// biquads as EqDsp.h, so it follows every control at once, with or without audio.
(function () {
  "use strict";
  const BANDS = 6;
  const TOP = 24, BOTTOM = -90;      // spectrum range in dB; the headroom above 0 keeps boosted or hot signals on screen
  const ZOOMS = [3, 6, 9, 12, 18, 24];  // the dB axis shows ±this much; 18 is the Gain knob's range
  const GRID_STEP = { 3: 1, 6: 2, 9: 3, 12: 3, 18: 6, 24: 6 };
  const PREFS = "bleep.eq.view";
  const FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const TYPES = ["Bell", "Low Shelf", "High Shelf", "Low Cut", "High Cut", "Notch", "Band Pass"];
  const SHORT = ["Bell", "Lo Shelf", "Hi Shelf", "Lo Cut", "Hi Cut", "Notch", "Band"];
  const hasGain = (t) => t <= 2;     // bell and shelves
  const isCut = (t) => t === 3 || t === 4;
  const HIT = 14;                    // px: how close a click must be to grab a point
  const xOf = (f, w) => Math.log(Math.max(f, 20) / 20) / Math.log(1000) * w;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtHz = (f) => (f >= 1000 ? f / 1000 + "k" : f + "");
  const fmtHzExact = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + " kHz" : Math.round(f) + " Hz");
  const pid = (k, f) => "b" + (k + 1) + f;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  const qModifier = (e) => (isMac ? e.metaKey : e.ctrlKey);  // Cmd on macOS, Ctrl elsewhere

  // ---- per-viewer preferences: the zoom and which drawings are shown
  function loadPrefs(view) {
    const eq = (view.eq = view.eq || {});
    eq.range = 18;
    eq.show = { in: true, out: true, curve: true };
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || "null");
      if (p && ZOOMS.includes(p.range)) eq.range = p.range;
      for (const k of ["in", "out", "curve"]) if (p && p.show && typeof p.show[k] === "boolean") eq.show[k] = p.show[k];
    } catch (e) { /* no storage: defaults */ }
  }
  function savePrefs(view) {
    try { localStorage.setItem(PREFS, JSON.stringify({ range: view.eq.range, show: view.eq.show })); } catch (e) { /* ignore */ }
  }

  // ---- the view's own state, read from the node's (normalised) params
  function norm(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return view.node.params[id] ?? (p ? p.default : 0);
  }
  const selected = (view) => clamp(Math.round(norm(view, "band") * (BANDS - 1)), 0, BANDS - 1);
  const typeOf = (view, k) => clamp(Math.round(norm(view, pid(k, "Type")) * (TYPES.length - 1)), 0, TYPES.length - 1);
  const isOn = (view, k) => norm(view, pid(k, "On")) >= 0.5;
  function set(view, id, v) {
    v = clamp(v, 0, 1);
    view.node.params[id] = v;
    view.api.setParam(id, v);
  }
  function select(view, k) {
    if (k === selected(view)) return;
    set(view, "band", k / (BANDS - 1));
    if (view.applyLayout) view.applyLayout();  // absent in a runtime older than the `visible` hook
    tabs(view);
    draw(view, view.eq && view.eq.st);
  }

  // ---- the eight tabs under the display
  function tabs(view) {
    const root = view.root.querySelector(".eq-tabs");
    if (!root) return;
    const sel = selected(view);
    root.querySelectorAll(".eq-tab").forEach((b, k) => {
      b.classList.toggle("sel", k === sel);
      b.classList.toggle("off", !isOn(view, k));
      b.querySelector(".eq-tab-type").textContent = SHORT[typeOf(view, k)];
    });
  }

  // Peaks rise at once and fall slowly, so the spectra read as a calm picture.
  function smooth(keep, name, bins) {
    const prev = keep[name];
    if (!prev || prev.length !== bins.length) return (keep[name] = Float32Array.from(bins));
    for (let i = 0; i < bins.length; i++) prev[i] = bins[i] > prev[i] ? bins[i] : prev[i] + (bins[i] - prev[i]) * 0.25;
    return prev;
  }

  function area(g, bins, w, h, colour, fillAlpha, lineWidth) {
    const y = (db) => 2 + (TOP - clamp(db, BOTTOM, TOP)) / (TOP - BOTTOM) * (h - 4);  // inset so the stroke is never cut at an edge
    const pts = [];
    for (let i = 0; i < bins.length; i++) pts.push([(i + 0.5) / bins.length * w, y(bins[i])]);
    g.beginPath();
    pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy)));
    if (fillAlpha) {
      g.save();
      g.lineTo(pts[pts.length - 1][0], h); g.lineTo(pts[0][0], h); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, colour); gr.addColorStop(1, "transparent");
      g.globalAlpha = fillAlpha; g.fillStyle = gr; g.fill();
      g.restore();
      g.beginPath();
      pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy)));
    }
    g.strokeStyle = colour; g.lineWidth = lineWidth; g.stroke();
  }

  // ---- the bands as the engine uses them: the knob, or the modulated value where a cable drives it
  const SLOPE_ORDERS = [1, 2, 3, 4, 6, 8];
  function units(view, id, v) {
    const p = view.type.params.find((x) => x.id === id);
    return p.map === "exp" ? p.min * Math.pow(p.max / p.min, v) : p.min + v * (p.max - p.min);
  }
  function eff(view, st, id) {
    const ps = st && st.params && st.params[id];
    return ps && ps.a ? ps.e : norm(view, id);
  }
  /// {type, on, order, hz, gain, q} per band.
  function bands(view, st) {
    if (!view.type.params.some((p) => p.id === pid(0, "Hz"))) return [];  // an engine older than this view
    const out = [];
    for (let k = 0; k < BANDS; k++)
      out.push({
        type: typeOf(view, k),
        on: isOn(view, k),
        order: SLOPE_ORDERS[clamp(Math.round(norm(view, pid(k, "Slope")) * 5), 0, 5)],
        hz: units(view, pid(k, "Hz"), eff(view, st, pid(k, "Hz"))),
        gain: units(view, pid(k, "Gain"), eff(view, st, pid(k, "Gain"))),
        q: units(view, pid(k, "Q"), eff(view, st, pid(k, "Q"))),
      });
    return out;
  }

  // The same RBJ "Audio EQ Cookbook" sections as EqDsp.h (type: 0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band-pass).
  function section(type, hz, gainDb, q, sr) {
    const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * Math.min(hz, 0.45 * sr) / sr;
    const cs = Math.cos(w0), alpha = Math.sin(w0) / (2 * Math.max(q, 0.05)), r = 2 * Math.sqrt(A) * alpha;
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 0: b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
      case 1:
        b0 = A * ((A + 1) - (A - 1) * cs + r); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - r);
        a0 = (A + 1) + (A - 1) * cs + r; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - r; break;
      case 2:
        b0 = A * ((A + 1) + (A - 1) * cs + r); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - r);
        a0 = (A + 1) - (A - 1) * cs + r; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - r; break;
      case 3: b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      case 4: b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      case 5: b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      default: b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function sections(b, sr) {
    if (!isCut(b.type)) return [section(b.type, b.hz, b.gain, b.q, sr)];
    const out = [], n = b.order, hp = b.type === 3;
    if (n % 2) {
      const K = Math.tan(Math.PI * Math.min(b.hz, 0.45 * sr) / sr), m = 1 / (1 + K);
      out.push(hp ? [m, -m, 0, (K - 1) * m, 0] : [K * m, K * m, 0, (K - 1) * m, 0]);
    }
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const theta = n % 2 ? (i + 1) * Math.PI / n : (2 * i + 1) * Math.PI / (2 * n);
      out.push(section(b.type, b.hz, 0, 1 / (2 * Math.cos(theta)), sr));
    }
    return out;
  }
  const active = (b) => b.on && (!hasGain(b.type) || b.gain !== 0);
  function magnitudeDb(secs, hz, sr) {
    const w = 2 * Math.PI * hz / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    let db = 0;
    for (const [b0, b1, b2, a1, a2] of secs) {
      const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
      db += 10 * Math.log10(Math.max((nr * nr + ni * ni) / Math.max(dr * dr + di * di, 1e-30), 1e-30));
    }
    return db;
  }
  /// The response in dB at `n` log-spaced frequencies from 20 Hz to 20 kHz, level included.
  function curve(view, st, bs, n, noLevel) {
    const sr = (st && st.arrays && st.arrays.sampleRate && st.arrays.sampleRate[0]) || 48000;
    const secs = bs.map((b) => (active(b) ? sections(b, sr) : null));
    const level = noLevel ? 0 : units(view, "level", eff(view, st, "level"));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const hz = 20 * Math.pow(1000, i / (n - 1));
      let db = level;
      for (const s of secs) if (s) db += magnitudeDb(s, hz, sr);
      out[i] = db;
    }
    return out;
  }

  function draw(view, st) {
    const cv = view.root.querySelector(".eq-display");
    if (!cv || !cv.clientWidth) return;
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const eq = view.eq, R = eq.range || 18, show = eq.show || { in: true, out: true, curve: true };
    const th = BleepView.theme(view.root);
    const accent = th.accent, line = th.line, muted = th.muted || th.line, text = th.text;
    const arrays = (st && st.arrays) || {};
    const yc = (db) => h / 2 - clamp(db, -R, R) / R * (h / 2 - 8);
    eq.geom = { w, h, yc, R };

    // grid: frequency decades and the curve's dB lines
    const step = GRID_STEP[R] || 6, dbs = [];
    for (let db = step; db <= R; db += step) dbs.push(-db, db);
    g.lineWidth = 1; g.strokeStyle = line; g.globalAlpha = 0.4;
    g.beginPath();
    for (const f of FREQS) { const x = Math.round(xOf(f, w)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    for (const db of dbs) { const yy = Math.round(yc(db)) + 0.5; g.moveTo(0, yy); g.lineTo(w, yy); }
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = muted; g.beginPath(); g.moveTo(0, yc(0) + 0.5); g.lineTo(w, yc(0) + 0.5); g.stroke();
    g.font = "9px system-ui, sans-serif"; g.fillStyle = muted;
    g.textAlign = "left";
    for (const f of FREQS) g.fillText(fmtHz(f), xOf(f, w) + 3, h - 3);
    g.textAlign = "left";  // the dB scale sits at the left edge, beside the zoom buttons
    const roomAtTop = yc(R - step) - yc(R) >= 16;  // the top label sits below its line: skip it when the next one is too close
    for (const db of dbs) if (db !== R || roomAtTop) g.fillText((db > 0 ? "+" : "") + db, 3, db === R ? yc(db) + 11 : yc(db) - 3);

    if (show.in && arrays.spectrumIn) area(g, smooth(eq, "in", arrays.spectrumIn), w, h, muted, 0.25, 1);
    if (show.out && arrays.spectrumOut) {
      BleepView.glow(g, accent, 10);
      area(g, smooth(eq, "out", arrays.spectrumOut), w, h, accent, 0.35, 1.5);
      g.shadowBlur = 0;
    }

    // The response curve, computed from the band params; behind it the selected band's own response (dashed
    // while the band is off, so a switched-off band can still be seen).
    const pts = bands(view, st), sel = selected(view);
    const n = Math.max(64, Math.round(w / 3));
    // Not clamped to the chart: where the response is beyond the dB axis (a cut's stopband) the line leaves the chart
    // and, clipped below, is no longer visible, instead of running along the bottom edge.
    const yu = (db) => h / 2 - clamp(db, -1000, 1000) / R * (h / 2 - 8);
    const trace = (c) => c.forEach((db, i) => { const x = i / (c.length - 1) * w; i ? g.lineTo(x, yu(db)) : g.moveTo(x, yu(db)); });
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    if (pts.length && pts[sel]) {
      const own = curve(view, st, [{ ...pts[sel], on: true }], n, true);
      g.beginPath(); trace(own); g.lineTo(w, yc(0)); g.lineTo(0, yc(0)); g.closePath();
      g.globalAlpha = pts[sel].on ? 0.14 : 0.07; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
      if (!pts[sel].on) {
        g.beginPath(); trace(own); g.strokeStyle = accent; g.lineWidth = 1; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
      }
    }
    if (show.curve && pts.length) {
      g.beginPath(); trace(curve(view, st, pts, n));
      g.strokeStyle = text; g.lineWidth = 2;
      BleepView.glow(g, text, 6);
      g.stroke();
      g.shadowBlur = 0;
    }
    g.restore();

    // Band points: each band at its frequency and gain (cuts, notch and band-pass sit on the 0 dB line).
    g.font = "bold 9px system-ui, sans-serif"; g.textAlign = "center";
    const draw1 = (k) => {
      const p = pts[k];
      if (!p || !(p.hz > 0)) return;
      const x = xOf(p.hz, w), yy = hasGain(p.type) ? yc(p.gain) : yc(0), c = accent;
      g.globalAlpha = p.on ? 1 : 0.45;
      if (p.on && hasGain(p.type) && p.gain !== 0) {
        g.strokeStyle = c; g.lineWidth = 1; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(x + 0.5, yc(0)); g.lineTo(x + 0.5, yy); g.stroke();
        g.setLineDash([]);
      }
      if (k === sel) {  // a ring around the band being edited
        g.strokeStyle = text; g.lineWidth = 2;
        g.beginPath(); g.arc(x, yy, 11, 0, Math.PI * 2); g.stroke();
      }
      g.beginPath(); g.arc(x, yy, 8, 0, Math.PI * 2);
      if (p.on) { g.fillStyle = c; g.fill(); } else { g.strokeStyle = c; g.lineWidth = 2; g.stroke(); }
      g.fillStyle = p.on ? "#000" : c;
      g.fillText(String(k + 1), x, yy + 3);
      g.globalAlpha = 1;
    };
    for (let k = 0; k < BANDS; k++) if (k !== sel) draw1(k);
    draw1(sel);  // the selected one on top
    const s = pts[sel];
    if (s && s.hz > 0) {  // a read-out beside the selected point
      const x = xOf(s.hz, w), yy = hasGain(s.type) ? yc(s.gain) : yc(0);
      const txt = fmtHzExact(s.hz) + (hasGain(s.type) ? "  " + (s.gain > 0 ? "+" : "") + s.gain.toFixed(1) + " dB" : "") +
        (isCut(s.type) ? "  " + 6 * s.order + " dB/oct" : "  Q " + s.q.toFixed(2));
      g.font = "10px system-ui, sans-serif"; g.fillStyle = text;
      g.textAlign = x > w - 190 ? "right" : "left";
      g.fillText(txt, x + (x > w - 190 ? -16 : 16), clamp(yy + (yy < 24 ? 20 : -14), 12, h - 12));
    }

    if (!arrays.spectrumIn && (show.in || show.out)) {
      g.fillStyle = muted; g.textAlign = "center"; g.font = "11px system-ui, sans-serif";
      g.fillText("Patch audio in to see the spectrum", w / 2, h / 2 - 22);
    }

    // The frequency under the pointer: a hairline and a small label at the bottom left.
    if (eq.hover != null && !eq.drag) {
      const hx = clamp(eq.hover, 0, w), hz = 20 * Math.pow(1000, hx / w), txt = fmtHzExact(hz);
      g.strokeStyle = muted; g.globalAlpha = 0.5; g.lineWidth = 1; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(Math.round(hx) + 0.5, 0); g.lineTo(Math.round(hx) + 0.5, h); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      g.font = "10px system-ui, sans-serif";
      const bw = g.measureText(txt).width + 12;
      g.fillStyle = th.panel || "#14171c"; g.strokeStyle = line;
      g.beginPath(); g.roundRect ? g.roundRect(6, h - 26, bw, 18, 4) : g.rect(6, h - 26, bw, 18);
      g.fill(); g.stroke();
      g.fillStyle = text; g.textAlign = "left"; g.fillText(txt, 12, h - 13);
    }

    // The legend switches the drawings; the magnifiers stop at the ends of the zoom list.
    for (const b of view.root.querySelectorAll(".eq-legend-btn")) {
      const k = b.dataset.s;
      b.style.color = k === "in" ? muted : k === "out" ? accent : text;
      b.style.opacity = show[k] ? 1 : 0.35;
      b.style.textDecoration = show[k] ? "none" : "line-through";
      b.setAttribute("aria-pressed", show[k] ? "true" : "false");
    }
    const zi = ZOOMS.indexOf(R);
    const zin = view.root.querySelector('.eq-zoom-btn[data-z="in"]'), zout = view.root.querySelector('.eq-zoom-btn[data-z="out"]');
    if (zin) zin.disabled = zi <= 0;
    if (zout) zout.disabled = zi >= ZOOMS.length - 1;
  }

  // ---- dragging the points
  function attach(view, cv) {
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    /// The point under (x, y): the selected band first, then the nearest within HIT px.
    function pick(x, y) {
      const geom = view.eq.geom;
      if (!geom) return -1;
      const pts = bands(view, view.eq.st), sel = selected(view);
      if (!pts.length) return -1;
      let best = -1, bestD = HIT;
      for (let k = 0; k < BANDS; k++) {
        const p = pts[k];
        if (!(p.hz > 0)) continue;
        const d = Math.hypot(xOf(p.hz, geom.w) - x, (hasGain(p.type) ? geom.yc(p.gain) : geom.yc(0)) - y) - (k === sel ? 2 : 0);
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    }
    function move(e) {
      const d = view.eq.drag, geom = view.eq.geom;
      if (!d || !geom) return;
      const { x, y } = at(e), fine = e.shiftKey ? 0.2 : 1;
      if (d.q) {
        // Cmd / Ctrl: up and down change the Q (200 px for the whole range), or the slope of a cut (one step per 30 px).
        if (isCut(typeOf(view, d.k))) set(view, pid(d.k, "Slope"), clamp(Math.round(d.s0 + (d.y0 - y) / 30), 0, 5) / 5);
        else set(view, pid(d.k, "Q"), d.q0 + (d.y0 - y) / 200 * fine);
        return draw(view, view.eq.st);
      }
      // Shift = fine: the point moves a fifth as far as the pointer.
      d.x += (x - d.lastX) * fine; d.y += (y - d.lastY) * fine; d.lastX = x; d.lastY = y;
      d.x = clamp(d.x, 0, geom.w); d.y = clamp(d.y, 0, geom.h);
      set(view, pid(d.k, "Hz"), d.x / geom.w);  // the axis is 20 Hz … 20 kHz, the same log scale as the knob
      if (hasGain(typeOf(view, d.k))) {
        const gP = view.type.params.find((p) => p.id === pid(d.k, "Gain"));
        const gain = Math.round(clamp((geom.h / 2 - d.y) / (geom.h / 2 - 8) * geom.R, gP.min, gP.max) * 10) / 10;
        set(view, pid(d.k, "Gain"), (gain - gP.min) / (gP.max - gP.min));
      }
      draw(view, view.eq.st);
    }
    cv.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const { x, y } = at(e), k = pick(x, y);
      if (k < 0) return;
      e.stopPropagation();
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      view.api.beginGesture();  // one undo step per drag
      select(view, k);
      if (!isOn(view, k)) { set(view, pid(k, "On"), 1); tabs(view); }  // grabbing a switched-off band switches it on
      const p = bands(view, view.eq.st)[k], geom = view.eq.geom, q = qModifier(e);
      view.eq.drag = { k, q, x: xOf(p.hz, geom.w), y: hasGain(p.type) ? geom.yc(p.gain) : geom.yc(0), lastX: x, lastY: y,
                       y0: y, q0: norm(view, pid(k, "Q")), s0: Math.round(norm(view, pid(k, "Slope")) * 5) };
      cv.style.cursor = q ? "ns-resize" : "grabbing";
      draw(view, view.eq.st);
    });
    cv.addEventListener("pointermove", (e) => {
      const { x, y } = at(e);
      view.eq.hover = x;
      if (view.eq.drag) { if (view.eq.drag.q) view.eq.drag.hover = x; return move(e); }
      cv.style.cursor = pick(x, y) >= 0 ? (qModifier(e) ? "ns-resize" : "grab") : "default";
      draw(view, view.eq.st);
    });
    cv.addEventListener("pointerleave", () => { if (!view.eq.drag) { view.eq.hover = null; draw(view, view.eq.st); } });
    const end = () => { view.eq.drag = null; cv.style.cursor = "default"; draw(view, view.eq.st); };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    // Double-click a point: gain back to 0 dB.
    cv.addEventListener("dblclick", (e) => {
      const { x, y } = at(e), k = pick(x, y);
      if (k < 0 || !hasGain(typeOf(view, k))) return;
      view.api.beginGesture();
      const p = view.type.params.find((q) => q.id === pid(k, "Gain"));
      set(view, p.id, p.default);
      draw(view, view.eq.st);
    });
    // Wheel over a point: the width (Q) of the band, or the slope of a cut.
    cv.addEventListener("wheel", (e) => {
      const { x, y } = at(e), k = pick(x, y);
      if (k < 0) return;
      e.preventDefault();
      e.stopPropagation();
      const type = typeOf(view, k), fine = e.shiftKey ? 0.2 : 1;
      if (isCut(type)) {
        const id = pid(k, "Slope"), steps = 5, now = Math.round(norm(view, id) * steps);
        view.api.beginGesture();
        set(view, id, clamp(now + (e.deltaY < 0 ? 1 : -1), 0, steps) / steps);
      } else {
        const id = pid(k, "Q");
        set(view, id, norm(view, id) - e.deltaY / 1500 * fine);
      }
      draw(view, view.eq.st);
    }, { passive: false });
  }

  const ICON = (minus) =>
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
    '<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4M4.3 6.5h4.4' + (minus ? "" : "M6.5 4.3v4.4") + '"/></svg>';

  BleepViews.register("eq", {
    width: 510,
    layout: [].concat(
      Array.from({ length: BANDS }, (_, k) => ({
        title: "Band " + (k + 1),
        params: ["On", "Type", "Hz", "Gain", "Q", "Slope"].map((f) => pid(k, f)),
      })),
      [{ title: "Output", params: ["level"] }]),
    hideParams: ["band"],   // chosen with the tabs and by clicking a point
    // Only the selected band's controls are shown, and of those only the ones its type uses.
    visible(item, view) {
      const m = /^b([1-6])(On|Type|Hz|Gain|Q|Slope)$/.exec(item.id);
      if (!m) return true;
      const k = +m[1] - 1;
      if (k !== selected(view)) return false;
      const t = typeOf(view, k);
      if (m[2] === "Gain") return hasGain(t);
      if (m[2] === "Q") return !isCut(t);
      if (m[2] === "Slope") return isCut(t);
      return true;
    },
    revealedBy: (id) => id === "band" || /^b[1-6]Type$/.test(id),
    top: true,
    template:
      '<div class="bv-panel"><h2>Spectrum <span class="eq-legend" style="float:right;font-weight:normal;font-size:11px">' +
      ["in", "out", "curve"].map((k) => '<button type="button" class="eq-legend-btn" data-s="' + k + '" title="Show or hide">▬ ' +
        (k === "curve" ? "EQ curve" : k) + '</button>').join(" ") + '</span></h2>' +
      '<div style="position:relative"><canvas class="eq-display" style="width:100%;height:220px;display:block;touch-action:none"></canvas>' +
      '<div class="eq-zoom" style="position:absolute;left:30px;top:4px;display:flex;gap:4px">' +
      '<button type="button" class="eq-zoom-btn" data-z="in" title="Zoom in (dB axis)" aria-label="Zoom in">' + ICON(false) + '</button>' +
      '<button type="button" class="eq-zoom-btn" data-z="out" title="Zoom out (dB axis)" aria-label="Zoom out">' + ICON(true) + '</button></div></div>' +
      '<div class="eq-tabs" role="tablist" aria-label="Band" style="display:flex;gap:4px;margin-top:6px">' +
      Array.from({ length: BANDS }, (_, k) =>
        '<button type="button" class="eq-tab" role="tab" data-band="' + k + '">' +
        '<span class="eq-tab-num">' + (k + 1) + '</span><span class="eq-tab-type"></span></button>').join("") +
      '</div>' +
      '<style>' +
      '.eq-legend-btn{background:none;border:0;padding:0 2px;font:inherit;cursor:pointer}' +
      '.eq-zoom-btn{width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'background:var(--panel);color:var(--muted);border:1px solid var(--line);border-radius:5px}' +
      '.eq-zoom-btn:hover:not(:disabled){color:var(--text)}.eq-zoom-btn:disabled{opacity:.35;cursor:default}' +
      '.eq-tab{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 2px;cursor:pointer;' +
      'background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;font:inherit;font-size:10px}' +
      '.eq-tab-num{font-weight:700;font-size:12px}.eq-tab-type{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
      '.eq-tab.off{opacity:.5}.eq-tab.sel{background:var(--accent);color:#000;border-color:var(--accent);opacity:1}.eq-tab.sel .eq-tab-type{color:#000}' +
      // The selected band's controls in one row: the settings stacked on the left, the knobs beside them, all the same width.
      '.bleep-view .bv-sec-body{display:flex;flex-direction:row;align-items:flex-start;gap:16px}' +
      '.bleep-view .bv-sec-settings{display:flex;flex-direction:column;gap:6px;width:120px}' +
      '.bleep-view .bv-sec-settings .bv-setting{width:100%;box-sizing:border-box}' +
      '.bleep-view .bv-sec-settings select,.bleep-view .bv-sec-settings .bv-toggle{width:100%;box-sizing:border-box}' +
      '.bleep-view .bv-sec-knobs{display:flex;flex-direction:row;align-items:flex-start;gap:6px}' +
      '</style></div>',
    afterBuild(view, custom) {
      loadPrefs(view);
      const cv = custom.querySelector(".eq-display");
      if (cv) attach(view, cv);
      custom.querySelectorAll(".eq-tab").forEach((b) => b.addEventListener("click", () => select(view, +b.dataset.band)));
      custom.querySelectorAll(".eq-legend-btn").forEach((b) => b.addEventListener("click", () => {
        view.eq.show[b.dataset.s] = !view.eq.show[b.dataset.s];
        savePrefs(view);
        draw(view, view.eq.st);
      }));
      custom.querySelectorAll(".eq-zoom-btn").forEach((b) => b.addEventListener("click", () => {
        const i = ZOOMS.indexOf(view.eq.range) + (b.dataset.z === "in" ? -1 : 1);
        view.eq.range = ZOOMS[clamp(i, 0, ZOOMS.length - 1)];
        savePrefs(view);
        draw(view, view.eq.st);
      }));
      tabs(view);
    },
    onState(st, view) { view.eq = view.eq || {}; view.eq.st = st; tabs(view); draw(view, st); },
    onRefresh(view) { tabs(view); draw(view, view.eq && view.eq.st); },
  });
})();
