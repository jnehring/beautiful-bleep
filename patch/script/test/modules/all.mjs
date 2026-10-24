// SPDX-License-Identifier: GPL-3.0-only
// Runs every module script test in test/modules/ (*.test.mjs), one process each.   node test/modules/all.mjs
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith(".test.mjs")).sort()) {
  console.log(`\n== ${f}`);
  const r = spawnSync(process.execPath, [`${dir}${f}`], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} module test file(s) failed` : "\nall module tests passed");
process.exit(failed ? 1 : 0);
