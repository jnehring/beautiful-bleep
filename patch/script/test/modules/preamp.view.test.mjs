// SPDX-License-Identifier: GPL-3.0-or-later
// The Preamp's own UI (src/preamp.view.js) run against the mock sandbox.   node test/modules/preamp.view.test.mjs
import { loadModule, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("preamp");
const src = viewSource("preamp");
check(!!src, "preamp.view.js exists");
const states = {
  silence: () => ({ core: 0, level: 0 }),
  loud: (t) => ({ core: 1.5, level: 1 + 0.2 * Math.sin(t) }),
  moving: (t) => ({ core: 0.5 + 0.5 * Math.sin(t * 2), level: 0.5 + 0.5 * Math.sin(t * 5) }),
  nonsense: () => ({ core: -3, level: 1e6 }),
};
for (const [name, probes] of Object.entries(states)) for (const width of [320, 520, 900]) {
  const v = runView(m.spec, src, { probes, width });
  v.frames(300);
  check(v.failures.length === 0 && v.stats.paints >= 300, `${name}, ${width} px: 300 frames run, paint every frame, no NaN`, v.failures.slice(0, 2).join("; "));
}
{ // extreme knobs
  for (const x of [0, 1]) { const v = runView(m.spec, src, { probes: states.loud }); for (const p of m.spec.params) v.bleep.param(p.id).setNormalised(x); v.frames(120); check(v.failures.length === 0, `every knob at ${x ? "max" : "min"}: no failure`, v.failures.slice(0, 2).join("; ")); }
}
{ // dragging
  const v = runView(m.spec, src, { probes: states.moving }); v.frames(10);
  const sets = v.drag(0.2, 0.8, 0.9, 0.2);
  const iron = sets.filter(([id]) => id === "iron").pop(), drive = sets.filter(([id]) => id === "drive").pop();
  check(iron && drive && iron[1] > 70 && drive[1] > 70, "dragging to the upper right raises Iron and Drive", JSON.stringify([iron, drive]));
  check(sets.every(([id, val]) => { const p = m.spec.params.find((q) => q.id === id); return val >= p.min && val <= p.max; }), "every value set is inside its range");
}
{ // idle animation, and a frozen state
  const v = runView(m.spec, src, { probes: states.silence }); v.frames(30);
  const a = v.stats.calls; v.frames(1); const b = v.stats.calls; v.frames(1);
  const c1 = v.canvases[0]; check(c1 && v.stats.calls > b && b > a, "silence still draws every frame");
  let recorded = [], v2 = runView(m.spec, "const c = bleep.canvas(50); let t = 0; bleep.onFrame((dt) => { t += dt; c.g.fillRect(Math.sin(t), 0, 1, 1); });"); v2.frames(3);
  check(v2.failures.length === 0, "mock sanity");
  void recorded;
}
{ // pointer hits land on the stage whatever the canvas width (the stage is at the left edge, at most 640 px)
  const hit = (width, fx, fy) => { const v = runView(m.spec, src, { probes: states.moving, width }); v.frames(3); const stage = Math.min(640, width), off = 0; return { v, x: (off + fx * stage) / width, w: width }; };
  for (const width of [320, 700, 1400]) {
    const { v, x } = hit(width, 0.5, 0.5);
    const sets = v.drag(x, 0.5, x, 0.3);
    check(sets.some(([id]) => id === "drive"), `pointer hit at canvas width ${width} px reaches the stage`, JSON.stringify(sets.slice(0, 2)));
    check(v.drag(0.98, 0.5).length === 0 || width < 640, `a press far outside the stage does nothing at ${width} px`);
  }
}
finish();