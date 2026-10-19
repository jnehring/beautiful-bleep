// SPDX-License-Identifier: GPL-3.0-or-later
// The entry of the browser bundle (npm run bundle -> dist/bleep-script-compiler.js): the AssemblyScript compiler, Binaryen, the Bleep
// transform and the Bleep Script library sources in one file, so a page needs no import map and no other request.
import asc from "assemblyscript/asc";
import abi from "../src/bleep/abi.ts";
import dsp from "../src/bleep/dsp.ts";
import format from "../src/bleep/format.ts";
import gains from "../src/gains.dsp.ts";
import { EXAMPLES } from "../playground/examples.mjs";
import { compileScript } from "./compile.mjs";

const lib = { "src/bleep/abi.ts": abi, "src/bleep/dsp.ts": dsp, "src/bleep/format.ts": format };

/// compile(source, { typeId }) -> { wasm, specs, generated, problems, ms }
export const compile = (source, options = {}) => compileScript(asc, source, { lib, ...options });
/// Starting points for the editor: [{ id, name, source }].
export const examples = [{ id: "gains", name: "Gains (mixer channel)", source: gains }, ...EXAMPLES];
export const version = "0.1";
