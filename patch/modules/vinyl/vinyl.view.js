// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Vinyl UI: a record turns at the chosen speed with a tonearm riding the groove. Dust shows as specks, and from 40 % Dust the same scratches the
// module plays are drawn on the disc: each one reaches the needle exactly when you hear it (the module reports where it is on the turn), and the
// needle flashes on every click. The disc wobbles when Warp is up, and the label shows the cartridge.
//   Drag on the disc or the arm: the needle moves in and out, setting Inner Groove.      Click the label: next cartridge.
// What it teaches: syncing a free-running animation to a probe without jumps, mapping pointer geometry to a knob, drawing rotating things.

const T = bleep.theme;
const c = bleep.canvas(240);
const g = c.g;
const speedP = bleep.param("speed"), cartP = bleep.param("cartridge"), innerP = bleep.param("inner"), dustP = bleep.param("dust"), warpP = bleep.param("warp");
const RPM = [100 / 3, 45, 78];
const SCRATCH = [0.137, 0.512, 0.861];          // where the module puts its three scratches on a turn (0..1)
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x) => (Number.isFinite(x) ? x : 0);
const ease = (cur, target, dt, k) => cur + (target - cur) * (1 - Math.exp(-dt * k));

const s = { turn: 0, lastProbe: 0, click: 0, groove: 0, t: 0 };
// The picture lives on a stage at most 640 px wide, at the left edge in line with the knobs below, (the whole canvas when it is narrower); we translate by `off` to draw and subtract it from pointer x.
const stageW = () => Math.min(c.width, 640), off = () => 0;
const L = () => { const w = stageW(), h = c.height; const R = Math.max(12, Math.min(h * 0.42, w * 0.3)); return { w, h, R, cx: w * 0.34, cy: h * 0.5, px: w * 0.86, py: h * 0.14 }; };
// A cheap, repeatable pseudo-random number from an integer (so the dust specks keep their places from frame to frame).
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

bleep.onFrame((dt) => {
  dt = Math.min(dt, 0.1); s.t += dt;
  const rev = RPM[Math.round(speedP.value)] / 60;              // revolutions per second
  // 1. free-run the disc at the right speed (so it never looks frozen) ...
  s.turn = (s.turn + rev * dt) % 1;
  // 2. ... and when the module reports a NEW position, pull our phase gently onto it. The shortest way round (wrapped difference) avoids a jump at 1 -> 0.
  const p = num(bleep.probe("turn"));
  if (Math.abs(p - s.lastProbe) > 1e-6) { let err = p - s.turn; err -= Math.round(err); s.turn = (s.turn + err * (1 - Math.exp(-dt * 6)) + 1) % 1; s.lastProbe = p; }
  s.click = ease(s.click, clamp(num(bleep.probe("click")), 0, 1), dt, bleep.probe("click") > s.click ? 60 : 10);
  s.groove = ease(s.groove, clamp(num(bleep.probe("groove")) / 3, 0, 1), dt, 8);

  const A = L();
  const wob = warpP.normalised * A.R * 0.05;                    // the off-centre disc: the picture wobbles once per turn
  const cx = A.cx + Math.cos(s.turn * TAU) * wob, cy = A.cy + Math.sin(s.turn * TAU) * wob;
  g.clearRect(0, 0, c.width, c.height);
  g.save(); g.translate(off(), 0);
  // the disc, its grooves and the label
  g.fillStyle = T.bg; g.beginPath(); g.arc(cx, cy, A.R, 0, TAU); g.fill();
  g.strokeStyle = T.line; g.lineWidth = 1;
  for (let r = A.R * 0.36; r < A.R; r += Math.max(3, A.R / 22)) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
  g.strokeStyle = T.text; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, A.R, 0, TAU); g.stroke();
  // a point fixed on the disc at phase q is under the needle (screen angle 0, the right side) when turn == q
  const at = (q, r) => { const a = (s.turn - q) * TAU; return [cx + Math.cos(a) * A.R * r, cy + Math.sin(a) * A.R * r]; };
  // dust specks: as many as Dust says, each at a fixed place on the disc
  g.fillStyle = T.text; g.globalAlpha = 0.7;
  for (let i = Math.round(dustP.normalised * 60); i > 0; i--) { const [x, y] = at(hash(i), 0.4 + 0.58 * hash(i + 99)); g.fillRect(x, y, 1.6, 1.6); }
  // scratches: the module has one from 40 % Dust, two from 65 %, three from 85 %
  const count = dustP.normalised >= 0.85 ? 3 : dustP.normalised >= 0.65 ? 2 : dustP.normalised >= 0.4 ? 1 : 0;
  g.strokeStyle = T.warn; g.lineWidth = 1.5; g.globalAlpha = 0.9;
  for (let k = 0; k < count; k++) { const [x1, y1] = at(SCRATCH[k], 0.45), [x2, y2] = at(SCRATCH[k] + 0.01, 0.95); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  g.globalAlpha = 1;
  g.fillStyle = T.accent; g.beginPath(); g.arc(cx, cy, A.R * 0.3, 0, TAU); g.fill();       // the label ...
  g.fillStyle = T.bg; g.font = "11px sans-serif"; g.textAlign = "center";
  g.fillText(cartP.choices ? cartP.choices[Math.round(cartP.value)] : "", cx, cy + 4);       // ... names the cartridge
  g.beginPath(); g.arc(cx, cy, 2, 0, TAU); g.fill();

  // the tonearm: from a pivot to the needle, which sits further in as Inner Groove goes up
  const nr = A.R * (0.94 - 0.58 * innerP.normalised), nx = cx + nr, ny = cy;
  g.strokeStyle = T.text; g.lineWidth = 3; g.beginPath(); g.moveTo(A.px, A.py); g.lineTo(nx, ny); g.stroke();
  g.fillStyle = T.muted; g.beginPath(); g.arc(A.px, A.py, 7, 0, TAU); g.fill();
  // the needle glows with the groove level and flashes on every click
  g.fillStyle = T.warn; g.globalAlpha = clamp(s.click * 1.5 + s.groove * 0.25, 0, 1);
  g.beginPath(); g.arc(nx, ny, 4 + 14 * s.click, 0, TAU); g.fill();
  g.globalAlpha = 1; g.fillStyle = T.text; g.beginPath(); g.arc(nx, ny, 3, 0, TAU); g.fill();
  g.fillStyle = T.muted; g.textAlign = "left";
  g.fillText(`${["33 1/3", "45", "78"][Math.round(speedP.value)]} rpm · inner ${Math.round(innerP.value)} %`, A.px - A.w * 0.25, A.h - 10);
  g.restore();
});

// 3. pointer: the distance from the disc centre is the needle position, which maps straight onto Inner Groove (0 at the rim, 1 near the label).
let dragging = false;
const pos = (e) => { const r = c.el.getBoundingClientRect(); return { x: ((e.clientX - r.left) / (r.width || 1)) * c.width - off(), y: ((e.clientY - r.top) / (r.height || 1)) * c.height }; };
const setInner = (p) => { const A = L(); const d = Math.hypot(p.x - A.cx, p.y - A.cy) / A.R; innerP.setNormalised(clamp((0.94 - d) / 0.58, 0, 1)); };
c.el.addEventListener("pointerdown", (e) => {
  const p = pos(e), A = L();
  if (p.x < 0 || p.x > A.w) return;               // a press outside the stage does nothing
  if (Math.hypot(p.x - A.cx, p.y - A.cy) < A.R * 0.3) { cartP.set((Math.round(cartP.value) + 1) % 3); return; }   // click the label
  dragging = true; c.el.setPointerCapture(e.pointerId); setInner(p);
});
c.el.addEventListener("pointermove", (e) => { if (dragging) setInner(pos(e)); });
c.el.addEventListener("pointerup", () => { dragging = false; });
