// SPDX-License-Identifier: GPL-3.0-or-later
// Modal Voice view: an exciter scope (the last 50 ms of the Exciter output:
// mallet pulses, the bow's stick-slip, breath noise), the body's partials on
// a log frequency axis (height = amplitude, brightness = what is still
// ringing, the bars glow and fade as the modes decay) with a Position
// marker, and an Active LED. Until the module reports its live modes the
// partials are drawn from Geometry, Brightness, Damping and Position
// (ModalBank's mode ratios and position weights, approximated) and re-struck
// every few seconds so the decay is visible. The Play button (a gate while
// held) comes from the module's buttons.
(function () {
  "use strict";
  const N = 24;
  const rnd = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };

  /// Approximate mode ratios for Geometry 0..1: harmonic → stiff string → free bar → plate → bell.
  function ratios(geo) {
    const s = Math.min(1, Math.max(0, geo)) * 4, seg = Math.min(3, Math.floor(s)), t = s - seg;
    const tab = [
      (k) => k,
      (k) => (k * Math.sqrt(1 + 0.002 * k * k)) / Math.sqrt(1.002),
      (k) => ((2 * k + 1) * (2 * k + 1)) / 9,
      (k) => Math.pow(k, 1.55) * 0.95 + 0.05,
      (() => { const c = [1]; for (let k = 2; k <= N; k++) c.push(c[k - 2] * (1.15 + 0.6 * rnd(k))); return (k) => c[k - 1]; })(),
    ];
    const out = [];
    for (let k = 1; k <= N; k++) {
      const a = tab[seg](k), b = tab[seg + 1](k);
      out.push(Math.exp((1 - t) * Math.log(a) + t * Math.log(b)));
    }
    return out;
  }
  /// The modes from the knobs: frequency, amplitude (position weight × brightness tilt) and decay time.
  function model(view, st) {
    const geo = view.value(st, "geometry"), bright = view.value(st, "brightness"), damp = view.value(st, "damping"), pos = view.value(st, "position");
    const f0 = 130.8 * Math.pow(2, (48 * view.value(st, "coarse") - 24) / 12 + (200 * view.value(st, "fine") - 100) / 1200);
    const r = ratios(geo), pp = 0.02 + 0.96 * pos, t60 = 20 * Math.pow(0.002, damp);
    const hz = [], amp = [], t = [];
    for (let k = 1; k <= N; k++) {
      hz.push(f0 * r[k - 1]);
      amp.push(Math.abs(Math.sin(Math.PI * k * pp)) * Math.pow(k, -(0.3 + 2.2 * (1 - bright))));
      t.push(Math.max(0.03, t60 * Math.pow(k, -(0.4 + 1.6 * (1 - bright)))));
    }
    return { hz, amp, t };
  }

  function draw(view, time) {
    const m = view.mv;
    if (!m) return;
    const col = BleepView.theme(view.root), st = m.st, arrays = (st && st.arrays) || {};
    const led = view.root.querySelector(".mv-led");
    if (led) {
      const on = st && st.active > 0.5;
      led.style.background = on ? col.accent : "transparent";
      led.style.boxShadow = on ? "0 0 8px " + col.accent : "none";
      led.style.border = "1px solid " + (on ? col.accent : col.line);
    }
    const scope = view.root.querySelector(".mv-scope");
    if (scope && scope.clientWidth) {
      const { g, w, h } = BleepView.fit(scope);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
      g.strokeStyle = col.line;
      g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
      let xs = arrays.exciter;
      if (!xs || !xs.length) {  // knobs only: the exciters' character, struck every 3.2 s (illustration)
        const bow = view.value(st, "bow"), blow = view.value(st, "blow"), strike = view.value(st, "strike");
        xs = [];
        for (let i = 0; i < 120; i++) {
          const tt = i / 120, age = (time % 3.2) + tt * 0.05;
          let v = strike * Math.exp(-age * 40) * Math.sin(tt * 90 + 1) * (age < 0.3 ? 1 : 0);
          v += bow * 0.6 * ((((tt * 6 + time * 3) % 1) * 2 - 1) * (rnd(Math.floor(tt * 6 + time * 3)) > 0.5 ? 1 : 0.7));
          v += blow * 0.8 * (rnd(i + Math.floor(time * 30)) - 0.5);
          xs.push(v);
        }
      }
      if (xs && xs.length) {
        let peak = 0.05;
        for (const v of xs) peak = Math.max(peak, Math.abs(v));
        g.strokeStyle = col.accent; g.lineWidth = 1.5; BleepView.glow(g, col.accent, 8);
        g.beginPath();
        xs.forEach((v, i) => {
          const x = (i / Math.max(xs.length - 1, 1)) * w, y = h / 2 - (v / peak) * (h / 2 - 3);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
      }
    }
    const parts = view.root.querySelector(".mv-partials");
    if (!parts || !parts.clientWidth) return;
    const { g, w, h } = BleepView.fit(parts);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, w, h);
    const base = h - 14, x = (hz) => (Math.log(Math.max(hz, 16) / 16) / Math.log(20000 / 16)) * w;
    g.font = "9px system-ui, sans-serif"; g.fillStyle = col.muted;
    for (const f of [100, 1000, 10000]) {
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(Math.round(x(f)) + 0.5, 0); g.lineTo(Math.round(x(f)) + 0.5, base); g.stroke();
      g.fillText(f >= 1000 ? f / 1000 + "k" : f, x(f) + 3, h - 3);
    }
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(0, base + 0.5); g.lineTo(w, base + 0.5); g.stroke();
    let hz, amp, lvl;
    if (arrays.modeHz && arrays.modeHz.length) {
      hz = arrays.modeHz; const ma = Math.max(...arrays.modeAmp, 1e-6), ml = Math.max(...arrays.modeLevel, 1e-6);
      amp = arrays.modeAmp.map((v) => v / ma); lvl = arrays.modeLevel.map((v) => Math.sqrt(Math.min(1, v / ml)));
    } else {  // knobs only: strike every 3.2 s and let the modes ring down
      const mo = model(view, st), age = time % 3.2, ma = Math.max(...mo.amp, 1e-6);
      hz = mo.hz; amp = mo.amp.map((v) => v / ma);
      lvl = mo.t.map((tt) => Math.exp((-6.9 * age) / tt));
    }
    BleepView.glow(g, col.accent, 10);
    for (let k = hz.length - 1; k >= 0; k--) {
      if (amp[k] < 0.002) continue;
      const xx = Math.round(x(hz[k])) + 0.5, bh = amp[k] * (base - 8), a = 0.2 + 0.8 * lvl[k];
      const gr = g.createLinearGradient(0, base, 0, base - bh);
      gr.addColorStop(0, col.accent + "44"); gr.addColorStop(1, col.accent);
      g.globalAlpha = a; g.strokeStyle = gr; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(xx, base); g.lineTo(xx, base - bh); g.stroke();
      g.fillStyle = col.text; g.beginPath(); g.arc(xx, base - bh, 1.8, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1; g.shadowBlur = 0; g.lineWidth = 1;
    // Position: where the exciter touches the body (0 … 100 % along it).
    const px = 4 + view.value(st, "position") * (w - 8);
    g.fillStyle = col.text;
    g.beginPath(); g.moveTo(px - 4, 0); g.lineTo(px + 4, 0); g.lineTo(px, 6); g.closePath(); g.fill();
  }

  BleepViews.register("modal-voice", {
    parts: [{ id: "exciter", name: "Exciter", select: ".bv-panel > div:nth-child(1)" }, { id: "body", name: "Body", select: ".bv-panel > div:nth-child(2)" }],
    width: 940,
    layout: [
      { title: "Bow", params: ["bow", "bowTimbre"] },
      { title: "Blow", params: ["blow", "blowTimbre"] },
      { title: "Strike", params: ["strike", "strikeTimbre", "contour"] },
      { title: "Ext", params: ["extLevel"] },
      { title: "Resonator", params: ["geometry", "brightness", "damping", "position", "coarse", "fine"] },
      { title: "Space", params: ["size", "space", "partials", "seed"] },
    ],
    template:
      '<div class="bv-panel" style="display:flex;gap:10px"><div style="flex:0 0 230px"><h2>Exciter · 50 ms ' +
      '<span class="mv-led" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:4px"></span></h2>' +
      '<canvas class="mv-scope" style="height:84px"></canvas></div>' +
      '<div style="flex:1;min-width:0"><h2>Body · partials ringing</h2><canvas class="mv-partials" style="height:84px"></canvas></div></div>',
    afterBuild(view) {
      view.mv = { st: null };
      BleepView.loop(view.root, (t) => draw(view, t));
    },
    onState(st, view) { if (view.mv) view.mv.st = st; },
  });
})();
