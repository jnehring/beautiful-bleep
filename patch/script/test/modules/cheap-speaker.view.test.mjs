// SPDX-License-Identifier: GPL-3.0-only
// Cheap Speaker UI (src/cheap-speaker.view.js) run against the UI mock: no failures over many frames at several probe states and extreme knobs,
// paints every frame, idles when silent, and dragging the picture sets the intended knobs.   node test/modules/cheap-speaker.view.test.mjs
import { loadModule, render, sine, gainAt, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("cheap-speaker");
const src = viewSource("cheap-speaker");
check(!!src && src.startsWith("// SPDX-License-Identifier"), "the UI file exists and starts with the SPDX line");
const live = render(m, { inputs: { l: sine(440, 0.3, 4800) } }).instance.live().values;
const PROBES = ["level", "excursion"];
check(PROBES.every((p) => p in live), "every probe the UI reads exists in the module", Object.keys(live).join(", "));

/// The drawing calls of one frame as a string, to see that a frame differs from the one before it.
function recorded(source, opts) {
  globalThis.__log = [];
  const wrapped = `const __c = bleep.canvas; bleep.canvas = (h) => { const c = __c(h); const g = c.g; c.g = new Proxy(g, { get(t, k) { const v = t[k]; return typeof v === "function" ? (...a) => { globalThis.__log.push(String(k) + a.map((x) => (typeof x === "number" ? x.toFixed(2) : "")).join(",")); return v(...a); } : v; }, set(t, k, v) { t[k] = v; return true; } }); return c; };\n` + source;
  const v = runView(m.spec, wrapped, opts);
  return v;
}
const silence = () => ({ level: 0, saturation: 0, dropout: 0, wobble: 0, groove: 0, click: 0, turn: 0, excursion: 0 });
const loud = (t) => ({ level: 0.9, saturation: 0.9, dropout: 0.5 + 0.5 * Math.sin(t * 9), wobble: 20 * Math.sin(t * 7), groove: 3, click: 0.5 + 0.5 * Math.sin(t * 20), turn: (t * 0.55) % 1, excursion: 1 });
const sweep = (t) => ({ level: 0.5 + 0.5 * Math.sin(t * 2), saturation: Math.abs(Math.sin(t)), dropout: 0, wobble: 5 * Math.sin(t * 3), groove: 1 + Math.sin(t), click: Math.max(0, Math.sin(t * 13)), turn: (t * 0.75) % 1, excursion: Math.abs(Math.sin(t * 5)) });

for (const [name, probes] of [["silence", silence], ["loud", loud], ["sweep", sweep]]) {
  const v = runView(m.spec, src, { probes }).frames(300);
  check(v.failures.length === 0, `300 frames of ${name}: no failure`, v.failures.slice(0, 3).join("; "));
  check(v.stats.paints >= 300, `300 frames of ${name}: paints every frame`, String(v.stats.paints));
}
for (const width of [320, 900]) {
  const v = runView(m.spec, src, { probes: loud, width }).frames(60);
  check(v.failures.length === 0, `${width} px wide: no failure`, v.failures.slice(0, 3).join("; "));
}
// every knob at its minimum and at its maximum
for (const x of [0, 1]) {
  const v = runView(m.spec, src, { probes: loud, width: 320 });
  for (const p of m.spec.params) v.bleep.param(p.id).setNormalised(x);
  v.frames(120);
  check(v.failures.length === 0, `all knobs at ${x ? "maximum" : "minimum"}: no failure`, v.failures.slice(0, 3).join("; "));
}
// idle animation at silence, and a frozen (never changing) probe state does not break anything
{
  const v = recorded(src, { probes: silence });
  v.frames(5);
  globalThis.__log.length = 0; v.frames(1); const a = globalThis.__log.join("|");
  globalThis.__log.length = 0; v.frames(1); const b = globalThis.__log.join("|");
  check(a.length > 50 && a !== b, "at silence two consecutive frames still differ (idle animation)");
  const frozen = runView(m.spec, src, { probes: () => ({ level: 0.4, saturation: 0.3, turn: 0.25, excursion: 0.2, groove: 0.5 }) }).frames(600);
  check(frozen.failures.length === 0, "a frozen probe state for 600 frames: no failure");
  const odd = runView(m.spec, src, { probes: () => ({ level: NaN, saturation: Infinity, turn: -3, wobble: 1e9, click: -1 }) }).frames(30);
  check(odd.failures.length === 0, "NaN, infinite and out-of-range probes do not reach the canvas as NaN", odd.failures.slice(0, 2).join("; "));
}
const inRange = (sets) => sets.every(([id, val]) => { const p = m.spec.params.find((q) => q.id === id); return val >= p.min - 1e-9 && val <= p.max + 1e-9 && Number.isFinite(val); });

// ---- dragging: tiles pick the device, the corner lines set Bandwidth
{
  const v = runView(m.spec, src, { probes: loud, width: 520 }).frames(10);
  const tile = (i) => (8 + (i + 0.5) * ((520 - 16) / 6)) / 520;
  for (const i of [0, 3, 5]) {
    const s = v.drag(tile(i), 0.9);
    check(s.length === 1 && s[0][0] === "device" && s[0][1] === i, `clicking tile ${i} selects device ${i}`, JSON.stringify(s));
  }
  // Megaphone is selected: corners at 500 Hz and 4 kHz on a log axis from 20 Hz to 20 kHz across x = 0.4 w .. 0.97 w
  const X = (f) => (0.4 + 0.57 * Math.log(f / 20) / Math.log(1000)) ;
  const s = v.drag(X(500), 0.4, X(250), 0.4);
  const bw = s.filter(([id]) => id === "bandwidth").pop();
  check(inRange(s) && bw && Math.abs(bw[1] - 200) < 8, "dragging the low corner from 500 to 250 Hz sets Bandwidth about 200 %", `${bw && bw[1].toFixed(0)} %`);
  v.bleep.param("bandwidth").set(100);
  const s2 = v.drag(X(4000), 0.4, X(6000), 0.4);
  const bw2 = s2.filter(([id]) => id === "bandwidth").pop();
  check(inRange(s2) && bw2 && Math.abs(bw2[1] - 150) < 8, "dragging the high corner from 4 to 6 kHz sets Bandwidth about 150 %", `${bw2 && bw2[1].toFixed(0)} %`);
  check(v.drag(0.3, 0.3).length === 0, "pressing on the cone changes nothing");
}
// ---- the picture's response curve is the module's response: the same formulas, checked against the measured module
{
  const text = src.slice(src.indexOf("// @curve begin"), src.indexOf("// @curve end"));
  const responseDb = new Function(text + "; return responseDb;")();
  const devices = [
    { name: "Telephone", d: { hp: 300, lp: 3400, p: [[1200, 1.4, 6], [2400, 2, 2.5]] }, f: [150, 300, 700, 1200, 2400, 3400, 5000] },
    { name: "Tiny Speaker", d: { hp: 300, lp: 9500, p: [[2200, 5, 9], [900, 1, 3]] }, f: [200, 300, 900, 1500, 2200, 3500, 9500] },
    { name: "Megaphone", d: { hp: 500, lp: 4000, p: [[1500, 2.5, 8], [2700, 3, 4]] }, f: [300, 500, 1000, 1500, 2700, 4000, 6000] },
    { name: "Car Speaker", d: { hp: 80, lp: 7500, p: [[300, 1.6, 4], [5500, 3, 4]] }, f: [60, 80, 300, 1000, 5500, 7500] },
  ];
  const idx = { Telephone: 0, "Tiny Speaker": 4, Megaphone: 5, "Car Speaker": 2 };
  for (const dev of devices) {
    for (const [bw, res] of [[100, 50], [150, 50], [100, 100]]) {
      // the car's cabin reflection ripples the real response; the picture shows the filters, so compare it without Resonance-scaled reflection only at res 50 +-
      const params = { device: idx[dev.name], bandwidth: bw, resonance: res, distortion: 0, noise: 0, wobble: 0 };
      const meas = dev.f.map((f) => gainAt(m, f, { out: "outL", amp: 0.01, params }));
      const ref = Math.sqrt(dev.d.hp * dev.d.lp);
      const mref = gainAt(m, ref, { out: "outL", amp: 0.01, params });
      const pic = dev.f.map((f) => responseDb(dev.d, bw / 100, res / 100, f) - responseDb(dev.d, bw / 100, res / 100, ref));
      const tol = dev.name === "Car Speaker" ? 5 : 1.5;     // the car also has the comb of its cabin reflection, which the picture leaves out
      const err = Math.max(...dev.f.map((f, i) => Math.abs(meas[i] - mref - pic[i])));
      check(err < tol, `${dev.name}, Bandwidth ${bw} %, Resonance ${res} %: the drawn curve matches the module within ${tol} dB`, `${err.toFixed(2)} dB`);
    }
  }
}
// ---- the picture sits on a stage at the left edge of at most 640 px: pointer hits must still land with the offset (widths 320, 700, 1400)
for (const W of [320, 700, 1400]) {
  const SW = Math.min(W, 640), off = 0;
  const v = runView(m.spec, src, { probes: loud, width: W }).frames(5);
  const s = v.drag((off + (8 + 0.5 * (SW - 16) / 6)) / W, 0.9);
  check(s.length >= 1 && s[0][0] === "device", `width ${W}: a click on the first device tile lands (stage offset ${off} px)`, JSON.stringify(s));
  const miss = W > SW ? v.drag((SW + 8) / W, 0.5) : [];   // just to the right of the stage
  check(miss.length === 0, `width ${W}: a press outside the stage does nothing`, JSON.stringify(miss));
}
finish();
