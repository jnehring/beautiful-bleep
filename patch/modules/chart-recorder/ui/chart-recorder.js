// SPDX-License-Identifier: GPL-3.0-or-later
// Chart Recorder view (doc/specs/modules/chart-recorder.md §5): graph paper that
// scrolls right to left under a fixed pen carriage, red ink, marks as
// triangles on the top edge, the replay head as a thin line, and an overview
// of the whole loop below. A status line shows the time, the detector and
// length, and the record state.
//
// Editing: drag on the paper to draw ink (straight lines between mouse
// events), Shift-drag for one straight segment, right-drag to erase,
// Alt-click to add or remove a mark. Each drag is one undo step.
//
// The strip arrives as live arrays: "strip" (every point, −2 = blank) after
// a load, clear or resize, else "ink" ([index, value, …] written since the
// last read), and "marks". The node data ({v, n, pcm16, marks}) is only
// decoded until the first live strip arrives.
(function () {
  "use strict";
  const BLANK = -32768;
  const INK = "#e5484d";
  const DETECTORS = ["DC", "Rectified", "RMS", "Peak", "Log dB"];
  const RANGES = [10, 25, 50, 75];
  const FREE = [1, 2, 5, 10, 30, 60, 120, 300, 600];
  const BARS = [1, 2, 4, 8, 16, 32, 64];
  const STATES = ["", "ARMED", "WRITING", "DONE"];
  const CARRIAGE = 0.85;  // the pen's place across the paper
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mod = (k, n) => ((k % n) + n) % n;
  const quant = (u) => Math.round(clamp(u, -1, 1) * 32767);
  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return p ? Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min)) : 0;
  };

  // ---- node data ------------------------------------------------------------------------------
  function decode(data) {
    const d = data && typeof data === "object" ? data : {};
    const n = clamp(Number.isInteger(d.n) ? d.n : 1600, 16, 24000);
    const pts = new Int16Array(n).fill(BLANK);
    try {
      const bin = atob(typeof d.pcm16 === "string" ? d.pcm16 : "");
      const bytes = Math.min(bin.length >> 1, n);
      for (let k = 0; k < bytes; k++) {
        const v = bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8);
        pts[k] = v >= 32768 ? v - 65536 : v;
      }
    } catch (e) { /* broken base64: blank paper */ }
    const marks = Array.isArray(d.marks) ? d.marks.filter((m) => Number.isInteger(m) && m >= 0 && m < n) : [];
    return { pts, marks };
  }
  function encode(pts) {
    let bin = "";
    for (let k = 0; k < pts.length; k += 4096) {
      const chunk = [];
      for (let i = k; i < Math.min(pts.length, k + 4096); i++) chunk.push(pts[i] & 0xff, (pts[i] >> 8) & 0xff);
      bin += String.fromCharCode.apply(null, chunk);
    }
    return btoa(bin);
  }
  const dataKey = (d) => (d && typeof d === "object" ? String(d.pcm16) + "|" + JSON.stringify(d.marks) : "");
  /// One undo step: the edited strip into the node data.
  function save(view) {
    const cr = view.cr;
    const d = { v: 1, n: cr.pts.length, pcm16: encode(cr.pts), marks: cr.marks.slice() };
    view.api.beginGesture();
    view.node.data = d;
    cr.dataKey = dataKey(d);
    view.api.setData(JSON.parse(JSON.stringify(d)));
  }

  // ---- geometry -------------------------------------------------------------------------------
  /// The paper's mapping: point index (unwrapped) ↔ x, paper units ↔ y.
  function geometry(view, w, h) {
    const cr = view.cr, n = cr.pts.length;
    const head = (cr.drag ? cr.drag.p : cr.live.p) * n;
    const cx = w * CARRIAGE, ppp = w / n, top = 12, bottom = h - 4;
    return {
      n, head, cx, ppp, top, bottom,
      x: (kk) => cx - (head - kk) * ppp,
      k: (x) => head - (cx - x) / ppp,
      y: (u) => top + (1 - (u + 1) / 2) * (bottom - top),
      u: (y) => clamp(1 - (2 * (y - top)) / (bottom - top), -1, 1),
      /// x of point k, placed in the window [head − 0.85 n, head + 0.15 n).
      xOf(k) {
        let kk = k;
        while (kk < head - CARRIAGE * n) kk += n;
        while (kk >= head + (1 - CARRIAGE) * n) kk -= n;
        return cx - (head - kk) * ppp;
      },
    };
  }
  function canvas2d(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w) return null;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  /// Paper units → the scale's text: values, or dB for the Log detector.
  function scaleLines(view) {
    const det = setting(view, "detector");
    if (det === 4) {
      const r = RANGES[setting(view, "logrange")] || 50;
      return [0, 0.25, 0.5, 0.75, 1].map((f) => [1 - 2 * f, f ? "−" + Math.round(r * f) : "0 dB"]);
    }
    if (det === 0) return [[1, "1"], [0.5, ".5"], [0, "0"], [-0.5, "−.5"], [-1, "−1"]];
    return [[1, "1"], [0.5, ".75"], [0, ".5"], [-0.5, ".25"], [-1, "0"]];
  }
  /// Grid spacing along the paper in points: bars, or a round number of seconds.
  function timeGrid(view, n, ppp) {
    const seconds = view.cr.live.seconds || 1, perSecond = n / seconds;
    if (setting(view, "paper") === 1) {
      const bars = BARS[setting(view, "lengthbars")] || 4;
      let every = 1;
      while ((n / bars) * every * ppp < 36 && every < bars) every *= 2;
      return { step: (n / bars) * every, label: (i) => String(1 + i * every) };
    }
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const s = steps.find((x) => x * perSecond * ppp >= 36) || 120;
    return { step: s * perSecond, label: (i) => fmt(i * s) };
  }

  // ---- drawing --------------------------------------------------------------------------------
  function draw(view) {
    const cr = view.cr;
    if (!cr) return;
    drawPaper(view);
    drawOverview(view);
    const live = cr.live, det = setting(view, "detector");
    const length = setting(view, "paper") === 1 ? BARS[setting(view, "lengthbars")] + " bars" : (() => {
      const s = FREE[setting(view, "lengthfree")] || 10;
      return s < 60 ? s + " s" : s / 60 + " min";
    })();
    cr.time.textContent = fmt((live.p || 0) * (live.seconds || 0)) + " / " + fmt(live.seconds || 0);
    cr.info.textContent = "Detector " + DETECTORS[det] + (det === 4 ? " · " + RANGES[setting(view, "logrange")] + " dB" : "") + " · " + length;
    const state = STATES[live.rec | 0] || "";
    cr.state.textContent = (live.writing ? "● WRITING" : state && state !== "WRITING" ? state : "") + (live.held ? "  HELD" : "");
    cr.state.classList.toggle("on", !!live.writing);
    const hold = view.root.querySelector('.bv-button[data-command="hold"]');
    if (hold) hold.classList.toggle("on", !!live.held);
    const arm = view.root.querySelector('.bv-button[data-command="arm"]');
    if (arm) arm.classList.toggle("on", (live.rec | 0) === 1);
  }

  function drawPaper(view) {
    const cr = view.cr, c = canvas2d(cr.paper);
    if (!c) return;
    const { g, w, h } = c;
    const css = getComputedStyle(view.root);
    const line = css.getPropertyValue("--line").trim(), muted = css.getPropertyValue("--muted").trim();
    const text = css.getPropertyValue("--text").trim(), paper = css.getPropertyValue("--panel-3").trim();
    const G = geometry(view, w, h), n = G.n;
    g.fillStyle = paper;
    g.fillRect(0, G.top, w, G.bottom - G.top);
    // value scale
    g.font = "9px system-ui, sans-serif";
    g.lineWidth = 1;
    for (const [u, label] of scaleLines(view)) {
      g.strokeStyle = line;
      g.globalAlpha = u === 0 ? 0.9 : 0.5;
      g.beginPath();
      g.moveTo(0, Math.round(G.y(u)) + 0.5);
      g.lineTo(w, Math.round(G.y(u)) + 0.5);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = muted;
      g.textBaseline = u > 0.9 ? "top" : u < -0.9 ? "bottom" : "middle";
      g.fillText(label, 3, G.y(u) + (u > 0.9 ? 1 : u < -0.9 ? -1 : 0));
    }
    // time grid, scrolling with the paper
    const grid = timeGrid(view, n, G.ppp);
    g.textBaseline = "bottom";
    for (let i = 0; i * grid.step < n - 0.5; i++) {
      const x = Math.round(G.xOf(i * grid.step)) + 0.5;
      g.strokeStyle = line;
      g.setLineDash(i ? [2, 3] : []);
      g.beginPath();
      g.moveTo(x, G.top);
      g.lineTo(x, G.bottom);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = muted;
      g.fillText(grid.label(i), x + 2, G.bottom - 1);
    }
    // ink: in display order, broken at blanks
    const start = Math.ceil(G.head - CARRIAGE * n);
    g.strokeStyle = INK;
    g.lineWidth = 1.6;
    BleepView.glow(g, INK, 6);
    g.beginPath();
    let pen = false;
    for (let kk = start; kk < start + n; kk++) {
      const v = cr.pts[mod(kk, n)];
      if (v === BLANK) { pen = false; continue; }
      const x = G.x(kk + 0.5), y = G.y(v / 32767);
      if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
    }
    g.stroke(); g.shadowBlur = 0;
    // marks on the top edge
    g.fillStyle = text;
    for (const m of cr.marks) {
      const x = G.xOf(m + 0.5);
      g.beginPath();
      g.moveTo(x - 4, 1);
      g.lineTo(x + 4, 1);
      g.lineTo(x, G.top - 2);
      g.fill();
    }
    // replay head
    const rx = Math.round(G.xOf((cr.live.q || 0) * n)) + 0.5;
    g.strokeStyle = text;
    g.globalAlpha = 0.8;
    g.beginPath();
    g.moveTo(rx, G.top);
    g.lineTo(rx, G.bottom);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = muted;
    g.textBaseline = "top";
    g.fillText("replay", rx + 3, G.top + 2);
    // carriage and pen: lowered (filled) while writing, lifted (hollow) otherwise
    const cx = Math.round(G.cx) + 0.5, py = G.y(clamp(cr.live.u || 0, -1.05, 1.05));
    g.strokeStyle = muted;
    g.setLineDash([1, 2]);
    g.beginPath();
    g.moveTo(cx, G.top);
    g.lineTo(cx, G.bottom);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = text;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - 9, py);
    g.lineTo(cx + 9, py);
    g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, py, cr.live.writing ? 3.5 : 4.5, 0, 2 * Math.PI);
    if (cr.live.writing) { g.fillStyle = INK; g.fill(); } else g.stroke();
  }

  function drawOverview(view) {
    const cr = view.cr, c = canvas2d(cr.overview);
    if (!c) return;
    const { g, w, h } = c;
    const css = getComputedStyle(view.root);
    const text = css.getPropertyValue("--text").trim(), paper = css.getPropertyValue("--panel-3").trim();
    const n = cr.pts.length, y = (v) => 2 + (1 - (v / 32767 + 1) / 2) * (h - 4);
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);
    // min/max per pixel column
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < w; x++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = Math.floor((x * n) / w); k < Math.max(Math.floor(((x + 1) * n) / w), Math.floor((x * n) / w) + 1) && k < n; k++) {
        const v = cr.pts[k];
        if (v === BLANK) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      if (lo > hi) continue;
      g.moveTo(x + 0.5, y(hi) - 0.5);
      g.lineTo(x + 0.5, y(lo) + 0.5);
    }
    g.stroke();
    g.fillStyle = text;
    for (const m of cr.marks) g.fillRect(Math.round(((m + 0.5) / n) * w), 0, 1, 4);
    const px = Math.round((cr.live.p || 0) * w) + 0.5, qx = Math.round((cr.live.q || 0) * w) + 0.5;
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, h);
    g.stroke();
    g.strokeStyle = text;
    g.beginPath();
    g.moveTo(qx, 0);
    g.lineTo(qx, h);
    g.stroke();
  }

  // ---- editing --------------------------------------------------------------------------------
  /// Ink (or blank) along a straight line between two unwrapped indices.
  function line(pts, k0, u0, k1, u1, erase) {
    const n = pts.length, a = Math.floor(Math.min(k0, k1)), b = Math.floor(Math.max(k0, k1));
    for (let k = a; k <= b && k - a < n; k++) {
      const t = k1 === k0 ? 1 : clamp((k + 0.5 - k0) / (k1 - k0), 0, 1);
      pts[mod(k, n)] = erase ? BLANK : quant(u0 + (u1 - u0) * t);
    }
  }
  function attachEditing(view) {
    const cr = view.cr, c = cr.paper;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const r = c.getBoundingClientRect(), G = geometry(view, r.width, r.height);
      const kk = G.k(e.clientX - r.left), u = G.u(e.clientY - r.top);
      if (e.button === 0 && e.altKey) {  // add or remove a mark
        const k = mod(Math.floor(kk), G.n), near = cr.marks.findIndex((m) => Math.abs(G.xOf(m + 0.5) - G.xOf(k + 0.5)) <= 4);
        if (near >= 0) cr.marks.splice(near, 1);
        else if (cr.marks.length < 256) cr.marks.push(k);
        save(view);
        draw(view);
        return;
      }
      c.setPointerCapture(e.pointerId);
      cr.drag = { p: cr.live.p || 0, erase: e.button === 2, segment: e.shiftKey && e.button === 0,
                  k0: kk, u0: u, k: kk, u, before: cr.pts.slice() };
      line(cr.pts, kk, u, kk, u, cr.drag.erase);
      draw(view);
    });
    c.addEventListener("pointermove", (e) => {
      const d = cr.drag;
      if (!d) return;
      const r = c.getBoundingClientRect(), G = geometry(view, r.width, r.height);
      const kk = clamp(G.k(e.clientX - r.left), G.head - CARRIAGE * G.n, G.head + (1 - CARRIAGE) * G.n - 1e-6);
      const u = G.u(e.clientY - r.top);
      if (d.segment) {
        cr.pts.set(d.before);
        line(cr.pts, d.k0, d.u0, kk, u, false);
      } else {
        line(cr.pts, d.k, d.u, kk, u, d.erase);
        d.k = kk;
        d.u = u;
      }
      draw(view);
    });
    const end = () => {
      if (!cr.drag) return;
      cr.drag = null;
      save(view);
      draw(view);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  // ---- live state -----------------------------------------------------------------------------
  function adopt(view, st) {
    const cr = view.cr, a = st.arrays || {};
    for (const k of ["p", "q", "u", "rec", "writing", "held", "seconds"]) if (typeof st[k] === "number") cr.live[k] = st[k];
    if (cr.drag) return;  // the drawing wins until it is saved; the module then sends the strip
    if (a.strip) {
      const pts = new Int16Array(a.strip.length);
      for (let k = 0; k < pts.length; k++) pts[k] = a.strip[k] < -1.5 ? BLANK : quant(a.strip[k]);
      cr.pts = pts;
      cr.synced = true;
    } else if (typeof st.n === "number" && st.n !== cr.pts.length && !cr.asked) {
      cr.asked = true;  // sizes differ: ask for the whole strip once
      view.api.command("sync", 1);
    }
    if (a.ink && cr.synced) {
      for (let i = 0; i + 1 < a.ink.length; i += 2) {
        const k = a.ink[i] | 0;
        if (k >= 0 && k < cr.pts.length) cr.pts[k] = a.ink[i + 1] < -1.5 ? BLANK : quant(a.ink[i + 1]);
      }
    }
    if (a.strip || a.ink) cr.asked = false;
    if (a.marks) cr.marks = a.marks.map((m) => m | 0).filter((m) => m < cr.pts.length);
  }

  const STYLE = `
    .cr { display: flex; flex-direction: column; gap: 4px; flex: 1 1 100%; }
    .cr canvas { width: 100%; display: block; border-radius: 4px; touch-action: none; }
    .cr-paper { height: 120px; cursor: crosshair; }
    .cr-overview { height: 30px; }
    .cr-status { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--muted);
      font-variant-numeric: tabular-nums; }
    .cr-state { min-width: 6.5em; text-align: right; }
    .cr-state.on { color: ${INK}; font-weight: 600; }
    .bv-button.on { border-color: var(--accent); background: var(--accent); color: var(--panel); }`;

  BleepViews.register("chart-recorder", {
    partNames: ["Chart"],
    top: true,
    width: 1040,
    layout: [
      { title: "Input", params: ["detector", "logrange", "gain", "offset"] },
      { title: "Pen", params: ["response", "writingspeed", "damping", "friction"] },
      { title: "Paper", params: ["paper", "lengthfree", "lengthbars", "paperspeed", "record"] },
      { title: "Replay", params: ["replaysync", "replayspeed", "interp"] },
    ],
    template: `<div class="cr">
      <canvas class="cr-paper" title="Drag: draw ink · Shift-drag: one straight segment · Right-drag: erase · Alt-click: add or remove a mark"></canvas>
      <canvas class="cr-overview" title="The whole loop: write head (red) and replay head"></canvas>
      <div class="cr-status"><span class="cr-time"></span><span class="cr-info"></span><span class="cr-state"></span></div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("cr-style")) {
        const s = document.createElement("style");
        s.id = "cr-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const { pts, marks } = decode(view.node.data);
      view.cr = {
        paper: el.querySelector(".cr-paper"), overview: el.querySelector(".cr-overview"),
        time: el.querySelector(".cr-time"), info: el.querySelector(".cr-info"), state: el.querySelector(".cr-state"),
        pts, marks, synced: false, asked: true, drag: null, dataKey: dataKey(view.node.data),
        live: { p: 0, q: 0, u: 0, rec: 0, writing: 0, held: 0, seconds: 8 },
      };
      attachEditing(view);
      view.api.command("sync", 1);  // the module sends the whole strip with the next live state
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.cr || !st) return;
      adopt(view, st);
      draw(view);
    },
    onRefresh(view) {
      if (!view.cr) return;
      const key = dataKey(view.node.data);
      if (key !== view.cr.dataKey) {  // undo or a snapshot: take the module's strip
        view.cr.dataKey = key;
        view.api.command("sync", 1);
      }
      draw(view);
    },
  });
})();
