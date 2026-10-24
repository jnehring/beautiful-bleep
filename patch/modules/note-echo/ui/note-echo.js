// SPDX-License-Identifier: GPL-3.0-only
// Note Echo view (doc/note-echo.md): the repeat train of one note as the
// current knobs shape it: height = velocity after Decay, row = scale steps
// walked (Scale Steps plus the Spread fan), position = time with Gravity
// pulling it onto, or off, the grid. Faint bars are repeats Drop may leave out.
// A flash marks every repeat the module really plays.
(function () {
  "use strict";
  const BEATS = { "1/1": 4, "1/2": 2, "1/4.": 1.5, "1/4": 1, "1/4T": 2 / 3, "1/8.": 0.75, "1/8": 0.5, "1/8T": 1 / 3, "1/16.": 0.375,
                  "1/16": 0.25, "1/16T": 1 / 6, "1/32.": 0.1875, "1/32": 0.125, "1/32T": 1 / 12 };
  const GRID = [1, 0.5, 0.25, 0.125];
  const raw = (view, id) => { const p = view.type.params.find((x) => x.id === id); return p.min + (view.node.params[id] ?? p.default) * (p.max - p.min); };
  const choice = (view, id) => { const p = view.type.params.find((x) => x.id === id); return p.choices[Math.round(raw(view, id))]; };

  function tones(fan, k, n) {
    if (n <= 1) return 0;
    if (fan === "Down") return (n - (k % n)) % n;
    if (fan === "Up-Down") { const per = 2 * n - 2, p = k % per; return p < n ? p : per - p; }
    if (fan === "Random") return (k * 7 + 3) % n;
    return k % n;
  }

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st || {};
    const reps = Math.round(raw(view, "repeats")), rate = choice(view, "rate"), free = rate === "Free";
    const spacing = free ? raw(view, "time") * 2 : BEATS[rate] || 0.5;  // free time shown at 120 BPM
    const decay = raw(view, "decay"), steps = Math.round(raw(view, "steps")), drop = raw(view, "drop"), len = raw(view, "length");
    const spread = raw(view, "spread"), fan = choice(view, "fan"), grav = raw(view, "gravity");
    const grid = GRID[Math.round(raw(view, "grid"))], nt = 1 + Math.min(4, Math.floor(spread * 4 + 1e-4));
    const pad = 8, base = h - 14, top = 10, span = Math.max(spacing * (reps + 0.6), 0.25), pw = w - 2 * pad;
    const X = (b) => pad + (b / span) * pw;
    // grid lines
    g.strokeStyle = th.line; g.lineWidth = 1; g.globalAlpha = 0.5;
    g.beginPath();
    for (let b = 0; b <= span + 1e-6; b += grid) { const x = Math.round(X(b)) + 0.5; g.moveTo(x, top); g.lineTo(x, base); }
    g.stroke(); g.globalAlpha = 1;
    // the train
    const pts = [{ b: 0, v: 1, off: 0, drop: false }];
    for (let k = 1; k <= reps; k++) {
      let b = k * spacing;
      if (Math.abs(grav) > 1e-4) {
        const target = grav > 0 ? Math.round(b / grid) * grid : (Math.floor(b / grid) + 0.5) * grid;
        b += (target - b) * Math.abs(grav);
      }
      pts.push({ b, v: Math.pow(1 - decay, k), off: steps * k + 2 * tones(fan, k, nt), drop: drop > 0 });
    }
    const offs = pts.map((p) => p.off), lo = Math.min(0, ...offs), hi = Math.max(0, ...offs), rows = Math.max(hi - lo, 4);
    const flash = view._flash || 0;
    pts.forEach((p, i) => {
      if (p.v < 0.01) return;
      const x = X(p.b), bh = (base - top) * 0.35 * p.v + 4, y = base - ((p.off - lo) / rows) * (base - top - bh - 4) - bh;
      g.fillStyle = th.accent; g.globalAlpha = (i === 0 ? 1 : 0.35 + 0.65 * (1 - drop * 0.7)) * (0.55 + 0.45 * p.v);
      g.fillRect(x - 1, y, Math.max(3, X(len * spacing) - pad - 1), bh);
      g.globalAlpha = 1;
    });
    if (flash > 0.02) { g.fillStyle = th.accent; g.globalAlpha = flash * 0.25; g.fillRect(0, 0, w, h); g.globalAlpha = 1; view._flash = flash * 0.9; }
    g.fillStyle = th.muted; g.font = "10px system-ui, sans-serif";
    g.textAlign = "left"; g.fillText(free ? "free time (shown at 120 BPM)" : rate + " repeats", pad, h - 3);
    g.textAlign = "right"; g.fillText(grid < 1 ? "grid 1/" + Math.round(4 / grid) : "grid 1/4", w - pad, h - 3);
  }

  BleepViews.register("note-echo", {
    width: 700,
    top: true,
    template: '<div class="bv-panel"><h2>Repeats</h2><canvas class="ne-train" style="height:110px"></canvas></div>',
    partNames: ["Repeats"],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      if (typeof st.hits === "number") { if (view._hits !== undefined && st.hits !== view._hits) view._flash = 1; view._hits = st.hits; }
      view._st = st;
    },
  });
})();
