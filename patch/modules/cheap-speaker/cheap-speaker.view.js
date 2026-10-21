// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Cheap Speaker UI: a cartoon speaker whose cone pumps with the sound (it stops at its travel limit on the devices that have one, and rattles when
// it is overdriven), static speckles that follow Noise, and a picture of the frequency response of the chosen device drawn from the same formulas the
// module designs it from.
//   Click a device tile: switch Device.    Drag the two edges of the response (the -3 dB corners): Bandwidth.
// What it teaches: drawing a response curve from analytic filter formulas, hit testing small targets, dragging with a log frequency axis.

const T = bleep.theme;
const c = bleep.canvas(250);
const g = c.g;
const deviceP = bleep.param("device"), bwP = bleep.param("bandwidth"), resP = bleep.param("resonance"), noiseP = bleep.param("noise"), distP = bleep.param("distortion");
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x) => (Number.isFinite(x) ? x : 0);
const ease = (cur, target, dt, k) => cur + (target - cur) * (1 - Math.exp(-dt * k));

// The devices, as the module designs them: low corner, high corner, then two peaks as [frequency, Q, dB at Resonance 50 %].
const DEVICES = [
  { tag: "TEL", hp: 300, lp: 3400, p: [[1200, 1.4, 6], [2400, 2, 2.5]], exc: false },
  { tag: "AM", hp: 120, lp: 4500, p: [[1800, 1, 2.5], [300, 1.2, 2.5]], exc: false },
  { tag: "CAR", hp: 80, lp: 7500, p: [[300, 1.6, 4], [5500, 3, 4]], exc: true },
  { tag: "TAPE", hp: 50, lp: 9000, p: [[100, 0.8, 2.5], [6500, 0.9, -3]], exc: false },
  { tag: "TINY", hp: 300, lp: 9500, p: [[2200, 5, 9], [900, 1, 3]], exc: true },
  { tag: "HORN", hp: 500, lp: 4000, p: [[1500, 2.5, 8], [2700, 3, 4]], exc: false },
];

// @curve begin
// The response in dB at `f` Hz: a fourth-order Butterworth high-pass and low-pass (the corner is the -3 dB point) and two peaking bells. A bell of
// height G dB at f0 with quality Q is (s^2 + s A/Q + 1) / (s^2 + s /(A Q) + 1) with s = j f / f0 and A = 10^(G/40): the analog prototype of the
// module's peaking filter. `bw` scales the corners, `res` (0..1) scales the peak heights (0.5 is as designed).
function responseDb(d, bw, res, f) {
  const hp = d.hp / bw, lp = d.lp * bw;
  let db = -10 * Math.log10(1 + Math.pow(hp / f, 8)) - 10 * Math.log10(1 + Math.pow(f / lp, 8));
  for (const [f0, q, gdb] of d.p) {
    const A = Math.pow(10, (gdb * res * 2) / 40), x = f / f0;
    const n = Math.hypot(1 - x * x, (x * A) / q), m = Math.hypot(1 - x * x, x / (A * q));
    db += 20 * Math.log10(n / m);
  }
  return db;
}
// @curve end

const s = { cone: 0, level: 0, t: 0, hover: -1 };
// Layout: the cone on the left, the response on the right, device tiles along the bottom.
// The picture lives on a stage at most 640 px wide, at the left edge in line with the knobs below, (the whole canvas when it is narrower); we translate by `off` to draw and subtract it from pointer x.
const stageW = () => Math.min(c.width, 640), off = () => 0;
const L = () => { const w = stageW(), h = c.height; const R = Math.max(12, Math.min(h * 0.28, w * 0.16)); return { w, h, R, cx: w * 0.2, cy: h * 0.38, gx: w * 0.4, gy: 14, gw: w * 0.57, gh: h - 90, ty: h - 52 }; };
const FMIN = 20, FMAX = 20000;
const fx = (f, A) => A.gx + (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * A.gw;      // frequency -> x on a log axis
const xf = (x, A) => FMIN * Math.pow(FMAX / FMIN, clamp((x - A.gx) / A.gw, 0, 1));    // x -> frequency
const gy = (db, A) => A.gy + A.gh * (1 - clamp((db + 40) / 52, 0, 1));                // -40..+12 dB -> y

bleep.onFrame((dt) => {
  dt = Math.min(dt, 0.1); s.t += dt;
  const di = clamp(Math.round(deviceP.value), 0, DEVICES.length - 1), d = DEVICES[di];
  // read + ease. The `excursion` probe is how far the cone is pushed towards its limit (0..1); the level drives the idle breathing.
  const ex = clamp(num(bleep.probe("excursion")), 0, 1);
  s.cone = ease(s.cone, ex, dt, ex > s.cone ? 40 : 10);
  s.level = ease(s.level, clamp(num(bleep.probe("level")), 0, 1), dt, 10);
  const A = L();
  g.clearRect(0, 0, c.width, c.height);
  g.save(); g.translate(off(), 0);
  g.fillStyle = T.panel; g.fillRect(0, 0, A.w, A.h);

  // 1. the cone: basket, surround, cone and dust cap. The cap moves out with the excursion; an overdriven cone on the devices with a limit jitters.
  const idle = 0.04 * Math.sin(s.t * 3);                                 // it breathes a little even in silence
  const rattle = d.exc && s.cone > 0.8 ? (Math.random() - 0.5) * 3 * (s.cone - 0.8) * 5 : 0;
  const push = clamp(s.cone, 0, 1) + idle;
  const R = A.R;
  g.strokeStyle = T.muted; g.lineWidth = 3; g.beginPath(); g.arc(A.cx, A.cy, R, 0, TAU); g.stroke();
  g.fillStyle = T.bg; g.beginPath(); g.arc(A.cx, A.cy, R * 0.92, 0, TAU); g.fill();
  g.strokeStyle = T.line; g.lineWidth = 2; g.beginPath(); g.arc(A.cx, A.cy, R * (0.8 + 0.06 * push), 0, TAU); g.stroke();
  g.fillStyle = T.accent; g.globalAlpha = 0.5 + 0.4 * s.cone; g.beginPath(); g.arc(A.cx + rattle, A.cy, Math.max(0, R * (0.55 + 0.18 * push)), 0, TAU); g.fill();
  g.globalAlpha = 1; g.fillStyle = T.text; g.beginPath(); g.arc(A.cx + rattle, A.cy, Math.max(0, R * (0.18 + 0.08 * push)), 0, TAU); g.fill();
  // static speckles around the speaker follow Noise
  g.fillStyle = T.text; g.globalAlpha = 0.5;
  for (let i = Math.round(noiseP.normalised * 40); i > 0; i--) g.fillRect(A.cx - R * 1.3 + Math.random() * R * 2.6, A.cy - R * 1.3 + Math.random() * R * 2.6, 1.5, 1.5);
  g.globalAlpha = 1;

  // 2. the response curve over a faint grid, with the two corner handles
  g.strokeStyle = T.line; g.lineWidth = 1;
  for (const f of [100, 1000, 10000]) { g.beginPath(); g.moveTo(fx(f, A), A.gy); g.lineTo(fx(f, A), A.gy + A.gh); g.stroke(); }
  g.fillStyle = T.muted; g.font = "10px sans-serif"; g.textAlign = "center";
  for (const [f, t] of [[100, "100"], [1000, "1k"], [10000, "10k"]]) g.fillText(t, fx(f, A), A.gy + A.gh + 12);
  const bw = bwP.value / 100, res = resP.value / 100;
  g.beginPath();
  for (let i = 0; i <= 120; i++) { const f = FMIN * Math.pow(FMAX / FMIN, i / 120), y = gy(responseDb(d, bw, res, f), A); if (i === 0) g.moveTo(fx(f, A), y); else g.lineTo(fx(f, A), y); }
  g.strokeStyle = T.accent; g.lineWidth = 2.5; g.stroke();
  g.lineTo(A.gx + A.gw, A.gy + A.gh); g.lineTo(A.gx, A.gy + A.gh); g.closePath(); g.fillStyle = T.accent; g.globalAlpha = 0.15; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = T.text; g.lineWidth = 2;
  for (const f of [d.hp / bw, d.lp * bw]) { const x = fx(clamp(f, FMIN, FMAX), A); g.beginPath(); g.moveTo(x, A.gy); g.lineTo(x, A.gy + A.gh); g.stroke(); g.fillStyle = T.text; g.beginPath(); g.arc(x, A.gy + 8, 5, 0, TAU); g.fill(); }
  g.fillStyle = T.muted; g.textAlign = "left"; g.fillText(`${Math.round(d.hp / bw)} Hz - ${(d.lp * bw / 1000).toFixed(1)} kHz`, A.gx + 4, A.gy + A.gh - 6);

  // 3. the device tiles
  const tw = (A.w - 16) / DEVICES.length;
  DEVICES.forEach((dv, i) => {
    const x = 8 + i * tw + 3, w = tw - 6, on = i === di;
    g.fillStyle = on ? T.accent : T.bg; g.globalAlpha = on ? 1 : 0.9; g.fillRect(x, A.ty, w, 36); g.globalAlpha = 1;
    g.fillStyle = on ? T.bg : T.text; g.font = "bold 11px sans-serif"; g.textAlign = "center"; g.fillText(dv.tag, x + w / 2, A.ty + 22);
  });
  g.restore();
});

// 4. pointer: tiles switch the device, the two corner lines (grab within 10 px) set Bandwidth. Dragging the low corner to f means bandwidth = hp / f.
let grab = 0;                                       // 0 none, 1 low corner, 2 high corner
const pos = (e) => { const r = c.el.getBoundingClientRect(); return { x: ((e.clientX - r.left) / (r.width || 1)) * c.width - off(), y: ((e.clientY - r.top) / (r.height || 1)) * c.height }; };
const drag = (p) => {
  const d = DEVICES[clamp(Math.round(deviceP.value), 0, DEVICES.length - 1)], f = xf(p.x, L());
  bwP.set(Math.round(grab === 1 ? d.hp / f * 100 : f / d.lp * 100));   // the knob is in percent; set() clamps to its range
};
c.el.addEventListener("pointerdown", (e) => {
  const p = pos(e), A = L(), d = DEVICES[clamp(Math.round(deviceP.value), 0, DEVICES.length - 1)], bw = bwP.value / 100;
  if (p.y >= A.ty) { const i = Math.floor((p.x - 8) / ((A.w - 16) / DEVICES.length)); if (i >= 0 && i < DEVICES.length) deviceP.set(i); return; }
  const dl = Math.abs(p.x - fx(clamp(d.hp / bw, FMIN, FMAX), A)), dh = Math.abs(p.x - fx(clamp(d.lp * bw, FMIN, FMAX), A));
  if (Math.min(dl, dh) > 14 || p.x < A.gx - 10) return;
  grab = dl <= dh ? 1 : 2; c.el.setPointerCapture(e.pointerId); drag(p);
});
c.el.addEventListener("pointermove", (e) => { if (grab) drag(pos(e)); });
c.el.addEventListener("pointerup", () => { grab = 0; });
