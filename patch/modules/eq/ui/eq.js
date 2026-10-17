// SPDX-License-Identifier: MIT
// EQ view (doc/eq.md): the signal going in (grey) and coming out (accent) as live spectra on a log axis
// (20 Hz … 20 kHz), with the equaliser's response curve and its eight band points on top. Drag a point to
// change a band's frequency and gain, click it to edit the band; the eight tabs below the display select the
// band too. The knobs below show the selected band only (hook `visible`): its type, and depending on the
// type its gain, Q or slope. Live arrays from EqModule::liveArrays: spectrumIn, spectrumOut (dB), curve (dB,
// same bins), bands (hz, dB, Q, type, on, order × 8, then level).
(function () {
  "use strict";
  const BANDS = 8;
  const TOP = 0, BOTTOM = -90;       // spectrum range in dB
  const RANGE = 18;                  // response curve and band points: ±18 dB (the Gain knob's range)
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
  const colour = (k) => "hsl(" + Math.round(195 + k * 45) % 360 + " 75% 62%)";
  const pid = (k, f) => "b" + (k + 1) + f;

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
    view.applyLayout();
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
    const y = (db) => (TOP - clamp(db, BOTTOM, TOP)) / (TOP - BOTTOM) * h;
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

  /// Where each band's point sits: {hz, gain, type, on}. From the engine's live values (modulation included),
  /// except for the band being dragged, which follows the pointer at once.
  function points(view, st) {
    const live = st && st.arrays && st.arrays.bands;
    const drag = view.eq && view.eq.drag;
    const hzP = view.type.params.find((p) => p.id === pid(0, "Hz")), gP = view.type.params.find((p) => p.id === pid(0, "Gain"));
    const out = [];
    for (let k = 0; k < BANDS; k++) {
      const local = !live || (drag && drag.k === k);
      const type = typeOf(view, k);
      out.push({
        type,
        on: isOn(view, k),
        hz: local ? hzP.min * Math.pow(hzP.max / hzP.min, norm(view, pid(k, "Hz"))) : live[6 * k],
        gain: local ? gP.min + norm(view, pid(k, "Gain")) * (gP.max - gP.min) : live[6 * k + 1],
      });
    }
    return out;
  }

  function draw(view, st) {
    const cv = view.root.querySelector(".eq-display");
    if (!cv || !cv.clientWidth) return;
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const accent = th.accent, line = th.line, muted = th.muted || th.line, text = th.text;
    const arrays = (st && st.arrays) || {};
    const yc = (db) => h / 2 - clamp(db, -RANGE, RANGE) / RANGE * (h / 2 - 8);
    view.eq.geom = { w, h, yc };

    // grid: frequency decades and the curve's dB lines
    g.lineWidth = 1; g.strokeStyle = line; g.globalAlpha = 0.4;
    g.beginPath();
    for (const f of FREQS) { const x = Math.round(xOf(f, w)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    for (const db of [-12, -6, 6, 12]) { const yy = Math.round(yc(db)) + 0.5; g.moveTo(0, yy); g.lineTo(w, yy); }
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = muted; g.beginPath(); g.moveTo(0, yc(0) + 0.5); g.lineTo(w, yc(0) + 0.5); g.stroke();
    g.font = "9px system-ui, sans-serif"; g.fillStyle = muted;
    g.textAlign = "left";
    for (const f of FREQS) g.fillText(fmtHz(f), xOf(f, w) + 3, h - 3);
    g.textAlign = "right";
    for (const db of [-12, 12]) g.fillText((db > 0 ? "+" : "") + db, w - 3, yc(db) - 3);

    const keep = view.eq;
    if (arrays.spectrumIn) area(g, smooth(keep, "in", arrays.spectrumIn), w, h, muted, 0.25, 1);
    if (arrays.spectrumOut) {
      BleepView.glow(g, accent, 10);
      area(g, smooth(keep, "out", arrays.spectrumOut), w, h, accent, 0.35, 1.5);
      g.shadowBlur = 0;
    }

    // The response curve, computed by the engine from the bands it is really using.
    const curve = arrays.curve;
    if (curve) {
      g.beginPath();
      curve.forEach((db, i) => { const x = (i + 0.5) / curve.length * w; i ? g.lineTo(x, yc(db)) : g.moveTo(x, yc(db)); });
      g.strokeStyle = text; g.lineWidth = 2;
      BleepView.glow(g, text, 6);
      g.stroke();
      g.shadowBlur = 0;
    }

    // Band points: each band at its frequency and gain (cuts, notch and band-pass sit on the 0 dB line).
    const sel = selected(view), pts = points(view, st);
    g.font = "bold 9px system-ui, sans-serif"; g.textAlign = "center";
    const draw1 = (k) => {
      const p = pts[k];
      if (!(p.hz > 0)) return;
      const x = xOf(p.hz, w), yy = hasGain(p.type) ? yc(p.gain) : yc(0), c = colour(k);
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
      const txt = fmtHzExact(s.hz) + (hasGain(s.type) ? "  " + (s.gain > 0 ? "+" : "") + s.gain.toFixed(1) + " dB" : "");
      g.font = "10px system-ui, sans-serif"; g.fillStyle = text;
      g.textAlign = x > w - 130 ? "right" : "left";
      g.fillText(txt, x + (x > w - 130 ? -16 : 16), clamp(yy + (yy < 24 ? 20 : -14), 12, h - 12));
    }

    if (!arrays.spectrumIn && !arrays.curve) {
      g.fillStyle = muted; g.textAlign = "center"; g.font = "11px system-ui, sans-serif";
      g.fillText("Patch audio in to see the spectrum", w / 2, h / 2 - 22);
    }
    const label = view.root.querySelector(".eq-legend");
    if (label) label.innerHTML =
      '<span style="color:' + muted + '">▬ in</span> <span style="color:' + accent + '">▬ out</span> ' +
      '<span style="color:' + text + '">▬ EQ curve</span>';
  }

  // ---- dragging the points
  function attach(view, cv) {
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    /// The point under (x, y): the selected band first, then the nearest within HIT px.
    function pick(x, y) {
      const geom = view.eq.geom;
      if (!geom) return -1;
      const pts = points(view, view.eq.st), sel = selected(view);
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
      // Shift = fine: the point moves a fifth as far as the pointer.
      d.x += (x - d.lastX) * fine; d.y += (y - d.lastY) * fine; d.lastX = x; d.lastY = y;
      d.x = clamp(d.x, 0, geom.w); d.y = clamp(d.y, 0, geom.h);
      set(view, pid(d.k, "Hz"), d.x / geom.w);  // the axis is 20 Hz … 20 kHz, the same log scale as the knob
      if (hasGain(typeOf(view, d.k))) {
        const gP = view.type.params.find((p) => p.id === pid(d.k, "Gain"));
        const gain = Math.round(clamp((geom.h / 2 - d.y) / (geom.h / 2 - 8) * RANGE, gP.min, gP.max) * 10) / 10;
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
      const p = points(view, view.eq.st)[k], geom = view.eq.geom;
      view.eq.drag = { k, x: xOf(p.hz, geom.w), y: hasGain(p.type) ? geom.yc(p.gain) : geom.yc(0), lastX: x, lastY: y };
      cv.style.cursor = "grabbing";
    });
    cv.addEventListener("pointermove", (e) => {
      if (view.eq.drag) return move(e);
      const { x, y } = at(e);
      cv.style.cursor = pick(x, y) >= 0 ? "grab" : "default";
    });
    const end = () => { view.eq.drag = null; cv.style.cursor = "default"; };
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
    }, { passive: false });
  }

  BleepViews.register("eq", {
    width: 820,
    layout: [].concat(
      Array.from({ length: BANDS }, (_, k) => ({
        title: "Band " + (k + 1),
        params: ["On", "Type", "Hz", "Gain", "Q", "Slope"].map((f) => pid(k, f)),
      })),
      [{ title: "Output", params: ["level"] }]),
    hideParams: ["band"],   // chosen with the tabs and by clicking a point
    // Only the selected band's controls are shown, and of those only the ones its type uses.
    visible(item, view) {
      const m = /^b([1-8])(On|Type|Hz|Gain|Q|Slope)$/.exec(item.id);
      if (!m) return true;
      const k = +m[1] - 1;
      if (k !== selected(view)) return false;
      const t = typeOf(view, k);
      if (m[2] === "Gain") return hasGain(t);
      if (m[2] === "Q") return !isCut(t);
      if (m[2] === "Slope") return isCut(t);
      return true;
    },
    revealedBy: (id) => id === "band" || /^b[1-8]Type$/.test(id),
    top: true,
    template:
      '<div class="bv-panel"><h2>Spectrum <span class="eq-legend" style="float:right;font-weight:normal;font-size:11px"></span></h2>' +
      '<canvas class="eq-display" style="width:100%;height:220px;display:block;touch-action:none"></canvas>' +
      '<div class="eq-tabs" role="tablist" aria-label="Band" style="display:flex;gap:4px;margin-top:6px">' +
      Array.from({ length: BANDS }, (_, k) =>
        '<button type="button" class="eq-tab" role="tab" data-band="' + k + '" style="--band:' + colour(k) + '">' +
        '<span class="eq-tab-num">' + (k + 1) + '</span><span class="eq-tab-type"></span></button>').join("") +
      '</div>' +
      '<style>' +
      '.eq-tab{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 2px;cursor:pointer;' +
      'background:var(--panel);color:var(--text);border:1px solid var(--line);border-bottom:3px solid var(--band);border-radius:6px;font:inherit;font-size:10px}' +
      '.eq-tab-num{font-weight:700;font-size:12px}.eq-tab-type{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
      '.eq-tab.off{opacity:.5}.eq-tab.sel{background:var(--band);color:#000;border-color:var(--band)}.eq-tab.sel .eq-tab-type{color:#000}' +
      '</style></div>',
    afterBuild(view, custom) {
      view.eq = view.eq || {};
      const cv = custom.querySelector(".eq-display");
      if (cv) attach(view, cv);
      custom.querySelectorAll(".eq-tab").forEach((b) => b.addEventListener("click", () => select(view, +b.dataset.band)));
      tabs(view);
    },
    onState(st, view) { view.eq = view.eq || {}; view.eq.st = st; tabs(view); draw(view, st); },
    onRefresh(view) { tabs(view); draw(view, view.eq && view.eq.st); },
  });
})();
