// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// library-client.js against the Python reference (scripts/release/signing.py): packages are signed by the Python tools,
// the browser code must reach the same verdicts. Needs python3 with the `cryptography` package.
//
//   node patch/web/test/library-client-test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const Library = createRequire(import.meta.url)(join(here, "..", "js", "library-client.js"));
const SIGNING = join(ROOT, "scripts", "release", "signing.py");
const tmp = mkdtempSync(join(tmpdir(), "bleep-library-test-"));
const py = (code, ...args) => execFileSync("python3", ["-c", code, ...args], { encoding: "utf8" });
const signing = (...args) => execFileSync("python3", [SIGNING, ...args], { encoding: "utf8" });
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

// ---- fixtures made by the Python tools ----------------------------------------------------------
signing("init-registry", join(tmp, "reg"));
signing("issue-kit", join(tmp, "reg"), "--publisher", "bleep", "--scopes", "module,plugin", "--first-party");
signing("issue-kit", join(tmp, "reg"), "--publisher", "acme", "--scopes", "module");
const root = Library.fromHex(readFileSync(join(tmp, "reg", "root.pub"), "utf8").trim());
const other = (signing("init-registry", join(tmp, "other")), Library.fromHex(readFileSync(join(tmp, "other", "root.pub"), "utf8").trim()));

/** A zip with these files, written by Python (deflate, or stored), optionally signed with a kit as kind/id/version/platform. */
function makeZip(name, files, { kit = null, id = "reverb", version = "1.0.0", platform = "any", stored = false, extra = "" } = {}) {
  const path = join(tmp, name);
  writeFileSync(path + ".files.json", JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString("base64")]))));
  py(`
import json, sys, zipfile, base64
files = json.load(open(sys.argv[1] + ".files.json"))
comp = zipfile.ZIP_STORED if sys.argv[2] == "1" else zipfile.ZIP_DEFLATED
with zipfile.ZipFile(sys.argv[1], "w", comp) as z:
    for p, b in sorted(files.items()):
        z.writestr(p, base64.b64decode(b))
${extra}`, path, stored ? "1" : "0");
  if (kit) signing("sign", path, "--kit", join(tmp, "reg", kit + ".kit.json"), "--kind", "module", "--id", id, "--version", version, "--platform", platform);
  return new Uint8Array(readFileSync(path));
}
const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
const files = { "module.json": '{"name":"Verb","types":["reverb"],"requires":{"engineAbi":1}}\n', "module.wasm": wasm, "spec.json": '[{"type":"reverb","name":"Verb"}]\n', "ui/reverb.js": "// view\n" };
const ctx = (over = {}) => ({ kind: "module", id: "reverb", version: "1.0.0", roots: [root], ...over });
const check = async (bytes, over) => { const z = await Library.readZip(bytes); return Library.verify(z.entries, z.signature, ctx(over)); };

// ---- the tests ------------------------------------------------------------------------------------

await test("canonical JSON is byte for byte what Python signs", async () => {
  const sample = { b: [1, { z: "é€😀\n\"q\"\\", a: null, t: true }], a: 0, "ü": "x", _: -3 };
  const python = py("import json,sys; print(json.dumps(json.loads(sys.argv[1]), sort_keys=True, separators=(',', ':'), ensure_ascii=False), end='')", JSON.stringify(sample));
  assert.equal(Library.canonical(sample), python);
});

await test("the content hash of the spec's test vector", async () => {  // developers/modules/signing.md section 14
  const vec = { "module.json": '{"name":"Fuzz"}\n', "module.wasm": new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), "ui/fuzz.js": "// view\n" };
  const entries = new Map();
  for (const [p, c] of Object.entries(vec)) entries.set(p, { sha: new Uint8Array(await crypto.subtle.digest("SHA-256", typeof c === "string" ? new TextEncoder().encode(c) : c)), exec: false });
  assert.equal(Library.hex(await Library.contentDigest(entries)), "39f61d45e3115066a934dabca6cf83c346420153e85d6d58841033d62d0c1f08");
});

await test("a package signed by Python verifies as signed (deflate and stored)", async () => {
  for (const stored of [false, true]) {
    const r = await check(makeZip(`ok-${stored}.bleepmod`, files, { kit: "bleep", stored }));
    assert.equal(r.status, "signed", r.reason);
    assert.equal(r.publisher, "bleep");
  }
});

await test("it reads the same hash as Python for the same zip", async () => {
  const bytes = makeZip("hash.bleepmod", files);
  const jsHash = Library.hex(await Library.contentDigest((await Library.readZip(bytes)).entries));
  writeFileSync(join(tmp, "hash.bleepmod"), bytes);
  const pyHash = signing("digest", join(tmp, "hash.bleepmod")).trim();
  assert.equal(jsHash, pyHash);
});

await test("unsigned", async () => assert.equal((await check(makeZip("none.bleepmod", files))).status, "unsigned"));

await test("a changed, added or removed file breaks the signature", async () => {
  for (const bad of [{ ...files, "module.wasm": new Uint8Array([...wasm, 0]) }, { ...files, "ui/evil.js": "x" }]) {
    const signed = makeZip("t.bleepmod", files, { kit: "bleep" });
    // keep the old signature, change the files: sign `files`, then rewrite the zip with the other files and the old META
    const z = await Library.readZip(signed);
    const doc = JSON.stringify(z.signature);
    const tampered = makeZip("t2.bleepmod", { ...bad, "META/signature.json": doc });
    assert.equal((await check(tampered)).status, "invalid");
  }
  const noUi = { "module.json": files["module.json"], "module.wasm": wasm };
  const z = await Library.readZip(makeZip("t3.bleepmod", files, { kit: "bleep" }));
  assert.equal((await check(makeZip("t4.bleepmod", { ...noUi, "META/signature.json": JSON.stringify(z.signature) }))).status, "invalid");
});

await test("a signature is only good for its own id, version and platform", async () => {
  const bytes = makeZip("id.bleepmod", files, { kit: "bleep" });
  for (const over of [{ id: "other" }, { version: "1.0.1" }, { platform: "macos-arm64" }, { kind: "plugin" }])
    assert.equal((await check(bytes, over)).status, "invalid", JSON.stringify(over));
});

await test("another root, a developer outside their namespace", async () => {
  const bytes = makeZip("root.bleepmod", files, { kit: "bleep" });
  assert.equal((await check(bytes, { roots: [other] })).status, "invalid");
  assert.equal((await check(bytes, { roots: [] })).status, "invalid");
  const acme = makeZip("acme.bleepmod", files, { kit: "acme", id: "reverb" });  // acme may not sign a bare id
  assert.equal((await check(acme)).status, "invalid");
  const own = makeZip("acme2.bleepmod", files, { kit: "acme", id: "acme/fuzz" });
  const r = await check(own, { id: "acme/fuzz" });
  assert.equal([r.status, r.publisher].join(), "signed,acme");
});

await test("expired and revoked", async () => {
  const bytes = makeZip("exp.bleepmod", files, { kit: "bleep" });
  assert.equal((await check(bytes, { now: 4_000_000_000 })).status, "expired");
  assert.equal((await check(bytes, { now: 1_000 })).status, "expired");
  const keyId = (await check(bytes)).keyId;
  assert.equal((await check(bytes, { crl: { revokedKeys: [{ keyId }] } })).status, "revoked");
  const digest = Library.hex(await Library.contentDigest((await Library.readZip(bytes)).entries));
  assert.equal((await check(bytes, { crl: { revokedArtifacts: [{ kind: "module", id: "reverb", version: "1.0.0", digest }] } })).status, "revoked");
});

await test("malformed signature documents are invalid, never an exception", async () => {
  const z = await Library.readZip(makeZip("m.bleepmod", files));
  for (const doc of [{}, { format: 1 }, { format: 1, algorithm: "ed25519", chain: [] }, { format: 1, algorithm: "ed25519", chain: [1, 2], keyId: "x", signature: "!!" }])
    assert.equal((await Library.verify(z.entries, doc, ctx())).status, "invalid", JSON.stringify(doc));
});

await test("the policy: unsigned needs the setting, invalid never loads", async () => {
  const allow = { module: true, plugin: false };
  assert.equal(Library.decide({ status: "unsigned" }, "module", allow)[0], true);
  assert.equal(Library.decide({ status: "unsigned" }, "plugin", allow)[0], false);
  assert.equal(Library.decide({ status: "unsigned" }, "module", { module: false })[0], false);
  assert.equal(Library.decide({ status: "invalid", reason: "x" }, "module", allow)[0], false);
  assert.equal(Library.decide({ status: "revoked", reason: "x" }, "module", allow)[0], false);
  assert.equal(Library.decide({ status: "signed", publisher: "a" }, "module", {})[0], true);
});

await test("the zip reader refuses symlinks, duplicates and unsafe paths", async () => {
  const sym = makeZip("sym.bleepmod", { a: "1" }, { extra: `
with zipfile.ZipFile(sys.argv[1], "a") as z:
    i = zipfile.ZipInfo("link"); i.create_system = 3; i.external_attr = 0o120777 << 16
    z.writestr(i, "a")` });
  await assert.rejects(Library.readZip(sym), /symlink/);
  const dup = makeZip("dup.bleepmod", { a: "1" }, { extra: `
import warnings; warnings.simplefilter("ignore")
with zipfile.ZipFile(sys.argv[1], "a") as z:
    z.writestr("a", "2")` });
  await assert.rejects(Library.readZip(dup), /duplicate/);
  const bad = makeZip("bad.bleepmod", { "../x": "1" });
  const z = await Library.readZip(bad);
  await assert.rejects(Library.contentDigest(z.entries), /bad path/);
  await assert.rejects(Library.readZip(new Uint8Array([1, 2, 3])), /not a zip/);
});

await test("the shared fixtures: every package gets the verdict Python gave it (patch/tests/library-fixtures)", async () => {
  const dir = join(ROOT, "patch", "tests", "library-fixtures");
  const spec = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  const roots = { main: [Library.fromHex(spec.roots.main)], other: [Library.fromHex(spec.roots.other)], none: [] };
  assert.ok(spec.cases.length > 20);
  for (const c of spec.cases) {
    let got;
    let zip;
    try {
      zip = await Library.readZip(new Uint8Array(readFileSync(join(dir, c.file))));
      await Library.contentDigest(zip.entries);
    } catch (e) { got = "refused"; }
    if (!got) {
      let doc = zip.signature;
      const r = await Library.verify(zip.entries, doc, { kind: c.kind, id: c.id, version: c.version, platform: c.platform, roots: roots[c.roots], now: c.now, crl: c.crl });
      got = r.status;
      if (c.publisher) assert.equal(r.publisher, c.publisher, c.name);
      if ("communityFiles" in c) assert.equal(Library.communityFilesOk(zip.files.keys()) === "", c.communityFiles, c.name);
      if (r.status === "signed") assert.equal(r.trust, c.publisher === "community" ? "community" : c.publisher === "bleep" ? "official" : "developer", c.name);
    }
    assert.equal(got, c.expect, c.name);
  }
});

await test("the shared receipt fixtures: every publication receipt gets the verdict Python gave it", async () => {
  const dir = join(ROOT, "patch", "tests", "library-fixtures");
  const spec = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  const mainRoot = [Library.fromHex(spec.roots.main)];
  assert.ok(spec.receiptCases.length > 15);
  for (const c of spec.receiptCases) {
    const zip = await Library.readZip(new Uint8Array(readFileSync(join(dir, c.file))));
    const r = await Library.verify(zip.entries, zip.signature, { kind: c.kind, id: c.id, version: c.version, platform: c.platform, roots: mainRoot, now: c.now, crl: c.crl, receipt: c.receipt });
    assert.equal(r.status, c.expect, c.name);
  }
});

await test("fetchModule: a receipt keeps a release signed after its certificate lapsed; without it the module is refused", async () => {
  const dir = join(ROOT, "patch", "tests", "library-fixtures");
  const spec = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  const pkg = new Uint8Array(readFileSync(join(dir, "signed.bleepmod")));
  const sha = Library.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", pkg)));
  const sigDoc = (await Library.readZip(pkg)).signature;
  const receipt = spec.receiptCases.find((c) => c.name === "receipt-valid").receipt;
  const base = "http://library/registry/v1/";
  const served = {
    [base + "index.json"]: { format: 1, channels: { stable: { modules: { "acme.fuzz": { version: "1.0.0", entry: "modules/acme.fuzz/1.0.0/entry.json", types: ["acme/fuzz"] } } } } },
    [base + "modules/acme.fuzz/1.0.0/entry.json"]: { id: "acme.fuzz", version: "1.0.0", files: [{ path: "p.bleepmod", sha256: sha, bytes: pkg.length, platform: "any", signature: sigDoc, publication: receipt }] },
    [base + "modules/acme.fuzz/1.0.0/p.bleepmod"]: pkg,
  };
  const realFetch = globalThis.fetch, realNow = Date.now;
  globalThis.fetch = async (url) => (served[url] === undefined ? new Response("no", { status: 404 }) : new Response(served[url] instanceof Uint8Array ? served[url] : JSON.stringify(served[url])));
  Date.now = () => (spec.siteNow + 5 * 365 * 86400) * 1000;  // five years after the fixture certificates lapsed
  try {
    Library.configure({ base, roots: [Library.fromHex(spec.roots.main)], allowUnsigned: { module: false, plugin: false } });
    const got = await Library.fetchModule("acme.fuzz");
    assert.equal([got.publisher, got.status].join(), "acme,signed");
    delete served[base + "modules/acme.fuzz/1.0.0/entry.json"].files[0].publication;
    Library.configure({});
    await assert.rejects(Library.fetchModule("acme.fuzz"), /not loaded: expired/);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    Library.configure({ roots: null });
  }
});

await test("fetchModule: the whole path through the index, the entry and the package", async () => {
  const pkg = makeZip("library.bleepmod", files, { kit: "bleep" });
  const sha = Library.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", pkg)));
  const sigDoc = (await Library.readZip(pkg)).signature;
  const base = "http://library/registry/v1/";
  const served = {
    [base + "index.json"]: { format: 1, channels: { stable: { modules: { reverb: { version: "1.0.0", entry: "modules/reverb/1.0.0/entry.json", types: ["reverb"] } } } } },
    [base + "modules/reverb/1.0.0/entry.json"]: { id: "reverb", version: "1.0.0", files: [{ path: "reverb-1.0.0.bleepmod", sha256: sha, bytes: pkg.length, platform: "any", signature: sigDoc }] },
    [base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"]: pkg,
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = served[url];
    if (body === undefined) return new Response("no", { status: 404 });
    return new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
  };
  try {
    Library.configure({ base, roots: [root], allowUnsigned: { module: false, plugin: false } });
    const m = await Library.manifest();
    assert.deepEqual(m.types, { reverb: "reverb" });
    const got = await Library.fetchModule("reverb");
    assert.deepEqual([...new Uint8Array(got.wasm)], [...wasm]);
    assert.equal([got.version, got.publisher, got.status].join(), "1.0.0,bleep,signed");
    assert.equal(got.meta.name, "Verb");
    assert.deepEqual(got.spec, [{ type: "reverb", name: "Verb" }]);  // the node types, for the board's Add-module list
    // no pinned roots: nothing is fetched from the server to trust instead
    Library.configure({ roots: null });
    await assert.rejects(Library.fetchModule("reverb"), /no pinned library root keys/);
    assert.ok(!Object.keys(served).some((u) => u.includes("roots")) && !Library.config.rootsUrl, "the roots are never asked from the library");
    Library.configure({ roots: [root] });
    // a download that is not the file the entry lists
    served[base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"] = new Uint8Array([...pkg.slice(0, -1), pkg[pkg.length - 1] ^ 1]);
    Library.configure({});  // forgets the verified copy
    await assert.rejects(Library.fetchModule("reverb"), /not the file the library lists/);
    // the right file, but the wrong root
    served[base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"] = pkg;
    Library.configure({ roots: [other] });
    await assert.rejects(Library.fetchModule("reverb"), /not loaded: invalid/);
    // unsigned: refused, then allowed by the setting
    const bare = makeZip("bare.bleepmod", files);
    served[base + "modules/reverb/1.0.0/reverb-1.0.0.bleepmod"] = bare;
    served[base + "modules/reverb/1.0.0/entry.json"].files[0] = { path: "reverb-1.0.0.bleepmod", sha256: Library.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bare))), bytes: bare.length, platform: "any" };
    Library.configure({ roots: [root] });
    await assert.rejects(Library.fetchModule("reverb"), /unsigned: enable 'Allow unsigned modules'/);
    Library.configure({ allowUnsigned: { module: true } });
    assert.equal((await Library.fetchModule("reverb")).status, "unsigned");
    await assert.rejects(Library.fetchModule("nothing"), /no module nothing/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("revocation list: fetched, verified, rollback refused, fetch failure tolerated, revoked key refused", async () => {
  const pkg = makeZip("crl.bleepmod", files, { kit: "bleep" });
  const sha = Library.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", pkg)));
  const sigDoc = (await Library.readZip(pkg)).signature;
  const devKeyId = sigDoc.keyId;
  const mkCrl = (serial, keys) => JSON.parse(py(`
import sys, json
sys.path.insert(0, sys.argv[1])
import signing
reg = sys.argv[2]
cert = json.load(open(reg + "/issuer.cert"))
doc = signing.make_crl(signing.load_key(reg + "/issuer.key"), cert, serial=int(sys.argv[3]), issued=1, revoked_keys=json.loads(sys.argv[4]))
print(json.dumps(doc))`, join(ROOT, "scripts", "release"), join(tmp, "reg"), String(serial), JSON.stringify(keys)));
  const forged = JSON.parse(py(`
import sys, json
sys.path.insert(0, sys.argv[1])
import signing
reg = sys.argv[2]
cert = json.load(open(reg + "/issuer.cert"))
doc = signing.make_crl(signing.load_key(reg + "/issuer.key"), cert, serial=50, issued=1)
doc["revokedKeys"] = [{"keyId": "x"}]
print(json.dumps(doc))`, join(ROOT, "scripts", "release"), join(tmp, "reg")));
  const base = "http://library/registry/v1/";
  const served = {
    [base + "index.json"]: { format: 1, channels: { stable: { modules: { reverb: { version: "1.0.0", entry: "modules/reverb/1.0.0/entry.json", types: ["reverb"] } } } } },
    [base + "modules/reverb/1.0.0/entry.json"]: { id: "reverb", version: "1.0.0", files: [{ path: "p.bleepmod", sha256: sha, bytes: pkg.length, platform: "any", signature: sigDoc }] },
    [base + "modules/reverb/1.0.0/p.bleepmod"]: pkg,
  };
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = served[url];
    if (body === undefined) return new Response("no", { status: 404 });
    return new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
  };
  const cfg = () => Library.configure({ base, roots: [root], storage, crl: null, revocations: true });
  try {
    // no list published (404): loads
    cfg();
    assert.equal((await Library.fetchModule("reverb")).status, "signed");
    // a forged list (signature does not match the body) is ignored
    served[base + "revocations.json"] = forged;
    cfg();
    assert.equal((await Library.fetchModule("reverb")).status, "signed");
    assert.equal(mem.size, 0);
    // a list signed under another root is ignored
    cfg(); Library.configure({ roots: [other] });
    assert.equal(await Library.revocations(), null);
    // a good list that revokes the key: refused
    served[base + "revocations.json"] = mkCrl(7, [devKeyId]);
    cfg();
    await assert.rejects(Library.fetchModule("reverb"), /not loaded: revoked/);
    assert.equal(mem.get("bleep.library.crl.serial"), "7");
    // rollback: an older empty list is served, the remembered one still applies
    served[base + "revocations.json"] = mkCrl(3, []);
    cfg();
    await assert.rejects(Library.fetchModule("reverb"), /not loaded: revoked/);
    assert.equal(mem.get("bleep.library.crl.serial"), "7");
    // offline: the remembered list still applies
    delete served[base + "revocations.json"];
    cfg();
    await assert.rejects(Library.fetchModule("reverb"), /not loaded: revoked/);
    // a newer list that no longer revokes it
    served[base + "revocations.json"] = mkCrl(8, []);
    cfg();
    assert.equal((await Library.fetchModule("reverb")).status, "signed");
    assert.equal(mem.get("bleep.library.crl.serial"), "8");
    // broken storage does not break loading
    globalThis.fetch = async (url) => { if (url.endsWith("revocations.json")) throw new TypeError("offline"); return new Response(JSON.stringify(served[url]) ); };
    served[base + "modules/reverb/1.0.0/p.bleepmod"] = pkg;
    globalThis.fetch = async (url) => {
      if (url.endsWith("revocations.json")) throw new TypeError("offline");
      const body = served[url];
      return body === undefined ? new Response("no", { status: 404 }) : new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
    };
    Library.configure({ base, roots: [root], storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }, crl: null });
    assert.equal((await Library.fetchModule("reverb")).status, "signed");
  } finally {
    globalThis.fetch = realFetch;
    Library.configure({ storage: null, crl: null });
  }
});

await test("local build: replaces a library module unsigned, only while unsigned modules are allowed", async () => {
  const realFetch = globalThis.fetch;
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const served = {
    "local-modules/manifest.json": { modules: { fuzz: { file: "modules/fuzz.wasm", bytes: 8, types: ["fuzz"] }, only: { file: "modules/only.wasm", types: ["only"] } } },
    "local-modules/modules/fuzz.wasm": wasm,
    "local-modules/modules/only.wasm": wasm,
  };
  globalThis.fetch = async (url) => {
    const body = served[url];
    if (body === undefined) return new Response("no", { status: 404 });
    return new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
  };
  try {
    // not allowed: the local folder is not even read, and the missing library is the error
    Library.configure({ base: "reg/", roots: null, allowUnsigned: { module: false, plugin: false }, localBase: "local-modules/" });
    await assert.rejects(Library.manifest());
    // allowed: it works without any library, and the module is loaded unsigned
    Library.configure({ allowUnsigned: { module: true, plugin: false }, hostname: "localhost" });
    const m = await Library.manifest();
    assert.equal(m.types.fuzz, "fuzz");
    assert.equal(m.modules.only.version, "local");
    const got = await Library.fetchModule("fuzz");
    assert.equal(got.status, "unsigned");
    assert.equal(got.local, true);
    assert.equal(got.wasm.byteLength, 8);
    // a page that is not on this computer never reads it, whatever the folder holds and whatever the setting says
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
    Library.configure({ allowUnsigned: { module: false, plugin: false }, localBase: "local-modules/", hostname: null, roots: null });
  }
});

rmSync(tmp, { recursive: true, force: true });
let failed = 0;
for (const [name, err] of results) {
  console.log(`${err ? "FAIL" : "ok  "} ${name}`);
  if (err) { failed++; console.log("     " + (err.stack || err).toString().split("\n").slice(0, 4).join("\n     ")); }
}
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
