// SPDX-License-Identifier: GPL-3.0-or-later
// XY Scope view (doc/specs/modules/xy-scope.md §5): a phosphor screen in a dark
// round-cornered bezel, an 8 × 10 graticule engraved behind the trace, and a
// readout line (frequencies, figure ratio, φ, ρ, Still lamp).
//
// The beam: points arrive as the live array "pts" (x, y, z, s quadruples,
// before gain; s = sweep position in Y-T mode, −1 = beam off) about 30 times
// a second. They are queued and drawn at their own pace, each animation
// frame taking the points that belong to the time that passed. The screen is
// a float accumulation buffer: each frame it fades by 0.01^(Δt / Persistence),
// then the new points are drawn as a Catmull-Rom curve, four segments per
// point interval, each depositing
//
//   E = Intensity · b · Δts / max(L, s)       b = clamp(1 + z, 0, 2)
//
// per pixel along its length (L its length, s the spot, both in screen
// widths): slow parts glow, fast edges are faint. Lines are splats of a
// Gaussian spot (width 1 + 5 · (1 − Focus) px). The buffer is shown through
// 1 − e^(−k·E) in the phosphor colour, with a faint bloom; k follows the
// persistence so a still figure is equally bright at any Persistence.
// Vintage adds pincushion, corner softening, 50 Hz hum and a warm-up.
(function () {
  "use strict";
  const PHOSPHORS = [[0x4a, 0xde, 0x80], [0xfb, 0xbf, 0x24], [0xc7, 0xd2, 0xfe]];  // Green, Amber, Blue-White
  const EDGE = 0.47;          // ±1 lands on the graticule edge, which is 94 % of the screen
  const MAX_W = 480;          // accumulation buffer width cap (CSS px)
  const QUEUE = 16384;        // queued points (x, y, z, s, hum phase)
  const DOT_BUDGET = 120000;  // spot splats per frame at most
  const LUT_N = 2048, LUT_MAX = 12;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return p ? Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min)) : 0;
  };
  /// A knob's normalised value, modulated when live state says so.
  const norm = (view, st, id) => {
    if (st && st.params && st.params[id]) return view.value(st, id);
    const p = view.type.params.find((x) => x.id === id);
    return view.node.params[id] ?? (p ? p.default : 0);
  };
  /// An exponential knob's value in its units.
  const units = (view, st, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return p.min * Math.pow(p.max / p.min, clamp(norm(view, st, id), 0, 1));
  };

  // ---- tone curve -----------------------------------------------------------------------------
  /// RGB lookup for k·E in [0, LUT_MAX]: 1 − e^(−kE) in the phosphor colour, the brightest
  /// parts running towards white.
  function toneLut(rgb) {
    const lut = new Uint8ClampedArray(LUT_N * 3);
    for (let i = 0; i < LUT_N; i++) {
      const v = 1 - Math.exp(-(i / (LUT_N - 1)) * LUT_MAX), hot = Math.pow(v, 6) * 0.55;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = 255 * (v * rgb[c] / 255 * (1 - hot) + hot);
    }
    return lut;
  }

  // ---- beam -----------------------------------------------------------------------------------
  /// Adds one Gaussian spot of weight `a` at (cx, cy), sigma `sg`, into the buffer.
  function splat(sc, cx, cy, a, sg) {
    const { buf, W, H, wx, wy } = sc;
    const r = Math.ceil(2.5 * sg), x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    const k = -1 / (2 * sg * sg);
    for (let i = x0; i <= x1; i++) wx[i - x0] = Math.exp(k * (i - cx) * (i - cx));
    for (let j = y0; j <= y1; j++) wy[j - y0] = a * Math.exp(k * (j - cy) * (j - cy));
    for (let j = y0; j <= y1; j++) {
      const row = j * W, w = wy[j - y0];
      for (let i = x0; i <= x1; i++) buf[row + i] += w * wx[i - x0];
    }
  }

  /// One curve segment from A to B (buffer px), lasting dts seconds, brightness b.
  function segment(sc, ax, ay, bx, by, b, dts, f) {
    const Wg = 2 * EDGE * sc.W, Lpx = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // Focus: the spot widens towards the corners (Vintage) and while warming up.
    let width = f.width;
    if (f.vintage) {
      const u = (mx / sc.W - 0.5) / EDGE, v = (my / sc.H - 0.5) / EDGE;
      width *= 1 + 0.4 * Math.min(1, (u * u + v * v) / 2);
    }
    const sg = Math.max(0.45, width / 2.355), spotPx = Math.max(1, width);
    const E = f.intensity * b * dts / (Math.max(Lpx, spotPx) / Wg);  // per pixel along the line
    const amp = 1 / (sg * 2.5066);                                     // the line's cross profile
    const n = Math.max(1, Math.ceil(Lpx / 0.7));
    const a = E * amp * (Math.max(Lpx, spotPx) / n) / (sg * 2.5066);   // each spot's weight
    if (a * f.k < 4e-4 || sc.dots + n > DOT_BUDGET) return;
    sc.dots += n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      splat(sc, ax + (bx - ax) * t, ay + (by - ay) * t, a, sg);
    }
    sc.lit = true;
  }

  /// A trace: Catmull-Rom through its last four points.
  function trace() { return { p: [], on: false }; }
  function addPoint(sc, tr, x, y, b, f, dts) {
    const p = tr.p;
    if (!tr.on) { p.length = 0; p.push([x, y, b]); tr.on = true; }
    p.push([x, y, b]);
    if (p.length > 4) p.shift();
    if (p.length < 4) return;
    const [P0, P1, P2, P3] = p;
    let px = P1[0], py = P1[1];
    for (let s = 1; s <= 4; s++) {
      const t = s / 4, t2 = t * t, t3 = t2 * t;
      const cr = (a, b1, c, d) => 0.5 * (2 * b1 + (c - a) * t + (2 * a - 5 * b1 + 4 * c - d) * t2 + (3 * b1 - a - 3 * c + d) * t3);
      const qx = cr(P0[0], P1[0], P2[0], P3[0]), qy = cr(P0[1], P1[1], P2[1], P3[1]);
      segment(sc, px, py, qx, qy, P1[2] + (P2[2] - P1[2]) * (t - 0.125), dts / 4, f);
      px = qx; py = qy;
    }
  }

  // ---- frame ----------------------------------------------------------------------------------
  function frame(view, now) {
    const sc = view.xy;
    if (!sc) return;
    if (!view.root.isConnected) {
      if (now - sc.born > 3000) return;  // the view closed
    }
    requestAnimationFrame((t) => frame(view, t));
    if (!resize(view)) return;
    const dt = sc.last ? clamp((now - sc.last) / 1000, 0, 0.1) : 1 / 60;
    sc.last = now;
    sc.dtAvg += (dt - sc.dtAvg) * 0.1;
    const st = sc.st;
    const persist = units(view, st, "persistence"), focus = norm(view, st, "focus"), inten = norm(view, st, "intensity");
    const vintage = setting(view, "character") === 1, mode = setting(view, "mode");
    const warmT = vintage ? clamp((now - sc.born) / 2000, 0, 1) : 1, warm = warmT * warmT * (3 - 2 * warmT);
    const gx = units(view, st, "xgain"), gy = units(view, st, "ygain");

    // Fade
    const fade = Math.pow(0.01, dt / persist), buf = sc.buf;
    if (sc.lit) {
      let max = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] *= fade); if (v > max) max = v; }
      sc.lit = max * sc.k > 1e-4;
      if (!sc.lit) buf.fill(0);
    }
    // k: the same steady brightness at any persistence (accumulation time per frame)
    const fNom = Math.pow(0.01, sc.dtAvg / persist);
    sc.k = 14 * (1 - fNom) / sc.dtAvg;

    // Take the points that belong to dt, keeping about 45 ms queued (the live state
    // comes ~30 times a second).
    const rate = sc.rate || 48000, target = rate * 0.045;
    let queued = (sc.qw - sc.qr + QUEUE) % QUEUE;
    if (queued > rate * 0.15) { sc.qr = (sc.qw - Math.round(target) + QUEUE) % QUEUE; queued = Math.round(target); }
    let take = Math.round(dt * rate * clamp(1 + 0.5 * (queued - target) / target, 0.5, 2));
    take = Math.min(take, queued);

    const f = { width: (1 + 5 * (1 - focus)) * (1 + 4 * (1 - warm)), intensity: inten * warm, k: sc.k, vintage };
    const dts = 1 / rate, W = sc.W, H = sc.H, q = sc.q;
    const second = mode === 1 && view.api.isPatched && view.api.isPatched("x");
    const toPx = (x, y) => {
      if (vintage) { const x2 = x * (1 + 0.06 * y * y); y = y * (1 + 0.06 * x * x); x = x2; }
      return [W * (0.5 + EDGE * x), H * (0.5 - EDGE * y)];
    };
    sc.dots = 0;
    for (let n = 0; n < take; n++) {
      const o = sc.qr * 5;
      sc.qr = (sc.qr + 1) % QUEUE;
      const x = q[o], y = q[o + 1], b = clamp(1 + q[o + 2], 0, 2), s = q[o + 3];
      const hum = vintage ? 0.004 * Math.sin(2 * Math.PI * q[o + 4]) : 0;
      if (mode === 0) {
        const [px, py] = toPx(clamp(x * gx, -4, 4), clamp(y * gy, -4, 4) + hum);
        addPoint(sc, sc.tr[0], px, py, b, f, dts);
        continue;
      }
      if (s < 0 || s < sc.lastS) sc.tr[0].on = sc.tr[1].on = false;  // beam off, or a new sweep
      sc.lastS = s;
      if (s < 0) continue;
      const sx = -1 + 2 * s;
      const [px, py] = toPx(sx, clamp(y * gy, -4, 4) + hum);
      addPoint(sc, sc.tr[0], px, py, b, f, dts);
      if (second) {
        const [qx, qy] = toPx(sx, clamp(x * gx, -4, 4) + hum);
        addPoint(sc, sc.tr[1], qx, qy, b * 0.5, f, dts);
      }
    }
    if (mode === 0) sc.tr[1].on = false;
    draw(view);
  }

  function resize(view) {
    const sc = view.xy, c = sc.canvas;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return false;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const W = Math.min(MAX_W, Math.round(cw)), H = Math.max(1, Math.round(W * ch / cw));
    if (W !== sc.W || H !== sc.H) {
      sc.W = W; sc.H = H;
      sc.buf = new Float32Array(W * H);
      sc.wx = new Float32Array(256);
      sc.wy = new Float32Array(256);
      sc.trace.width = W; sc.trace.height = H;
      sc.img = sc.trace.getContext("2d").createImageData(W, H);
      sc.bloom.width = Math.max(1, W >> 2); sc.bloom.height = Math.max(1, H >> 2);
      sc.lit = false;
    }
    return true;
  }

  function draw(view) {
    const sc = view.xy, c = sc.canvas, g = c.getContext("2d");
    const w = c.width, h = c.height;
    const phosphor = setting(view, "phosphor"), rgb = PHOSPHORS[phosphor] || PHOSPHORS[0];
    if (sc.lutFor !== phosphor) { sc.lut = toneLut(rgb); sc.lutFor = phosphor; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = "#040806";
    g.fillRect(0, 0, w, h);
    graticule(g, w, h, rgb);
    if (!sc.lit) return;
    // Tone curve into the trace image
    const { buf, img, lut } = sc, d = img.data, kk = sc.k * (LUT_N - 1) / LUT_MAX;
    for (let i = 0, j = 0; i < buf.length; i++, j += 4) {
      const e = buf[i];
      if (e <= 0) { d[j] = d[j + 1] = d[j + 2] = 0; d[j + 3] = 255; continue; }
      const l = Math.min(LUT_N - 1, (e * kk) | 0) * 3;
      d[j] = lut[l]; d[j + 1] = lut[l + 1]; d[j + 2] = lut[l + 2]; d[j + 3] = 255;
    }
    sc.trace.getContext("2d").putImageData(img, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.imageSmoothingEnabled = true;
    g.drawImage(sc.trace, 0, 0, w, h);
    // Bloom: a quarter-size copy blown up again
    const bg = sc.bloom.getContext("2d");
    bg.clearRect(0, 0, sc.bloom.width, sc.bloom.height);
    bg.imageSmoothingEnabled = true;
    bg.drawImage(sc.trace, 0, 0, sc.bloom.width, sc.bloom.height);
    g.globalAlpha = 0.35;
    g.drawImage(sc.bloom, 0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /// 10 × 8 divisions with minor ticks on the centre lines, faintly lit by the phosphor.
  function graticule(g, w, h, rgb) {
    const x0 = w * (0.5 - EDGE), x1 = w * (0.5 + EDGE), y0 = h * (0.5 - EDGE), y1 = h * (0.5 + EDGE);
    const dx = (x1 - x0) / 10, dy = (y1 - y0) / 8, px = Math.max(1, Math.round(w / 400));
    g.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.16)`;
    g.lineWidth = px;
    g.beginPath();
    for (let i = 0; i <= 10; i++) { const x = Math.round(x0 + i * dx) + 0.5; g.moveTo(x, y0); g.lineTo(x, y1); }
    for (let j = 0; j <= 8; j++) { const y = Math.round(y0 + j * dy) + 0.5; g.moveTo(x0, y); g.lineTo(x1, y); }
    g.stroke();
    g.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.26)`;
    g.beginPath();
    const cx = Math.round((x0 + x1) / 2) + 0.5, cy = Math.round((y0 + y1) / 2) + 0.5, t = 3 * px;
    for (let i = 0; i <= 50; i++) { const x = Math.round(x0 + i * dx / 5) + 0.5; g.moveTo(x, cy - t); g.lineTo(x, cy + t); }
    for (let j = 0; j <= 40; j++) { const y = Math.round(y0 + j * dy / 5) + 0.5; g.moveTo(cx - t, y); g.lineTo(cx + t, y); }
    g.stroke();
  }

  // ---- readout --------------------------------------------------------------------------------
  const hz = (f) => (f > 0 ? (f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(f < 10 ? 2 : 1) + " Hz") : "—");
  function readout(view, st) {
    const sc = view.xy, r = sc.read;
    const fx = st.fx || 0, fy = st.fy || 0;
    r.fx.textContent = hz(fx);
    r.fy.textContent = hz(fy);
    r.ratio.textContent = (st.p || 1) + ":" + (st.q || 1);
    const deg = Math.round((st.phase || 0) * 180);
    r.phi.textContent = (deg > 0 ? "+" : deg < 0 ? "−" : "") + Math.abs(deg) + "°";
    const rho = st.rho || 0;
    r.rho.textContent = (rho < -0.005 ? "−" : "") + Math.abs(rho).toFixed(2);
    r.lamp.classList.toggle("on", !!st.still);
  }

  BleepViews.register("xy-scope", {
    partNames: ["Screen"],
    side: true,
    width: 820,
    layout: [
      { title: "Input", params: ["mode", "xgain", "ygain", "timebase", "trigger"] },
      { title: "Beam", params: ["phosphor", "persistence", "focus", "intensity", "character"] },
      { title: "Still gate", params: ["tolerance"] },
    ],
    template:
      "<style>" +
      ".xy{display:flex;flex-direction:column;gap:6px;flex:1 1 100%}" +
      ".xy-bezel{position:relative;background:linear-gradient(#1b201e,#101412);border-radius:18px;padding:10px;" +
      "box-shadow:inset 0 1px 3px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.04),0 0 32px color-mix(in srgb,var(--accent) 14%,transparent)}" +
      ".xy-bezel::after{content:'';position:absolute;left:10px;right:10px;top:10px;height:42%;border-radius:12px 12px 60% 60%/12px 12px 30% 30%;" +
      "background:linear-gradient(rgba(255,255,255,.07),transparent);pointer-events:none}" +
      ".xy canvas{display:block;width:100%;aspect-ratio:5/4;border-radius:12px;background:#040806;box-shadow:inset 0 0 22px rgba(0,0,0,.9)}" +
      ".xy-read{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;font-size:11px;" +
      "font-variant-numeric:tabular-nums;color:var(--muted)}" +
      ".xy-read b{color:var(--text);font-weight:600}" +
      ".xy-lamp{width:10px;height:10px;border-radius:50%;background:var(--panel-3);border:1px solid var(--line)}" +
      ".xy-lamp.on{background:var(--accent);border-color:var(--accent);box-shadow:0 0 6px var(--accent)}" +
      "</style>" +
      '<div class="xy"><div class="xy-bezel"><canvas></canvas></div>' +
      '<div class="xy-read"><span>X <b class="xy-fx">—</b></span><span>Y <b class="xy-fy">—</b></span>' +
      '<b class="xy-ratio">1:1</b><span>φ <b class="xy-phi">0°</b></span><span>ρ <b class="xy-rho">0.00</b></span>' +
      '<span class="xy-lamp" title="Still: high while the figure stands still"></span></div></div>',
    afterBuild(view, el) {
      const read = {
        fx: el.querySelector(".xy-fx"), fy: el.querySelector(".xy-fy"), ratio: el.querySelector(".xy-ratio"),
        phi: el.querySelector(".xy-phi"), rho: el.querySelector(".xy-rho"), lamp: el.querySelector(".xy-lamp"),
      };
      view.xy = {
        canvas: el.querySelector("canvas"), trace: document.createElement("canvas"), bloom: document.createElement("canvas"),
        read, W: 0, H: 0, buf: new Float32Array(1), lit: false, k: 100, dtAvg: 1 / 60, last: 0,
        born: performance.now(), q: new Float32Array(QUEUE * 5), qr: 0, qw: 0, rate: 0,
        tr: [trace(), trace()], lastS: -1, st: null, dots: 0,
      };
      requestAnimationFrame((t) => frame(view, t));
    },
    onState(st, view) {
      const sc = view.xy;
      if (!sc || !st) return;
      sc.st = st;
      readout(view, st);
      const a = st.arrays || {}, pts = a.pts, meta = a.meta;
      if (!pts || !meta || !pts.length) return;
      sc.rate = meta[0] || sc.rate;
      const n = pts.length >> 2, step = 50 / (sc.rate || 48000);
      for (let i = 0; i < n; i++) {
        const o = sc.qw * 5;
        sc.q[o] = pts[4 * i]; sc.q[o + 1] = pts[4 * i + 1]; sc.q[o + 2] = pts[4 * i + 2]; sc.q[o + 3] = pts[4 * i + 3];
        sc.q[o + 4] = (meta[1] + i * step) % 1;
        sc.qw = (sc.qw + 1) % QUEUE;
        if (sc.qw === sc.qr) sc.qr = (sc.qr + 1) % QUEUE;  // full: drop the oldest
      }
    },
    onRefresh() {},
  });
})();
