// SPDX-License-Identifier: MIT
//
// bleep-web.js — the browser engine, main-thread side. Takes the place of the
// native plugin behind the board UI: board-demo.js keeps the document (undo,
// presets, …) and tells BleepWeb about every change; BleepWeb loads the
// module wasm files a board needs, one by one and on demand, and sends the
// board to the AudioWorklet (worklet.js), which makes the sound.
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

  async function fetchModule(slug) {
    if (!loading.has(slug)) {
      loading.set(slug, (async () => {
        const entry = manifest.modules[slug];
        const res = await fetch(url(manifest.base ? manifest.base + entry.file : entry.file));
        if (!res.ok) throw new Error(`${entry.file}: ${res.status}`);
        return res.arrayBuffer();  // compiled inside the worklet (a Module does not cross to it everywhere)
      })());
    }
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
        const bytes = await fetchModule(slug);
        post({ cmd: "module", slug, bytes: bytes.slice(0), types: manifest.modules[slug].types });
        setStatus(`loaded ${slug}.wasm (${Math.round(manifest.modules[slug].bytes / 1024)} KB)`);
      } catch (e) {
        sent.delete(slug);
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
      if (!node) return;
      post({ cmd: "board", board: b });
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
      manifest = await (await fetch(url("manifest.json"))).json();
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
      if (board) { post({ cmd: "board", board }); await ensureModules(); }
      setStatus(`Web audio · ${Math.round(ctx.sampleRate / 1000)} kHz · latency ${Math.round(ctx.baseLatency * 1000)} ms`);
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
  window.addEventListener("keydown", (e) => {
    if (!W.running || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = keys.indexOf(e.key.toLowerCase());
    if (k < 0 || down.has(e.key)) return;
    down.add(e.key);
    W.noteOn(12 * (octave + 1) + k);
  });
  window.addEventListener("keyup", (e) => {
    const k = keys.indexOf(e.key.toLowerCase());
    if (k < 0 || !down.delete(e.key)) return;
    W.noteOff(12 * (octave + 1) + k);
  });

  // ---- Web MIDI ---------------------------------------------------------------------
  W.enableMidi = async function () {
    if (!navigator.requestMIDIAccess) return false;
    const access = await navigator.requestMIDIAccess();
    const wire = (input) => { input.onmidimessage = (e) => {
      const [s, a, b] = e.data, cmd = s & 0xf0;
      if (cmd === 0x90 && b > 0) W.noteOn(a, b / 127);
      else if (cmd === 0x80 || cmd === 0x90) W.noteOff(a);
      else if (cmd === 0xb0) post({ cmd: "cc", number: a, value: b / 127 });
      else if (cmd === 0xe0) post({ cmd: "bend", value: ((b << 7) | a) / 16383 });
    }; };
    access.inputs.forEach(wire);
    access.onstatechange = () => access.inputs.forEach(wire);
    return true;
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
