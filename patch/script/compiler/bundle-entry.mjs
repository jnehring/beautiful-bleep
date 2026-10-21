// SPDX-License-Identifier: GPL-3.0-or-later
// The entry of the browser bundle (npm run bundle -> dist/bleep-script-compiler.js): the AssemblyScript compiler, Binaryen, the Bleep
// transform and the Bleep Script library sources in one file, so a page needs no import map and no other request.
import asc from "assemblyscript/asc";
import abi from "../src/bleep/abi.ts";
import dsp from "../src/bleep/dsp.ts";
import format from "../src/bleep/format.ts";
import delay from "../src/bleep/delay.ts";
import dynamics from "../src/bleep/dynamics.ts";
import env from "../src/bleep/env.ts";
import fft from "../src/bleep/fft.ts";
import filters from "../src/bleep/filters.ts";
import fx from "../src/bleep/fx.ts";
import notes from "../src/bleep/notes.ts";
import osc from "../src/bleep/osc.ts";
import random from "../src/bleep/random.ts";
import util from "../src/bleep/util.ts";
import gains from "../src/gains.dsp.ts";
import synthVoice from "../src/synth-voice.dsp.ts";
import { EXAMPLES } from "../playground/examples.mjs";
import { compileScript } from "./compile.mjs";
import { runPatchScript } from "../patch/run.mjs";
import { materialize } from "../patch/materialize.mjs";

const lib = { "src/bleep/abi.ts": abi, "src/bleep/dsp.ts": dsp, "src/bleep/format.ts": format, "src/bleep/notes.ts": notes,
  "src/bleep/osc.ts": osc,
  "src/bleep/filters.ts": filters, "src/bleep/delay.ts": delay, "src/bleep/env.ts": env, "src/bleep/fft.ts": fft, "src/bleep/fx.ts": fx, "src/bleep/dynamics.ts": dynamics, "src/bleep/util.ts": util, "src/bleep/random.ts": random };

// the tool that links a script with the library modules it imports (wasm-merge.mjs): a file next to this one, loaded when a script needs it
const mergeTool = () => import(new URL("./bleep-script-merge.js", import.meta.url).href);

/// compile(source, { typeId, constants, children }) -> { wasm, specs, generated, problems, ms, linked }
/// children: { id: { wasm, spec, typeIndex } } the library modules the script may import (compiler/child.mjs).
export const compile = (source, options = {}) => compileScript(asc, source, { lib, mergeTool, ...options });
/// Runs a patch script (layer 1) and builds the cell it describes: { ok, problems, nodes, cables, interface }.
/// types: the board's module types; options: { cellId, parent, x, y, generatedBy } for materialize.
export async function patch(source, settings, types, options) {
  const r = await runPatchScript(source, settings);
  if (!r.ok) return { ok: false, problems: r.problems };
  const m = materialize(r.spec, types, options);
  return { ok: m.ok, problems: m.problems, nodes: m.nodes, cables: m.cables, interface: { kind: "patch", name: r.spec.name, description: r.spec.description, settings: r.spec.settings, summary: m.summary } };
}

/// Starting points for the editor: [{ id, name, source }].
export const examples = [{ id: "gains", name: "Gains (mixer channel)", source: gains }, { id: "synth-voice", name: "Synth voice (library tour)", source: synthVoice }, ...EXAMPLES];
export const version = "0.1";
