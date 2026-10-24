// SPDX-License-Identifier: GPL-3.0-only
// Scope view (doc/specs/modules/scope.md §5): a 10 × 8 graticule with up to four coloured
// traces, a trigger-level marker, two time cursors and two level cursors with a readout of
// what lies between them, and a status line (time / div, frequency, amplitude, trigger lamp).
//
// The module sends one frame per finished sweep as the live array "frame":
// [sweep seconds, write column, columns, traces, then (lowest, highest) per column per trace].
// The view keeps the latest frame and draws it every animation frame while something changed.
// One unit of signal is 2 divisions at Scale 1 ×.
(function () {
  "use strict";
  const COLOURS = ["#5eead4", "#fbbf24", "#7dd3fc", "#fb7185", "#a3e635", "#c4b5fd", "#f1f5f9", "#fb923c"];
  const DIV_X = 10, DIV_Y = 8, PER_UNIT = 2;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const param = (view, id) => view.type.params.find((x) => x.id === id);
  const norm = (view, id) => {
    const p = param(view, id);
    return view.node.params[id] ?? (p ? p.default : 0);
  };
  const choice = (view, id) => {
    const p = param(view, id);
    return Math.round(norm(view, id) * ((p ? p.steps : 2) - 1));
  };
  const linear = (view, id) => {
    const p = param(view, id);
    return p.min + norm(view, id) * (p.max - p.min);
  };
  const expo = (view, id) => {
    const p = param(view, id);
    return p.min * Math.pow(p.max / p.min, clamp(norm(view, id), 0, 1));
  };
  const fmtTime = (s) => (s >= 1 ? s.toFixed(2) + " s" : s >= 0.001 ? (s * 1e3).toPrecision(3) + " ms" : (s * 1e6).toPrecision(3) + " µs");
  const fmtHz = (f) => (f > 0 ? (f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(f < 10 ? 2 : 1) + " Hz") : "—");
  const fmtV = (v) => (v >= 0 ? "" : "−") + Math.abs(v).toFixed(3);

  function traces(view) {
    const n = Math.round(linear(view, "channels"));
    const list = [];
    for (let t = 0; t < n; t++) {
      const k = String(t + 1);
      list.push({ t, scale: expo(view, "scale" + k), pos: linear(view, "pos" + k), colour: COLOURS[choice(view, "colour" + k) % COLOURS.length] });
    }
    return list;
  }

  function geometry(w, h) {
    const l = 10, r = 10, tp = 8, b = 8;
    return { x0: l, x1: w - r, y0: tp, y1: h - b, w: w - l - r, h: h - tp - b };
  }

  function draw(view) {
    const sc = view.scope;
    if (!sc || !sc.canvas.clientWidth) return;
    const { g, w, h } = BleepView.fit(sc.canvas);
    const th = BleepView.theme(view.root);
    const geo = geometry(w, h), dx = geo.w / DIV_X, dy = geo.h / DIV_Y;
    const X = (div) => geo.x0 + div * dx, Y = (div) => geo.y0 + geo.h / 2 - div * dy;  // div: up is positive
    g.fillStyle = "#050807";
    g.fillRect(0, 0, w, h);
    // Graticule: divisions, centre lines with fine ticks.
    g.lineWidth = 1;
    g.strokeStyle = "rgba(160,200,190,0.16)";
    g.beginPath();
    for (let i = 0; i <= DIV_X; i++) { const x = Math.round(X(i)) + 0.5; g.moveTo(x, geo.y0); g.lineTo(x, geo.y1); }
    for (let j = 0; j <= DIV_Y; j++) { const y = Math.round(geo.y0 + j * dy) + 0.5; g.moveTo(geo.x0, y); g.lineTo(geo.x1, y); }
    g.stroke();
    g.strokeStyle = "rgba(160,200,190,0.34)";
    g.beginPath();
    const cy = Math.round(Y(0)) + 0.5, cx = Math.round(X(DIV_X / 2)) + 0.5;
    for (let i = 0; i <= DIV_X * 5; i++) { const x = Math.round(X(i / 5)) + 0.5; g.moveTo(x, cy - 3); g.lineTo(x, cy + 3); }
    for (let j = -DIV_Y * 5 / 2; j <= DIV_Y * 5 / 2; j++) { const y = Math.round(Y(j / 5)) + 0.5; g.moveTo(cx - 3, y); g.lineTo(cx + 3, y); }
    g.moveTo(geo.x0, cy); g.lineTo(geo.x1, cy);
    g.moveTo(cx, geo.y0); g.lineTo(cx, geo.y1);
    g.stroke();

    const list = traces(view), f = sc.frame;
    const cols = f ? f[2] : 0, ntr = f ? f[3] : 0, wc = f ? f[1] : -1;
    g.save();
    g.beginPath();
    g.rect(geo.x0, geo.y0, geo.w, geo.h);
    g.clip();
    if (f) {
      for (const tr of list) {
        if (tr.t >= ntr) continue;
        const base = 4 + tr.t * cols * 2, k = PER_UNIT * tr.scale;
        const xs = (c) => geo.x0 + ((c + 0.5) / cols) * geo.w;
        const yv = (v) => Y(tr.pos + v * k);
        g.fillStyle = tr.colour;
        g.globalAlpha = 0.28;
        g.beginPath();
        for (let c = 0; c < cols; c++) g.lineTo(xs(c), yv(f[base + c * 2 + 1]));
        for (let c = cols - 1; c >= 0; c--) g.lineTo(xs(c), yv(f[base + c * 2]));
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = tr.colour;
        g.lineWidth = 1.4;
        g.lineJoin = "round";
        BleepView.glow(g, tr.colour, 5);
        g.beginPath();
        for (let c = 0; c < cols; c++) g.lineTo(xs(c), yv((f[base + c * 2] + f[base + c * 2 + 1]) / 2));
        g.stroke();
        g.shadowBlur = 0;
      }
      if (wc >= 0) {  // a slow sweep: a dark gap travels ahead of the new data
        g.fillStyle = "rgba(5,8,7,0.8)";
        g.fillRect(geo.x0 + ((wc + 1) / cols) * geo.w, geo.y0, 14, geo.h);
      }
    }
    g.restore();

    // Trigger level marker on the left edge, in the colour of its source trace.
    const src = list[Math.min(choice(view, "source"), list.length - 1)];
    if (src && choice(view, "mode") !== 2) {
      const y = Y(src.pos + linear(view, "level") * PER_UNIT * src.scale);
      g.fillStyle = src.colour;
      g.beginPath();
      g.moveTo(geo.x0, y - 5); g.lineTo(geo.x0 + 8, y); g.lineTo(geo.x0, y + 5);
      g.fill();
      g.strokeStyle = src.colour;
      g.globalAlpha = 0.35;
      g.setLineDash([2, 5]);
      g.beginPath(); g.moveTo(geo.x0 + 8, y); g.lineTo(geo.x1, y); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    // Cursors.
    const cur = view.scope.cursors;
    if (norm(view, "cursors") > 0.5) {
      g.font = "10px system-ui, sans-serif";
      g.lineWidth = 1;
      g.strokeStyle = th.text;
      g.fillStyle = th.text;
      g.setLineDash([4, 3]);
      g.globalAlpha = 0.8;
      g.beginPath();
      for (const t of [cur.t1, cur.t2]) { const x = Math.round(X(t)) + 0.5; g.moveTo(x, geo.y0); g.lineTo(x, geo.y1); }
      for (const v of [cur.v1, cur.v2]) { const y = Math.round(Y(v)) + 0.5; g.moveTo(geo.x0, y); g.lineTo(geo.x1, y); }
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.textBaseline = "top";
      g.fillText("1", X(cur.t1) + 3, geo.y0 + 2);
      g.fillText("2", X(cur.t2) + 3, geo.y0 + 2);
    }
    sc.geo = geo;
    sc.dirty = false;
    readout(view, list);
  }

  function readout(view, list) {
    const sc = view.scope, r = sc.read, st = sc.st || {};
    const td = expo(view, "timebase") * 0.001;  // the knob is in ms
    r.tb.textContent = fmtTime(td) + " / div";
    r.f.textContent = fmtHz(st.valid ? st.freq : 0);
    r.a.textContent = (st.amp || 0).toFixed(3);
    r.lamp.classList.toggle("on", !!st.trig);
    const on = norm(view, "cursors") > 0.5, cur = sc.cursors;
    r.cur.style.display = on ? "" : "none";
    if (on) {
      const dt = Math.abs(cur.t2 - cur.t1) * td;
      const m = list[Math.min(choice(view, "measure"), list.length - 1)];
      const dv = m ? Math.abs(cur.v2 - cur.v1) / (PER_UNIT * m.scale) : 0;
      r.dt.textContent = fmtTime(dt);
      r.hz.textContent = dt > 0 ? fmtHz(1 / dt) : "—";
      r.dv.textContent = fmtV(dv);
    }
  }

  function pointer(view, e) {
    const sc = view.scope, r = sc.canvas.getBoundingClientRect(), geo = sc.geo;
    return { x: e.clientX - r.left, y: e.clientY - r.top, geo };
  }

  function attachCursors(view) {
    const sc = view.scope, c = sc.canvas;
    const hit = (p) => {
      const geo = p.geo, dx = geo.w / DIV_X, dy = geo.h / DIV_Y;
      const cur = sc.cursors, best = { d: 8, key: null };
      for (const k of ["t1", "t2"]) { const d = Math.abs(geo.x0 + cur[k] * dx - p.x); if (d < best.d) { best.d = d; best.key = k; } }
      for (const k of ["v1", "v2"]) { const d = Math.abs(geo.y0 + geo.h / 2 - cur[k] * dy - p.y); if (d < best.d) { best.d = d; best.key = k; } }
      return best.key;
    };
    c.addEventListener("pointerdown", (e) => {
      if (norm(view, "cursors") < 0.5 || !sc.geo) return;
      const key = hit(pointer(view, e));
      if (!key) return;
      sc.drag = key;
      c.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    c.addEventListener("pointermove", (e) => {
      const p = pointer(view, e);
      if (!sc.drag) { c.style.cursor = norm(view, "cursors") > 0.5 && sc.geo && hit(p) ? "grab" : ""; return; }
      const geo = p.geo, k = sc.drag;
      if (k[0] === "t") sc.cursors[k] = clamp((p.x - geo.x0) / (geo.w / DIV_X), 0, DIV_X);
      else sc.cursors[k] = clamp((geo.y0 + geo.h / 2 - p.y) / (geo.h / DIV_Y), -DIV_Y / 2, DIV_Y / 2);
      sc.dirty = true;
    });
    const end = () => {
      if (!sc.drag) return;
      sc.drag = null;
      view.api.beginGesture();
      view.node.data = { ...sc.cursors };
      view.api.setData(view.node.data);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  function loadCursors(view) {
    const d = view.node.data || {};
    const num = (v, def) => (typeof v === "number" ? v : def);
    view.scope.cursors = { t1: num(d.t1, 3), t2: num(d.t2, 7), v1: num(d.v1, 2), v2: num(d.v2, -2) };
  }

  const TRACE_PARAMS = [1, 2, 3, 4].flatMap((k) => ["scale" + k, "pos" + k, "colour" + k]);

  BleepViews.register("scope", {
    partNames: ["Screen"],
    top: true,
    width: 880,
    layout: [
      { title: "Time", params: ["timebase", "hold", "channels", "cursors"] },
      { title: "Trigger", params: ["level", "edge", "source", "mode"] },
      { title: "Traces", params: TRACE_PARAMS },
      { title: "Outputs", params: ["measure"] },
    ],
    template:
      "<style>" +
      ".sc{display:flex;flex-direction:column;gap:6px}" +
      ".sc-bezel{background:linear-gradient(#1b201e,#101412);border-radius:14px;padding:8px;" +
      "box-shadow:inset 0 1px 3px rgba(0,0,0,.6),0 0 28px color-mix(in srgb,var(--accent) 12%,transparent)}" +
      ".sc canvas{display:block;width:100%;height:300px;border-radius:8px;touch-action:none}" +
      ".sc-read{display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;font-size:11px;" +
      "font-variant-numeric:tabular-nums;color:var(--muted)}" +
      ".sc-read b{color:var(--text);font-weight:600}" +
      ".sc-lamp{width:10px;height:10px;border-radius:50%;background:var(--panel-3);border:1px solid var(--line)}" +
      ".sc-lamp.on{background:var(--accent);border-color:var(--accent);box-shadow:0 0 6px var(--accent)}" +
      "</style>" +
      '<div class="sc"><div class="sc-bezel"><canvas></canvas></div>' +
      '<div class="sc-read"><b class="sc-tb"></b><span>f <b class="sc-f">—</b></span><span>A <b class="sc-a">0.000</b></span>' +
      '<span class="sc-lamp" title="Triggered"></span>' +
      '<span class="sc-cur">Δt <b class="sc-dt"></b> · 1/Δt <b class="sc-hz"></b> · ΔV <b class="sc-dv"></b></span></div></div>',
    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
      view.scope = {
        canvas: q("canvas"), frame: null, st: null, dirty: true, drag: null, geo: null, cursors: null,
        read: { tb: q(".sc-tb"), f: q(".sc-f"), a: q(".sc-a"), lamp: q(".sc-lamp"), cur: q(".sc-cur"), dt: q(".sc-dt"), hz: q(".sc-hz"), dv: q(".sc-dv") },
      };
      loadCursors(view);
      attachCursors(view);
      BleepView.loop(view.root, () => { if (view.scope.dirty) draw(view); });
    },
    onState(st, view) {
      const sc = view.scope;
      if (!sc || !st) return;
      sc.st = st;
      const f = st.arrays && st.arrays.frame;
      if (f && f.length) sc.frame = f;
      sc.dirty = true;
    },
    onRefresh(view) {
      if (!view.scope) return;
      if (!view.scope.drag) loadCursors(view);
      view.scope.dirty = true;
    },
  });
})();
