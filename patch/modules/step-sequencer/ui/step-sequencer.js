// SPDX-License-Identifier: MIT
// Step Sequencer view (specs/modules/step-sequencer.md §5): the lane editor
// (gate, pitch, velocity), the playhead, and the Randomize tools. Steps live
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
  const GATE = [2, 20], PITCH = [26, 122], NAME = [122, 134], VEL = [140, 184], RULER = [186, 198], H = 200;

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
  const freshStep = () => ({ g: 1, p: 0, v: 100 });
  function data(view) {
    let d = view.node.data;
    if (!d || !Array.isArray(d.steps)) d = view.node.data = { steps: Array.from({ length: STEPS }, freshStep) };
    while (d.steps.length < STEPS) d.steps.push({ g: 0, p: 0, v: 100 });
    if (!d.randomize) d.randomize = { lanes: ["gate", "pitch", "velocity"], density: 0.6, octaves: 1, velocity: [0.6, 1] };
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
      // gate
      g.strokeStyle = muted;
      g.fillStyle = accent;
      if (s.g === 0) g.strokeRect(x + 3.5, GATE[0] + 0.5, COL - 7, GATE[1] - GATE[0] - 1);
      else g.fillRect(x + 3, GATE[0], s.g === 2 ? COL - 3 : COL - 6, GATE[1] - GATE[0]);
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
      g.globalAlpha = 1;
      g.fillStyle = i === st.step ? text : muted;
      if (i % 4 === 0 || i === len - 1) g.fillText(String(i + 1), x + COL / 2, RULER[1] - 2);
    }
    g.strokeStyle = line;
    g.beginPath();
    g.moveTo(0, zeroY + 0.5); g.lineTo(w, zeroY + 0.5);
    for (let i = 4; i < STEPS; i += 4) { g.moveTo(i * COL + 0.5, 0); g.lineTo(i * COL + 0.5, RULER[0]); }
    g.stroke();
    view.seq.length.textContent = len + (len === 1 ? " step" : " steps");
  }

  // ---- editing --------------------------------------------------------------
  function lane(y) {
    if (y < GATE[1] + 3) return "gate";
    if (y < NAME[1]) return "pitch";
    if (y < RULER[0]) return "velocity";
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
      else if (drag.lane === "pitch") {
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
      const { i, y } = at(e);
      if (lane(y) !== "pitch") return;
      edit(view, (d) => (d.steps[i].p = 0));
    });
  }

  // ---- Randomize (spec §4.5) ---------------------------------------------
  function randomize(view) {
    edit(view, (d) => {
      const o = d.randomize, lanes = o.lanes || [];
      const scale = clamp(setting(view, "scale"), 0, SCALES.length - 1);
      const notes = [];
      for (let k = 0; k <= 12 * (o.octaves || 1); k++) if (inScale(scale, k)) notes.push(k);
      const [lo, hi] = o.velocity || [0.6, 1];
      for (const s of d.steps) {
        if (lanes.includes("gate")) s.g = Math.random() < (o.density ?? 0.6) ? (Math.random() < 0.125 ? 2 : 1) : 0;
        if (lanes.includes("pitch")) s.p = notes[Math.floor(Math.random() * notes.length)];
        if (lanes.includes("velocity")) s.v = clamp(Math.round((lo + Math.random() * (hi - lo)) * 127), 1, 127);
      }
    });
  }
  function options(view, box) {
    const o = data(view).randomize;
    box.innerHTML = "";
    const row = (label, input) => {
      const r = document.createElement("label");
      r.className = "seq-opt";
      r.append(Object.assign(document.createElement("span"), { textContent: label }), input);
      box.appendChild(r);
    };
    const save = () => { view.api.beginGesture(); send(view); };
    for (const lane of ["gate", "pitch", "velocity"]) {
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: o.lanes.includes(lane) });
      cb.addEventListener("change", () => {
        o.lanes = ["gate", "pitch", "velocity"].filter((l) => (l === lane ? cb.checked : o.lanes.includes(l)));
        save();
      });
      row(lane[0].toUpperCase() + lane.slice(1), cb);
    }
    const number = (value, min, max, set) => {
      const n = Object.assign(document.createElement("input"), { type: "number", min, max, value, className: "bv-number" });
      n.addEventListener("change", () => { set(clamp(parseFloat(n.value) || 0, min, max)); save(); options(view, box); });
      return n;
    };
    row("Density %", number(Math.round(o.density * 100), 0, 100, (v) => (o.density = v / 100)));
    row("Octaves", number(o.octaves, 1, 3, (v) => (o.octaves = Math.round(v))));
    row("Velocity low %", number(Math.round(o.velocity[0] * 100), 1, 100, (v) => (o.velocity = [v / 100, Math.max(v / 100, o.velocity[1])])));
    row("Velocity high %", number(Math.round(o.velocity[1] * 100), 1, 100, (v) => (o.velocity = [Math.min(v / 100, o.velocity[0]), v / 100])));
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
    .seq-labels { position: relative; width: 34px; flex: none; height: ${H}px; font-size: 9px; color: var(--muted);
      text-transform: uppercase; letter-spacing: .06em; }
    .seq-labels span { position: absolute; left: 0; }
    .seq-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .seq-scroll canvas { display: block; touch-action: none; cursor: crosshair; }`;

  BleepViews.register("step-sequencer", {
    top: true,
    width: 600,
    template: `<div class="bv-panel seq-panel">
      <div class="seq-tools">
        <button class="seq-rand" title="Write a new pattern (one undo step)">Randomize</button>
        <button class="seq-more" title="Randomize options">▾</button>
        <button class="seq-left" title="Rotate the steps left">◀</button>
        <button class="seq-right" title="Rotate the steps right">▶</button>
        <button class="seq-clear" title="All gates off">Clear</button>
        <span class="seq-len"></span>
      </div>
      <div class="seq-options" hidden></div>
      <div class="seq-body">
        <div class="seq-labels"><span style="top:${GATE[0] + 4}px">Gate</span><span style="top:${PITCH[0] + 40}px">Pitch</span><span style="top:${VEL[0] + 16}px">Vel</span></div>
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
      el.querySelector(".seq-rand").addEventListener("click", () => randomize(view));
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
      draw(view);
    },
  });
})();
