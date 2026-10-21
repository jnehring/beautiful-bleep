// SPDX-License-Identifier: GPL-3.0-or-later
// The Channel Strip's own UI (src/channel-strip.view.js) run against the mock sandbox.   node test/modules/channel-strip.view.test.mjs
import { loadModule, gainAt, check, finish } from "./lib.mjs";
import { runView, viewSource } from "./view-lib.mjs";

const m = await loadModule("channel-strip");
const src = viewSource("channel-strip");
check(!!src, "channel-strip.view.js exists");
const states = {
  silence: () => ({ saturation: 0, level: 0 }),
  loud: (t) => ({ saturation: 1, level: 1 + 0.2 * Math.sin(t) }),
  moving: (t) => ({ saturation: 0.5 + 0.5 * Math.sin(t * 2), level: 0.5 + 0.5 * Math.sin(t * 5) }),
  nonsense: () => ({ saturation: -4, level: 1e7 }),
};
for (const [name, probes] of Object.entries(states)) for (const width of [320, 520, 900]) {
  const v = runView(m.spec, src, { probes, width });
  v.frames(300);
  check(v.failures.length === 0 && v.stats.paints >= 300, `${name}, ${width} px: 300 frames, painted, no NaN`, v.failures.slice(0, 2).join("; "));
}
for (const x of [0, 1]) { const v = runView(m.spec, src, { probes: states.loud }); for (const p of m.spec.params) v.bleep.param(p.id).setNormalised(x); v.frames(120); check(v.failures.length === 0, `every knob at ${x ? "max" : "min"}: no failure`, v.failures.slice(0, 2).join("; ")); }
{ // the drawn curve agrees with the module
  const v = runView(m.spec, src, { probes: states.silence }); v.frames(2);
  const set = { hpf: 3, hpfSlope: 1, lfGain: 9, lfFreq: 1, lmGain: -10, lmFreq: 2, hmGain: 12, hmFreq: 2, hfGain: -7, hfFreq: 3 };
  const params = { iron: 0, drive: 0, character: 2, ...set };
  for (const [k, val] of Object.entries(set)) v.bleep.param(k).set(val);
  let worst = 0;
  for (const f of [40, 80, 150, 400, 1000, 3000, 5000, 9000, 14000]) worst = Math.max(worst, Math.abs(v.bleep.responseDb(f) - gainAt(m, f, { amp: 0.01, params, out: "outL" })));
  check(worst < 1.5, "the UI's response curve matches the module's measured response within 1.5 dB", `worst ${worst.toFixed(2)} dB`);
}
{ // dragging a handle
  const v = runView(m.spec, src, { probes: states.silence }); v.frames(2);
  // LMF handle sits at 500 Hz, 0 dB; width 520: x = 8 + (ln(500/20)/ln(1000)) * (520-56)
  const w = 520, x = (8 + Math.log(500 / 20) / Math.log(1000) * (w - 56)) / w, y = (10 + (240 - 24) / 2) / 240;
  const sets = v.drag(x, y, x + 0.12, y - 0.2);
  const gs = sets.filter(([id]) => id === "lmGain").pop(), fs = sets.filter(([id]) => id === "lmFreq").pop();
  check(gs && gs[1] > 3 && fs && fs[1] >= 2, "dragging the LMF handle up and right raises its gain and snaps to a higher step", JSON.stringify([gs, fs]));
  check(sets.every(([id, val]) => { const p = m.spec.params.find((q) => q.id === id); return val >= p.min && val <= p.max; }), "every value set is inside its range");
}
{ // the LMF handle is found at canvas widths 320, 700 and 1400 (stage = min(640, width), at the left edge)
  for (const w of [320, 700, 1400]) {
    const v = runView(m.spec, src, { probes: states.silence, width: w }); v.frames(2);
    const sw = Math.min(640, w), off = 0, hx = off + 8 + Math.log(500 / 20) / Math.log(1000) * (sw - 56);
    const sets = v.drag(hx / w, (10 + (240 - 24) / 2) / 240, hx / w, 0.2);
    check(sets.some(([id, val]) => id === "lmGain" && val > 3), `dragging the LMF handle works at canvas width ${w} px`, JSON.stringify(sets.slice(0, 2)));
    check(v.drag(0.99, 0.5).length === 0 || w < 640, `a press beside the stage grabs nothing at ${w} px`);
  }
}
finish();