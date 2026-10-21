// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Valve Stage UI: one to three glowing tubes (as many as the Stages knob). The plate glows with the supply voltage and dims in a brownout when the
// supply sags; blue-white sparks jump at the grid when it conducts (the `grid` probe); with a starved plate the tubes sputter orange sparks.
// CLICK a tube to cycle the tube type (12AX7, 12AU7, EL34). DRAG a tube up or down to set Gain.

const c = bleep.canvas(220);
const T = bleep.theme;
const tube = bleep.param("tube"), stages = bleep.param("stages"), gain = bleep.param("gain"), plate = bleep.param("plate");

// 0. The stage: the canvas can be as wide as the node, so draw on a stage of at most 640 px at the left edge (in line with the knobs below) (narrower canvases just get a narrower stage).
const stageW = () => Math.min(640, c.width), stageX = () => 0;

// 1. smoothed copies of the polled probes
let supply = 1, grid = 0, level = 0, clock = 0;
const ease = (cur, target, dt, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

// 2. a fixed pool of particles: allocate once, reuse forever (no garbage per frame)
const sparks = Array.from({ length: 48 }, () => ({ life: 0, x: 0, y: 0, vx: 0, vy: 0, hot: 0 }));
let nextSpark = 0;
const spawn = (x, y, hot) => {
  const s = sparks[nextSpark]; nextSpark = (nextSpark + 1) % sparks.length;
  const a = Math.random() * 6.2832, v = 20 + Math.random() * 60;
  s.life = 1; s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v - 20; s.hot = hot;
};

// 3. layout: n tubes side by side; tubeAt(x) is the hit test
const slots = () => { const n = Math.round(stages.value), w = stageW() / n; return { n, w }; };
const tubeAt = (x) => { const s = slots(); return x >= 0 && x <= stageW() ? Math.min(s.n - 1, Math.floor(x / s.w)) : -1; };

// 4. pointer: a press that barely moves is a click (cycle the tube), otherwise vertical movement is Gain
let down = null;
const pos = (e) => { const r = c.el.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / Math.max(1, r.width) - stageX(), y: (e.clientY - r.top) * c.height / Math.max(1, r.height) }; };
c.el.addEventListener("pointerdown", (e) => { const p = pos(e); if (tubeAt(p.x) >= 0) { down = { x: p.x, y: p.y, g: gain.normalised, moved: false }; c.el.setPointerCapture(e.pointerId); } });
c.el.addEventListener("pointermove", (e) => {
  if (!down) return;
  const p = pos(e);
  if (Math.abs(p.y - down.y) + Math.abs(p.x - down.x) > 5) down.moved = true;
  if (down.moved) gain.setNormalised(down.g + (down.y - p.y) / 150);
});
c.el.addEventListener("pointerup", (e) => {
  if (down && !down.moved) tube.set((tube.value + 1) % tube.choices.length);         // a choice param is set by its index
  down = null; c.el.releasePointerCapture(e.pointerId);
});

bleep.onFrame((dt) => {
  clock += dt;
  supply = ease(supply, Math.min(1, Math.max(0, bleep.probe("supply"))), dt, 6);
  grid = ease(grid, Math.min(1, Math.max(0, bleep.probe("grid"))), dt, 12);
  level = ease(level, Math.min(1, Math.max(0, bleep.probe("level"))), dt, 10);
  const g = c.g, s = slots(), starve = 1 - plate.normalised;
  g.clearRect(0, 0, c.width, c.height);
  g.save(); g.translate(stageX(), 0);
  g.fillStyle = T.panel; g.fillRect(0, 0, stageW(), c.height);
  const heat = Math.min(1, 0.25 + 0.75 * plate.normalised) * (0.4 + 0.6 * supply);          // brownout: sag dims the plates
  const th = c.height - 60, tw = Math.max(24, Math.min(70, s.w * 0.45));
  for (let k = 0; k < s.n; k++) {
    const cx = s.w * (k + 0.5), top = 24, flick = 0.9 + 0.1 * Math.sin(clock * (7 + k) + k);
    // glass
    g.fillStyle = T.bg; g.strokeStyle = T.line; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - tw / 2, top + th); g.lineTo(cx - tw / 2, top + tw / 2); g.arc(cx, top + tw / 2, tw / 2, Math.PI, 0); g.lineTo(cx + tw / 2, top + th); g.closePath(); g.fill(); g.stroke();
    // plate glow (the filament and plate heat up with the supply)
    const gl = g.createRadialGradient(cx, top + th * 0.5, 2, cx, top + th * 0.5, tw);
    gl.addColorStop(0, T.accent); gl.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = Math.min(1, heat * flick * (0.5 + 0.5 * level + 0.3)); g.fillStyle = gl; g.fillRect(cx - tw, top, tw * 2, th);
    g.globalAlpha = 1; g.strokeStyle = T.muted; g.lineWidth = 3;                                      // the plate and grid wires
    g.beginPath(); g.moveTo(cx - tw * 0.2, top + 14); g.lineTo(cx - tw * 0.2, top + th - 10); g.moveTo(cx + tw * 0.2, top + 14); g.lineTo(cx + tw * 0.2, top + th - 10); g.stroke();
    g.fillStyle = T.muted; g.font = "11px sans-serif"; g.textAlign = "center";
    g.fillText(tube.choices ? tube.choices[Math.round(tube.value)] : "", cx, top + th + 18);
    // sparks: grid current gives blue-white ones at the grid wire, a starved plate gives orange sputtering
    if (Math.random() < dt * (grid * 40)) spawn(cx, top + th * 0.5, 0);
    if (Math.random() < dt * (starve * starve * 25 * (0.3 + level))) spawn(cx + (Math.random() - 0.5) * tw, top + th * 0.7, 1);
  }
  g.textAlign = "left"; g.fillText("Gain " + Math.round(gain.value) + " %   Plate " + Math.round(plate.value) + " %   Supply " + Math.round(supply * 100) + " %", 10, 14);
  for (const p of sparks) {                                                                           // update + draw the pool
    if (p.life <= 0) continue;
    p.life -= dt * 2.2; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt;
    g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.hot ? T.accent : T.text;
    g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  g.globalAlpha = 1;
  g.restore();
});
