// SPDX-License-Identifier: GPL-3.0-only
// Tone EQ's own UI (src/tone-eq.view.js) against the mock sandbox.   node test/modules/tone-eq.view.test.mjs
import { loadModule, gainAt, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("tone-eq"), src = viewSource("tone-eq");
check(!!src && src.startsWith("// SPDX"), "the UI file exists and starts with the licence line");
// a logger in front of the canvas context: every drawing call is recorded as [name, args], so a test can read what was drawn
const LOGGER = `const __open = bleep.canvas; bleep.canvas = (h) => { const c = __open(h); const g = c.g; c.g = new Proxy(g, { get(t, k) { const f = t[k]; return typeof f === "function" ? (...a) => { globalThis.__log.push([k, a]); return f(...a); } : f; }, set(t, k, v) { t[k] = v; return true; } }); return c; };\n`;
const make = (opts = {}) => { globalThis.__log = []; return runView(m.spec, LOGGER + src, opts); };
const probes = { silence: () => ({ level: 0 }), loud: (t) => ({ level: 0.5 + 0.5 * Math.sin(t * 9) }), clip: () => ({ level: 5 }) };

for (const [name, p] of Object.entries(probes)) for (const width of [320, 520, 900]) {
  const v = make({ probes: p, width }); v.frames(300);
  check(v.failures.length === 0 && v.stats.paints >= 300, `runs 300 frames (${name}, ${width} px) and paints every frame`, v.failures.slice(0, 2).join("; "));
}
{ // every param at min and at max, in every mode
  const v = make({ probes: probes.loud, width: 320 });
  for (const mode of [0, 1, 2]) for (const end of [0, 1]) {
    for (const p of m.spec.params) if (p.id !== "mode") v.bleep.param(p.id).setNormalised(end);
    v.bleep.param("mode").set(mode); v.frames(40);
  }
  check(v.failures.length === 0, "all params at min and max in every mode: no failure, no NaN", v.failures.slice(0, 3).join("; "));
}
{ // idle animation, and a frozen state
  const v = make({ probes: probes.silence }); v.frames(10);
  globalThis.__log.length = 0; v.frames(1); const a = JSON.stringify(globalThis.__log); globalThis.__log.length = 0; v.frames(1); const b = JSON.stringify(globalThis.__log);
  check(a !== b && a.length > 100, "two consecutive frames at silence differ (idle animation)");
  v.frames(2000); check(v.failures.length === 0, "a long run stays healthy");
}

// ---- the curve in the picture against the module ----------------------------------------------------------------------------------------------
const drawnCurve = (v) => {   // the last polyline of 160 points: the white sum curve; returns f -> dB
  const log = globalThis.__log; let end = -1;
  for (let i = log.length - 1; i >= 0; i--) if (log[i][0] === "stroke") { let n = 0, j = i - 1; while (j >= 0 && log[j][0] === "lineTo") { n++; j--; } if (n === 159 && log[j][0] === "moveTo") { end = i; break; } }
  if (end < 0) return null;
  const pts = []; for (let j = end - 160; j < end; j++) pts.push(log[j][1]);
  return (f) => { const i = Math.round(159 * Math.log(f / 20) / Math.log(1000)), y = pts[i][1]; return (0.5 - (y - 32) / 150) * 36; };
};
const base = { age: 0, drive: 0, output: 0 };
const cases = [
  ["passive: 60 Hz boost 6, atten 3, 8 kHz boost 5", { mode: 0, lowFreq: 2, lowBoost: 6, lowAtten: 3, hiFreq: 3, hiBoost: 5, bandwidth: 4, attFreq: 1, hiAtten: 2 }, [30, 60, 120, 400, 1000, 3000, 6000, 8000]],
  ["tilt +4, pivot 1 kHz", { mode: 1, tilt: 4, pivot: 3 }, [40, 150, 500, 1000, 2500, 6000, 10000]],
  ["tone stack 3 / 6 / 8", { mode: 2, bass: 3, mid: 6, treble: 8 }, [60, 150, 400, 800, 1600, 3200]],
];
for (const [name, params, fr] of cases) {
  const v = make({ probes: probes.silence });
  for (const [k, val] of Object.entries(params)) v.bleep.param(k).set(val);
  v.frames(2);
  const fn = drawnCurve(v); let worst = 0, at = 0;
  if (fn) for (const f of fr) { const e = Math.abs(fn(f) - gainAt(m, f, { amp: 0.05, params: { ...params, ...base, lowBoost: params.lowBoost ?? 0, lowAtten: params.lowAtten ?? 0, hiBoost: params.hiBoost ?? 0, hiAtten: params.hiAtten ?? 0, tilt: params.tilt ?? 0 }, out: "outL", n: f < 80 ? 131072 : 32768 })); if (e > worst) { worst = e; at = f; } }
  check(!!fn && worst < 1.5, `drawn curve matches the module's measured response: ${name}`, `worst ${worst.toFixed(2)} dB at ${at} Hz`);
}

// ---- dragging -------------------------------------------------------------------------------------------------------------------------------
const W = 520, H = 260, fx = (f) => 34 + (W - 46) * Math.log(f / 20) / Math.log(1000), dy = (d) => 32 + 150 * (0.5 - d / 36);
{
  const v = make({ probes: probes.silence, width: W }); v.frames(2);
  let s = v.drag(fx(60) / W, dy(4.5) / H, fx(60) / W, dy(12) / H);      // the low boost handle (4.5 dB) up to 12 dB: 12 / 1.5 = 8
  check(s.some(([id, val]) => id === "lowBoost") && Math.abs(v.bleep.param("lowBoost").value - 8) < 0.2, "dragging the low boost handle up sets Low Boost", String(v.bleep.param("lowBoost").value));
  s = v.drag(fx(60) / W, dy(12) / H, fx(100) / W, dy(12) / H);
  check(v.bleep.param("lowFreq").value === 3, "dragging it right snaps Low Freq to 100 Hz");
  v.drag(fx(100 * 2.4) / W, dy(-1.8) / H, fx(100 * 2.4) / W, dy(-6) / H);      // the attenuation handle: -6 dB / 1.2 = 5
  check(Math.abs(v.bleep.param("lowAtten").value - 5) < 0.2, "dragging the attenuation handle down sets Low Atten", String(v.bleep.param("lowAtten").value));
  v.drag(fx(8000) / W, dy(3.2) / H, fx(8000) / W, dy(-30) / H);
  check(v.bleep.param("hiBoost").value === 0, "dragging far below clamps at 0", "");
  v.drag((54 + 98) / W, 14 / H);
  check(v.bleep.param("mode").value === 1, "clicking the Tilt pill switches mode");
  v.frames(2); v.drag(fx(650) / W, dy(0) / H, fx(1000) / W, dy(-3) / H);
  check(Math.abs(v.bleep.param("tilt").value + 3) < 0.3 && v.bleep.param("pivot").value === 3, "Tilt mode: the diamond sets Tilt and snaps Pivot", `${v.bleep.param("tilt").value.toFixed(1)}, pivot ${v.bleep.param("pivot").value}`);
  v.drag((54 + 196) / W, 14 / H); v.frames(2);
  v.drag(70 / W, 222 / H, 70 / W, 162 / H);        // the Bass dial: 60 px up = +5
  check(Math.abs(v.bleep.param("bass").value - 10) < 0.01 || Math.abs(v.bleep.param("bass").value - 10) < 0.5, "Tone Stack mode: dragging the Bass dial up turns it up", String(v.bleep.param("bass").value));
  check(v.failures.length === 0, "no failures during all drags", v.failures.join("; "));
  const bad = m.spec.params.filter((p) => { const x = v.bleep.param(p.id).value; return !(x >= p.min && x <= p.max); });
  check(bad.length === 0, "every param stays inside its range");
}
for (const W of [320, 700, 1400]) {
  const SW = Math.min(W, 640), ox = 0, fxs = (f) => ox + 34 + (SW - 46) * Math.log(f / 20) / Math.log(1000), v = make({ probes: probes.silence, width: W }); v.frames(2);
  v.drag(fxs(60) / W, dy(4.5) / H, fxs(60) / W, dy(12) / H);
  check(Math.abs(v.bleep.param("lowBoost").value - 8) < 0.2, `width ${W}: dragging a handle on the centred stage sets Low Boost`, String(v.bleep.param("lowBoost").value));
  v.drag((ox + 54 + 196) / W, 14 / H); v.frames(2);
  check(v.bleep.param("mode").value === 2, `width ${W}: the mode pill is hit`);
  check(v.failures.length === 0, `width ${W}: no failures`, v.failures.join("; "));
}
finish();
