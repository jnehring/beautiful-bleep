// SPDX-License-Identifier: MIT
//
// bridge-client.js — the main-thread API of the web link (doc/specs/bridges.md §3.2, §4, §5, §10).
//
//   const bridge = new BridgeClient({ name: "Chrome", mode: "low" });
//   bridge.attachAudio(workletNode, audioContext);   // optional: audio channels need the worklet
//   bridge.connect();
//   bridge.on("channels", (list) => …);              // what the hub offers: Live ports with Board = Bleep Play, …
//   bridge.openChannel({ key: "node-7", kind: "audio", dir: "both", name: "FX" });
//   bridge.sendMidi("seq", [[null, 0x90, 60, 100]], { lookaheadBeats: 0.1 });
//   bridge.getBeat();                                 // follows the hub's transport
//
// The WebSocket is not here: it lives in a Worker (bridge-worker.js) so that neither the UI nor the garbage
// collector sits in the audio path. This class is the protocol state on the main thread: channels, the sync
// follower, the MIDI epoch rule, latency reports. It takes the Worker as a factory, so tests run it with a fake.

import { ClockEstimator, ProtocolError, isAllowedSocketUrl, SyncFollower, epochAccepts, midiDueWebMs, msToBeats, msg, normaliseChannel, nodeTypeForChannel,
  parseFromHub, text, QUANTUM } from "./bridge-protocol.js";

export { REMOTE_TYPES } from "./bridge-types.js";
export { nodeTypeForChannel };

export const DEFAULT_PORT = 47100;
export const DEFAULT_URL = `ws://127.0.0.1:${DEFAULT_PORT}/ws`;
const TARGET_MS = { low: 16, safe: 64 };        // §10.4
const LOOKAHEAD_MS = { low: 50, safe: 80 };     // §3.2: 50 to 100 ms
const ID_KEY = "bleep.bridge.id";

const uuid = () => {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; ++i) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/// The stable id of this browser (§6: Bleep Play pages get a stable ID in the browser's storage). Falls back to a
/// fresh one when storage is missing or blocked: the app then sees a new peer after a reload.
export function loadId(storage) {
  try {
    const old = storage && storage.getItem(ID_KEY);
    if (old) return old;
    const id = uuid();
    storage && storage.setItem(ID_KEY, id);
    return id;
  } catch { return uuid(); }
}

const wallClock = () => performance.timeOrigin + performance.now();  // the same in every thread, which is what the Worker's pings use

export class BridgeClient {
  /// options: url, allowRemote, name, mode ("low" | "safe"), id, lookaheadMs, sampleRate, workerFactory, workerUrl, storage, env, now
  constructor(options = {}) {
    const env = options.env || {};
    const g = globalThis;
    this.url = options.url || DEFAULT_URL;
    this.allowRemote = !!options.allowRemote;  // explicit: the default refuses every WebSocket URL that is not on this computer
    this.name = options.name || (g.navigator && g.navigator.userAgent ? "Web browser" : "Web");
    this.id = options.id || loadId(options.storage !== undefined ? options.storage : (() => { try { return g.localStorage; } catch { return null; } })());
    this.requestedMode = options.mode === "safe" ? "safe" : "low";
    // §4.1: the shared-memory path needs cross-origin isolation; without it only Safe is possible.
    const isolated = env.isolated !== undefined ? env.isolated : !!g.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
    this.mode = this.requestedMode === "low" && isolated ? "low" : "safe";
    this.modeNote = this.requestedMode === "low" && !isolated
      ? "Low latency needs a page served by the app (cross-origin isolated); using Safe latency." : "";
    this.sampleRate = options.sampleRate || 48000;
    this.lookaheadMs = options.lookaheadMs ?? LOOKAHEAD_MS[this.mode];
    this.workerFactory = options.workerFactory || (() => new Worker(options.workerUrl || new URL("./bridge-worker.js", import.meta.url), { type: "module", name: "bleep-bridge" }));
    this.now = options.now || wallClock;

    this.status = "idle";
    this.clock = new ClockEstimator();
    this.sync = new SyncFollower(this.clock);
    this.hub = null;                  // the welcome message
    this.channels = new Map();        // channel number → channel (what the hub announced)
    this.opened = new Map();          // key → {key, kind, dir, name}: what this page asked for; reopened after a reconnect
    this.stats = { staleMidiIn: 0, staleMidiOut: 0, protocolErrors: 0 };
    this.processingMs = null;         // our own delay, reported to the hub (set by attachAudio or setProcessingLatency)
    this.node = null;
    this.worker = null;
    this.listeners = new Map();
  }

  // ---- events ----------------------------------------------------------------------------------------
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this.listeners.get(type)?.delete(fn); }
  #emit(type, payload) {
    for (const fn of [...(this.listeners.get(type) || [])]) {
      try { fn(payload); } catch (e) { if (type !== "error") this.#emit("error", { code: "listener", message: String(e && e.message || e) }); }
    }
  }
  #setStatus(state, extra = {}) {
    this.status = state;
    this.#emit("status", { state, mode: this.mode, ...extra });
  }

  // ---- connection ---------------------------------------------------------------------------------------
  #ensureWorker() {
    if (this.worker) return this.worker;
    const w = this.workerFactory();
    w.onmessage = (e) => this.#fromWorker(e.data);
    this.worker = w;
    return w;
  }

  /// Hands the audio worklet a line to the Worker (so audio never passes through this thread) and listens for
  /// the MIDI the board sends. `node`: an AudioWorkletNode of worklet.js ("bleep-processor") or of "bleep-bridge".
  attachAudio(node, ctx) {
    const w = this.#ensureWorker();
    this.node = node;
    if (ctx) {
      this.sampleRate = ctx.sampleRate;
      // §3.2: our own processing delay is at least one render quantum, plus what the output adds.
      if (this.processingMs === null) this.processingMs = (QUANTUM / ctx.sampleRate + (ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
    }
    const mc = new MessageChannel();
    node.port.postMessage({ cmd: "bridge-port", port: mc.port2 }, [mc.port2]);
    w.postMessage({ type: "worklet-port", port: mc.port1 }, [mc.port1]);
    node.port.addEventListener("message", (e) => {
      const m = e.data;
      if (m && m.cmd === "bridge" && m.op === "midi-out") this.#midiFromBoard(m);
    });
    if (node.port.start) node.port.start();
    this.#reportAllLatencies();
  }

  connect() {
    if (!isAllowedSocketUrl(this.url, { allowRemote: this.allowRemote })) {
      this.#setStatus("failed", { reason: "the web link only connects to the app on this computer", code: "url" });
      return;
    }
    const w = this.#ensureWorker();
    this.#setStatus("connecting");
    w.postMessage({ type: "connect", url: this.url, allowRemote: this.allowRemote, mode: this.mode, shared: this.mode === "low", sampleRate: this.sampleRate,
      targetMs: TARGET_MS,
      hello: text(msg.hello({ id: this.id, name: this.name, sampleRate: this.sampleRate, quantum: QUANTUM, mode: this.mode })) });
  }

  disconnect() {
    if (this.worker) this.worker.postMessage({ type: "disconnect" });
    this.#linkLost();
    this.#setStatus("closed");
  }

  /// Ends the Worker too (when the page is done with the link for good).
  terminate() {
    this.disconnect();
    if (this.worker && this.worker.terminate) this.worker.terminate();
    this.worker = null;
  }

  get connected() { return this.status === "open"; }

  #send(m) { if (this.worker && (this.status === "open" || this.status === "handshake")) this.worker.postMessage({ type: "send", data: text(m) }); }

  #linkLost() {
    for (const c of this.channels.values()) c.online = false;  // they are ghosts now: the board keeps its nodes and cables (§6)
    this.sync.reset();
    this.hub = null;
    this.#emit("channels", this.listChannels());
  }

  // ---- from the Worker ------------------------------------------------------------------------------------
  #fromWorker(m) {
    switch (m.type) {
      case "status": {
        if (m.state === "connected") {  // a new socket: the hub will announce everything again
          this.channels.clear();
          this.sync.reset();
          this.#setStatus("handshake");
        } else {
          if (m.state !== "connecting") this.#linkLost();
          this.#setStatus(m.state, { attempt: m.attempt, delayMs: m.delayMs, reason: m.reason, code: m.code });
        }
        break;
      }
      case "text": this.#onText(m.data); break;
      case "clock": this.clock.best = { offset: m.offset, rtt: m.rtt, at: this.now() }; this.clock.samples = m.samples; this.#emit("clock", { offset: m.offset, rtt: m.rtt }); break;
      case "clock-reset": this.clock.best = null; break;
      case "stats": { const { type, ...rest } = m; this.stats = { ...this.stats, ...rest }; this.#emit("stats", this.stats); break; }
      case "error": this.#emit("error", { code: m.code, message: m.message }); break;
    }
  }

  #onText(data) {
    let m;
    try { m = parseFromHub(data); } catch (e) {
      if (e instanceof ProtocolError && e.code === "unknown-op") return;  // a newer hub: ignore what we don't know
      this.stats.protocolErrors++;
      this.#emit("error", { code: "protocol", message: e.message });
      return;
    }
    switch (m.op) {
      case "welcome":
        this.hub = m;
        this.sync.setEpoch(m.epoch);
        this.#setStatus("open", { hub: m.hub });
        for (const o of this.opened.values()) this.#sendOpen(o);
        this.#emit("welcome", m);
        break;
      case "error": this.#emit("error", { code: m.code, message: m.message || m.code }); break;
      case "channel": this.#setChannel(m); this.#emit("channels", this.listChannels()); break;
      case "channels":
        this.channels.clear();
        for (const c of m.list) this.#setChannel(c);
        this.#emit("channels", this.listChannels());
        break;
      case "channel-gone": {
        const c = this.channels.get(m.ch);
        if (c) { c.online = false; this.#emit("channels", this.listChannels()); }
        break;
      }
      case "sync":
        if (this.sync.apply(m)) this.#emit("sync", this.syncState());
        break;
      case "flush":
        this.sync.setEpoch(m.epoch);
        this.#emit("flush", { epoch: this.sync.epoch });
        break;
      case "midi": this.#midiFromHub(m); break;
    }
  }

  #setChannel(m) {
    const c = normaliseChannel(m);
    this.channels.set(c.ch, c);
    this.#reportLatency(c);
  }

  // ---- channels ------------------------------------------------------------------------------------------
  /// What the hub offers and what this page opened, as a list of {ch, kind, dir, key, name, port, source, online, latency, reactive}.
  listChannels() { return [...this.channels.values()]; }
  /// A channel by number, or by `key` (+ optional kind and dir, since one key may have two channels).
  channelFor(key, kind, dir) {
    for (const c of this.channels.values()) if (c.key === key && (!kind || c.kind === kind) && (!dir || c.dir === dir)) return c;
    return null;
  }

  /// This page bridges one of its nodes (§10.3 `open`). The call is remembered and repeated after every reconnect.
  /// `dir`: "fromWeb" | "toWeb" | "both" (default). The hub answers with `channel` message(s) carrying the same key.
  openChannel({ key, kind, dir = "both", name }) {
    const o = { key, kind, dir, name: name || key };
    msg.open(o);  // validates now, not on the next reconnect
    this.opened.set(key, o);
    this.#sendOpen(o);
    return o;
  }
  #sendOpen(o) { this.#send(msg.open(o)); }
  closeChannel(key) {
    if (!this.opened.delete(key)) return;
    this.#send(msg.close(key));
    for (const [ch, c] of this.channels) if (c.key === key && c.port === "remote") this.channels.delete(ch);
    this.#emit("channels", this.listChannels());
  }

  // ---- MIDI ------------------------------------------------------------------------------------------------
  /// The ms the audio of a channel is delayed by on this side, so MIDI can be lined up with it (§3.2).
  get targetMs() { return TARGET_MS[this.mode]; }
  get lookaheadBeats() { return this.sync.valid ? msToBeats(this.lookaheadMs, this.sync.tempo) : 0; }

  /// MIDI to the hub on a `fromWeb` midi channel (number, or the key of a channel this page opened).
  /// events: [[beat, status, d1, d2], …] or [{beat, status, d1, d2}]; a missing beat (null/undefined) means
  /// "now": the transport's beat plus the lookahead (`lookaheadBeats`, default the `lookaheadMs` option), or -1
  /// ("as soon as possible") while the transport is stopped. `epoch` (default: the current one): events made
  /// for an older epoch than the hub's are stale after a flush and are dropped here. Returns how many were sent.
  sendMidi(ch, events, { epoch, lookaheadBeats } = {}) {
    const c = typeof ch === "number" ? this.channels.get(ch) : this.channelFor(ch, "midi", "fromWeb");
    if (!c || c.kind !== "midi" || c.dir !== "fromWeb" || !this.connected) return 0;
    const e = epoch === undefined ? this.sync.epoch : epoch;
    if (!epochAccepts(e, this.sync.epoch)) { this.stats.staleMidiOut += events.length; return 0; }
    const lead = lookaheadBeats === undefined ? this.lookaheadBeats : lookaheadBeats;
    const now = this.sync.valid && this.sync.playing ? this.getBeat() : null;
    const ev = events.map((x) => {
      const [beat, status, d1, d2] = Array.isArray(x) ? x : [x.beat, x.status, x.d1, x.d2];
      return [beat == null ? (now === null ? -1 : now + lead) : beat, status, d1, d2 ?? 0];
    });
    let sent = 0;
    for (let i = 0; i < ev.length; i += 256) {  // a message stays small
      const part = ev.slice(i, i + 256);
      this.#send(msg.midi(c.ch, e >>> 0, part));
      sent += part.length;
    }
    return sent;
  }

  #midiFromHub(m) {
    if (!epochAccepts(m.epoch, this.sync.epoch)) { this.stats.staleMidiIn += m.ev.length; return; }
    const c = this.channels.get(m.ch);
    const dueWebMs = midiDueWebMs(this.clock, m.t, this.targetMs);
    this.#emit("midi", { ch: m.ch, key: c ? c.key : null, epoch: m.epoch, t: m.t, ev: m.ev, dueWebMs });
    if (this.node && c) {
      // The worklet counts in samples: how far from now each event is due.
      const delay = Math.max(0, (dueWebMs - this.now()) * this.sampleRate / 1000);
      this.node.port.postMessage({ cmd: "bridge", op: "midi", key: c.key,
        events: m.ev.map(([, status, d1, d2]) => ({ delay, status, d1, d2 })) });
    }
  }

  /// MIDI the board made in the worklet (a node bound to a channel key), spread over the lookahead.
  #midiFromBoard(m) {
    const tempo = this.sync.tempo, playing = this.sync.valid && this.sync.playing;
    const events = m.events.map(([offset, status, d1, d2]) => [playing ? this.getBeat() + this.lookaheadBeats + msToBeats(offset / this.sampleRate * 1000, tempo) : -1, status, d1, d2]);
    this.sendMidi(m.key, events);
  }

  // ---- sync ----------------------------------------------------------------------------------------------------
  getBeat() { return this.sync.beatAt(this.now()); }
  getTempo() { return this.sync.tempo; }
  get playing() { return this.sync.playing; }
  get leader() { return this.sync.leader; }
  get epoch() { return this.sync.epoch; }
  syncState() { return { beat: this.getBeat(), tempo: this.sync.tempo, playing: this.sync.playing, leader: this.sync.leader, epoch: this.sync.epoch, quantum: this.sync.quantum }; }
  /// §5: Bleep Play can ask; the leader decides (the answer is the next `sync`).
  requestTempo(bpm) { this.#send(msg.request({ tempo: bpm })); }
  requestPlay(play = true) { this.#send(msg.request({ play: !!play })); }

  // ---- latency ---------------------------------------------------------------------------------------------------
  /// The web side's own delay in ms, reported to the hub for every channel so it can add up round trips (§3.2).
  get latencyMs() { return this.processingMs ?? QUANTUM / this.sampleRate * 1000; }
  setProcessingLatency(ms) { this.processingMs = ms; this.#reportAllLatencies(); }
  /// One channel's own figure (overrides the general one until the next setProcessingLatency).
  reportLatency(ch, ms) { this.#send(msg.latency(ch, ms)); }
  #reportLatency(c) { if (c.kind === "audio" || c.kind === "midi") this.#send(msg.latency(c.ch, this.latencyMs)); }
  #reportAllLatencies() { for (const c of this.channels.values()) this.#reportLatency(c); }
}

// ---- joining the app from a page -------------------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
/// True when this page is the one the app serves (same origin as the hub: no mixed content, isolated, Low latency).
export const servedByApp = (loc = globalThis.location) => !!loc && LOCAL_HOSTS.has(loc.hostname);

/// Words for a failed connection, by cause (§4: Chrome and Edge may ask for local network access, Firefox
/// allows it, Safari blocks it; the app's own page works everywhere).
export function explainFailure({ loc = globalThis.location, userAgent = globalThis.navigator && globalThis.navigator.userAgent || "", port = DEFAULT_PORT, code, reason } = {}) {
  const appPage = `http://127.0.0.1:${port}/`;
  if (code === "denied") return "The app did not allow this page. In Bleep App, open File → Settings → Web connection and allow it, then press Connect again.";
  if (code === "version") return "The app speaks a different version of the web link. Update the app or this page so both are the same release.";
  if (servedByApp(loc)) return `Cannot reach the app on port ${port}. Start Bleep App and turn on File → Settings → Web connection.`;
  const safari = /Safari/.test(userAgent) && !/Chrom(e|ium)|Edg|OPR|Android/.test(userAgent);
  const https = loc && loc.protocol === "https:";
  if (safari && https) return `Safari does not let a secure page talk to the app on this computer (it blocks ws://127.0.0.1 as mixed content). Open the board from the app itself instead: ${appPage}`;
  if (https) return `Could not reach the app on port ${port}. Start Bleep App and turn on File → Settings → Web connection. If the browser asked about local network access, allow it. ` +
    `Safari blocks this connection from a secure page; every browser works from the app's own page: ${appPage}` + (reason ? ` (${reason})` : "");
  return `Could not reach the app on port ${port}. Start Bleep App and turn on File → Settings → Web connection, or open the board from the app: ${appPage}`;
}

/// The "Connect to app" button: connects once and says why when it cannot. Resolves {ok, client, message,
/// servedByApp}; on failure the client is disconnected (no retry storm behind a dialog).
export function connectToApp({ client, port = DEFAULT_PORT, timeoutMs = 5000, loc = globalThis.location, userAgent, ...options } = {}) {
  const c = client || new BridgeClient({ url: `ws://127.0.0.1:${port}/ws`, ...options });
  const here = servedByApp(loc);
  return new Promise((resolve) => {
    let done = false, timer = null;
    const finish = (ok, info = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      if (!ok) c.disconnect();
      resolve({ ok, client: c, servedByApp: here, mode: c.mode,
        message: ok ? (c.modeNote || (here ? "Connected." : "Connected (Safe latency: open the app's own page for low latency).")) : explainFailure({ loc, userAgent, port, ...info }) });
    };
    const off = c.on("status", (s) => {
      if (s.state === "open") finish(true);
      else if (s.state === "denied") finish(false, { code: "denied" });
      else if (s.state === "failed") finish(false, { reason: s.reason, code: s.code });
      else if (s.state === "retrying" && !c.hub) finish(false, { reason: s.reason });
    });
    c.on("error", (e) => { if (e.code === "version") finish(false, { code: "version" }); });
    timer = setTimeout(() => finish(false, { reason: "timeout" }), timeoutMs);
    c.connect();
  });
}
