// SPDX-License-Identifier: MIT
//
// bleep-web.js — the browser engine, main-thread side. Takes the place of the
// native plugin behind the board UI: board-demo.js keeps the document (undo,
// presets, …) and tells BleepWeb about every change; BleepWeb loads the
// module wasm files a board needs, one by one and on demand, from the Bleep
// Library (library-client.js: signed packages, checked here before they run), and
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

  let inputSource = null, inputStream = null;   // what feeds the worklet's input (W.input)
  function dropInput() {
    try { if (inputSource && inputSource.stop) inputSource.stop(); } catch (e) { /* not started */ }
    if (inputSource) inputSource.disconnect();
    if (inputStream) for (const t of inputStream.getTracks()) t.stop();
    inputSource = inputStream = null;
    if (W.input) W.input.kind = "";
  }

  // ---- Settings (web-settings.js; the board's Settings section asks through board-demo.js) -----------------------------
  let usedHint = "interactive";   // the latencyHint the AudioContext was made with
  const S = window.BleepWebSettings ? window.BleepWebSettings.create({
    storage: (() => { try { return window.localStorage; } catch (e) { return null; } })(),
    audio: () => (ctx ? { rate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, latencyHint: usedHint } : null),
    canSelectOutput: typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype,
    setSink: async (id) => { if (ctx && ctx.setSinkId) await ctx.setSinkId(id); },   // before audio starts the choice is kept and applied then
    devices: () => (navigator.mediaDevices ? navigator.mediaDevices.enumerateDevices() : Promise.resolve([])),
    midi: () => (midiAccess ? { supported: true, inputs: [...midiAccess.inputs.values()].map((i) => ({ id: i.id, name: i.name })) } : null),
    midiSupported: !!navigator.requestMIDIAccess,
    askMidi: () => W.enableMidi(),
    bridge: () => W.bridgeUI || null,
    library: window.BleepLibrary,
    reload: () => location.reload(),
  }) : null;
  if (S) { S.applyLibrary(); W.settings = S.call; }

  /// The module's package from the library, verified. The bytes are compiled inside the worklet (a Module does not cross to it everywhere).
  function fetchModule(slug) {
    if (!loading.has(slug)) loading.set(slug, BleepLibrary.fetchModule(slug));
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
        setStatus(`installed ${slug} ${m.version} from the Bleep Library (signed by ${m.publisher}, ${Math.round(m.bytes / 1024)} KB)`);
      } catch (e) {
        sent.delete(slug);
        loading.delete(slug);
        setStatus(`cannot load ${slug}: ${e.message}`);
      }
    }
  }

  /// The node types of released modules that the board's own list (demo-types.json) does not have yet, from the packages' spec.json:
  /// a module released to the library shows up in the Add-module picker without a new site build. Each package is downloaded and
  /// checked like any other (and kept for when a node needs it); one that fails to load is left out. Never throws.
  async function libraryTypes(known) {
    try {
      const m = await BleepLibrary.manifest();
      const have = new Set(known.map((t) => t.type));
      const slugs = Object.keys(m.modules).filter((slug) => (m.modules[slug].types || []).some((t) => !have.has(t)));
      const found = await Promise.all(slugs.map((slug) => fetchModule(slug).then((r) => (r.spec || []).filter((t) => !have.has(t.type)), () => [])));
      return found.flat();
    } catch (e) {
      return [];
    }
  }

  function setStatus(text) {
    W.status = text;
    if (W.onStatus) W.onStatus(text);
  }

  Object.assign(W, {
    libraryTypes,
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
    /// The transport of this page (the side menu): tempo and start/stop.
    transport: { bpm: 120, playing: true },
    setTempo(bpm) { W.transport.bpm = bpm; post({ cmd: "tempo", bpm }); },
    setPlaying(on) { W.transport.playing = !!on; post({ cmd: "play", on: !!on }); },
    noteOn: (note, velocity = 0.8) => post({ cmd: "noteOn", note, velocity, channel: 0 }),
    noteOff: (note) => post({ cmd: "noteOff", note, channel: 0 }),

    /// Starts audio. Call from a click.
    /// What the Audio In nodes carry: the microphone or an audio file that loops (the web has no other source). Call from a click.
    input: {
      kind: "",   // "", "mic" or "file"
      supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      async useMic() {
        await W.start();
        if (!W.input.supported) throw new Error("This browser cannot use a microphone.");
        let stream;
        try {
          // The raw signal: echo cancellation and noise suppression would colour an effect.
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        } catch (e) {
          throw new Error(e && e.name === "NotAllowedError" ? "The microphone is blocked. Allow it in the address bar to use it." : "No microphone could be opened.");
        }
        dropInput();
        inputStream = stream;
        inputSource = ctx.createMediaStreamSource(stream);
        inputSource.connect(node);
        W.input.kind = "mic";
      },
      async useFile(file) {
        await W.start();
        let buffer;
        try {
          buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        } catch (e) {
          throw new Error("That file could not be read as audio.");
        }
        dropInput();
        inputSource = ctx.createBufferSource();
        inputSource.buffer = buffer;
        inputSource.loop = true;
        inputSource.connect(node);
        inputSource.start();
        W.input.kind = "file";
        return { seconds: buffer.duration };
      },
      stop() { dropInput(); },
    },

    async start() {
      if (ctx) { await ctx.resume(); return; }
      setStatus("starting audio…");
      let libraryDown = "";
      try {
        manifest = await BleepLibrary.manifest();
      } catch (e) {
        // [bridge] Without the library the board still runs its built-in ports (the web link to the app needs no module):
        // modules stay unavailable until it can be reached.
        manifest = { modules: {}, types: {}, unavailable: [] };
        libraryDown = `cannot reach the Bleep Library: ${e.message}`;
        setStatus(libraryDown);
      }
      usedHint = S ? S.latencyHint() : "interactive";
      ctx = new AudioContext({ latencyHint: usedHint });
      if (S && S.output() && ctx.setSinkId) await ctx.setSinkId(S.output()).catch(() => { /* the device is gone: the default plays */ });
      await ctx.audioWorklet.addModule(url("js/worklet.js"));
      // One input, for the Audio In nodes (the microphone or a file, W.input); mono is made stereo. Nothing is connected until asked.
      node = new AudioWorkletNode(ctx, "bleep-processor", { numberOfInputs: 1, channelCount: 2, channelCountMode: "explicit", outputChannelCount: [2] });
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
      setStatus(`Web audio · ${Math.round(ctx.sampleRate / 1000)} kHz · latency ${Math.round(ctx.baseLatency * 1000)} ms` + (libraryDown ? ` · ${libraryDown}` : ""));
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
    return hasNodes ? wanted().includes(input.name) : !(S && S.midiIgnored(input.name));
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
    // A full-screen shade with the button centred, so nobody has to look for it.
    const shade = document.createElement("div");
    shade.style.cssText = "position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(5,10,10,0.72);backdrop-filter:blur(2px)";
    const b = document.createElement("button");
    b.textContent = "▶ Start audio";
    b.style.cssText = "padding:18px 36px;border-radius:999px;border:1px solid #5eead4;background:#0f1a1a;" +
      "color:#5eead4;font:600 20px system-ui;cursor:pointer;box-shadow:0 0 40px rgba(94,234,212,0.25)";
    b.onclick = async () => {
      b.disabled = true;
      try { await W.start(); W.enableMidi().catch(() => {}); shade.remove(); }
      catch (e) { b.disabled = false; b.textContent = "Audio failed: " + e.message; }
    };
    shade.appendChild(b);
    document.body.appendChild(shade);
    b.focus();
  });

  window.BleepWeb = W;
})();
