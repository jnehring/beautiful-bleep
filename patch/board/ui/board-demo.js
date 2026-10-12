// SPDX-License-Identifier: MIT
// board-demo.js — a fake engine so the board runs in a plain browser
// (python3 scripts/run/ui-server.py). Inactive inside a plugin. It keeps a small
// demo set, an undo stack and cell presets in localStorage, and animates
// outputs; it does not process audio.
(function () {
  "use strict";
  if (window.__JUCE__) return;

  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let types = [];
  const typeOf = (t) => types.find((x) => x.type === t);
  let board = null;
  let undo = [], redo = [];
  let watched = [];
  const ports = {
    "p-main": { kind: "patch", track: "Master", live: true, main: true },
    "p-keys": { kind: "midi-in", track: "Keys", live: true, main: false },
    "p-synth": { kind: "audio-out", track: "Synth", live: true, main: false },
    "p-drums": { kind: "audio-in", track: "Drums", live: false, main: false },
  };
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  /// Cell presets and the other libraries (kind "drums": Drum Grid patterns).
  const presetKey = (kind) => (kind && kind !== "cell" ? `bleep-demo-presets-${kind}` : "bleep-demo-presets");

  function node(id, type, name, x, y, extra) {
    const t = typeOf(type);
    const params = {};
    for (const p of t.params) params[p.id] = p.default;
    return Object.assign({ id, type, name, x, y, parent: "", muted: false, params }, extra || {});
  }
  const cable = (id, fn, fj, tn, tj, amount) => ({ id, from: { node: fn, jack: fj }, to: { node: tn, jack: tj }, amount });

  function demoBoard() {
    return {
      format: 1, id: "demo",
      nodes: [
        node("keys", "midi-in", "Keys", 40, 40, { port: "p-keys", track: "Keys", colour: "#a78bfa" }),
        node("drums", "audio-in", "Drums", 40, 330, { port: "p-drums", track: "Drums", colour: "#ff9f6b" }),
        node("macros", "macros", "Macros", 40, 560, { port: "p-main" }),
        node("wobble", "function", "Wobble", 300, 90),
        node("filter", "filter", "Filter", 540, 240),
        node("synth", "audio-out", "Synth", 800, 120, { port: "p-synth", track: "Synth", colour: "#ff6b6b" }),
      ],
      cables: [
        cable("k1", "wobble", "a", "filter", "cutoff", 0.4),
        cable("k2", "drums", "l", "filter", "l", 1),
        cable("k3", "filter", "l", "synth", "l", 1),
        cable("k4", "filter", "r", "synth", "r", 1),
        cable("k5", "keys", "gate", "wobble", "trig", 1),
      ],
    };
  }

  /// A little of the engine's sanitise(): dangling cables go, ports stay.
  function sanitise(next) {
    const ids = new Set(next.nodes.map((n) => n.id));
    for (const n of board.nodes) {
      const t = typeOf(n.type);
      if (n.port && !ids.has(n.id) && !(t && t.creatable)) { next.nodes.push(n); ids.add(n.id); }
    }
    next.cables = next.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node));
    return next;
  }

  /// MIDI Device nodes the user added are live ports of the browser build.
  function syncPorts() {
    if (!board) return;
    for (const n of board.nodes) {
      const t = typeOf(n.type);
      if (n.port && t && t.port === "midi-device")
        ports[n.port] = { kind: "midi-device", track: n.device || "", live: true, main: false };
      // [bridge] a Live port mirrored in an earlier visit: a ghost until the web link announces it again
      else if (n.port && n.port.startsWith("link:") && !ports[n.port]) ports[n.port] = { kind: n.type, track: n.name, live: false, main: false };
    }
  }
  const message = () => (syncPorts(), { board, ports, canUndo: undo.length > 0, canRedo: redo.length > 0,
                           status: (window.BleepWeb && BleepWeb.status) || "Demo · no audio · latency 256 smp" });
  function save() { store.set("bleep-demo-board", board); }
  function pushUndo() { undo.push(JSON.stringify(board)); if (undo.length > 200) undo.shift(); redo = []; }

  function paramText(p, v) {
    if (p.kind === "bool") return v >= 0.5 ? "On" : "Off";
    // The knob's value in its own units, as ParamSpec::fromNormalised (exponential and skewed knobs included).
    let x = p.min + v * (p.max - p.min);
    if (p.map === "exp") x = p.min * Math.pow(p.max / p.min, v);
    else if (p.map === "skew") x = v <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(v) / (Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min))));
    if (p.kind === "choice") return p.choices[Math.round(x - p.min)] || "";
    if (p.kind === "int") return String(Math.round(x));
    return x.toFixed(2);
  }

  /// A stand-in for the Monitor's live state: a slow arpeggio with a CC sweep, an LFO, a gate and a beat.
  const monitorRuns = new Map();
  function monitorDemo(id, now) {
    let r = monitorRuns.get(id);
    if (!r) monitorRuns.set(id, (r = { count: 0, log: [], held: new Set(), step: -1, gates: 0, ccAt: 0 }));
    const log = (e) => { r.log.push(e); r.count++; if (r.log.length > 64) r.log.shift(); };
    const step = Math.floor(now * 3);   // a note every third of a second
    const arp = [60, 64, 67, 72, 67, 64];
    if (step !== r.step) {
      const off = r.step >= 0 ? arp[r.step % arp.length] : -1;
      if (off >= 0) { log([1, 0, off, 0]); r.held.delete(off); }
      const on = arp[step % arp.length];
      log([0, 0, on, 70 + ((step * 17) % 50)]);
      r.held.add(on);
      if (step % 6 === 0) log([4, 0, (step / 6) % 8, 0]);
      if (step % 4 === 0) log([5, 0, 0, Math.round(Math.sin(now) * 3000)]);
      if (r.step >= 0 && step % 6 === 3) r.gates++;
      r.step = step;
    }
    if (now - r.ccAt > 0.12) { r.ccAt = now; log([3, 0, 74, Math.round(64 + 63 * Math.sin(now * 0.8))]); }
    const words = [0, 0, 0, 0];
    for (const k of r.held) words[k >> 5] |= 1 << (k & 31);
    const flat = [r.count & 0xffffff];
    for (const e of r.log) flat.push(...e);
    const beat = Math.exp(-((now * 2) % 1) * 4), swell = 0.6 + 0.5 * Math.sin(now * 0.4);
    const cv = Math.sin(now * 1.1) * 0.8, gateHigh = (now * 2) % 1 < 0.3;
    return {
      midi: flat,
      state: {
        held0: words[0] >>> 0, held1: words[1] >>> 0, held2: words[2] >>> 0, held3: words[3] >>> 0,
        peakL: beat * swell, peakR: beat * swell * 0.8, rmsL: beat * swell * 0.45, rmsR: beat * swell * 0.36,
        clipL: +(beat * swell > 1), clipR: 0,
        cv, cvLo: cv - 0.02, cvHi: cv + 0.02,
        gate: +gateHigh, gateAny: 0, gateCount: Math.floor(now * 2), gateLength: 0.15, gateRate: 2, gateDuty: 0.3,
      },
    };
  }

  const played = {};  // node → what perform() played: {held, pressed, released, notes}
  let t = 0;
  const lastOut = new Map();
  setInterval(() => {
    if (!board || (window.BleepWeb && BleepWeb.running)) return;  // the web engine reports the real state
    t += 1 / 30;
    const nodes = {};
    board.nodes.forEach((n, i) => {
      const ty = typeOf(n.type);
      if (!ty) return;
      const outputs = {};
      ty.outputs.forEach((o, k) => {
        const s = Math.sin(t * (1.3 + 0.4 * k) + i * 1.7);
        outputs[o.id] = o.type === "gate" || o.type === "trigger" ? (s > 0.8 ? 1 : 0)
          : o.type === "audio" ? Math.sin(t * 40 + i) * 0.5 * (n.port && !ports[n.port].live ? 0 : 1)
          : o.bipolar ? s : 0.5 + 0.5 * s;
      });
      const entry = { outputs };
      if (watched.includes(n.id)) {
        entry.params = {};
        for (const p of ty.params) {
          const v = n.params[p.id] ?? p.default;
          const into = board.cables.filter((c) => c.to.node === n.id && c.to.jack === p.id);
          const e = Math.min(1, Math.max(0, v + into.reduce((a, c) => a + c.amount * 0.5 * Math.sin(t * 2), 0)));
          entry.params[p.id] = { v, e, a: into.length > 0, t: paramText(p, into.length ? e : v) };
        }
      }
      if (n.type === "lfo") entry.phase = (t * 0.5) % 1;
      if (n.type === "quantizer") { entry.note = [0, 4, 7, 11, 12, 7][Math.floor(t * 2) % 6]; entry.root = 0; }
      if (n.type === "step-sequencer") {
        const len = Math.round(1 + (n.params.length ?? 0.48) * 31);
        entry.step = Math.floor(t * 8) % len;
        entry.sounding = 1;
        entry.varied = 0;
      }
      if (n.type === "drum-grid") {
        const d = n.data || {}, slot = d.current || 0, pat = (d.patterns || [])[slot];
        const len = pat ? pat.length : 16;
        entry.step = Math.floor(t * 8) % len;
        entry.playing = slot;
        entry.queued = -1;
        entry.running = 1;
        entry.hits = 0;
        if (pat) pat.steps.forEach((row, k) => { if ("xX".includes(row[entry.step])) entry.hits |= 1 << k; });
      }
      // Controllers: what the view played (perform), not the animation.
      if (n.type === "dial") {
        const at = (id) => { const p = ty.params.find((x) => x.id === id); return p.min + (n.params[id] ?? p.default) * (p.max - p.min); };
        outputs.out = at("min") + (at("max") - at("min")) * (n.params.value ?? 0.5);
      }
      if (n.type === "button") {
        const b = played[n.id] || {}, on = !!(n.data && n.data.on);
        Object.assign(outputs, { gate: (n.params.mode ?? 0) >= 0.5 ? +on : +!!b.held, toggle: +on,
                                 trigger: b.pressed ? 1 : 0, release: b.released ? 1 : 0 });
        b.pressed = b.released = false;
      }
      if (n.type === "keyboard") {
        const held = (played[n.id] || {}).notes || [];
        const last = held[held.length - 1];
        Object.assign(outputs, { gate: held.length ? 1 : 0, pitch: last === undefined ? 0 : (last - 60) / 12, trigger: 0,
                                 vel: held.length ? n.params.velocity ?? 0.8 : 0 });
        entry.active = last === undefined ? -1 : last;
        entry.held = held.length;
      }
      if (n.type === "level-meter") {
        // A beat that swells, now and then into the red.
        const beat = Math.exp(-((t * 2) % 1) * 4), swell = 0.6 + 0.5 * Math.sin(t * 0.4);
        const stereo = board.cables.some((c) => c.to.node === n.id && c.to.jack === "r");
        const pk = [beat * swell, beat * swell * (stereo ? 0.8 : 1)];
        Object.assign(entry, { peakL: pk[0], peakR: pk[1], rmsL: pk[0] * 0.45, rmsR: pk[1] * 0.45,
                               clipL: +(pk[0] > 1), clipR: +(pk[1] > 1), stereo: +stereo });
        Object.assign(outputs, { l: pk[0], r: pk[1], clip: +(pk[0] > 1), level: Math.max(0, 1 + 20 * Math.log10(pk[0] * 0.45 + 1e-9) / 60) });
      }
      if (n.type === "cv-to-midi") {
        for (let k = 1; k <= 4; k++) entry["lane" + k] = Math.round(63.5 + 63.5 * Math.sin(t * (0.6 + 0.35 * k) + k));
      }
      if (n.type === "envelope-follower") {
        // A drum pattern followed: a fast attack and a slower release, accents on every third hit.
        const k = Math.floor(t * 3), ph = (t * 3) % 1, hit = k % 3 === 0 ? 0.95 : 0.55;
        const env = hit * (ph < 0.06 ? ph / 0.06 : Math.exp(-(ph - 0.06) * 4));
        Object.assign(outputs, { env, inverted: Math.max(0, 1 - env), gate: +(env > (n.params.threshold ?? 0.3)) });
      }
      if (n.type === "monitor") {
        const m = monitorDemo(n.id, t);
        const has = (jack) => board.cables.some((c) => c.to.node === n.id && c.to.jack === jack);
        Object.assign(entry, m.state, { notesPatched: +has("notes"), audioPatched: +(has("l") || has("r")), stereo: +has("r"),
                                        cvPatched: +has("cv"), gatePatched: +has("gate") });
        entry.arrays = { midi: m.midi };
      }
      // Activity (the cables' pulse): how far each output moved since the last frame.
      entry.activity = {};
      for (const o of ty.outputs) {
        const key = n.id + "|" + o.id, v = outputs[o.id] ?? 0;
        const a = o.type === "audio" ? 2 * Math.abs(v) : Math.abs(v - (lastOut.get(key) ?? v));
        lastOut.set(key, v);
        if (a > 1e-4) entry.activity[o.id] = a;
      }
      if (n.type === "voice-cell") entry.voices = Math.floor(t * 2) % 2 ? 0b101 : 0b011;
      nodes[n.id] = entry;
    });
    syncPorts();
    emit("state", { nodes, ports });
  }, 1000 / 30);

  /// The web engine's state replaces the animation: add what the UI expects around it.
  function webState(state) {
    let changed = false;
    for (const [id, entry] of Object.entries(state.nodes)) {
      if (entry.data !== undefined) {  // a module changed its own data, or made a new node's valid
        const n = board && board.nodes.find((x) => x.id === id);
        if (n) { try { n.data = JSON.parse(entry.data); save(); changed = true; } catch (e) { /* keep */ } }
        delete entry.data;
      }
    }
    if (changed) emit("board", message());
    syncPorts();
    emit("state", { nodes: state.nodes, ports });
  }
  if (window.BleepWeb) {
    BleepWeb.onState = webState;
    BleepWeb.onStatus = () => emit("board", message());
  }

  // ---- a pretend Store (add ?store to the address): what the apps' Store section shows, for working on its looks ------------
  const demoStore = new URLSearchParams(location.search).has("store") ? (() => {
    const slugs = () => types.filter((t) => !t.internal).map((t) => t.type).slice(0, 60);
    const st = { installed: null, busy: {}, indexOk: false, allow: { module: false, plugin: false }, firstRunDone: store.get("bleep-demo-store-first-run", false) };
    const pick = (slug, i) => ({ slug, version: "0.1.0", source: i % 11 === 10 ? "local" : "registry", status: i % 11 === 10 ? "unsigned" : "signed", publisher: "bleep",
                                 allowed: i % 11 !== 10, why: i % 11 === 10 ? "unsigned: allowed only with Security → Allow unsigned modules" : "", loaded: i % 11 !== 10, types: [slug] });
    const work = (slug, what, then) => { st.busy[slug] = what; setTimeout(() => { delete st.busy[slug]; then(); }, 900); };
    return {
      status() {
        if (!st.installed) st.installed = slugs().slice(0, 14).map(pick);
        return { settings: { storeUrl: "https://store.example", channel: st.channel || "stable", allowUnsigned: st.allow, firstRunDone: st.firstRunDone }, dataDir: "~/Library/Application Support/Bleep",
                 hasRoots: true, installed: st.installed,
                 index: { ok: st.indexOk, error: "", modules: st.indexOk ? slugs().map((slug) => ({ slug, version: slug.length % 4 === 0 ? "0.2.0" : "0.1.0", types: [slug] })) : [] },
                 busy: st.busy, pluginJob: st.job || { state: "idle", message: "", ok: false } };
      },
      refresh() { setTimeout(() => (st.indexOk = true), 500); },
      install(slug) { work(slug, "installing", () => { st.installed = st.installed.filter((m) => m.slug !== slug).concat(pick(slug, 0)); }); },
      installAll() { const have = new Set(st.installed.map((m) => m.slug)); for (const slug of slugs()) if (!have.has(slug)) this.install(slug); },
      remove(slug) { work(slug, "removing", () => { st.installed = st.installed.filter((m) => m.slug !== slug); }); },
      settings(v) { if (v && v.channel) st.channel = v.channel; if (v && v.allowUnsigned) st.allow = v.allowUnsigned; if (v && v.firstRunDone !== undefined) { st.firstRunDone = v.firstRunDone; store.set("bleep-demo-store-first-run", v.firstRunDone); } },
      installPlugins() { st.job = { state: "running", message: "Installing bleep-board…", ok: false }; setTimeout(() => { st.job = { state: "done", message: "7 plugins installed into ~/Library/Audio/Plug-Ins/VST3. Rescan plugins in your DAW.", ok: true }; }, 1500); },
      plugins() { return ["Bleep Board", "Bleep MIDI In", "Bleep MIDI Out", "Bleep Audio In", "Bleep Audio Out", "Bleep Instrument", "Bleep FX"].map((name, i) => ({ name, installed: i < 5, path: i < 5 ? "/Library/Audio/Plug-Ins/VST3/" + name + ".vst3" : undefined })); },
    };
  })() : null;

  // A pretend Settings section's state (audio, MIDI, Link), for working on its looks.
  const demoSettingsState = { audio: { types: ["CoreAudio"], type: "CoreAudio", outputs: ["MacBook Speakers", "Scarlett 2i2"], inputs: ["MacBook Microphone", "Scarlett 2i2"],
      output: "Scarlett 2i2", input: "Scarlett 2i2", running: true, rate: 48000, rates: [44100, 48000, 96000], buffer: 256, buffers: [64, 128, 256, 512, 1024],
      latencyMs: 9.4, xruns: 0, cpu: 0.07, outputChannels: [{ name: "Out 1", on: true }, { name: "Out 2", on: true }, { name: "Out 3", on: false }, { name: "Out 4", on: false }],
      inputChannels: [{ name: "In 1", on: true }, { name: "In 2", on: true }] },
    midi: { inputs: [{ id: "a", name: "Launchkey Mini", on: true }, { id: "b", name: "IAC Driver Bus 1", on: false }], outputs: [{ id: "a", name: "Launchkey Mini" }], output: "a", virtualPorts: 2 },
    link: { available: true, enabled: true, peers: 1, tempo: 120 } };
  function demoSettings(fn, arg) {
    const s = demoSettingsState;
    if (fn === "audio") {
      for (const k of ["type", "output", "input", "rate", "buffer"]) if (arg[k] !== undefined) s.audio[k] = arg[k];
      for (const k of ["outputChannels", "inputChannels"]) if (arg[k]) s.audio[k].forEach((c, i) => (c.on = !!arg[k][i]));
    } else if (fn === "midiInput") { const d = s.midi.inputs.find((x) => x.id === arg.id); if (d) d.on = arg.on; }
    else if (fn === "midiOutput") s.midi.output = arg.id;
    else if (fn === "virtualPorts") s.midi.virtualPorts = arg.n;
    else if (fn === "link") s.link.enabled = arg.on;
    else if (fn === "tempo") s.link.tempo = arg.bpm;
    return JSON.parse(JSON.stringify(s));
  }

  /// [bridge] A Live port (Board = Bleep Play) the hub announced becomes a port node of this board, bound to its channel key:
  /// it stays when the port goes away (a ghost, cables kept), as in the plugins (doc/specs/bridges.md §6).
  function mirrorPort(info) {
    if (!board || !typeOf(info.type)) return;
    ports[info.id] = { kind: info.type, track: info.name, live: !!info.live, main: false };
    let n = board.nodes.find((x) => x.port === info.id);
    if (!n) {
      const toTrack = info.type === "audio-out" || info.type === "midi-out";
      // Below everything that is there: inputs on the left, outputs on the right, one row each.
      const row = board.nodes.filter((x) => x.port && x.port.startsWith("link:") && (x.type === "audio-out" || x.type === "midi-out") === toTrack).length;
      const below = board.nodes.length ? Math.max(...board.nodes.map((x) => x.y)) + 150 : 40;
      n = node("link-" + info.id.slice(5).replace(/[^A-Za-z0-9]/g, "").slice(-20), info.type, info.name, toTrack ? 760 : 40, below + 110 * row,
               { port: info.id, track: info.name, remote: info.key, colour: "#60a5fa" });
      board.nodes.push(n);
      save();
      if (window.BleepWeb) BleepWeb.setBoard(board);
    } else if (n.track !== info.name) {
      n.track = info.name;
      n.name = info.name;
      save();
    }
    emit("board", message());
  }

  window.BleepDemo = {
    mirrorPort,
    listen: (e, f) => (listeners[e] = listeners[e] || []).push(f),
    async call(name, a) {
      switch (name) {
        case "init":
          types = await (await fetch("demo-types.json")).json();
          // [bridge] Remote Audio and Remote MIDI come with the web link (patch/web/js/bridge-types.js), not with the engine's list.
          if (window.BleepWeb && BleepWeb.remoteTypes) types = types.concat(await BleepWeb.remoteTypes().catch(() => []));
          board = store.get("bleep-demo-board", null) || (window.BleepWeb && BleepWeb.defaultBoard ? BleepWeb.defaultBoard(node, cable) : demoBoard());
          if (window.BleepWeb) { BleepWeb.setTypes(types); BleepWeb.setBoard(board); }
          return Object.assign(message(), { types, dev: true, standalone: true, settings: true }, demoStore ? { store: true } : {});
        case "commit":
          pushUndo();
          board = sanitise(clone(a[0]));
          save();
          if (window.BleepWeb) BleepWeb.setBoard(board);
          return message();
        case "loadPatch": {  // the preset browser (dev server): port nodes take the demo's own ports of their kind
          const next = clone(a[0]), used = new Set();
          next.nodes = next.nodes.filter((n) => {
            if (!n.port) return true;
            const kind = (types.find((t) => t.type === n.type) || {}).port;
            const free = Object.entries(ports).find(([id, p]) => p.kind === kind && !used.has(id));
            if (!free) return false;
            used.add(free[0]);
            n.port = free[0];
            return true;
          });
          const ids = new Set(next.nodes.map((n) => n.id));
          next.cables = next.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node));
          pushUndo();
          board = sanitise(next);
          save();
          if (window.BleepWeb) BleepWeb.setBoard(board);
          return message();
        }
        case "undo":
          if (undo.length) { redo.push(JSON.stringify(board)); board = JSON.parse(undo.pop()); save(); if (window.BleepWeb) BleepWeb.setBoard(board); }
          return message();
        case "redo":
          if (redo.length) { undo.push(JSON.stringify(board)); board = JSON.parse(redo.pop()); save(); if (window.BleepWeb) BleepWeb.setBoard(board); }
          return message();
        case "beginGesture":
          pushUndo();
          return message();
        case "setParam": {
          const n = board.nodes.find((x) => x.id === a[0]);
          if (n) { n.params[a[1]] = a[2]; save(); if (window.BleepWeb) BleepWeb.setKnob(a[0], a[1], a[2]); }
          return null;
        }
        case "setData": {
          const n = board.nodes.find((x) => x.id === a[0]);
          if (n) { n.data = clone(a[1]); save(); if (window.BleepWeb) BleepWeb.setData(a[0], a[1]); }
          return null;
        }
        case "setAmount": {
          const c = board.cables.find((x) => x.id === a[0]);
          if (c) { c.amount = a[1]; save(); if (window.BleepWeb) BleepWeb.setAmount(a[0], a[1]); }
          return null;
        }
        case "perform": {  // Button and Keyboard gestures (see the state loop)
          if (window.BleepWeb) BleepWeb.perform(a[0], a[1], a[2]);
          const p = (played[a[0]] = played[a[0]] || { notes: [] }), args = a[2] || [];
          if (a[1] === "press") { p.held = p.pressed = true; }
          if (a[1] === "release") { p.held = false; p.released = true; }
          if (a[1] === "on") { p.notes = p.notes.filter((x) => x !== args[0]); p.notes.push(args[0]); }
          if (a[1] === "off") p.notes = p.notes.filter((x) => x !== args[0]);
          if (a[1] === "allOff") p.notes = [];
          return null;
        }
        case "types": return types;
        case "settings": return demoSettings(a[0], a[1]);
        case "storeRevealData": return null;
        case "storeStatus": return demoStore ? demoStore.status() : null;
        case "storeRefresh": if (demoStore) demoStore.refresh(); return null;
        case "storeInstall": if (demoStore) demoStore.install(a[0]); return null;
        case "storeInstallAll": if (demoStore) demoStore.installAll(); return null;
        case "storeRemove": if (demoStore) demoStore.remove(a[0]); return null;
        case "storeSettings": if (demoStore) demoStore.settings(a[0]); return null;
        case "storeInstallPlugins": if (demoStore) demoStore.installPlugins(); return { started: true };
        case "storePlugins": return demoStore ? demoStore.plugins() : [];
        case "watch": watched = a[0] || []; if (window.BleepWeb) BleepWeb.watch(watched); return null;
        case "command": if (window.BleepWeb) BleepWeb.command(a[0], a[1], a[2]); return null;
        case "importMedia": {
          // No media folder in the demo: a stable fake id from the name and size.
          let h = 0;
          for (const ch of a[0] + ":" + (a[1] || "").length) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          return { id: h.toString(16).padStart(16, "0").slice(-16) + ".wav", name: a[0], seconds: 0, channels: 2 };
        }
        case "exportMedia": return { error: "no audio in the demo" };
        case "midiDevices": return window.BleepWeb ? BleepWeb.midiDevices() : ["Demo Keyboard", "Demo Pads"];
        case "presets": return store.get(presetKey(a[0]), []);
        case "savePreset": {
          const list = store.get(presetKey(a[2]), []).filter((p) => p.name !== a[0]);
          list.push({ name: a[0], preset: a[1] });
          list.sort((x, y) => x.name.localeCompare(y.name));
          store.set(presetKey(a[2]), list);
          return list;
        }
        case "deletePreset": {
          const list = store.get(presetKey(a[1]), []).filter((p) => p.name !== a[0]);
          store.set(presetKey(a[1]), list);
          return list;
        }
        case "copyText": store.set("bleep-demo-clipboard", String(a[0])); return null;
        case "pasteText": return store.get("bleep-demo-clipboard", "");
        case "resetDemo":
          board = demoBoard(); undo = []; redo = []; save(); if (window.BleepWeb) BleepWeb.setBoard(board);
          setTimeout(() => emit("board", message()));
          return null;
        default: return null;
      }
    },
  };
})();
