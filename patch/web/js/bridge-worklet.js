// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// bridge-worklet.js — the audio-thread end of the web link (doc/specs/bridges.md §4.1, §10.4). It reads the
// rings the bridge Worker writes (incoming audio), writes the rings it drains (outgoing audio), and keeps
// the MIDI the hub sent until its time comes, so process() never touches the main thread.
//
//   BridgeEndpoint  the state: channels by key, jitter readers, MIDI queues. One per AudioWorkletGlobalScope.
//   RemoteBinding   what a board node bound to a channel key does each chunk (the hook graph.js calls).
//   "bleep-bridge"  a stand-alone AudioWorkletProcessor over the same endpoint, for a plain Web Audio graph:
//                   input 0 goes to the channel the `route` names, output 0 plays another one.
//
// Two ways audio gets here, with the same API above them:
//   ring mode  (cross-origin isolated): a SharedArrayBuffer ring per channel, shared with the Worker.
//   port mode  (the Safe path): the Worker posts Float32Array chunks over a MessagePort; they are written
//              into a private ring here, and outgoing quanta are batched into 128-frame messages.
// Importable under node (the tests): the processor registers only where AudioWorkletProcessor exists.

import { AudioRing, JitterReader, nextPow2 } from "./bridge-ring.js";

const SCRATCH = 512;   // the largest block pulled in one call (the engine pulls 32, the stand-alone processor 128)
const OUT_BATCH = 128; // port mode: frames per message to the Worker

/// MIDI the hub sent, in the shape graph.js's MidiState has, with sample offsets inside the chunk.
class RemoteMidiState {
  constructor() { this.held = []; this.pending = []; this.chunkEvents = []; this.pressure = 0; this.bend = 0.5; this.cc = {}; }
  apply(status, d1, d2, offset) {
    const cmd = status & 0xf0, channel = status & 0x0f, note = d1;
    if (cmd === 0x90 && d2 > 0) {
      const velocity = d2 / 127;
      this.held = this.held.filter((h) => h.note !== note);
      this.held.push({ note, velocity });
      this.pending.push({ type: 0, channel, offset, note, pitch: (note - 60) / 12, value: velocity });
    } else if (cmd === 0x80 || cmd === 0x90) {
      this.held = this.held.filter((h) => h.note !== note);
      this.pending.push({ type: 1, channel, offset, note, pitch: (note - 60) / 12, value: 0 });
    } else if (cmd === 0xb0) {
      this.cc[d1] = d2 / 127;
      if (d1 === 123 || d1 === 120) this.held = [];  // all notes off
    } else if (cmd === 0xd0) this.pressure = d1 / 127;
    else if (cmd === 0xe0) this.bend = ((d2 << 7) | d1) / 16383;
  }
  beginChunk() { this.chunkEvents = this.pending; this.pending = []; }
}

export class BridgeEndpoint {
  constructor({ sampleRate = 48000, now = () => 0 } = {}) {
    this.sampleRate = sampleRate;
    this.now = now;                 // the clock MIDI delays are counted in (the engine's sample position)
    this.main = null;               // (message) → main thread, for MIDI going out
    this.port = null;               // from the Worker
    this.byCh = new Map();          // channel number → entry
    this.ins = new Map();           // key → incoming audio entry
    this.outs = new Map();          // key → outgoing audio entry
    this.midiQueues = new Map();    // key → [{frame, status, d1, d2}] sorted by frame
    this.route = { in: null, out: null };
    this.stats = { chunksIn: 0, chunksOut: 0 };
  }

  /// The MessagePort from the Worker.
  connect(port) {
    this.port = port;
    port.onmessage = (e) => this.fromWorker(e.data);
  }

  fromWorker(m) {
    switch (m.t) {
      case "attach": this.#attach(m); break;
      case "audio": {  // port mode, incoming
        const e = this.byCh.get(m.ch);
        if (e && e.dir === "in") { e.ring.write(m.l, m.r, m.l.length); this.stats.chunksIn++; }
        break;
      }
      case "online": {
        const e = this.byCh.get(m.ch);
        if (e) {
          e.online = m.online;
          if (!m.online && e.reader) { e.reader.reset(); e.ring.skip(e.ring.available()); }  // a ghost: stale audio must not play when it returns
        }
        break;
      }
      case "detach": this.#detach(m.ch); break;
      case "reset": for (const ch of [...this.byCh.keys()]) this.#detach(ch); break;
    }
  }

  #attach(m) {
    this.#detach(m.ch);
    const e = { ch: m.ch, key: m.key, dir: m.dir, mode: m.mode, online: true };
    if (m.dir === "in") {
      e.ring = m.mode === "ring" ? new AudioRing(m.sab) : AudioRing.create(nextPow2(m.capacity || 4 * m.targetFrames + 4096));
      e.reader = new JitterReader(e.ring, { targetFrames: m.targetFrames, srSource: m.srSource, srSink: this.sampleRate });
      e.l = new Float32Array(SCRATCH); e.r = new Float32Array(SCRATCH);
      e.stamp = -1; e.got = 0; e.n = 0;
      this.ins.set(m.key, e);
    } else {
      if (m.mode === "ring") e.ring = new AudioRing(m.sab);
      else { e.batchL = new Float32Array(OUT_BATCH); e.batchR = new Float32Array(OUT_BATCH); e.filled = 0; }
      e.owner = null; e.stamp = -1;
      this.outs.set(m.key, e);
    }
    this.byCh.set(m.ch, e);
  }

  #detach(ch) {
    const e = this.byCh.get(ch);
    if (!e) return;
    this.byCh.delete(ch);
    if (this.ins.get(e.key) === e) this.ins.delete(e.key);
    if (this.outs.get(e.key) === e) this.outs.delete(e.key);
  }

  /// Control messages from the main thread (cmd "bridge"): MIDI from the hub, the stand-alone processor's route.
  message(m, reply) {
    if (reply) this.main = reply;
    switch (m.op) {
      case "midi": {
        const q = this.midiQueues.get(m.key) || [];
        const base = this.now();
        for (const ev of m.events) q.push({ frame: base + Math.max(0, Math.round(ev.delay)), status: ev.status, d1: ev.d1, d2: ev.d2 });
        q.sort((a, b) => a.frame - b.frame);  // stable: events of one frame keep their order
        if (q.length > 4096) q.splice(0, q.length - 4096);  // nobody is draining it: keep the newest
        this.midiQueues.set(m.key, q);
        break;
      }
      case "route": this.route = { in: m.in ?? null, out: m.out ?? null }; break;
      case "drop-midi": this.midiQueues.delete(m.key); break;
    }
  }

  /// True when a channel with this key and direction is attached and the hub says it is online.
  hasAudio(key, dir) { const e = (dir === "in" ? this.ins : this.outs).get(key); return !!e && e.online; }

  /// Incoming audio for `key`: {l, r, got} for `n` frames (`got` of them real, the rest silence), or null when
  /// there is no such channel. `stamp` identifies the chunk: several nodes bound to one key share one read.
  pull(key, stamp, n) {
    const e = this.ins.get(key);
    if (!e || !e.online) return null;
    if (e.stamp !== stamp || e.n !== n) {
      e.got = e.reader.read(e.l, e.r, n);
      e.stamp = stamp; e.n = n;
    }
    return e;
  }

  /// Audio for the hub. One node feeds a channel; a second one bound to the same key is ignored.
  push(key, owner, l, r, n) {
    const e = this.outs.get(key);
    if (!e || !e.online) return;
    if (e.owner === null) e.owner = owner;
    else if (e.owner !== owner) return;
    if (e.ring) { e.ring.write(l, r, n); this.stats.chunksOut++; return; }
    let at = 0;
    while (at < n) {
      const m = Math.min(n - at, OUT_BATCH - e.filled);
      e.batchL.set(l.subarray(at, at + m), e.filled);
      e.batchR.set(r.subarray(at, at + m), e.filled);
      e.filled += m; at += m;
      if (e.filled === OUT_BATCH) {
        const L = e.batchL, R = e.batchR;
        e.batchL = new Float32Array(OUT_BATCH); e.batchR = new Float32Array(OUT_BATCH); e.filled = 0;
        this.port?.postMessage({ t: "audio", ch: e.ch, l: L, r: R }, [L.buffer, R.buffer]);
        this.stats.chunksOut++;
      }
    }
  }

  /// The hub's MIDI for `key` that is due in the chunk [start, start + n): [{offset, status, d1, d2}]. Every node
  /// bound to the key gets the same events (the first call of a chunk takes them off the queue).
  takeMidi(key, start, n) {
    const q = this.midiQueues.get(key);
    if (!q) return [];
    if (q.stamp === start && q.taken) return q.taken;
    let k = 0;
    const out = [];
    while (k < q.length && q[k].frame < start + n) { const ev = q[k++]; out.push({ offset: Math.max(0, ev.frame - start), status: ev.status, d1: ev.d1, d2: ev.d2 }); }
    q.splice(0, k);
    q.stamp = start; q.taken = out;
    return out;
  }

  /// MIDI a node made, for the main thread to send to the hub: [[offset, status, d1, d2], …].
  sendMidi(key, events) { if (events.length) this.main?.({ cmd: "bridge", op: "midi-out", key, events }); }

  /// graph.js hook: the binding of a port node to a channel key.
  bind(node, key) { return new RemoteBinding(this, node, key); }
}

/// What a bound board node does each chunk. Direction follows what the node has: outputs l/r carry what the hub
/// sent, inputs l/r go to the hub, MIDI outputs follow the hub's MIDI, a `notes` input is sent to the hub.
export class RemoteBinding {
  constructor(endpoint, node, key) {
    this.ep = endpoint;
    this.key = key;
    const s = node.spec;
    this.outL = s.outputs.findIndex((o) => o.id === "l" && o.type === "audio");
    this.outR = s.outputs.findIndex((o) => o.id === "r" && o.type === "audio");
    this.inL = s.inputs.findIndex((o) => o.id === "l" && o.type === "audio");
    this.inR = s.inputs.findIndex((o) => o.id === "r" && o.type === "audio");
    this.notesInJack = s.inputs.findIndex((o) => o.id === "notes");
    this.midi = s.outputs.some((o) => o.id === "gate") ? new RemoteMidiState() : null;
    // graph.js runs the MIDI outputs for kind "midi-in", and plays audio-out/instrument into the local speakers
    // for those kinds: a bound node must do neither of its own accord.
    this.kind = this.midi ? "midi-in" : "remote";
    this.owner = {};
    if (this.midi) node.remoteMidi = this.midi;
  }

  run(node, n) {
    const ep = this.ep, stamp = node.engine.samplePos, v = node.views;
    const chunk = v.inputs.length / Math.max(node.spec.inputs.length, 1);  // = CHUNK, without importing module-host
    if (this.outL >= 0) {
      const a = ep.pull(this.key, stamp, n), o = v.outputs;
      const L = this.outL * chunk, R = (this.outR >= 0 ? this.outR : this.outL) * chunk;
      if (a) { o.set(a.l.subarray(0, n), L); o.set(this.outR >= 0 ? a.r.subarray(0, n) : a.l.subarray(0, n), R); }
      else { o.fill(0, L, L + n); o.fill(0, R, R + n); }
    }
    if (this.inL >= 0) {
      const l = v.inputs.subarray(this.inL * chunk, this.inL * chunk + n);
      const r = this.inR >= 0 && node.connectedIn[this.inR] ? v.inputs.subarray(this.inR * chunk, this.inR * chunk + n) : l;
      for (let i = 0; i < n; ++i) { const a = Math.abs(l[i]); if (a > (this.peakIn || 0)) this.peakIn = a; }  // for bridge-debug
      ep.push(this.key, this.owner, l, r, n);
    }
    if (this.midi) {
      for (const ev of ep.takeMidi(this.key, stamp, n)) this.midi.apply(ev.status, ev.d1, ev.d2, Math.min(ev.offset, n - 1));
      this.midi.beginChunk();
    }
  }

  /// graph.js hook: the events of a notes input jack, per chunk.
  notesIn(i, events) {
    if (i !== this.notesInJack || !events.length) return;
    const out = [];
    for (const e of events) {
      if (e.type === 0) out.push([e.offset, 0x90 | (e.channel & 15), e.note, Math.max(1, Math.min(127, Math.round(e.value * 127)))]);
      else if (e.type === 1) out.push([e.offset, 0x80 | (e.channel & 15), e.note, 0]);
    }
    this.ep.sendMidi(this.key, out);
  }
}

// ---- the processors -----------------------------------------------------------------------------------

/// The endpoint of this AudioWorkletGlobalScope, created on first use. worklet.js and the "bleep-bridge"
/// processor share it, since both run in the same scope.
let shared = null;
export function bridgeEndpoint() {
  if (!shared) shared = new BridgeEndpoint({ sampleRate: globalThis.sampleRate || 48000, now: () => globalThis.currentFrame || 0 });
  return shared;
}

if (typeof AudioWorkletProcessor !== "undefined" && typeof registerProcessor === "function") {
  class BleepBridgeProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.ep = bridgeEndpoint();
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m.cmd === "bridge-port") this.ep.connect(m.port);
        else if (m.cmd === "bridge") this.ep.message(m, (x) => this.port.postMessage(x));
      };
    }
    process(inputs, outputs) {
      const ep = this.ep, out = outputs[0], stamp = globalThis.currentFrame, n = out[0].length;
      const a = ep.route.in !== null ? ep.pull(ep.route.in, stamp, n) : null;
      if (a) { out[0].set(a.l.subarray(0, n)); (out[1] || out[0]).set(a.r.subarray(0, n)); }
      const inp = inputs[0];
      if (ep.route.out !== null && inp && inp[0]) ep.push(ep.route.out, this, inp[0], inp[1] || inp[0], n);
      return true;
    }
  }
  registerProcessor("bleep-bridge", BleepBridgeProcessor);
}
