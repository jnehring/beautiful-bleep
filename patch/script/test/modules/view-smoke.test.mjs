// SPDX-License-Identifier: GPL-3.0-or-later
// The UI mock itself, on the playground's "Wave folder with its own UI" example.   node test/modules/view-smoke.test.mjs
import { EXAMPLES } from "../../playground/examples.mjs";
import { runView } from "./view-lib.mjs";
import { check, finish } from "./lib.mjs";

const spec = { params: [{ id: "drive", name: "Drive", kind: "float", min: 0, max: 20, def: 2, label: "" }, { id: "mix", name: "Mix", kind: "float", min: 0, max: 1, def: 1 }] };
const ex = EXAMPLES.find((e) => e.id === "fold-ui");
const v = runView(spec, ex.view, { probes: (t) => ({ level: 0.5 + 0.5 * Math.sin(t * 3) }) });
v.frames(120);
check(v.failures.length === 0, "the example UI runs 120 frames without a failure", v.failures.join("; "));
check(v.stats.paints > 120, "it paints", String(v.stats.paints));
const sets = v.drag(0.25, 0.25, 0.75, 0.5);
check(sets.some(([id]) => id === "drive") && sets.some(([id]) => id === "mix"), "dragging sets Drive and Mix", JSON.stringify(sets.slice(0, 2)));
check(Math.abs(v.bleep.param("drive").normalised - 0.75) < 1e-6, "setNormalised is honoured");
const bad = runView(spec, "const c = bleep.canvas(50); bleep.onFrame(() => c.g.fillRect(0, 0, NaN, 1));").frames(2);
check(bad.failures.length > 0, "a NaN in a drawing call is reported");
finish();
