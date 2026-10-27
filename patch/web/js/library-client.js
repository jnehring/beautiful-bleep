// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// library-client.js — the Bleep Library, from the browser (developers/modules/library.md).
//
// Finds the package of a node type in the library's index, downloads it, checks that the download is the file the index lists,
// reads the package (the same rules as patch/library/Package.cpp; the packages in patch/tests/library-fixtures give both the same
// verdicts), and hands out the module's .wasm.
//
//   BleepLibrary.configure({ base: "/registry/v1/", channel: "stable" })
//   const manifest = await BleepLibrary.manifest();        // { types: {type → slug}, modules: {slug → {version, types, …}} }
//   const m = await BleepLibrary.fetchModule("reverb");    // { wasm: ArrayBuffer, version, meta, … }
//
// Only fetch, DecompressionStream and WebCrypto (the SHA-256 of a download) are used.
(function (root) {
  "use strict";

  const dec = new TextDecoder();

  // ---- bytes -----------------------------------------------------------------------------------

  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));

  const safePath = (p) => !!p && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && p.split("/").every((x) => x !== "" && x !== "." && x !== "..");

  // ---- zip (stored and deflate; no zip64, no encryption: what package-module.py writes) ------------------

  async function inflateRaw(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /// Reads a zip into { files: Map path → Uint8Array }. A META/signature.json of an older package is left out.
  /// Refuses duplicates, symlinks and unsafe paths.
  async function readZip(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    const count = v.getUint16(eocd + 10, true);
    let at = v.getUint32(eocd + 16, true);
    const files = new Map();
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
      if (!safePath(name)) throw new Error("bad path in package: " + name);
      if (name === "META/signature.json") continue;  // packages of an older library carry one; nothing looks at it any more
      if (files.has(name)) throw new Error("duplicate file in package: " + name);
      if (v.getUint32(local, true) !== 0x04034b50) throw new Error("bad zip entry: " + name);
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = data.subarray(start, start + size);
      let body;
      if (method === 0) body = raw.slice();
      else if (method === 8) body = await inflateRaw(raw);
      else throw new Error("unsupported compression in " + name);
      if (body.length !== usize) throw new Error("size mismatch in " + name);
      files.set(name, body);
    }
    return { files };
  }

  // ---- the library ------------------------------------------------------------------------------------

  // localBase: a folder next to the page with the output of `build-web.sh --modules-only` (manifest.json and modules/*.wasm), for
  // development. Its modules replace the library's of the same name, but only while the page is served from localhost.
  const config = { base: "/registry/v1/", channel: "stable", localBase: "local-modules/", hostname: null };
  let indexPromise = null;
  let localPromise = null;
  const packages = new Map();

  const abs = (p) => (typeof document !== "undefined" ? new URL(p, document.baseURI).href : p);

  async function getJSON(path) {
    const res = await fetch(abs(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  /// Is the page served from this computer? Only then is a local development build used, whatever the folder holds: a deployed site
  /// never loads modules this way, even if the folder was shipped by accident. (config.hostname: for tests.)
  function onLoopback() {
    const h = String(config.hostname || (typeof location !== "undefined" ? location.hostname : "")).toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  }

  /// The local development build's index (manifest.json of build-web.sh --modules-only), or null: none built, or the page is not on this computer.
  function localIndex() {
    if (!config.localBase || !onLoopback()) return Promise.resolve(null);
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
    const mine = root.BleepUserModules;   // the modules the user made from a Code node (user-modules.js)
    if (mine) await mine.load();
    let mods = {};
    try {
      if (!indexPromise) indexPromise = getJSON(config.base + "index.json");
      mods = { ...(await indexPromise).channels[config.channel].modules };
    } catch (e) {
      if (!local && !(mine && mine.list().length)) throw e;  // a local build, or the user's own modules, are enough to run offline
    }
    if (local) for (const [slug, m] of Object.entries(local)) mods[slug] = { version: "local", built: m.built || "", types: m.types || [], local: m.file, spec: m.spec || null, script: m.script || null };
    // Kept in this browser, their own code.
    if (mine) for (const [slug, m] of Object.entries(mine.index())) mods[slug] = { version: "user", types: m.types || [], user: true, spec: m.spec || null };
    const types = {};
    for (const [slug, m] of Object.entries(mods)) for (const t of m.types || []) types[t] = slug;
    return { types, modules: mods };
  }

  /// Is every file one a module an account uploaded may bring? Data and the sandboxed .wasm, no page scripts. The library refuses the
  /// rest at upload; the client checks again.
  const COMMUNITY_FILES = /^(module\.json|module\.wasm|spec\.json|LICENSE|view\.sandbox\.js|source\.dsp\.ts|image\.(png|jpg|webp)|doc\/[A-Za-z0-9._-]+\.(md|png))$/;
  const communityFilesOk = (names) => { for (const n of names) if (!COMMUNITY_FILES.test(n)) return `${n} is not allowed in a community module`; return ""; };

  /// Downloads a module package, checks it and returns its .wasm. Throws, with the reason, if it must not load.
  /// `version`: exactly that version, not the newest (a board pins it). The library keeps every version it published, each at
  /// modules/<slug>/<version>/entry.json; checked like any other download.
  function fetchModule(slug, version) {
    const key = version ? `${slug}@${version}` : slug;
    if (!packages.has(key)) {
      packages.set(key, (async () => {
        const mods = (await manifest()).modules;
        if (!mods[slug]) throw new Error(`the library has no module ${slug}`);
        let entryPath = mods[slug].entry;
        if (version) {
          if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${slug}: ${version} is not a version`);
          if (version === mods[slug].version || mods[slug].user || mods[slug].local) return fetchModule(slug);   // the newest (or a module with just one version)
          entryPath = `modules/${slug}/${version}/entry.json`;
        }
        if (mods[slug].user) {  // a module the user made: the bytes are in this browser
          const e = root.BleepUserModules.get(slug);
          if (!e) throw new Error(`the module ${slug} is not stored in this browser any more`);
          const wasm = e.wasm.slice(0);
          return { wasm, version: "user", publisher: "you", local: true, meta: {}, bytes: wasm.byteLength, spec: e.spec || null };
        }
        if (mods[slug].local) {  // the development build: no package
          const res = await fetch(abs(config.localBase + mods[slug].local), { cache: "no-store" });
          if (!res.ok) throw new Error(`${mods[slug].local}: ${res.status}`);
          const wasm = await res.arrayBuffer();
          // a script module (Bleep Script) of the build: its own UI, source and help page sit beside the .wasm
          const extra = mods[slug].script || {};
          const text = async (rel) => { if (!rel) return ""; try { const r = await fetch(abs(config.localBase + rel), { cache: "no-store" }); return r.ok ? await r.text() : ""; } catch (e) { return ""; } };
          return { wasm, version: "local", publisher: "local build", localBuild: true, local: true, meta: {}, bytes: wasm.byteLength, spec: mods[slug].spec || null,
                   view: await text(extra.view), source: await text(extra.source), help: await text(extra.help) };   // spec: the node types of a script module, which no demo-types.json lists
        }
        const dir = config.base + entryPath.replace(/entry\.json$/, "");
        const entry = await getJSON(config.base + entryPath);
        if (version && entry.version !== version) throw new Error(`${slug}: the library's entry for ${version} is for ${entry.version}`);
        const file = entry.files.find((f) => f.platform === "any");
        if (!file) throw new Error(`${slug}: no package in the entry`);
        const res = await fetch(abs(dir + file.path));
        if (!res.ok) throw new Error(`${file.path}: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (hex(await sha256(bytes)) !== file.sha256) throw new Error(`${slug}: the download is not the file the library lists`);
        const zip = await readZip(bytes);
        if (file.uploaded === true) {   // a package an account uploaded: data and the sandboxed .wasm only
          const extra = communityFilesOk(zip.files.keys());
          if (extra) throw new Error(`${slug} ${entry.version} is not loaded: ${extra}`);
        }
        const wasm = zip.files.get("module.wasm");
        if (!wasm) throw new Error(`${slug}: the package has no module.wasm`);
        const specFile = zip.files.get("spec.json");  // the node types the module describes (the board UI's type list entries)
        // the module's own picture (only ever run in the sandboxed frame, never in the page), its help page and, when the author shared it, its source
        const viewFile = zip.files.get("view.sandbox.js"), sourceFile = zip.files.get("source.dsp.ts"), docName = [...zip.files.keys()].find((n) => /^doc\/[^/]+\.md$/.test(n));
        return { wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength), version: entry.version, community: file.uploaded === true,
                 meta: JSON.parse(dec.decode(zip.files.get("module.json"))), bytes: bytes.length,
                 spec: specFile ? JSON.parse(dec.decode(specFile)) : null, view: viewFile ? dec.decode(viewFile) : "", source: sourceFile ? dec.decode(sourceFile) : "", help: docName ? dec.decode(zip.files.get(docName)) : "" };
      })());
      packages.get(key).catch(() => packages.delete(key));  // a failed download is tried again next time
    }
    return packages.get(key);
  }

  const BleepLibrary = {
    /// Changing the channel forgets what was downloaded under the old one.
    configure(o) { Object.assign(config, o); indexPromise = null; localPromise = null; packages.clear(); return BleepLibrary; },
    config, manifest, fetchModule, localIndex,
    /// Forget a downloaded or stored package (a module the user replaced).
    forget(slug) { packages.delete(slug); },
    // for tests and other tools
    readZip, communityFilesOk, hex,
  };
  root.BleepLibrary = BleepLibrary;
  if (typeof module !== "undefined" && module.exports) module.exports = BleepLibrary;
})(typeof window !== "undefined" ? window : globalThis);
