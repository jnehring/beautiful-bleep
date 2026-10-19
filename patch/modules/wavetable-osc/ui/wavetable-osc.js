// SPDX-License-Identifier: GPL-3.0-or-later
// Wavetable Osc view (doc/specs/modules/wavetable-oscillator.md §5): the bank's
// grid of frame thumbnails with the played positions (L dot, R ring) and the
// path, the current cycle after warp (L and R), and the current row drawn as
// a stack. Dragging on the grid sets X and Y; a WAV dropped on Import (or the
// button clicked) becomes the user bank, a WAV dropped on a grid cell replaces
// that cell. Imports go to the media store; the node data keeps only ids.
(function () {
  "use strict";
  const GRID = 240, THUMB = 32;
  const CYCLES = [[0, "Auto"], [256, "256"], [512, "512"], [1024, "1024"], [2048, "2048"], [4096, "4096"]];
  const STYLE = `
    .wto-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 12px; }
    .wto-bank { font-weight: 600; min-width: 90px; }
    .wto-import { padding: 3px 10px; border: 1px dashed var(--line); border-radius: 4px; cursor: pointer; }
    .wto-note { color: var(--muted); font-size: 11px; flex: 1; text-align: right; }
    .wto-body { display: flex; gap: 10px; flex-wrap: wrap; }
    .wto-side { flex: 1 1 120px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .wto-grid { width: ${GRID}px; height: ${GRID}px; cursor: crosshair; touch-action: none; }
    .wto-grid.over { outline: 2px solid var(--accent); }
  `;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round((view.node.params[id] ?? p.default) * (p.steps - 1));
  };

  // patch::wtosc::pathCells: the order a path visits a cols × rows grid.
  function pathCells(path, cols, rows) {
    const out = [];
    const add = (c, r) => out.push([c, r]);
    if (path === 2) for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) add(r % 2 ? cols - 1 - k : k, r);
    else if (path === 3) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) add(c, r);
    else if (path === 4) {
      for (let d = 0; d <= cols + rows - 2; d++)
        for (let k = 0; k <= d; k++) { const r = d % 2 ? k : d - k, c = d - r; if (c < cols && r < rows) add(c, r); }
    } else if (path === 5) {
      let top = 0, bottom = rows - 1, left = 0, right = cols - 1;
      while (top <= bottom && left <= right) {
        for (let c = left; c <= right; c++) add(c, top);
        for (let r = top + 1; r <= bottom; r++) add(right, r);
        if (top < bottom) for (let c = right - 1; c >= left; c--) add(c, bottom);
        if (left < right) for (let r = bottom - 1; r > top; r--) add(left, r);
        top++; bottom--; left++; right--;
      }
    } else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) add(c, r);
    return out;
  }

  function canvas2d(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    w = w || c.clientWidth;
    h = h || c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function colours(view) {
    const css = getComputedStyle(view.root);
    const v = (k, d) => css.getPropertyValue(k).trim() || d;
    return { accent: v("--accent", "#818cf8"), line: v("--line", "#333"), muted: v("--muted", "#888"), text: v("--text", "#ddd") };
  }
  const dims = (view) => ({ cols: Math.max(1, view.wto.st.cols || 8), rows: Math.max(1, view.wto.st.rows || 8) });

  function drawGrid(view) {
    const c = view.root.querySelector(".wto-grid");
    if (!c) return;
    const { g } = canvas2d(c, GRID, GRID);
    const col = colours(view), st = view.wto.st, { cols, rows } = dims(view);
    const cw = GRID / cols, ch = GRID / rows, thumbs = view.wto.thumbs;
    g.strokeStyle = col.line;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        g.strokeRect(k * cw + 0.5, r * ch + 0.5, cw - 1, ch - 1);
        const f = r * cols + k;
        if (!thumbs || thumbs.length < (f + 1) * THUMB) continue;
        g.strokeStyle = col.muted;
        g.beginPath();
        for (let i = 0; i <= THUMB; i++) {
          const v = thumbs[f * THUMB + (i % THUMB)];
          const x = k * cw + 3 + (i / THUMB) * (cw - 6), y = r * ch + ch / 2 - clamp(v, -1, 1) * (ch / 2 - 4);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
        g.strokeStyle = col.line;
      }
    const at = (u, v) => [cw / 2 + u * (GRID - cw), ch / 2 + v * (GRID - ch)];
    const path = setting(view, "path");
    if (path > 0) {
      g.strokeStyle = col.accent;
      g.globalAlpha = 0.5;
      g.beginPath();
      pathCells(path, cols, rows).forEach(([k, r], i) => {
        const [x, y] = at(cols > 1 ? k / (cols - 1) : 0, rows > 1 ? r / (rows - 1) : 0);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      g.globalAlpha = 1;
    }
    if (typeof st.xR === "number" && (st.xR !== st.xL || st.yR !== st.yL)) {
      const [x, y] = at(st.xR, st.yR);
      g.strokeStyle = col.text;
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1;
    }
    if (typeof st.xL === "number") {
      const [x, y] = at(st.xL, st.yL);
      g.fillStyle = col.accent;
      BleepView.glow(g, col.accent, 14);
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    }
  }

  function drawWave(view) {
    const c = view.root.querySelector(".wto-wave");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const col = colours(view), a = view.wto.arrays;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col.line;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    const line = (v, colour, width) => {
      if (!v || !v.length) return;
      g.strokeStyle = colour;
      g.lineWidth = width;
      if (width > 1) BleepView.glow(g, colour, 10);
      g.beginPath();
      for (let i = 0; i <= v.length; i++) {
        const x = (i / v.length) * w, y = h / 2 - clamp(v[i % v.length], -1.1, 1.1) * (h / 2 - 4) / 1.1;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0;
    };
    line(a.waveR, col.muted, 1);
    line(a.waveL, col.accent, 2);
    g.lineWidth = 1;
  }

  function drawStack(view) {
    const c = view.root.querySelector(".wto-stack");
    if (!c || !c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const col = colours(view), thumbs = view.wto.thumbs, { cols, rows } = dims(view);
    if (!thumbs) return;
    const row = clamp(Math.round((view.wto.st.yL || 0) * (rows - 1)), 0, rows - 1);
    const playing = Math.round((view.wto.st.xL || 0) * (cols - 1));
    const depth = Math.min(cols, 8), dx = 7, dy = 6;
    const fw = w - dx * (depth - 1) - 4, fh = h - dy * (depth - 1) - 4;
    for (let k = depth - 1; k >= 0; k--) {  // back to front
      const f = row * cols + k;
      if (thumbs.length < (f + 1) * THUMB) continue;
      const ox = 2 + k * dx, oy = 2 + (depth - 1 - k) * dy;
      g.fillStyle = getComputedStyle(view.root).getPropertyValue("--panel").trim() || "rgba(0,0,0,0.6)";
      g.strokeStyle = k === playing ? col.accent : col.muted;
      g.lineWidth = k === playing ? 2 : 1;
      if (k === playing) BleepView.glow(g, col.accent, 10);
      g.beginPath();
      for (let i = 0; i <= THUMB; i++) {
        const x = ox + (i / THUMB) * fw, y = oy + fh / 2 - clamp(thumbs[f * THUMB + (i % THUMB)], -1, 1) * (fh / 2 - 2);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0;
    }
    g.lineWidth = 1;
  }

  function drawBar(view) {
    const st = view.wto.st, p = view.type.params.find((x) => x.id === "bank");
    const bank = typeof st.bank === "number" ? st.bank : setting(view, "bank");
    const data = view.node.data || {};
    let name = (p && p.choices && p.choices[bank]) || "";
    if (bank === 0) name = "User" + (data.name ? ": " + data.name : " (sine)");
    view.root.querySelector(".wto-bank").textContent = name;
    let note = "";
    if (st.userError) note = "That file could not be used (silent or unreadable).";
    else if (bank === 0 && st.userCycles > 64) note = `${st.userCycles} cycles in the file: the first 64 are used.`;
    else if (bank === 0 && st.userFrames) note = `${st.userFrames} frame${st.userFrames === 1 ? "" : "s"}`;
    view.root.querySelector(".wto-note").textContent = note;
    const sel = view.root.querySelector(".wto-cycle");
    if (sel && document.activeElement !== sel) sel.value = String(data.cycle || 0);
  }

  function draw(view) {
    drawBar(view);
    drawGrid(view);
    drawWave(view);
    drawStack(view);
  }

  /// Imports a dropped file into the media store; returns {id, name} or null.
  async function importFile(view, file) {
    if (!file || !/\.wav$/i.test(file.name)) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const r = await view.api.importMedia(file.name, btoa(bin));
    return r && !r.error ? r : null;
  }
  function setData(view, patch) {
    const data = Object.assign({}, view.node.data || {}, patch);
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    view.api.beginGesture();
    view.node.data = data;
    view.api.setData(JSON.parse(JSON.stringify(data)));
    draw(view);
  }

  function attachGrid(view, c) {
    let dragging = false;
    const set = (e) => {
      const r = c.getBoundingClientRect(), { cols, rows } = dims(view);
      const cw = r.width / cols, ch = r.height / rows;
      const u = clamp((e.clientX - r.left - cw / 2) / (r.width - cw || 1), 0, 1);
      const v = clamp((e.clientY - r.top - ch / 2) / (r.height - ch || 1), 0, 1);
      view.api.setParam("x", u);
      view.api.setParam("y", v);
      view.node.params.x = u;
      view.node.params.y = v;
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();  // X and Y together: one gesture
      dragging = true;
      set(e);
    });
    c.addEventListener("pointermove", (e) => { if (dragging) set(e); });
    const end = () => (dragging = false);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    // A WAV dropped on a cell replaces that cell (its first cycle).
    c.addEventListener("dragover", (e) => { e.preventDefault(); c.classList.add("over"); });
    c.addEventListener("dragleave", () => c.classList.remove("over"));
    c.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      c.classList.remove("over");
      const r = c.getBoundingClientRect();
      const k = clamp(Math.floor(((e.clientX - r.left) / r.width) * 8), 0, 7), row = clamp(Math.floor(((e.clientY - r.top) / r.height) * 8), 0, 7);
      const got = await importFile(view, e.dataTransfer && e.dataTransfer.files[0]);
      if (!got) return;
      const cells = Object.assign({}, (view.node.data || {}).cells || {});
      cells[String(row * 8 + k)] = got.id;
      setData(view, { cells });
      view.api.setParam("bank", 0);  // the user bank
    });
  }

  BleepViews.register("wavetable-osc", {
    width: 940,
    side: true,
    layout: [
      { title: "Pitch", params: ["octave", "coarse", "fine"] },
      { title: "Table", params: ["bank", "x", "y", "scan", "path", "blend", "read"] },
      { title: "Warp", params: ["warp", "fmDepth", "warpMode"] },
      { title: "Output", params: ["stereo", "subLevel", "quality"] },
    ],
    template: `
      <div class="bv-panel">
        <div class="wto-bar">
          <span class="wto-bank"></span>
          <span class="wto-import" title="Drop a WAV of single cycles here, or click to choose one">Import…</span>
          <label>Cycle <select class="wto-cycle bv-number">${CYCLES.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
          <span class="wto-note"></span>
        </div>
        <div class="wto-body">
          <canvas class="wto-grid" title="Drag: X and Y. Drop a WAV on a cell to replace it."></canvas>
          <div class="wto-side">
            <h2>Waveform</h2><canvas class="wto-wave" style="height:112px"></canvas>
            <h2>Row</h2><canvas class="wto-stack" style="height:112px"></canvas>
          </div>
        </div>
      </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("wto-style")) {
        const s = document.createElement("style");
        s.id = "wto-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.wto = { st: {}, arrays: {}, thumbs: null };
      const grid = el.querySelector(".wto-grid");
      grid.style.width = GRID + "px";
      grid.style.height = GRID + "px";
      attachGrid(view, grid);
      BleepView.mediaDrop(el.querySelector(".wto-import"), view.api, (r) => {
        setData(view, { sample: r.id, name: r.name, cells: undefined });
        view.api.setParam("bank", 0);
      }, (msg) => (el.querySelector(".wto-note").textContent = msg));
      el.querySelector(".wto-cycle").addEventListener("change", (e) => setData(view, { cycle: parseInt(e.target.value, 10) || 0 }));
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.wto) return;
      view.wto.st = st || {};
      if (st && st.arrays) {
        if (st.arrays.thumbs) view.wto.thumbs = st.arrays.thumbs;
        view.wto.arrays = st.arrays;
      }
      draw(view);
    },
    onRefresh(view) { if (view.wto) draw(view); },
  });
})();
