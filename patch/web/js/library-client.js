// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// library-client.js — the Bleep Library, from the browser (developers/modules/library.md, developers/modules/signing.md).
//
// Finds the package of a node type in the library's index, downloads it, checks its signature chain against the root
// public keys, and hands out the module's .wasm. The same code runs in node (the tests) and checks the same things
// as the Python reference (scripts/release/signing.py): the test vector in developers/modules/signing.md section 14 must give the same results.
//
//   BleepLibrary.configure({ base: "/registry/v1/", roots: [Uint8Array …], allowUnsigned: false })
//   const manifest = await BleepLibrary.manifest();        // { types: {type → slug}, modules: {slug → {version, types, …}} }
//   const m = await BleepLibrary.fetchModule("reverb");    // { wasm: ArrayBuffer, version, publisher, status, meta }
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
      if (name === "META/signature.json") {  // a signature that is not JSON is a package with an invalid signature, not an unreadable one
        try { signature = JSON.parse(dec.decode(body)); } catch (e) { signature = {}; }
        continue;
      }
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
  /// receipt: the library's publication receipt for this file (entry.json files[].publication, signing.md section 6a), or null.
  /// With one the certificates must have been valid when the library published the file, and the device clock plays no part.
  async function verify(content, doc, { kind, id, version, platform = "any", roots, now = Math.floor(Date.now() / 1000), crl = null, receipt = null }) {
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
      // validity comes last: an expired signer is not an attack, just old. A receipt moves the moment that counts from now to publishedAt.
      let at = now, dated = 0;
      if (receipt != null) {
        const p = receipt.publishedAt;
        if (receipt.format !== 1 || receipt.algorithm !== "ed25519" || receipt.issuerKeyId !== it.keyId || typeof p !== "number" || !Number.isSafeInteger(p) || p < 0)
          return result("invalid", { reason: "bad publication receipt" });
        const stamp = new Uint8Array(8);
        new DataView(stamp.buffer).setBigUint64(0, BigInt(p));
        const pubMessage = concat(enc.encode("BLEEP-PUB-1\n"), lp(enc.encode(kind)), lp(enc.encode(id)), lp(enc.encode(version)), lp(enc.encode(platform)),
                                  lp(enc.encode(dt.keyId)), lp(digest), stamp);
        if (!(await verifySignature(issuerPub, fromB64(receipt.signature), pubMessage))) return result("invalid", { reason: "the publication receipt does not match the release" });
        at = dated = p;
      }
      for (const t of [it, dt]) {
        if (t.notBefore <= at && at <= t.notAfter) continue;
        if (receipt != null) return result("invalid", { reason: "the publication receipt dates the release outside the certificate's validity period" });
        return { ...who, status: "expired", reason: "the certificate is outside its validity period" };
      }
      return { ...who, publishedAt: dated };
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

  // ---- the library ------------------------------------------------------------------------------------

  // localBase: a folder next to the page with the output of `build-web.sh --modules-only` (manifest.json and modules/*.wasm), for
  // development. Its modules replace the library's of the same name, unsigned, but only while "Allow unsigned modules" is on and
  // the page is served from localhost.
  const config = { base: "/registry/v1/", roots: null, channel: "stable", allowUnsigned: { module: false, plugin: false }, crl: null,
                   revocations: true, storage: null, localBase: "local-modules/", hostname: null };  // revocations: fetch the signed list (signing.md section 8); crl: a list given by hand
  let indexPromise = null;
  let localPromise = null;
  let crlPromise = null;
  const packages = new Map();

  const abs = (p) => (typeof document !== "undefined" ? new URL(p, document.baseURI).href : p);
  const signedId = (slug) => slug.replace(".", "/");  // "acme.fuzz" in URLs is "acme/fuzz" in signatures

  async function getJSON(path) {
    const res = await fetch(abs(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function roots() {
    // The roots are pinned: build-web.sh bakes the rootKeys of config/library.json into js/library-roots.js. They are never fetched from the
    // server that serves the packages: that server could name its own root and sign anything.
    if (!config.roots || !config.roots.length) throw new Error("no pinned library root keys: the library cannot be trusted");
    return config.roots;
  }

  // ---- the revocation list (BLEEP-CRL-1, signing.md section 8) ------------------------------------------

  const CRL_SERIAL_KEY = "bleep.library.crl.serial", CRL_LIST_KEY = "bleep.library.crl.list";
  const kv = () => {
    if (config.storage) return config.storage;
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
  };
  const remember = (k, v) => { try { const st = kv(); if (st) st.setItem(k, v); } catch (e) { /* private window or blocked storage: no memory */ } };
  const recall = (k) => { try { const st = kv(); return st ? st.getItem(k) : null; } catch (e) { return null; } };

  /// The body of a revocation list if the issuer's signature holds and the issuer certificate is one of the roots', else null.
  /// Validity dates are not checked: a list can only take trust away.
  async function verifyCrl(doc, rootKeys) {
    try {
      const cert = doc.issuer, tbs = cert.tbs;
      const issuerPub = fromB64(tbs.publicKey);
      if (tbs.type !== "issuer" || !tbs.scopes.includes("issue") || tbs.keyId !== (await keyId(issuerPub))) return null;
      let root = null;
      for (const r of rootKeys) if ((await keyId(r)) === cert.issuer) root = r;
      if (!root || !(await checkCert(cert, root))) return null;
      const body = { format: doc.format, serial: doc.serial, issued: doc.issued, revokedKeys: doc.revokedKeys, revokedArtifacts: doc.revokedArtifacts };
      if (body.format !== 1 || !Number.isSafeInteger(body.serial) || !Array.isArray(body.revokedKeys) || !Array.isArray(body.revokedArtifacts)) return null;
      if (!(await verifySignature(issuerPub, fromB64(doc.signature), concat(enc.encode("BLEEP-CRL-1\n"), enc.encode(canonical(body)))))) return null;
      return { ...body, issuer: cert, signature: doc.signature };
    } catch (e) {
      return null;
    }
  }

  /// The list to apply, or null: fetched from the registry and checked against the pinned roots; the highest serial seen is remembered
  /// and a lower one (a rollback) is ignored in favour of the remembered list. Never throws: with no list (offline, none published)
  /// the library still loads, as in the native client.
  async function revocations() {
    if (config.crl) return config.crl;
    if (!config.revocations) return null;
    if (!crlPromise) {
      crlPromise = (async () => {
        let rootKeys;
        try { rootKeys = await roots(); } catch (e) { return null; }
        const seen = Number(recall(CRL_SERIAL_KEY));
        let best = null;
        try {
          const saved = recall(CRL_LIST_KEY);
          if (saved) best = await verifyCrl(JSON.parse(saved), rootKeys);  // a saved list that no longer checks (other roots) is no list
        } catch (e) { best = null; }
        try {
          const fetched = await verifyCrl(await getJSON(config.base + "revocations.json"), rootKeys);
          if (fetched && (!best || fetched.serial >= best.serial) && !(fetched.serial < seen)) {
            best = fetched;
            remember(CRL_SERIAL_KEY, String(fetched.serial));
            remember(CRL_LIST_KEY, JSON.stringify(fetched));
          }
        } catch (e) { /* offline or no list published: use what was remembered */ }
        return best;
      })();
    }
    return crlPromise;
  }

  /// Is the page served from this computer? Only then is a local development build used, whatever the folder holds: a deployed site
  /// never loads unsigned modules this way, even if the folder was shipped by accident. (config.hostname: for tests.)
  function onLoopback() {
    const h = String(config.hostname || (typeof location !== "undefined" ? location.hostname : "")).toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  }

  /// The local development build's index (manifest.json of build-web.sh --modules-only), or null: none built, unsigned modules not
  /// allowed, or the page is not on this computer.
  function localIndex() {
    if (!config.localBase || !(config.allowUnsigned && config.allowUnsigned.module) || !onLoopback()) return Promise.resolve(null);
    if (!localPromise) {
      localPromise = (async () => {
        try {
          const res = await fetch(abs(config.localBase + "manifest.json"), { cache: "no-store" });
          if (!res.ok) return null;
          const doc = await res.json();
          return doc && typeof doc.modules === "object" ? doc.modules : null;
        } catch (e) { return null; }
      })();
    }
    return localPromise;
  }

  /// { types: {type id → slug}, modules: {slug → {version, entry, types}} } from the library's index, with the local build's modules over it.
  async function manifest() {
    const local = await localIndex();
    let mods = {};
    try {
      if (!indexPromise) indexPromise = getJSON(config.base + "index.json");
      mods = { ...(await indexPromise).channels[config.channel].modules };
    } catch (e) {
      if (!local) throw e;  // a local build alone is enough to run offline
    }
    if (local) for (const [slug, m] of Object.entries(local)) mods[slug] = { version: "local", types: m.types || [], local: m.file };
    const types = {};
    for (const [slug, m] of Object.entries(mods)) for (const t of m.types || []) types[t] = slug;
    return { types, modules: mods };
  }

  /// Downloads a module package, checks it and returns its .wasm. Throws, with the reason, if it must not load.
  function fetchModule(slug) {
    if (!packages.has(slug)) {
      packages.set(slug, (async () => {
        const mods = (await manifest()).modules;
        if (!mods[slug]) throw new Error(`the library has no module ${slug}`);
        if (mods[slug].local) {  // the development build: no package, no signature
          const res = await fetch(abs(config.localBase + mods[slug].local), { cache: "no-store" });
          if (!res.ok) throw new Error(`${mods[slug].local}: ${res.status}`);
          const wasm = await res.arrayBuffer();
          return { wasm, version: "local", publisher: "local build", status: "unsigned", local: true, meta: {}, bytes: wasm.byteLength, spec: null };
        }
        const dir = config.base + mods[slug].entry.replace(/entry\.json$/, "");
        const entry = await getJSON(config.base + mods[slug].entry);
        const file = entry.files.find((f) => f.platform === "any");
        if (!file) throw new Error(`${slug}: no package in the entry`);
        const res = await fetch(abs(dir + file.path));
        if (!res.ok) throw new Error(`${file.path}: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (hex(await sha256(bytes)) !== file.sha256) throw new Error(`${slug}: the download is not the file the library lists`);
        const zip = await readZip(bytes);
        const checked = await verify(zip.entries, file.signature || zip.signature, {
          kind: "module", id: signedId(slug), version: entry.version, platform: "any", roots: await roots(), crl: await revocations(), receipt: file.publication || null });
        const [ok, why] = decide(checked, "module", config.allowUnsigned);
        if (!ok) throw new Error(`${slug} ${entry.version} is not loaded: ${why}`);
        const wasm = zip.files.get("module.wasm");
        if (!wasm) throw new Error(`${slug}: the package has no module.wasm`);
        const specFile = zip.files.get("spec.json");  // the node types the module describes (the board UI's type list entries)
        return { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength), version: entry.version, publisher: checked.publisher,
                 status: checked.status, meta: JSON.parse(dec.decode(zip.files.get("module.json"))), bytes: bytes.length,
                 spec: specFile ? JSON.parse(dec.decode(specFile)) : null };
      })());
      packages.get(slug).catch(() => packages.delete(slug));  // a failed download is tried again next time
    }
    return packages.get(slug);
  }

  const BleepLibrary = {
    /// Changing roots, the revocation list or the unsigned setting forgets what was verified under the old ones.
    configure(o) { Object.assign(config, o); indexPromise = null; crlPromise = null; localPromise = null; packages.clear(); return BleepLibrary; },
    config, manifest, fetchModule, revocations, localIndex,
    // for tests and other tools
    canonical, contentDigest, readZip, verify, decide, keyId, hex, fromHex, fromB64,
  };
  root.BleepLibrary = BleepLibrary;
  if (typeof module !== "undefined" && module.exports) module.exports = BleepLibrary;
})(typeof window !== "undefined" ? window : globalThis);
