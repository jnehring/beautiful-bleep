// SPDX-License-Identifier: GPL-3.0-or-later
// The Valve Stage's own UI (src/valve-stage.view.js) run against the mock sandbox.   node test/modules/valve-stage.view.test.mjs
import { loadModule, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("valve-stage");
const src = viewSource("valve-stage");
check(!!src, "src/valve-stage.view.js exists");
const states = {
  silence: () => ({ supply: 1, grid: 0, level: 0 }),
  loud: (t) => ({ supply: 0.5, grid: 1, level: 1 + 0.1 * Math.sin(t) }),
  moving: (t) => ({ supply: 0.75 + 0.25 * Math.sin(t), grid: 0.5 + 0.5 * Math.sin(t * 3), level: 0.5 + 0.5 * Math.sin(t * 5) }),
  nonsense: () => ({ supply: -2, grid: 1e9, level: -5 }),
};
for (const [name, probes] of Object.entries(states)) for (const width of [320, 520, 900]) for (const n of [1, 2, 3]) {
  const v = runView(m.spec, src, { probes, width });
  v.bleep.param("stages").set(n); v.bleep.param("plate").set(5);
  v.frames(300);
  check(v.failures.length === 0 && v.stats.paints >= 300, `${name}, ${width} px, ${n} tube(s), starved plate: 300 frames, painted, no NaN`, v.failures.slice(0, 2).join("; "));
}
for (const x of [0, 1]) { const v = runView(m.spec, src, { probes: states.loud }); for (const p of m.spec.params) v.bleep.param(p.id).setNormalised(x); v.frames(200); check(v.failures.length === 0, `every knob at ${x ? "max" : "min"}: no failure`, v.failures.slice(0, 2).join("; ")); }
{ // a click cycles the tube; a drag changes Gain
  const v = runView(m.spec, src, { probes: states.moving }); v.frames(5);
  const t0 = v.bleep.param("tube").value;
  const s1 = v.drag(0.2, 0.5);
  check(s1.some(([id]) => id === "tube") && v.bleep.param("tube").value === (t0 + 1) % 3, "clicking a tube cycles the tube type", JSON.stringify(s1));
  const g0 = v.bleep.param("gain").value;
  const s2 = v.drag(0.2, 0.8, 0.2, 0.3);
  check(s2.some(([id]) => id === "gain") && v.bleep.param("gain").value > g0 && !s2.some(([id]) => id === "tube"), "dragging a tube up raises Gain (and does not cycle the tube)", JSON.stringify(s2.slice(0, 2)));
  check(s2.every(([id, val]) => { const p = m.spec.params.find((q) => q.id === id); return val >= p.min && val <= p.max; }), "every value set is inside its range");
}
{ const v = runView(m.spec, src, { probes: states.silence }); v.frames(10); const a = v.stats.calls; v.frames(1); check(v.stats.calls > a, "silence still draws every frame (the glow flickers)"); }
finish();
