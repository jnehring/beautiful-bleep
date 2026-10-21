// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Mic Colour's own UI (the JavaScript of the Code node's UI tab): a top-down view of the room.
// The microphone (left) shows the polar pattern of the chosen model; the source (the loudspeaker) is a dot you drag left and right to set Distance.
// Grab the microphone to turn it away from the source (Off-Axis). Rings round the capsule thicken with the proximity effect, dots bounce off the walls
// as early reflections (Room), and ripples leave the source with the signal level. Click a model pill to switch model. Underneath: the frequency response.

const T = bleep.theme;
const c = bleep.canvas(280);
const P = (id) => bleep.param(id);
// The stage: the canvas spans the whole node, so everything is drawn on a centred stage of at most 640 px. SW() is the stage width (it shrinks
// below 640 px, and the layout is written in terms of it), OX() the left offset: drawing is translated by it and pointer positions have it subtracted.
const SW = () => Math.min(c.width, 640), OX = () => (c.width - SW()) / 2;
const MODELS = ["Ribbon", "Dynamic", "Condenser", "Tube"];
const PATTERN = [0, 0.5, 0.65, 0.6];                  // polar pattern r(a) = |A + (1 - A) cos a|: 0 is a figure-8, 1 would be an omni

// ---- 1. the maths for the response curve (analog prototypes, the same formulas the module designs from) ------------------------------------
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const poly = (k, s) => { let r = [0, 0], p = [1, 0]; for (const ki of k) { r = [r[0] + ki * p[0], r[1] + ki * p[1]]; p = mul(p, s); } return r; };
const proto = (nb, na, f, f0) => { const s = [0, f / f0]; return div(poly(nb, s), poly(na, s)); };
const hp2 = (f, f0, Q) => proto([0, 0, 1], [1, 1 / Q, 1], f, f0), lp2 = (f, f0, Q) => proto([1, 0, 0], [1, 1 / Q, 1], f, f0);
const lowShelf2 = (f, f0, db, Q) => { const A = 10 ** (db / 40), r = Math.sqrt(A) / Q; return proto([A * A, A * r, A], [1, r, A], f, f0); };
const highShelf2 = (f, f0, db, Q) => { const A = 10 ** (db / 40), r = Math.sqrt(A) / Q; return proto([A, A * r, A * A], [A, r, 1], f, f0); };
const bell = (f, f0, db, Q) => { const A = 10 ** (db / 40); return proto([1, A / Q, 1], [1, 1 / (A * Q), 1], f, f0); };
const cl = (x) => Math.min(1, Math.max(0, x));
function response(f, m, q) {
  const d = q.distance, prox = q.proximity / 100, pr = q.presence / 100, c2 = q.colour / 50, dia = q.diaphragm / 100, off = q.offAxis / 100;
  const close = cl(Math.log(40 / d) / Math.log(40 / 3)), far = cl(Math.log(d / 100) / Math.log(3)), air = 4 * cl(Math.log(d / 50) / Math.log(6)), diaF = 7500 * Math.pow(13000 / 7500, 1 - dia);
  let z = mul(hp2(f, [35, 90, 18, 22][m], 0.7071), lowShelf2(f, 200, prox * close * [10, 7, 4, 5][m] - 2 * far, 0.6));
  if (m === 0) z = mul(z, bell(f, 140, 3 * c2, 1.1)); else if (m === 1) z = mul(z, bell(f, 700, 1.5 * c2, 0.6)); else if (m === 3) z = mul(z, bell(f, 120, 1.5 * c2, 0.8));
  z = mul(z, m === 0 ? bell(f, 3200, 6 * pr, 0.8) : m === 1 ? bell(f, 4200, 5 * c2 + 4 * pr, 0.9) : m === 2 ? bell(f, diaF, 1.5 + 3 * c2 + 4 * pr, 1) : bell(f, diaF, 1 + 2 * c2 + 4 * pr, 1));
  if (m === 0) z = mul(z, lp2(f, 9500 / Math.sqrt(Math.max(c2, 0.1)), 0.6)); else if (m === 1) z = mul(z, lp2(f, 15000, 0.7071)); else if (m === 3) z = mul(z, lp2(f, 18000, 0.6));
  z = mul(z, highShelf2(f, 7000, (m === 2 ? 3 * c2 : m === 3 ? 1.5 * c2 : 0) - air - off * 8, 0.6));
  return 20 * Math.log10(Math.max(Math.hypot(z[0], z[1]), 1e-6));
}
const N = 120, curve = new Float32Array(N); let sig = "";
function recompute() {                                   // cached: only when a knob has moved
  const ids = ["model", "distance", "proximity", "presence", "colour", "diaphragm", "offAxis"], q = {}; ids.forEach((i) => { q[i] = P(i).value; });
  const s = ids.map((i) => q[i]).join(); if (s === sig) return; sig = s;
  for (let i = 0; i < N; i++) curve[i] = response(30 * Math.pow(600, i / (N - 1)), q.model | 0, q);
}

// ---- 2. geometry: distance 3..300 cm maps logarithmically to the horizontal position of the source -----------------------------------------------
const room = () => ({ x: 8, y: 8, w: Math.max(100, SW() - 16), h: 150 });
const mic = () => { const r = room(); return { x: r.x + 40, y: r.y + r.h / 2 }; };
const srcX = (d) => { const r = room(), m = mic(); return m.x + 30 + (r.x + r.w - 20 - m.x - 30) * Math.log(d / 3) / Math.log(100); };
const xToD = (x) => { const r = room(), m = mic(); return 3 * Math.pow(100, cl((x - m.x - 30) / (r.x + r.w - 20 - m.x - 30))); };

// ---- 3. pointer: pills switch the model; the source is dragged for Distance; the microphone is turned for Off-Axis -------------------------------
const pos = (e) => { const r = c.el.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / (r.width || 1) - OX(), (e.clientY - r.top) * c.height / (r.height || 1)]; };
let drag = null;
c.el.addEventListener("pointerdown", (e) => {
  const [x, y] = pos(e), m = mic(), sx = srcX(P("distance").value);
  for (let i = 0; i < 4; i++) { const px = 8 + i * Math.max(60, (SW() - 16) / 4); if (y > 164 && y < 184 && x > px && x < px + 56) { P("model").set(i); return; } }
  if (Math.hypot(x - sx, y - m.y) < 18) drag = "source"; else if (Math.hypot(x - m.x, y - m.y) < 22) drag = "mic"; else return;
  c.el.setPointerCapture(e.pointerId);
});
c.el.addEventListener("pointermove", (e) => {
  if (!drag) return; const [x, y] = pos(e), m = mic();
  if (drag === "source") P("distance").set(xToD(x));
  else P("offAxis").set(100 * Math.min(1, Math.abs(Math.atan2(y - m.y, Math.max(x - m.x, 0.001))) / (Math.PI / 2)));   // the angle of the pointer from the axis, 0..90 degrees -> 0..100 %
});
const up = (e) => { drag = null; try { c.el.releasePointerCapture(e.pointerId); } catch (_) {} };
c.el.addEventListener("pointerup", up); c.el.addEventListener("pointercancel", up);

// ---- 4. every frame -----------------------------------------------------------------------------------------------------------------------------
let level = 0, t = 0;
bleep.onFrame((dt) => {
  recompute(); t += dt;
  level += (Math.min(1, bleep.probe("level")) - level) * (1 - Math.exp(-dt * 10));    // ease the polled probe (frame-rate independent)
  const g = c.g, r = room(), m = mic(), model = P("model").value | 0, d = P("distance").value, off = P("offAxis").value / 100, roomAmt = P("room").value / 100;
  const sx = srcX(d), dist01 = cl(Math.log(d / 3) / Math.log(100)), close = cl(Math.log(40 / d) / Math.log(40 / 3));
  g.clearRect(0, 0, c.width, c.height); g.save(); g.translate(OX(), 0); g.font = "11px sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
  g.fillStyle = T.panel; g.strokeStyle = T.line; g.lineWidth = 2; g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 10); g.fill(); g.stroke();

  // ripples leave the source; louder signal, stronger ripples. At silence a slow idle ripple keeps the room alive.
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.6 + k / 3) % 1, rad = 6 + ph * 40;
    g.strokeStyle = T.accent; g.globalAlpha = (1 - ph) * (0.15 + 0.6 * level); g.lineWidth = 2; g.beginPath(); g.arc(sx, m.y, Math.max(0, rad), 0, 7); g.stroke();
  }
  g.globalAlpha = 1;
  // early reflections: six dots follow source -> wall -> microphone; the walls alternate top, bottom, far side
  const wall = (k) => k % 3 === 0 ? [(sx + m.x) / 2 + 20 * k, r.y + 4] : k % 3 === 1 ? [(sx + m.x) / 2 - 15 * k, r.y + r.h - 4] : [r.x + r.w - 4, m.y + (k - 3) * 10];
  const rv = roomAmt * (0.3 + 0.7 * dist01);
  for (let k = 0; k < 6; k++) {
    const u = (t * 0.35 + k * 0.17) % 1, w = wall(k), seg = u < 0.5 ? u * 2 : (u - 0.5) * 2, a = u < 0.5 ? [sx, m.y] : w, b = u < 0.5 ? w : [m.x, m.y];
    g.fillStyle = T.text; g.globalAlpha = rv * 0.8; g.beginPath(); g.arc(a[0] + (b[0] - a[0]) * seg, a[1] + (b[1] - a[1]) * seg, 2.5, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  // the source: a loudspeaker dot that pumps with the level
  const hover = drag === "source"; g.fillStyle = T.accent; g.beginPath(); g.arc(sx, m.y, 8 + 4 * level + (hover ? 2 : 0), 0, 7); g.fill();
  g.fillStyle = T.muted; g.fillText(d.toFixed(0) + " cm", sx, m.y + 24);
  // the polar pattern, rotated by Off-Axis: the pattern turns, the source stays
  const A = PATTERN[model], rot = off * Math.PI / 2;
  g.fillStyle = T.accent; g.globalAlpha = 0.18; g.beginPath();
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI, rr = 38 * Math.abs(A + (1 - A) * Math.cos(a)), aa = a + rot; const x = m.x + Math.cos(aa) * rr, y = m.y + Math.sin(aa) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.fill(); g.globalAlpha = 0.7; g.strokeStyle = T.accent; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1;
  // proximity rings: thicker the closer the source and the higher Proximity; they pulse with the level
  const prox = (P("proximity").value / 100) * close;
  for (let k = 1; k <= 3; k++) { g.strokeStyle = T.warn; g.globalAlpha = 0.25 + 0.5 * prox; g.lineWidth = Math.max(0.5, prox * 5 * (1 + level) / k); g.beginPath(); g.arc(m.x, m.y, 12 + k * 6, 0, 7); g.stroke(); }
  g.globalAlpha = 1;
  g.fillStyle = drag === "mic" ? T.text : T.line; g.strokeStyle = T.text; g.lineWidth = 2; g.beginPath(); g.arc(m.x, m.y, 9, 0, 7); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(m.x + Math.cos(rot) * 16, m.y + Math.sin(rot) * 16); g.stroke();      // the capsule's axis

  // model pills
  const pw = Math.max(60, (SW() - 16) / 4);
  for (let i = 0; i < 4; i++) { g.globalAlpha = i === model ? 1 : 0.45; g.fillStyle = i === model ? T.accent : T.panel; g.beginPath(); g.roundRect(8 + i * pw, 165, 56, 18, 9); g.fill(); g.fillStyle = i === model ? T.bg : T.text; g.fillText(MODELS[i], 36 + i * pw, 174); }
  g.globalAlpha = 1;
  // response curve (log frequency 30 Hz..18 kHz, -12..+14 dB)
  const px = 30, pw2 = Math.max(40, SW() - 44), py = 192, ph = 78, Y = (v) => py + ph * (1 - (Math.max(-12, Math.min(14, v)) + 12) / 26);
  g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(px, Y(0)); g.lineTo(px + pw2, Y(0)); g.stroke(); g.fillStyle = T.muted; g.textAlign = "right"; g.fillText("0 dB", px - 3, Y(0));
  g.strokeStyle = T.text; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < N; i++) { const x = px + pw2 * i / (N - 1), y = Y(curve[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
  g.textAlign = "center";
  g.restore();
});
