// SPDX-License-Identifier: GPL-3.0-only
// Mic Colour's own UI (src/mic-colour.view.js) against the mock sandbox.   node test/modules/mic-colour.view.test.mjs
import { loadModule, gainAt, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("mic-colour"), src = viewSource("mic-colour");
check(!!src && src.startsWith("// SPDX"), "the UI file exists and starts with the licence line");
const LOGGER = `const __open = bleep.canvas; bleep.canvas = (h) => { const c = __open(h); const g = c.g; c.g = new Proxy(g, { get(t, k) { const f = t[k]; return typeof f === "function" ? (...a) => { globalThis.__log.push([k, a]); return f(...a); } : f; }, set(t, k, v) { t[k] = v; return true; } }); return c; };\n`;
const make = (opts = {}) => { globalThis.__log = []; return runView(m.spec, LOGGER + src, opts); };
const probes = { silence: () => ({}), loud: (t) => ({ level: 0.5 + 0.5 * Math.sin(t * 7) }), clip: () => ({ level: 9 }), negative: () => ({ level: -1 }) };

for (const [name, p] of Object.entries(probes)) for (const width of [320, 520, 900]) {
  const v = make({ probes: p, width }); v.frames(300);
  check(v.failures.length === 0 && v.stats.paints >= 300, `runs 300 frames (${name}, ${width} px) and paints every frame`, v.failures.slice(0, 2).join("; "));
}
{
  const v = make({ probes: probes.loud, width: 320 });
  for (const model of [0, 1, 2, 3]) for (const end of [0, 1]) { for (const p of m.spec.params) v.bleep.param(p.id).setNormalised(end); v.bleep.param("model").set(model); v.frames(40); }
  check(v.failures.length === 0, "all params at min and max for every model: no failure, no NaN", v.failures.slice(0, 3).join("; "));
}
{
  const v = make({ probes: probes.silence }); v.frames(10);
  globalThis.__log.length = 0; v.frames(1); const a = JSON.stringify(globalThis.__log); globalThis.__log.length = 0; v.frames(1); const b = JSON.stringify(globalThis.__log);
  check(a !== b && a.length > 100, "two consecutive frames at silence differ (idle animation)");
  v.frames(3000); check(v.failures.length === 0, "a long run stays healthy");
}
{ // the response curve in the picture against the module
  const quiet = { room: 0, selfNoise: -100 };
  for (const [name, params, fr] of [["Condenser default", { model: 2 }, [200, 1000, 4000, 8000]], ["Ribbon, close", { model: 0, distance: 8, proximity: 90 }, [100, 400, 2000, 6000]], ["Dynamic, presence 70", { model: 1, presence: 70 }, [100, 700, 4000, 8000]]]) {
    const v = make(); for (const [k, val] of Object.entries(params)) v.bleep.param(k).set(val); v.frames(2);
    const log = globalThis.__log; let end = -1;
    for (let i = log.length - 1; i >= 0; i--) if (log[i][0] === "stroke") { let n = 0, j = i - 1; while (j >= 0 && log[j][0] === "lineTo") { n++; j--; } if (n === 119 && log[j][0] === "moveTo") { end = i; break; } }
    let worst = 0, at = 0;
    if (end > 0) for (const f of fr) {
      const i = Math.round(119 * Math.log(f / 30) / Math.log(600)), y = log[end - 120 + i][1][1], ui = (1 - (y - 192) / 78) * 26 - 12;
      const e = Math.abs(ui - gainAt(m, f, { amp: 0.005, params: { ...quiet, ...params }, out: "outL", n: f < 150 ? 131072 : 32768 })); if (e > worst) { worst = e; at = f; }
    }
    check(end > 0 && worst < 1.5, `drawn response matches the module's measured response: ${name}`, `worst ${worst.toFixed(2)} dB at ${at} Hz`);
  }
}
{
  const W = 520, H = 280, v = make({ probes: probes.silence, width: W }); v.frames(2);
  const srcX = (d) => 48 + 30 + (W - 8 - 20 - 48 - 30) * Math.log(d / 3) / Math.log(100);
  v.drag(srcX(30) / W, 83 / H, srcX(120) / W, 83 / H);
  const d = v.bleep.param("distance").value;
  check(Math.abs(d - 120) < 5, "dragging the source right sets Distance", d.toFixed(1));
  v.drag(srcX(120) / W, 83 / H, 0.0, 83 / H);
  check(Math.abs(v.bleep.param("distance").value - 3) < 0.01, "dragging past the mic clamps at 3 cm");
  v.drag(48 / W, 83 / H, 78 / W, 53 / H);
  check(Math.abs(v.bleep.param("offAxis").value - 50) < 3, "turning the microphone sets Off-Axis (45 degrees = 50 %)", v.bleep.param("offAxis").value.toFixed(1));
  v.drag((8 + 2 * 128) / W + 0.02, 174 / H);
  check(v.bleep.param("model").value === 2, "clicking a model pill switches the model", String(v.bleep.param("model").value));
  v.frames(5);
  check(v.failures.length === 0, "no failures during drags", v.failures.join("; "));
  const bad = m.spec.params.filter((p) => { const x = v.bleep.param(p.id).value; return !(x >= p.min && x <= p.max); });
  check(bad.length === 0, "every param stays inside its range");
}
for (const W of [320, 700, 1400]) {
  const SW = Math.min(W, 640), ox = 0, H = 280, v = make({ probes: probes.silence, width: W }); v.frames(2);
  const room = SW - 16, sx = (d) => ox + 48 + 30 + (8 + room - 20 - 48 - 30) * Math.log(d / 3) / Math.log(100);
  v.drag(sx(30) / W, 83 / H, sx(100) / W, 83 / H);
  check(Math.abs(v.bleep.param("distance").value - 100) < 5, `width ${W}: dragging the source on the centred stage sets Distance`, v.bleep.param("distance").value.toFixed(1));
  v.drag((ox + 8 + 3 * Math.max(60, (SW - 16) / 4) + 20) / W, 174 / H);
  check(v.bleep.param("model").value === 3, `width ${W}: the model pill is hit`, String(v.bleep.param("model").value));
  check(v.failures.length === 0, `width ${W}: no failures`, v.failures.join("; "));
}
finish();
