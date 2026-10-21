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
import preamp from "../src/preamp.dsp.ts";
import valveStage from "../src/valve-stage.dsp.ts";
import channelStrip from "../src/channel-strip.dsp.ts";
import toneEq from "../src/tone-eq.dsp.ts";
import optoCompressor from "../src/opto-compressor.dsp.ts";
import micColour from "../src/mic-colour.dsp.ts";
import tapeMachine from "../src/tape-machine.dsp.ts";
import vinyl from "../src/vinyl.dsp.ts";
import cheapSpeaker from "../src/cheap-speaker.dsp.ts";
import preampView from "../src/preamp.view.js";
import valveStageView from "../src/valve-stage.view.js";
import channelStripView from "../src/channel-strip.view.js";
import toneEqView from "../src/tone-eq.view.js";
import optoCompressorView from "../src/opto-compressor.view.js";
import micColourView from "../src/mic-colour.view.js";
import tapeMachineView from "../src/tape-machine.view.js";
import vinylView from "../src/vinyl.view.js";
import cheapSpeakerView from "../src/cheap-speaker.view.js";
import preampHelp from "../../../website/content/developers/bleep-script/vintage-modules/preamp.md";
import valveStageHelp from "../../../website/content/developers/bleep-script/vintage-modules/valve-stage.md";
import channelStripHelp from "../../../website/content/developers/bleep-script/vintage-modules/channel-strip.md";
import toneEqHelp from "../../../website/content/developers/bleep-script/vintage-modules/tone-eq.md";
import optoCompressorHelp from "../../../website/content/developers/bleep-script/vintage-modules/opto-compressor.md";
import micColourHelp from "../../../website/content/developers/bleep-script/vintage-modules/mic-colour.md";
import tapeMachineHelp from "../../../website/content/developers/bleep-script/vintage-modules/tape-machine.md";
import vinylHelp from "../../../website/content/developers/bleep-script/vintage-modules/vinyl.md";
import cheapSpeakerHelp from "../../../website/content/developers/bleep-script/vintage-modules/cheap-speaker.md";
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


/// A module's manual (website/content/developers/bleep-script/vintage-modules/<name>.md) as its help page: without the front matter and the first
/// heading's picture line.
const helpPage = (md) => md.replace(/^---[\s\S]*?---\s*/, "").replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "").trim() + "\n";

/// Starting points for the editor: [{ id, name, source }].
export const examples = [{ id: "gains", name: "Gains (mixer channel)", source: gains }, { id: "synth-voice", name: "Synth voice (library tour)", source: synthVoice }, { id: "preamp", name: "Preamp (transformer-coupled)", source: preamp, view: preampView, help: helpPage(preampHelp) }, { id: "valve-stage", name: "Valve Stage (tube preamp)", source: valveStage, view: valveStageView, help: helpPage(valveStageHelp) }, { id: "channel-strip", name: "Channel Strip (EQ and drive)", source: channelStrip, view: channelStripView, help: helpPage(channelStripHelp) }, { id: "tone-eq", name: "Tone EQ (passive shelves)", source: toneEq, view: toneEqView, help: helpPage(toneEqHelp) }, { id: "opto-compressor", name: "Opto Compressor (leveling)", source: optoCompressor, view: optoCompressorView, help: helpPage(optoCompressorHelp) }, { id: "mic-colour", name: "Mic Colour", source: micColour, view: micColourView, help: helpPage(micColourHelp) }, { id: "tape-machine", name: "Tape Machine", source: tapeMachine, view: tapeMachineView, help: helpPage(tapeMachineHelp) }, { id: "vinyl", name: "Vinyl", source: vinyl, view: vinylView, help: helpPage(vinylHelp) }, { id: "cheap-speaker", name: "Cheap Speaker (lo-fi)", source: cheapSpeaker, view: cheapSpeakerView, help: helpPage(cheapSpeakerHelp) }, ...EXAMPLES];
export const version = "0.1";
