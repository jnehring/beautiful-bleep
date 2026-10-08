// SPDX-License-Identifier: MIT
// board-demo.js — a fake engine so the board runs in a plain browser
// (python3 scripts/ui-server.py). Inactive inside a plugin. It keeps a small
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

  const message = () => ({ board, ports, canUndo: undo.length > 0, canRedo: redo.length > 0,
                           status: "Demo · no audio · latency 256 smp" });
  function save() { store.set("bleep-demo-board", board); }
  function pushUndo() { undo.push(JSON.stringify(board)); if (undo.length > 200) undo.shift(); redo = []; }

  function paramText(p, v) {
    if (p.kind === "bool") return v >= 0.5 ? "On" : "Off";
    const x = p.min + v * (p.max - p.min);
    if (p.kind === "choice") return p.choices[Math.round(x - p.min)] || "";
    if (p.kind === "int") return String(Math.round(x));
    return x.toFixed(2);
  }

  const played = {};  // node → what perform() played: {held, pressed, released, notes}
  let t = 0;
  setInterval(() => {
    if (!board) return;
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
      if (n.type === "voice-cell") entry.voices = Math.floor(t * 2) % 2 ? 0b101 : 0b011;
      nodes[n.id] = entry;
    });
    emit("state", { nodes, ports });
  }, 1000 / 30);

  window.BleepDemo = {
    listen: (e, f) => (listeners[e] = listeners[e] || []).push(f),
    async call(name, a) {
      switch (name) {
        case "init":
          types = await (await fetch("demo-types.json")).json();
          board = store.get("bleep-demo-board", null) || demoBoard();
          return Object.assign(message(), { types, dev: true, standalone: true });
        case "commit":
          pushUndo();
          board = sanitise(clone(a[0]));
          save();
          return message();
        case "undo":
          if (undo.length) { redo.push(JSON.stringify(board)); board = JSON.parse(undo.pop()); save(); }
          return message();
        case "redo":
          if (redo.length) { undo.push(JSON.stringify(board)); board = JSON.parse(redo.pop()); save(); }
          return message();
        case "beginGesture":
          pushUndo();
          return message();
        case "setParam": {
          const n = board.nodes.find((x) => x.id === a[0]);
          if (n) { n.params[a[1]] = a[2]; save(); }
          return null;
        }
        case "setData": {
          const n = board.nodes.find((x) => x.id === a[0]);
          if (n) { n.data = clone(a[1]); save(); }
          return null;
        }
        case "setAmount": {
          const c = board.cables.find((x) => x.id === a[0]);
          if (c) { c.amount = a[1]; save(); }
          return null;
        }
        case "perform": {  // Button and Keyboard gestures (see the state loop)
          const p = (played[a[0]] = played[a[0]] || { notes: [] }), args = a[2] || [];
          if (a[1] === "press") { p.held = p.pressed = true; }
          if (a[1] === "release") { p.held = false; p.released = true; }
          if (a[1] === "on") { p.notes = p.notes.filter((x) => x !== args[0]); p.notes.push(args[0]); }
          if (a[1] === "off") p.notes = p.notes.filter((x) => x !== args[0]);
          if (a[1] === "allOff") p.notes = [];
          return null;
        }
        case "watch": watched = a[0] || []; return null;
        case "midiDevices": return ["Demo Keyboard", "Demo Pads"];
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
        case "resetDemo":
          board = demoBoard(); undo = []; redo = []; save();
          setTimeout(() => emit("board", message()));
          return null;
        default: return null;
      }
    },
  };
})();
