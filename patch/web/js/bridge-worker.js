// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// bridge-worker.js — a dedicated Worker that owns the WebSocket of the web link (doc/specs/bridges.md §4.1,
// §10). Why a Worker: the main thread (UI, garbage collection) must not be in the audio path, which is what
// allows a 10 to 20 ms jitter buffer. The Worker
//   · connects, says hello, reconnects with backoff, answers pings and keeps the hub-clock estimate,
//   · decodes audio packets and writes them into a ring the AudioWorklet reads (SharedArrayBuffer, when the
//     page is cross-origin isolated), or posts them to the worklet as Float32Array chunks (the "Safe" path),
//   · drains the rings the worklet writes (or takes its chunks) and sends them as packets,
//   · forwards every text message to the main thread untouched, which owns the protocol state.
//
// The worklet is reached through a MessagePort that the main thread hands over ({type:"worklet-port"}), so
// even in the Safe path no audio goes through main-thread JavaScript.
//
// The logic lives in BridgeWorkerCore, which takes its environment (WebSocket, timers, post) as arguments:
// the same code runs in the Worker and under node in the tests.

import { ClockEstimator, ProtocolError, decodeAudioPacket, encodeAudioPacket, isAllowedSocketUrl, parseFromHub, seqGap, text, msg } from "./bridge-protocol.js";
import { AudioRing, Packetizer, nextPow2 } from "./bridge-ring.js";

export const DEFAULTS = {
  targetMs: { low: 16, safe: 64 },   // §10.4
  backoffMs: [250, 500, 1000, 2000, 5000],
  maxFailedAttempts: 8,              // connection attempts that never got a socket open before we give up
  quickPings: 8, quickPingMs: 250, pingMs: 2000,
  pumpMs: 2,                         // how often the outgoing rings are drained
  outRingFrames: 8192,
  maxBuffered: 512 * 1024,           // bytes queued in the socket above which outgoing audio is dropped (late audio is worse than none)
};

export class BridgeWorkerCore {
  /// env: {post(msg, transfer?), WebSocket, now(), setTimeout, clearTimeout, setInterval, clearInterval, random()}
  constructor(env, options = {}) {
    this.env = env;
    this.o = { ...DEFAULTS, ...options };
    this.cfg = null;
    this.ws = null;
    this.worklet = null;     // MessagePort to the worklet
    this.clock = new ClockEstimator();
    this.stopped = true;
    this.attempt = 0;        // consecutive connections that did not open
    this.reconnects = 0;
    this.hubRate = 0;
    this.inbound = new Map();   // channel number → {key, ring?, lastSeq}
    this.outbound = new Map();  // channel number → {key, ring?, packetizer}
    this.stats = { packetsIn: 0, packetsOut: 0, lost: 0, bad: 0, droppedOut: 0, unknownChannel: 0 };
    this.timers = {};
  }

  // ---- messages from the main thread -----------------------------------------------------------------
  handle(m) {
    switch (m.type) {
      case "connect": this.#start(m); break;
      case "disconnect": this.#stop("closed"); break;
      case "send": this.#sendText(m.data); break;
      case "worklet-port": this.#setWorklet(m.port); break;
    }
  }

  #post(m, transfer) { this.env.post(m, transfer); }
  #status(state, extra = {}) { this.#post({ type: "status", state, attempt: this.attempt, ...extra }); }

  #start(m) {
    this.#stop(null);
    this.cfg = { url: m.url, allowRemote: !!m.allowRemote, hello: m.hello, mode: m.mode === "low" && m.shared ? "low" : "safe", shared: !!m.shared && m.mode === "low",
      sampleRate: m.sampleRate || 48000, targetMs: m.targetMs || this.o.targetMs };
    this.stopped = false;
    this.attempt = 0;
    this.reconnects = 0;
    this.#open();
  }

  #open() {
    if (this.stopped) return;
    this.#status(this.reconnects ? "retrying" : "connecting");
    let ws;
    try {
      if (!isAllowedSocketUrl(this.cfg.url, { allowRemote: this.cfg.allowRemote, loc: this.env.location })) throw new Error("the web link only connects to the app on this computer");
      ws = new this.env.WebSocket(this.cfg.url);
    } catch (e) {  // e.g. a mixed-content SecurityError: the page can never connect, retrying is pointless
      this.#post({ type: "error", code: "socket", message: String(e && e.message || e) });
      this.stopped = true;
      this.#status("failed", { reason: String(e && e.message || e) });
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.attempt = 0;
      this.#resetChannels();
      this.#post({ type: "clock-reset" });
      this.clock = new ClockEstimator();
      this.#sendText(this.cfg.hello);
      this.#startPings();
      this.#startPump();
      this.#status("connected");
    };
    ws.onmessage = (ev) => (typeof ev.data === "string" ? this.#onText(ev.data) : this.#onBinary(ev.data));
    ws.onerror = () => {};  // onclose follows; browsers give no detail anyway
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;  // a socket we already replaced
      this.ws = null;
      this.#clearTimers();
      if (this.stopped) return;
      if (!opened) this.attempt++;
      else this.reconnects++;
      if (this.attempt >= this.o.maxFailedAttempts) {
        this.stopped = true;
        this.#status("failed", { reason: "could not connect", code: ev && ev.code });
        return;
      }
      // a lost connection retries quickly; one that never opened backs off further with every failure
      const base = this.o.backoffMs[Math.min(opened ? 0 : this.attempt - 1, this.o.backoffMs.length - 1)];
      const delay = Math.round(base * (0.75 + 0.5 * this.env.random()));
      this.#status("retrying", { delayMs: delay, code: ev && ev.code });
      this.timers.retry = this.env.setTimeout(() => { this.timers.retry = null; this.#open(); }, delay);
    };
  }

  #stop(state) {
    this.stopped = true;
    this.#clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(1000); } catch { /* already closed */ } }
    this.#resetChannels();
    if (state) this.#status(state);
  }

  #clearTimers() {
    for (const k of Object.keys(this.timers)) {
      const t = this.timers[k];
      if (t == null) continue;
      if (k === "pump") this.env.clearInterval(t); else this.env.clearTimeout(t);
    }
    this.timers = {};
  }

  #sendText(data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
  }

  // ---- clock probes ----------------------------------------------------------------------------------
  #startPings() {
    let n = 0;
    const tick = () => {
      this.#sendText(text(msg.ping(this.env.now())));
      n++;
      this.timers.ping = this.env.setTimeout(tick, n < this.o.quickPings ? this.o.quickPingMs : this.o.pingMs);
    };
    tick();
  }

  // ---- incoming ------------------------------------------------------------------------------------------
  #onText(data) {
    let m;
    try { m = parseFromHub(data); } catch (e) {
      if (!(e instanceof ProtocolError && e.code === "unknown-op")) this.#post({ type: "error", code: "protocol", message: e.message });
      return;
    }
    switch (m.op) {
      case "pong": {
        const changed = this.clock.addSample(m.t, m.hub, this.env.now());
        if (changed || this.clock.samples % 16 === 0) this.#post({ type: "clock", offset: this.clock.offset, rtt: this.clock.rtt, samples: this.clock.samples });
        return;  // the main thread has no use for pongs
      }
      case "ping": this.#sendText(text({ op: "pong", t: m.t })); return;
      case "welcome": this.hubRate = m.sampleRate; break;
      case "error":
        // "denied" and "version" will not get better by asking again; "busy" may.
        if (m.code === "denied" || m.code === "version") { this.#post({ type: "text", data }); this.#stop(m.code === "denied" ? "denied" : "failed"); return; }
        break;
      case "channel": this.#channel(m); break;
      case "channels": this.#channels(m.list); break;
      case "channel-gone": this.#gone(m.ch); break;
    }
    this.#post({ type: "text", data });
  }

  #onBinary(data) {
    if (data && data.byteLength > 16 + 8 * 2048) { this.stats.bad++; return; }  // more than the largest packet
    let p;
    try { p = decodeAudioPacket(data); } catch { this.stats.bad++; return; }
    const entry = this.inbound.get(p.channel);
    if (!entry) { this.stats.unknownChannel++; return; }
    this.stats.packetsIn++;
    if (entry.lastSeq !== undefined) this.stats.lost += seqGap(entry.lastSeq, p.seq);
    entry.lastSeq = p.seq;
    if (entry.ring) entry.ring.write(p.left, p.right, p.frames);
    else if (this.worklet) this.worklet.postMessage({ t: "audio", ch: p.channel, l: p.left, r: p.right }, [p.left.buffer, p.right.buffer]);
  }

  // ---- channels ------------------------------------------------------------------------------------------
  #channels(list) {
    const live = new Set(list.map((c) => c.ch));
    for (const ch of [...this.inbound.keys(), ...this.outbound.keys()]) if (!live.has(ch)) this.#drop(ch);
    for (const c of list) this.#channel(c);
  }

  #channel(c) {
    if (c.kind !== "audio") return;
    const table = c.dir === "toWeb" ? this.inbound : this.outbound;
    const old = table.get(c.ch);
    if (old && old.key === c.key) {  // an update of a channel we know (online flag, latency)
      this.#toWorklet({ t: "online", ch: c.ch, online: c.online !== false });
      return;
    }
    if (old) this.#drop(c.ch);
    const shared = this.cfg.shared;
    const srWeb = this.cfg.sampleRate, srHub = this.hubRate || srWeb;
    let entry;
    if (c.dir === "toWeb") {
      const target = Math.max(1, Math.round(this.cfg.targetMs[this.cfg.mode] * srHub / 1000));
      entry = { key: c.key, target, srSource: srHub, lastSeq: undefined, ring: null };
      // room for 4 × target (overrun) plus a few packets, in source frames
      const frames = nextPow2(4 * target + 4096);
      if (shared) entry.ring = AudioRing.create(frames, { shared: true });
      entry.attach = { t: "attach", ch: c.ch, key: c.key, kind: "audio", dir: "in", mode: shared ? "ring" : "port", sab: entry.ring ? entry.ring.buffer : null,
        srSource: srHub, srSink: srWeb, targetFrames: target, capacity: frames };
    } else {
      entry = { key: c.key, packetizer: new Packetizer({ channel: c.ch, packetFrames: 128 }), ring: null, scratchL: new Float32Array(4096), scratchR: new Float32Array(4096) };
      if (shared) entry.ring = AudioRing.create(this.o.outRingFrames, { shared: true });
      entry.attach = { t: "attach", ch: c.ch, key: c.key, kind: "audio", dir: "out", mode: shared ? "ring" : "port", sab: entry.ring ? entry.ring.buffer : null };
    }
    table.set(c.ch, entry);
    this.#toWorklet(entry.attach);
    if (c.online === false) this.#toWorklet({ t: "online", ch: c.ch, online: false });
  }

  #gone(ch) { this.#toWorklet({ t: "online", ch, online: false }); }  // a ghost: the web keeps the node and its cables

  #drop(ch) {
    this.inbound.delete(ch);
    this.outbound.delete(ch);
    this.#toWorklet({ t: "detach", ch });
  }

  #resetChannels() {
    this.inbound.clear();
    this.outbound.clear();
    this.#toWorklet({ t: "reset" });
  }

  #toWorklet(m) { if (this.worklet) this.worklet.postMessage(m); }

  #setWorklet(port) {
    this.worklet = port;
    if (!port) return;
    port.onmessage = (e) => this.#fromWorklet(e.data);
    // Channels that exist already (the audio started after the connection): tell the new worklet about them.
    for (const e of [...this.inbound.values(), ...this.outbound.values()]) port.postMessage(e.attach);
  }

  /// Safe path: the worklet posts its quanta; they are cut into packets here.
  #fromWorklet(m) {
    if (m.t !== "audio") return;
    const entry = this.outbound.get(m.ch);
    if (!entry) return;
    this.#sendPackets(entry.packetizer.push(m.l, m.r, m.l.length));
  }

  // ---- outgoing ------------------------------------------------------------------------------------------
  #startPump() {
    if (!this.cfg.shared) return;
    this.timers.pump = this.env.setInterval(() => this.pump(), this.o.pumpMs);
  }

  /// Drains the shared rings the worklet writes and sends what is there (also called by tests).
  pump() {
    for (const entry of this.outbound.values()) {
      if (!entry.ring) continue;
      for (let guard = 0; guard < 8; ++guard) {
        const n = entry.ring.read(entry.scratchL, entry.scratchR, entry.scratchL.length);
        if (n === 0) break;
        this.#sendPackets(entry.packetizer.push(entry.scratchL, entry.scratchR, n));
        if (n < entry.scratchL.length) break;
      }
    }
  }

  #sendPackets(packets) {
    const ws = this.ws;
    for (const p of packets) {
      if (!ws || ws.readyState !== 1) { this.stats.droppedOut++; continue; }
      if (ws.bufferedAmount > this.o.maxBuffered) { this.stats.droppedOut++; continue; }
      ws.send(encodeAudioPacket(p));
      this.stats.packetsOut++;
    }
  }
}

// ---- running as a Worker ------------------------------------------------------------------------------
// Only when this file is the Worker's script; importing it elsewhere (main thread, tests) stays inert.
if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
  const core = new BridgeWorkerCore({
    post: (m, t) => self.postMessage(m, t || []),
    WebSocket: self.WebSocket,
    now: () => performance.timeOrigin + performance.now(),  // an absolute clock: the main thread's agrees with it to well under a ms
    setTimeout: (f, ms) => self.setTimeout(f, ms), clearTimeout: (t) => self.clearTimeout(t),
    setInterval: (f, ms) => self.setInterval(f, ms), clearInterval: (t) => self.clearInterval(t),
    random: Math.random,
  });
  self.onmessage = (e) => core.handle(e.data);
  setInterval(() => core.ws && self.postMessage({ type: "stats", ...core.stats }), 1000);
}
