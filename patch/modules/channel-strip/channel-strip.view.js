// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Channel Strip UI: the strip's real frequency response, drawn from the knobs with the same filter formulas the module designs from (high-pass,
// low shelf, two bells, high shelf, with the proportional Q). Four handles sit on the curve. DRAG a handle up/down for its gain; drag it sideways
// and it snaps to the band's switchable frequencies. The bar on the right glows with the drive stage's `saturation` probe.

const c = bleep.canvas(240);
const T = bleep.theme;
const P = (id) => bleep.param(id);
const FS = 48000;                                         // the curve is drawn for 48 kHz; below 20 kHz the difference is invisible
const BANDS = [                                           // [kind, gain param, freq param, the stepped frequencies]
  ["low", "lfGain", "lfFreq", [35, 60, 100, 200]], ["peak", "lmGain", "lmFreq", [250, 500, 1000, 2000]],
  ["peak", "hmGain", "hmFreq", [1500, 3000, 5000, 8000]], ["high", "hfGain", "hfFreq", [5000, 8000, 10000, 12000]],
];
const HP_HZ = [0, 30, 50, 80, 120];

// 0. The stage: the canvas can be as wide as the node, so draw on a stage of at most 640 px at the left edge (in line with the knobs below) (narrower canvases just get a narrower stage).
const stageW = () => Math.min(640, c.width), stageX = () => 0;

// 1. the maths: magnitude in dB of an RBJ biquad at f. The Q grows with the gain (proportional Q): a big boost is narrow.
function band(kind, f0, gdb, f) {
  const k = Math.min(1, Math.abs(gdb) / 15), q = kind === "peak" ? 0.55 + 1.35 * k : 0.55 + 0.45 * k;
  const A = Math.pow(10, gdb / 40), w = 2 * Math.PI * f0 / FS, cs = Math.cos(w), al = Math.sin(w) / (2 * q), r = 2 * Math.sqrt(A) * al;
  let b, a;
  if (kind === "peak") { b = [1 + al * A, -2 * cs, 1 - al * A]; a = [1 + al / A, -2 * cs, 1 - al / A]; }
  else if (kind === "low") { b = [A * (A + 1 - (A - 1) * cs + r), 2 * A * (A - 1 - (A + 1) * cs), A * (A + 1 - (A - 1) * cs - r)]; a = [A + 1 + (A - 1) * cs + r, -2 * (A - 1 + (A + 1) * cs), A + 1 + (A - 1) * cs - r]; }
  else { b = [A * (A + 1 + (A - 1) * cs + r), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - r)]; a = [A + 1 - (A - 1) * cs + r, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - r]; }
  const wf = 2 * Math.PI * f / FS, ev = (p) => { let re = 0, im = 0; for (let n = 0; n < 3; n++) { re += p[n] * Math.cos(wf * n); im -= p[n] * Math.sin(wf * n); } return re * re + im * im; };
  return 10 * Math.log10(ev(b) / ev(a));
}
function responseDb(f) {
  let db = 0;
  const hp = P("hpf").value | 0;
  if (hp > 0) db -= 10 * Math.log10(1 + Math.pow(HP_HZ[hp] / f, P("hpfSlope").value > 0.5 ? 6 : 4));   // Butterworth magnitude
  if (P("eqOn").normalised > 0.5) for (const [kind, gp, fp, tab] of BANDS) { const g = P(gp).value; if (Math.abs(g) > 0.005) db += band(kind, tab[Math.round(P(fp).value)], g, f); }
  return db;
}
bleep.responseDb = responseDb;                            // lets a test compare the picture with the real module

// 2. geometry: log frequency across, +-18 dB up
const LO = Math.log(20), HI = Math.log(20000), DB = 18;
const plot = () => ({ x: 8, y: 10, w: Math.max(60, stageW() - 56), h: c.height - 24 });
const fx = (f) => { const p = plot(); return p.x + (Math.log(f) - LO) / (HI - LO) * p.w; };
const dy = (db) => { const p = plot(); return p.y + p.h / 2 - Math.max(-DB, Math.min(DB, db)) / DB * p.h / 2; };
const handle = (i) => { const [, gp, fp, tab] = BANDS[i]; return { x: fx(tab[Math.round(P(fp).value)]), y: dy(P(gp).value) }; };

// 3. pointer: pick the nearest handle (hit test by distance), then vertical = gain, horizontal = nearest stepped frequency
let held = -1, hot = -1, sat = 0, lvl = 0, t = 0;
const at = (e) => { const r = c.el.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / Math.max(1, r.width) - stageX(), y: (e.clientY - r.top) * c.height / Math.max(1, r.height) }; };
const pick = (m) => { let best = -1, bd = 22 * 22; for (let i = 0; i < 4; i++) { const h = handle(i), d = (h.x - m.x) ** 2 + (h.y - m.y) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
c.el.addEventListener("pointerdown", (e) => { held = pick(at(e)); if (held >= 0) c.el.setPointerCapture(e.pointerId); });
c.el.addEventListener("pointermove", (e) => {
  const m = at(e);
  if (held < 0) { hot = pick(m); return; }
  const [, gp, fp, tab] = BANDS[held], p = plot();
  P(gp).set(Math.round(((p.y + p.h / 2 - m.y) / (p.h / 2) * DB) * 2) / 2);              // half-decibel steps; set() clamps to +-15
  const f = Math.exp(LO + (m.x - p.x) / p.w * (HI - LO));
  let bi = 0; for (let k = 1; k < tab.length; k++) if (Math.abs(Math.log(tab[k] / f)) < Math.abs(Math.log(tab[bi] / f))) bi = k;
  if (bi !== Math.round(P(fp).value)) P(fp).set(bi);                                      // snap to a choice index
});
c.el.addEventListener("pointerup", (e) => { held = -1; c.el.releasePointerCapture(e.pointerId); });

bleep.onFrame((dt) => {
  t += dt;
  sat = sat + (Math.min(1, Math.max(0, bleep.probe("saturation"))) - sat) * (1 - Math.exp(-dt * 8));   // smooth the polled probe
  lvl = lvl + (Math.min(1, Math.max(0, bleep.probe("level"))) - lvl) * (1 - Math.exp(-dt * 10));
  const g = c.g, p = plot();
  g.clearRect(0, 0, c.width, c.height); g.save(); g.translate(stageX(), 0); g.fillStyle = T.panel; g.fillRect(0, 0, stageW(), c.height);
  g.strokeStyle = T.line; g.lineWidth = 1; g.fillStyle = T.muted; g.font = "10px sans-serif";
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { g.beginPath(); g.moveTo(fx(f), p.y); g.lineTo(fx(f), p.y + p.h); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + "k" : "" + f, fx(f) + 2, p.y + p.h + 10); }
  for (const db of [-12, -6, 0, 6, 12]) { g.globalAlpha = db ? 0.5 : 1; g.beginPath(); g.moveTo(p.x, dy(db)); g.lineTo(p.x + p.w, dy(db)); g.stroke(); }
  g.globalAlpha = 1;
  // the curve: 96 points, filled to the 0 dB line
  g.beginPath(); g.moveTo(p.x, dy(0));
  for (let k = 0; k <= 96; k++) { const f = Math.exp(LO + (HI - LO) * k / 96); g.lineTo(fx(f), dy(responseDb(f))); }
  g.lineTo(p.x + p.w, dy(0)); g.closePath(); g.fillStyle = T.accent; g.globalAlpha = 0.18 + 0.2 * sat; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = T.accent; g.lineWidth = 2; g.beginPath();
  for (let k = 0; k <= 96; k++) { const f = Math.exp(LO + (HI - LO) * k / 96); k ? g.lineTo(fx(f), dy(responseDb(f))) : g.moveTo(fx(f), dy(responseDb(f))); }
  g.stroke();
  // handles; an idle pulse keeps the picture alive in silence
  for (let i = 0; i < 4; i++) {
    const h = handle(i), r = 6 + (i === held ? 3 : i === hot ? 2 : 0) + Math.sin(t * 2 + i) * 0.8;
    g.fillStyle = i === held ? T.text : T.accent; g.beginPath(); g.arc(h.x, h.y, Math.max(1, r), 0, 6.2832); g.fill();
    if (i === held || i === hot) { g.fillStyle = T.text; g.fillText(P(BANDS[i][1]).value.toFixed(1) + " dB  " + BANDS[i][3][Math.round(P(BANDS[i][2]).value)] + " Hz", Math.min(stageW() - 100, Math.max(4, h.x - 30)), Math.max(12, h.y - 12)); }
  }
  // saturation meter: glows warm as the drive stage bends the signal; a thin level bar beside it
  const mx = stageW() - 40, mh = p.h;
  g.fillStyle = T.bg; g.fillRect(mx, p.y, 14, mh); g.fillStyle = T.warn; g.globalAlpha = 0.35 + 0.65 * sat; g.fillRect(mx, p.y + mh * (1 - sat), 14, mh * sat); g.globalAlpha = 1;
  g.fillStyle = T.muted; g.fillRect(mx + 18, p.y + mh * (1 - lvl), 4, mh * lvl);
  g.restore();
});
