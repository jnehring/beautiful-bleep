// SPDX-License-Identifier: MIT
// Shape Env view (specs/modules/shape-envelope.md §5): the preview of the
// current (morphed, skewed) shape with its sustain point and the live phase,
// a browser of thumbnails grouped by family (hover previews, click selects,
// ←/→ step), and a drawing editor for the eight user slots, which live in
// the node's data ({user: [8 × null | {points[64], sustain, kind, bipolar}]}).
(function () {
  "use strict";
  const SHAPES = 104, FACTORY = 96, THUMB = 48, POINTS = 64;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round3 = (v) => Math.round(v * 1000) / 1000;

  function shapeParam(view) { return view.type.params.find((x) => x.id === "shape"); }
  function shapeIndex(view) {
    const p = shapeParam(view);
    return Math.round((view.node.params.shape ?? p.default) * (SHAPES - 1));
  }
  function setShape(view, i) {
    i = ((i % SHAPES) + SHAPES) % SHAPES;
    view.api.beginGesture();
    view.node.params.shape = i / (SHAPES - 1);
    view.api.setParam("shape", view.node.params.shape);
    const k = view.knobs.get("shape");
    if (k) k.draw();
    render(view);
  }
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.user)) d = view.node.data = { user: [] };
    while (d.user.length < 8) d.user.push(null);
    return d;
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  /// Resamples n values to m (linear).
  function resample(v, m) {
    const out = [];
    for (let i = 0; i < m; i++) {
      const x = (i * (v.length - 1)) / (m - 1), k = Math.min(Math.floor(x), v.length - 2), t = x - k;
      out.push(v.length === 1 ? v[0] : v[k] + t * (v[k + 1] - v[k]));
    }
    return out;
  }

  // ---- drawing helpers ----------------------------------------------------------------------
  function canvas2d(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w) return null;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function curve(g, values, w, y) {
    g.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * w;
      i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v));
    });
    g.stroke();
  }

  function render(view) {
    const se = view.se;
    if (!se) return;
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#fda4af";
    const line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text"), muted = css.getPropertyValue("--muted");
    const cur = shapeIndex(view), p = shapeParam(view);
    const st = se.state || {};
    // Title: family · name ──► next, with Morph.
    const morph = view.value(se.state, "morph");
    const name = (i) => (p.groups ? p.groups[i] + " · " : "") + p.choices[i];
    se.title.textContent = name(cur) + (morph > 0.005 ? "  ──►  " + name((cur + 1) % SHAPES) + "   Morph " + Math.round(morph * 100) + " %" : "");

    const c = canvas2d(se.canvas);
    if (!c) return;
    const { g, w, h } = c;
    const slot = cur - FACTORY;
    if (se.draw && slot >= 0) {
      // ---- editor: the slot's 64 points
      const d = data(view), u = d.user[slot];
      const bip = u ? u.bipolar : false;
      const y = (v) => (bip ? h / 2 - v * (h / 2 - 4) : h - 4 - v * (h - 8));
      g.strokeStyle = line;
      g.lineWidth = 1;
      const steps = se.grid || 8;
      g.beginPath();
      for (let i = 1; i < steps; i++) { const x = Math.round((i / steps) * w) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
      g.moveTo(0, Math.round(y(0)) + 0.5); g.lineTo(w, Math.round(y(0)) + 0.5);
      g.stroke();
      if (u) {
        g.strokeStyle = accent;
        g.lineWidth = 2;
        curve(g, u.points, w, y);
        if (typeof u.sustain === "number") {
          g.strokeStyle = text;
          g.setLineDash([3, 3]);
          g.beginPath(); g.moveTo(u.sustain * w, 0); g.lineTo(u.sustain * w, h); g.stroke();
          g.setLineDash([]);
        }
      } else {
        g.fillStyle = muted;
        g.font = "11px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText("Empty slot: draw a shape", w / 2, h / 2);
      }
    } else {
      // ---- preview (or the hovered thumbnail)
      let values = st.arrays && st.arrays.preview, bip = !!st.bipolar, sustain = st.sustain;
      if (se.hover !== null && se.thumbs) {
        values = Array.from(se.thumbs.slice(se.hover * THUMB, (se.hover + 1) * THUMB));
        bip = values.some((v) => v < -0.001);
        sustain = -1;
      }
      const y = (v) => (bip ? h / 2 - v * (h / 2 - 4) : h - 4 - v * (h - 8));
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, Math.round(y(0)) + 0.5); g.lineTo(w, Math.round(y(0)) + 0.5); g.stroke();
      if (!values) return;
      g.strokeStyle = accent;
      g.lineWidth = 2;
      curve(g, values, w, y);
      if (typeof sustain === "number" && sustain >= 0) {
        g.strokeStyle = text;
        g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(sustain * w, 0); g.lineTo(sustain * w, h); g.stroke();
        g.setLineDash([]);
      }
      if (se.hover === null && typeof st.phase === "number" && (st.phase > 0 || st.holding)) {
        const x = clamp(st.phase, 0, 1), i = x * (values.length - 1), k = Math.min(Math.floor(i), values.length - 2);
        const v = values[k] + (i - k) * (values[k + 1] - values[k]);
        g.fillStyle = text;
        g.beginPath(); g.arc(x * w, y(v), st.holding ? 4.5 : 3.5, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // ---- browser ---------------------------------------------------------------------------
  function buildBrowser(view) {
    const se = view.se, p = shapeParam(view);
    se.browser.innerHTML = "";
    se.thumbCanvases = [];
    let group = null, row = null;
    for (let i = 0; i < SHAPES; i++) {
      const fam = p.groups ? p.groups[i] : "";
      if (fam !== group) {
        group = fam;
        const head = document.createElement("div");
        head.className = "bv-label";
        head.textContent = fam;
        head.style.margin = "6px 0 2px";
        row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:repeat(8,1fr);gap:3px";
        se.browser.append(head, row);
      }
      const cv = document.createElement("canvas");
      cv.title = p.choices[i];
      cv.style.cssText = "width:100%;height:26px;border:1px solid var(--line);border-radius:3px;cursor:pointer";
      cv.addEventListener("pointerenter", () => { se.hover = i; render(view); });
      cv.addEventListener("pointerleave", () => { if (se.hover === i) { se.hover = null; render(view); } });
      cv.addEventListener("click", () => { se.hover = null; setShape(view, i); drawThumbs(view); });
      row.appendChild(cv);
      se.thumbCanvases.push(cv);
    }
    drawThumbs(view);
  }
  function drawThumbs(view) {
    const se = view.se;
    if (!se.thumbCanvases || !se.thumbs) return;
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#fda4af";
    const cur = shapeIndex(view);
    se.thumbCanvases.forEach((cv, i) => {
      const c = canvas2d(cv);
      if (!c) return;
      const { g, w, h } = c;
      const vals = Array.from(se.thumbs.slice(i * THUMB, (i + 1) * THUMB));
      const bip = vals.some((v) => v < -0.001);
      cv.style.background = i === cur ? "var(--line)" : "";
      g.strokeStyle = accent;
      g.lineWidth = 1.2;
      curve(g, vals, w, (v) => (bip ? h / 2 - v * (h / 2 - 2) : h - 2 - v * (h - 4)));
    });
  }

  // ---- editor ------------------------------------------------------------------------------
  function attachEditor(view) {
    const se = view.se, c = se.canvas;
    let drag = null;
    const at = (e) => {
      const r = c.getBoundingClientRect(), slot = shapeIndex(view) - FACTORY, u = data(view).user[slot];
      const bip = u ? u.bipolar : false;
      const fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
      const v = bip ? 1 - 2 * ((fy * r.height - 4) / (r.height - 8)) : 1 - (fy * r.height - 4) / (r.height - 8);
      return { x: fx, i: Math.round(fx * (POINTS - 1)), v: clamp(v, bip ? -1 : 0, 1) };
    };
    const slotData = () => {
      const d = data(view), slot = shapeIndex(view) - FACTORY;
      if (!d.user[slot]) d.user[slot] = { points: new Array(POINTS).fill(0), sustain: null, kind: "envelope", bipolar: false };
      return d.user[slot];
    };
    const setRange = (u, i0, v0, i1, v1) => {
      if (i1 < i0) [i0, v0, i1, v1] = [i1, v1, i0, v0];
      for (let i = i0; i <= i1; i++) u.points[i] = round3(i1 === i0 ? v1 : v0 + ((i - i0) / (i1 - i0)) * (v1 - v0));
      if (u.kind === "cycle") { if (i0 === 0) u.points[POINTS - 1] = u.points[0]; else if (i1 === POINTS - 1) u.points[0] = u.points[POINTS - 1]; }
    };
    c.addEventListener("pointerdown", (e) => {
      if (!se.draw || shapeIndex(view) < FACTORY || e.button !== 0) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      const u = slotData(), a = at(e);
      if (se.tool === "sustain") {
        u.sustain = round3(a.x);
        send(view); render(view);
        return;
      }
      drag = { start: a, last: a, before: u.points.slice() };
      setRange(u, a.i, a.v, a.i, a.v);
      send(view); render(view);
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const u = slotData(), a = at(e);
      if (se.tool === "line") {
        u.points = drag.before.slice();
        setRange(u, drag.start.i, drag.start.v, a.i, a.v);
      } else setRange(u, drag.last.i, drag.last.v, a.i, a.v);
      drag.last = a;
      send(view); render(view);
    });
    const end = () => { drag = null; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }
  function edit(view, fn) {
    const slot = shapeIndex(view) - FACTORY;
    if (slot < 0) return;
    const d = data(view);
    view.api.beginGesture();
    if (!d.user[slot]) d.user[slot] = { points: new Array(POINTS).fill(0), sustain: null, kind: "envelope", bipolar: false };
    fn(d.user[slot], d, slot);
    const u = d.user[slot];
    if (u) {
      const lo = u.bipolar ? -1 : 0;
      u.points = u.points.map((v) => round3(clamp(v, lo, 1)));
      if (u.kind === "cycle") u.points[POINTS - 1] = u.points[0];
    }
    send(view);
    render(view);
    updateTools(view);
  }
  function updateTools(view) {
    const se = view.se, slot = shapeIndex(view) - FACTORY;
    const editing = se.draw && slot >= 0;
    se.tools.hidden = !editing;
    se.copy.hidden = !se.draw || slot >= 0;
    se.browser.hidden = !se.browse;
    se.browseBtn.classList.toggle("on", se.browse);
    se.drawBtn.classList.toggle("on", se.draw);
    if (editing) {
      const u = data(view).user[slot];
      se.toolBtns.forEach((b) => b.classList.toggle("on", b.dataset.tool === se.tool));
      se.kindBtn.textContent = u && u.kind === "cycle" ? "Cycle" : "Envelope";
      se.bipBtn.classList.toggle("on", !!(u && u.bipolar));
    }
  }

  function button(label, title, onClick) {
    const b = document.createElement("button");
    b.className = "bv-toggle";
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  BleepViews.register("shape-env", {
    top: true,
    width: 420,
    template: '<div class="bv-panel se-root" tabindex="0" style="outline:none">' +
      '<div style="display:flex;gap:6px;align-items:center;justify-content:space-between">' +
      '<div class="se-title" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
      '<div class="se-buttons" style="display:flex;gap:4px"></div></div>' +
      '<canvas class="se-canvas" style="height:100px;width:100%;margin-top:4px;touch-action:none"></canvas>' +
      '<div class="se-tools" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"></div>' +
      '<div class="se-copy" style="display:flex;gap:4px;align-items:center;margin-top:4px"></div>' +
      '<div class="se-browser" style="max-height:260px;overflow:auto;margin-top:4px"></div></div>',
    afterBuild(view, el) {
      const se = (view.se = {
        canvas: el.querySelector(".se-canvas"), title: el.querySelector(".se-title"),
        tools: el.querySelector(".se-tools"), copy: el.querySelector(".se-copy"), browser: el.querySelector(".se-browser"),
        browse: false, draw: false, tool: "draw", grid: 8, hover: null, thumbs: null, state: null,
      });
      const bar = el.querySelector(".se-buttons");
      se.browseBtn = button("Browse ▦", "Browse the shape library", () => {
        se.browse = !se.browse;
        if (se.browse && !se.thumbCanvases) buildBrowser(view);
        updateTools(view);
        drawThumbs(view);
      });
      se.drawBtn = button("Draw ✎", "Draw a user shape", () => { se.draw = !se.draw; updateTools(view); render(view); });
      bar.append(se.browseBtn, se.drawBtn);

      // Draw tools.
      se.toolBtns = [["draw", "Free", "Freehand"], ["line", "Line", "Drag a straight line"], ["sustain", "Sustain", "Click to set the sustain point"]]
        .map(([tool, label, title]) => {
          const b = button(label, title, () => { se.tool = tool; updateTools(view); });
          b.dataset.tool = tool;
          return b;
        });
      const smooth = button("Smooth", "Soften the drawing", () => edit(view, (u) => {
        const p = u.points.slice(), n = p.length, cyc = u.kind === "cycle";
        u.points = p.map((v, i) => {
          if (!cyc && (i === 0 || i === n - 1)) return v;
          const a = p[cyc ? (i - 1 + n - 1) % (n - 1) : i - 1], b = p[cyc ? (i + 1) % (n - 1) : i + 1];
          return 0.25 * a + 0.5 * v + 0.25 * b;
        });
      }));
      const mirror = button("Mirror", "Make it symmetric (the first half, mirrored)", () => edit(view, (u) => {
        for (let i = 0; i < POINTS / 2; i++) u.points[POINTS - 1 - i] = u.points[i];
      }));
      const snap = (n) => button("Snap " + n, "Steps on a " + n + " grid", () => edit(view, (u) => {
        se.grid = n;
        const p = resample(u.points, 256), out = [];
        for (let i = 0; i < POINTS; i++) out.push(p[Math.min(255, Math.floor((Math.floor((i / POINTS) * n) + 0.5) / n * 256))]);
        u.points = out;
      }));
      se.kindBtn = button("Envelope", "Envelope (ends at its last value) or cycle (loops seamlessly)", () => edit(view, (u) => {
        u.kind = u.kind === "cycle" ? "envelope" : "cycle";
      }));
      se.bipBtn = button("± Bipolar", "Bipolar (−1 … +1) or unipolar (0 … 1)", () => edit(view, (u) => { u.bipolar = !u.bipolar; }));
      const noSustain = button("No sustain", "Remove the sustain point", () => edit(view, (u) => { u.sustain = null; }));
      const clear = button("Clear", "Empty this slot", () => edit(view, (u, d, slot) => { d.user[slot] = null; }));
      se.tools.append(...se.toolBtns, smooth, mirror, snap(8), snap(16), se.kindBtn, se.bipBtn, noSustain, clear);

      // Copy a factory shape (as shown: morphed, skewed, reversed) into a user slot.
      const pick = document.createElement("select");
      for (let i = 0; i < 8; i++) pick.appendChild(new Option("User " + (i + 1), i));
      const copy = button("Copy to", "Copy the shape as shown into a user slot", () => {
        const st = se.state || {}, pv = st.arrays && st.arrays.preview;
        if (!pv) return;
        const slot = parseInt(pick.value, 10), d = data(view);
        view.api.beginGesture();
        const bip = !!st.bipolar;
        d.user[slot] = {
          points: resample(Array.from(pv), POINTS).map((v) => round3(clamp(v, bip ? -1 : 0, 1))),
          sustain: typeof st.sustain === "number" && st.sustain >= 0 ? round3(st.sustain) : null,
          kind: bip || Math.abs(pv[0] - pv[pv.length - 1]) < 0.01 && Math.abs(pv[0]) > 0.01 ? "cycle" : "envelope",
          bipolar: bip,
        };
        send(view);
        setShape(view, FACTORY + slot);
        updateTools(view);
      });
      const hint = document.createElement("span");
      hint.className = "bv-label";
      hint.textContent = "Factory shape: copy it to draw on it";
      se.copy.append(copy, pick, hint);

      attachEditor(view);
      const root = el.querySelector(".se-root");
      root.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        setShape(view, shapeIndex(view) + (e.key === "ArrowRight" ? 1 : -1));
        drawThumbs(view);
      });
      if (view.api.command) view.api.command("thumbs", 1);
      updateTools(view);
    },
    onState(st, view) {
      const se = view.se;
      if (!se) return;
      se.state = st;
      if (st && st.arrays && st.arrays.thumbs) {
        se.thumbs = st.arrays.thumbs;
        drawThumbs(view);
      }
      render(view);
    },
    onRefresh(view) {
      if (!view.se) return;
      updateTools(view);
      render(view);
      if (view.api.command) view.api.command("thumbs", 1);
    },
  });
})();
