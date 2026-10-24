// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// web-settings.js — what Bleep Play's Settings section (board/ui/settings.js) shows and changes in the browser: the output device and
// latency mode, which MIDI inputs play, the link to the app, the library's channel and the unsigned-modules switch, and the data this
// page keeps (doc/specs/settings.md §4). The page asks through the board's native "settings" call; board-demo.js hands it to
// BleepWeb.settings, which is `create(env).call` below.
//
// The environment is passed in so the tests can run it without a browser:
//   storage         localStorage (or null, or something that throws: the settings then last for the visit only)
//   audio()         { running, rate, baseLatency, outputLatency } of the AudioContext, or null before audio started
//   setSink(id)     route the output to a device ("" = default); rejects when the browser refuses
//   devices()       Promise of MediaDeviceInfo-like { kind, deviceId, label }; empty without permission
//   canSelectOutput whether the browser can route the output at all (AudioContext.setSinkId)
//   midi()          null before access was asked, else { supported, inputs: [{ id, name }] }
//   askMidi()       Promise: asks the browser for MIDI access
//   bridge()        BleepWeb.bridgeUI ({ connected, busy, text, bad, client, connect }) or null
//   library         { configure(opts) } (library-client.js)
//   reload()        reloads the page
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BleepWebSettings = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "bleep.web.settings";
  const LATENCY = ["interactive", "balanced", "playback"];
  const CHANNELS = ["stable", "beta"];
  // What clear() removes, by prefix. "all" is everything this page keeps.
  const KINDS = {
    board: ["bleep-demo-board"],
    presets: ["bleep-demo-presets"],
    settings: [KEY],
  };
  const ALL = ["bleep-demo-", "bleep.web.", "bleep.library."];

  const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);

  function sanitise(v) {
    const o = v && typeof v === "object" ? v : {};
    return {
      output: typeof o.output === "string" ? o.output : "",
      latency: LATENCY.includes(o.latency) ? o.latency : "interactive",
      midiOff: strings(o.midiOff),
      channel: CHANNELS.includes(o.channel) ? o.channel : "stable",
      allowUnsignedModule: o.allowUnsignedModule === true,
    };
  }

  function create(env) {
    let stored = true;     // false once the storage refused (private window): the choices then last for the visit
    let saved = null;
    try { saved = env.storage ? JSON.parse(env.storage.getItem(KEY)) : null; } catch (e) { saved = null; }
    const s = sanitise(saved);
    if (!env.storage) stored = false;
    // What the library was configured with at this page load: changing it needs a reload (the index is read once).
    const applied = { channel: s.channel, allowUnsignedModule: s.allowUnsignedModule };
    let note = "";         // the last problem, shown once

    const persist = () => {
      if (!env.storage) return;
      try { env.storage.setItem(KEY, JSON.stringify(s)); stored = true; } catch (e) { stored = false; }
    };

    /// Applies the saved library choices. Called once, before the library is first used.
    const applyLibrary = () => {
      if (env.library) env.library.configure({ channel: s.channel, allowUnsigned: { module: s.allowUnsignedModule, plugin: false } });
    };

    const outputs = async () => {
      let list = [];
      try { list = (await env.devices()).filter((d) => d.kind === "audiooutput"); } catch (e) { list = []; }
      return list.filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
                 .map((d, i) => ({ id: d.deviceId, name: d.label || "Output " + (i + 1) }));
    };

    async function state() {
      const a = env.audio();
      const midi = env.midi();
      const b = env.bridge ? env.bridge() : null;
      const outs = env.canSelectOutput ? await outputs() : [];
      // A saved device that is gone falls back to the default (spec §4.2).
      const output = outs.some((d) => d.id === s.output) ? s.output : "";
      const out = {
        host: "web",
        stored,
        webAudio: {
          canSelectOutput: !!env.canSelectOutput,
          outputs: outs,
          output,
          latency: s.latency,
          latencies: LATENCY,
          running: !!a,
          rate: a ? a.rate : 0,
          baseLatencyMs: a ? (a.baseLatency || 0) * 1000 : 0,
          outputLatencyMs: a ? (a.outputLatency || 0) * 1000 : 0,
          // The context is made with the latency of the page load: a different choice waits for a reload.
          reload: !!a && s.latency !== (a.latencyHint || "interactive"),
        },
        webMidi: midi
          ? { supported: midi.supported, asked: true, inputs: midi.inputs.map((i) => ({ id: i.id, name: i.name, on: !s.midiOff.includes(i.name) })) }
          : { supported: !!env.midiSupported, asked: false, inputs: [] },
        webApp: b ? { available: true, connected: !!b.connected, busy: !!b.busy, text: b.text || "", bad: !!b.bad } : { available: false },
        webLib: {
          channel: s.channel, channels: CHANNELS, allowUnsigned: { module: s.allowUnsignedModule },
          reload: s.channel !== applied.channel || s.allowUnsignedModule !== applied.allowUnsignedModule,
        },
        webData: { kinds: ["board", "presets", "settings", "all"] },
      };
      if (note) { out.error = note; note = ""; }
      return out;
    }

    function clear(what) {
      const st = env.storage;
      if (!st) return;
      const prefixes = what === "all" ? ALL : KINDS[what];
      if (!prefixes) { note = "Unknown kind of data: " + what; return; }
      const keys = [];
      try { for (let i = 0; i < st.length; i++) keys.push(st.key(i)); } catch (e) { return; }
      for (const k of keys) if (prefixes.some((p) => k === p || k.startsWith(p))) { try { st.removeItem(k); } catch (e) { /* blocked */ } }
    }

    async function call(fn, arg) {
      arg = arg || {};
      switch (fn) {
        case "get": break;
        case "webAudio":
          if (typeof arg.output === "string") {
            const known = arg.output === "" || (await outputs()).some((d) => d.id === arg.output);
            if (!known) { note = "That output is not available any more."; break; }
            try { await env.setSink(arg.output); s.output = arg.output; persist(); }
            catch (e) { note = "The browser would not use that output: " + (e && e.message ? e.message : e); }
          }
          if (LATENCY.includes(arg.latency)) { s.latency = arg.latency; persist(); }
          if (arg.reload === true) env.reload();
          break;
        case "webMidi":
          if (arg.allow === true) { try { await env.askMidi(); } catch (e) { note = "MIDI access was not given. Allow it in the browser's site settings."; } }
          if (typeof arg.name === "string" && typeof arg.on === "boolean") {
            s.midiOff = arg.on ? s.midiOff.filter((n) => n !== arg.name) : (s.midiOff.includes(arg.name) ? s.midiOff : s.midiOff.concat(arg.name));
            persist();
          }
          break;
        case "webApp": {
          const b = env.bridge ? env.bridge() : null;
          if (arg.connect === true && b && !b.busy && !b.connected) b.connect();
          break;
        }
        case "webLibrary":
          if (CHANNELS.includes(arg.channel)) s.channel = arg.channel;
          if (arg.allowUnsigned && typeof arg.allowUnsigned.module === "boolean") s.allowUnsignedModule = arg.allowUnsigned.module;
          persist();
          if (arg.reload === true) env.reload();
          break;
        case "webClear":
          clear(arg.what);
          if (arg.what === "settings" || arg.what === "all") { Object.assign(s, sanitise(null)); stored = !!env.storage; }
          if (arg.reload !== false && (arg.what === "board" || arg.what === "all")) env.reload();
          break;
        default: note = "Unknown setting: " + fn;
      }
      return state();
    }

    return {
      call,
      /// For the engine: the `latencyHint` to make the AudioContext with, the saved output, and whether an input plays.
      latencyHint: () => s.latency,
      output: () => s.output,
      midiIgnored: (name) => s.midiOff.includes(name),
      applyLibrary,
    };
  }

  return { create, KEY, LATENCY, CHANNELS };
});
