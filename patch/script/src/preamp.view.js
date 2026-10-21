// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Preamp UI: the iron core. The loop is the B-H curve of the transformer (flux against magnetising force). A dot rides around it with the signal
// level; the core warms from amber to red as it saturates (the `core` probe). DRAG the loop: left/right = Iron (the loop gets wider and its
// knees lower), up/down = Drive (the dot swings further out).

// 1. set up: one canvas (bleep.canvas already accounts for the screen's pixel ratio, so we draw in CSS pixels)
const c = bleep.canvas(230);
const iron = bleep.param("iron"), drive = bleep.param("drive");
const T = bleep.theme;

// 2. state that we ease towards the polled values. Probes arrive only 10-30 times a second, so do not draw them raw.
let core = 0, level = 0, phase = 0, heat = 0, drag = false, hover = false, wobble = 0;
const ease = (cur, target, dt, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));   // exponential smoothing, frame-rate independent

// plot rectangle inside the canvas (recomputed per frame: the width can change)
const area = () => ({ x: 14, y: 14, w: Math.max(40, c.width - 28), h: c.height - 28 });

// 3. the loop. Upward branch (dir = +1) is shifted right of the downward one by the hysteresis width.
function bh(h, dir, wid, slope) { return Math.tanh(slope * (h - dir * wid)); }

// 4. pointer: x -> Iron, y -> Drive. setNormalised takes 0..1 whatever the knob's own units are.
function point(e) {
  const r = c.el.getBoundingClientRect(), a = area();
  const x = (e.clientX - r.left) * (c.width / Math.max(1, r.width)), y = (e.clientY - r.top) * (c.height / Math.max(1, r.height));
  iron.setNormalised((x - a.x) / a.w);
  drive.setNormalised(1 - (y - a.y) / a.h);
}
c.el.addEventListener("pointerdown", (e) => { drag = true; c.el.setPointerCapture(e.pointerId); point(e); });
c.el.addEventListener("pointermove", (e) => { hover = true; if (drag) point(e); });
c.el.addEventListener("pointerup", (e) => { drag = false; c.el.releasePointerCapture(e.pointerId); });

bleep.onFrame((dt) => {
  // read the module, then ease
  core = ease(core, Math.min(1.5, bleep.probe("core")), dt, 8);
  level = ease(level, Math.min(1, bleep.probe("level")), dt, 10);
  const i = iron.normalised, d = drive.normalised;
  // idle breathing so the picture is alive when the audio is silent
  wobble += dt;
  const amp = Math.min(1, 0.18 + 0.1 * Math.sin(wobble * 1.3) + level * (0.6 + d * 1.6));
  phase += dt * (1.5 + 3 * amp);
  heat = ease(heat, Math.min(1, core), dt, 4);

  const g = c.g, a = area(), cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = T.panel; g.beginPath(); g.roundRect ? g.roundRect(0, 0, c.width, c.height, 12) : g.rect(0, 0, c.width, c.height); g.fill();
  // axes
  g.strokeStyle = T.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(a.x, cy); g.lineTo(a.x + a.w, cy); g.moveTo(cx, a.y); g.lineTo(cx, a.y + a.h); g.stroke();

  // the loop, as a closed path: out along the upper branch, back along the lower one
  const wid = 0.04 + 0.5 * i, slope = 3.2 - 1.6 * i, sx = a.w / 2 - 6, sy = a.h / 2 - 6;
  const N = 48;
  g.beginPath();
  for (let k = 0; k <= N; k++) { const h = -1 + (2 * k) / N; const px = cx + h * sx, py = cy - bh(h, 1, wid, slope) * sy; k ? g.lineTo(px, py) : g.moveTo(px, py); }
  for (let k = N; k >= 0; k--) { const h = -1 + (2 * k) / N; g.lineTo(cx + h * sx, cy - bh(h, -1, wid, slope) * sy); }
  g.closePath();
  g.fillStyle = T.accent; g.globalAlpha = 0.12 + 0.2 * heat; g.fill();           // tint by mixing alpha layers
  g.fillStyle = T.warn; g.globalAlpha = 0.5 * heat; g.fill();                       // the hot colour fades in with the core probe
  g.globalAlpha = 1; g.strokeStyle = heat > 0.5 ? T.warn : T.accent; g.lineWidth = 2 + 2 * (drag || hover ? 0.5 : 0); g.stroke();

  // the dot: current drive h(t) = amp * sin(phase), on the branch that matches the direction of travel
  const h = amp * Math.sin(phase), dir = Math.cos(phase) >= 0 ? 1 : -1;
  const dx = cx + h * sx, dy = cy - bh(h, dir, wid, slope) * sy;
  const glow = g.createRadialGradient(dx, dy, 0, dx, dy, 18);
  glow.addColorStop(0, T.text); glow.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = 0.35 + 0.4 * amp; g.fillStyle = glow; g.beginPath(); g.arc(dx, dy, 18, 0, 6.2832); g.fill();
  g.globalAlpha = 1; g.fillStyle = T.text; g.beginPath(); g.arc(dx, dy, 4 + 2 * amp, 0, 6.2832); g.fill();

  // drag handle at the loop's upper right knee, and the readouts
  const hx = a.x + i * a.w, hy = a.y + (1 - d) * a.h;
  g.strokeStyle = T.muted; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(hx, a.y); g.lineTo(hx, a.y + a.h); g.moveTo(a.x, hy); g.lineTo(a.x + a.w, hy); g.stroke(); g.setLineDash([]);
  g.fillStyle = drag ? T.text : T.accent; g.beginPath(); g.arc(hx, hy, drag ? 8 : 6, 0, 6.2832); g.fill();
  g.fillStyle = T.muted; g.font = "11px sans-serif"; g.textBaseline = "top";
  g.fillText("Iron " + Math.round(iron.value) + " %", a.x + 4, a.y + 2);
  g.fillText("Drive " + Math.round(drive.value) + " %", a.x + 4, a.y + 16);
});
