// SPDX-License-Identifier: GPL-3.0-or-later
// Recall view (doc/specs/modules/recall.md §5): the T lane (the last T Loop ticks
// with T1/T2 hits; ● repeated, ○ fresh, ◆ from a captured loop), the X lane
// (X1–X3 over the last 32 draws, allowed scale notes as grey lines when
// quantizing), a preview of the X distribution (computed here, as
// dsp::spreadBias), and Use toggles for the captured loops.
// The Capture T / Capture X buttons (module buttons) snapshot a ring on the
// audio thread; when a new snapshot shows up here it is written into the
// node data with Use on (one undo step).
(function () {
  "use strict";
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const setting = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
  };
  /// As dsp::spreadBias (Random.h).
  function spreadBias(u0, u1, u2, spread, bias) {
    const bell = (u0 + u1 + u2) * (2 / 3) - 1, flat = 2 * u0 - 1;
    let v;
    if (spread <= 0.5) v = bell * 2 * spread;
    else if (spread <= 0.85) v = bell + ((spread - 0.5) / 0.35) * (flat - bell);
    else { const t = (spread - 0.85) / 0.15; v = flat + t * (Math.sign(flat || 1) * Math.sqrt(Math.abs(flat)) - flat); }
    const x = Math.pow(Math.min(1, Math.max(0, 0.5 * (v + 1))), Math.pow(4, -(2 * bias - 1)));
    return 2 * x - 1;
  }
  const rnd = (k) => { const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };  // preview only
  /// Thinned scale (as RecallDsp::thinnedScale), as semitones above the root.
  function thinned(scale, steps) {
    const notes = SCALES[scale] || SCALES[1], n = notes.length;
    if (steps <= 0.7 || n <= 1) return notes;
    const drop = Math.min(n - 1, Math.floor(((steps - 0.7) / 0.3) * (n - 1) + 1e-9));
    let order = [];
    if (n === 7) order = [2, 6, 4, 7, 3, 5];
    else for (let lo = 2, hi = n; lo <= hi;) { order.push(hi--); if (lo <= hi) order.push(lo++); }
    const gone = new Set(order.slice(0, drop).map((d) => notes[d - 1]));
    return notes.filter((s) => !gone.has(s));
  }
  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    for (const k of ["t", "x"]) if (!d[k] || typeof d[k] !== "object") d[k] = { use: false, loop: [] };
    view.node.data = d;
    return d;
  }
  function save(view, fn) {
    view.api.beginGesture();
    const d = data(view);
    fn(d);
    view.api.setData(JSON.parse(JSON.stringify(d)));
    view.rc.useT.classList.toggle("on", !!d.t.use);
    view.rc.useX.classList.toggle("on", !!d.x.use);
  }

  function draw(view) {
    const r = view.rc, c = r && r.canvas;
    if (!c || !c.clientWidth) return;
    const st = r.state || {}, a = st.arrays || {};
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim();
    const muted = css.getPropertyValue("--muted").trim(), text = css.getPropertyValue("--text").trim();
    g.font = "9px system-ui, sans-serif";
    // T lane
    const loop = Math.min(16, Math.max(1, setting(view, "tloop"))), lanes = a.lanes || [];
    const cw = (w - 20) / 16;
    g.fillStyle = muted; g.fillText("T", 2, 18);
    for (let i = 0; i < loop; i++) {
      const code = lanes[16 - loop + i] || 0, x = 14 + i * cw;
      g.fillStyle = accent;
      if (code & 1) g.fillRect(x + 2, 4, cw - 4, 9); else { g.strokeStyle = line; g.strokeRect(x + 2.5, 4.5, cw - 5, 8); }
      if (code & 2) g.fillRect(x + 2, 16, cw - 4, 9); else { g.strokeStyle = line; g.strokeRect(x + 2.5, 16.5, cw - 5, 8); }
      g.fillStyle = text; g.textAlign = "center";
      g.fillText(code & 8 ? "◆" : code & 4 ? "●" : "○", x + cw / 2, 36);
      g.textAlign = "left";
    }
    // X lane
    const top = 44, bot = 120, range = setting(view, "xrange"), steps = view.value(st, "xsteps");
    const lo = range === 1 ? 0 : range === 2 ? -2 : -1, hi = range === 1 ? 1 : range === 2 ? 2 : 1;
    const y = (v) => bot - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (bot - top);
    const xw = w - 110;
    g.fillStyle = muted; g.fillText("X", 2, top + 10);
    if (steps > 0.55) {
      const root = setting(view, "root"), notes = thinned(setting(view, "scale"), steps);
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath();
      for (let s = Math.floor(lo * 12) - 12; s <= hi * 12 + 12; s++)
        if (notes.includes((((s - root) % 12) + 12) % 12) && s / 12 >= lo && s / 12 <= hi) { g.moveTo(14, y(s / 12) + 0.5); g.lineTo(14 + xw, y(s / 12) + 0.5); }
      g.stroke();
    }
    [a.x1, a.x2, a.x3].forEach((arr, k) => {
      if (!arr) return;
      g.strokeStyle = k === 0 ? accent : k === 1 ? text : muted; g.lineWidth = k === 0 ? 2 : 1.25;
      g.shadowColor = accent; g.shadowBlur = k === 0 ? 8 : 0;
      g.beginPath();
      arr.forEach((v, i) => {
        const x = 14 + (i / 32) * xw;
        if (!i) g.moveTo(x, y(v)); else g.lineTo(x, y(arr[i - 1]));
        g.lineTo(x + xw / 32, y(v));
      });
      g.stroke();
      g.shadowBlur = 0;
    });
    // distribution preview
    const spread = view.value(st, "xspread"), bias = view.value(st, "xbias");
    const bins = new Array(20).fill(0);
    for (let i = 0; i < 3000; i++) {
      const v = spreadBias(rnd(i * 3), rnd(i * 3 + 1), rnd(i * 3 + 2), spread, bias);
      bins[Math.min(19, Math.floor(((v + 1) / 2) * 20))]++;
    }
    const peak = Math.max(...bins), x0 = w - 90;
    g.fillStyle = accent; g.globalAlpha = 0.7;
    bins.forEach((b, i) => { const bh = (b / peak) * (bot - top - 12); g.fillRect(x0 + i * 4.3, bot - bh, 3.3, bh); });
    g.globalAlpha = 1;
    g.fillStyle = muted; g.fillText("distribution", x0, top + 8);
  }

  /// A new snapshot from a Capture button: rows of `width` numbers into the data, Use on.
  function adopt(view, key, st, width) {
    const count = st[key + "Captures"], arr = st.arrays && st.arrays[key + "Capture"];
    if (typeof count !== "number") return;
    if (view.rc.seen[key] === undefined) { view.rc.seen[key] = count; return; }
    if (count === view.rc.seen[key] || !arr) return;
    view.rc.seen[key] = count;
    const rows = [];
    for (let i = 0; i + width <= arr.length; i += width) rows.push(arr.slice(i, i + width).map((v) => Math.round(v * 1e6) / 1e6));
    save(view, (d) => (d[key] = { use: true, loop: rows }));
  }

  const STYLE = `
    .rc-tools { display: flex; gap: 4px; margin-top: 4px; }
    .rc-tools button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px;
      padding: 1px 8px; font: inherit; font-size: 11px; cursor: pointer; }
    .rc-tools button.on { border-color: var(--accent); background: var(--accent); color: var(--panel); }`;

  BleepViews.register("recall", {
    partNames: ["Loops"],
    top: true,
    width: 920,
    layout: [
      { title: "T · gates", params: ["tmode", "tloop", "tbias", "tjitter", "trecall", "gatelength"] },
      { title: "X · voltages", params: ["xsource", "xmode", "xrange", "xloop", "xspread", "xbias", "xsteps", "xrecall"] },
      { title: "Clock & pitch", params: ["syncto", "sync", "rate", "root", "scale", "seed"] },
    ],
    template: `<div class="bv-panel" style="flex:1 1 100%">
      <canvas style="width:100%;height:124px"></canvas>
      <div class="rc-tools">
        <button class="rc-use-t" title="Play the captured T loop instead of the ring">◉ Use T</button>
        <button class="rc-use-x" title="Play the captured X loop instead of the ring">◉ Use X</button>
      </div>
    </div>`,
    afterBuild(view, el) {
      if (!document.getElementById("rc-style")) {
        const s = document.createElement("style");
        s.id = "rc-style";
        s.textContent = STYLE;
        document.head.appendChild(s);
      }
      view.rc = { canvas: el.querySelector("canvas"), useT: el.querySelector(".rc-use-t"), useX: el.querySelector(".rc-use-x"),
                  state: null, seen: {} };
      const d = data(view);
      view.rc.useT.classList.toggle("on", !!d.t.use);
      view.rc.useX.classList.toggle("on", !!d.x.use);
      view.rc.useT.addEventListener("click", () => save(view, (x) => (x.t.use = !x.t.use)));
      view.rc.useX.addEventListener("click", () => save(view, (x) => (x.x.use = !x.x.use)));
      requestAnimationFrame(() => draw(view));
    },
    onState(st, view) {
      if (!view.rc) return;
      view.rc.state = st;
      adopt(view, "t", st, 4);
      adopt(view, "x", st, 9);
      draw(view);
    },
    onRefresh(view) {
      const d = data(view);
      view.rc.useT.classList.toggle("on", !!d.t.use);
      view.rc.useX.classList.toggle("on", !!d.x.use);
      draw(view);
    },
  });
})();
