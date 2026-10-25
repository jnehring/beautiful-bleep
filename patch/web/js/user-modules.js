// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// user-modules.js — the modules made from a Code node ("Convert to module"): kept in this browser (IndexedDB), offered in the Add menu like any
// module and loaded by the library client. They run in the same WebAssembly sandbox as every module; their own UI runs in the
// same sandboxed worker frame as a Code node's.
//
//   BleepUserModules.load()      Promise<Map slug → entry>: reads the store once (an in-memory store where the browser has none)
//   BleepUserModules.list()      entries, oldest first (after load)
//   BleepUserModules.get(slug)   entry | undefined
//   BleepUserModules.put(entry)  Promise: saves it (a slug that exists is replaced) and calls the listeners
//   BleepUserModules.remove(slug)
//   BleepUserModules.index()     { slug: { types, spec } } for the library client's manifest
//   BleepUserModules.onChange(fn)
//   BleepUserModules.typeId(publisher, slug) / keyOf(publisher, slug) / slugOf(name)   the node type id of a module ("<publisher>/<slug>"), its key
//                                    in the store ("<publisher>.<slug>") and the slug a name (or a publisher) makes
//   entry: { slug (the key), type, publisher, name, category, source, view, help, meta, settings, spec: [node type description], wasm: ArrayBuffer,
//            saved: ms }
(function (root) {
  "use strict";
  const DB = "bleep-user-modules", STORE = "modules";
  const LOCAL = "mine";   // the publisher of a module nobody has signed in for
  const entries = new Map();
  const listeners = [];
  let loading = null, db = null, version = 0;

  const open = () => new Promise((resolve) => {
    let req;
    try { req = root.indexedDB && root.indexedDB.open(DB, 1); } catch (e) { req = null; }
    if (!req) { resolve(null); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "slug" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  const run = (mode, fn) => new Promise((resolve, reject) => {
    if (!db) { resolve(); return; }
    const tx = db.transaction(STORE, mode), r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r && r.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("the browser could not store the module"));
  });
  const changed = () => { version++; for (const f of listeners.slice()) try { f(); } catch (e) { /* a listener's mistake is its own */ } };

  const BleepUserModules = {
    LOCAL,
    slugOf: (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48),
    typeId: (publisher, slug) => `${publisher || LOCAL}/${slug}`,
    keyOf: (publisher, slug) => `${publisher || LOCAL}.${slug}`,
    /// True where the modules survive a reload (the browser let us open a database).
    persistent: () => !!db,
    version: () => version,
    load() {
      if (!loading) loading = (async () => {
        db = await open();
        if (db) {
          const all = (await run("readonly", (s) => s.getAll())) || [];
          for (const e of all) entries.set(e.slug, e);
        }
        return entries;
      })();
      return loading;
    },
    list: () => [...entries.values()].sort((a, b) => a.saved - b.saved),
    get: (slug) => entries.get(slug),
    async put(entry) {
      await BleepUserModules.load();
      const e = { ...entry, saved: Date.now() };
      await run("readwrite", (s) => s.put(e));
      entries.set(e.slug, e);
      changed();
    },
    async remove(slug) {
      await BleepUserModules.load();
      await run("readwrite", (s) => s.delete(slug));
      entries.delete(slug);
      changed();
    },
    index() {
      const out = {};
      for (const e of entries.values()) out[e.slug] = { types: (e.spec || []).map((t) => t.type), spec: e.spec };
      return out;
    },
    onChange: (fn) => { listeners.push(fn); },
  };
  root.BleepUserModules = BleepUserModules;
  if (typeof module !== "undefined" && module.exports) module.exports = BleepUserModules;
})(typeof window !== "undefined" ? window : globalThis);
