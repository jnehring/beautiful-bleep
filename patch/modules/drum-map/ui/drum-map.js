// SPDX-License-Identifier: MIT
// Drum Map view (doc/specs/modules/drum-map.md §5): the map pad (drag the puck to
// set X and Y; the modulated position with a trail; edited nodes marked), and
// three lanes with the pattern as it plays now — levels as bars, each voice's
// threshold, hits (accents bolder) and the playhead. Edit node: pick a node
// on the pad and draw its levels; edited nodes live in the node's data.
(function () {
  "use strict";
  const GRID = 5, STEPS = 32, VOICES = ["Kick", "Snare", "Hats"], KEYS = ["kick", "snare", "hats"];
  const PAD = 160, LANE_COL = 11, LANE = 46, LANES_H = VOICES.length * LANE + 14;
  let COL = LANE_COL;  // follows the room the lanes have
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function data(view) {
    let d = view.node.data;
    if (!d || typeof d.nodes !== "object" || Array.isArray(d.nodes) || d.nodes === null) d = view.node.data = { nodes: {} };
    return d;
  }
  const knob = (view, id) => view.node.params[id] ?? (view.type.params.find((p) => p.id === id) || {}).default ?? 0;
  const colors = (view) => {
    const css = getComputedStyle(view.root);
    return { accent: css.getPropertyValue("--accent").trim() || "#f08a4b", line: css.getPropertyValue("--line").trim() || "#333",
             muted: css.getPropertyValue("--muted").trim() || "#888", text: css.getPropertyValue("--text").trim() || "#ddd" };
  };
  function sizeCanvas(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px"; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  }
  const nodeXY = (i) => [8 + (i % GRID) * ((PAD - 16) / (GRID - 1)), 8 + Math.floor(i / GRID) * ((PAD - 16) / (GRID - 1))];
  const toPad = (x, y) => [8 + clamp(x, 0, 1) * (PAD - 16), 8 + clamp(y, 0, 1) * (PAD - 16)];

  // ---- the map pad ------------------------------------------------------------
  function drawPad(view) {
    const dm = view.dm, g = sizeCanvas(dm.pad, PAD, PAD), c = colors(view), st = dm.state || {};
    g.strokeStyle = c.line;
    g.strokeRect(0.5, 0.5, PAD - 1, PAD - 1);
    const edited = st.edited || 0;
    for (let i = 0; i < GRID * GRID; i++) {
      const [x, y] = nodeXY(i);
      g.fillStyle = (edited >>> i) & 1 ? c.accent : c.muted;
      g.beginPath();
      g.arc(x, y, (edited >>> i) & 1 ? 3 : 1.5, 0, Math.PI * 2);
      g.fill();
      if (dm.editing && i === dm.node) { g.strokeStyle = c.text; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke(); }
    }
    // the trail and the modulated position
    g.fillStyle = c.accent;
    dm.trail.forEach(([tx, ty], k) => {
      const [x, y] = toPad(tx, ty);
      g.globalAlpha = (k + 1) / (dm.trail.length + 1) * 0.5;
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    });
    g.globalAlpha = 1;
    const [kx, ky] = toPad(knob(view, "x"), knob(view, "y"));
    {  // a soft halo round the playing position
      const [hx, hy] = typeof st.px === "number" ? toPad(st.px, st.py) : [kx, ky];
      const gr = g.createRadialGradient(hx, hy, 0, hx, hy, 42);
      gr.addColorStop(0, c.accent + "55"); gr.addColorStop(1, c.accent + "00");
      g.fillStyle = gr; g.fillRect(0, 0, PAD, PAD); g.fillStyle = c.accent;
    }
    if (typeof st.px === "number") {
      const [mx, my] = toPad(st.px, st.py);
      g.beginPath(); g.arc(mx, my, 5, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = c.text;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(kx, ky, 7, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1;
  }
  function attachPad(view) {
    const dm = view.dm, c = dm.pad;
    let dragging = false;
    const set = (e) => {
      const r = c.getBoundingClientRect();
      const x = clamp((e.clientX - r.left - 8) / (PAD - 16), 0, 1), y = clamp((e.clientY - r.top - 8) / (PAD - 16), 0, 1);
      view.node.params.x = x;
      view.node.params.y = y;
      view.api.setParam("x", x);
      view.api.setParam("y", y);
      drawPad(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (dm.editing) {  // pick the nearest node
        const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        let best = 0, bd = Infinity;
        for (let i = 0; i < GRID * GRID; i++) {
          const [x, y] = nodeXY(i), d2 = (x - px) ** 2 + (y - py) ** 2;
          if (d2 < bd) bd = d2, best = i;
        }
        dm.node = best;
        view.api.command("editnode", best);
        drawPad(view);
        return;
      }
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      dragging = true;
      set(e);
    });
    c.addEventListener("pointermove", (e) => { if (dragging) set(e); });
    const end = () => (dragging = false);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  // ---- the lanes ----------------------------------------------------------------
  /// The levels the lanes show: the edited node's while editing, else the live pattern.
  function levels(view) {
    const dm = view.dm, st = dm.state || {}, arr = st.arrays || {};
    if (dm.editing) {
      const key = (dm.node % GRID) + "," + Math.floor(dm.node / GRID), user = data(view).nodes[key];
      if (user) return KEYS.flatMap((k) => user[k]);  // the data is the truth for edited nodes
      return arr.node && arr.node.length === STEPS * 3 ? arr.node : null;
    }
    return arr.levels && arr.levels.length === STEPS * 3 ? arr.levels : null;
  }
  function drawLanes(view) {
    const dm = view.dm, room = dm.lanes.parentElement.clientWidth;
    if (room > 0) COL = clamp(Math.floor((room - 2) / STEPS), LANE_COL, 22);
    const w = STEPS * COL + 2, g = sizeCanvas(dm.lanes, w, LANES_H), c = colors(view), st = dm.state || {};
    const lv = levels(view), dens = [st.kd, st.sd, st.hd], acc = (typeof st.accent === "number" ? st.accent : 0.78) * 255;
    g.font = "8px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let v = 0; v < VOICES.length; v++) {
      const y0 = v * LANE, bot = y0 + LANE - 6, h = LANE - 14;
      const T = typeof dens[v] === "number" ? (1 - dens[v]) * 255 : null;
      for (let s = 0; s < STEPS; s++) {
        const x = s * COL, L = lv ? lv[v * STEPS + s] : 0;
        if (!dm.editing && s === st.step) { g.fillStyle = c.line; g.fillRect(x, y0, COL, LANE - 2); }
        const hit = !dm.editing && T !== null && L > T && L > 0;
        g.fillStyle = c.accent;
        g.globalAlpha = hit ? 0.9 : 0.35;
        const bh = (L / 255) * h;
        g.fillRect(x + 2, bot - bh, COL - 4, bh);
        g.globalAlpha = 1;
        if (hit) {
          g.fillStyle = L >= acc ? c.text : c.accent;
          g.fillRect(x + 2, y0 + 2, COL - 4, L >= acc ? 6 : 4);
        }
      }
      if (T !== null && !dm.editing) {
        const ty = bot - (T / 255) * h;
        g.strokeStyle = c.text;
        g.globalAlpha = 0.6;
        g.beginPath(); g.moveTo(0, ty + 0.5); g.lineTo(w, ty + 0.5); g.stroke();
        g.globalAlpha = 1;
      }
      g.strokeStyle = c.line;
      g.beginPath(); g.moveTo(0, y0 + LANE - 1.5); g.lineTo(w, y0 + LANE - 1.5); g.stroke();
    }
    g.fillStyle = c.muted;
    for (let s = 0; s < STEPS; s += 4) g.fillText(String(s + 1), s * COL + COL / 2, LANES_H - 6);
    g.strokeStyle = c.line;
    g.beginPath();
    for (let s = 4; s < STEPS; s += 4) { g.moveTo(s * COL + 0.5, 0); g.lineTo(s * COL + 0.5, LANES_H - 12); }
    g.stroke();
    dm.info.textContent = dm.editing ? `editing node ${(dm.node % GRID) + 1},${Math.floor(dm.node / GRID) + 1}` : "";
  }
  function attachLanes(view) {
    const dm = view.dm, c = dm.lanes;
    let drag = false;
    const apply = (e) => {
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const v = clamp(Math.floor(y / LANE), 0, 2), s = clamp(Math.floor(x / COL), 0, STEPS - 1);
      const bot = v * LANE + LANE - 6, h = LANE - 14;
      const L = clamp(Math.round(((bot - y) / h) * 255), 0, 255);
      const key = (dm.node % GRID) + "," + Math.floor(dm.node / GRID), d = data(view);
      if (!d.nodes[key]) {  // start from the node as it is
        const base = levels(view);
        if (!base) return;
        d.nodes[key] = Object.fromEntries(KEYS.map((k, i) => [k, Array.from(base.slice(i * STEPS, (i + 1) * STEPS), Math.round)]));
      }
      d.nodes[key][KEYS[v]][s] = L;
      view.api.setData(JSON.parse(JSON.stringify(d)));
      drawLanes(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !dm.editing) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      drag = true;
      apply(e);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => (drag = false);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  const STYLE = `
    .dm-panel { flex: 1 1 100%; min-width: 0; }
    .dm-body { display: flex; gap: 10px; align-items: flex-start; }
    .dm-pad { flex: none; touch-action: none; cursor: crosshair; }
    .dm-right { flex: 1; min-width: 0; }
    .dm-lanes-wrap { display: flex; }
    .dm-labels { width: 36px; flex: none; font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
    .dm-labels div { height: ${LANE}px; display: flex; align-items: center; }
    .dm-scroll { overflow-x: auto; flex: 1; min-width: 0; }
    .dm-scroll canvas { display: block; touch-action: none; }
    .dm-tools { display: flex; gap: 4px; align-items: center; margin-top: 6px; font-size: 11px; color: var(--muted); }
    .dm-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer; }
    .dm-tools button.on { border-color: var(--accent); color: var(--accent); }`;

  BleepViews.register("drum-map", {
    partNames: ["Map and lanes"],
    top: true,
    width: 900,
    hideParams: ["x", "y"],  // the pad is the X / Y control
    layout: [
      { title: "Density", params: ["kickdensity", "snaredensity", "hatsdensity", "fillamount"] },
      { title: "Feel", params: ["chaos", "accent", "swing", "notelength"] },
      { title: "Clock", params: ["syncto", "rate", "length", "chaosrate", "seed"] },
      { title: "Output notes", params: ["kicknote", "snarenote", "hatsnote"] },
    ],
    template: `<div class="bv-panel dm-panel">
      <div class="dm-body">
        <canvas class="dm-pad" title="Drag to set X and Y"></canvas>
        <div class="dm-right">
          <div class="dm-lanes-wrap">
            <div class="dm-labels">${VOICES.map((v) => `<div>${v}</div>`).join("")}</div>
            <div class="dm-scroll"><canvas class="dm-lanes"></canvas></div>
          </div>
          <div class="dm-tools">
            <button class="dm-edit" title="Pick a node on the map and draw its levels">Edit node</button>
            <button class="dm-reset" title="Back to the factory node">Reset node</button>
            <span class="dm-info"></span>
          </div>
        </div>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("dm-style")) {
        const s = document.createElement("style");
        s.id = "dm-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.dm = { pad: el.querySelector(".dm-pad"), lanes: el.querySelector(".dm-lanes"), info: el.querySelector(".dm-info"),
                  state: null, editing: false, node: 6, trail: [] };
      attachPad(view);
      attachLanes(view);
      const editBtn = el.querySelector(".dm-edit");
      editBtn.addEventListener("click", () => {
        view.dm.editing = !view.dm.editing;
        editBtn.classList.toggle("on", view.dm.editing);
        view.api.command("editnode", view.dm.editing ? view.dm.node : -1);
        drawPad(view);
        drawLanes(view);
      });
      el.querySelector(".dm-reset").addEventListener("click", () => {
        const dm = view.dm, key = (dm.node % GRID) + "," + Math.floor(dm.node / GRID), d = data(view);
        if (!d.nodes[key]) return;
        view.api.beginGesture();
        delete d.nodes[key];
        view.api.setData(JSON.parse(JSON.stringify(d)));
        drawLanes(view);
      });
      requestAnimationFrame(() => { drawPad(view); drawLanes(view); });
    },
    onState(st, view) {
      const dm = view.dm;
      if (!dm) return;
      dm.state = st;
      if (typeof st.px === "number") {
        const last = dm.trail[dm.trail.length - 1];
        if (!last || Math.abs(last[0] - st.px) + Math.abs(last[1] - st.py) > 0.004) dm.trail.push([st.px, st.py]);
        if (dm.trail.length > 12) dm.trail.shift();
      }
      drawPad(view);
      drawLanes(view);
    },
    onRefresh(view) {
      if (!view.dm) return;
      drawPad(view);
      drawLanes(view);
    },
  });
})();
