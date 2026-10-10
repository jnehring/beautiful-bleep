// SPDX-License-Identifier: MIT
// Ring drum views: each voice shows a phosphor scope of its actual sound, drawn
// from the effective (modulated) parameters and the formulas in
// patch/modules/ring-drums/dsp/RingDrumsDsp.h (pitch sweeps, T60 envelopes,
// partial ratios, the metal source and its filters). A trigger (the Out level
// jumping) restarts the glowing playhead; the trace brightens with the level.
(function () {
  "use strict";
  // ---- shared drawing: a "phosphor scope" of the voice, drawn from the real
  // parameters. A scene = { T, layers:[{osc,noise,env,col,w,dim}], pitch, quant,
  // spec:{sticks,filters}, caption }. osc/noise/env are t(seconds) -> amplitude.
  const E = (t, t60) => (t < 0 ? 0 : Math.pow(10, -3 * t / t60));  // a T60 decay
  const semis = (st) => Math.pow(2, st / 12);
  const NZ = new Float32Array(2048);
  for (let i = 0, s = 12345; i < NZ.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; NZ[i] = (s / 0x3fffffff) - 1; }
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const ms = (t) => (t < 1 ? Math.round(t * 1000) + " ms" : t.toFixed(2) + " s");

  if (!document.getElementById("bdk-style")) {
    const st = document.createElement("style");
    st.id = "bdk-style";
    st.textContent =
      ".bdk{display:flex;flex-direction:column;gap:4px;min-width:300px;width:100%}" +
      ".bdk canvas{display:block;width:100%;height:210px;border:1px solid var(--line);border-radius:6px;" +
      "background:radial-gradient(ellipse at 50% 50%,var(--panel-2),var(--panel,#000))}" +
      ".bdk .bdk-cap{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}";
    document.head.appendChild(st);
  }

  /// Real (unit) value of a param from its normalised effective value.
  function real(view, st, id) {
    const p = view.type.params.find((q) => q.id === id);
    if (!p) return 0;
    const x = clamp(view.value(st, id), 0, 1);
    if (p.map === "exp") return p.min * Math.pow(p.max / p.min, x);
    if (p.map === "skew") {
      const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
      return x <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(x) / skew);
    }
    const v = p.min + (p.max - p.min) * x;
    return p.steps ? Math.round(v) : v;
  }

  const hp2 = (f, fc) => { const x = f / fc, x2 = x * x; return x2 / Math.sqrt(1 + x2 * x2); };
  const bp = (f, fc, q) => 1 / Math.sqrt(1 + Math.pow(q * (f / fc - fc / f), 2));

  function drawScene(view, canvas, sc, anim, colours) {
    const { g, w, h } = BleepView.fit(canvas);
    if (!w || !h) return;
    const col = { accent: colours.accent, text: colours.text, muted: colours.muted };
    const lvl = 0.3 + 0.7 * sc.level;
    const specW = sc.spec ? Math.round(w * 0.34) : 0;
    const ww = w - specW - (specW ? 8 : 0);
    const mid = h * 0.5, amp = h * 0.42 * lvl;
    const T = sc.T;
    // trigger progress: 0..1 sweep, then holds
    const el = (performance.now() - anim.t0) / 1000;
    const sweep = clamp(T * 1.2, 0.7, 1.6);
    const prog = el / sweep;
    const head = clamp(prog, 0, 1) * ww;
    const after = Math.max(0, el - sweep);
    const fade = prog >= 1 ? Math.max(0, 1 - after / 0.9) : 1;
    const pulse = 1 + 2.5 * anim.peak;

    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = colours.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, Math.round(mid) + 0.5); g.lineTo(ww, Math.round(mid) + 0.5);
    for (let i = 1; i < 4; i++) { const x = Math.round(ww * i / 4) + 0.5; g.moveTo(x, 4); g.lineTo(x, h - 4); }
    g.stroke();
    g.globalAlpha = 1;

    // normalisation so the loudest start fills ~the height
    let norm = 0;
    for (const L of sc.layers) { let s = 0; for (const o of L.osc || []) s += Math.abs(o.a(0.0005)); for (const n of L.noise || []) s += 0.6 * Math.abs(n(0.0005)); norm = Math.max(norm, s); }
    norm = Math.max(norm, 0.2);

    const nCol = Math.max(2, Math.floor(ww));
    const ys = new Float32Array(nCol);
    for (const L of sc.layers) {
      const colour = col[L.col || "accent"];
      const ph = (L.osc || []).map(() => 0);
      for (let x = 0; x < nCol; x++) {
        const t = x / (nCol - 1) * T;
        let y = 0;
        (L.osc || []).forEach((o, k) => {
          const f = o.f(t);
          ph[k] += 2 * Math.PI * (2 + 4 * Math.log2(1 + f / 25)) / nCol;
          y += o.a(t) * Math.sin(ph[k]);
        });
        for (const n of L.noise || []) y += n(t) * NZ[(x * 7 + (L.seed || 0)) & 2047];
        y /= norm;
        if (sc.shape) y = sc.shape(y);
        if (sc.quant) y = Math.round(y * sc.quant) / sc.quant;
        ys[x] = clamp(y, -1.1, 1.1);
      }
      // envelope outline + wash
      if (L.env) {
        g.beginPath();
        for (let x = 0; x < nCol; x++) { const e = Math.min(1.1, L.env(x / (nCol - 1) * T) / norm); x ? g.lineTo(x, mid - e * amp) : g.moveTo(x, mid - e * amp); }
        for (let x = nCol - 1; x >= 0; x--) { const e = Math.min(1.1, L.env(x / (nCol - 1) * T) / norm); g.lineTo(x, mid + e * amp); }
        g.closePath();
        g.globalAlpha = L.dim ? 0.05 : 0.1;
        g.fillStyle = colour;
        g.fill();
        g.globalAlpha = L.dim ? 0.3 : 0.5;
        g.strokeStyle = colour;
        g.lineWidth = 1;
        g.stroke();
      }
      const trace = (x0, x1) => {
        g.beginPath();
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(nCol - 1, x1); x++) { const y = mid - ys[x] * amp; x === Math.floor(x0) ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      };
      g.lineJoin = "round";
      g.strokeStyle = colour;
      g.globalAlpha = L.dim ? 0.3 : 0.4;
      g.lineWidth = L.w || 1.2;
      trace(0, nCol);
      // the bright, glowing part that follows the playhead
      const x0 = Math.max(0, head - ww * 0.4);
      g.globalAlpha = (L.dim ? 0.55 : 1) * fade;
      g.save();
      g.beginPath(); g.rect(0, 0, head + 1, h); g.clip();
      BleepView.glow(g, colour, 8 * pulse);
      g.lineWidth = (L.w || 1.2) + 0.6;
      trace(x0, head);
      g.restore();
    }
    g.globalAlpha = 1;

    // pitch curve (dashed, on a log axis)
    if (sc.pitch) {
      const P = sc.pitch;
      g.beginPath();
      for (let x = 0; x < nCol; x++) {
        const f = P.f(x / (nCol - 1) * T);
        const y = h - 10 - clamp(Math.log2(f / P.lo) / Math.log2(P.hi / P.lo), 0, 1) * (h - 24);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.setLineDash([3, 4]);
      g.strokeStyle = col.text;
      g.globalAlpha = 0.7;
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 0.8;
      g.fillStyle = col.muted;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText(P.label(0) + " → " + P.label(T), 6, h - 14 - 0);
    }
    // playhead
    if (fade > 0 && head < ww) {
      g.globalAlpha = 0.6 * fade;
      g.strokeStyle = col.accent;
      BleepView.glow(g, col.accent, 6);
      g.beginPath(); g.moveTo(head + 0.5, 3); g.lineTo(head + 0.5, h - 3); g.stroke();
    }
    g.restore();

    // spectrum (hats, cymbals): sticks of the metal partials under the filters
    if (sc.spec) {
      const S = sc.spec, x0 = ww + 8, sw = specW, lo = 150, hi = 20000;
      const xOf = (f) => x0 + clamp(Math.log(f / lo) / Math.log(hi / lo), 0, 1) * sw;
      g.save();
      g.globalAlpha = 0.45;
      g.strokeStyle = colours.line;
      g.beginPath(); g.moveTo(x0, h - 14.5); g.lineTo(x0 + sw, h - 14.5); g.stroke();
      g.fillStyle = col.muted;
      g.font = "9px system-ui, sans-serif";
      g.textAlign = "center";
      for (const [f, l] of [[500, "500"], [2000, "2k"], [8000, "8k"]]) { g.fillText(l, xOf(f), h - 3); g.beginPath(); g.moveTo(xOf(f) + 0.5, h - 18); g.lineTo(xOf(f) + 0.5, h - 14); g.stroke(); }
      g.globalAlpha = 1;
      const base = h - 15, top = 12, hh = base - top;
      S.filters.forEach((F, i) => {
        g.beginPath();
        for (let x = 0; x <= sw; x += 2) {
          const f = lo * Math.pow(hi / lo, x / sw), y = base - F.fn(f) * hh * 0.95;
          x ? g.lineTo(x0 + x, y) : g.moveTo(x0 + x, y);
        }
        g.lineTo(x0 + sw, base); g.lineTo(x0, base); g.closePath();
        g.globalAlpha = 0.08; g.fillStyle = col[F.col]; g.fill();
        g.globalAlpha = 0.5 * (F.dim ? 0.6 : 1); g.strokeStyle = col[F.col]; g.lineWidth = 1; g.stroke();
      });
      const F = S.filters[0];
      for (const s of S.sticks) {
        const a = s.a * S.filters.reduce((m, q) => Math.max(m, q.fn(s.hz)), 0);
        const x = Math.round(xOf(s.hz)) + 0.5;
        g.globalAlpha = 0.25 + 0.75 * Math.min(1, a * 1.4) * (0.6 + 0.4 * Math.min(1, anim.peak * 3 + fade * 0.5));
        g.strokeStyle = s.col ? col[s.col] : col.accent;
        BleepView.glow(g, g.strokeStyle, 5);
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - Math.max(2, a * hh * 0.95)); g.stroke();
      }
      g.restore();
      g.shadowBlur = 0;
      g.fillStyle = col.muted;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText(S.label || "spectrum", x0, 10);
    }
    g.shadowBlur = 0;
  }

  /// Registers a view: scene(P, view, st) -> scene; P(id) = effective real value.
  function drum(type, scene, layout, extra) {
    const n = layout.length;  // the level joins the last card: compact
    if (n > 1 && layout[n - 1].title === "Out") { const a = layout[n - 2]; layout = layout.slice(0, n - 2).concat([{ title: a.title + " · Out", params: a.params.concat(layout[n - 1].params) }]); }
    BleepViews.register(type, Object.assign({
      template: '<div class="bdk"><canvas></canvas><div class="bdk-cap"><span class="bdk-l"></span><span class="bdk-r"></span></div></div>',
      side: true,
      layout,
      afterBuild(view, el) {
        view.bdk = { t0: performance.now() - 5000, peak: 0, last: 0, canvas: el.querySelector("canvas"), el, sc: null, colours: null };
        BleepView.loop(view.root, () => {
          const d = view.bdk;
          if (!d.sc || !d.canvas.clientWidth) return;
          if (!d.colours) d.colours = BleepView.theme(view.root);
          const el2 = (performance.now() - d.t0) / 1000;
          if (el2 > Math.max(1.8, d.sc.T * 1.2 + 1.2)) d.t0 = performance.now();  // idle loop
          d.peak *= 0.93;
          drawScene(view, d.canvas, d.sc, d, d.colours);
        });
      },
      onState(st, view) { rebuild(view, st); trig(view, st); },
      onRefresh(view) { rebuild(view, view.lastSt); },
    }, extra || {}));
    function rebuild(view, st) {
      if (!view.bdk) return;
      view.lastSt = st;
      const P = (id) => real(view, st, id);
      view.bdk.sc = scene(P, view);
      const c = view.bdk.el;
      c.querySelector(".bdk-l").textContent = view.bdk.sc.caption || "";
      c.querySelector(".bdk-r").textContent = "0 – " + ms(view.bdk.sc.T);
    }
    function trig(view, st) {
      const d = view.bdk;
      if (!d) return;
      const o = st && st.outputs ? Math.abs(Number(st.outputs.out) || 0) : 0;
      if (o > 0.05 && o > d.last * 1.8 + 0.02) d.t0 = performance.now();
      d.last = Math.max(o, d.last * 0.9);
      d.peak = Math.max(d.peak, Math.min(1, o));
    }
  }

  const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
  const sticks = (list, r, col) => { const o = []; for (const f of list) for (let h = 1; h < 60; h += 2) if (f * r * h < 20000) o.push({ hz: f * r * h, a: 1 / Math.sqrt(h), col }); return o; };

  drum("ring-kick", (P) => {
    const tune = P("tune"), dec = P("decay"), sw = P("sweep"), tone = P("tone"), drive = P("drive");
    const f = (t) => tune * (1 + 1.5 * sw * E(t, 0.09));
    return {
      T: clamp(dec * 0.55, 0.12, 1.4), level: P("level"), quant: 0,
      shape: (y) => Math.tanh(y * (1 + 4 * drive)) / Math.tanh(1 + 4 * drive),
      layers: [{ osc: [{ f, a: (t) => E(t, dec) }], noise: [(t) => (0.25 + 0.5 * tone) * E(t, 0.004) * 1.5], env: (t) => E(t, dec) }],
      pitch: { f, lo: 25, hi: 320, label: (t) => Math.round(f(t)) + " Hz" },
      caption: "tune " + Math.round(tune) + " Hz · decay " + ms(dec),
    };
  }, [
    { title: "Pitch", params: ["tune", "sweep"] },
    { title: "Body", params: ["decay"] },
    { title: "Click & Drive", params: ["tone", "drive"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-snare", (P) => {
    const tune = P("tune"), tone = P("tone"), sn = P("snappy"), dec = P("decay");
    const bt = clamp(0.5 * dec, 0.05, 0.4);
    return {
      T: clamp(dec * 0.55, 0.1, 0.6), level: P("level"),
      layers: [
        { osc: [{ f: () => tune, a: (t) => 0.9 * 0.7 * E(t, bt) }, { f: () => tune * 1.84, a: (t) => 0.9 * 0.5 * E(t, 0.7 * bt) }], env: (t) => 0.9 * 0.9 * E(t, bt), col: "text", dim: true },
        { noise: [(t) => 1.45 * sn * (0.5 + 0.5 * tone) * E(t, dec)], env: (t) => 1.45 * sn * E(t, dec), col: "accent", seed: 99 },
      ],
      caption: "body " + Math.round(tune) + " Hz + noise",
    };
  }, [
    { title: "Body", params: ["tune", "tone"] },
    { title: "Snares", params: ["snappy", "decay"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-clap", (P) => {
    const tone = P("tone"), dec = P("decay"), sp = P("spread"), n = Math.round(P("bursts"));
    const a = (t) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += E(t - i * sp, 0.012) * (t >= i * sp ? 1 : 0);
      return Math.min(1.2, s * 0.9) + 0.55 * E(t - n * sp, dec) * (t >= n * sp ? 1 : 0);
    };
    return {
      T: Math.max(n * sp + 0.05, dec * 0.45), level: P("level"),
      layers: [{ noise: [a], env: a, seed: 5 }],
      caption: n + " bursts · " + (sp * 1000).toFixed(1) + " ms apart · " + Math.round(tone) + " Hz",
    };
  }, [
    { title: "Hands", params: ["bursts", "spread"] },
    { title: "Tone", params: ["tone"] },
    { title: "Tail", params: ["decay"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-tom", (P) => {
    const tune = P("tune"), dec = P("decay"), bend = P("bend"), nz = P("noise");
    const f = (t) => tune * (1 + 0.5 * bend * E(t, dec));
    return {
      T: clamp(dec * 0.55, 0.1, 1.1), level: P("level"),
      layers: [{ osc: [{ f, a: (t) => E(t, dec) }], noise: [(t) => 0.8 * nz * E(t, 0.4 * dec)], env: (t) => E(t, dec) }],
      pitch: { f, lo: 40, hi: 900, label: (t) => Math.round(f(t)) + " Hz" },
      caption: Math.round(tune) + " Hz · bend " + Math.round(bend * 100) + "%",
    };
  }, [
    { title: "Pitch", params: ["tune", "bend"] },
    { title: "Body", params: ["decay", "noise"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-rim", (P, view) => {
    const clave = view.units("voice") === 1, r = semis(P("tune")), d = P("decay");
    const o = clave
      ? [{ f: () => 455 * r, a: (t) => 0.7 * E(t, 0.035 * d) }, { f: () => 1667 * r, a: (t) => 0.5 * E(t, 0.025 * d) }]
      : [{ f: () => 2450 * r, a: (t) => 0.9 * E(t, 0.09 * d) }];
    return {
      T: clamp(0.09 * d * 0.9, 0.04, 0.33), level: P("level"),
      layers: [{ osc: o, env: (t) => o.reduce((s, q) => s + q.a(t), 0) }],
      caption: (clave ? "clave · 455 + 1667 Hz" : "rim · 2450 Hz") + " · " + (P("tune") >= 0 ? "+" : "") + P("tune").toFixed(1) + " st",
    };
  }, [
    { title: "Voice", params: ["voice", "tune"] },
    { title: "Ring", params: ["decay"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-cowbell", (P) => {
    const r = semis(P("tune")), dec = P("decay"), tone = P("tone"), fc = r * 700 * Math.pow(2, 2 * tone);
    const a = (t) => E(t, 0.035) + E(t, dec);
    return {
      T: clamp(dec * 0.5, 0.1, 1.0), level: P("level"),
      layers: [{ osc: [{ f: () => 540 * r, a: (t) => 0.55 * a(t) }, { f: () => 800 * r, a: (t) => 0.45 * a(t) * bp(800 * r, fc, 1.4) }], env: (t) => a(t) * 0.7 }],
      caption: "540 + 800 Hz squares · band " + Math.round(fc) + " Hz",
    };
  }, [
    { title: "Pitch", params: ["tune"] },
    { title: "Ring", params: ["decay", "tone"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-hats", (P) => {
    const r = semis(P("tune")), cl = P("closed"), op = P("open"), fc = 5000 * Math.pow(2, P("tone"));
    return {
      T: clamp(op * 0.55, 0.15, 1.2), level: P("level"),
      layers: [
        { noise: [(t) => E(t, op)], env: (t) => E(t, op), col: "text", dim: true, seed: 31 },
        { noise: [(t) => E(t, cl)], env: (t) => E(t, cl), col: "accent", seed: 8 },
      ],
      spec: { label: "metal · hi-pass " + (fc / 1000).toFixed(1) + "k", sticks: sticks(METAL, r), filters: [{ col: "accent", fn: (f) => hp2(f, fc) * bp(f, 8000, 0.9) * 1.6 }] },
      caption: "closed " + ms(cl) + " · open " + ms(op),
    };
  }, [
    { title: "Metal", params: ["tune", "tone"] },
    { title: "Decay", params: ["closed", "open"] },
    { title: "Out", params: ["level"] },
  ]);

  drum("ring-cymbal", (P) => {
    const r = semis(P("tune")), dec = P("decay"), tone = P("tone");
    return {
      T: clamp(dec * 0.5, 0.3, 3.5), level: P("level"),
      layers: [
        { noise: [(t) => 0.6 * E(t, 0.4 * dec)], env: (t) => 0.6 * E(t, 0.4 * dec), col: "text", dim: true, seed: 3 },
        { noise: [(t) => E(t, dec)], env: (t) => E(t, dec), col: "accent", seed: 77 },
      ],
      spec: { label: "lo clang · hi sizzle", sticks: sticks(METAL, r), filters: [{ col: "text", dim: true, fn: (f) => bp(f, 3400, 1.2) * 0.8 }, { col: "accent", fn: (f) => hp2(f, 8000) }] },
      caption: "sizzle " + ms(dec) + " · clang " + ms(0.4 * dec),
    };
  }, [
    { title: "Metal", params: ["tune", "tone"] },
    { title: "Decay", params: ["decay"] },
    { title: "Out", params: ["level"] },
  ]);
})();
