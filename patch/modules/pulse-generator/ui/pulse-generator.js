// SPDX-License-Identifier: MIT
// Pulse Generator view (specs/modules/pulse-generator.md §5): a front-panel
// timing diagram over one period. Sync ticks, the pulse trapezoid with its
// ringing (computed here from 4.5: a decaying sine per edge, smeared over
// slow edges), and Period, Delay and Width as dimension lines with values.
// Dragging an arrow's end edits that knob, dragging a slope Rise or Fall.
// Below: the Duty and Warming lamps, the mode, and a decade switch for Period
// (the Period knob is the vernier). Short widths and delays get a compressed
// time axis so they stay visible.
(function () {
  "use strict";
  const GRAB = 10;                       // px: how close a drag must start to a handle
  const P_MIN = 20e-6, P_MAX = 10;       // PulseGeneratorModule.cpp: Period, exponential
  const W_MIN = 1e-6, W_MAX = 5;         // Width, exponential
  const D_MAX = 10, D_CENTRE = 0.01;     // Delay, skewed (min 0)
  const F_MIN = 20, F_MAX = 20000;       // Ring Freq, exponential
  const SYNC_BEATS = [0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
  const MODES = ["Free Run", "Triggered", "Gated", "External Width"];
  const D_SKEW = Math.log(0.5) / Math.log(D_CENTRE / D_MAX);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Normalised knob ↔ units (Spec.h maps).
  const expTo = (n, lo, hi) => lo * Math.pow(hi / lo, n);
  const expFrom = (v, lo, hi) => clamp(Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo), 0, 1);
  const delayTo = (n) => (n <= 0 ? 0 : D_MAX * Math.exp(Math.log(n) / D_SKEW));
  const delayFrom = (v) => (v <= 0 ? 0 : clamp(Math.pow(v / D_MAX, D_SKEW), 0, 1));

  function fmt(s) {
    const a = Math.abs(s);
    if (a < 1e-3) return (s * 1e6).toPrecision(a < 1e-5 ? 2 : 3).replace(/\.0+$/, "") + " µs";
    if (a < 1) return (s * 1e3).toPrecision(3).replace(/\.0+$/, "") + " ms";
    return s.toPrecision(3) + " s";
  }

  /// The timing to draw, in seconds: knob values, or the module's effective
  /// ones (sync, warm-up, limits) when the view has them and no drag is on.
  function timing(view, st) {
    const v = (id) => view.value(st, id);
    const u = (id) => view.units(id);
    const q = {
      mode: u("mode"), sync: u("sync"), pct: u("units") === 1, dbl: u("double") === 1 && u("mode") !== 3,
      burst: u("burst"), comp: u("polarity") === 1,
      rise: v("rise"), fall: v("fall"), ring: v("ring"),
      fr: expTo(v("ringfreq"), F_MIN, F_MAX), damping: v("damping"),
    };
    q.knobT = expTo(v("period"), P_MIN, P_MAX);
    q.T = q.knobT;
    const live = view.pg.live;
    if (q.mode === 0 && q.sync > 0) q.T = live && live.period > 0 ? live.period : (SYNC_BEATS[q.sync] * 60) / 120;
    else if (live && live.period > 0 && !view.pg.drag) q.T = live.period;
    q.W = q.pct ? v("widthpct") * q.T : expTo(v("width"), W_MIN, W_MAX);
    q.D = q.pct ? v("delaypct") * q.T : delayTo(v("delay"));
    if (live && !view.pg.drag && !q.pct && q.mode !== 3) { q.W = live.width; q.D = live.delay; }
    if (q.mode === 3) q.T = Math.max(q.D + q.W * (1 + q.fall), 1e-6) * 1.15;  // no period: just the delayed pulse
    return q;
  }

  /// Pulse starts within the drawn window (periods −1, 0, 1).
  function pulses(q) {
    const out = [];
    const periods = q.mode === 3 ? [0] : [-1, 0, 1];
    for (const k of periods) {
      const s = k * q.T;
      if (q.dbl) out.push(s, s + q.D);
      else out.push(s + q.D);
    }
    return out;
  }

  /// Logical pulse value p(t) (max over pulses, trapezoids).
  function shapeAt(q, starts, t) {
    let p = 0;
    const tr = q.rise * q.W, tf = q.fall * q.W;
    for (const t0 of starts) {
      if (t < t0) continue;
      const r = tr > 0 ? Math.min(1, (t - t0) / tr) : 1;
      const f = tf > 0 ? 1 - clamp((t - t0 - q.W) / tf, 0, 1) : t < t0 + q.W ? 1 : 0;
      p = Math.max(p, Math.min(r, f));
    }
    return p;
  }

  /// The ring (4.5): each edge excites a unit decaying sine; a ramp edge
  /// averages it over the ramp, so slow edges ring less.
  function ringer(q) {
    const N = 200 * Math.pow(1 / 400, q.damping), Q = Math.max(0.5, (Math.PI * N) / 6.91);
    const w = 2 * Math.PI * q.fr, sig = w / (2 * Q), wd = w * Math.sqrt(Math.max(1e-4, 1 - 1 / (4 * Q * Q)));
    const gain = w / wd, den = sig * sig + wd * wd;
    const h = (x) => (x <= 0 ? 0 : gain * Math.exp(-sig * x) * Math.sin(wd * x));
    const F = (x) => (x <= 0 ? 0 : (gain * (wd - Math.exp(-sig * x) * (sig * Math.sin(wd * x) + wd * Math.cos(wd * x)))) / den);
    const edge = (t, at, d, height) => (d > 1e-7 ? (height * (F(t - at) - F(t - at - d))) / d : height * h(t - at));
    const span = 9 / sig;  // e^-9: gone
    return (starts, t) => {
      let r = 0;
      const tr = q.rise * q.W, tf = q.fall * q.W;
      for (const t0 of starts) {
        if (t < t0 || t > t0 + q.W + tf + span) continue;
        r += edge(t, t0, tr, 1) + edge(t, t0 + q.W, tf, -1);
      }
      return q.comp ? -r : r;
    };
  }

  /// Time → x: linear, or with minimum shares for short segments (when Width
  /// or Delay is under 2 % of the period), piecewise linear both ways.
  function axis(q, x0, x1) {
    const tmin = -0.04 * q.T, tmax = q.mode === 3 ? q.T : 1.1 * q.T;
    const t0 = q.dbl ? 0 : q.D, end = Math.min(t0 + q.W * (1 + q.fall), q.T);
    const compress = q.mode !== 3 && (q.W < 0.02 * q.T || (q.D > 0 && q.D < 0.02 * q.T) || (q.dbl && q.D < 0.02 * q.T));
    let tb = [tmin, tmax];
    if (compress) {
      const pts = [tmin, 0, q.D, t0, t0 + q.W, end, q.T, tmax].filter((t) => t >= tmin && t <= tmax);
      tb = [...new Set(pts.map((t) => +t.toPrecision(12)))].sort((a, b) => a - b);
    }
    const shares = [];
    for (let i = 1; i < tb.length; i++) {
      const d = (tb[i] - tb[i - 1]) / (tmax - tmin);
      shares.push(compress ? Math.max(d, d > 0 ? 0.1 : 0) : d);
    }
    const total = shares.reduce((a, b) => a + b, 0) || 1;
    const xb = [x0];
    shares.forEach((s) => xb.push(xb[xb.length - 1] + ((x1 - x0) * s) / total));
    const interp = (v, from, to) => {
      if (v <= from[0]) return to[0] + ((v - from[0]) * (to[1] - to[0])) / (from[1] - from[0] || 1);
      for (let i = 1; i < from.length; i++)
        if (v <= from[i] || i === from.length - 1) {
          const d = from[i] - from[i - 1];
          return d > 0 ? to[i - 1] + ((v - from[i - 1]) / d) * (to[i] - to[i - 1]) : to[i];
        }
      return to[to.length - 1];
    };
    return { x: (t) => interp(t, tb, xb), t: (x) => interp(x, xb, tb), tmin, tmax, tb, xb };
  }

  function draw(view, st) {
    const pg = view.pg;
    if (!pg) return;
    const c = pg.canvas;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const col = (v) => css.getPropertyValue(v).trim();
    const accent = col("--accent"), line = col("--line"), muted = col("--muted"), text = col("--text");

    const q = timing(view, st);
    const ax = pg.drag ? pg.drag.axis : axis(q, 40, w - 8);
    pg.q = q;
    pg.axis = ax;
    const starts = pulses(q), ring = ringer(q);
    const yS = 14, yD = 30, yHi = 46, yLo = 96, yW = 112, yP = 132;
    const ys = (v) => yLo - clamp(v, -0.6, 1.6) * (yLo - yHi);
    const tr = q.rise * q.W, tf = q.fall * q.W;

    g.font = "9px system-ui, sans-serif";
    g.fillStyle = muted;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText("SYNC", 4, yS);
    g.fillText("OUT", 4, (yHi + yLo) / 2);
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(40, Math.round(ys(q.comp ? 1 : 0)) + 0.5); g.lineTo(w - 8, Math.round(ys(q.comp ? 1 : 0)) + 0.5);
    g.stroke();

    // Sync ticks (period starts; External Width: the input edge) and the playhead.
    g.fillStyle = accent;
    for (const t of q.mode === 3 ? [0] : [0, q.T]) g.fillRect(Math.round(ax.x(t)), yS - 6, 2, 12);
    const live = pg.live;
    if (live && q.mode === 0 && live.pos > 0) {
      g.fillStyle = muted;
      g.beginPath();
      const px = ax.x(live.pos * q.T);
      g.moveTo(px, yS + 8); g.lineTo(px - 3, yS + 13); g.lineTo(px + 3, yS + 13); g.closePath(); g.fill();
    }

    // Ringing behind: Out = s + Ring · r, sampled several times per pixel so a
    // fast ring shows as a band.
    const sub = 6, x0 = 40, x1 = w - 8;
    if (q.ring > 0.001) {
      g.strokeStyle = text;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= (x1 - x0) * sub; i++) {
        const x = x0 + i / sub, t = ax.t(x);
        const p = shapeAt(q, starts, t), s = q.comp ? 1 - p : p;
        const y = ys(s + q.ring * ring(starts, t));
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.globalAlpha = 1;
    }
    // The trapezoids, from their corners.
    const corners = [];
    for (const t0 of starts) corners.push(t0, t0 + tr, t0 + q.W, t0 + q.W + tf);
    const ts = [ax.tmin, ax.tmax, ...corners.flatMap((t) => [t - 1e-12, t])].filter((t) => t >= ax.tmin && t <= ax.tmax).sort((a, b) => a - b);
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.beginPath();
    ts.forEach((t, i) => {
      const p = shapeAt(q, starts, t), y = ys(q.comp ? 1 - p : p);
      i ? g.lineTo(ax.x(t), y) : g.moveTo(ax.x(t), y);
    });
    g.stroke();

    // Dimension lines.
    const first = q.dbl ? 0 : q.D;
    const dims = [];
    if (q.D > 0 || q.dbl) dims.push({ id: "delay", y: yD, a: 0, b: q.D, label: (q.dbl ? "Spacing " : "Delay ") + fmt(q.D) });
    dims.push({ id: "width", y: yW, a: first, b: first + q.W, label: "Width " + fmt(q.W) });
    if (q.mode !== 3) dims.push({ id: "period", y: yP, a: 0, b: q.T, label: "Period " + fmt(q.T) + (q.mode === 0 && q.sync > 0 ? " (sync)" : "") });
    g.lineWidth = 1;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    for (const d of dims) {
      const xa = ax.x(d.a), xb = ax.x(d.b);
      g.strokeStyle = muted;
      g.beginPath();
      g.moveTo(xa, d.y); g.lineTo(xb, d.y);
      g.moveTo(xa + 0.5, d.y - 4); g.lineTo(xa + 0.5, d.y + 4);
      g.stroke();
      g.fillStyle = pg.hover === d.id || (pg.drag && pg.drag.id === d.id) ? text : accent;
      g.beginPath();
      const dir = xb >= xa ? 1 : -1;
      g.moveTo(xb, d.y); g.lineTo(xb - 6 * dir, d.y - 3.5); g.lineTo(xb - 6 * dir, d.y + 3.5); g.closePath(); g.fill();
      g.fillStyle = text;
      const lx = clamp((xa + xb) / 2, 40 + 30, w - 40);
      g.fillText(d.label, lx, d.y - 2);
    }
    // Slope handles (Rise, Fall) on the first pulse.
    pg.handles = dims.map((d) => ({ id: d.id, x: ax.x(d.b), y: d.y }));
    const yMid = ys(0.5);
    pg.handles.push({ id: "rise", x: ax.x(first + tr / 2), y: yMid }, { id: "fall", x: ax.x(first + q.W + tf / 2), y: yMid });
    for (const hd of pg.handles.slice(-2)) {
      g.fillStyle = pg.hover === hd.id || (pg.drag && pg.drag.id === hd.id) ? text : muted;
      g.beginPath(); g.arc(hd.x, hd.y, 2.5, 0, 2 * Math.PI); g.fill();
    }
    if (ax.tb.length > 2) {
      g.fillStyle = muted;
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.fillText("time axis compressed", w - 8, h - 1);
    }
    status(view, q);
  }

  function status(view, q) {
    const pg = view.pg, live = pg.live || {};
    pg.duty.classList.toggle("on", pg.dutyHeld > performance.now());
    pg.warming.classList.toggle("on", !!live.warming);
    pg.warmBox.hidden = !(q.mode === 0 && view.units("warmup") === 1);
    let m = "Mode: " + MODES[q.mode];
    if (q.mode === 1) m += " · Burst " + q.burst;
    pg.mode.textContent = m;
    // Period: the knob value, and the effective one when the 4-sample minimum (or sync) applies.
    const eff = q.mode === 0 && q.sync > 0 ? null : live.period;
    const shown = fmt(q.knobT) + (eff && Math.abs(eff - q.knobT) > 0.002 * q.knobT && !(q.mode === 0 && view.units("warmup") === 1) ? " [" + fmt(eff) + "]" : "");
    pg.period.textContent = q.mode === 3 ? "" : q.mode === 0 && q.sync > 0 ? "Period: synced" : "Period " + shown;
    pg.decade.hidden = q.mode === 3 || (q.mode === 0 && q.sync > 0);
  }

  function setKnob(view, id, n) {
    n = clamp(n, 0, 1);
    view.node.params[id] = n;
    view.api.setParam(id, n);
  }

  function attach(view, c) {
    const pg = view.pg;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const nearest = (pt) => {
      let best = null, dist = GRAB;
      for (const hd of pg.handles || []) {
        const d = Math.hypot(hd.x - pt.x, (hd.y - pt.y) * 0.6);
        if (d < dist) { dist = d; best = hd.id; }
      }
      return best;
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !pg.q) return;
      const id = nearest(at(e));
      if (!id) return;
      if (id === "period" && pg.q.mode === 0 && pg.q.sync > 0) return;  // synced: the grid sets it
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      pg.drag = { id, axis: pg.axis, q: pg.q };
    });
    c.addEventListener("pointermove", (e) => {
      const pt = at(e);
      if (!pg.drag) {
        const hv = nearest(pt);
        if (hv !== pg.hover) { pg.hover = hv; c.style.cursor = hv ? "ew-resize" : ""; draw(view, pg.st); }
        return;
      }
      const { id, axis: ax, q } = pg.drag;
      const t = ax.t(pt.x), first = q.dbl ? 0 : q.D;
      if (id === "period") setKnob(view, "period", expFrom(t, P_MIN, P_MAX));
      else if (id === "width") {
        const W = Math.max(t - first, 0);
        if (q.pct) setKnob(view, "widthpct", W / q.T);
        else setKnob(view, "width", expFrom(W, W_MIN, W_MAX));
      } else if (id === "delay") {
        const D = Math.max(t, 0);
        if (q.pct) setKnob(view, "delaypct", D / q.T);
        else setKnob(view, "delay", delayFrom(D));
      } else if (id === "rise") setKnob(view, "rise", q.W > 0 ? (2 * (t - first)) / q.W : 0);
      else if (id === "fall") setKnob(view, "fall", q.W > 0 ? (2 * (t - first - q.W)) / q.W : 0);
      draw(view, pg.st);
    });
    const end = () => {
      if (!pg.drag) return;
      pg.drag = null;
      draw(view, pg.st);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => { if (!pg.drag && pg.hover) { pg.hover = null; draw(view, pg.st); } });
  }

  BleepViews.register("pulse-generator", {
    top: true,
    width: 400,
    template:
      "<style>" +
      ".pg canvas{width:100%;height:142px;display:block;touch-action:none}" +
      ".pg-row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:11px;margin-top:4px}" +
      ".pg-lamp{display:inline-flex;align-items:center;gap:4px}" +
      ".pg-lamp i{width:9px;height:9px;border-radius:50%;border:1px solid var(--line);background:var(--panel-3)}" +
      ".pg-lamp.on i{background:var(--warn);border-color:var(--warn)}" +
      ".pg-period{font-variant-numeric:tabular-nums;color:var(--muted)}" +
      ".pg-decade{display:inline-flex;gap:2px}" +
      ".pg-decade button{font-size:10px;padding:0 5px;line-height:16px}" +
      "</style>" +
      '<div class="bv-panel pg"><h2>Timing</h2><canvas title="Drag an arrow end or a slope"></canvas>' +
      '<div class="pg-row">' +
      '<span class="pg-lamp pg-duty" title="A width was limited to the period, or pulses or edges were dropped"><i></i>Duty</span>' +
      '<span class="pg-lamp pg-warming" title="Warm-up: the period is still settling"><i></i>Warming</span>' +
      '<span class="pg-mode"></span>' +
      '<span class="pg-period"></span>' +
      '<span class="pg-decade" title="Period decade switch (the Period knob is the vernier)">' +
      '<button data-k="0.1">÷10</button><button data-k="10">×10</button></span>' +
      "</div></div>",
    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
      const warmBox = q(".pg-warming");
      view.pg = {
        canvas: q("canvas"), duty: q(".pg-duty"), warming: warmBox, warmBox, mode: q(".pg-mode"),
        period: q(".pg-period"), decade: q(".pg-decade"), live: null, st: null, dutyHeld: 0, drag: null, hover: null,
      };
      for (const b of el.querySelectorAll(".pg-decade button"))
        b.addEventListener("click", () => {
          const n = view.value(view.pg.st, "period");
          view.api.beginGesture();
          setKnob(view, "period", expFrom(expTo(n, P_MIN, P_MAX) * +b.dataset.k, P_MIN, P_MAX));
          draw(view, view.pg.st);
        });
      attach(view, view.pg.canvas);
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) {
      const pg = view.pg;
      if (!pg || !st) return;
      pg.st = st;
      if (typeof st.period === "number")
        pg.live = { period: st.period, width: st.width, delay: st.delay, pos: st.pos, warming: st.warming > 0.5 };
      if (st.duty > 0.5) pg.dutyHeld = performance.now() + 600;  // latched in the module: hold it visible
      draw(view, st);
    },
    onRefresh(view) { draw(view, view.pg && view.pg.st); },
  });
})();
