// SPDX-License-Identifier: GPL-3.0-or-later
// Bender view (doc/specs/modules/bender.md §5): with transport sync, the
// decisions of the current and the next bar (computed from the same seeded
// hash as the audio, so you see what Chance and Seed will do before it
// happens) with the playing segment marked; otherwise the recent segments.
// Below: the read head inside the source segment, and the latched Freeze
// button (node data, ORed with the gate). Glitch comes from the buttons.
(function () {
  "use strict";

  function strip(view, st) {
    const c = view.bd.canvas;
    if (!c.clientWidth) return;
    const { g, w, h } = BleepView.fit(c);
    const th = BleepView.theme(view.root), accent = th.accent, line = th.line, text = th.text, muted = th.muted;
    const arrays = st.arrays || {};
    const plan = arrays.plan || [], hist = arrays.history || [];
    const synced = st.synced > 0.5 && plan.length > 0;
    const codes = synced ? plan : hist.slice(-32);
    const n = Math.max(codes.length, 1), cw = (w - 2) / n, top = 4, bh = h - 22;
    let playing = codes.length - 1;
    if (synced && st.beats > 0) playing = Math.floor((st.ppq - 4 * Math.floor(st.ppq / 4)) / st.beats);
    for (let i = 0; i < codes.length; i++) {
      const x = 1 + i * cw, code = codes[i];
      g.strokeStyle = line;
      g.strokeRect(Math.round(x) + 0.5, top + 0.5, Math.max(1, Math.round(cw) - 1), bh);
      g.fillStyle = accent;
      g.globalAlpha = synced && i > playing ? 0.45 : 1;  // upcoming
      if (code === 1 || code === 2) g.fillRect(x + 1, top + 1, Math.max(1, cw - 2), bh - 1);
      if (code === 3) for (let k = 0; k < 3; k++) g.fillRect(x + 1 + (k * cw) / 3, top + 1, Math.max(1, cw / 3 - 2), bh - 1);
      g.globalAlpha = 1;
    }
    if (synced) {
      const x = 1 + Math.min(playing, n - 1) * cw;
      g.fillStyle = text;
      g.fillRect(x, top + bh + 3, Math.max(2, cw), 3);
      g.fillStyle = muted;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText("this bar", 2, h - 2);
      g.fillText("next bar", w / 2 + 2, h - 2);
      g.strokeStyle = text;
      g.beginPath(); g.moveTo(Math.round(w / 2) + 0.5, 0); g.lineTo(Math.round(w / 2) + 0.5, h); g.stroke();
    } else {
      g.fillStyle = muted;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "right";
      g.fillText("recent segments →", w - 2, h - 2);
    }
  }

  // The repeat shape: where in the source segment the read head is during each
  // repeat (x = time, y = source position, 0 at the bottom). Bend is the speed:
  // 1 reads it once, 2 twice (loops), 0.5 half, negative runs backwards, 0 is
  // the 2 ms buzz. Slice shortens every repeat by (1 - Slice); Bend Var draws a
  // factor from a fixed set (the ghost lines); Corrupt roughens the line.
  const VAR = [1.0, 0.5, 2.0, -1.0, 1.5, 0.75, -0.5, 0.25];
  function snap(s, steps) {
    const a = Math.abs(s);
    if (steps === 0 || a < 1e-9) return s;
    const sg = s < 0 ? -1 : 1;
    if (steps === 3) return sg * Math.pow(2, Math.round(12 * Math.log2(a)) / 12);
    const set = steps === 1 ? [0.25, 0.5, 1, 2] : [0.25, 0.5, 0.75, 1, 1.5, 2];
    if (a < 0.125) return 0;
    let best = set[0];
    for (const v of set) if (Math.abs(Math.log2(a / v)) < Math.abs(Math.log2(a / best))) best = v;
    return sg * best;
  }
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  function shape(view, t) {
    const bd = view.bd, st = bd.last;
    if (!st) return;
    const { g, w, h } = BleepView.fit(bd.shape);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const pv = (id) => { const p = view.type.params.find((q) => q.id === id); return p.min + view.value(st, id) * (p.max - p.min); };
    const bend = pv("bend"), varAmt = view.value(st, "bendvar"), slice = Math.min(0.95, view.value(st, "slice"));
    const steps = view.units("bendsteps"), reps = Math.max(1, view.units("repeats"));
    const corrupt = view.value(st, "corrupt");
    const L = 14, R = w - 8, T = 18, B = h - 8;
    // repeat lengths
    const lens = [];
    let total = 0;
    for (let r = 0; r < reps; r++) { const l = Math.max(Math.pow(1 - slice, r), 0.04); lens.push(l); total += l; }
    const X = (u) => L + (u / total) * (R - L), Y = (p) => B - p * (B - T);
    g.strokeStyle = th.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, Y(0) + 0.5); g.lineTo(R, Y(0) + 0.5); g.moveTo(L, Y(1) + 0.5); g.lineTo(R, Y(1) + 0.5); g.stroke();
    // head position of a repeat at fraction u, for speed s (source wraps)
    const pos = (s, u) => {
      if (Math.abs(s) < 1e-3) return 0.5 + 0.5 * Math.sin(u * 60);  // buzz
      const p = (s > 0 ? 0 : 1) + s * u;
      return p - Math.floor(p + 1e-9) - (p === 1 ? 0 : 0);
    };
    const draw = (s, alpha, wdt, col, glowPx) => {
      g.strokeStyle = col; g.lineWidth = wdt; g.globalAlpha = alpha;
      BleepView.glow(g, col, glowPx);
      let x0 = 0;
      for (let r = 0; r < reps; r++) {
        const l = lens[r], n = 36;
        g.beginPath();
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          let p = Math.abs(s) < 1e-3 ? pos(s, u) : (s > 0 ? s * u : 1 + s * u);
          if (Math.abs(s) >= 1e-3) { const q = p - Math.floor(p); p = (p > 0 && q === 0) ? 1 : q; }
          if (corrupt > 0) p += (hash(r * 91 + i + Math.floor(t * 6)) - 0.5) * corrupt * 0.18;
          p = Math.min(1, Math.max(0, p));
          const px = X(x0 + u * l), py = Y(p);
          if (prev !== null && Math.abs(p - prev) > 0.5) { g.stroke(); g.beginPath(); g.moveTo(px, py); }
          else i ? g.lineTo(px, py) : g.moveTo(px, py);
          prev = p;
        }
        g.stroke();
        x0 += l;
      }
      g.shadowBlur = 0;
    };
    g.globalCompositeOperation = "lighter";
    if (varAmt > 0) {  // the speeds Bend Var may pick
      const k = 1 + Math.round(varAmt * 7);
      for (let i = 1; i < k; i++) draw(snap(bend * VAR[i], steps), 0.22, 1.2, th.muted, 0);
    }
    const sp = snap(bend, steps);
    draw(sp, 0.95, 2.2, th.accent, 10);
    // the sweeping head
    const sw = ((t * 0.5) % 1) * total;
    let x0 = 0, r = 0;
    while (r < reps - 1 && sw >= x0 + lens[r]) { x0 += lens[r]; r++; }
    const u = (sw - x0) / lens[r];
    let p = Math.abs(sp) < 1e-3 ? pos(sp, u) : (sp > 0 ? sp * u : 1 + sp * u);
    if (Math.abs(sp) >= 1e-3) p -= Math.floor(p);
    g.globalAlpha = 1; g.fillStyle = th.text; BleepView.glow(g, th.text, 12);
    g.beginPath(); g.arc(X(sw), Y(Math.min(1, Math.max(0, p))), 3.5, 0, 6.2832); g.fill();
    g.shadowBlur = 0; g.globalCompositeOperation = "source-over";
    g.fillStyle = th.muted; g.font = "10px system-ui, sans-serif"; g.textAlign = "right";
    const name = Math.abs(sp) < 1e-3 ? "buzz" : (sp < 0 ? "◀ " : "") + Math.abs(sp).toFixed(2) + "×";
    g.textAlign = "left"; g.fillText("speed " + name + "  ·  " + reps + (reps === 1 ? " repeat" : " repeats"), L, 10);
  }

  if (!document.getElementById("bd-style")) {
    const st = document.createElement("style");
    st.id = "bd-style";
    st.textContent = ".bleep-view.bd .bv-knob{width:64px}.bleep-view.bd .bv-knob svg{width:42px;height:42px}";
    document.head.appendChild(st);
  }

  BleepViews.register("bender", {
    parts: [{ id: "segments", name: "Segments", select: ".bv-panel:has(.bd-strip)" }, { id: "repeat", name: "Repeat shape", select: ".bv-panel:has(.bd-shape)" }],
    layout: [
      { title: "Segment", params: ["time", "chance", "repeats", "sync", "now", "seed"] },
      { title: "Bend", params: ["bend", "bendvar", "bendsteps", "slice"] },
      { title: "Corrupt & mix", params: ["corrupt", "edge", "mix", "mode", "corruptwhen"] },
    ],
    template:
      '<div style="display:flex;gap:8px;width:100%;flex-wrap:wrap">' +
      '<div class="bv-panel" style="flex:1 1 300px"><h2>Segments</h2><canvas class="bd-strip" style="height:50px"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<div class="bd-src" style="flex:1;height:14px;border:1px solid var(--line);border-radius:4px;position:relative;overflow:hidden">' +
      '<div class="bd-head" style="position:absolute;top:0;bottom:0;width:2px;background:var(--accent);display:none"></div></div>' +
      '<button class="bv-button bd-freeze">◉ Freeze</button></div></div>' +
      '<div class="bv-panel" style="flex:1 1 300px"><h2>Repeat: read head in the source</h2><canvas class="bd-shape" style="height:88px"></canvas></div></div>',
    afterBuild(view, el) {
      view.root.classList.add("bd");
      view.bd = { canvas: el.querySelector(".bd-strip"), shape: el.querySelector(".bd-shape"), head: el.querySelector(".bd-head"), freeze: el.querySelector(".bd-freeze") };
      BleepView.loop(view.root, (t) => shape(view, t));
      view.bd.freeze.addEventListener("click", () => {
        const d = { freezeLatched: !(view.node.data && view.node.data.freezeLatched) };
        view.node.data = d;
        view.api.setData(d);
        view.bd.freeze.classList.toggle("on", d.freezeLatched);
      });
    },
    onState(st, view) {
      if (!view.bd || !st) return;
      view.bd.last = st;
      const latched = !!(view.node.data && view.node.data.freezeLatched);
      view.bd.freeze.classList.toggle("on", latched || st.freeze > 0.5);
      const head = st.head;
      view.bd.head.style.display = head >= 0 ? "" : "none";
      if (head >= 0) view.bd.head.style.left = (head * 100).toFixed(2) + "%";
      strip(view, st);
    },
  });
})();
