// SPDX-License-Identifier: GPL-3.0-or-later
// The helpers themselves, on the Gains module.   node test/modules/smoke.test.mjs
import { loadModule, render, sine, gainAt, check, finish } from "./lib.mjs";

const m = await loadModule("gains");
check(m.spec.type === "gains" && m.cost.ops > 0 && m.cost.ops < m.cost.limit, "gains compiles and has a cost estimate", JSON.stringify(m.cost));
const out = render(m, { inputs: { x: sine(1000, 0.5, 4800) }, params: { vol: -6.0206 } });
check(Math.abs(Math.max(...out.out.slice(2400)) - 0.25) < 0.01, "render: gain -6 dB halves a 0.5 sine", String(Math.max(...out.out.slice(2400))));
check(Math.abs(gainAt(m, 1000, { out: "out", input: "x", params: { vol: -12 } }) + 12) < 0.1, "gainAt measures -12 dB");
finish();
