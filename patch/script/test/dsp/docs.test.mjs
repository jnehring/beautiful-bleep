// SPDX-License-Identifier: GPL-3.0-or-later
// Every name the library exports is listed in website/content/developers/bleep-script/library.md, and the doc's code samples compile.   node test/dsp/docs.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import asc from "assemblyscript/asc";
import { compileScript } from "../../compiler/compile.mjs";
import { root, check, finish } from "./lib.mjs";

const doc = readFileSync(`${root}../../website/content/developers/bleep-script/library.md`, "utf8");
const tutorial = readFileSync(`${root}../../website/content/developers/bleep-script/tutorials/synth-voice.md`, "utf8");

// names that are plumbing, not API: the constants and helpers the doc folds into their class's row
const SKIP = new Set(["ENV_IDLE", "ENV_ATTACK", "ENV_DECAY", "ENV_SUSTAIN", "ENV_RELEASE", "LFO_SINE", "LFO_TRIANGLE", "LFO_SAW", "LFO_SQUARE", "LFO_SAMPLE_HOLD", "LFO_SAW_DOWN", "NOTE_PRESSURE", "NOTE_CC", "NOTE_PROGRAM", "NOTE_BEND", "NOTE_CHANNEL_PRESSURE", "NOTE_SYSTEM"]);
let count = 0;
for (const file of readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).sort()) {
  const module = file.replace(/\.ts$/, "");
  if (["abi", "format"].includes(module)) continue;   // internal
  const source = readFileSync(`${root}src/bleep/${file}`, "utf8");
  const names = [...source.matchAll(/^export (?:class|function|const) (\w+)/gm)].map((m) => m[1]);
  check(doc.includes(`## bleep/${module}`), `library.md has a section for bleep/${module}`);
  const missing = names.filter((n) => !SKIP.has(n) && !new RegExp(`\`${n}[\`(,]`).test(doc) && !new RegExp(`\`[^\`]*\\b${n}\\b[^\`]*\``).test(doc));
  count += names.length;
  check(missing.length === 0, `library.md lists every export of bleep/${module}`, missing.join(", "));
}
for (const name of ["setHighpass", "setBandpass", "setNotch", "setAllpass"]) check(doc.includes(`\`${name}(sr, f, q)\``), `library.md documents Biquad.${name}`);
check(/## What the library does not have \(yet\)/.test(doc), "library.md has the 'does not have (yet)' section");
check(!/\bwas not|\bnot yet written\b/i.test(doc), "library.md has no leftover placeholders");
check(doc.includes("tutorials/synth-voice.md") && /order: 80/.test(tutorial), "the tutorial exists and is linked from the library page");
console.log(`(${count} exports checked)`);

// every complete module in the docs' code samples compiles (fragments, which have no @module, are skipped)
const lib = Object.fromEntries(readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => [`src/bleep/${f}`, readFileSync(`${root}src/bleep/${f}`, "utf8")]));
for (const [name, text] of [["library.md", doc], ["tutorials/synth-voice.md", tutorial]]) {
  const blocks = [...text.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes("@module"));
  for (const [i, block] of blocks.entries()) {
    const r = await compileScript(asc, block, { lib });
    check(!!r.wasm && !r.problems.some((p) => p.severity === "error"), `${name}: module sample ${i + 1} compiles`, r.problems.map((p) => `${p.line}: ${p.message}`).join("; "));
  }
  check(blocks.length > 0, `${name} has a complete module sample`);
}
finish();
