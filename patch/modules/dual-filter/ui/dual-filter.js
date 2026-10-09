// SPDX-License-Identifier: MIT
// Dual Filter view (doc/specs/modules/dual-filter.md §5): the response of each
// filter (thin) and of the current routing (bright; Stereo: left and right),
// drawn from the modulated values with the quiet-signal (linear) SVF model.
// Markers at f1, the centre and f2: drag the centre for Cutoff, f1/f2 for
// Spread (Alt: move only that cutoff), vertically for that filter's Res.
// Mirrors patch/modules/dual-filter/dsp/DualFilterDsp.h.
(function () {
  "use strict";
  const OCT = Math.log2(1000), TOP = 30, BOTTOM = -36, GRAB = 9;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const scale = (a, k) => [a[0] * k, a[1] * k];
  const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const abs = (a) => Math.hypot(a[0], a[1]);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const qOf = (res) => 0.5 * Math.pow(50, clamp(res, 0, 1));
  function linked(m1, m2, link) {
    if (link === 1) return clamp(m1 + m2, 0, 1);
    if (link === 2) return clamp(1 - m1 + m2, 0, 1);
    return clamp(m2, 0, 1);
  }
  /// One SVF's morphed response at freq (Hz): cutoff fc, damping k = 1/Q (0.8/Q saturating).
  function svf(freq, fc, k, mode) {
    const s = [0, freq / fc];
    const den = add(add(mul(s, s), scale(s, k)), [1, 0]);
    const lp = div([1, 0], den), bp = div(s, den), hp = div(mul(s, s), den);
    const outs = [lp, bp, hp, add(lp, hp)];
    const m = clamp(mode, 0, 1) * 3, i = Math.min(Math.floor(m), 2), t = m - i;
    return add(scale(outs[i], 1 - t), scale(outs[i + 1], t));
  }
  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  const knob = (view, id) => view.node.params[id] ?? view.type.params.find((x) => x.id === id).default;

  /// Everything the curves need, from normalised values `v(id)`.
  function model(view, v) {
    const c = v("cutoff") * OCT, s = v("spread") * 10 - 5;
    const rough = setting(view, "character") === 1;
    const q1 = qOf(v("res1")), q2 = qOf(v("res2"));
    const w = clamp(Math.abs(s) - 1 / 12, 0, 1), atZero = 1 / Math.max(1, q1 / 4);
    return {
      c, s, f1: 20 * Math.pow(2, c - s / 2), f2: 20 * Math.pow(2, c + s / 2), fc: 20 * Math.pow(2, c),
      k1: (rough ? 0.8 : 1) / q1, k2: (rough ? 0.8 : 1) / q2,
      m1: clamp(v("mode1"), 0, 1), m2: linked(v("mode1"), v("mode2"), setting(view, "link")),
      bal: v("balance") * 2 - 1, mix: v("mix"), routing: setting(view, "routing"),
      stage: rough ? 1 : atZero + w * (1 - atZero),
    };
  }

  function draw(view, st) {
    const c = view.root.querySelector(".df-response");
    if (!c || !c.clientWidth) return;
    const m = model(view, (id) => view.value(st, id));
    view.df = m;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent"), line = css.getPropertyValue("--line");
    const muted = css.getPropertyValue("--muted") || line, text = css.getPropertyValue("--text");
    const y = (lin) => (TOP - clamp(20 * Math.log10(Math.max(lin, 1e-6)), BOTTOM, TOP)) / (TOP - BOTTOM) * h;
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y(1)); g.lineTo(w, y(1)); g.stroke();
    const plot = (fn, colour, width) => {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const yy = y(fn(20 * Math.pow(1000, x / w)));
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    };
    const H1 = (f) => svf(f, m.f1, m.k1, m.m1), H2 = (f) => svf(f, m.f2, m.k2, m.m2);
    const wet = (H) => abs(add(scale(H, m.mix), [1 - m.mix, 0]));
    plot((f) => abs(H1(f)), muted, 1);
    plot((f) => abs(H2(f)), muted, 1);
    if (m.routing === 3) {
      plot((f) => wet(scale(H1(f), Math.min(1, 1 - m.bal))), accent, 2);
      plot((f) => wet(scale(H2(f), Math.min(1, 1 + m.bal))), text, 1.5);
    } else {
      plot((f) => {
        const a = H1(f), b = H2(f);
        if (m.routing === 0) {
          const by = Math.max(m.bal, 0);
          return wet(add(scale(mul(a, b), (1 - by) * m.stage), scale(a, by)));
        }
        const g1 = 0.5 * clamp(1 - m.bal, 0, 2), g2 = 0.5 * clamp(1 + m.bal, 0, 2);
        return wet(add(scale(a, g1), scale(b, m.routing === 2 ? -g2 : g2)));
      }, accent, 2);
    }
    // Markers.
    const xOf = (f) => clamp(Math.log(f / 20) / Math.log(1000), 0, 1) * w;
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    for (const [f, label, colour] of [[m.f1, "f1", muted], [m.fc, "c", accent], [m.f2, "f2", muted]]) {
      const x = xOf(f);
      g.fillStyle = colour;
      g.beginPath(); g.moveTo(x, h - 12); g.lineTo(x - 5, h - 2); g.lineTo(x + 5, h - 2); g.closePath(); g.fill();
      g.fillStyle = text;
      g.fillText(label, x, h - 15);
    }
  }

  function attach(view, c) {
    let drag = null;
    const set = (id, v) => {
      v = clamp(v, 0, 1);
      view.node.params[id] = v;
      view.api.setParam(id, v);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !view.df) return;
      const r = c.getBoundingClientRect(), w = c.clientWidth;
      const x = e.clientX - r.left, m = view.df;
      const xOf = (f) => clamp(Math.log(f / 20) / Math.log(1000), 0, 1) * w;
      let best = null, dist = GRAB;
      for (const [which, f] of [["c", m.fc], ["f1", m.f1], ["f2", m.f2]]) {
        const d = Math.abs(xOf(f) - x);
        if (d < dist) { dist = d; best = which; }
      }
      if (!best) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      drag = {
        which: best, x0: x, y0: e.clientY,
        cutoff: knob(view, "cutoff"), spread: knob(view, "spread"),
        res: knob(view, best === "f2" ? "res2" : "res1"),
      };
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const w = c.clientWidth, dOct = (e.clientX - c.getBoundingClientRect().left - drag.x0) / w * OCT;
      const c0 = drag.cutoff * OCT, s0 = drag.spread * 10 - 5;
      if (drag.which === "c") set("cutoff", (c0 + dOct) / OCT);
      else {
        const sign = drag.which === "f1" ? -1 : 1;
        if (e.altKey) {  // move only this cutoff: the other one stays put
          const other = c0 - sign * s0 / 2, mine = c0 + sign * s0 / 2 + dOct;
          set("cutoff", (other + mine) / 2 / OCT);
          set("spread", (sign * (mine - other) + 5) / 10);
        } else {
          set("cutoff", drag.cutoff);
          set("spread", (s0 + 2 * sign * dOct + 5) / 10);
        }
        set(drag.which === "f2" ? "res2" : "res1", drag.res + (drag.y0 - e.clientY) / 150);
      }
      draw(view, view.lastState);
    });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  BleepViews.register("dual-filter", {
    settingsTop: true,  // the routing first: it decides what the knobs do
    template: '<div class="bv-panel"><h2>Response</h2><canvas class="df-response" style="height:110px;cursor:ew-resize"></canvas></div>',
    afterBuild(view, el) {
      const c = el.querySelector(".df-response");
      if (c) attach(view, c);
    },
    onState(st, view) {
      view.lastState = st;
      draw(view, st);
    },
    onRefresh(view) { draw(view, view.lastState); },
  });
})();
