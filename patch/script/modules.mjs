// SPDX-License-Identifier: GPL-3.0-or-later
// The script modules in patch/modules/: a folder whose module.json says "language": "bleep-script" holds <slug>.dsp.ts (the module), <slug>.view.js
// (its own UI, optional), doc/<slug>.md and module.json, like any module. This finds them and compiles one to a .wasm, the same way for the
// board's build (patch/web/build_modules.py), the tests and npm run build.
//   import { scriptModules, buildModule } from "./modules.mjs";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";
import { compileScript } from "./compiler/compile.mjs";

export const root = fileURLToPath(new URL(".", import.meta.url));
export const MODULES = `${root}../modules/`;

/// [{ slug, dir, source, view, doc, meta }]: view and doc are paths or null.
export function scriptModules() {
  const out = [];
  for (const slug of readdirSync(MODULES).sort()) {
    const json = `${MODULES}${slug}/module.json`;
    if (!existsSync(json)) continue;
    let meta;
    try { meta = JSON.parse(readFileSync(json, "utf8")); } catch (e) { continue; }
    if (meta.language !== "bleep-script") continue;
    const dir = `${MODULES}${slug}/`, file = (name) => (existsSync(`${dir}${name}`) ? `${dir}${name}` : null);
    out.push({ slug, dir, meta, source: file(`${slug}.dsp.ts`), view: file(`${slug}.view.js`), doc: file(`doc/${slug}.md`) });
  }
  return out;
}

const libSources = () => Object.fromEntries(readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => [`src/bleep/${f}`, readFileSync(`${root}src/bleep/${f}`, "utf8")]));

/// Compiles the module in folder `dir` (a scriptModules() entry's dir) with the node type id `typeId` (default: its slug).
/// Resolves to { wasm, specs, problems } (wasm is null when there is an error).
export async function buildModule(m, typeId) {
  if (!m.source) throw new Error(`${m.slug}: no ${m.slug}.dsp.ts`);
  const r = await compileScript(asc, readFileSync(m.source, "utf8"), { lib: libSources(), typeId: typeId || m.slug });
  return { wasm: r.wasm, specs: r.specs, problems: r.problems };
}

/// The files the tools read per module: what a cache of a build depends on.
export function moduleFiles(m) {
  const lib = readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => `${root}src/bleep/${f}`);
  return [m.source, ...lib, `${root}transform/bleep.mjs`, `${root}transform/subset.mjs`, `${root}compiler/compile.mjs`].filter(Boolean);
}
