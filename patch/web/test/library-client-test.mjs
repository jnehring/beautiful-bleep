// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// library-client.js: the package reader, the download path through the index and the entry, and the local development build.
// The shared fixtures (patch/tests/library-fixtures) get the same verdicts as in patch/tests/library_test.cpp.
//
//   node patch/web/test/library-client-test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const require = createRequire(import.meta.url);
const Library = require(join(here, "..", "js", "library-client.js"));
const BleepMod = require(join(here, "..", "js", "bleepmod.js"));
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const sha256 = async (u8) => Library.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", u8)));

/** A package with these files (BleepMod.zip: every file stored). */
const makeZip = (files) => BleepMod.zip(Object.entries(files).map(([name, data]) => ({ name, data })));
const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
const files = { "module.json": '{"name":"Verb","types":["reverb"],"requires":{"engineAbi":1}}\n', "module.wasm": wasm, "spec.json": '[{"type":"reverb","name":"Verb"}]\n', "ui/reverb.js": "// view\n" };

/** Serves an index, one entry and its package at http://library/registry/v1/ for the duration of `fn`. */
async function withLibrary(served, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = served[url];
    if (body === undefined) return new Response("no", { status: 404 });
    return new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
  };
  try { await fn(); } finally { globalThis.fetch = realFetch; Library.configure({ base: "/registry/v1/", channel: "stable", localBase: "local-modules/", hostname: null }); }
}
const base = "http://library/registry/v1/";
const indexOf = (slug, version, types) => ({ format: 1, channels: { stable: { modules: { [slug]: { version, entry: `modules/${slug}/${version}/entry.json`, types } } } } });
const entryOf = async (slug, version, pkg, extra = {}) => ({ id: slug, version, files: [{ path: `${slug}-${version}.bleepmod`, sha256: await sha256(pkg), bytes: pkg.length, platform: "any", ...extra }] });

// ---- the tests ------------------------------------------------------------------------------------

await test("the shared fixtures: every package is read or refused as in C++ (patch/tests/library-fixtures)", async () => {
  const dir = join(ROOT, "patch", "tests", "library-fixtures");
  const spec = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  assert.ok(spec.cases.length >= 6);
  for (const c of spec.cases) {
    let got, zip;
    try { zip = await Library.readZip(new Uint8Array(readFileSync(join(dir, c.file)))); got = "ok"; } catch (e) { got = "refused"; }
    if (got === "ok") {
      assert.ok(!zip.files.has("META/signature.json"), c.name + ": a signature of an older package is left out");
      if ("communityFiles" in c) assert.equal(Library.communityFilesOk(zip.files.keys()) === "", c.communityFiles, c.name);
    }
    assert.equal(got, c.expect, c.name);
  }
});

await test("the zip reader refuses duplicates and anything that is not a zip, and reads what BleepMod writes", async () => {
  const dup = BleepMod.zip([{ name: "a", data: "1" }, { name: "a", data: "2" }]);
  await assert.rejects(Library.readZip(dup), /duplicate/);
  await assert.rejects(Library.readZip(new Uint8Array([1, 2, 3])), /not a zip/);
  const z = await Library.readZip(makeZip(files));
  assert.deepEqual([...z.files.keys()].sort(), Object.keys(files).sort());
  assert.deepEqual([...z.files.get("module.wasm")], [...wasm]);
});

await test("fetchModule: the whole path through the index, the entry and the package", async () => {
  const pkg = makeZip(files);
  const served = {
    [base + "index.json"]: indexOf("reverb", "1.0.0", ["reverb"]),
    [base + "modules/reverb/1.0.0/entry.json"]: await entryOf("reverb", "1.0.0", pkg),
    [base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"]: pkg,
  };
  await withLibrary(served, async () => {
    Library.configure({ base });
    const m = await Library.manifest();
    assert.deepEqual(m.types, { reverb: "reverb" });
    const got = await Library.fetchModule("reverb");
    assert.deepEqual([...new Uint8Array(got.wasm)], [...wasm]);
    assert.equal(got.version, "1.0.0");
    assert.equal(got.community, false);
    assert.equal(got.meta.name, "Verb");
    assert.deepEqual(got.spec, [{ type: "reverb", name: "Verb" }]);  // the node types, for the board's Add-module list
    // a download that is not the file the entry lists
    served[base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"] = new Uint8Array([...pkg.slice(0, -1), pkg[pkg.length - 1] ^ 1]);
    Library.configure({});  // forgets the copy
    await assert.rejects(Library.fetchModule("reverb"), /not the file the library lists/);
    await assert.rejects(Library.fetchModule("nothing"), /no module nothing/);
  });
});

await test("fetchModule: a package an account uploaded may not bring page scripts", async () => {
  const clean = makeZip({ "module.json": files["module.json"], "module.wasm": wasm, "view.sandbox.js": "// picture\n", "doc/reverb.md": "# Verb\n" });
  const served = {
    [base + "index.json"]: { format: 1, channels: { stable: { modules: { "acme.clean": { version: "1.0.0", entry: "modules/acme.clean/1.0.0/entry.json", types: ["acme/clean"] },
                                                                          "acme.scripts": { version: "1.0.0", entry: "modules/acme.scripts/1.0.0/entry.json", types: ["acme/scripts"] },
                                                                          "bleep.scripts": { version: "1.0.0", entry: "modules/bleep.scripts/1.0.0/entry.json", types: ["bleep/scripts"] } } } } },
  };
  const scripted = makeZip(files);
  for (const [slug, pkg, extra] of [["acme.clean", clean, { uploaded: true }], ["acme.scripts", scripted, { uploaded: true }], ["bleep.scripts", scripted, {}]]) {
    served[`${base}modules/${slug}/1.0.0/entry.json`] = await entryOf(slug, "1.0.0", pkg, extra);
    served[`${base}modules/${slug}/1.0.0/${slug}-1.0.0.bleepmod`] = pkg;
  }
  await withLibrary(served, async () => {
    Library.configure({ base });
    const got = await Library.fetchModule("acme.clean");
    assert.equal(got.community, true);
    assert.equal(got.view, "// picture\n");
    assert.equal(got.help, "# Verb\n");
    await assert.rejects(Library.fetchModule("acme.scripts"), /ui\/reverb\.js is not allowed in a community module/);
    assert.equal((await Library.fetchModule("bleep.scripts")).community, false, "one that no account uploaded keeps its scripts");
  });
});

await test("an account with dev access reads the dev index, and its files, from the API; everyone else the public index", async () => {
  const devBase = "http://library/api/registry/dev/v1/";
  const pkg = makeZip(files);
  const v = "0.2.0-dev.202610301200";
  const served = {
    [base + "index.json"]: { format: 1, channels: { stable: { modules: {} } } },   // only development builds so far
    [devBase + "index.json"]: { format: 1, channels: { dev: { modules: { reverb: { version: v, entry: `modules/reverb/${v}/entry.json`, types: ["reverb"] } } } } },
    [devBase + `modules/reverb/${v}/entry.json`]: await entryOf("reverb", v, pkg),
    [devBase + `modules/reverb/${v}/reverb-${v}.bleepmod`]: pkg,
  };
  await withLibrary(served, async () => {
    Library.configure({ base, devBase, devAccess: async () => false });
    assert.deepEqual((await Library.manifest()).types, {}, "no dev access: the public index");
    Library.configure({ devAccess: async () => true });
    assert.deepEqual((await Library.manifest()).types, { reverb: "reverb" });
    assert.equal((await Library.fetchModule("reverb")).version, v);
    assert.equal((await Library.fetchModule("reverb", v)).version, v, "a board may pin a development build");
    Library.configure({ devAccess: async () => { throw new Error("offline"); } });
    assert.deepEqual((await Library.manifest()).types, {}, "no answer about the account: the public index");
    delete served[devBase + "index.json"];
    Library.configure({ devAccess: async () => true });
    assert.deepEqual((await Library.manifest()).types, {}, "the dev index refused: the public index");
  });
  Library.configure({ devAccess: null, devBase: "/api/registry/dev/v1/" });
});

await test("fetchModule(slug, version): an older version is fetched from its own entry, next to the newest", async () => {
  const old = makeZip(files);
  const fresh = makeZip({ ...files, "spec.json": '[{"type":"reverb","name":"Verb 2"}]\n' });
  const served = {
    [base + "index.json"]: indexOf("reverb", "2.0.0", ["reverb"]),   // the index lists the newest only
    [base + "modules/reverb/2.0.0/entry.json"]: await entryOf("reverb", "2.0.0", fresh),
    [base + "modules/reverb/2.0.0/reverb-2.0.0.bleepmod"]: fresh,
    [base + "modules/reverb/1.0.0/entry.json"]: await entryOf("reverb", "1.0.0", old),
    [base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"]: old,
  };
  const asked = [];
  const wrapped = new Proxy(served, { get: (t, k) => { asked.push(k); return t[k]; } });
  await withLibrary(wrapped, async () => {
    Library.configure({ base });
    const latest = await Library.fetchModule("reverb");
    const older = await Library.fetchModule("reverb", "1.0.0");
    assert.equal([latest.version, older.version].join(), "2.0.0,1.0.0");
    assert.equal(older.spec[0].name, "Verb");
    assert.equal(latest.spec[0].name, "Verb 2");
    assert.equal(await Library.fetchModule("reverb", "2.0.0"), latest, "the newest asked for by its number is the same download");
    assert.equal(await Library.fetchModule("reverb", "1.0.0"), older, "kept after the first fetch");
    await assert.rejects(Library.fetchModule("reverb", "9.9.9"), /404|9\.9\.9/);   // never published
    await assert.rejects(Library.fetchModule("reverb", "../2.0.0"), /not a version/);
    assert.ok(!asked.some((u) => String(u).includes("..")), "a version never reaches the address as a path");
    // an entry that is for another version than the one asked for
    served[base + "modules/reverb/3.0.0/entry.json"] = served[base + "modules/reverb/1.0.0/entry.json"];
    await assert.rejects(Library.fetchModule("reverb", "3.0.0"), /entry for 3\.0\.0 is for 1\.0\.0/);
  });
});

await test("the client's file rule for a community module: the sandboxed picture is allowed, page scripts are not", () => {
  const ok = (names) => Library.communityFilesOk(names) === "";
  assert.ok(ok(["module.json", "module.wasm", "spec.json", "doc/x.md", "view.sandbox.js", "source.dsp.ts", "image.png", "image.jpg", "image.webp"]));
  for (const bad of ["ui/x.js", "view.js", "ui/view.sandbox.js", "x/view.sandbox.js", "view.sandbox.js.html", "source.ts", "src/source.dsp.ts", "image.gif", "img/image.png", "image.png.exe"]) assert.ok(!ok(["module.json", bad]), bad);
});

await test("local build: replaces a library module, only while the page is served from this computer", async () => {
  const realFetch = globalThis.fetch;
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const served = {
    "local-modules/manifest.json": { modules: { fuzz: { file: "modules/fuzz.wasm", bytes: 8, types: ["fuzz"] }, only: { file: "modules/only.wasm", types: ["only"] } } },
    "local-modules/modules/fuzz.wasm": wasm,
    "local-modules/modules/only.wasm": wasm,
  };
  // a module written in Bleep Script: its node types, UI, source and help page come with the build (patch/web/build_modules.py)
  served["local-modules/manifest.json"].modules.pre = { file: "modules/pre.wasm", bytes: 8, types: ["pre"], spec: [{ type: "pre", name: "Pre" }],
    script: { view: "modules/pre.view.js", source: "modules/pre.dsp.ts", help: "modules/pre.md" } };
  served["local-modules/modules/pre.wasm"] = wasm;
  served["local-modules/modules/pre.view.js"] = new TextEncoder().encode("const c = bleep.canvas(80);");
  served["local-modules/modules/pre.dsp.ts"] = new TextEncoder().encode("export class Pre {}");
  served["local-modules/modules/pre.md"] = new TextEncoder().encode("# Pre");
  globalThis.fetch = async (url) => {
    const body = served[url];
    if (body === undefined) return new Response("no", { status: 404 });
    return new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
  };
  try {
    // it works without any library, and the module is loaded as it is
    Library.configure({ base: "reg/", localBase: "local-modules/", hostname: "localhost" });
    const m = await Library.manifest();
    assert.equal(m.types.fuzz, "fuzz");
    assert.equal(m.modules.only.version, "local");
    const got = await Library.fetchModule("fuzz");
    assert.equal(got.local, true);
    assert.equal(got.wasm.byteLength, 8);
    assert.deepEqual([got.view, got.source, got.help], ["", "", ""], "a C++ module has no script files");
    const pre = await Library.fetchModule("pre");
    assert.equal(pre.localBuild, true);
    assert.deepEqual(pre.spec, [{ type: "pre", name: "Pre" }]);
    assert.deepEqual([pre.view, pre.source, pre.help], ["const c = bleep.canvas(80);", "export class Pre {}", "# Pre"], "a script module brings its UI, source and help page");
    // a page that is not on this computer never reads it, whatever the folder holds
    for (const hostname of ["play.example.com", "evil-localhost.com", "127.0.0.1.example.com"]) {
      Library.configure({ hostname });
      await assert.rejects(Library.manifest(), undefined, hostname);
    }
    for (const hostname of ["localhost", "127.0.0.1", "[::1]", "dev.localhost"]) {
      Library.configure({ hostname });
      assert.equal((await Library.manifest()).types.fuzz, "fuzz", hostname);
    }
    // a folder that is not there changes nothing
    Library.configure({ hostname: null, localBase: "nowhere/" });
    await assert.rejects(Library.manifest());
  } finally {
    globalThis.fetch = realFetch;
    Library.configure({ localBase: "local-modules/", hostname: null });
  }
});

let failed = 0;
for (const [name, err] of results) {
  console.log(`${err ? "FAIL" : "ok  "} ${name}`);
  if (err) { failed++; console.log("     " + (err.stack || err).toString().split("\n").slice(0, 4).join("\n     ")); }
}
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
