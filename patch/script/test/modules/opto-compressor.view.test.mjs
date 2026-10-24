// SPDX-License-Identifier: GPL-3.0-only
// Opto Compressor's own UI (src/opto-compressor.view.js) against the mock sandbox.   node test/modules/opto-compressor.view.test.mjs
import { loadModule, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("opto-compressor"), src = viewSource("opto-compressor");
check(!!src && src.startsWith("// SPDX"), "the UI file exists and starts with the licence line");
const LOGGER = `const __open = bleep.canvas; bleep.canvas = (h) => { const c = __open(h); const g = c.g; c.g = new Proxy(g, { get(t, k) { const f = t[k]; return typeof f === "function" ? (...a) => { globalThis.__log.push([k, a]); return f(...a); } : f; }, set(t, k, v) { t[k] = v; return true; } }); return c; };\n`;
const make = (opts = {}) => { globalThis.__log = []; return runView(m.spec, LOGGER + src, opts); };
// plausible probes: a loud passage that compresses (the fast stage follows quickly, the charge slowly), then release
const loud = (t) => { const on = t % 8 < 4, fast = on ? 10 * (1 - Math.exp(-(t % 8) * 8)) : 10 * Math.exp(-((t % 8) - 4) * 10); const slow = on ? 8 * (1 - Math.exp(-(t % 8) / 1.5)) : 8 * Math.exp(-((t % 8) - 4) / 3); return { gr: 0.5 * (fast + slow), fast, charge: slow }; };
const probes = { silence: () => ({}), loud, extreme: () => ({ gr: 60, fast: 60, charge: 60 }), negative: () => ({ gr: -3, fast: -3, charge: -3 }) };

for (const [name, p] of Object.entries(probes)) for (const width of [320, 520, 900]) {
  const v = make({ probes: p, width }); v.frames(300);
  check(v.failures.length === 0 && v.stats.paints >= 300, `runs 300 frames (${name}, ${width} px) and paints every frame`, v.failures.slice(0, 2).join("; "));
}
{
  const v = make({ probes: probes.loud, width: 320 });
  for (const end of [0, 1]) { for (const p of m.spec.params) v.bleep.param(p.id).setNormalised(end); v.frames(40); }
  check(v.failures.length === 0, "all params at min and max: no failure, no NaN", v.failures.slice(0, 3).join("; "));
}
{
  const v = make({ probes: probes.silence }); v.frames(10);
  globalThis.__log.length = 0; v.frames(1); const a = JSON.stringify(globalThis.__log); globalThis.__log.length = 0; v.frames(1); const b = JSON.stringify(globalThis.__log);
  check(a !== b && a.length > 100, "two consecutive frames at silence differ (idle animation)");
  v.frames(3000); check(v.failures.length === 0, "a long run stays healthy");
  // the lamp glows with the gain reduction: more radial-gradient alpha when reducing
  const alphas = (p) => { const w = make({ probes: p }); w.frames(120); const l = globalThis.__log; let i = l.length - 1; while (i > 0 && !(l[i][0] === "createRadialGradient")) i--; return l.slice(i).find((e) => e[0] === "arc"); };
  check(!!alphas(probes.silence) && !!alphas(probes.loud), "the lamp is drawn in both states");
}
{
  const W = 520, H = 290, v = make({ probes: probes.silence, width: W }); v.frames(2);
  v.drag(0.17, 100 / H, 0.17, 40 / H);          // 60 px up = +50 on the 0..100 scale
  check(Math.abs(v.bleep.param("peakReduction").value - 90) < 1, "dragging the lamp up raises Peak Reduction (40 + 50)", String(v.bleep.param("peakReduction").value));
  v.drag(0.17, 100 / H, 0.17, 1.0);
  check(v.bleep.param("peakReduction").value === 0, "dragging far down clamps at 0");
  v.drag(0.74, 150 / H);
  check(v.bleep.param("mode").value === 1, "clicking the dial switches Compress to Limit");
  v.drag(0.74, 150 / H);
  check(v.bleep.param("mode").value === 0, "and back");
  check(v.failures.length === 0, "no failures during drags", v.failures.join("; "));
}
for (const W of [320, 700, 1400]) {   // the stage is at most 640 px, at the left edge: hits must follow the offset
  const SW = Math.min(W, 640), ox = 0, H = 290, v = make({ probes: probes.silence, width: W }); v.frames(2);
  v.drag((ox + SW * 0.17) / W, 100 / H, (ox + SW * 0.17) / W, 70 / H);
  check(Math.abs(v.bleep.param("peakReduction").value - 65) < 1, `width ${W}: dragging the lamp on the centred stage sets Peak Reduction`, String(v.bleep.param("peakReduction").value));
  v.drag((ox + SW * 0.74) / W, 150 / H);
  check(v.bleep.param("mode").value === 1, `width ${W}: clicking the dial toggles the mode`);
  const before = v.stats.sets.length; v.drag(ox / 2 / W + 0.001, 100 / H);   // left of the stage: nothing
  check(ox < 10 || v.stats.sets.length === before, `width ${W}: a click left of the stage does nothing`);
  check(v.failures.length === 0, `width ${W}: no failures`, v.failures.join("; "));
}
finish();
