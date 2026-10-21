// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Opto Compressor's own UI (the JavaScript of the Code node's UI tab).
// Left: the lamp. Its glow is the gain reduction; drag it up or down to turn Peak Reduction (the ring around it shows the setting).
// Middle: the photocell, two bars filling at their own speeds: the fast stage (quick to answer, quick to let go) and the slow stage (the "charge":
// it fills over seconds and is what lingers after long compression). Right: a needle on a spring; click the dial to flip Compress / Limit.
// Bottom: a scrolling history of the gain reduction (bright) and the charge (faint).

const T = bleep.theme;
const c = bleep.canvas(290);
const P = (id) => bleep.param(id);
// The stage: the canvas spans the whole node, so everything is drawn on a centred stage of at most 640 px. SW() is the stage width (it shrinks
// below 640 px, and the layout is written in terms of it), OX() the left offset: drawing is translated by it and pointer positions have it subtracted.
const SW = () => Math.min(c.width, 640), OX = () => (c.width - SW()) / 2;

// ---- 1. state the picture keeps between frames ------------------------------------------------------------------------------------------
// The module reports its probes 10-30 times a second. We never draw them raw: each is chased with an exponential ease whose factor
// 1 - exp(-dt * rate) does not depend on the frame rate.
const s = { gr: 0, fast: 0, slow: 0, needle: 0, vel: 0 };
const HIST = 300, hist = new Float32Array(HIST), histSlow = new Float32Array(HIST);   // ring buffers allocated once, never per frame
let head = 0, histTimer = 0, t = 0, drag = null;

// ---- 2. geometry (everything is a fraction of the canvas width, so the picture also works in a narrow node) -------------------------------------
const geo = () => { const w = SW(); return { lamp: { x: w * 0.17, y: 100, r: Math.max(16, Math.min(46, w * 0.08)) }, cell: { x: w * 0.38, y: 30, w: Math.max(16, w * 0.06), h: 135 }, dial: { x: w * 0.74, y: 150, r: Math.max(34, Math.min(95, w * 0.17)) }, hist: { x: 10, y: 205, w: w - 20, h: 74 } }; };

// ---- 3. pointer: dragging the lamp sets Peak Reduction ---------------------------------------------------------------------------------------
const pos = (e) => { const r = c.el.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / (r.width || 1) - OX(), (e.clientY - r.top) * c.height / (r.height || 1)]; };
c.el.addEventListener("pointerdown", (e) => {
  const [x, y] = pos(e), g = geo();
  if (Math.hypot(x - g.lamp.x, y - g.lamp.y) < g.lamp.r + 18) { drag = { y0: y, v0: P("peakReduction").value }; c.el.setPointerCapture(e.pointerId); }
  else if (Math.hypot(x - g.dial.x, y - g.dial.y) < g.dial.r) P("mode").set(P("mode").value ? 0 : 1);   // a choice param takes the index
});
c.el.addEventListener("pointermove", (e) => { if (!drag) return; const y = pos(e)[1]; P("peakReduction").set(drag.v0 + (drag.y0 - y) / 1.2); });   // 120 px = the whole 0..100
const up = (e) => { drag = null; try { c.el.releasePointerCapture(e.pointerId); } catch (_) {} };
c.el.addEventListener("pointerup", up); c.el.addEventListener("pointercancel", up);

// ---- 4. every frame ------------------------------------------------------------------------------------------------------------------------
bleep.onFrame((dt) => {
  t += dt;
  const ease = (a, b, rate) => a + (b - a) * (1 - Math.exp(-dt * rate));
  s.gr = ease(s.gr, bleep.probe("gr"), 14); s.fast = ease(s.fast, bleep.probe("fast"), 14); s.slow = ease(s.slow, bleep.probe("charge"), 14);
  // the needle is a mass on a spring (semi-implicit Euler): it overshoots a little and settles, which reads as "physical"
  const idle = 0.15 * Math.sin(t * 2.1) * Math.sin(t * 0.7);                       // a tiny tremble so a silent module never looks dead
  s.vel += ((s.gr + idle) - s.needle) * 120 * dt; s.vel *= Math.exp(-dt * 9); s.needle += s.vel * dt;
  histTimer += dt; if (histTimer > 1 / 30) { histTimer = 0; head = (head + 1) % HIST; hist[head] = s.gr; histSlow[head] = s.slow; }

  const g = c.g, G = geo(), lamp = G.lamp, cell = G.cell, dial = G.dial, H = G.hist;
  g.clearRect(0, 0, c.width, c.height); g.save(); g.translate(OX(), 0); g.font = "11px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";

  // the lamp: a radial glow whose size and alpha follow the reduction; breathing slightly at idle
  const glow = Math.min(1, s.gr / 18), breathe = 0.05 + 0.03 * Math.sin(t * 1.3);
  const R = lamp.r * (1.6 + 2.2 * glow);
  const grad = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R);
  grad.addColorStop(0, T.accent); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = Math.min(1, breathe + glow); g.fillStyle = grad; g.beginPath(); g.arc(lamp.x, lamp.y, R, 0, 7); g.fill(); g.globalAlpha = 1;
  g.fillStyle = T.panel; g.strokeStyle = drag ? T.text : T.line; g.lineWidth = 2; g.beginPath(); g.arc(lamp.x, lamp.y, lamp.r, 0, 7); g.fill(); g.stroke();
  g.globalAlpha = 0.35 + 0.65 * glow; g.fillStyle = T.accent; g.beginPath(); g.arc(lamp.x, lamp.y, lamp.r * 0.7, 0, 7); g.fill(); g.globalAlpha = 1;
  const pr = P("peakReduction"); g.strokeStyle = T.accent; g.lineWidth = 3;              // the ring: Peak Reduction as a fraction of a full turn
  g.beginPath(); g.arc(lamp.x, lamp.y, lamp.r + 7, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * pr.normalised + 1e-4); g.stroke();
  g.fillStyle = T.muted; g.fillText("Peak Reduction " + pr.value.toFixed(0), lamp.x, lamp.y + lamp.r + 26);

  // the photocell: two bars on a 0..24 dB scale
  g.strokeStyle = T.line; g.lineWidth = 1; g.fillStyle = T.panel; g.beginPath(); g.roundRect(cell.x - 6, cell.y - 6, cell.w * 2 + 18, cell.h + 12, 8); g.fill(); g.stroke();
  [[s.fast, "fast", cell.x, T.accent], [s.slow, "slow", cell.x + cell.w + 6, T.warn]].forEach(([v, name, x, col]) => {
    const hh = cell.h * Math.min(1, v / 24); g.fillStyle = col; g.beginPath(); g.roundRect(x, cell.y + cell.h - hh, cell.w, Math.max(0, hh), 3); g.fill();
    g.fillStyle = T.muted; g.fillText(name, x + cell.w / 2, cell.y + cell.h + 16);
  });

  // the dial: a half circle scale 0..24 dB and the needle
  g.strokeStyle = T.line; g.lineWidth = 6; g.beginPath(); g.arc(dial.x, dial.y, dial.r, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  g.strokeStyle = T.accent; g.lineWidth = 6; const frac = Math.max(0, Math.min(1, s.needle / 24));
  g.beginPath(); g.arc(dial.x, dial.y, dial.r, Math.PI * 1.15, Math.PI * (1.15 + 0.7 * frac) + 1e-4); g.stroke();
  const a = Math.PI * (1.15 + 0.7 * Math.max(0, Math.min(1.1, s.needle / 24)));
  g.strokeStyle = T.text; g.lineWidth = 2; g.beginPath(); g.moveTo(dial.x, dial.y); g.lineTo(dial.x + Math.cos(a) * (dial.r - 8), dial.y + Math.sin(a) * (dial.r - 8)); g.stroke();
  g.fillStyle = T.text; g.beginPath(); g.arc(dial.x, dial.y, 4, 0, 7); g.fill();
  g.fillText(s.gr.toFixed(1) + " dB", dial.x, dial.y + 16); g.fillStyle = T.muted; g.fillText(P("mode").value ? "Limit (click)" : "Compress (click)", dial.x, dial.y + 30);

  // the history strip: newest on the right
  g.fillStyle = T.panel; g.beginPath(); g.roundRect(H.x, H.y, H.w, H.h, 6); g.fill();
  const n = Math.min(HIST, Math.floor(H.w / 2)), draw = (a, col, alpha) => {
    g.strokeStyle = col; g.globalAlpha = alpha; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < n; i++) { const v = a[(head - n + 1 + i + HIST * 2) % HIST], x = H.x + H.w - (n - 1 - i) * 2, y = H.y + H.h - 4 - (H.h - 8) * Math.min(1, v / 24); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke(); g.globalAlpha = 1;
  };
  draw(histSlow, T.warn, 0.45); draw(hist, T.accent, 1);
  g.restore();
});
