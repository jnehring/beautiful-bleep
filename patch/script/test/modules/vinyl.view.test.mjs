// SPDX-License-Identifier: GPL-3.0-or-later
// Vinyl UI (src/vinyl.view.js) run against the UI mock: no failures over many frames at several probe states and extreme knobs,
// paints every frame, idles when silent, and dragging the picture sets the intended knobs.   node test/modules/vinyl.view.test.mjs
import { loadModule, render, sine, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("vinyl");
const src = viewSource("vinyl");
check(!!src && src.startsWith("// SPDX-License-Identifier"), "the UI file exists and starts with the SPDX line");
const live = render(m, { inputs: { l: sine(440, 0.3, 4800) } }).instance.live().values;
const PROBES = ["groove", "turn", "click"];
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

// ---- dragging: the needle position is the distance from the disc centre
{
  const v = runView(m.spec, src, { probes: loud, width: 520 }).frames(10);
  const R = Math.min(240 * 0.42, 520 * 0.3), cx = 0.34, cy = 0.5, rim = v.drag(cx + (R * 0.9) / 520, cy), inner = v.drag(cx + (R * 0.4) / 520, cy);
  const a = rim.filter(([id]) => id === "inner").pop(), b = inner.filter(([id]) => id === "inner").pop();
  check(inRange(rim) && inRange(inner) && a && b && a[1] < 15 && b[1] > 80, "dragging the needle towards the label raises Inner Groove (rim ~0 %, label ~100 %)", `${a && a[1].toFixed(0)} % then ${b && b[1].toFixed(0)} %`);
  const lab = v.drag(cx, cy);
  check(lab.length === 1 && lab[0][0] === "cartridge" && lab[0][1] === 2, "clicking the label cycles the cartridge (Standard -> Cheap)", JSON.stringify(lab));
  const far = v.drag(0.99, 0.99);
  check(inRange(far), "dragging far outside the disc stays in range");
}
// ---- scratches reach the needle exactly when the module plays them: the picture follows the `turn` probe
{
  const run = (turn) => { const v = recorded(src, { probes: () => ({ turn, click: 0, level: 0.2 }) }); v.bleep.param("dust").setNormalised(1); v.frames(200); globalThis.__log.length = 0; v.frames(1); return globalThis.__log.join("|"); };
  check(run(0.137) !== run(0.5), "the disc follows the module's position on the turn");
}
// ---- the picture sits on a stage at the left edge of at most 640 px: pointer hits must still land with the offset (widths 320, 700, 1400)
for (const W of [320, 700, 1400]) {
  const SW = Math.min(W, 640), off = 0;
  const v = runView(m.spec, src, { probes: loud, width: W }).frames(5);
  const s = v.drag((off + 0.34 * SW) / W, 0.5);
  check(s.length >= 1 && s[0][0] === "cartridge", `width ${W}: a click on the label lands (stage offset ${off} px)`, JSON.stringify(s));
  const miss = W > SW ? v.drag((SW + 8) / W, 0.5) : [];   // just to the right of the stage
  check(miss.length === 0, `width ${W}: a press outside the stage does nothing`, JSON.stringify(miss));
}
finish();
