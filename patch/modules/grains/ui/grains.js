// SPDX-License-Identifier: MIT
// Grains view (specs/modules/grains.md §5): the buffer's waveform (oldest on
// the left, the write head on the right), the Position window (± the Spread
// jitter) shaded, every live grain as a dot (size = its window, brightness =
// gain), a lock while frozen, and the Texture window shape. Dragging on the
// waveform sets Position (horizontally) and Size (vertically). While frozen,
// "Keep frozen buffer" saves the buffer to the media folder and stores its id
// in the node's data, so it comes back with the board.
(function () {
  "use strict";
  // Window shapes along Texture, as dsp::grainWindowTables in Grains.h.
  function windowAt(texture, x) {
    const edge = Math.min(x, 1 - x);
    const rect = edge >= 0.05 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * edge) / 0.05);
    const trap = Math.min(edge / 0.25, 1);
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    const g0 = Math.exp(-0.5 * (0.5 / 0.15) ** 2);
    const gauss = (Math.exp(-0.5 * ((x - 0.5) / 0.15) ** 2) - g0) / (1 - g0);
    const att = x < 0.02 ? Math.sin((0.5 * Math.PI * x) / 0.02) : 1;
    const tail = x > 0.9 ? 0.5 + 0.5 * Math.cos((Math.PI * (x - 0.9)) / 0.1) : 1;
    const perc = att * Math.exp(-5 * Math.max(x - 0.02, 0)) * tail;
    const v = [rect, trap, hann, gauss, perc];
    const s = Math.min(Math.max(texture, 0), 1) * 4, a = Math.min(Math.floor(s), 3), f = s - a;
    return v[a] + f * (v[a + 1] - v[a]);
  }
  const param = (view, id) => view.type.params.find((p) => p.id === id);

  function sizeCanvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return [g, w, h];
  }

  function draw(view, st) {
    const gv = view.gr, c = gv.wave;
    if (!c.clientWidth) return;
    const [g, w, h] = sizeCanvas(c);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), text = css.getPropertyValue("--text").trim();
    const muted = css.getPropertyValue("--muted").trim(), line = css.getPropertyValue("--line").trim();
    const peaks = (st.arrays && st.arrays.peaks) || [], dots = (st.arrays && st.arrays.dots) || [];
    const pos = view.value(st, "position"), spread = view.value(st, "spread");
    // Position window: 0 % is the newest audio (right edge).
    const x0 = w * (1 - Math.min(1, pos + 0.25 * spread)), x1 = w * (1 - Math.max(0, pos - 0.25 * spread));
    g.fillStyle = line;
    g.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    g.fillStyle = muted;
    const bw = w / Math.max(peaks.length, 1);
    for (let i = 0; i < peaks.length; i++) {
      const v = Math.min(1, peaks[i]) * (h / 2 - 2);
      g.fillRect(i * bw, h / 2 - v, Math.max(1, bw - 0.5), Math.max(1, 2 * v));
    }
    g.fillStyle = text;
    g.fillRect(w - 2, 0, 2, h);  // write head
    g.fillStyle = accent;
    const tex = view.value(st, "texture");
    for (let i = 0; i + 2 < dots.length; i += 3) {
      const x = w * (1 - dots[i]), env = windowAt(tex, dots[i + 1]);
      g.globalAlpha = 0.25 + 0.75 * dots[i + 2] * env;
      g.beginPath();
      g.arc(x, h / 2 + (((i / 3) * 37) % 23) - 11, 2 + 4 * env, 0, 2 * Math.PI);
      g.fill();
    }
    g.globalAlpha = 1;
    if (st.frozen > 0.5) {  // lock
      g.strokeStyle = text; g.fillStyle = text;
      g.beginPath(); g.arc(14, 11, 4, Math.PI, 0); g.stroke();
      g.fillRect(9, 11, 10, 8);
    }
    // Texture window.
    const [t, tw, th] = sizeCanvas(gv.shape);
    t.strokeStyle = accent;
    t.lineWidth = 2;
    t.beginPath();
    for (let x = 0; x <= tw; x++) {
      const y = th - 2 - windowAt(tex, x / tw) * (th - 4);
      x ? t.lineTo(x, y) : t.moveTo(x, y);
    }
    t.stroke();
  }

  function setParam(view, id, units) {
    const p = param(view, id);
    let v;
    if (id === "size") v = Math.log(units / p.min) / Math.log(p.max / p.min);  // exponential
    else v = (units - p.min) / (p.max - p.min);
    v = Math.min(1, Math.max(0, v));
    view.node.params[id] = v;
    view.api.setParam(id, v);
  }

  BleepViews.register("grains", {
    top: true,
    template:
      '<div class="bv-panel"><canvas class="gr-wave" style="height:90px;cursor:crosshair;touch-action:none"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<canvas class="gr-shape" style="width:80px;height:28px;flex:none"></canvas>' +
      '<span class="gr-info" style="flex:1;color:var(--muted)"></span>' +
      '<button class="bv-button gr-keep" hidden>Keep frozen buffer</button></div></div>',
    afterBuild(view, el) {
      const gv = (view.gr = {
        wave: el.querySelector(".gr-wave"), shape: el.querySelector(".gr-shape"),
        info: el.querySelector(".gr-info"), keep: el.querySelector(".gr-keep"),
      });
      let drag = null;
      gv.wave.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        gv.wave.setPointerCapture(e.pointerId);
        const p = param(view, "size");
        const n = view.node.params.size ?? p.default;
        drag = { y: e.clientY, size: p.min * Math.pow(p.max / p.min, n) };
        view.api.beginGesture();
        move(e);
      });
      const move = (e) => {
        if (!drag) return;
        const r = gv.wave.getBoundingClientRect();
        setParam(view, "position", 1 - (e.clientX - r.left) / r.width);
        const p = param(view, "size");
        setParam(view, "size", Math.min(p.max, Math.max(p.min, drag.size * Math.pow(2, (drag.y - e.clientY) / 40))));
      };
      gv.wave.addEventListener("pointermove", move);
      const end = () => (drag = null);
      gv.wave.addEventListener("pointerup", end);
      gv.wave.addEventListener("pointercancel", end);
      gv.keep.addEventListener("click", async () => {
        gv.keep.disabled = true;
        try {
          const r = await view.api.exportMedia("frozen");
          if (r && r.id) {
            view.node.data = { frozen: r.id };
            view.api.setData(view.node.data);
          } else gv.keep.title = (r && r.error) || "Nothing to keep";
        } finally {
          gv.keep.disabled = false;
        }
      });
    },
    onState(st, view) {
      if (!view.gr || !st) return;
      const frozen = st.frozen > 0.5, kept = !!(view.node.data && view.node.data.frozen);
      view.gr.keep.hidden = !frozen || kept;
      if (frozen) view.gr.wasFrozen = true;
      else if (kept && view.gr.wasFrozen) {  // unfrozen: the kept buffer is no longer used
        view.gr.wasFrozen = false;
        view.node.data = { frozen: "" };
        view.api.setData(view.node.data);
      }
      view.gr.info.textContent = (st.grains || 0) + " grains" + (frozen ? " · frozen" : "") + (kept ? " · kept" : "");
      draw(view, st);
    },
  });
})();
