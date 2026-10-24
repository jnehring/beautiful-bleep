// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Prints the node type descriptions of a module .wasm (its bleep_spec_json) as one line of JSON, for package-module.py:
// the package carries them, so a host can list a module's node types without compiling the module.
//   node patch/web/test/spec-json.mjs <module.wasm>
import { readFileSync } from "node:fs";
import { compileModule, readSpecs } from "../js/module-host.js";
console.log(JSON.stringify(readSpecs(await compileModule(readFileSync(process.argv[2])))));
