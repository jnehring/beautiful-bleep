// SPDX-License-Identifier: GPL-3.0-or-later
// Grains view (doc/specs/modules/grains.md §5): the buffer's waveform (oldest on
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

  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  function draw(view, st, tm) {
    const gv = view.gr, c = gv.wave;
    const { g, w, h } = BleepView.fit(c);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), accent = th.accent, text = th.text, muted = th.muted, line = th.line;
    const arrays = st.arrays, peaks = (arrays && arrays.peaks) || [], dots = (arrays && arrays.dots) || [];
    const pos = view.value(st, "position"), spread = view.value(st, "spread");
    const tex = view.value(st, "texture");
    // Position window: 0 % is the newest audio (right edge).
    const x0 = w * (1 - Math.min(1, pos + 0.25 * spread)), x1 = w * (1 - Math.max(0, pos - 0.25 * spread));
    const wg = g.createLinearGradient(0, 0, 0, h);
    wg.addColorStop(0, "transparent"); wg.addColorStop(0.5, line); wg.addColorStop(1, "transparent");
    g.fillStyle = wg;
    g.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    g.fillStyle = accent; g.globalAlpha = 0.5;
    g.fillRect(w * (1 - pos) - 0.5, 0, 1.5, h);  // the Position line
    g.globalAlpha = 1;
    // the buffer (oldest left, write head right): a mirrored glowing silhouette
    const bw = w / Math.max(peaks.length, 1);
    g.fillStyle = muted; g.globalAlpha = 0.7;
    for (let i = 0; i < peaks.length; i++) {
      const v = Math.min(1, peaks[i]) * (h / 2 - 3);
      g.fillRect(i * bw, h / 2 - v, Math.max(1, bw - 0.5), Math.max(1, 2 * v));
    }
    g.globalAlpha = 1;
    g.fillStyle = text;
    g.fillRect(w - 2, 0, 2, h);  // write head
    // grains: live ones as dots; without an engine (demo) a cloud from the params
    let list = [];
    if (dots.length) {
      for (let i = 0; i + 2 < dots.length; i += 3) list.push([dots[i], dots[i + 1], dots[i + 2], i / 3]);
    } else if (!arrays) {
      const dens = view.value(st, "density"), size = view.value(st, "size");
      const n = 6 + Math.round(dens * 40), dur = 0.4 + size * 1.6;
      for (let i = 0; i < n; i++) {
        const per = dur / n * (0.7 + 0.6 * hash(i)), start = i * per;
        const prog = ((tm - start) % dur + dur) % dur / dur;
        const k = Math.floor((tm - start) / dur);
        const off = (hash(i * 7.3 + k * 1.7) - 0.5) * 2 * 0.25 * spread * 2;
        list.push([Math.min(1, Math.max(0, pos + off)), prog, 0.5 + 0.5 * hash(i + k), i]);
      }
    }
    const gs = view.value(st, "size");
    const pj = view.value(st, "pitchjitter");
    g.globalCompositeOperation = "lighter";
    for (const [d, prog, gain, i] of list) {
      const x = w * (1 - d), env = windowAt(tex, prog);
      const lane = (hash(i * 3.1) - 0.5) * (0.5 + pj * 1.5) * (h - 20);  // pitch jitter spreads the lanes
      const y = h / 2 + Math.max(-h / 2 + 8, Math.min(h / 2 - 8, lane));
      const r = 1.5 + (2 + 8 * gs) * env;
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
      gr.addColorStop(0, accent); gr.addColorStop(1, "transparent");
      g.globalAlpha = Math.min(1, 0.15 + 0.85 * gain * env);
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r * 2.2, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    if (st.frozen > 0.5) {  // lock
      g.strokeStyle = text; g.fillStyle = text;
      g.beginPath(); g.arc(14, 11, 4, Math.PI, 0); g.stroke();
      g.fillRect(9, 11, 10, 8);
    }
    // Texture window.
    const sh = BleepView.fit(gv.shape), t = sh.g, tw = sh.w, th2 = sh.h;
    if (!tw) return;
    t.strokeStyle = accent;
    t.lineWidth = 2;
    BleepView.glow(t, accent, 6);
    t.beginPath();
    for (let x = 0; x <= tw; x++) {
      const y = th2 - 2 - windowAt(tex, x / tw) * (th2 - 4);
      x ? t.lineTo(x, y) : t.moveTo(x, y);
    }
    t.stroke();
    t.shadowBlur = 0;
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

  if (!document.getElementById("gr-style")) {
    const st = document.createElement("style");
    st.id = "gr-style";
    st.textContent = ".bleep-view.gr .bv-knob{width:58px}.bleep-view.gr .bv-knob svg{width:40px;height:40px}.bleep-view.gr .bv-sec-knobs{gap:2px 0}.bleep-view.gr .bv-label{font-size:9px;letter-spacing:.04em}";
    document.head.appendChild(st);
  }

  BleepViews.register("grains", {
    partNames: ["Grain display"],
    layout: [
      { title: "Position", params: ["position", "size", "pitch"] },
      { title: "Cloud", params: ["density", "texture"] },
      { title: "Scatter", params: ["spread", "pitchjitter", "reverse"] },
      { title: "Space", params: ["feedback", "blur"] },
      { title: "Mix", params: ["mix"] },
      { title: "Mode", params: ["mode", "sync", "buffer", "pitchquant", "maxgrains", "freeze", "seed"] },
    ],
    template:
      '<div class="bv-panel" style="width:100%;flex:1 1 100%"><canvas class="gr-wave" style="height:112px;cursor:crosshair;touch-action:none"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<canvas class="gr-shape" style="width:90px;height:28px;flex:none" title="Grain window (Texture)"></canvas>' +
      '<span class="gr-info" style="flex:1;color:var(--muted)"></span>' +
      '<button class="bv-button gr-keep" hidden>Keep frozen buffer</button></div></div>',
    afterBuild(view, el) {
      view.root.classList.add("gr");
      BleepView.loop(view.root, (t) => { if (view.gr.last) draw(view, view.gr.last, t); });
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
      view.gr.last = st;
    },
  });
})();
