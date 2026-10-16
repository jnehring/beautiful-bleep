// SPDX-License-Identifier: MIT
// The wire format of the web link (bridge-protocol.js): audio packets, messages, clock, sync, epochs.
// Pure node, no dependencies:  node patch/web/test/bridge-protocol-test.mjs
import assert from "node:assert/strict";
import {
  ClockEstimator, HEADER_BYTES, MAX_PACKET_FRAMES, ProtocolError, SyncFollower, decodeAudioPacket, encodeAudioPacket, epochAccepts, isAllowedSocketUrl, msg,
  midiDueWebMs, nodeTypeForChannel, normaliseChannel, parseFromHub, parseToHub, seqGap, text, validateFromHub, validateToHub,
} from "../js/bridge-protocol.js";

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const throwsProto = (f, what) => { checks++; assert.throws(f, (e) => e instanceof ProtocolError, what); };

// ---- audio packets --------------------------------------------------------------------------------------------
{
  // layout: u8 kind · u8 channel · u16 frames · u32 seq · i64 sampleTime · planar L then R, little-endian
  const left = Float32Array.of(0.5, -0.25, 1), right = Float32Array.of(-1, 0, 0.125);
  const buf = encodeAudioPacket({ channel: 9, seq: 0xdeadbeef, sampleTime: 2 ** 40 + 5, left, right });
  ok(buf.byteLength === HEADER_BYTES + 8 * 3, "size is 16 + 8 × frames");
  const v = new DataView(buf);
  ok(v.getUint8(0) === 1 && v.getUint8(1) === 9 && v.getUint16(2, true) === 3, "header bytes 0-3");
  ok(v.getUint32(4, true) === 0xdeadbeef && v.getBigInt64(8, true) === BigInt(2 ** 40 + 5), "seq and sampleTime");
  ok(v.getFloat32(16, true) === 0.5 && v.getFloat32(16 + 12, true) === -1, "left first, then right");
  const p = decodeAudioPacket(buf);
  ok(p.channel === 9 && p.frames === 3 && p.seq === 0xdeadbeef && p.sampleTime === 2 ** 40 + 5, "decoded header");
  assert.deepEqual([...p.left], [...left]); assert.deepEqual([...p.right], [...right]);

  // roundtrip over sizes, including odd ones and the limits
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 * 2 - 1; };
  for (const frames of [1, 2, 3, 7, 31, 100, 127, 128, 129, 255, 480, 1000, 1023, MAX_PACKET_FRAMES]) {
    const l = Float32Array.from({ length: frames }, rnd), r = Float32Array.from({ length: frames }, rnd);
    const q = decodeAudioPacket(encodeAudioPacket({ channel: frames & 255, seq: frames, sampleTime: frames * 1000, left: l, right: r }));
    assert.deepEqual(q.left, l); assert.deepEqual(q.right, r);
    ok(q.frames === frames && q.channel === (frames & 255), `roundtrip ${frames}`);
  }
  // other views of the same bytes: a Uint8Array at an odd offset, a DataView
  const padded = new Uint8Array(buf.byteLength + 3); padded.set(new Uint8Array(buf), 3);
  assert.deepEqual(decodeAudioPacket(padded.subarray(3)).left, left);
  assert.deepEqual(decodeAudioPacket(new DataView(padded.buffer, 3)).right, right);
  // the decoded arrays are their own: transferring them never touches the input
  ok(p.left.buffer !== buf && p.left.buffer !== p.right.buffer, "decoded arrays own their storage");
  // mono source: right defaults to left
  const mono = decodeAudioPacket(encodeAudioPacket({ channel: 0, seq: 0, sampleTime: 0, left }));
  assert.deepEqual(mono.right, left);
  // frames larger than the buffers' used part
  const part = decodeAudioPacket(encodeAudioPacket({ channel: 0, seq: 1, sampleTime: 0, left: new Float32Array(10).fill(1), frames: 4 }));
  ok(part.frames === 4 && part.left.length === 4, "frames override");
  // seq is u32 on the wire
  ok(decodeAudioPacket(encodeAudioPacket({ channel: 0, seq: 2 ** 32 + 3, sampleTime: 0, left })).seq === 3, "seq wraps");
}

// ---- malformed packets are rejected -----------------------------------------------------------------------
{
  const good = new Uint8Array(encodeAudioPacket({ channel: 1, seq: 1, sampleTime: 1, left: new Float32Array(4), right: new Float32Array(4) }));
  const mutate = (f) => { const c = good.slice(); f(c, new DataView(c.buffer)); return c; };
  throwsProto(() => decodeAudioPacket(new ArrayBuffer(0)), "empty");
  throwsProto(() => decodeAudioPacket(good.slice(0, 15)), "short header");
  throwsProto(() => decodeAudioPacket(good.slice(0, good.length - 1)), "truncated payload");
  throwsProto(() => decodeAudioPacket(new Uint8Array([...good, 0])), "trailing byte");
  throwsProto(() => decodeAudioPacket(mutate((c) => { c[0] = 2; })), "unknown kind");
  throwsProto(() => decodeAudioPacket(mutate((c) => { c[0] = 0; })), "kind 0");
  throwsProto(() => decodeAudioPacket(mutate((c, v) => v.setUint16(2, 0, true))), "zero frames");
  throwsProto(() => decodeAudioPacket(mutate((c, v) => v.setUint16(2, 5, true))), "frames larger than the payload");
  throwsProto(() => decodeAudioPacket(mutate((c, v) => v.setUint16(2, 3, true))), "frames smaller than the payload");
  throwsProto(() => decodeAudioPacket(mutate((c, v) => v.setUint16(2, MAX_PACKET_FRAMES + 1, true))), "too many frames");
  throwsProto(() => decodeAudioPacket(mutate((c, v) => v.setBigInt64(8, -1n, true))), "negative sampleTime");
  throwsProto(() => decodeAudioPacket("a string"), "text is not a packet");
  throwsProto(() => decodeAudioPacket(null), "null");
  throwsProto(() => encodeAudioPacket({ channel: 256, seq: 0, sampleTime: 0, left: new Float32Array(1) }), "channel > 255");
  throwsProto(() => encodeAudioPacket({ channel: 0, seq: 0, sampleTime: 0, left: new Float32Array(0) }), "no frames");
  throwsProto(() => encodeAudioPacket({ channel: 0, seq: 0, sampleTime: 0, left: new Float32Array(MAX_PACKET_FRAMES + 1) }), "too many frames to send");
  throwsProto(() => encodeAudioPacket({ channel: 0, seq: 0, sampleTime: -1, left: new Float32Array(1) }), "negative time");
  ok(seqGap(5, 6) === 0 && seqGap(5, 9) === 3 && seqGap(0xffffffff, 0) === 0 && seqGap(0xfffffffe, 1) === 2 && seqGap(10, 3) === 0, "seq gaps, wrap-safe, reorder is no loss");
}

// ---- JSON messages ---------------------------------------------------------------------------------------------
{
  const hello = msg.hello({ id: "u-1", name: "Chrome", sampleRate: 48000, mode: "low" });
  assert.deepEqual(hello, { op: "hello", v: 1, id: "u-1", name: "Chrome", sampleRate: 48000, quantum: 128, mode: "low" });
  assert.deepEqual(parseToHub(text(hello)), hello);
  for (const m of [msg.ping(12.5), msg.open({ key: "k", kind: "audio", dir: "both", name: "FX" }), msg.close("k"),
    msg.midi(3, 7, [[-1, 0x90, 60, 100], [4.25, 0x80, 60, 0]]), msg.request({ tempo: 133 }), msg.request({ play: false }), msg.latency(3, 12.5)])
    assert.deepEqual(parseToHub(text(m)), m);
  checks += 8;
  throwsProto(() => msg.hello({ id: "x", name: "n", sampleRate: 48000, mode: "fast" }), "mode");
  throwsProto(() => msg.open({ key: "k", kind: "video", dir: "both" }), "kind");
  throwsProto(() => msg.open({ key: "k", kind: "audio", dir: "sideways" }), "dir");
  throwsProto(() => msg.midi(256, 0, []), "channel range");
  throwsProto(() => msg.midi(1, -1, []), "epoch range");
  throwsProto(() => msg.midi(1, 0, [[-2, 0x90, 60, 1]]), "beat below -1");
  throwsProto(() => msg.midi(1, 0, [[0, 0x90, 128, 1]]), "data byte > 127");
  throwsProto(() => msg.midi(1, 0, [[0, 0x90, 60]]), "three-element event");
  throwsProto(() => msg.latency(1, -1), "negative latency");
  throwsProto(() => validateToHub({ op: "welcome" }), "a hub op is not a web op");

  const welcome = { op: "welcome", v: 1, hub: "Bleep App 0.9", sampleRate: 44100, block: 512, epoch: 4, leader: "link" };
  const channel = { op: "channel", ch: 2, kind: "audio", dir: "toWeb", key: "live:t1:audio-in", name: "Track 1", port: "audio-in", source: "live", online: true, latency: 768, reactive: false };
  const sync = { op: "sync", epoch: 4, tempo: 120, beat: 8.5, playing: true, quantum: 4, leader: "live", hub: 1000 };
  const fromHub = [welcome, { op: "error", code: "denied" }, { op: "pong", t: 1, hub: 2 }, channel, { op: "channel-gone", ch: 2 },
    { op: "midi", ch: 2, epoch: 4, t: 99, ev: [[-1, 0x90, 60, 100]] }, sync, { op: "flush", epoch: 5 }, { op: "channels", list: [{ ...channel, op: undefined }] }];
  for (const m of fromHub) { assert.deepEqual(parseFromHub(JSON.stringify(m)), JSON.parse(JSON.stringify(m))); checks++; }
  // minimal channel: the optional fields are filled in
  const min = normaliseChannel(parseFromHub('{"op":"channel","ch":1,"kind":"midi","dir":"fromWeb","key":"k"}'));
  ok(min.online === true && min.port === "remote" && min.source === "app" && min.latency === 0 && min.name === "k", "defaults");
  for (const bad of ["", "{", "[]", "null", "42", '{"op":5}', '{}', '{"op":"welcome","v":2,"hub":"h","sampleRate":1,"block":1,"epoch":0,"leader":"x"}',
    '{"op":"sync","epoch":1,"tempo":0,"beat":0,"playing":true,"quantum":4,"leader":"live","hub":0}',
    '{"op":"sync","epoch":1,"tempo":120,"beat":0,"playing":true,"quantum":4,"leader":"moon","hub":0}',
    '{"op":"channel","ch":1,"kind":"audio","dir":"up","key":"k"}', '{"op":"channel","ch":300,"kind":"audio","dir":"toWeb","key":"k"}',
    '{"op":"channel","ch":1,"kind":"audio","dir":"toWeb"}', '{"op":"channels","list":[{"ch":1}]}', '{"op":"channels","list":3}',
    '{"op":"midi","ch":1,"epoch":0,"ev":[]}', '{"op":"pong","t":1}', '{"op":"pong","t":"1","hub":2}', '{"op":"flush","epoch":1.5}'])
    throwsProto(() => parseFromHub(bad), bad);
  let unknown = null;
  try { parseFromHub('{"op":"telepathy"}'); } catch (e) { unknown = e; }
  ok(unknown instanceof ProtocolError && unknown.code === "unknown-op", "unknown ops are told apart (callers ignore them)");
  throwsProto(() => validateFromHub({ op: "constructor" }), "prototype names are not ops");
  // which node mirrors which channel
  const t = (port, kind = "audio") => nodeTypeForChannel({ port, kind });
  ok(t("audio-in") === "audio-in" && t("instrument", "midi") === "instrument" && t("midi-out", "midi") === "midi-out" && t("audio-insert") === "audio-insert"
    && t("remote") === "remote-audio" && t("remote", "midi") === "remote-midi", "port → node type");
}

// ---- hub clock ----------------------------------------------------------------------------------------------------
{
  // The hub's clock is the web clock plus 123456.789 ms. Round trips have a random one-way delay each way; the
  // best sample is the one with the least delay, whose error is half the asymmetry of its two legs.
  const TRUE = 123456.789;
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const est = new ClockEstimator();
  let web = 1e9, lastErr = Infinity, errAt50 = 0;
  for (let i = 0; i < 400; ++i) {
    web += 250;
    const out = 0.2 + (rnd() < 0.7 ? rnd() * 30 : 0) + rnd() * 3, back = 0.2 + (rnd() < 0.7 ? rnd() * 30 : 0) + rnd() * 3;  // ms, with bursts of jitter
    const hub = web + out + TRUE, recv = web + out + back;
    est.addSample(web, hub, recv);
    lastErr = Math.abs(est.offset - TRUE);
    if (i === 49) errAt50 = lastErr;
  }
  ok(lastErr < 1, `converged within 1 ms (error ${lastErr.toFixed(3)} ms, rtt ${est.rtt.toFixed(2)})`);
  ok(lastErr <= errAt50 + 1e-9 || errAt50 < 1, "it does not get worse with more samples");
  ok(Math.abs(est.toHub(5000) - 5000 - TRUE) < 1 && Math.abs(est.toWeb(est.toHub(77)) - 77) < 1e-9, "toHub/toWeb are inverses");
  // a worse sample never replaces a better one …
  const e2 = new ClockEstimator();
  ok(e2.addSample(0, 1000.5, 1) === true, "first sample is taken");
  ok(e2.addSample(10, 5000, 60) === false && Math.abs(e2.offset - 1000) < 1e-9, "a sample with a long round trip is ignored");
  ok(e2.addSample(100, 1100.4, 100.8) === true, "a shorter round trip wins");
  // … until the old one has aged: 100 ppm of drift in 10 minutes is 60 ms
  const e3 = new ClockEstimator({ driftPpm: 100 });
  e3.addSample(0, 500, 1);
  ok(e3.addSample(10_000, 10_500 + 20, 10_004) === false, "ten seconds later a 4 ms sample still loses to a 1 ms one");
  ok(e3.addSample(600_000, 600_500 + 20, 600_004) === true, "ten minutes later it wins: the old sample is not trusted forever");
  ok(!new ClockEstimator().valid && new ClockEstimator().addSample(5, 1, 3) === false && new ClockEstimator().addSample(1, NaN, 2) === false, "garbage samples");
}

// ---- sync -----------------------------------------------------------------------------------------------------------
{
  const clock = new ClockEstimator();
  clock.addSample(1000, 6000 + 5, 1010);  // hub = web + 5000: offset 5000 (rtt 10)
  const f = new SyncFollower(clock);
  ok(Number.isNaN(f.beatAt(0)) && !f.valid && !f.playing, "nothing before the first sync");
  ok(f.apply({ epoch: 3, tempo: 120, beat: 8, playing: true, quantum: 4, leader: "live", hub: 10_000 }), "applied");
  ok(f.tempo === 120 && f.leader === "live" && f.epoch === 3, "state");
  ok(Math.abs(f.beatAtHub(10_000) - 8) < 1e-12, "at the anchor");
  ok(Math.abs(f.beatAtHub(10_500) - 9) < 1e-12, "120 bpm: half a second is one beat");
  ok(Math.abs(f.beatAt(5_500) - 9) < 1e-12, "on the web clock via the offset (hub = web + 5000)");
  ok(Math.abs(f.hubMsAtBeat(10) - 11_000) < 1e-9, "the inverse");
  f.apply({ epoch: 3, tempo: 90, beat: 20, playing: false, quantum: 4, leader: "link", hub: 20_000 });
  ok(f.beatAtHub(99_999) === 20 && f.hubMsAtBeat(21) === null && f.leader === "link", "stopped: the beat stands still");
  f.apply({ epoch: 3, tempo: 60, beat: 1, playing: true, quantum: 4, leader: "app", hub: 0 });
  ok(Math.abs(f.beatAtHub(3000) - 4) < 1e-12, "a tempo change re-anchors");
  ok(f.apply({ epoch: 2, tempo: 200, beat: 0, playing: true, quantum: 4, leader: "web", hub: 0 }) === false && f.tempo === 60, "a sync from an older epoch is ignored");
  f.reset();
  ok(!f.valid && f.epoch === 0, "reset");
}

// ---- epochs for MIDI --------------------------------------------------------------------------------------------------
{
  ok(epochAccepts(5, 5) && epochAccepts(6, 5), "current and newer events play");
  ok(!epochAccepts(4, 5), "an older epoch is dropped (a flush happened since)");
  ok(epochAccepts(0, 0xffffffff) && !epochAccepts(0xffffffff, 0), "the epoch counter may wrap");
  const f = new SyncFollower();
  f.setEpoch(7); f.setEpoch(6);
  ok(f.epoch === 7, "setEpoch only moves forward");
  ok(midiDueWebMs({ toWeb: (t) => t - 1000 }, 5000, 16) === 4016, "MIDI is due at its hub time plus the audio delay");
}

// ---- socket URLs and message bounds -------------------------------------------------------------------------------
{
  const none = { loc: null };
  for (const u of ["ws://127.0.0.1:47100/ws", "ws://localhost:1/ws", "ws://[::1]:47100/ws", "wss://localhost/ws"]) ok(isAllowedSocketUrl(u, none), u);
  for (const u of ["ws://evil.example/ws", "ws://127.0.0.1.evil.example/ws", "http://127.0.0.1/ws", "javascript:1", "", "ws://192.168.1.5/ws", "ws://localhost@evil.example/"])
    ok(!isAllowedSocketUrl(u, none), u);
  ok(isAllowedSocketUrl("ws://evil.example/ws", { ...none, allowRemote: true }), "explicit option allows a remote host");
  ok(!isAllowedSocketUrl("http://evil.example/ws", { ...none, allowRemote: true }), "still only ws/wss");
  ok(isAllowedSocketUrl("ws://192.168.1.5:47100/ws", { loc: { protocol: "http:", host: "192.168.1.5:47100" } }), "the page's own host");
  throwsProto(() => parseFromHub("x".repeat(300 * 1024)), "oversized text");
  throwsProto(() => parseFromHub(JSON.stringify({ op: "channels", list: Array.from({ length: 300 }, (_, i) => ({ ch: i % 256, kind: "audio", dir: "toWeb", key: "k" + i })) })), "too many channels");
  throwsProto(() => parseFromHub(JSON.stringify({ op: "channel", ch: 1, kind: "audio", dir: "toWeb", key: "k".repeat(5000) })), "huge key");
}

console.log(`bridge-protocol-test: ${checks} checks passed`);
