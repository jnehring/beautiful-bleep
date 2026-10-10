// SPDX-License-Identifier: MIT
//
// store-client.js — the Bleep Store, from the browser (doc/specs/store.md, doc/specs/signing.md).
//
// Finds the package of a node type in the store's index, downloads it, checks its signature chain against the root
// public keys, and hands out the module's .wasm. The same code runs in node (the tests) and checks the same things
// as website/api/app/signing.py: the test vector in doc/specs/signing.md section 14 must give the same results.
//
//   BleepStore.configure({ base: "/registry/v1/", roots: [Uint8Array …], allowUnsigned: false })
//   const manifest = await BleepStore.manifest();        // { types: {type → slug}, modules: {slug → {version, types, …}} }
//   const m = await BleepStore.fetchModule("reverb");    // { wasm: ArrayBuffer, version, publisher, status, meta }
//
// Only WebCrypto, fetch and DecompressionStream are used (Ed25519 in WebCrypto: Chrome 137, Firefox 129, Safari 17).
(function (root) {
  "use strict";

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---- bytes -----------------------------------------------------------------------------------

  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const fromHex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const lp = (u8) => concat(u32(u8.length), u8);
  const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
  const byBytes = (a, b) => { const x = enc.encode(a), y = enc.encode(b); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; };

  /// The one JSON text a signed object is turned into: keys sorted, no whitespace, UTF-8 (Python: json.dumps(sort_keys, separators)).
  function canonical(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    return "{" + Object.keys(v).sort(byBytes).map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }

  const keyId = async (pub) => hex(await sha256(pub)).slice(0, 32);

  async function verifySignature(pub, signature, message) {
    try {
      const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
    } catch (e) {
      return false;
    }
  }

  // ---- the content hash --------------------------------------------------------------------------

  const safePath = (p) => !!p && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && p.split("/").every((x) => x !== "" && x !== "." && x !== "..");

  /// entries: Map path → { sha: Uint8Array(32), exec: bool }. See signing.md section 4.
  async function contentDigest(entries) {
    const paths = [...entries.keys()];
    if (!paths.every(safePath)) throw new Error("bad path in package");
    paths.sort(byBytes);
    const parts = [enc.encode("BLEEP-CONTENT-1\n"), u32(paths.length)];
    for (const p of paths) {
      const e = entries.get(p);
      parts.push(lp(enc.encode(p)), e.sha, new Uint8Array([e.exec ? 1 : 0]));
    }
    return sha256(concat(...parts));
  }

  // ---- zip (stored and deflate; no zip64, no encryption: what package-module.py writes) ------------------

  async function inflateRaw(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /// Reads a zip into { files: Map path → Uint8Array, entries: Map path → {sha, exec}, signature: doc|null }.
  /// META/signature.json is returned apart and is not part of `entries`. Refuses duplicates, symlinks and unsafe paths.
  async function readZip(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    const count = v.getUint16(eocd + 10, true);
    let at = v.getUint32(eocd + 16, true);
    const files = new Map(), entries = new Map();
    let signature = null;
    for (let n = 0; n < count; n++) {
      if (v.getUint32(at, true) !== 0x02014b50) throw new Error("bad zip directory");
      const madeBy = v.getUint16(at + 4, true), method = v.getUint16(at + 10, true);
      const size = v.getUint32(at + 20, true), usize = v.getUint32(at + 24, true);
      const nameLen = v.getUint16(at + 28, true), extraLen = v.getUint16(at + 30, true), commentLen = v.getUint16(at + 32, true);
      const ext = v.getUint32(at + 38, true), local = v.getUint32(at + 42, true);
      const name = dec.decode(data.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith("/")) continue;
      if (size === 0xFFFFFFFF || usize === 0xFFFFFFFF) throw new Error("zip64 is not supported");
      if ((madeBy >> 8) === 3 && (ext >>> 28) === 0xA) throw new Error("symlink in package: " + name);
      if (files.has(name) || name === "META/signature.json" && signature) throw new Error("duplicate file in package: " + name);
      if (v.getUint32(local, true) !== 0x04034b50) throw new Error("bad zip entry: " + name);
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = data.subarray(start, start + size);
      let body;
      if (method === 0) body = raw.slice();
      else if (method === 8) body = await inflateRaw(raw);
      else throw new Error("unsupported compression in " + name);
      if (body.length !== usize) throw new Error("size mismatch in " + name);
      if (name === "META/signature.json") { signature = JSON.parse(dec.decode(body)); continue; }
      files.set(name, body);
      entries.set(name, { sha: await sha256(body), exec: (madeBy >> 8) === 3 && ((ext >>> 16) & 0o111) !== 0 });
    }
    return { files, entries, signature };
  }

  // ---- verification (signing.md section 7) ---------------------------------------------------------

  const KINDS = ["module", "plugin"];
  const result = (status, extra = {}) => ({ status, publisher: "", keyId: "", root: "", reason: "", ...extra });

  async function checkCert(cert, signerPub) {
    return verifySignature(signerPub, fromB64(cert.signature), concat(enc.encode("BLEEP-CERT-1\n"), enc.encode(canonical(cert.tbs))));
  }

  /// content: a Map of entries (see contentDigest) or the 32-byte digest itself.
  /// roots: Uint8Array public keys. crl: { revokedKeys: [{keyId}], revokedArtifacts: [{kind,id,version,digest}] }.
  async function verify(content, doc, { kind, id, version, platform = "any", roots, now = Math.floor(Date.now() / 1000), crl = null }) {
    if (doc == null) return result("unsigned");
    try {
      if (doc.format !== 1 || doc.algorithm !== "ed25519") return result("invalid", { reason: "unknown signature format" });
      if (!Array.isArray(doc.chain) || doc.chain.length !== 2) return result("invalid", { reason: "malformed signature: chain" });
      const [issuerCert, devCert] = doc.chain;
      const it = issuerCert.tbs, dt = devCert.tbs;
      const issuerPub = fromB64(it.publicKey), devPub = fromB64(dt.publicKey);
      let root = null;
      for (const r of roots) if ((await keyId(r)) === issuerCert.issuer) root = r;
      if (!root || !(await checkCert(issuerCert, root))) return result("invalid", { reason: "the issuer certificate is not signed by a trusted root" });
      if (it.type !== "issuer" || it.keyId !== (await keyId(issuerPub)) || !it.scopes.includes("issue")) return result("invalid", { reason: "bad issuer certificate" });
      if (devCert.issuer !== it.keyId || !(await checkCert(devCert, issuerPub))) return result("invalid", { reason: "the developer certificate is not signed by the issuer" });
      if (dt.type !== "developer" || dt.keyId !== (await keyId(devPub)) || doc.keyId !== dt.keyId) return result("invalid", { reason: "bad developer certificate" });
      const who = result("signed", { publisher: dt.publisher, keyId: dt.keyId, root: await keyId(root) });

      const digest = content instanceof Uint8Array ? content : await contentDigest(content);
      for (const t of [it, dt]) for (const rev of (crl && crl.revokedKeys) || []) if (rev.keyId === t.keyId) return { ...who, status: "revoked", reason: "the signing key was revoked" };
      for (const rev of (crl && crl.revokedArtifacts) || [])
        if (rev.kind === kind && rev.id === id && rev.version === version && rev.digest === hex(digest)) return { ...who, status: "revoked", reason: "this release was revoked" };

      if (!KINDS.includes(kind) || !dt.scopes.includes(kind)) return result("invalid", { reason: `the certificate does not allow signing a ${kind}` });
      const bareOk = dt.firstParty && !id.includes("/");
      if (!bareOk && !id.startsWith(dt.publisher + "/")) return result("invalid", { reason: `'${id}' is not in the publisher's namespace` });
      const message = concat(enc.encode("BLEEP-SIG-1\n"), lp(enc.encode(kind)), lp(enc.encode(id)), lp(enc.encode(version)), lp(enc.encode(platform)),
                             lp(enc.encode(dt.keyId)), lp(digest));
      if (!(await verifySignature(devPub, fromB64(doc.signature), message))) return result("invalid", { reason: "the signature does not match the content" });
      for (const t of [it, dt]) if (!(t.notBefore <= now && now <= t.notAfter)) return { ...who, status: "expired", reason: "the certificate is outside its validity period" };
      return who;
    } catch (e) {
      return result("invalid", { reason: "malformed signature: " + e.message });
    }
  }

  /// May it load? `allowUnsigned`: { module: bool, plugin: bool }. Invalid and revoked are never loaded.
  function decide(res, kind, allowUnsigned) {
    if (res.status === "signed") return [true, "signed by " + res.publisher];
    if (res.status === "invalid" || res.status === "revoked") return [false, `${res.status}: ${res.reason}`];
    if (allowUnsigned && allowUnsigned[kind]) return [true, "unsigned (allowed in the settings)"];
    return [false, `${res.status}: enable 'Allow unsigned ${kind}s' in the settings to load it`];
  }

  // ---- the store ------------------------------------------------------------------------------------

  const config = { base: "/registry/v1/", roots: null, rootsUrl: "/api/registry/roots", channel: "stable", allowUnsigned: { module: false, plugin: false }, crl: null };
  let indexPromise = null;
  const packages = new Map();

  const abs = (p) => (typeof document !== "undefined" ? new URL(p, document.baseURI).href : p);
  const signedId = (slug) => slug.replace(".", "/");  // "acme.fuzz" in URLs is "acme/fuzz" in signatures

  async function getJSON(path) {
    const res = await fetch(abs(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function roots() {
    if (!config.roots) config.roots = (await getJSON(config.rootsUrl)).roots.map(fromHex);
    return config.roots;
  }

  /// { types: {type id → slug}, modules: {slug → {version, entry, types}} } from the store's index.
  async function manifest() {
    if (!indexPromise) indexPromise = getJSON(config.base + "index.json");
    const mods = (await indexPromise).channels[config.channel].modules;
    const types = {};
    for (const [slug, m] of Object.entries(mods)) for (const t of m.types || []) types[t] = slug;
    return { types, modules: mods };
  }

  /// Downloads a module package, checks it and returns its .wasm. Throws, with the reason, if it must not load.
  function fetchModule(slug) {
    if (!packages.has(slug)) {
      packages.set(slug, (async () => {
        const mods = (await manifest()).modules;
        if (!mods[slug]) throw new Error(`the store has no module ${slug}`);
        const dir = config.base + mods[slug].entry.replace(/entry\.json$/, "");
        const entry = await getJSON(config.base + mods[slug].entry);
        const file = entry.files.find((f) => f.platform === "any");
        if (!file) throw new Error(`${slug}: no package in the entry`);
        const res = await fetch(abs(dir + file.path));
        if (!res.ok) throw new Error(`${file.path}: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (hex(await sha256(bytes)) !== file.sha256) throw new Error(`${slug}: the download is not the file the store lists`);
        const zip = await readZip(bytes);
        const checked = await verify(zip.entries, file.signature || zip.signature, {
          kind: "module", id: signedId(slug), version: entry.version, platform: "any", roots: await roots(), crl: config.crl });
        const [ok, why] = decide(checked, "module", config.allowUnsigned);
        if (!ok) throw new Error(`${slug} ${entry.version} is not loaded: ${why}`);
        const wasm = zip.files.get("module.wasm");
        if (!wasm) throw new Error(`${slug}: the package has no module.wasm`);
        return { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength), version: entry.version, publisher: checked.publisher,
                 status: checked.status, meta: JSON.parse(dec.decode(zip.files.get("module.json"))), bytes: bytes.length };
      })());
      packages.get(slug).catch(() => packages.delete(slug));  // a failed download is tried again next time
    }
    return packages.get(slug);
  }

  const BleepStore = {
    /// Changing roots, the revocation list or the unsigned setting forgets what was verified under the old ones.
    configure(o) { Object.assign(config, o); indexPromise = null; packages.clear(); return BleepStore; },
    config, manifest, fetchModule,
    // for tests and other tools
    canonical, contentDigest, readZip, verify, decide, keyId, hex, fromHex, fromB64,
  };
  root.BleepStore = BleepStore;
  if (typeof module !== "undefined" && module.exports) module.exports = BleepStore;
})(typeof window !== "undefined" ? window : globalThis);
