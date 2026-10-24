// SPDX-License-Identifier: GPL-3.0-only
// Step Sequencer view (doc/specs/modules/step-sequencer.md §5): the lane editor
// (gate and its length, pitch, velocity, ratchet), the playhead, and the Randomize
// tools with a value range per lane. Steps live
// in the node's data; edits go to the engine with api.setData.
(function () {
  "use strict";
  const STEPS = 32, COL = 22, MIN_P = -24, MAX_P = 36;
  // Same order and notes as patch/common/dsp/Scales.h.
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Lane geometry (canvas px).
  // GATE is the on/off/tie strip, GLEN the gate length bars below it.
  const GATE = [2, 16], GLEN = [20, 76], PITCH = [84, 180], NAME = [180, 192], VEL = [200, 244], RAT = [252, 296],
    RULER = [298, 310], H = 312, MAX_R = 16;
  // Randomizer ranges per lane: [min, max, default low, default high].
  const RANGES = { glen: [1, 100, 50, 100], pitch: [MIN_P, MAX_P, 0, 12], velocity: [1, 127, 76, 127], ratchet: [1, MAX_R, 1, 2] };

  function inScale(scale, s) { return SCALES[scale].includes(mod(s, 12)); }
  function quantize(semi, scale) {
    let lo = Math.floor(semi), hi = Math.ceil(semi);
    while (!inScale(scale, lo)) lo--;
    while (!inScale(scale, hi)) hi++;
    return semi - lo <= hi - semi ? lo : hi;
  }
  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  const freshStep = () => ({ g: 1, p: 0, v: 100, l: 100, r: 1 });
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.steps)) d = view.node.data = { steps: Array.from({ length: STEPS }, freshStep) };
    while (d.steps.length < STEPS) d.steps.push({ g: 0, p: 0, v: 100, l: 100, r: 1 });
    for (const s of d.steps) { if (s.l == null) s.l = 100; if (s.r == null) s.r = 1; }
    if (!d.randomize) d.randomize = {};
    const o = d.randomize;
    if (o.density == null) o.density = 0.6;
    if (!o.range) o.range = {};
    for (const k in RANGES) if (!Array.isArray(o.range[k])) o.range[k] = [RANGES[k][2], RANGES[k][3]];
    return d;
  }
  /// The note a step plays (without Transpose and Variation), e.g. "E4".
  function noteName(view, p) {
    const scale = clamp(setting(view, "scale"), 0, SCALES.length - 1);
    const q = setting(view, "root") + quantize(setting(view, "octave") * 12 + p, scale);
    const note = 60 + q;
    return NAMES[mod(note, 12)] + (Math.floor(note / 12) - 1);
  }
  function send(view) { view.api.setData(JSON.parse(JSON.stringify(data(view)))); }
  function edit(view, fn) {
    view.api.beginGesture();
    fn(data(view));
    send(view);
    draw(view);
  }

  // ---- drawing ------------------------------------------------------------
  function draw(view) {
    const c = view.seq && view.seq.canvas;
    if (!c) return;
    const d = data(view), st = view.seq.state || {};
    const len = clamp(setting(view, "length"), 1, STEPS);
    const dpr = window.devicePixelRatio || 1, w = STEPS * COL;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = H * dpr; c.style.width = w + "px"; c.style.height = H + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim() || "#f6c453";
    const line = css.getPropertyValue("--line").trim() || "#333";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const text = css.getPropertyValue("--text").trim() || "#ddd";
    const zeroY = PITCH[0] + (MAX_P / (MAX_P - MIN_P)) * (PITCH[1] - PITCH[0]);
    const pitchY = (p) => PITCH[0] + ((MAX_P - p) / (MAX_P - MIN_P)) * (PITCH[1] - PITCH[0]);
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    for (let i = 0; i < STEPS; i++) {
      const x = i * COL, s = d.steps[i];
      g.globalAlpha = i < len ? 1 : 0.3;
      if (i === st.step && i < len) {  // playhead
        g.fillStyle = line;
        g.fillRect(x, 0, COL, RULER[0]);
      }
      // gate state strip and gate length
      g.strokeStyle = muted;
      g.fillStyle = accent;
      if (s.g === 0) g.strokeRect(x + 3.5, GATE[0] + 0.5, COL - 7, GATE[1] - GATE[0] - 1);
      else g.fillRect(x + 3, GATE[0], s.g === 2 ? COL - 3 : COL - 6, GATE[1] - GATE[0]);
      const lh = Math.max(1, (s.l / 100) * (GLEN[1] - GLEN[0]));
      g.globalAlpha *= s.g === 0 ? 0.3 : 1;
      g.fillRect(x + 4, GLEN[1] - lh, COL - 8, lh);
      g.globalAlpha = i < len ? 1 : 0.3;
      // pitch
      const y = pitchY(s.p);
      g.globalAlpha *= s.g === 0 ? 0.35 : 1;
      g.fillStyle = accent;
      g.fillRect(x + 6, Math.min(y, zeroY), COL - 12, Math.max(1, Math.abs(zeroY - y)));
      g.fillRect(x + 3, y - 1.5, COL - 6, 3);
      if ((st.varied || 0) & (1 << i)) {
        g.fillStyle = text;
        g.beginPath();
        g.arc(x + COL / 2, PITCH[0] + 4, 2.5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = muted;
      g.fillText(noteName(view, s.p), x + COL / 2, NAME[1] - 2);
      // velocity
      const vh = ((s.v - 1) / 126) * (VEL[1] - VEL[0]);
      g.fillStyle = accent;
      g.fillRect(x + 4, VEL[1] - Math.max(1, vh), COL - 8, Math.max(1, vh));
      // ratchet
      const rh = ((s.r - 1) / (MAX_R - 1)) * (RAT[1] - RAT[0] - 2) + 2;
      g.globalAlpha = (i < len ? 1 : 0.3) * (s.g === 0 ? 0.35 : 1);
      g.fillRect(x + 4, RAT[1] - rh, COL - 8, rh);
      if (s.r > 1) {
        g.fillStyle = text;
        g.fillText(String(s.r), x + COL / 2, RAT[1] - rh - 2);
      }
      g.globalAlpha = 1;
      g.fillStyle = i === st.step ? text : muted;
      if (i % 4 === 0 || i === len - 1) g.fillText(String(i + 1), x + COL / 2, RULER[1] - 2);
    }
    g.strokeStyle = line;
    g.beginPath();
    g.moveTo(0, zeroY + 0.5); g.lineTo(w, zeroY + 0.5);
    for (const [a, b] of [GLEN, VEL, RAT]) { g.moveTo(0, b + 0.5); g.lineTo(w, b + 0.5); }
    for (let i = 4; i < STEPS; i += 4) { g.moveTo(i * COL + 0.5, 0); g.lineTo(i * COL + 0.5, RULER[0]); }
    g.stroke();
    view.seq.length.textContent = len + (len === 1 ? " step" : " steps");
  }

  // ---- editing --------------------------------------------------------------
  function lane(y) {
    if (y < GATE[1] + 2) return "gate";
    if (y < GLEN[1] + 3) return "glen";
    if (y < NAME[1]) return "pitch";
    if (y < VEL[1] + 3) return "velocity";
    if (y < RULER[0]) return "ratchet";
    return null;
  }
  function attach(view, c) {
    let drag = null;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return { i: clamp(Math.floor((e.clientX - r.left) / COL), 0, STEPS - 1), y: e.clientY - r.top };
    };
    const apply = (e) => {
      const { i, y } = at(e), s = data(view).steps[i];
      if (drag.lane === "gate") s.g = drag.value;
      else if (drag.lane === "glen") {
        if (s.g === 0) s.g = 1;
        s.l = clamp(Math.round(((GLEN[1] - y) / (GLEN[1] - GLEN[0])) * 100), 1, 100);
      } else if (drag.lane === "ratchet") {
        s.r = clamp(Math.round(1 + ((RAT[1] - y) / (RAT[1] - RAT[0])) * (MAX_R - 1)), 1, MAX_R);
      } else if (drag.lane === "pitch") {
        let p = Math.round(MAX_P - ((y - PITCH[0]) / (PITCH[1] - PITCH[0])) * (MAX_P - MIN_P));
        if (!e.shiftKey) p = quantize(p, clamp(setting(view, "scale"), 0, SCALES.length - 1));
        s.p = clamp(p, MIN_P, MAX_P);
      } else if (drag.lane === "velocity") {
        if (e.shiftKey) s.v = clamp(Math.round(drag.v0 + (drag.y0 - y) / 4), 1, 127);
        else s.v = clamp(Math.round(1 + (1 - (y - VEL[0]) / (VEL[1] - VEL[0])) * 126), 1, 127);
      }
      send(view);
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const { i, y } = at(e), l = lane(y);
      if (!l) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      const s = data(view).steps[i];
      drag = { lane: l, value: (s.g + 1) % 3, v0: s.v, y0: y };
      apply(e);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const { i, y } = at(e), l = lane(y);
      const reset = { pitch: ["p", 0], glen: ["l", 100], ratchet: ["r", 1] }[l];
      if (reset) edit(view, (d) => (d.steps[i][reset[0]] = reset[1]));
    });
  }

  // ---- Randomize (spec §4.5) ---------------------------------------------
  const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  /// Rewrites the given lanes ("gate", "pitch", "velocity", "ratchet") of all 32 steps. Values
  /// come from each lane's range; a range of one value sets every step to it.
  function randomize(view, lanes) {
    edit(view, (d) => {
      const o = d.randomize, r = o.range;
      const scale = clamp(setting(view, "scale"), 0, SCALES.length - 1);
      const notes = [];
      for (let k = r.pitch[0]; k <= r.pitch[1]; k++) if (inScale(scale, k)) notes.push(k);
      if (!notes.length) notes.push(quantize(r.pitch[0], scale));
      for (const s of d.steps) {
        if (lanes.includes("gate")) {
          s.g = Math.random() < o.density ? (Math.random() < 0.125 ? 2 : 1) : 0;
          s.l = between(r.glen[0], r.glen[1]);
        }
        if (lanes.includes("pitch")) s.p = clamp(notes[Math.floor(Math.random() * notes.length)], MIN_P, MAX_P);
        if (lanes.includes("velocity")) s.v = between(r.velocity[0], r.velocity[1]);
        if (lanes.includes("ratchet")) s.r = between(r.ratchet[0], r.ratchet[1]);
      }
    });
  }
  function options(view, box) {
    const o = data(view).randomize;
    box.innerHTML = "";
    const n = Object.assign(document.createElement("input"), { type: "number", min: 0, max: 100, value: Math.round(o.density * 100), className: "bv-number" });
    n.addEventListener("change", () => {
      o.density = clamp(parseFloat(n.value) || 0, 0, 100) / 100;
      view.api.beginGesture();
      send(view);
      options(view, box);
    });
    const r = document.createElement("label");
    r.className = "seq-opt";
    r.append(Object.assign(document.createElement("span"), { textContent: "Density % (share of steps with a gate)" }), n);
    box.appendChild(r);
  }
  /// A two-handle slider over [min, max] for o.range[key]; dragging a handle past the other
  /// pushes it, so both together pick one value. Returns { el, refresh }.
  function rangeSlider(view, key) {
    const [min, max] = RANGES[key];
    const el = document.createElement("div");
    el.className = "seq-range";
    el.title = "Range for the dice: the new values fall between the two handles. Drag both together for one value.";
    el.innerHTML = '<div class="seq-track"><div class="seq-fill"></div><i></i><i></i></div><span class="seq-rv"></span>';
    const fill = el.querySelector(".seq-fill"), thumbs = el.querySelectorAll("i"), out = el.querySelector(".seq-rv");
    const track = el.querySelector(".seq-track");
    const unit = { glen: "%", pitch: " st" }[key] || "";
    const pos = (v) => ((v - min) / (max - min)) * 100;
    const refresh = () => {
      const [lo, hi] = data(view).randomize.range[key];
      fill.style.left = pos(lo) + "%";
      fill.style.width = pos(hi) - pos(lo) + "%";
      thumbs[0].style.left = pos(lo) + "%";
      thumbs[1].style.left = pos(hi) + "%";
      out.textContent = lo === hi ? lo + unit : lo + "–" + hi + unit;
    };
    let which = null;
    const move = (e) => {
      const r = track.getBoundingClientRect(), rg = data(view).randomize.range[key];
      const v = clamp(Math.round(min + ((e.clientX - r.left) / r.width) * (max - min)), min, max);
      if (which === 0) { rg[0] = v; if (rg[1] < v) rg[1] = v; }
      else { rg[1] = v; if (rg[0] > v) rg[0] = v; }
      send(view);
      refresh();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const r = track.getBoundingClientRect(), rg = data(view).randomize.range[key];
      const v = min + ((e.clientX - r.left) / r.width) * (max - min);
      which = Math.abs(v - rg[0]) < Math.abs(v - rg[1]) || (rg[0] === rg[1] && v < rg[0]) ? 0 : 1;
      el.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      move(e);
    });
    el.addEventListener("pointermove", (e) => { if (which !== null) move(e); });
    const end = () => (which = null);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return { el, refresh };
  }

  const STYLE = `
    .seq-panel { flex: 1 1 100%; min-width: 0; }
    .seq-tools { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .seq-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; }
    .seq-tools button.on { border-color: var(--accent); }
    .seq-tools .seq-len { margin-left: auto; color: var(--muted); font-size: 11px; }
    .seq-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 4px 12px;
      margin-bottom: 6px; font-size: 11px; color: var(--muted); }
    .seq-opt { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .seq-opt .bv-number { width: 56px; }
    .seq-body { display: flex; }
    .seq-labels { position: relative; width: 132px; margin-right: 6px; flex: none; height: ${H}px; font-size: 9px; color: var(--muted);
      text-transform: uppercase; letter-spacing: .06em; }
    .seq-labels .seq-lane { position: absolute; left: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 0; }
    .seq-labels button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 5px;
      padding: 0 3px; font-size: 16px; line-height: 16px; cursor: pointer; }
    .seq-labels button:hover { border-color: var(--accent); }
    .seq-labels .seq-head { display: flex; align-items: center; gap: 4px; }
    .seq-range { position: relative; width: 126px; touch-action: none; cursor: pointer; }
    .seq-range .seq-track { position: relative; height: 4px; background: var(--line); border-radius: 2px; margin: 8px 6px 10px; }
    .seq-range .seq-fill { position: absolute; top: 0; height: 100%; background: var(--accent); border-radius: 2px; }
    .seq-range i { position: absolute; top: -4px; width: 10px; height: 12px; margin-left: -5px; box-sizing: border-box;
      background: var(--panel); border: 1px solid var(--accent); border-radius: 3px; }
    .seq-range .seq-rv { position: absolute; right: 0; top: -20px; text-align: right; font-size: 9px; color: var(--muted); text-transform: none; letter-spacing: 0; }
    .seq-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .seq-scroll canvas { display: block; touch-action: none; cursor: crosshair; }`;

  BleepViews.register("step-sequencer", {
    partNames: ["Step lanes"],
    top: true,
    width: 980,
    layout: [
      { title: "Clock", params: ["syncto", "rate", "length", "direction"] },
      { title: "Feel", params: ["gatelength", "swing"] },
      { title: "Pitch", params: ["root", "scale", "octave"] },
      { title: "Variation", params: ["variation", "varrange", "harmony", "seed"] },
    ],
    template: `<div class="bv-panel seq-panel">
      <div class="seq-tools">
        <button class="seq-rand" title="New gates, pitches and velocities (one undo step)">Randomize all</button>
        <button class="seq-more" title="Randomize options">▾</button>
        <button class="seq-left" title="Rotate the steps left">◀</button>
        <button class="seq-right" title="Rotate the steps right">▶</button>
        <button class="seq-clear" title="All gates off">Clear</button>
        <span class="seq-len"></span>
      </div>
      <div class="seq-options" hidden></div>
      <div class="seq-body">
        <div class="seq-labels">
          <div class="seq-lane" style="top:${GATE[0] + 14}px"><div class="seq-head">Gate <button data-lane="gate" title="New gates, ties and gate lengths">⚄</button></div>
            <div data-range="glen"></div></div>
          <div class="seq-lane" style="top:${PITCH[0] + 6}px"><div class="seq-head">Pitch <button data-lane="pitch" title="New pitches from the scale">⚄</button></div>
            <div data-range="pitch"></div></div>
          <div class="seq-lane" style="top:${VEL[0]}px"><div class="seq-head">Vel <button data-lane="velocity" title="New velocities">⚄</button></div>
            <div data-range="velocity"></div></div>
          <div class="seq-lane" style="top:${RAT[0]}px"><div class="seq-head">Ratchet <button data-lane="ratchet" title="New ratchets (1–16 notes per step)">⚄</button></div>
            <div data-range="ratchet"></div></div>
        </div>
        <div class="seq-scroll"><canvas></canvas></div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("seq-style")) {
        const s = document.createElement("style");
        s.id = "seq-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      const canvas = el.querySelector("canvas");
      view.seq = { canvas, length: el.querySelector(".seq-len"), state: null };
      attach(view, canvas);
      const box = el.querySelector(".seq-options"), more = el.querySelector(".seq-more");
      el.querySelector(".seq-rand").addEventListener("click", () => randomize(view, ["gate", "pitch", "velocity"]));
      view.seq.sliders = [];
      for (const slot of el.querySelectorAll("[data-range]")) {
        const sl = rangeSlider(view, slot.dataset.range);
        slot.replaceWith(sl.el);
        sl.refresh();
        view.seq.sliders.push(sl);
      }
      for (const b of el.querySelectorAll(".seq-labels button"))
        b.addEventListener("click", () => randomize(view, [b.dataset.lane]));
      more.addEventListener("click", () => {
        box.hidden = !box.hidden;
        more.classList.toggle("on", !box.hidden);
        if (!box.hidden) options(view, box);
      });
      const rotate = (by) => edit(view, (d) => {
        const len = clamp(setting(view, "length"), 1, STEPS);
        const part = d.steps.slice(0, len);
        for (let i = 0; i < len; i++) d.steps[i] = part[mod(i + by, len)];
      });
      el.querySelector(".seq-left").addEventListener("click", () => rotate(1));
      el.querySelector(".seq-right").addEventListener("click", () => rotate(-1));
      el.querySelector(".seq-clear").addEventListener("click", () => edit(view, (d) => d.steps.forEach((s) => (s.g = 0))));
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.seq) return;
      view.seq.state = st;
      draw(view);
    },
    onRefresh(view) {
      const box = view.root.querySelector(".seq-options");
      if (box && !box.hidden) options(view, box);
      if (view.seq) for (const sl of view.seq.sliders || []) sl.refresh();
      draw(view);
    },
  });
})();
