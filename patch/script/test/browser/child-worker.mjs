// SPDX-License-Identifier: GPL-3.0-or-later
// A Worker that does what the board's compile Worker does for a script with a child module: loads the bundle, compiles, links, runs the result.
let compile;
try { ({ compile } = await import("../../dist/bleep-script-compiler.js")); } catch (err) { self.postMessage({ ok: false, error: "import: " + String(err && err.stack || err) }); }
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
self.onmessage = async (e) => {
  try {
    const { source } = e.data;
    const spec = (await (await fetch("../../build/gains.spec.json")).json())[0];
    const t = performance.now();
    const r = await compile(source, { children: { gains: { wasm: await bytes("../../build/gains.wasm"), spec } } });
    const ms = Math.round(performance.now() - t);
    let out = null;
    if (r.wasm) {
      const m = await WebAssembly.compile(r.wasm);
      const inst = new WebAssembly.Instance(m, {});
      out = { imports: WebAssembly.Module.imports(m).length, memories: WebAssembly.Module.exports(m).filter((x) => x.kind === "memory").length, bytes: r.wasm.length };
    }
    self.postMessage({ ok: !!r.wasm, linked: r.linked, problems: r.problems, ms, out, node: typeof process });
  } catch (err) { self.postMessage({ ok: false, error: String(err && err.stack || err) }); }
};
self.postMessage({ ready: true });
