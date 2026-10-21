// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Tape Machine UI: two reels turn at the tape speed (7.5, 15 or 30 ips) and the tape pack moves from the left reel to the right one. The tape
// sags and the reels speed up and slow down with the wow and flutter the module is making right now. The head glows warm as the tape saturates, a
// VU needle follows the output, hiss sparkles when Hiss is up and the whole machine flashes when a dropout happens.
//   Click a reel:           next tape speed.      Drag anywhere else, up and down: Input Level (the drive into the tape).
// What it teaches: reading probes, easing a 10-30 Hz probe into a 60 fps picture, a pointer handler, hit testing and drawing with paths.

const T = bleep.theme;
const c = bleep.canvas(230);            // as wide as the node, 230 high; the board makes it sharp on high-density screens
const g = c.g;
const speedP = bleep.param("speed"), driveP = bleep.param("drive"), hissP = bleep.param("hiss");
const IPS = [7.5, 15, 30];

// 1. the state we animate. Probes arrive a few times a second, so we never draw them raw: each value glides towards its probe.
const s = { level: 0, sat: 0, drop: 0, wob: 0, angle: 0, pack: 0, t: 0 };
// exponential easing: moves `cur` the fraction 1 - e^(-k dt) of the way to `target`. Frame-rate independent, never overshoots.
const ease = (cur, target, dt, k) => cur + (target - cur) * (1 - Math.exp(-dt * k));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x) => (Number.isFinite(x) ? x : 0);

// Where things are. Everything is derived from the canvas size so a narrow node still looks right.
function layout() {
  const w = c.width, h = c.height;
  const R = Math.max(10, Math.min(h * 0.34, w * 0.2));
  return { w, h, R, cy: h * 0.46, xl: w * 0.24, xr: w * 0.76, cx: w * 0.5 };
}

// A rounded rectangle as a path (older canvases have no roundRect).
function rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function reel(x, y, packR, R, angle) {
  g.fillStyle = T.muted; g.globalAlpha = 0.45;                  // the wound tape
  g.beginPath(); g.arc(x, y, Math.max(0, packR), 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1; g.strokeStyle = T.text; g.lineWidth = 2;   // the flange
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = T.accent; g.lineWidth = 3;                    // three spokes turn with `angle`
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * Math.PI * 2) / 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * R * 0.38, y + Math.sin(a) * R * 0.38); g.stroke();
  }
  g.fillStyle = T.bg; g.beginPath(); g.arc(x, y, R * 0.12, 0, Math.PI * 2); g.fill();
}

bleep.onFrame((dt) => {
  dt = Math.min(dt, 0.1);                                       // a stalled tab must not make a huge jump
  s.t += dt;
  // 2. read the module and ease towards it. Fast attack, slow release makes a believable VU needle.
  const level = clamp(num(bleep.probe("level")), 0, 1.5);
  s.level = ease(s.level, level, dt, level > s.level ? 30 : 5);
  s.sat = ease(s.sat, clamp(num(bleep.probe("saturation")), 0, 1), dt, 8);
  s.drop = ease(s.drop, clamp(num(bleep.probe("dropout")), 0, 1), dt, 25);
  s.wob = ease(s.wob, clamp(num(bleep.probe("wobble")), -40, 40), dt, 20);   // cents of pitch deviation
  const ips = IPS[Math.round(speedP.value)] || 15;
  // the reels never stand still (idle animation); wow and flutter push the speed up and down
  s.angle += dt * ips * 0.45 * (1 + 0.05 * s.wob);
  s.pack += dt * ips * 0.003;
  const f = 0.5 + 0.5 * Math.sin(s.pack);                       // how much tape is on the left reel, 0..1

  // 3. draw
  const L = layout();
  g.clearRect(0, 0, L.w, L.h);
  g.fillStyle = T.panel; rrect(0, 0, L.w, L.h, 14); g.fill();
  const rl = L.R * (0.42 + 0.5 * f), rr = L.R * (0.42 + 0.5 * (1 - f));
  reel(L.xl, L.cy, rl, L.R, s.angle);
  reel(L.xr, L.cy, rr, L.R, s.angle);
  // the tape path: down from the left pack, past the head, up to the right pack. Wow and flutter make it sag.
  const hy = L.cy + L.R * 0.95, sag = s.wob * 0.8;
  g.strokeStyle = T.text; g.lineWidth = 2; g.globalAlpha = 0.8;
  g.beginPath(); g.moveTo(L.xl, L.cy + rl); g.quadraticCurveTo(L.xl + (L.cx - L.xl) * 0.5, hy + sag, L.cx - 14, hy);
  g.lineTo(L.cx + 14, hy); g.quadraticCurveTo(L.xr - (L.xr - L.cx) * 0.5, hy - sag, L.xr, L.cy + rr); g.stroke();
  g.globalAlpha = 1;
  // the head glows warm as the tape saturates
  g.fillStyle = T.warn;
  for (let i = 3; i >= 1; i--) { g.globalAlpha = s.sat * 0.18; g.beginPath(); g.arc(L.cx, hy, 8 + i * 7, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1; g.fillStyle = T.text; rrect(L.cx - 14, hy - 6, 28, 12, 3); g.fill();
  // VU meter: a dial, a red zone and a needle
  const px = L.cx, py = L.cy + L.R * 0.2, vr = Math.max(8, L.R * 0.8);
  g.lineWidth = 3; g.strokeStyle = T.muted; g.beginPath(); g.arc(px, py, vr, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  g.strokeStyle = T.warn; g.beginPath(); g.arc(px, py, vr, Math.PI * 1.65, Math.PI * 1.83); g.stroke();
  const na = Math.PI * 1.17 + Math.PI * 0.66 * clamp(s.level * 1.3, 0, 1) + Math.sin(s.t * 40) * 0.004 * s.wob;
  g.strokeStyle = T.text; g.lineWidth = 2; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * vr * 0.95, py + Math.sin(na) * vr * 0.95); g.stroke();
  // hiss: sparkles that follow the Hiss knob (Math.random is fine in a UI; it is not real-time audio code)
  g.fillStyle = T.text; g.globalAlpha = 0.5;
  for (let i = Math.round(hissP.normalised * 24); i > 0; i--) g.fillRect(Math.random() * L.w, hy - 10 + Math.random() * 24, 1.5, 1.5);
  // a dropout flashes the whole machine
  g.globalAlpha = s.drop * 0.4; g.fillStyle = T.warn; rrect(0, 0, L.w, L.h, 14); g.fill();
  g.globalAlpha = 1; g.fillStyle = T.muted; g.font = "11px sans-serif"; g.textAlign = "left";
  g.fillText(`${ips} ips  ·  drive ${driveP.value.toFixed(1)} dB`, 10, L.h - 10);
});

// 4. pointer: click a reel to change speed, drag elsewhere for Input Level.
let dragging = false;
const pos = (e) => { const r = c.el.getBoundingClientRect(); return { x: ((e.clientX - r.left) / (r.width || 1)) * c.width, y: ((e.clientY - r.top) / (r.height || 1)) * c.height }; };
c.el.addEventListener("pointerdown", (e) => {
  const p = pos(e), L = layout();
  // hit test: inside either reel's circle?
  if (Math.hypot(p.x - L.xl, p.y - L.cy) < L.R || Math.hypot(p.x - L.xr, p.y - L.cy) < L.R) {
    speedP.set((Math.round(speedP.value) + 1) % IPS.length);
    return;
  }
  dragging = true; c.el.setPointerCapture(e.pointerId);
  driveP.setNormalised(1 - p.y / c.height);
});
c.el.addEventListener("pointermove", (e) => { if (dragging) driveP.setNormalised(1 - pos(e).y / c.height); });
c.el.addEventListener("pointerup", () => { dragging = false; });
