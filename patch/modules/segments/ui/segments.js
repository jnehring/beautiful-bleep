// SPDX-License-Identifier: MIT
// Segments view (specs/modules/segments.md §5): a breakpoint editor of the
// chain (drag a node up/down for Level, left/right for Time; drag a curve's
// middle for Shape), the loop bracket (drag across segments to set the Loop
// flags), the selected segment's row (Type, Wait, Loop, Seg In, Sync value and
// its three knobs, moved here from the knob section), Count +/− and a
// Templates menu. Segment choices live in the node data; times, levels and
// shapes are the params, drawn with their live modulation.
(function () {
  "use strict";
  const N = 8;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // The Time knob: 0.5 ms – 30 s, skewed with 250 ms at the centre (ParamSpec::seconds).
  const T_MIN = 0.0005, T_MAX = 30, T_SKEW = Math.log(0.5) / Math.log((0.25 - T_MIN) / (T_MAX - T_MIN));
  const secondsOf = (x) => (x <= 0 ? T_MIN : T_MIN + (T_MAX - T_MIN) * Math.exp(Math.log(x) / T_SKEW));
  const normOfSeconds = (s) => Math.pow(clamp((s - T_MIN) / (T_MAX - T_MIN), 0, 1), T_SKEW);
  // dsp::noteValues() 8 bars … 1/64T (indices 1 … 24) and their beats.
  const SYNC = ["8 bars", "4 bars", "2 bars", "1/1.", "1/1", "1/1T", "1/2.", "1/2", "1/2T", "1/4.", "1/4", "1/4T", "1/8.", "1/8",
    "1/8T", "1/16.", "1/16", "1/16T", "1/32.", "1/32", "1/32T", "1/64.", "1/64", "1/64T"];
  const SYNC_BEATS = [32, 16, 8, 6, 4, 8 / 3, 3, 2, 4 / 3, 1.5, 1, 2 / 3, 0.75, 0.5, 1 / 3, 0.375, 0.25, 1 / 6, 0.1875, 0.125,
    1 / 12, 0.09375, 0.0625, 1 / 24];
  const TYPES = ["ramp", "step", "hold"], WAITS = ["time", "gate", "trigger"], SEGINS = ["advance", "jump"];
  const LETTER = { ramp: "R", step: "S", hold: "H" };
  const curvePow = (u, c) => (c >= 0 ? Math.pow(u, 1 + 3 * c) : 1 - Math.pow(1 - u, 1 - 3 * c));
  const ramp = (a, b, u, s) => (b >= a ? a + (b - a) * curvePow(u, s) : b + (a - b) * curvePow(1 - u, s));
  const fresh = () => ({ type: "ramp", loop: false, wait: "gate", segIn: "advance", sync: "1/4" });

  // ---- model ---------------------------------------------------------------------------------
  function units(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  }
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.segments)) {
      d = view.node.data = { segments: Array.from({ length: N }, fresh) };
      d.segments[2].type = "hold";
    }
    while (d.segments.length < N) d.segments.push(fresh());
    return d;
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function setParam(view, id, norm) {
    norm = clamp(norm, 0, 1);
    view.node.params[id] = norm;
    view.api.setParam(id, norm);
    const k = view.knobs.get(id);
    if (k) k.draw();
  }
  const count = (view) => clamp(units(view, "count"), 1, N);
  const syncOn = (view) => units(view, "sync") === 1;
  /// The chain as drawn: per segment its type, seconds, level and shape (live values).
  function chain(view) {
    const st = view.sg.state, d = data(view), n = count(view), sync = syncOn(view);
    const segs = [];
    for (let i = 0; i < n; i++) {
      const s = d.segments[i], k = i + 1;
      const si = Math.max(0, SYNC.indexOf(s.sync));
      segs.push({
        def: s,
        seconds: sync ? (SYNC_BEATS[si] * 60) / 120 : secondsOf(view.value(st, "time" + k)) * secondsScale(view, st),
        level: view.value(st, "level" + k) * 2 - 1,
        shape: view.value(st, "shape" + k) * 2 - 1,
      });
    }
    return segs;
  }
  function secondsScale(view, st) { return 0.1 * Math.pow(100, view.value(st, "timescale")); }
  function loopRange(segs) {
    let a = -1, b = -1;
    segs.forEach((s, i) => { if (s.def.loop) { if (a < 0) a = i; b = i; } });
    return [a, b];
  }

  // ---- geometry: log-scaled widths, levels on y ---------------------------------------------
  const STRIP = 16, TOP = 20, BOTTOM_PAD = 16;  // the loop strip on top: drag across segments
  function layout(view, segs, w, h) {
    const weights = segs.map((s) => 0.35 + Math.log2(1 + s.seconds / 0.004));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const x0 = [];
    let x = 4;
    for (const wt of weights) { x0.push(x); x += (wt / total) * (w - 8); }
    x0.push(x);
    const bipolar = segs.some((s) => s.def.type !== "hold" && s.level < 0);
    const top = TOP, bottom = h - BOTTOM_PAD;
    const y = (v) => (bipolar ? top + ((1 - v) / 2) * (bottom - top) : top + (1 - v) * (bottom - top));
    // Levels at segment ends, from 0 (as the chain starts from silence).
    const ends = [];
    let lvl = 0;
    for (const s of segs) { if (s.def.type !== "hold") lvl = s.level; ends.push(lvl); }
    return { x0, y, ends, bipolar, top, bottom };
  }

  function draw(view) {
    const sg = view.sg, c = sg.canvas;
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#ca8a04";
    const line = css.getPropertyValue("--line"), text = css.getPropertyValue("--text"), muted = css.getPropertyValue("--muted");
    const segs = chain(view), L = layout(view, segs, w, h);
    sg.geo = { segs, L, w, h };
    const st = sg.state || {}, running = typeof st.segment === "number" ? st.segment : -1;
    // Axis and the selected segment.
    g.fillStyle = line;
    g.globalAlpha = 0.35;
    if (sg.sel < segs.length) g.fillRect(L.x0[sg.sel], L.top - 2, L.x0[sg.sel + 1] - L.x0[sg.sel], L.bottom - L.top + 4);
    g.globalAlpha = 1;
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, Math.round(L.y(0)) + 0.5); g.lineTo(w, Math.round(L.y(0)) + 0.5);
    for (let i = 1; i < segs.length; i++) { g.moveTo(Math.round(L.x0[i]) + 0.5, L.top); g.lineTo(Math.round(L.x0[i]) + 0.5, L.bottom); }
    g.stroke();
    // Loop strip and bracket.
    g.fillStyle = line;
    g.globalAlpha = 0.25;
    g.fillRect(0, 0, w, STRIP);
    g.globalAlpha = 1;
    const [ls, le] = loopRange(segs);
    if (ls >= 0) {
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(L.x0[ls] + 2, STRIP - 2); g.lineTo(L.x0[ls] + 2, 4); g.lineTo(L.x0[le + 1] - 2, 4); g.lineTo(L.x0[le + 1] - 2, STRIP - 2);
      g.stroke();
      g.fillStyle = accent;
      g.font = "9px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("↺", (L.x0[ls] + L.x0[le + 1]) / 2, STRIP - 3);
    }
    // The curve.
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.beginPath();
    let start = 0;
    g.moveTo(L.x0[0], L.y(0));
    segs.forEach((s, i) => {
      const xa = L.x0[i], xb = L.x0[i + 1], steps = Math.max(2, Math.round(xb - xa));
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        let v;
        if (s.def.type === "hold") v = start;
        else if (s.def.type === "step") v = s.shape > 0 ? start + (s.level - start) * Math.min(1, u / s.shape) : s.level;
        else v = ramp(start, s.level, u, s.shape);
        g.lineTo(xa + u * (xb - xa), L.y(v));
      }
      start = L.ends[i];
    });
    g.stroke();
    // Nodes and headers.
    segs.forEach((s, i) => {
      const x = L.x0[i + 1], yy = L.y(L.ends[i]);
      g.fillStyle = s.def.type === "hold" ? muted : i === sg.sel ? text : accent;
      g.beginPath(); g.arc(x, yy, i === sg.sel ? 4.5 : 3.5, 0, Math.PI * 2); g.fill();
      const label = i + 1 + " " + LETTER[s.def.type] + (s.def.type === "hold" ? " " + s.def.wait : "");
      g.fillStyle = i === running ? accent : muted;
      g.font = (i === running ? "bold " : "") + "9px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText(label, (L.x0[i] + L.x0[i + 1]) / 2, h - 4);
    });
    // Playhead.
    if (running >= 0 && running < segs.length && typeof st.level === "number") {
      const x = L.x0[running] + clamp(st.u || 0, 0, 1) * (L.x0[running + 1] - L.x0[running]);
      g.fillStyle = text;
      g.beginPath(); g.arc(x, L.y(clamp(st.level, -1, 1)), 3.5, 0, Math.PI * 2); g.fill();
    }
  }

  // ---- editing --------------------------------------------------------------------------------
  function attach(view) {
    const sg = view.sg, c = sg.canvas;
    let drag = null;
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const segAt = (x) => {
      const L = sg.geo.L;
      for (let i = 0; i < sg.geo.segs.length; i++) if (x < L.x0[i + 1]) return i;
      return sg.geo.segs.length - 1;
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !sg.geo) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      const p = at(e), { segs, L } = sg.geo;
      const i = segAt(p.x);
      view.api.beginGesture();
      if (p.y < STRIP) {  // the loop bracket
        drag = { kind: "loop", from: i };
        setLoop(view, i, i, true);
        return;
      }
      // A node (the end of a segment) within 8 px?
      let node = -1;
      for (let k = 0; k < segs.length; k++)
        if (Math.abs(p.x - L.x0[k + 1]) < 8 && Math.abs(p.y - L.y(L.ends[k])) < 10) node = k;
      sg.sel = node >= 0 ? node : i;
      updateRow(view);
      const k = sg.sel + 1, s = segs[sg.sel];
      if (node >= 0) {
        drag = { kind: "node", seg: node, x: p.x, y: p.y, time: view.node.params["time" + k] ?? 0.5,
          level: view.node.params["level" + k] ?? 0.5, sync: Math.max(0, SYNC.indexOf(s.def.sync)) };
      } else {
        drag = { kind: "shape", seg: i, y: p.y, shape: view.node.params["shape" + k] ?? 0.5 };
      }
      draw(view);
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = at(e), k = drag.seg + 1;
      if (drag.kind === "loop") {
        setLoop(view, drag.from, segAt(p.x), false);
      } else if (drag.kind === "node") {
        const L = sg.geo.L, s = sg.geo.segs[drag.seg];
        if (s && s.def.type !== "hold") {
          const span = L.bipolar ? 2 : 1, px = (L.bottom - L.top) / span;
          setParam(view, "level" + k, drag.level - (p.y - drag.y) / px / 2);
        }
        const dx = p.x - drag.x;
        if (syncOn(view)) {
          const si = clamp(drag.sync - Math.round(dx / 24), 0, SYNC.length - 1);
          const d = data(view);
          if (d.segments[drag.seg].sync !== SYNC[si]) { d.segments[drag.seg].sync = SYNC[si]; send(view); updateRow(view); }
        } else {
          setParam(view, "time" + k, normOfSeconds(secondsOf(drag.time) * Math.pow(2, dx / 40)));
        }
      } else {
        setParam(view, "shape" + k, drag.shape - (p.y - drag.y) / 120);
      }
      draw(view);
    });
    const end = () => { drag = null; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }
  function setLoop(view, a, b, toggleSingle) {
    const d = data(view), n = count(view);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const wasOnly = toggleSingle && d.segments[lo].loop && d.segments.slice(0, n).filter((s) => s.loop).length === 1;
    for (let i = 0; i < N; i++) d.segments[i].loop = !wasOnly && i >= lo && i <= hi;
    send(view);
    updateRow(view);
    draw(view);
  }

  // ---- the selected segment's row ---------------------------------------------------------------
  function select(options, onChange) {
    const s = document.createElement("select");
    for (const [v, label] of options) s.appendChild(new Option(label, v));
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function field(label, control) {
    const box = document.createElement("label");
    box.className = "bv-setting";
    const l = document.createElement("span");
    l.className = "bv-label";
    l.textContent = label;
    box.append(l, control);
    return box;
  }
  function editSeg(view, fn) {
    view.api.beginGesture();
    fn(data(view).segments[view.sg.sel]);
    send(view);
    updateRow(view);
    draw(view);
  }
  function updateRow(view) {
    const sg = view.sg, n = count(view);
    sg.sel = clamp(sg.sel, 0, n - 1);
    const s = data(view).segments[sg.sel], sync = syncOn(view);
    sg.title.textContent = "Segment " + (sg.sel + 1);
    sg.type.value = s.type;
    sg.wait.value = s.wait;
    sg.waitBox.hidden = s.type !== "hold";
    sg.loop.classList.toggle("on", !!s.loop);
    sg.segIn.value = s.segIn;
    sg.sync.value = s.sync;
    sg.syncBox.hidden = !sync;
    sg.count.textContent = n + (n === 1 ? " segment" : " segments");
    // The selected segment's knobs (Time hidden with Sync, Level for holds).
    for (let k = 1; k <= N; k++)
      for (const id of ["time", "level", "shape"]) {
        const knob = view.knobs.get(id + k);
        if (!knob) continue;
        let shown = k === sg.sel + 1;
        if (id === "time" && sync) shown = false;
        if (id === "level" && s.type === "hold") shown = false;
        if (id === "shape" && s.type === "hold") shown = false;
        knob.box.hidden = !shown;
      }
  }

  // ---- templates -------------------------------------------------------------------------------
  // [type, seconds, level, shape, loop, wait]; run: 0 Gated, 1 Free.
  const TEMPLATES = {
    "AD": { run: 0, segs: [["ramp", 0.005, 1, 0], ["ramp", 0.5, 0, 0.5]] },
    "ADSR": { run: 0, segs: [["ramp", 0.005, 1, 0], ["ramp", 0.3, 0.7, 0.5], ["hold", 0.25, 0, 0, false, "gate"], ["ramp", 0.4, 0, 0.5]] },
    "AHDSR": { run: 0, segs: [["ramp", 0.005, 1, 0], ["hold", 0.1, 0, 0, false, "time"], ["ramp", 0.3, 0.6, 0.5],
      ["hold", 0.25, 0, 0, false, "gate"], ["ramp", 0.5, 0, 0.5]] },
    "Swell (two peaks)": { run: 0, segs: [["ramp", 0.4, 0.8, -0.3], ["ramp", 0.2, 0.4, 0.3], ["ramp", 0.6, 1, -0.3],
      ["ramp", 0.8, 0, 0.5]] },
    "Ramp LFO": { run: 1, segs: [["step", 0.0005, -1, 0], ["ramp", 0.5, 1, 0, true]] },
    "Triangle LFO": { run: 1, segs: [["ramp", 0.25, 1, 0, true], ["ramp", 0.25, -1, 0, true]] },
    "4-step loop": { run: 1, segs: [0.2, 0.8, 0.5, 1].map((l) => ["step", 0.25, l, 0, true]) },
    "8-step loop": { run: 1, segs: [0.1, 0.6, 0.3, 0.9, 0.2, 0.7, 0.4, 1].map((l) => ["step", 0.125, l, 0, true]) },
    "Gated burst": { run: 0, segs: [["ramp", 0.02, 1, 0, true], ["ramp", 0.08, 0.3, 0.5, true], ["ramp", 0.3, 0, 0.5]] },
  };
  function applyTemplate(view, name) {
    const t = TEMPLATES[name];
    if (!t) return;
    view.api.beginGesture();  // one undo step for the whole rewrite
    const d = data(view);
    for (let i = 0; i < N; i++) {
      const [type, seconds, level, shape, loop, wait] = t.segs[i] || ["ramp", 0.25, 0, 0, false, "gate"];
      d.segments[i] = { type, loop: !!loop, wait: wait || "gate", segIn: "advance", sync: d.segments[i].sync || "1/4" };
      setParam(view, "time" + (i + 1), normOfSeconds(seconds));
      setParam(view, "level" + (i + 1), (level + 1) / 2);
      setParam(view, "shape" + (i + 1), (shape + 1) / 2);
    }
    setParam(view, "count", (t.segs.length - 1) / (N - 1));
    setParam(view, "run", t.run);
    send(view);
    view.sg.sel = 0;
    updateRow(view);
    draw(view);
  }

  BleepViews.register("segments", {
    top: true,
    width: 440,
    template: '<div class="bv-panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
      '<h2 style="margin:0">Chain</h2><div class="sg-head" style="display:flex;gap:4px;align-items:center"></div></div>' +
      '<canvas class="sg-canvas" style="height:140px;width:100%;margin-top:4px;touch-action:none"></canvas>' +
      '<div class="sg-row" style="display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-top:6px"></div>' +
      '<div class="sg-knobs bv-group-knobs" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"></div></div>',
    afterBuild(view, el) {
      const sg = (view.sg = { canvas: el.querySelector(".sg-canvas"), sel: 0, state: null });
      // Header: Count − / + and Templates.
      const head = el.querySelector(".sg-head");
      const btn = (label, title, fn) => {
        const b = document.createElement("button");
        b.className = "bv-toggle";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", fn);
        return b;
      };
      sg.count = document.createElement("span");
      sg.count.className = "bv-label";
      const step = (dn) => () => {
        view.api.beginGesture();
        setParam(view, "count", (clamp(count(view) + dn, 1, N) - 1) / (N - 1));
        updateRow(view);
        draw(view);
      };
      const tpl = select([["", "Templates ▾"], ...Object.keys(TEMPLATES).map((k) => [k, k])], (v) => {
        applyTemplate(view, v);
        tpl.value = "";
      });
      head.append(btn("−", "One segment fewer", step(-1)), sg.count, btn("+", "One segment more", step(1)), tpl);
      // The selected segment's row.
      const row = el.querySelector(".sg-row");
      sg.title = document.createElement("div");
      sg.title.className = "bv-label";
      sg.title.style.alignSelf = "center";
      sg.type = select([["ramp", "Ramp"], ["step", "Step"], ["hold", "Hold"]], (v) => editSeg(view, (s) => (s.type = v)));
      sg.wait = select([["time", "Time"], ["gate", "Gate"], ["trigger", "Trigger"]], (v) => editSeg(view, (s) => (s.wait = v)));
      sg.segIn = select([["advance", "Advance"], ["jump", "Jump"]], (v) => editSeg(view, (s) => (s.segIn = v)));
      sg.sync = select(SYNC.map((x) => [x, x]), (v) => editSeg(view, (s) => (s.sync = v)));
      sg.loop = btn("Loop", "Part of the loop region", () => editSeg(view, (s) => (s.loop = !s.loop)));
      sg.waitBox = field("Wait", sg.wait);
      sg.syncBox = field("Length", sg.sync);
      row.append(sg.title, field("Type", sg.type), sg.waitBox, sg.loop, field("Seg In", sg.segIn), sg.syncBox);
      // Move the per-segment knobs here; only the selected segment's are shown.
      const knobs = el.querySelector(".sg-knobs");
      for (let k = 1; k <= N; k++)
        for (const id of ["time", "level", "shape"]) {
          const knob = view.knobs.get(id + k);
          if (knob) knobs.appendChild(knob.box);
        }
      attach(view);
      updateRow(view);
    },
    onState(st, view) {
      if (!view.sg) return;
      view.sg.state = st;
      // Settings may have changed (and the layout pass re-shows knobs by Count): reapply.
      updateRow(view);
      draw(view);
    },
    onRefresh(view) {
      if (!view.sg) return;
      updateRow(view);
      draw(view);
    },
  });
})();
