// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// bleep-bridge.js — the page's client for JUCE's WebBrowserComponent native integration, and the lock on it.
//
// Module views (modules/<name>/ui/*.js) are third-party code that runs in this page, in the same JavaScript
// realm as the board. Nothing in the page is a sandbox, so the privileged parts are kept out of their reach:
//
//   * This file runs first. It captures everything it needs from the platform (the message handler, JSON, the
//     random number generator) into its own closure, and reads the per-process secret that the native side
//     hands to the top frame of every page load (a one-shot getter, `window.__bleepBoot`, from a user script).
//     Every native call carries that secret as its first parameter; the native side drops calls without it
//     (BoardWindow.cpp, `gated`). The secret lives only in this closure, never on `window`.
//   * The board's own scripts get their handles from `window.BleepSeal` (native, onNative and `priv`, the
//     private namespace that holds BleepAccount, BleepStoreView, ... instead of `window`).
//   * `BleepSeal.seal()`, called by board.js before the first module view is loaded, removes BleepSeal, the
//     demo engine and the raw __JUCE__ object from `window`, freezes the JavaScript built-ins (so a view cannot
//     patch JSON.stringify, Promise, Array.prototype ... to spy on or hijack the board's code), freezes the public
//     view API and blocks synthetic (script-made) mouse, keyboard and submit events.
//
// What this does not do: the view scripts still share the page's DOM and can read and drive it, and they can call
// the `api` they are given (parameters, their own presets, media import). That is the view API, not the bridge.
//
//   native("describe").then(...)      calls a C++ native function (trusted scripts: BleepSeal.native)
//   onNative("state", fn)             listens to events emitted by C++
// Outside a plugin (plain browser) it falls back to a demo backend so the UI can be developed with any static
// file server.
(function () {
  "use strict";
  const win = window;
  // tests/board_smoke.cpp drives the page from outside through window globals; its build sets this (never a release).
  const noSeal = win.__BLEEP_NO_SEAL__ === true;

  // Uncaught errors, for the smoke test and the console.
  win.__errors = [];
  win.addEventListener("error", (e) => win.__errors.push(String(e.message)));
  win.addEventListener("unhandledrejection", (e) => win.__errors.push(String(e.reason)));

  // ---- captured before any other script runs
  const stringify = JSON.stringify.bind(JSON);
  const getRandomValues = win.crypto && win.crypto.getRandomValues ? win.crypto.getRandomValues.bind(win.crypto) : null;
  const juce = win.__JUCE__ && win.__JUCE__.backend ? win.__JUCE__ : null;
  const backend = juce ? juce.backend : null;
  const addBackendListener = backend ? backend.addEventListener.bind(backend) : null;
  const emitByBackend = backend ? backend.emitByBackend.bind(backend) : null;
  // The platform's own message channel, so that nothing depends on `window.webkit` / `window.chrome` later.
  let rawPost = null;
  {
    const wk = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.__JUCE__;
    const wv = win.chrome && win.chrome.webview;
    if (wk && typeof wk.postMessage === "function") rawPost = wk.postMessage.bind(wk);
    else if (wv && typeof wv.postMessage === "function") rawPost = wv.postMessage.bind(wv);
    else if (juce && typeof juce.postMessage === "function") rawPost = juce.postMessage.bind(juce);
  }
  // The secret (null when the native side does not use one, e.g. the Ableton panel view).
  let secret = null;
  {
    const boot = win.__bleepBoot;
    if (typeof boot === "function") {
      try { const s = boot(); if (typeof s === "string" && s) secret = s; } catch (e) { /* none */ }
      try { delete win.__bleepBoot; } catch (e) { /* none */ }
    }
  }

  // ---- native calls
  const pending = new Map();
  /// An id nobody can guess, so that a forged "__juce__complete" cannot resolve a call of the board's.
  function newId() {
    for (;;) {
      let id;
      if (getRandomValues) {
        const u = getRandomValues(new Uint32Array(2));
        id = (u[0] & 0x1fffff) * 4294967296 + u[1];
      } else id = Math.floor(Math.random() * 9007199254740991);
      if (id > 0 && !pending.has(id)) return id;
    }
  }
  let completionHooked = false;
  function hookCompletions() {
    if (completionHooked || !addBackendListener) return;
    completionHooked = true;
    addBackendListener("__juce__complete", (m) => {
      const id = m && m.promiseId, p = pending.get(id);
      if (p) { pending.delete(id); p(m.result); }
    });
  }

  let demo = null;  // the demo engine (board-demo.js), captured at seal(); until then looked up in `window`
  const getDemo = () => demo || win.BleepDemo || null;

  function native(name, ...params) {
    if (!backend || !rawPost) {
      const d = getDemo();
      return Promise.resolve(d ? d.call(name, params) : null);
    }
    hookCompletions();
    const resultId = newId();
    return new Promise((resolve) => {
      pending.set(resultId, resolve);
      rawPost(stringify({ eventId: "__juce__invoke", payload: { name, params: secret === null ? params : [secret, ...params], resultId } }));
    });
  }

  function onNative(event, fn) {
    if (backend) addBackendListener(event, fn);
    else { const d = getDemo(); if (d) d.listen(event, fn); }
  }

  // ---- the lock
  const INTRINSICS = ["Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Promise", "Map", "Set", "WeakMap",
    "WeakSet", "WeakRef", "RegExp", "Date", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError", "ReferenceError", "URIError",
    "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
    "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "JSON", "Math", "Reflect", "Proxy", "Atomics", "Intl"];
  function freezeIntrinsics() {
    const freeze = (o) => { if (o && (typeof o === "object" || typeof o === "function")) try { Object.freeze(o); } catch (e) { /* none */ } };
    for (const n of INTRINSICS) {
      const c = win[n];
      if (!c) continue;
      freeze(c);
      freeze(c.prototype);
    }
    const proto = Object.getPrototypeOf;
    freeze(proto(Uint8Array)); freeze(proto(Uint8Array).prototype);  // %TypedArray%
    for (const f of [function* () {}, async function () {}, async function* () {}]) {
      freeze(proto(f)); freeze(proto(f).prototype);
    }
    for (const it of [[][Symbol.iterator](), new Map()[Symbol.iterator](), new Set()[Symbol.iterator](), ""[Symbol.iterator](), (function* () {})()]) {
      const p = proto(it);
      freeze(p); freeze(proto(p));
    }
  }

  /// A file offered for download by the board's own code (Download Project): the one script-made click that is let through. The anchor
  /// is made here, in the closure; a view script cannot add an element to `trusted`, so it cannot make its own downloads this way.
  const trusted = new WeakSet();
  const doc = win.document || null;
  const makeElement = doc && doc.createElement ? doc.createElement.bind(doc) : null;
  const createObjectURL = win.URL && win.URL.createObjectURL ? win.URL.createObjectURL.bind(win.URL) : null;
  const revokeObjectURL = win.URL && win.URL.revokeObjectURL ? win.URL.revokeObjectURL.bind(win.URL) : null;
  const BlobCtor = win.Blob || null;
  const later = win.setTimeout ? win.setTimeout.bind(win) : null;
  function download(text, name, type) {
    if (!makeElement || !createObjectURL || !BlobCtor || !doc.body) return false;
    const a = makeElement("a");
    const url = createObjectURL(new BlobCtor([String(text)], { type: type || "application/octet-stream" }));
    a.href = url;
    a.download = String(name);
    trusted.add(a);
    doc.body.appendChild(a);
    a.click();
    a.remove();
    if (later && revokeObjectURL) later(() => revokeObjectURL(url), 10000);
    return true;
  }

  /// Script-made input (el.click(), dispatchEvent(new MouseEvent(...))) cannot be the user: the dialogs that
  /// install, remove, share or sign in are only ever answered by real events. File inputs are the one exception
  /// (the view helpers open their chooser with input.click(); the browser still wants the user's own gesture then).
  function blockSyntheticInput() {
    const types = ["click", "dblclick", "auxclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "submit", "contextmenu"];
    const stop = (e) => {
      if (e.isTrusted) return;
      const t = e.target;
      if (t && trusted.has(t)) return;
      if (t && t.tagName === "INPUT" && t.type === "file") return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    for (const t of types) win.addEventListener(t, stop, true);
  }

  let sealed = false;
  const priv = noSeal ? win : Object.create(null);  // BleepAccount, BleepLibraryView, ... of the board's own scripts
  const seal = () => {
    if (sealed || noSeal) return;
    sealed = true;
    demo = win.BleepDemo || null;
    try { delete win.BleepDemo; } catch (e) { /* none */ }
    if (juce) {
      // The native side still calls window.__JUCE__.backend.emitByBackend(...) to answer and to push events; nothing else is left.
      const facade = Object.freeze({ backend: Object.freeze({ emitByBackend: (id, o) => emitByBackend(id, o) }), postMessage() {}, initialisationData: Object.freeze({}) });
      try { Object.defineProperty(win, "__JUCE__", { value: facade, writable: false, configurable: false }); } catch (e) { /* keep */ }
    }
    try { delete win.BleepSeal; } catch (e) { win.BleepSeal = undefined; }
    for (const n of ["BleepView", "BleepViews", "BleepMarkdown"]) if (win[n]) try { Object.freeze(win[n]); } catch (e) { /* none */ }
    blockSyntheticInput();
    freezeIntrinsics();
  };

  if (noSeal) { win.native = native; win.onNative = onNative; }  // the smoke test calls them from outside
  Object.defineProperty(win, "BleepSeal", { value: Object.freeze({ native, onNative, priv, seal, download, demo: getDemo, testHooks: noSeal }), configurable: true, writable: true });
})();
