// SPDX-License-Identifier: MIT
//
// bleep-web.js — the browser engine, main-thread side. Takes the place of the
// native plugin behind the board UI: board-demo.js keeps the document (undo,
// presets, …) and tells BleepWeb about every change; BleepWeb loads the
// module wasm files a board needs, one by one and on demand, from the Bleep
// Store (store-client.js: signed packages, checked here before they run), and
// sends the board to the AudioWorklet (worklet.js), which makes the sound.
//
// Audio starts on the first click (browsers require a gesture); until then
// the board runs as the silent demo.
(function () {
  "use strict";
  if (window.__JUCE__) return;

  const url = (p) => new URL(p, document.baseURI).href;  // files sit next to index.html

  let manifest = null, types = [], ctx = null, node = null, board = null, watched = [];
  const loading = new Map();  // slug → Promise
  const sent = new Set();     // slugs the worklet has
  const W = {
    running: false,
    status: "",
    /// Set by board-demo.js: called with the engine's state message.
    onState: null,
    onStatus: null,
  };

  const post = (m) => node && node.port.postMessage(m);

  /// The module's package from the store, verified. The bytes are compiled inside the worklet (a Module does not cross to it everywhere).
  function fetchModule(slug) {
    if (!loading.has(slug)) loading.set(slug, BleepStore.fetchModule(slug));
    return loading.get(slug);
  }

  /// Fetches (once) the module files the board's nodes need and gives them to the worklet.
  async function ensureModules() {
    if (!node || !board || !manifest) return;
    const need = new Set();
    for (const n of board.nodes) {
      const slug = manifest.types[n.type];
      if (slug && !sent.has(slug)) need.add(slug);
    }
    for (const slug of need) {
      sent.add(slug);
      try {
        const m = await fetchModule(slug);
        post({ cmd: "module", slug, bytes: m.wasm.slice(0), types: manifest.modules[slug].types });
        setStatus(`installed ${slug} ${m.version} from the Bleep Store (signed by ${m.publisher}, ${Math.round(m.bytes / 1024)} KB)`);
      } catch (e) {
        sent.delete(slug);
        loading.delete(slug);
        setStatus(`cannot load ${slug}: ${e.message}`);
      }
    }
  }

  function setStatus(text) {
    W.status = text;
    if (W.onStatus) W.onStatus(text);
  }

  Object.assign(W, {
    setTypes(list) { types = list; post({ cmd: "types", types }); },
    setBoard(b) {
      board = b;
      W.boardDoc = b;
      if (W.onBoardSet) W.onBoardSet(b);  // [bridge]
      if (!node) return;
      post({ cmd: "board", board: W.mapBoard ? W.mapBoard(b) : b });  // [bridge] Remote nodes carry their channel key
      ensureModules();
    },
    setKnob: (id, param, value) => post({ cmd: "knob", node: id, param, value }),
    setAmount: (cable, value) => post({ cmd: "amount", cable, value }),
    perform: (id, action, args) => post({ cmd: "perform", node: id, action, args: args || [] }),
    command: (id, cmd, value) => post({ cmd: "command", node: id, id: cmd, value }),
    setData: (id, data) => post({ cmd: "data", node: id, data }),
    watch(ids) { watched = ids; post({ cmd: "watch", nodes: ids }); },
    noteOn: (note, velocity = 0.8) => post({ cmd: "noteOn", note, velocity, channel: 0 }),
    noteOff: (note) => post({ cmd: "noteOff", note, channel: 0 }),

    /// Starts audio. Call from a click.
    async start() {
      if (ctx) { await ctx.resume(); return; }
      setStatus("starting audio…");
      let storeDown = "";
      try {
        manifest = await BleepStore.manifest();
      } catch (e) {
        // [bridge] Without the store the board still runs its built-in ports (the web link to the app needs no module):
        // modules stay unavailable until it can be reached.
        manifest = { modules: {}, types: {}, unavailable: [] };
        storeDown = `cannot reach the Bleep Store: ${e.message}`;
        setStatus(storeDown);
      }
      ctx = new AudioContext({ latencyHint: "interactive" });
      await ctx.audioWorklet.addModule(url("js/worklet.js"));
      node = new AudioWorkletNode(ctx, "bleep-processor", { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = (e) => {
        const m = e.data;
        if (m.cmd === "state" && W.onState) W.onState(m.state);
        if (m.cmd === "error") { console.error("[bleep worklet]", m.message); setStatus("audio error: " + m.message.split("\n")[0]); }
      };
      post({ cmd: "types", types });
      post({ cmd: "watch", nodes: watched });
      W.running = true;
      if (board) { post({ cmd: "board", board: W.mapBoard ? W.mapBoard(board) : board }); await ensureModules(); }
      setStatus(`Web audio · ${Math.round(ctx.sampleRate / 1000)} kHz · latency ${Math.round(ctx.baseLatency * 1000)} ms` + (storeDown ? ` · ${storeDown}` : ""));
    },
    /// The board a visitor starts with: a playable keyboard synth.
    /// `node` and `cable` are board-demo.js's helpers.
    defaultBoard(node, cable) {
      return {
        format: 1, id: "web",
        nodes: [
          node("keys", "keyboard", "Keyboard", 40, 60),
          node("osc", "oscillator", "Oscillator", 300, 40, { params: { octave: 0.5, shape: 0.9, pw: 0.5, coarse: 0.5, fine: 0.5, fm: 0 } }),
          node("env", "adsr", "Envelope", 300, 330),
          node("filter", "filter", "Filter", 560, 60, { params: { cutoff: 0.55 } }),
          node("amp", "vca", "Amp", 800, 100, { params: { gain: 0 } }),
          node("out", "audio-out", "Speakers", 1040, 100, { port: "p-synth", track: "Synth", colour: "#ff6b6b" }),
        ],
        cables: [
          cable("k1", "keys", "pitch", "osc", "pitch", 1),
          cable("k2", "keys", "gate", "env", "gate", 1),
          cable("k3", "osc", "saw", "filter", "l", 1),
          cable("k4", "filter", "l", "amp", "l", 1),
          cable("k5", "env", "env", "amp", "gain", 1),
          cable("k6", "amp", "l", "out", "l", 1),
        ],
      };
    },
    get sampleRate() { return ctx ? ctx.sampleRate : 0; },
  });

  // ---- the computer keyboard plays the MIDI In nodes ------------------------------
  const keys = "awsedftgyhujkolp;'".split("");  // C … E, piano layout
  const down = new Set();
  let octave = 4;
  /// Keyboard modules play too (their own view handles the keys only while it has focus).
  const played = (note, action) => {
    if (board) for (const n of board.nodes) if (n.type === "keyboard") W.perform(n.id, action, [note]);
  };
  window.addEventListener("keydown", (e) => {
    if (!W.running || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = keys.indexOf(e.key.toLowerCase());
    if (k < 0 || down.has(e.key)) return;
    down.add(e.key);
    const note = 12 * (octave + 1) + k;
    W.noteOn(note);
    played(note, "on");
  });
  window.addEventListener("keyup", (e) => {
    const k = keys.indexOf(e.key.toLowerCase());
    if (k < 0 || !down.delete(e.key)) return;
    const note = 12 * (octave + 1) + k;
    W.noteOff(note);
    played(note, "off");
  });

  // ---- Web MIDI ---------------------------------------------------------------------
  let midiAccess = null;
  const midiNames = () => (midiAccess ? [...midiAccess.inputs.values()].map((i) => i.name) : []);
  /// The controllers the MIDI Device nodes on the board are set to. With none on the board, every input plays.
  const wanted = () => (board ? board.nodes.filter((n) => n.type === "midi-device").map((n) => n.device).filter(Boolean) : []);
  const listens = (input) => {
    const hasNodes = board && board.nodes.some((n) => n.type === "midi-device");
    return !hasNodes || wanted().includes(input.name);
  };
  W.enableMidi = async function () {
    if (!navigator.requestMIDIAccess) return false;
    if (!midiAccess) midiAccess = await navigator.requestMIDIAccess();
    const wire = (input) => { input.onmidimessage = (e) => {
      if (!listens(input)) return;
      const [s, a, b] = e.data, cmd = s & 0xf0;
      if (cmd === 0x90 && b > 0) { W.noteOn(a, b / 127); played(a, "on"); }
      else if (cmd === 0x80 || cmd === 0x90) { W.noteOff(a); played(a, "off"); }
      else if (cmd === 0xb0) post({ cmd: "cc", number: a, value: b / 127 });
      else if (cmd === 0xe0) post({ cmd: "bend", value: ((b << 7) | a) / 16383 });
    }; };
    midiAccess.inputs.forEach(wire);
    midiAccess.onstatechange = () => { midiAccess.inputs.forEach(wire); if (W.onMidiDevices) W.onMidiDevices(midiNames()); };
    return true;
  };
  /// Names of the connected MIDI inputs (asks the browser for access the first time).
  W.midiDevices = async function () {
    try { await W.enableMidi(); } catch (e) { return []; }
    return midiNames();
  };

  // ---- [bridge] the web link to the app (bridge-client.js; see "The bridge to the app" in the README) ------
  // Loaded on demand, so a page that never connects never fetches it. Needs a click (it starts audio).
  W.bridge = null;
  /// What the worklet's endpoint and the bound nodes hold (for finding out why a channel is silent).
  W.debugBridge = () => new Promise((resolve) => {
    const h = (e) => { if (e.data && e.data.cmd === "bridge-debug") { node.port.removeEventListener("message", h); resolve(e.data); } };
    node.port.addEventListener("message", h);
    post({ cmd: "bridge-debug" });
  });
  /// The types of Remote Audio / Remote MIDI, for the board UI's Add menu (board-demo.js adds them to its list).
  W.remoteTypes = async () => (await import(url("js/bridge-types.js"))).REMOTE_TYPES;
  /// A Remote node is bound to the channel it opened under its own id.
  W.mapBoard = (b) => ({ ...b, nodes: b.nodes.map((n) => ((n.type === "remote-audio" || n.type === "remote-midi") && !n.remote ? { ...n, remote: n.id } : n)) });
  W.connectBridge = async function (options = {}) {
    const m = await import(url("js/bridge-client.js"));
    if (!ctx) await W.start();
    if (!W.bridge) W.bridge = new m.BridgeClient(options);
    post({ cmd: "types", types: m.REMOTE_TYPES });  // Remote Audio / Remote MIDI nodes for the engine
    W.bridge.attachAudio(node, ctx);
    W.bridge.connect();
    return W.bridge;
  };

  // ---- the "start audio" button -----------------------------------------------------
  window.addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("button");
    b.textContent = "▶ Start audio";
    b.style.cssText = "position:fixed;z-index:50;right:16px;top:52px;padding:10px 16px;border-radius:999px;" +
      "border:1px solid #5eead4;background:#0f1a1a;color:#5eead4;font:600 14px system-ui;cursor:pointer";
    b.onclick = async () => {
      b.disabled = true;
      try { await W.start(); W.enableMidi().catch(() => {}); b.remove(); }
      catch (e) { b.disabled = false; b.textContent = "Audio failed: " + e.message; }
    };
    document.body.appendChild(b);
  });

  window.BleepWeb = W;
})();
