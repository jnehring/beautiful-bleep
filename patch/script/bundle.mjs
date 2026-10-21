// SPDX-License-Identifier: GPL-3.0-or-later
// Bundles the compiler and the editor for the browser: node bundle.mjs -> dist/bleep-script-compiler.js and dist/bleep-script-editor.js (an ES module, about 10 MB: Binaryen is most of it).
// The board loads it on first use; build-web.sh copies it next to the board when it exists.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
mkdirSync(`${root}dist`, { recursive: true });
// assemblyscript.js compiles a small embedded wasm (a pow helper) with instantiateStreaming(fetch("data:...")). A page or worker whose
// content-security-policy has no `data:` in connect-src cannot do that: decode the bytes instead, with the same result.
const noDataFetch = {
  name: "no-data-fetch",
  setup(b) {
    b.onLoad({ filter: /assemblyscript[\\/]dist[\\/]assemblyscript\.js$/ }, (args) => {
      const pattern = /WebAssembly\.instantiateStreaming\(fetch\((\w+)\)\)/;
      const text = readFileSync(args.path, "utf8");
      if (!pattern.test(text)) throw new Error("bundle.mjs: the data: URL fetch in assemblyscript.js is no longer there; check the new version and drop this plugin if it is");
      return { contents: text.replace(pattern, (_, u) => `WebAssembly.instantiate(Uint8Array.from(atob(${u}.slice(${u}.indexOf(",") + 1)), (c) => c.charCodeAt(0)))`), loader: "js" };
    });
  },
};

// wasm-merge (a node script of the binaryen package) as an ES module that exports it as a function: wrapped here so the page evaluates nothing
const mergeTool = {
  name: "merge-tool",
  setup(b) {
    b.onResolve({ filter: /^wasm-merge-tool$/ }, () => ({ path: "wasm-merge-tool", namespace: "merge-tool" }));
    b.onLoad({ filter: /.*/, namespace: "merge-tool" }, () => {
      const source = readFileSync(`${root}node_modules/binaryen/bin/wasm-merge`, "utf8").replace(/^#!.*\n/, "");
      return { contents: `export default function (require, process, module, __filename, __dirname, globalThis, Module) {\n${source}\n}`, loader: "js" };
    });
  },
};
await build({
  plugins: [mergeTool],
  entryPoints: [`${root}compiler/merge-entry.mjs`],
  outfile: `${root}dist/bleep-script-merge.js`,
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: false, legalComments: "none", logLevel: "warning",
});
console.log(`dist/bleep-script-merge.js: ${(statSync(`${root}dist/bleep-script-merge.js`).size / 1048576).toFixed(1)} MB`);

// the editor (CodeMirror), a bundle of its own: the page loads it when a Code node is opened
await build({
  entryPoints: [`${root}editor/editor-entry.mjs`],
  outfile: `${root}dist/bleep-script-editor.js`,
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none", logLevel: "warning",
});
console.log(`dist/bleep-script-editor.js: ${(statSync(`${root}dist/bleep-script-editor.js`).size / 1024).toFixed(0)} KB`);

await build({
  plugins: [noDataFetch],
  entryPoints: [`${root}compiler/bundle-entry.mjs`],
  outfile: `${root}dist/bleep-script-compiler.js`,
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none",
  external: ["fs", "module", "path", "url", "node:*"],   // asc and Binaryen import these only when they run under node
  loader: { ".ts": "text" },   // src/bleep/*.ts are imported as text: they are the library sources the compiler reads
  logLevel: "warning",
});
console.log(`dist/bleep-script-compiler.js: ${(statSync(`${root}dist/bleep-script-compiler.js`).size / 1048576).toFixed(1)} MB`);

// the script modules that ship with the board: compiled, with their UI and help page, next to the bundles (builtin-modules.txt)
{
  const { buildBuiltin } = await import("./builtin-modules.mjs");
  const list = await buildBuiltin();
  writeFileSync(`${root}dist/script-modules.json`, JSON.stringify(list));
  console.log(`dist/script-modules.json: ${list.length} modules, ${(statSync(`${root}dist/script-modules.json`).size / 1024).toFixed(0)} KB`);
}
