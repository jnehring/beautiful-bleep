// SPDX-License-Identifier: MIT
// Prints {slug: [type ids]} for every module .wasm in <out>/modules (used by build_modules.py).
import { readdirSync, readFileSync } from "node:fs";
import { compileModule, readSpecs } from "../js/module-host.js";
const dir = process.argv[2] + "/modules";
const result = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".wasm")).sort())
  result[f.replace(/\.wasm$/, "")] = readSpecs(await compileModule(readFileSync(`${dir}/${f}`))).map((s) => s.type);
console.log(JSON.stringify(result));
