// SPDX-License-Identifier: GPL-3.0-only
// Compiles one script module of patch/modules/ to a .wasm (and its node type descriptions): what patch/web/build_modules.py runs for them.
//   node build-module.mjs <slug> <out.wasm> [<out.spec.json>]
import { writeFileSync } from "node:fs";
import { scriptModules, buildModule } from "./modules.mjs";

const [slug, out, specOut] = process.argv.slice(2);
const m = scriptModules().find((x) => x.slug === slug);
if (!m || !out) { console.error("usage: node build-module.mjs <slug> <out.wasm> [<out.spec.json>]"); process.exit(2); }
const r = await buildModule(m);
const errors = r.problems.filter((p) => p.severity === "error");
if (errors.length || !r.wasm) { console.error(`${slug}: ${errors.map((p) => (p.line ? `line ${p.line}: ` : "") + p.message).join("; ") || "did not compile"}`); process.exit(1); }
writeFileSync(out, r.wasm);
if (specOut) writeFileSync(specOut, JSON.stringify(r.specs, null, 2) + "\n");
