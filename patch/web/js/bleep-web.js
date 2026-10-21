// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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
  const priv = (window.BleepSeal && window.BleepSeal.priv) || window;   // where the board keeps BleepCode (bleep-bridge.js); captured before the seal

  // ---- Code nodes (board-code.js): each runs a module compiled in this page, under a node type of its own, "code:<node id>:<hash>" ----
  const code = new Map();   // node id → { spec, wasm }
  const codeSent = new Set();
  function sendCode(id) {
    const c = code.get(id);
    if (!node || !c) return;
    codeSent.add(id);
    post({ cmd: "types", types: [c.spec] });
    post({ cmd: "module", slug: c.spec.type, bytes: c.wasm.slice().buffer, types: [c.spec.type] });
  }
  /// The board as the engine runs it: a Code node with a compiled module is its own node type; one without stays the empty "code" type.
  const withCode = (b) => (!b || !b.nodes || !code.size ? b : { ...b, nodes: b.nodes.map((n) => (n.type === "code" && code.has(n.id) ? { ...n, type: code.get(n.id).spec.type } : n)) });

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

  // ---- Media (web-media.js): the audio files modules use. Kept here; the clips a board uses go to the worklet once each. -----
  const M = window.BleepWebMedia ? window.BleepWebMedia.create({ idb: (() => { try { return window.indexedDB; } catch (e) { return null; } })() }) : null;
  const mediaSent = new Set();   // ids the worklet has been sent (or is being sent)
  /// Sends the clips named in `value` (a board's nodes, or one node's data) that the worklet does not have yet. The engine makes
  /// the modules load them when they arrive, so the order against the node data does not matter.
  function sendMedia(value) {
    if (!M || !node) return;
    for (const id of window.BleepWebMedia.idsIn(value)) {
      if (mediaSent.has(id)) continue;
      mediaSent.add(id);
      M.clip(id).then((clip) => {
        if (!clip) { mediaSent.delete(id); return; }   // not in this browser: the node shows as missing
        post({ cmd: "media", id, rate: clip.rate, channels: clip.channels });
      });
    }
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
        setStatus(m.local ? `loaded ${slug} from the local build (unsigned, ${Math.round(m.bytes / 1024)} KB)`
                         : `installed ${slug} ${m.version} from the Bleep Library (signed by ${m.publisher}, ${Math.round(m.bytes / 1024)} KB)`);
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
      const ui = [];   // library modules that bring their own picture (view.sandbox.js) or help page: { type, spec, view, help, source, version, meta }, for the board's views
      const found = await Promise.all(slugs.map((slug) => fetchModule(slug).then((r) => {
        const specs = (r.spec || []).filter((t) => !have.has(t.type));
        if (r.view || r.source || (r.help && r.trust === "community")) for (const t of specs) ui.push({ type: t.type, spec: t, view: r.view || "", help: r.help || "", source: r.source || "", version: r.version, meta: r.meta || {} });
        return specs;
      }, () => [])));
      W.libraryUi = ui;
      return found.flat();
    } catch (e) {
      return [];
    }
  }

  function setStatus(text) {
    W.status = text;
    if (W.onStatus) W.onStatus(text);
  }

  /// The hidden Dial and Button a panel control drives when it is wired to a cell's own input or a jack (the native engine makes the
  /// same ones, Board.cpp addPanelSources): ids "~panel:control:index", each cabled to its target. Not part of the saved board.
  function withPanelSources(b) {
    if (!b || !Array.isArray(b.panels) || !b.panels.length) return b;
    const byId = new Map(b.nodes.map((n) => [n.id, n])), typeOf = new Map((types || []).map((t) => [t.type, t]));
    const inVoiceCell = (n) => { for (let p = n.parent, d = 0; p && d < 64; ++d) { const q = byId.get(p); if (!q) break; if (q.type === "voice-cell") return true; p = q.parent; } return false; };
    const inputType = (n, jack) => {
      if (n.type === "cell" || n.type === "voice-cell") { const j = (n.inputs || []).find((q) => q.id === jack); return j ? j.type : null; }
      const t = typeOf.get(n.type);
      if (!t) return null;
      const j = (t.inputs || []).find((q) => q.id === jack);
      if (j) return j.type;
      const q = (t.params || []).find((x) => x.id === jack && x.modulatable);
      return q ? "control" : null;
    };
    const nodes = b.nodes.slice(), cables = b.cables.slice();
    for (const panel of b.panels) {
      const cellId = panel.cell || "";
      if (cellId && !byId.has(cellId)) continue;
      for (const c of panel.controls || []) {
        (c.wire || []).forEach((w, index) => {
          const id = `~${panel.id}:${c.id}:${index}`;
          let nodeId, jack;
          if (w.cell) { nodeId = cellId; jack = w.cell; }
          else if (w.jack) { const i = w.jack.indexOf("."); if (i < 0) return; nodeId = w.jack.slice(0, i); jack = w.jack.slice(i + 1); }
          else if (w.param && w.mode === "mod") { const i = w.param.indexOf("."); if (i < 0) return; nodeId = w.param.slice(0, i); jack = w.param.slice(i + 1); }
          else return;
          const target = byId.get(nodeId), jt = target && !inVoiceCell(target) ? inputType(target, jack) : null;
          if (!jt) return;
          const cable = (from) => cables.push({ id: "~k" + id, from: { node: id, jack: from }, to: { node: nodeId, jack }, amount: 1 });
          if (c.type === "button" && (jt === "trigger" || jt === "gate")) {
            nodes.push({ id, type: "button", name: "button", x: 0, y: 0, parent: "", muted: false, params: {} });
            cable(jt);
            return;
          }
          const [lo, hi] = w.range || [0, 1];
          let saved = c.value;
          if (Array.isArray(saved)) saved = saved[w.axis === "y" ? 1 : 0];
          const x = Math.max(0, Math.min(1, typeof saved === "number" ? saved : lo < 0 && hi > 0 ? -lo / (hi - lo) : 0));
          const signal = Math.max(-1, Math.min(1, lo + x * (hi - lo)));
          nodes.push({ id, type: "dial", name: "dial", x: 0, y: 0, parent: "", muted: false, params: { value: (signal + 1) / 2, min: 0, max: 1, steps: 0 } });
          cables.push({ id: "~k" + id, from: { node: id, jack: "out" }, to: { node: nodeId, jack }, amount: Math.max(-1, Math.min(1, w.amount ?? 1)) });
        });
      }
    }
    return { ...b, nodes, cables };
  }

  Object.assign(W, {
    media: M,
    libraryTypes,
    /// The user's own modules (user-modules.js) changed: read the module list again; nodes that need a module now get it.
    async refreshModules() {
      try { manifest = await BleepLibrary.manifest(); } catch (e) { return; }
      if (node) ensureModules();
    },
    setTypes(list) { types = list; post({ cmd: "types", types }); },
    setBoard(b) {
      board = b;
      W.boardDoc = b;
      if (W.onBoardSet) W.onBoardSet(b);  // [bridge]
      if (b && b.tempo >= 20 && b.tempo <= 400) { W.transport.bpm = b.tempo; post({ cmd: "tempo", bpm: b.tempo }); }   // the patch's own tempo
      if (priv.BleepCode) priv.BleepCode.sync(b);   // compiles the Code nodes the engine does not have yet (also before the audio starts)
      if (!node) return;
      for (const id of code.keys()) if (!codeSent.has(id)) sendCode(id);
      post({ cmd: "board", board: withPanelSources(withCode(W.mapBoard ? W.mapBoard(b) : b)) });  // [bridge] Remote nodes carry their channel key
      sendMedia(b.nodes);
      ensureModules();
    },
    /// A Code node's compiled module (board-code.js). The engine gets the module and the type before the board that uses them.
    registerCode(id, spec, wasm) {
      code.set(id, { spec, wasm });
      codeSent.delete(id);
      if (!node) return;
      sendCode(id);
      if (board) post({ cmd: "board", board: withPanelSources(withCode(W.mapBoard ? W.mapBoard(board) : board)) });
    },
    setKnob: (id, param, value) => post({ cmd: "knob", node: id, param, value }),
    setAmount: (cable, value) => post({ cmd: "amount", cable, value }),
    perform: (id, action, args) => post({ cmd: "perform", node: id, action, args: args || [] }),
    command: (id, cmd, value) => post({ cmd: "command", node: id, id: cmd, value }),
    setData: (id, data) => { sendMedia(data); post({ cmd: "data", node: id, data }); },
    watch(ids) { watched = ids; post({ cmd: "watch", nodes: ids }); },
    /// The transport of this page (the side menu): tempo and start/stop.
    transport: { bpm: 120, playing: true },
    /// The tempo belongs to the patch: `onTempoSet` lets the board remember it (board-demo.js).
    setTempo(bpm) { W.transport.bpm = bpm; if (W.onTempoSet) W.onTempoSet(bpm); post({ cmd: "tempo", bpm }); },
    setPlaying(on) { W.transport.playing = !!on; post({ cmd: "play", on: !!on }); },
    /// The octave the computer keys start in (A is its C); a drum map asks for a low one so that the keys are the drum notes.
    setOctave(o) { octave = Math.max(0, Math.min(8, Math.round(o))); },
    shiftOctave(d) { W.setOctave(octave + d); },
    noteOn: (note, velocity = 0.8) => post({ cmd: "noteOn", note, velocity, channel: 0 }),
    /// A key of the screen keyboard: plays the MIDI In nodes and the Keyboard modules, as the computer keys do.
    keyDown(note, velocity = 0.8) { W.noteOn(note, velocity); played(note, "on"); },
    keyUp(note) { W.noteOff(note); played(note, "off"); },
    noteOff: (note) => post({ cmd: "noteOff", note, channel: 0 }),

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

    /// Starts audio. Call from a click.
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
      for (const id of code.keys()) sendCode(id);   // Code nodes compiled before the audio started (board-code.js)
      post({ cmd: "watch", nodes: watched });
      post({ cmd: "tempo", bpm: W.transport.bpm });
      W.running = true;
      if (board) { post({ cmd: "board", board: withCode(W.mapBoard ? W.mapBoard(board) : board) }); sendMedia(board.nodes); await ensureModules(); }
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
  // Physical keys (so any layout has the piano in the same place), semitones above C; Z and X (Y and X on a German keyboard) move the octave.
  const keys = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon", "Quote"];
  const down = new Map();   // key code → the note it started: the octave may change before the key comes up
  let octave = 4;
  /// Keyboard modules play too (their own view handles the keys only while it has focus).
  const played = (note, action) => {
    if (board) for (const n of board.nodes) if (n.type === "keyboard") W.perform(n.id, action, [note]);
  };
  window.addEventListener("keydown", (e) => {
    if (!W.running || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.code === "KeyZ" || e.code === "KeyX") {   // with the screen keyboard up, it follows (play-keys.js)
      if (e.repeat) return;
      const d = e.code === "KeyZ" ? -1 : 1, pk = window.BleepPlayKeys;
      if (pk && pk.visible()) pk.change(d); else W.shiftOctave(d);
      return;
    }
    const k = keys.indexOf(e.code);
    if (k < 0 || e.repeat || down.has(e.code)) return;
    const note = 12 * (octave + 1) + k;
    down.set(e.code, note);
    W.noteOn(note);
    played(note, "on");
  });
  window.addEventListener("keyup", (e) => {
    const note = down.get(e.code);
    if (note === undefined) return;
    down.delete(e.code);
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
