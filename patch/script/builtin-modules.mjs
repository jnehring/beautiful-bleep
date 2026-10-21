// SPDX-License-Identifier: GPL-3.0-or-later
// The script modules that ship with the board, listed in builtin-modules.txt: compiled with their UI and help page into dist/script-modules.json, which
// the page loads next to the board (patch/web/js/user-modules.js). Each is offered in the Add menu with its own UI and help; "Convert to code" opens
// its source. Run by bundle.mjs (npm run bundle).
//   node builtin-modules.mjs [outfile]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";
import { compileScript } from "./compiler/compile.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const PUBLISHER = "vintage";
const MANUALS = `${root}../../website/content/developers/bleep-script/vintage-modules/`;

/// A module's manual as its help page: without the front matter and the picture line under the title.
const helpPage = (md) => md.replace(/^---[\s\S]*?---\s*/, "").replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "").trim() + "\n";

export async function buildBuiltin() {
  const lib = Object.fromEntries(readdirSync(`${root}src/bleep`).filter((f) => f.endsWith(".ts")).map((f) => [`src/bleep/${f}`, readFileSync(`${root}src/bleep/${f}`, "utf8")]));
  const names = readFileSync(`${root}builtin-modules.txt`, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const out = [];
  for (const name of names) {
    const source = readFileSync(`${root}src/${name}.dsp.ts`, "utf8");
    const view = (() => { try { return readFileSync(`${root}src/${name}.view.js`, "utf8"); } catch (e) { return ""; } })();
    const help = (() => { try { return helpPage(readFileSync(`${MANUALS}${name}.md`, "utf8")); } catch (e) { return ""; } })();
    const type = `${PUBLISHER}/${name}`;
    const r = await compileScript(asc, source, { lib, typeId: type });
    if (!r.wasm || !r.specs.length) throw new Error(`${name}: ${r.problems.filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`);
    const spec = r.specs[0];
    out.push({
      slug: `${PUBLISHER}.${name}`, type, publisher: PUBLISHER, name: spec.name, category: spec.category || "Utility/Script", source, view, help, settings: {},
      meta: { publisher: PUBLISHER, name: spec.name, version: "1.0.0", summary: spec.description || "", category: spec.category || "", license: "GPL-3.0-or-later", tags: "", homepage: "", notes: "" },
      spec: r.specs, wasm: Buffer.from(r.wasm).toString("base64"),
    });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || `${root}dist/script-modules.json`;
  mkdirSync(dirname(file), { recursive: true });
  const list = await buildBuiltin();
  writeFileSync(file, JSON.stringify(list));
  console.log(`${file}: ${list.length} modules, ${(JSON.stringify(list).length / 1024).toFixed(0)} KB`);
}
