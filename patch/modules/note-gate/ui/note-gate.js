// SPDX-License-Identifier: GPL-3.0-or-later
// Note Gate view (doc/note-gate.md): three small editors that live in the
// node's data. Remap: twelve keys, click one to send it to the next pitch
// class (shift-click: the previous, right-click: back to itself, the last
// stop blocks it). Curve: drag to draw the velocity curve (used when Curve is
// Drawn). Step lane: sixteenths of the bar, click to let notes through on a
// step or not, with the step of the last note marked.
(function () {
  "use strict";
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"], BLACK = [1, 3, 6, 8, 10];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const IDENT = () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const LINEAR = () => Array.from({ length: 17 }, (_, i) => i / 16);

  function data(view) {
    let d = view.node.data;
    if (!d || typeof d !== "object" || Array.isArray(d)) d = view.node.data = {};
    if (!Array.isArray(d.remap) || d.remap.length !== 12) d.remap = IDENT();
    if (!Array.isArray(d.curve) || d.curve.length !== 17) d.curve = LINEAR();
    if (!Array.isArray(d.steps) || d.steps.length !== 16) d.steps = new Array(16).fill(1);
    return d;
  }
  const commit = (view) => view.api.setData(JSON.parse(JSON.stringify(view.node.data)));
  const knobOn = (view, id) => view.units(id) >= 1;

  function drawRemap(view, cv) {
    const { g, w, h } = BleepView.fit(cv), th = BleepView.theme(view.root), d = data(view), on = knobOn(view, "remap");
    const cw = w / 12;
    g.textAlign = "center";
    for (let i = 0; i < 12; i++) {
      const x = i * cw, t = d.remap[i], moved = t !== i;
      g.globalAlpha = on ? 1 : 0.45;
      g.fillStyle = BLACK.includes(i) ? th.line : th.panel;
      g.fillRect(x + 1, 2, cw - 2, h * 0.5 - 2);
      g.strokeStyle = th.line; g.strokeRect(x + 1.5, 2.5, cw - 3, h * 0.5 - 3);
      g.fillStyle = th.text; g.font = "600 11px system-ui, sans-serif"; g.fillText(NAMES[i], x + cw / 2, h * 0.25 + 4);
      g.fillStyle = t < 0 ? "#f2564b" : moved ? th.accent : th.muted; g.font = "11px system-ui, sans-serif";
      g.fillText(t < 0 ? "✕" : "→ " + NAMES[t], x + cw / 2, h * 0.5 + 20);
      if (moved) {
        g.strokeStyle = t < 0 ? "#f2564b" : th.accent; g.beginPath();
        g.moveTo(x + cw / 2, h * 0.5 - 2); g.lineTo(x + cw / 2, h * 0.5 + 4); g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  function attachRemap(view, cv) {
    cv.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const r = cv.getBoundingClientRect(), i = clamp(Math.floor(((e.clientX - r.left) / r.width) * 12), 0, 11), d = data(view);
      if (e.button === 2) d.remap[i] = i;
      else { const v = d.remap[i] + (e.shiftKey ? -1 : 1); d.remap[i] = v > 11 ? -1 : v < -1 ? 11 : v; }
      commit(view);
    });
    cv.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
  }

  function drawCurve(view, cv) {
    const { g, w, h } = BleepView.fit(cv), th = BleepView.theme(view.root), d = data(view), drawn = knobOn(view, "curvemode");
    const pad = 6, pw = w - 2 * pad, ph = h - 2 * pad, X = (i) => pad + (i / 16) * pw, Y = (v) => pad + (1 - v) * ph;
    g.strokeStyle = th.line; g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(pad + pw, Y(1)); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
    g.strokeRect(pad + 0.5, pad + 0.5, pw - 1, ph - 1);
    const bend = (view.node.params.bend ?? 0.5) * 2 - 1;
    g.strokeStyle = th.accent; g.lineWidth = 2; g.globalAlpha = 1; g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const u = i / 64, v = drawn ? lerp(d.curve, u) : Math.pow(u, Math.pow(2, -2 * bend));
      i ? g.lineTo(pad + u * pw, Y(v)) : g.moveTo(pad + u * pw, Y(v));
    }
    g.stroke(); g.lineWidth = 1;
    if (drawn) { g.fillStyle = th.accent; d.curve.forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(v), 2.5, 0, 6.3); g.fill(); }); }
    const st = view._st;
    if (st && typeof st.lastvel === "number" && st.lastvel > 0) {  // the last passed note's velocity in
      const x = pad + st.lastvel * pw; g.strokeStyle = th.text; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, pad); g.lineTo(x, pad + ph); g.stroke(); g.globalAlpha = 1;
    }
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "left"; g.fillText(drawn ? "drag to draw" : "set Curve to Drawn to edit", pad + 4, pad + 10);
  }
  function lerp(c, u) { const x = u * 16, i = Math.min(15, Math.floor(x)), f = x - i; return c[i] * (1 - f) + c[i + 1] * f; }
  function attachCurve(view, cv) {
    let drag = false;
    const set = (e) => {
      const r = cv.getBoundingClientRect(), pad = 6, pw = r.width - 2 * pad, ph = r.height - 2 * pad, d = data(view);
      const i = clamp(Math.round(((e.clientX - r.left - pad) / pw) * 16), 0, 16), v = clamp(1 - (e.clientY - r.top - pad) / ph, 0, 1);
      d.curve[i] = Math.round(v * 1000) / 1000;
      view.node.data = d;
      view.api.setData(JSON.parse(JSON.stringify(d)));
    };
    cv.addEventListener("pointerdown", (e) => { if (e.button) return; e.stopPropagation(); cv.setPointerCapture(e.pointerId); view.api.beginGesture(); drag = true; set(e); });
    cv.addEventListener("pointermove", (e) => { if (drag) set(e); });
    const end = () => (drag = false);
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  }

  function drawSteps(view, cv) {
    const { g, w, h } = BleepView.fit(cv), th = BleepView.theme(view.root), d = data(view), on = knobOn(view, "stepsrule");
    const cw = w / 16, st = view._st || {};
    for (let i = 0; i < 16; i++) {
      const x = i * cw, beat = i % 4 === 0;
      g.globalAlpha = on ? 1 : 0.4;
      g.fillStyle = d.steps[i] ? th.accent : th.line; g.globalAlpha *= d.steps[i] ? 0.9 : 0.35;
      g.fillRect(x + 1.5, 4, cw - 3, h - 18);
      g.globalAlpha = on ? 1 : 0.4;
      if (st.step === i && st.running !== 0) { g.strokeStyle = th.text; g.strokeRect(x + 1.5, 4, cw - 3, h - 18); }
      g.fillStyle = th.muted; g.font = (beat ? "600 " : "") + "9px system-ui, sans-serif"; g.textAlign = "center";
      g.fillText(beat ? String(i / 4 + 1) : "·", x + cw / 2, h - 4);
    }
    g.globalAlpha = 1;
  }
  function attachSteps(view, cv) {
    let value = null;
    const at = (e) => { const r = cv.getBoundingClientRect(); return clamp(Math.floor(((e.clientX - r.left) / r.width) * 16), 0, 15); };
    cv.addEventListener("pointerdown", (e) => {
      if (e.button) return; e.stopPropagation(); cv.setPointerCapture(e.pointerId); view.api.beginGesture();
      const d = data(view), i = at(e); value = d.steps[i] ? 0 : 1; d.steps[i] = value; commit(view);
    });
    cv.addEventListener("pointermove", (e) => { if (value === null) return; const d = data(view), i = at(e); if (d.steps[i] !== value) { d.steps[i] = value; commit(view); } });
    const end = () => (value = null);
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  }

  BleepViews.register("note-gate", {
    top: true,
    width: 760,
    template: '<div class="bv-panel" style="flex:2 1 360px"><h2>Remap · pitch class to pitch class</h2><canvas class="ng-remap" style="height:64px"></canvas></div>' +
      '<div class="bv-panel" style="flex:1 1 160px"><h2>Velocity curve</h2><canvas class="ng-curve" style="height:64px"></canvas></div>' +
      '<div class="bv-panel" style="flex:1 1 100%"><h2>Step lane · sixteenths of the bar</h2><canvas class="ng-steps" style="height:44px"></canvas></div>',
    partNames: ["Remap", "Velocity curve", "Step lane"],
    afterBuild(view, custom) {
      const remap = custom.querySelector(".ng-remap"), curve = custom.querySelector(".ng-curve"), steps = custom.querySelector(".ng-steps");
      attachRemap(view, remap); attachCurve(view, curve); attachSteps(view, steps);
      BleepView.loop(view.root, () => { drawRemap(view, remap); drawCurve(view, curve); drawSteps(view, steps); });
    },
    onState(st, view) { view._st = st; },
  });
})();
