// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// bleepmod.js (the package of a community module, built in the browser) against the library's own checks (website/api/app/community.py):
// the zip must open in Python's zipfile with good CRCs and pass `community.inspect`. Needs python3 with the library's dependencies.
//
//   node patch/web/test/bleepmod-test.mjs      (run `node build.mjs` in patch/script first: it uses build/preamp.wasm and its spec)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), ROOT = join(here, "..", "..", "..");
const Mod = createRequire(import.meta.url)(join(here, "..", "js", "bleepmod.js"));
const results = [];
const test = async (name, fn) => { try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
const py = (code, ...args) => execFileSync("python3", ["-c", code, ...args], { encoding: "utf8", cwd: join(ROOT, "website", "api") });

await test("crc32 matches the standard check value", () => {
  assert.equal(Mod.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

await test("zip: Python reads it back with good CRCs, names and bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bleepmod-"));
  const bytes = Mod.zip([{ name: "a.txt", data: "hello" }, { name: "doc/ünï.md", data: new Uint8Array([1, 2, 3, 255]) }, { name: "empty", data: "" }]);
  writeFileSync(join(dir, "t.zip"), bytes);
  const out = py("import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'bad': z.testzip(), 'names': z.namelist(), 'a': z.read('a.txt').decode(), 'b': list(z.read('doc/ünï.md')), 'e': len(z.read('empty'))}))", join(dir, "t.zip"));
  const r = JSON.parse(out);
  assert.equal(r.bad, null);
  assert.deepEqual(r.names, ["a.txt", "doc/ünï.md", "empty"]);
  assert.equal(r.a, "hello");
  assert.deepEqual(r.b, [1, 2, 3, 255]);
  assert.equal(r.e, 0);
});

const wasmFile = join(ROOT, "patch", "script", "build", "preamp.wasm"), specFile = join(ROOT, "patch", "script", "build", "preamp.spec.json");
if (existsSync(wasmFile) && existsSync(specFile)) {
  await test("build: the library's own checks accept the package, and the module.json says what the author said", () => {
    const spec = JSON.parse(readFileSync(specFile, "utf8")).map((t) => ({ ...t, type: "zed/preamp" }));
    const bytes = Mod.build({ handle: "zed", slug: "preamp", version: "1.2.3", title: "Preamp", summary: "x".repeat(400), category: "Effects/Distortion", license: "MIT",
      spec, wasm: readFileSync(wasmFile), help: "# Preamp\n\nHelp." });
    const dir = mkdtempSync(join(tmpdir(), "bleepmod-"));
    writeFileSync(join(dir, "p.bleepmod"), bytes);
    const out = py("import sys,json; from app import community; files, meta = community.inspect(open(sys.argv[1],'rb').read()); print(json.dumps({'files': sorted(files), 'meta': meta}))", join(dir, "p.bleepmod"));
    const r = JSON.parse(out);
    assert.deepEqual(r.files, ["doc/preamp.md", "module.json", "module.wasm", "spec.json"]);
    assert.deepEqual(r.meta.types, ["zed/preamp"]);
    assert.equal(r.meta.requires.engineAbi, 1);
    assert.equal(r.meta.summary.length, 280, "the summary is cut to what the library accepts");
    assert.equal(r.meta.category, "Effects/Distortion");
  });
  await test("build: no help page, no doc file", () => {
    const spec = JSON.parse(readFileSync(specFile, "utf8"));
    const bytes = Mod.build({ handle: "zed", slug: "preamp", version: "1.0.0", title: "Preamp", spec, wasm: readFileSync(wasmFile), help: "  \n" });
    const dir = mkdtempSync(join(tmpdir(), "bleepmod-"));
    writeFileSync(join(dir, "p.bleepmod"), bytes);
    assert.deepEqual(JSON.parse(py("import sys,json; from app import community; print(json.dumps(sorted(community.inspect(open(sys.argv[1],'rb').read())[0])))", join(dir, "p.bleepmod"))), ["module.json", "module.wasm", "spec.json"]);
  });
}

await test("upload: the library's answer becomes a result, and a refusal says why", async () => {
  const say = (status, body) => async (url, init) => { say.last = { url, init }; return { ok: status < 300, status, json: async () => body }; };
  const ok = await Mod.upload(new Uint8Array([1]), "zed.x", "1.0.0", say(201, { id: "zed/x", version: "1.0.0" }));
  assert.deepEqual(ok, { ok: true, id: "zed/x", version: "1.0.0" });
  assert.equal(say.last.url, "/api/registry/community/modules/zed.x/1.0.0");
  assert.equal(say.last.init.method, "PUT");
  assert.equal(say.last.init.credentials, "same-origin");
  assert.match((await Mod.upload(new Uint8Array(), "x", "1.0.0", say(409, { detail: "The version must be higher" }))).error, /higher/);
  assert.match((await Mod.upload(new Uint8Array(), "x", "1.0.0", say(401, {}))).error, /not logged in/);
  assert.match((await Mod.upload(new Uint8Array(), "x", "1.0.0", async () => { throw new TypeError("offline"); })).error, /cannot be reached/);
});

let failed = 0;
for (const [name, err] of results) { console.log(`${err ? "FAIL" : "ok  "} ${name}${err ? "\n  " + err.message : ""}`); if (err) failed++; }
console.log(failed ? `${failed} failed` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
