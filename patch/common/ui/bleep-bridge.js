// SPDX-License-Identifier: MIT
// bridge.js — minimal client for JUCE's WebBrowserComponent native integration.
//   native("describe").then(...)      calls a C++ native function
//   onNative("state", fn)             listens to events emitted by C++
// Outside a plugin (plain browser) it falls back to a demo backend so the UI
// can be developed with any static file server.
(function () {
  "use strict";
  const pending = new Map();
  let nextId = 1;
  const backend = () => window.__JUCE__ && window.__JUCE__.backend;

  function ensureCompletionListener() {
    if (ensureCompletionListener.done || !backend()) return;
    ensureCompletionListener.done = true;
    backend().addEventListener("__juce__complete", ({ promiseId, result }) => {
      const p = pending.get(promiseId);
      if (p) { pending.delete(promiseId); p(result); }
    });
  }

  window.native = function (name, ...params) {
    if (!backend()) return Promise.resolve(window.BleepDemo ? window.BleepDemo.call(name, params) : null);
    ensureCompletionListener();
    const resultId = nextId++;
    return new Promise((resolve) => {
      pending.set(resultId, resolve);
      backend().emitEvent("__juce__invoke", { name, params, resultId });
    });
  };

  window.onNative = function (event, fn) {
    if (backend()) backend().addEventListener(event, fn);
    else if (window.BleepDemo) window.BleepDemo.listen(event, fn);
  };
})();
