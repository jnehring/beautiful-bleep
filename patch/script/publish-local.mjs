// SPDX-License-Identifier: GPL-3.0-or-later
// Builds the script modules listed in local-modules.txt and adds them to a Bleep Play local-modules folder (modules/<name>.wasm and an entry in
// manifest.json and its types map), next to the native modules scripts/build/build-web.sh puts there. Bleep Play loads them unsigned, like those.
//   node publish-local.mjs <local-modules dir>
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dir = process.argv[2];
if (!dir || !existsSync(`${dir}/manifest.json`)) { console.error("usage: node publish-local.mjs <local-modules dir with manifest.json>"); process.exit(2); }
const names = readFileSync(`${root}local-modules.txt`, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const built = spawnSync(process.execPath, [`${root}build.mjs`, ...names.map((n) => `src/${n}.dsp.ts`)], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
if (built.status !== 0) { console.error("publish-local: the script modules did not compile"); process.exit(1); }

const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
mkdirSync(`${dir}/modules`, { recursive: true });
for (const n of names) {
  const specs = JSON.parse(readFileSync(`${root}build/${n}.spec.json`, "utf8"));
  copyFileSync(`${root}build/${n}.wasm`, `${dir}/modules/${n}.wasm`);
  manifest.modules[n] = { file: `modules/${n}.wasm`, bytes: statSync(`${dir}/modules/${n}.wasm`).size, types: specs.map((s) => s.type), spec: specs };   // spec: so the Add menu lists the types (demo-types.json only knows the native modules)
  for (const s of specs) manifest.types[s.type] = n;   // type id -> the module that provides it
  console.log(`  built ${n} (script, ${Math.round(manifest.modules[n].bytes / 1024)} KB)`);
}
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + "\n");
