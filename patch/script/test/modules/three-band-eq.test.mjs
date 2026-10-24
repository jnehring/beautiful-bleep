// SPDX-License-Identifier: GPL-3.0-only
// 3-Band EQ: flat at default, each band boosts and cuts where it should, stereo, safety.
//   node test/modules/three-band-eq.test.mjs
import { loadModule, render, sine, gainAt, check, finish, finiteAll, peak } from "./lib.mjs";

const m = await loadModule("three-band-eq");
check(m.warnings.length === 0, "no warnings", JSON.stringify(m.cost));
const g = (params, f, extra = {}) => gainAt(m, f, { amp: 0.1, params, out: "outL", n: f < 100 ? 131072 : 32768, ...extra });
const near = (v, t, tol = 0.5) => Math.abs(v - t) <= tol;

for (const f of [50, 500, 5000]) check(near(g({}, f), 0, 0.05), `flat at ${f} Hz`, g({}, f).toFixed(3));

const lo = { lowFreq: 200 };
check(near(g({ ...lo, lowGain: 12 }, 40), 12, 1), "low shelf boosts the bottom by its gain", g({ ...lo, lowGain: 12 }, 40).toFixed(2));
check(near(g({ ...lo, lowGain: 12 }, 5000), 0, 0.2), "low shelf leaves the top alone");
check(near(g({ ...lo, lowGain: -12 }, 40), -12, 1), "low shelf cuts");
check(near(g({ midGain: 10, midFreq: 1000 }, 1000), 10, 0.3), "mid bell hits its gain at the centre", g({ midGain: 10, midFreq: 1000 }, 1000).toFixed(2));
check(near(g({ midGain: 10, midFreq: 1000 }, 60), 0, 0.5) && near(g({ midGain: 10, midFreq: 1000 }, 10000), 0, 0.5), "mid bell leaves the far ends alone");
check(g({ midGain: 10, midQ: 4 }, 1500) < g({ midGain: 10, midQ: 0.5 }, 1500) - 3, "a higher Q is narrower");
check(near(g({ highGain: 12, highFreq: 4000 }, 12000), 12, 1), "high shelf boosts the top", g({ highGain: 12, highFreq: 4000 }, 12000).toFixed(2));
check(near(g({ highGain: 12 }, 100), 0, 0.2), "high shelf leaves the bottom alone");
check(near(g({ output: -6 }, 1000), -6, 0.05), "Output sets the level");
check(near(g({ lowGain: 12 }, 40, { input: "r", out: "outR" }), g({ lowGain: 12 }, 40), 0.01), "right channel matches the left");

const wild = { lowGain: 15, midGain: 15, highGain: 15, midQ: 4, highFreq: 12000, midFreq: 5000, output: 12 };
const y = render(m, { inputs: { l: sine(1000, 1, 48000), r: sine(7000, 1, 48000) }, params: wild });
check(finiteAll(y.outL) && finiteAll(y.outR) && peak(y.outL) < 100, "stays finite at the extremes");
finish();
