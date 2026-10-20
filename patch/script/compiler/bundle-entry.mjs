// SPDX-License-Identifier: GPL-3.0-or-later
// The entry of the browser bundle (npm run bundle -> dist/bleep-script-compiler.js): the AssemblyScript compiler, Binaryen, the Bleep
// transform and the Bleep Script library sources in one file, so a page needs no import map and no other request.
import asc from "assemblyscript/asc";
import abi from "../src/bleep/abi.ts";
import dsp from "../src/bleep/dsp.ts";
import format from "../src/bleep/format.ts";
import delay from "../src/bleep/delay.ts";
import filters from "../src/bleep/filters.ts";
import notes from "../src/bleep/notes.ts";
import osc from "../src/bleep/osc.ts";
import random from "../src/bleep/random.ts";
import util from "../src/bleep/util.ts";
import gains from "../src/gains.dsp.ts";
import { EXAMPLES } from "../playground/examples.mjs";
import { compileScript } from "./compile.mjs";
import { runPatchScript } from "../patch/run.mjs";
import { materialize } from "../patch/materialize.mjs";

const lib = { "src/bleep/abi.ts": abi, "src/bleep/dsp.ts": dsp, "src/bleep/format.ts": format, "src/bleep/notes.ts": notes,
  "src/bleep/osc.ts": osc,
  "src/bleep/filters.ts": filters, "src/bleep/delay.ts": delay, "src/bleep/util.ts": util, "src/bleep/random.ts": random };

/// compile(source, { typeId }) -> { wasm, specs, generated, problems, ms }
export const compile = (source, options = {}) => compileScript(asc, source, { lib, ...options });
/// Runs a patch script (layer 1) and builds the cell it describes: { ok, problems, nodes, cables, interface }.
/// types: the board's module types; options: { cellId, parent, x, y, generatedBy } for materialize.
export async function patch(source, settings, types, options) {
  const r = await runPatchScript(source, settings);
  if (!r.ok) return { ok: false, problems: r.problems };
  const m = materialize(r.spec, types, options);
  return { ok: m.ok, problems: m.problems, nodes: m.nodes, cables: m.cables, interface: { kind: "patch", name: r.spec.name, description: r.spec.description, settings: r.spec.settings, summary: m.summary } };
}

/// Starting points for the editor: [{ id, name, source }].
export const examples = [{ id: "gains", name: "Gains (mixer channel)", source: gains }, ...EXAMPLES];
export const version = "0.1";
