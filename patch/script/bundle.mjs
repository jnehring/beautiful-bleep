// SPDX-License-Identifier: GPL-3.0-or-later
// Bundles the compiler for the browser: node bundle.mjs -> dist/bleep-script-compiler.js (an ES module, about 10 MB: Binaryen is most of it).
// The board loads it on first use; build-web.sh copies it next to the board when it exists.
import { mkdirSync, readFileSync, statSync } from "node:fs";
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
