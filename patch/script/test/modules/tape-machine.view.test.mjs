// SPDX-License-Identifier: GPL-3.0-or-later
// Tape Machine UI (src/tape-machine.view.js) run against the UI mock: no failures over many frames at several probe states and extreme knobs,
// paints every frame, idles when silent, and dragging the picture sets the intended knobs.   node test/modules/tape-machine.view.test.mjs
import { loadModule, render, sine, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("tape-machine");
const src = viewSource("tape-machine");
check(!!src && src.startsWith("// SPDX-License-Identifier"), "the UI file exists and starts with the SPDX line");
const live = render(m, { inputs: { l: sine(440, 0.3, 4800) } }).instance.live().values;
const PROBES = ["level", "saturation", "dropout", "wobble"];
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

// ---- dragging
{
  const v = runView(m.spec, src, { probes: loud }).frames(10);
  const down = v.drag(0.5, 0.15, 0.5, 0.15), up = v.drag(0.5, 0.9, 0.5, 0.9);
  const dr = down.filter(([id]) => id === "drive").pop()[1], dr2 = up.filter(([id]) => id === "drive").pop()[1];
  check(inRange(down) && inRange(up) && dr > dr2 + 20, "dragging up and down sets Input Level inside its range", `${dr.toFixed(1)} then ${dr2.toFixed(1)} dB`);
  const w = v.stats.sets.length;
  const clickReel = v.drag(0.24, 0.46);
  check(clickReel.length === 1 && clickReel[0][0] === "speed" && clickReel[0][1] === 2, "clicking a reel cycles Speed (15 ips -> 30 ips)", JSON.stringify(clickReel));
  const again = v.drag(0.76, 0.46), third = v.drag(0.24, 0.46);
  check(again[0][1] === 0 && third[0][1] === 1, "and wraps round (30 -> 7.5 -> 15 ips)", `${again[0][1]}, ${third[0][1]}`);
}
// ---- the reels turn faster at a higher speed (idle, no probes): compare how far the first spoke moves in one second
{
  const turned = (speed) => { const v = recorded(src, { probes: silence }); v.bleep.param("speed").set(speed); globalThis.__log.length = 0; v.frames(60); return globalThis.__log.filter((x) => x.startsWith("lineTo")).slice(0, 6).join("|"); };
  check(turned(0) !== turned(2), "the reels move differently at 7.5 and 30 ips");
}
// ---- the picture sits on a stage at the left edge of at most 640 px: pointer hits must still land with the offset (widths 320, 700, 1400)
for (const W of [320, 700, 1400]) {
  const SW = Math.min(W, 640), off = 0;
  const v = runView(m.spec, src, { probes: loud, width: W }).frames(5);
  const s = v.drag((off + 0.24 * SW) / W, 0.46);
  check(s.length >= 1 && s[0][0] === "speed", `width ${W}: a click on the left reel lands (stage offset ${off} px)`, JSON.stringify(s));
  const miss = W > SW ? v.drag((SW + 8) / W, 0.5) : [];   // just to the right of the stage
  check(miss.length === 0, `width ${W}: a press outside the stage does nothing`, JSON.stringify(miss));
}
finish();
