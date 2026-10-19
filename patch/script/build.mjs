// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles the Bleep Script modules in src/*.dsp.ts to build/*.wasm with the AssemblyScript compiler (asc) and the Bleep
// transform, which generates each module's spec and bleep_* exports from its decorators (transform/bleep.mjs).
//   node build.mjs [source ...]        default: every src/*.dsp.ts
import { readdirSync, readFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";
import { BleepTransform } from "./transform/bleep.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const sources = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(`${root}src`).filter((f) => f.endsWith(".dsp.ts")).map((f) => `src/${f}`);
mkdirSync(`${root}build`, { recursive: true });

let failed = false;
for (const source of sources) {
  const name = basename(source).replace(/\.dsp\.ts$/, "");
  const out = `build/${name}.wasm`;
  const transform = new BleepTransform();
  const { error } = await asc.main([
    source, "--outFile", out, "--textFile", `build/${name}.wat`,
    "--baseDir", root,
    "--runtime", "stub",              // no garbage collector: nothing is allocated while processing
    "--use", "abort=",                // no env.abort import: the module imports nothing
    "--exportStart", "_initialize",   // module-abi.md: _initialize runs once per instance
    "--disableWarning", "235",       // AS235: the module class is exported for the generated entry file, not for the host
    "--optimizeLevel", "3", "--shrinkLevel", "1", "--noAssert",
  ], { stdout: process.stdout, stderr: process.stderr, transforms: [transform] });
  if (error) { console.error(`${name}: ${error.message}`); failed = true; continue; }
  writeFileSync(`${root}build/${name}.spec.json`, JSON.stringify(transform.specs, null, 2) + "\n");
  for (const g of transform.generated) writeFileSync(`${root}build/${basename(g.path)}`, g.text);   // to read when something is wrong
  console.log(`${name}: ${statSync(`${root}${out}`).size} bytes -> ${out}`);
}
process.exit(failed ? 1 : 0);
