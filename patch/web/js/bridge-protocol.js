// SPDX-License-Identifier: MIT
//
// bridge-protocol.js — the wire format of the web link (doc/specs/bridges.md §10.2, §10.3) as pure functions:
// the binary audio packet, the JSON messages and their validators, and the little bits of arithmetic both
// ends of the link must agree on (hub clock offset, beat extrapolation, MIDI epochs).
//
// No DOM, no Web Audio, no I/O: it runs on the main thread, in the bridge Worker, in the AudioWorklet and
// under node (the tests). Everything here follows §10 to the letter; where the spec is silent the choice
// is marked "SPEC GAP" so the spec can be corrected.

export const PROTOCOL_VERSION = 1;
export const AUDIO_PACKET_KIND = 1;
export const HEADER_BYTES = 16;
export const MAX_PACKET_FRAMES = 2048;
export const QUANTUM = 128;

export class ProtocolError extends Error {
  constructor(message, code = "malformed") { super(message); this.name = "ProtocolError"; this.code = code; }
}

// ---- binary audio packet ------------------------------------------------------------------------
//   u8 kind (=1) · u8 channel · u16 frames · u32 seq · i64 sampleTime · f32[frames] left · f32[frames] right
// All little-endian. Browsers are little-endian machines; the DataView path keeps the code correct anyway.

const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/// `{channel, seq, sampleTime, left, right}` → ArrayBuffer. `left`/`right` hold at least `frames` samples
/// (`frames` defaults to left.length); `right` may be omitted for a mono source (sent as both sides).
export function encodeAudioPacket({ channel, seq, sampleTime, left, right, frames }) {
  const n = frames ?? left.length;
  if (!Number.isInteger(channel) || channel < 0 || channel > 255) throw new ProtocolError(`channel ${channel} out of range`);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PACKET_FRAMES) throw new ProtocolError(`frames ${n} out of range 1..${MAX_PACKET_FRAMES}`);
  if (!Number.isSafeInteger(sampleTime) || sampleTime < 0) throw new ProtocolError("sampleTime must be a non-negative safe integer");
  const r = right || left;
  if (left.length < n || r.length < n) throw new ProtocolError("buffers shorter than frames");
  const out = new ArrayBuffer(HEADER_BYTES + 8 * n);
  const v = new DataView(out);
  v.setUint8(0, AUDIO_PACKET_KIND);
  v.setUint8(1, channel);
  v.setUint16(2, n, true);
  v.setUint32(4, seq >>> 0, true);
  v.setBigInt64(8, BigInt(sampleTime), true);
  if (LITTLE) {
    const f = new Float32Array(out, HEADER_BYTES, 2 * n);  // 16 is a multiple of 4: aligned
    f.set(n === left.length ? left : left.subarray(0, n), 0);
    f.set(n === r.length ? r : r.subarray(0, n), n);
  } else {
    for (let i = 0; i < n; ++i) { v.setFloat32(HEADER_BYTES + 4 * i, left[i], true); v.setFloat32(HEADER_BYTES + 4 * (n + i), r[i], true); }
  }
  return out;
}

/// ArrayBuffer | TypedArray | DataView → `{channel, frames, seq, sampleTime, left, right}` (fresh arrays, safe to
/// transfer). Throws ProtocolError on anything that is not exactly one well-formed packet.
export function decodeAudioPacket(data) {
  let bytes;
  if (data instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer)) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else throw new ProtocolError("audio packet must be binary");
  if (bytes.length < HEADER_BYTES) throw new ProtocolError(`packet of ${bytes.length} bytes is shorter than its header`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = v.getUint8(0);
  if (kind !== AUDIO_PACKET_KIND) throw new ProtocolError(`unknown binary kind ${kind}`, "unknown-kind");
  const frames = v.getUint16(2, true);
  if (frames < 1 || frames > MAX_PACKET_FRAMES) throw new ProtocolError(`frames ${frames} out of range 1..${MAX_PACKET_FRAMES}`);
  if (bytes.length !== HEADER_BYTES + 8 * frames) throw new ProtocolError(`packet of ${bytes.length} bytes does not match ${frames} frames`);
  const t = v.getBigInt64(8, true);
  if (t < 0n || t > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProtocolError("sampleTime out of range");
  const left = new Float32Array(frames), right = new Float32Array(frames);
  if (LITTLE) {
    const copy = bytes.slice(HEADER_BYTES).buffer;  // own, 4-aligned buffer
    left.set(new Float32Array(copy, 0, frames));
    right.set(new Float32Array(copy, 4 * frames, frames));
  } else {
    for (let i = 0; i < frames; ++i) { left[i] = v.getFloat32(HEADER_BYTES + 4 * i, true); right[i] = v.getFloat32(HEADER_BYTES + 4 * (frames + i), true); }
  }
  return { channel: v.getUint8(1), frames, seq: v.getUint32(4, true), sampleTime: Number(t), left, right };
}

/// Frames the next packet is behind `lastSeq` by, as a count of lost packets (0 = in order, u32 wrap-safe;
/// a reordered/duplicate packet counts as 0).
export function seqGap(lastSeq, seq) {
  const d = (seq - lastSeq - 1) >>> 0;
  return d < 0x80000000 ? d : 0;
}

// ---- JSON messages --------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = Number.isInteger;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";
const inRange = (lo, hi) => (v) => isInt(v) && v >= lo && v <= hi;
const oneOf = (...xs) => (v) => xs.includes(v);
const isU32 = inRange(0, 0xffffffff);
const isCh = inRange(0, 255);

export const KINDS = ["audio", "midi"];
export const OPEN_DIRS = ["fromWeb", "toWeb", "both"];
export const PORTS = ["audio-in", "audio-out", "midi-in", "midi-out", "instrument", "audio-insert", "remote"];
export const LEADERS = ["live", "link", "app", "web"];

/// [[beat, status, d1, d2], …]: beat ≥ 0 or the sentinel -1 (as soon as possible).
const isEvents = (ev) => Array.isArray(ev) && ev.every((e) => Array.isArray(e) && e.length === 4 && isNum(e[0]) && (e[0] >= 0 || e[0] === -1) &&
  inRange(0, 255)(e[1]) && inRange(0, 127)(e[2]) && inRange(0, 127)(e[3]));

// field: [validator, required]
const req = (f) => [f, true], opt = (f) => [f, false];

const CHANNEL_FIELDS = {
  ch: req(isCh), kind: req(oneOf(...KINDS)), dir: req(oneOf("toWeb", "fromWeb")), key: req(isStr),
  name: opt(isStr), port: opt(oneOf(...PORTS)), source: opt(oneOf("live", "app")), online: opt(isBool),
  latency: opt((v) => isNum(v) && v >= 0), reactive: opt(isBool),
};

const TO_HUB = {
  hello: { v: req((v) => v === PROTOCOL_VERSION), id: req(isStr), name: req(isStr), sampleRate: req((v) => isNum(v) && v > 0),
    quantum: req(isInt), mode: req(oneOf("low", "safe")) },
  ping: { t: req(isNum) },
  open: { key: req(isStr), kind: req(oneOf(...KINDS)), dir: req(oneOf(...OPEN_DIRS)), name: req(isStr) },
  close: { key: req(isStr) },
  midi: { ch: req(isCh), epoch: req(isU32), ev: req(isEvents) },
  request: { tempo: opt((v) => isNum(v) && v > 0), play: opt(isBool) },
  latency: { ch: req(isCh), ms: req((v) => isNum(v) && v >= 0) },
};

const FROM_HUB = {
  welcome: { v: req((v) => v === PROTOCOL_VERSION), hub: req(isStr), sampleRate: req((v) => isNum(v) && v > 0), block: req(isInt),
    epoch: req(isU32), leader: req(isStr) },
  error: { code: req(isStr), message: opt(isStr) },  // SPEC GAP: only `code` is specified
  pong: { t: req(isNum), hub: req(isNum) },
  channel: CHANNEL_FIELDS,
  "channel-gone": { ch: req(isCh) },
  midi: { ch: req(isCh), epoch: req(isU32), t: req(isNum), ev: req(isEvents) },
  sync: { epoch: req(isU32), tempo: req((v) => isNum(v) && v > 0), beat: req(isNum), playing: req(isBool), quantum: req(isNum),
    leader: req(oneOf(...LEADERS)), hub: req(isNum) },
  flush: { epoch: req(isU32) },
  channels: { list: req((l) => Array.isArray(l) && l.every((c) => isObj(c) && checkFields(c, CHANNEL_FIELDS) === null)) },
  ping: { t: req(isNum) },  // SPEC GAP: not in the tables; the web answers it with a pong if the hub ever sends one
};

function checkFields(m, fields) {
  for (const [name, [ok, required]] of Object.entries(fields)) {
    if (m[name] === undefined) { if (required) return `missing "${name}"`; continue; }
    if (!ok(m[name])) return `bad "${name}"`;
  }
  return null;
}

function validate(m, table, who) {
  if (!isObj(m)) throw new ProtocolError(`${who} message is not an object`);
  if (!isStr(m.op)) throw new ProtocolError(`${who} message has no op`);
  const fields = Object.hasOwn(table, m.op) ? table[m.op] : null;
  if (!fields) throw new ProtocolError(`unknown ${who} op "${m.op}"`, "unknown-op");
  const bad = checkFields(m, fields);
  if (bad) throw new ProtocolError(`${m.op}: ${bad}`);
  return m;
}

export const validateToHub = (m) => validate(m, TO_HUB, "web→hub");
export const validateFromHub = (m) => validate(m, FROM_HUB, "hub→web");

/// A text frame from the hub → validated message. Throws ProtocolError (code "unknown-op" for ops this
/// version does not know: callers should ignore those for forward compatibility).
export function parseFromHub(text) {
  let m;
  try { m = JSON.parse(text); } catch { throw new ProtocolError("not JSON"); }
  return validateFromHub(m);
}
/// The same for the hub's side of the conversation (used by tests and the fake hubs).
export function parseToHub(text) {
  let m;
  try { m = JSON.parse(text); } catch { throw new ProtocolError("not JSON"); }
  return validateToHub(m);
}

/// Builders: each validates, so a bug in a caller fails here and not in the hub.
export const msg = {
  hello: ({ id, name, sampleRate, quantum = QUANTUM, mode }) => validateToHub({ op: "hello", v: PROTOCOL_VERSION, id, name, sampleRate, quantum, mode }),
  ping: (t) => validateToHub({ op: "ping", t }),
  open: ({ key, kind, dir, name }) => validateToHub({ op: "open", key, kind, dir, name: name ?? key }),
  close: (key) => validateToHub({ op: "close", key }),
  midi: (ch, epoch, ev) => validateToHub({ op: "midi", ch, epoch, ev }),
  request: ({ tempo, play } = {}) => {
    const m = { op: "request" };
    if (tempo !== undefined) m.tempo = tempo;
    if (play !== undefined) m.play = play;
    return validateToHub(m);
  },
  latency: (ch, ms) => validateToHub({ op: "latency", ch, ms }),
};
export const text = (m) => JSON.stringify(m);

/// What a `channel` message means with its optional fields filled in.
export function normaliseChannel(c) {
  return { ch: c.ch, kind: c.kind, dir: c.dir, key: c.key, name: c.name ?? c.key, port: c.port ?? "remote", source: c.source ?? "app",
    online: c.online ?? true, latency: c.latency ?? 0, reactive: c.reactive ?? false };
}

/// The board node type that mirrors a channel (§1, §3.2): a channel announced with port "audio-in" gives a
/// node whose outputs carry what Live sent, "audio-out" a node whose inputs go to Live, and so on. A channel
/// opened by a web node (port "remote") belongs to that node (remote-audio / remote-midi).
export function nodeTypeForChannel(c) {
  switch (c.port) {
    case "audio-in": case "audio-out": case "midi-in": case "midi-out": case "instrument": case "audio-insert": return c.port;
    default: return c.kind === "midi" ? "remote-midi" : "remote-audio";
  }
}

// ---- epochs ---------------------------------------------------------------------------------------

/// Signed distance a→b on the u32 epoch circle (so a counter that wraps still orders correctly).
export const epochDiff = (a, b) => (b - a) | 0;
/// §3.2/§10.3: MIDI from an older epoch than ours is stale (a flush happened since) and must be dropped.
export const epochAccepts = (messageEpoch, currentEpoch) => epochDiff(currentEpoch, messageEpoch) >= 0;

// ---- hub clock ------------------------------------------------------------------------------------

/// Estimates `hub = web + offset` from ping/pong round trips. A sample's error is at most half its round
/// trip (the path may be asymmetric), so the sample with the smallest RTT is the best one; an old sample is
/// slowly discounted (`driftPpm`) so that clock drift lets a fresher sample replace it.
export class ClockEstimator {
  constructor({ driftPpm = 100 } = {}) {
    this.driftPpm = driftPpm;
    this.best = null;  // {offset, rtt, at}
    this.samples = 0;
  }
  /// tSent/tRecv on the web clock, hub on the hub's. Returns true when the estimate changed.
  addSample(tSent, hub, tRecv) {
    const rtt = tRecv - tSent;
    if (!(rtt >= 0) || !Number.isFinite(hub)) return false;
    this.samples++;
    const offset = hub - (tSent + rtt / 2);
    const b = this.best;
    if (b && rtt > b.rtt + Math.max(0, tRecv - b.at) * this.driftPpm * 1e-6) return false;
    this.best = { offset, rtt, at: tRecv };
    return true;
  }
  get valid() { return this.best !== null; }
  get offset() { return this.best ? this.best.offset : 0; }
  get rtt() { return this.best ? this.best.rtt : Infinity; }
  toHub(webMs) { return webMs + this.offset; }
  toWeb(hubMs) { return hubMs - this.offset; }
}

// ---- sync -----------------------------------------------------------------------------------------

/// Follows the hub's transport: remembers the last `sync` and extrapolates the beat between messages
/// (`beat + (hubNow − hub) × tempo / 60000` while playing, §10.3).
export class SyncFollower {
  constructor(clock = new ClockEstimator()) {
    this.clock = clock;
    this.reset();
  }
  reset() { this.last = null; this.epoch = 0; }
  get valid() { return this.last !== null; }
  get tempo() { return this.last ? this.last.tempo : 0; }
  get playing() { return this.last ? this.last.playing : false; }
  get leader() { return this.last ? this.last.leader : null; }
  get quantum() { return this.last ? this.last.quantum : 4; }

  /// The epoch of a `welcome`/`flush`: only moves forward.
  setEpoch(e) { if (epochDiff(this.epoch, e) > 0) this.epoch = e; }
  /// Applies a `sync` message. A sync from an older epoch is out of date and ignored; returns whether it was used.
  apply(s) {
    if (epochDiff(this.epoch, s.epoch) < 0) return false;
    this.epoch = s.epoch;
    this.last = { tempo: s.tempo, beat: s.beat, playing: s.playing, quantum: s.quantum, leader: s.leader, hub: s.hub };
    return true;
  }
  /// The beat at a hub time (ms on the hub's clock). NaN before the first sync.
  beatAtHub(hubMs) {
    const s = this.last;
    if (!s) return NaN;
    return s.playing ? s.beat + (hubMs - s.hub) * s.tempo / 60000 : s.beat;
  }
  /// The beat at a time on the web clock (performance.timeOrigin + performance.now()).
  beatAt(webMs) { return this.beatAtHub(this.clock.toHub(webMs)); }
  /// The hub time at which `beat` is (or was) reached; null while stopped or before the first sync.
  hubMsAtBeat(beat) {
    const s = this.last;
    return s && s.playing ? s.hub + (beat - s.beat) * 60000 / s.tempo : null;
  }
}

/// How many beats `ms` is at `tempo`.
export const msToBeats = (ms, tempo) => ms * tempo / 60000;
/// Where MIDI from the hub is due on the web clock: the hub's send time `t`, plus the delay the audio of that
/// channel has (its jitter-buffer target), so notes and sound stay together (§3.2).
export const midiDueWebMs = (clock, hubT, latencyMs) => clock.toWeb(hubT) + latencyMs;
