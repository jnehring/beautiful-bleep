// SPDX-License-Identifier: GPL-3.0-only
// Stage Seq view (doc/specs/modules/stage-sequencer.md §5): a timeline where each
// stage is a column as wide as its pulses, with lanes for pitch, pulses,
// gate mode, slide, velocity and accent; the playhead (stage and pulse), the
// Random/Brownian trail, and Randomize. Stages live in the node's data; edits
// go to the engine with api.setData.
(function () {
  "use strict";
  const STAGES = 16, MAX_PULSES = 8, PX = 22, MIN_P = -24, MAX_P = 36;
  // Same order and notes as patch/common/dsp/Scales.h.
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const GATES = ["Rest", "1st", "Every", "Hold", "Rat"];
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Lane geometry (canvas px).
  const PITCH = [4, 74], NAME = [74, 86], PULSES = [90, 104], GATE = [108, 124], SLIDE = [128, 142], VEL = [146, 174],
    ACCENT = [178, 192], RULER = [194, 206], H = 208;
  const LANES = [["Pitch", PITCH, "pitch"], ["Pulses", PULSES, "pulses"], ["Gate", GATE, "gate"], ["Slide", SLIDE, "slide"],
    ["Vel", VEL, "velocity"], ["Accent", ACCENT, "accent"]];

  function inScale(scale, s) { return SCALES[scale].includes(mod(s, 12)); }
  function quantize(semi, scale) {
    let lo = Math.floor(semi), hi = Math.ceil(semi);
    while (!inScale(scale, lo)) lo--;
    while (!inScale(scale, hi)) hi++;
    return semi - lo <= hi - semi ? lo : hi;
  }
  const setting = (view, id) => view.units(id);
  const scaleOf = (view) => clamp(setting(view, "scale"), 0, SCALES.length - 1);
  const fresh = () => ({ p: 0, n: 1, g: 2, r: 2, s: 0, v: 100, a: 0 });
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.stages)) d = view.node.data = { stages: [] };
    while (d.stages.length < STAGES) d.stages.push(fresh());
    if (!d.randomize) d.randomize = { lanes: ["pitch", "pulses", "gate"], octaves: 1, maxPulses: 4, slide: 0.15, accent: 0.15 };
    return d;
  }
  function noteName(view, p) {
    const note = 60 + setting(view, "root") + quantize(setting(view, "octave") * 12 + p, scaleOf(view));
    return NAMES[mod(note, 12)] + (Math.floor(note / 12) - 1);
  }
  const count = (view) => clamp(setting(view, "stages"), 1, STAGES);
  /// Stage columns: [{x, w}] for all 16 stages (the ones beyond Stages after a gap).
  function columns(view) {
    const d = data(view), out = [];
    let x = 0;
    for (let i = 0; i < STAGES; i++) {
      if (i === count(view)) x += 12;
      const w = clamp(d.stages[i].n, 1, MAX_PULSES) * PX;
      out.push({ x, w });
      x += w;
    }
    return { cols: out, width: x };
  }
  function cycleText(view) {
    const d = data(view), S = count(view), mode = setting(view, "mode");
    if (mode >= 3) return "phrase " + ["1 bar", "2 bars", "4 bars", "8 bars", "16 bars"][clamp(setting(view, "phrase"), 0, 4)];
    let c = 0;
    for (let i = 0; i < S; i++) c += clamp(d.stages[i].n, 1, MAX_PULSES);
    if (mode === 2) for (let i = S - 2; i >= 1; i--) c += clamp(d.stages[i].n, 1, MAX_PULSES);
    return "cycle: " + c + (c === 1 ? " pulse" : " pulses");
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view));
    send(view);
    draw(view);
  }

  // ---- drawing --------------------------------------------------------------
  function draw(view) {
    const c = view.stg && view.stg.canvas;
    if (!c) return;
    const d = data(view), st = view.stg.state || {}, S = count(view);
    const { cols, width } = columns(view);
    const w = width + 2, dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = H * dpr; c.style.width = w + "px"; c.style.height = H + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#e3a73b";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const pitchY = (p) => PITCH[0] + ((MAX_P - p) / (MAX_P - MIN_P)) * (PITCH[1] - PITCH[0]);
    const trail = (st.arrays && st.arrays.trail) || [];
    const walking = setting(view, "mode") >= 3;
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let i = 0; i < STAGES; i++) {
      const s = d.stages[i], { x, w: cw } = cols[i], n = clamp(s.n, 1, MAX_PULSES);
      g.globalAlpha = i < S ? 1 : 0.3;
      // playhead and trail
      if (i < S && walking) {
        const k = trail.indexOf(i);
        if (k > 0) { g.fillStyle = line; g.globalAlpha = 0.6 * (1 - k / 8); g.fillRect(x, 0, cw, RULER[0]); g.globalAlpha = 1; }
      }
      if (i === st.stage && i < S) {
        g.fillStyle = accent;
        g.globalAlpha = 0.16;
        g.fillRect(x, 0, cw, RULER[0]);
        g.globalAlpha = 1;
        g.fillStyle = accent;
        g.fillRect(x + clamp(st.pulse || 0, 0, n - 1) * PX + 2, RULER[0] - 3, PX - 4, 3);
      }
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, RULER[0]); g.stroke();
      // pitch
      const y = pitchY(s.p), rest = s.g === 0;
      g.fillStyle = accent;
      g.globalAlpha = (i < S ? 1 : 0.3) * (rest ? 0.3 : 1);
      if (s.s && i > 0 && !rest) {  // slide ramp from the previous stage's pitch
        const py = pitchY(d.stages[i - 1].p);
        g.strokeStyle = accent;
        g.beginPath(); g.moveTo(x + 1, py); g.lineTo(x + Math.min(cw - 2, 12), y); g.stroke();
      }
      g.fillRect(x + 2, y - 1.5, cw - 4, 3);
      g.fillStyle = muted;
      g.fillText(rest ? "—" : noteName(view, s.p), x + cw / 2, (NAME[0] + NAME[1]) / 2);
      // pulses: one dot per pulse
      g.fillStyle = accent;
      for (let k = 0; k < n; k++) { g.beginPath(); g.arc(x + k * PX + PX / 2, (PULSES[0] + PULSES[1]) / 2, 3, 0, Math.PI * 2); g.fill(); }
      // gate mode
      g.fillStyle = rest ? muted : text;
      g.strokeStyle = muted;
      g.strokeRect(x + 2.5, GATE[0] + 0.5, cw - 5, GATE[1] - GATE[0] - 1);
      const label = s.g === 4 ? (cw >= 40 ? "Rat×" + s.r : "×" + s.r) : cw >= 32 || s.g !== 2 ? GATES[s.g] : "Ev";
      g.fillText(label, x + cw / 2, (GATE[0] + GATE[1]) / 2);
      // slide
      if (s.s) { g.fillStyle = accent; g.fillText("↗", x + cw / 2, (SLIDE[0] + SLIDE[1]) / 2); }
      // velocity
      const vh = ((s.v - 1) / 126) * (VEL[1] - VEL[0]);
      g.fillStyle = accent;
      g.globalAlpha = (i < S ? 1 : 0.3) * (rest ? 0.3 : 1);
      g.fillRect(x + 3, VEL[1] - Math.max(1, vh), cw - 6, Math.max(1, vh));
      // accent
      g.globalAlpha = i < S ? 1 : 0.3;
      if (s.a) { g.fillStyle = text; g.font = "bold 11px system-ui, sans-serif"; g.fillText(">", x + cw / 2, (ACCENT[0] + ACCENT[1]) / 2); g.font = "9px system-ui, sans-serif"; }
      g.fillStyle = i === st.stage ? text : muted;
      g.fillText(String(i + 1), x + cw / 2, (RULER[0] + RULER[1]) / 2);
    }
    g.globalAlpha = 1;
    view.stg.cycle.textContent = cycleText(view);
  }

  // ---- editing --------------------------------------------------------------
  function lane(y) {
    for (const [, r, id] of LANES) if (y >= r[0] - 2 && y < r[1] + 2) return id;
    if (y >= NAME[0] && y < NAME[1]) return "pitch";
    return null;
  }
  function stageAt(view, px) {
    const { cols } = columns(view);
    for (let i = 0; i < STAGES; i++) if (px >= cols[i].x && px < cols[i].x + cols[i].w) return i;
    return -1;
  }
  function attach(view, c) {
    let drag = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const apply = (e) => {
      const { x, y } = pos(e), d = data(view);
      if (drag.lane === "pulses") {
        const s = d.stages[drag.i], n = clamp(Math.round((x - drag.x0) / PX), 1, MAX_PULSES);
        if (n === s.n) return;
        s.n = n;
      } else {
        const i = drag.lane === "pitch" || drag.lane === "velocity" ? stageAt(view, x) : drag.i;
        if (i < 0) return;
        const s = d.stages[i];
        if (drag.lane === "pitch") {
          let p = Math.round(MAX_P - ((y - PITCH[0]) / (PITCH[1] - PITCH[0])) * (MAX_P - MIN_P));
          if (!e.shiftKey) p = quantize(p, scaleOf(view));
          s.p = clamp(p, MIN_P, MAX_P);
        } else if (drag.lane === "velocity") {
          s.v = clamp(Math.round(1 + (1 - (y - VEL[0]) / (VEL[1] - VEL[0])) * 126), 1, 127);
        } else return;
      }
      send(view);
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const { x, y } = pos(e), l = lane(y), i = stageAt(view, x);
      if (!l || i < 0) return;
      e.stopPropagation();
      if (l === "gate") {
        return edit(view, (d) => {
          const s = d.stages[i];
          if (e.shiftKey && s.g === 4) s.r = s.r >= 4 ? 2 : s.r + 1;
          else s.g = (s.g + 1) % 5;
        });
      }
      if (l === "slide") return edit(view, (d) => (d.stages[i].s = d.stages[i].s ? 0 : 1));
      if (l === "accent") return edit(view, (d) => (d.stages[i].a = d.stages[i].a ? 0 : 1));
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      drag = { lane: l, i, x0: columns(view).cols[i].x };
      apply(e);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const { x, y } = pos(e), i = stageAt(view, x);
      if (i >= 0 && lane(y) === "pitch") edit(view, (d) => (d.stages[i].p = 0));
    });
    c.addEventListener("wheel", (e) => {
      const { x, y } = pos(e), l = lane(y), i = stageAt(view, x);
      if (i < 0 || (l !== "pulses" && l !== "gate")) return;
      e.preventDefault();
      const by = e.deltaY < 0 ? 1 : -1;
      edit(view, (d) => {
        const s = d.stages[i];
        if (l === "pulses") s.n = clamp(s.n + by, 1, MAX_PULSES);
        else if (s.g === 4) s.r = clamp(s.r + by, 2, 4);
      });
    }, { passive: false });
  }

  // ---- Randomize --------------------------------------------------------------
  function randomize(view) {
    edit(view, (d) => {
      const o = d.randomize, lanes = o.lanes || [], scale = scaleOf(view), notes = [];
      for (let k = 0; k <= 12 * (o.octaves || 1); k++) if (inScale(scale, k)) notes.push(k);
      const S = count(view);
      for (let i = 0; i < S; i++) {
        const s = d.stages[i];
        if (lanes.includes("pitch")) s.p = notes[Math.floor(Math.random() * notes.length)];
        if (lanes.includes("pulses")) s.n = 1 + Math.floor(Math.random() * clamp(o.maxPulses || 4, 1, MAX_PULSES));
        if (lanes.includes("gate")) {
          const u = Math.random();
          s.g = u < 0.1 ? 0 : u < 0.3 ? 1 : u < 0.65 ? 2 : u < 0.9 ? 3 : 4;
          if (s.g === 4) s.r = 2 + Math.floor(Math.random() * 3);
        }
        if (lanes.includes("slide")) s.s = Math.random() < (o.slide ?? 0.15) ? 1 : 0;
        if (lanes.includes("accent")) s.a = Math.random() < (o.accent ?? 0.15) ? 1 : 0;
        if (lanes.includes("velocity")) s.v = clamp(Math.round(70 + Math.random() * 57), 1, 127);
      }
    });
  }
  function options(view, box) {
    const o = data(view).randomize;
    box.innerHTML = "";
    const save = () => { view.api.beginGesture(); send(view); };
    const row = (label, input) => {
      const r = document.createElement("label");
      r.className = "seq-opt";
      r.append(Object.assign(document.createElement("span"), { textContent: label }), input);
      box.appendChild(r);
    };
    for (const id of ["pitch", "pulses", "gate", "slide", "accent", "velocity"]) {
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: (o.lanes || []).includes(id) });
      cb.addEventListener("change", () => {
        o.lanes = (o.lanes || []).filter((x) => x !== id);
        if (cb.checked) o.lanes.push(id);
        save();
      });
      row(id[0].toUpperCase() + id.slice(1), cb);
    }
    const number = (value, min, max, set) => {
      const n = Object.assign(document.createElement("input"), { type: "number", min, max, value, className: "bv-number" });
      n.addEventListener("change", () => { set(clamp(parseFloat(n.value) || 0, min, max)); save(); options(view, box); });
      return n;
    };
    row("Octaves", number(o.octaves, 1, 3, (v) => (o.octaves = Math.round(v))));
    row("Max pulses", number(o.maxPulses, 1, 8, (v) => (o.maxPulses = Math.round(v))));
    row("Slide %", number(Math.round(o.slide * 100), 0, 100, (v) => (o.slide = v / 100)));
    row("Accent %", number(Math.round(o.accent * 100), 0, 100, (v) => (o.accent = v / 100)));
  }

  const STYLE = `
    .stg-panel { flex: 1 1 100%; min-width: 0; }
    .stg-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .stg-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; }
    .stg-tools button.on { border-color: var(--accent); }
    .stg-tools .stg-cycle { margin-left: auto; color: var(--muted); font-size: 11px; }
    .stg-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px 12px;
      margin-bottom: 6px; font-size: 11px; color: var(--muted); }
    .stg-options .seq-opt { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .stg-options .bv-number { width: 50px; }
    .stg-body { display: flex; }
    .stg-labels { position: relative; width: 46px; flex: none; height: ${H}px; font-size: 9px; color: var(--muted);
      text-transform: uppercase; letter-spacing: .06em; }
    .stg-labels span { position: absolute; left: 0; }
    .stg-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .stg-scroll canvas { display: block; touch-action: none; cursor: crosshair; }`;

  BleepViews.register("stage-sequencer", {
    partNames: ["Stages"],
    top: true,
    side: true,
    width: 710,
    layout: [
      { title: "Sequence", params: ["syncto", "rate", "stages", "mode", "phrase"] },
      { title: "Pitch", params: ["root", "scale", "octave", "seed"] },
      { title: "Feel", params: ["gatelength", "slidetime", "accent", "swing"] },
    ],
    template: `<div class="bv-panel stg-panel">
      <div class="stg-tools">
        <button class="stg-rand" title="Randomize the chosen lanes (one undo step)">Randomize</button>
        <button class="stg-more" title="Randomize options">▾</button>
        <button class="stg-left" title="Rotate the stages left">◀</button>
        <button class="stg-right" title="Rotate the stages right">▶</button>
        <button class="stg-clear" title="Every stage: root, 1 pulse, Every">Clear</button>
        <span class="stg-cycle"></span>
      </div>
      <div class="stg-options" hidden></div>
      <div class="stg-body">
        <div class="stg-labels">${LANES.map(([n, r]) => `<span style="top:${(r[0] + r[1]) / 2 - 6}px">${n}</span>`).join("")}</div>
        <div class="stg-scroll"><canvas></canvas></div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("stg-style")) {
        const s = document.createElement("style");
        s.id = "stg-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.stg = { canvas, cycle: el.querySelector(".stg-cycle"), state: null };
      attach(view, canvas);
      const box = el.querySelector(".stg-options"), more = el.querySelector(".stg-more");
      el.querySelector(".stg-rand").addEventListener("click", () => randomize(view));
      more.addEventListener("click", () => {
        box.hidden = !box.hidden;
        more.classList.toggle("on", !box.hidden);
        if (!box.hidden) options(view, box);
      });
      const rotate = (by) => edit(view, (d) => {
        const S = count(view), part = d.stages.slice(0, S);
        for (let i = 0; i < S; i++) d.stages[i] = part[mod(i + by, S)];
      });
      el.querySelector(".stg-left").addEventListener("click", () => rotate(1));
      el.querySelector(".stg-right").addEventListener("click", () => rotate(-1));
      el.querySelector(".stg-clear").addEventListener("click", () => edit(view, (d) => {
        for (let i = 0; i < STAGES; i++) d.stages[i] = fresh();
      }));
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.stg) return;
      view.stg.state = st;
      draw(view);
    },
    onRefresh(view) {
      const box = view.root.querySelector(".stg-options");
      if (box && !box.hidden) options(view, box);
      draw(view);
    },
  });
})();
