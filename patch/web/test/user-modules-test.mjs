// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// user-modules.js (the modules saved from a Code node) and how library-client.js lists and loads them.
//
//   node patch/web/test/user-modules-test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Users = require(join(here, "..", "js", "user-modules.js"));
globalThis.BleepUserModules = Users;   // library-client.js looks for it on the global object
const Library = require(join(here, "..", "js", "library-client.js"));

const results = [];
const test = async (name, fn) => { try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
const wasm = (n) => Uint8Array.from({ length: n }, (_, i) => i).buffer;
const entry = (slug, name = slug) => ({ slug: "mine." + slug, type: "mine/" + slug, publisher: "mine", name, category: "Effects/Distortion", source: "// " + name, view: "", help: "", meta: {}, settings: {}, spec: [{ type: "mine/" + slug, name, category: "Effects/Distortion" }], wasm: wasm(8) });

await test("slugs and type ids: a name makes a plain slug, the type is <publisher>/<slug>, the key <publisher>.<slug>", () => {
  assert.equal(Users.slugOf("Tape Machine"), "tape-machine");
  assert.equal(Users.slugOf("  Opto — Compressor!! "), "opto-compressor");
  assert.equal(Users.slugOf("***"), "");
  assert.equal(Users.typeId("zed", "tape-machine"), "zed/tape-machine");
  assert.equal(Users.keyOf("zed", "tape-machine"), "zed.tape-machine");
  assert.equal(Users.typeId("", "x"), "mine/x", "no publisher: the local one");
});

await test("the store: put, get, replace, remove, listeners (in memory where there is no IndexedDB)", async () => {
  await Users.load();
  assert.equal(Users.persistent(), false);
  let calls = 0;
  Users.onChange(() => { calls++; });
  await Users.put(entry("a", "A"));
  await Users.put(entry("b", "B"));
  assert.deepEqual(Users.list().map((e) => e.slug), ["mine.a", "mine.b"]);
  await Users.put({ ...entry("a", "A again"), wasm: wasm(16) });
  assert.equal(Users.get("mine.a").name, "A again");
  assert.equal(Users.get("mine.a").wasm.byteLength, 16);
  assert.equal(Users.list().length, 2);
  await Users.remove("mine.b");
  assert.equal(Users.get("mine.b"), undefined);
  assert.equal(calls, 4);
  assert.equal(Users.version(), 4);
  assert.deepEqual(Object.keys(Users.index()), ["mine.a"]);
  assert.deepEqual(Users.index()["mine.a"].types, ["mine/a"]);
});

await test("the library client lists the user's modules with their spec, without a library or a setting", async () => {
  Library.configure({ base: "/registry/v1/", roots: [], localBase: "", allowUnsigned: {} });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("offline"); };   // no library at all
  try {
    const m = await Library.manifest();
    assert.equal(m.types["mine/a"], "mine.a");
    assert.equal(m.modules["mine.a"].version, "user");
    assert.equal(m.modules["mine.a"].spec[0].type, "mine/a");
    const pkg = await Library.fetchModule("mine.a");
    assert.equal(pkg.status, "unsigned");
    assert.equal(pkg.local, true);
    assert.equal(pkg.wasm.byteLength, 16);
    assert.equal(pkg.spec[0].name, "A again");
    pkg.wasm.slice(0);   // a copy: the stored bytes stay as they were
    const again = await Library.fetchModule("mine.a");
    assert.notEqual(again.wasm, Users.get("mine.a").wasm);
  } finally { globalThis.fetch = realFetch; }
});

await test("a removed or replaced module: forget() drops the cached package, a removed one is gone", async () => {
  await Users.put({ ...entry("a", "A third"), wasm: wasm(4) });
  Library.forget("mine.a");
  assert.equal((await Library.fetchModule("mine.a")).wasm.byteLength, 4);
  await Users.remove("mine.a");
  Library.forget("mine.a");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  try { await assert.rejects(Library.manifest(), /offline/); } finally { globalThis.fetch = realFetch; }   // nothing left to run offline
});

await test("built-in modules come from script-modules.json, the user's own of the same key win, and a missing file is no harm", async () => {
  const path = join(here, "..", "js", "user-modules.js");
  const fresh = () => { delete require.cache[require.resolve(path)]; return require(path); };
  const list = [{ slug: "vintage.preamp", type: "vintage/preamp", publisher: "vintage", name: "Preamp", category: "Effects/Distortion", source: "// s", view: "v", help: "h", meta: {}, settings: {},
    spec: [{ type: "vintage/preamp", name: "Preamp" }], wasm: Buffer.from([0, 97, 115, 109]).toString("base64") }];
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => list });
    const U2 = fresh();
    const entries = await U2.load();
    const e = entries.get("vintage.preamp");
    assert.equal(e.builtin, true);
    assert.deepEqual([...new Uint8Array(e.wasm)], [0, 97, 115, 109], "the bytes are decoded from base64");
    assert.deepEqual(Object.keys(U2.index()), ["vintage.preamp"]);
    await U2.put({ ...e, name: "My Preamp", builtin: undefined });   // an edited copy of the same key replaces it
    assert.equal(U2.get("vintage.preamp").name, "My Preamp");
    assert.equal(U2.get("vintage.preamp").builtin, undefined);
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.equal((await fresh().load()).size, 0, "no file, no built-in modules");
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    assert.equal((await fresh().load()).size, 0, "offline: the same");
  } finally { globalThis.fetch = realFetch; fresh(); }
});

let failed = 0;
for (const [name, err] of results) { console.log(`${err ? "FAIL" : "ok  "} ${name}${err ? "\n  " + err.message : ""}`); if (err) failed++; }
console.log(failed ? `${failed} failed` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
