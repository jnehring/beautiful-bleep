// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Tone EQ's own UI (the JavaScript of the Code node's UI tab).
// It draws the response of the network you are hearing, computed from the knobs with the same analog formulas the module designs from.
// Passive Shelf shows the boost and the attenuation as two ghost curves (amber = boost, red = attenuation) whose sum is the white curve, so you
// can see them interact. Drag a round handle: up/down sets its amount, left/right snaps its stepped frequency. Click a mode pill to switch
// mode. In Tilt mode drag the diamond. In Tone Stack mode turn the three dials (drag up or down). A dot sweeps along the curve and glows with the output level.

const T = bleep.theme;
const c = bleep.canvas(260);                       // as wide as the node, 260 px high; c.g is a 2D context, c.width/height are in CSS pixels
const P = (id) => bleep.param(id);
// The stage: the canvas spans the whole node, so everything is drawn on a centred stage of at most 640 px. SW() is the stage width (it shrinks
// below 640 px, and the layout is written in terms of it), OX() the left offset: drawing is translated by it and pointer positions have it subtracted.
const SW = () => Math.min(c.width, 640), OX = () => (c.width - SW()) / 2;
const MODES = ["Passive Shelf", "Tilt", "Tone Stack"];
const LOW = [20, 30, 60, 100], HIGH = [3000, 4000, 5000, 8000, 10000, 12000, 16000], ATT = [5000, 10000, 20000], PIVOT = [250, 400, 650, 1000, 1600, 2500];
const DB = 18;                                     // the plot shows -18..+18 dB
const FMIN = 20, FMAX = 20000;

// ---- 1. the maths: complex response of the analog prototypes (the module's own formulas) ------------------------------------------------
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const poly = (k, s) => { let r = [0, 0], p = [1, 0]; for (const ki of k) { r = [r[0] + ki * p[0], r[1] + ki * p[1]]; p = mul(p, s); } return r; };   // k ascending
const proto = (nb, na, f, f0) => { const s = [0, f / f0]; return div(poly(nb, s), poly(na, s)); };
const lowShelf2 = (f, f0, db, Q) => { const A = 10 ** (db / 40), r = Math.sqrt(A) / Q; return proto([A * A, A * r, A], [1, r, A], f, f0); };
const bell = (f, f0, db, Q) => { const A = 10 ** (db / 40); return proto([1, A / Q, 1], [1, 1 / (A * Q), 1], f, f0); };
const lowShelf1 = (f, f0, db) => { const g = 10 ** (db / 40); return proto([g, 1], [1 / g, 1], f, f0); };
const highShelf1 = (f, f0, db) => { const g = 10 ** (db / 40); return proto([g, g * g], [g, 1], f, f0); };
// the tone stack: nodal analysis of the RC network, solved with a tiny complex Gaussian elimination
function stack(f, bass, mid, treble) {
  const x = bass / 10, l = (Math.exp(3 * x) - 1) / (Math.exp(3) - 1), m = mid / 10, t = treble / 10, w = 2 * Math.PI * f;
  const Y = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => [0, 0])), rhs = [[0, 0], [0, 0], [0, 0], [0, 0]];   // nodes A, B, E, W3
  const add = (a, b, y) => {                       // an admittance y between nodes a and b (-1 ground, -2 the input)
    if (a >= 0) { Y[a][a][0] += y[0]; Y[a][a][1] += y[1]; } if (b >= 0) { Y[b][b][0] += y[0]; Y[b][b][1] += y[1]; }
    if (a >= 0 && b >= 0) { Y[a][b][0] -= y[0]; Y[a][b][1] -= y[1]; Y[b][a][0] -= y[0]; Y[b][a][1] -= y[1]; }
    if (a >= 0 && b === -2) { rhs[a][0] += y[0]; rhs[a][1] += y[1]; } if (b >= 0 && a === -2) { rhs[b][0] += y[0]; rhs[b][1] += y[1]; }
  };
  const R = (r) => [1 / Math.max(r, 50), 0], C = (cap) => [0, w * cap];
  add(-2, 0, C(250e-12)); add(0, 1, R(250e3)); add(-2, 2, R(56e3)); add(2, 1, C(20e-9)); add(2, 3, C(20e-9));
  add(1, 3, R(l * 1e6 + (1 - m) * 25e3)); add(3, -1, R(m * 25e3));
  for (let i = 0; i < 4; i++) {                    // forward elimination (no pivoting is needed for this admittance matrix)
    for (let r = i + 1; r < 4; r++) { const k = div(Y[r][i], Y[i][i]); for (let j = i; j < 4; j++) { const q = mul(k, Y[i][j]); Y[r][j] = [Y[r][j][0] - q[0], Y[r][j][1] - q[1]]; } const q = mul(k, rhs[i]); rhs[r] = [rhs[r][0] - q[0], rhs[r][1] - q[1]]; }
  }
  const v = [null, null, null, null];
  for (let i = 3; i >= 0; i--) { let s = rhs[i]; for (let j = i + 1; j < 4; j++) { const q = mul(Y[i][j], v[j]); s = [s[0] - q[0], s[1] - q[1]]; } v[i] = div(s, Y[i][i]); }
  const out = [t * v[0][0] + (1 - t) * v[1][0], t * v[0][1] + (1 - t) * v[1][1]];   // the treble wiper
  return [out[0] * 2.8, out[1] * 2.8];             // + 9 dB make-up
}
const db = (z) => 20 * Math.log10(Math.max(Math.hypot(z[0], z[1]), 1e-6));

// ---- 2. curves are cached: recomputed only when a knob has moved (a signature string of the values) ---------------------------------------
const N = 160, freqs = Float32Array.from({ length: N }, (_, i) => FMIN * Math.pow(FMAX / FMIN, i / (N - 1)));
const total = new Float32Array(N), boost = new Float32Array(N), cut = new Float32Array(N);
let sig = "";
function recompute() {
  const v = (id) => P(id).value, s = ["mode", "lowFreq", "lowBoost", "lowAtten", "hiFreq", "hiBoost", "bandwidth", "attFreq", "hiAtten", "tilt", "pivot", "bass", "mid", "treble"].map(v).join();
  if (s === sig) return; sig = s;
  const mode = v("mode") | 0, lf = LOW[v("lowFreq") | 0], hf = HIGH[v("hiFreq") | 0], af = ATT[v("attFreq") | 0], pv = PIVOT[v("pivot") | 0], Q = 2 * Math.pow(0.35 / 2, v("bandwidth") / 10);
  for (let i = 0; i < N; i++) {
    const f = freqs[i];
    if (mode === 0) {
      boost[i] = db(mul(lowShelf2(f, lf, v("lowBoost") * 1.5, 0.9), bell(f, hf, v("hiBoost") * 1.6, Q)));
      cut[i] = db(mul(lowShelf1(f, lf * 2.4, -v("lowAtten") * 1.2), highShelf1(f, af, -v("hiAtten") * 1.4)));
      total[i] = boost[i] + cut[i];
    } else if (mode === 1) { boost[i] = cut[i] = 0; total[i] = db(mul(lowShelf1(f, pv / 2.5, -v("tilt")), highShelf1(f, pv * 2.5, v("tilt")))); }
    else { boost[i] = cut[i] = 0; total[i] = db(stack(f, v("bass"), v("mid"), v("treble"))); }
  }
}

// ---- 3. geometry helpers ----------------------------------------------------------------------------------------------------------------
const PLOT = () => ({ x: 34, y: 32, w: Math.max(40, SW() - 46), h: 150 });
const fx = (f) => { const p = PLOT(); return p.x + p.w * Math.log(f / FMIN) / Math.log(FMAX / FMIN); };
const dy = (d) => { const p = PLOT(); return p.y + p.h * (0.5 - Math.max(-DB, Math.min(DB, d)) / (2 * DB)); };
const yToDb = (y) => { const p = PLOT(); return (0.5 - (y - p.y) / p.h) * 2 * DB; };
const nearest = (list, f) => { let b = 0; for (let i = 1; i < list.length; i++) if (Math.abs(Math.log(list[i] / f)) < Math.abs(Math.log(list[b] / f))) b = i; return b; };
const xToF = (x) => { const p = PLOT(); return FMIN * Math.pow(FMAX / FMIN, Math.max(0, Math.min(1, (x - p.x) / p.w))); };

// handles of the current mode: where they sit and what dragging them does. Rebuilt on demand (a handful of small objects).
function handles() {
  const v = (id) => P(id).value, mode = v("mode") | 0, h = [];
  if (mode === 0) {
    const lf = LOW[v("lowFreq") | 0];
    h.push({ id: "lowBoost", x: fx(lf), y: dy(v("lowBoost") * 1.5), col: T.accent, per: 1.5, sign: 1, freq: ["lowFreq", LOW] });
    h.push({ id: "lowAtten", x: fx(lf * 2.4), y: dy(-v("lowAtten") * 1.2), col: T.warn, per: 1.2, sign: -1 });
    h.push({ id: "hiBoost", x: fx(HIGH[v("hiFreq") | 0]), y: dy(v("hiBoost") * 1.6), col: T.accent, per: 1.6, sign: 1, freq: ["hiFreq", HIGH] });
    h.push({ id: "hiAtten", x: fx(ATT[v("attFreq") | 0]), y: dy(-v("hiAtten") * 1.4), col: T.warn, per: 1.4, sign: -1, freq: ["attFreq", ATT] });
  } else if (mode === 1) h.push({ id: "tilt", x: fx(PIVOT[v("pivot") | 0]), y: dy(v("tilt")), col: T.accent, per: 1, sign: 1, freq: ["pivot", PIVOT], diamond: true });
  return h;
}
const dials = () => [["bass", "Bass"], ["mid", "Mid"], ["treble", "Treble"]].map(([id, name], i) => ({ id, name, x: 70 + i * 90, y: 222, r: 22 }));

// ---- 4. pointer: one object says what is being dragged ---------------------------------------------------------------------------------
let drag = null, hover = null;
const pos = (e) => { const r = c.el.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / (r.width || 1) - OX(), (e.clientY - r.top) * c.height / (r.height || 1)]; };
function pick(x, y) {
  if (y < 26) { for (let i = 0; i < 3; i++) if (x > 8 + i * 98 && x < 8 + i * 98 + 92) return { pill: i }; }
  if ((P("mode").value | 0) === 2) for (const d of dials()) if (Math.hypot(x - d.x, y - d.y) < d.r + 6) return { dial: d, y0: y, v0: P(d.id).value };
  let best = null, bd = 16;
  for (const h of handles()) { const dd = Math.hypot(x - h.x, y - h.y); if (dd < bd) { bd = dd; best = h; } }
  return best ? { handle: best } : null;
}
c.el.addEventListener("pointerdown", (e) => {
  const [x, y] = pos(e), hit = pick(x, y);
  if (!hit) return;
  if (hit.pill !== undefined) { P("mode").set(hit.pill); return; }       // choice params take the index
  drag = hit; c.el.setPointerCapture(e.pointerId);                          // keep receiving moves when the pointer leaves the canvas
});
c.el.addEventListener("pointermove", (e) => {
  const [x, y] = pos(e);
  if (!drag) { hover = pick(x, y); return; }
  if (drag.dial) { P(drag.dial.id).set(drag.v0 + (drag.y0 - y) / 12); return; }       // 120 px of travel for the whole 0..10
  const h = drag.handle, d = yToDb(y);
  if (h.id === "tilt") P("tilt").set(d); else P(h.id).set(Math.max(0, h.sign * d / h.per));   // dB at the pointer -> the knob's 0..10
  if (h.freq) P(h.freq[0]).set(nearest(h.freq[1], h.id === "lowAtten" ? xToF(x) / 2.4 : xToF(x)));   // horizontal drag snaps to the stepped frequencies
});
const release = (e) => { drag = null; try { c.el.releasePointerCapture(e.pointerId); } catch (_) {} };
c.el.addEventListener("pointerup", release); c.el.addEventListener("pointercancel", release);

// ---- 5. every frame: ease the polled probe, then draw --------------------------------------------------------------------------------------
let level = 0, t = 0;
bleep.onFrame((dt) => {
  recompute();
  // the probe arrives 10-30 times a second: chase it with an exponential ease (the factor is frame-rate independent) so the glow is smooth
  level += (Math.min(1, bleep.probe("level")) - level) * (1 - Math.exp(-dt * 10));
  t += dt;
  const g = c.g, p = PLOT(), mode = P("mode").value | 0;
  g.clearRect(0, 0, c.width, c.height); g.save(); g.translate(OX(), 0);
  g.font = "11px sans-serif"; g.textBaseline = "middle";
  // mode pills
  for (let i = 0; i < 3; i++) { g.globalAlpha = i === mode ? 1 : 0.45; g.fillStyle = i === mode ? T.accent : T.panel; g.beginPath(); g.roundRect(8 + i * 98, 5, 92, 18, 9); g.fill(); g.fillStyle = i === mode ? T.bg : T.text; g.textAlign = "center"; g.fillText(MODES[i], 54 + i * 98, 14); }
  g.globalAlpha = 1;
  // grid: decades and 6 dB steps
  g.lineWidth = 1; g.strokeStyle = T.line; g.fillStyle = T.muted; g.textAlign = "right";
  for (let d = -12; d <= 12; d += 6) { g.globalAlpha = d === 0 ? 0.9 : 0.4; g.beginPath(); g.moveTo(p.x, dy(d)); g.lineTo(p.x + p.w, dy(d)); g.stroke(); g.globalAlpha = 1; g.fillText(String(d), p.x - 4, dy(d)); }
  g.textAlign = "center";
  for (const f of [100, 1000, 10000]) { g.globalAlpha = 0.4; g.beginPath(); g.moveTo(fx(f), p.y); g.lineTo(fx(f), p.y + p.h); g.stroke(); g.globalAlpha = 1; g.fillText(f >= 1000 ? f / 1000 + "k" : String(f), fx(f), p.y + p.h + 9); }
  // the curves: ghost boost and ghost attenuation, then their sum
  const line = (a, col, w, alpha) => { g.strokeStyle = col; g.lineWidth = w; g.globalAlpha = alpha; g.beginPath(); for (let i = 0; i < N; i++) { const x = fx(freqs[i]), y = dy(a[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); g.globalAlpha = 1; };
  if (mode === 0) { line(boost, T.accent, 2, 0.4); line(cut, T.warn, 2, 0.4); }
  line(total, T.text, 2.5 + level * 2, 1);
  // a dot sweeps along the curve: idle animation that also shows the curve's height under it
  const si = Math.floor((0.5 + 0.5 * Math.sin(t * 0.8)) * (N - 1)), sx = fx(freqs[si]), sy = dy(total[si]);
  g.fillStyle = T.accent; g.globalAlpha = 0.25 + 0.5 * level; g.beginPath(); g.arc(sx, sy, 5 + 10 * level, 0, 7); g.fill(); g.globalAlpha = 1; g.beginPath(); g.arc(sx, sy, 3, 0, 7); g.fill();
  // handles
  for (const h of handles()) {
    const on = (drag && drag.handle === h) || (hover && hover.handle && hover.handle.id === h.id);
    g.fillStyle = h.col; g.strokeStyle = T.text; g.lineWidth = on ? 2 : 1;
    g.beginPath(); if (h.diamond) { g.moveTo(h.x, h.y - 8); g.lineTo(h.x + 8, h.y); g.lineTo(h.x, h.y + 8); g.lineTo(h.x - 8, h.y); g.closePath(); } else g.arc(h.x, h.y, on ? 8 : 6, 0, 7);
    g.fill(); g.stroke();
    if (on) { g.fillStyle = T.text; g.textAlign = "center"; g.fillText(P(h.id).value.toFixed(1) + (h.id === "tilt" ? " dB" : ""), h.x, h.y - 16); }
  }
  // bottom strip: dials in Tone Stack mode, a hint otherwise, and an output level bar
  g.textAlign = "center";
  if (mode === 2) for (const d of dials()) {
    const prm = P(d.id), a = (-135 + 270 * prm.normalised) * Math.PI / 180;
    g.strokeStyle = T.line; g.lineWidth = 4; g.beginPath(); g.arc(d.x, d.y, d.r, 0.75 * Math.PI, 2.25 * Math.PI); g.stroke();
    g.strokeStyle = T.accent; g.beginPath(); g.arc(d.x, d.y, d.r, 0.75 * Math.PI, 0.75 * Math.PI + 1.5 * Math.PI * prm.normalised + 1e-4); g.stroke();
    g.strokeStyle = T.text; g.lineWidth = 2; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x + Math.sin(a) * (d.r - 4), d.y - Math.cos(a) * (d.r - 4)); g.stroke();
    g.fillStyle = T.muted; g.fillText(d.name + " " + prm.value.toFixed(1), d.x, d.y + d.r + 10);
  } else { g.fillStyle = T.muted; g.fillText(mode === 0 ? "drag the handles: amount up/down, frequency left/right" : "drag the diamond: tilt up/down, pivot left/right", SW() / 2 - 40, 222); }
  g.fillStyle = T.line; g.beginPath(); g.roundRect(SW() - 20, 192, 10, 62, 4); g.fill();
  g.fillStyle = level > 0.9 ? T.warn : T.accent; const bh = 62 * Math.min(1, level); g.beginPath(); g.roundRect(SW() - 20, 192 + 62 - bh, 10, Math.max(0, bh), 4); g.fill();
  g.restore();
});
