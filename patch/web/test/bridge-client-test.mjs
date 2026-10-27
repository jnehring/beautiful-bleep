// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The main-thread side of the web link (bridge-client.js) and the Worker's logic (bridge-worker.js) against a fake
// hub: no network, no Worker threads, no timers waited on (a manual clock drives reconnects and pings).
//   node patch/web/test/bridge-client-test.mjs
import assert from "node:assert/strict";
import { BridgeClient, connectToApp, explainFailure, loadId, servedByApp } from "../js/bridge-client.js";
import { BridgeWorkerCore } from "../js/bridge-worker.js";
import { BridgeEndpoint } from "../js/bridge-worklet.js";
import { decodeAudioPacket, encodeAudioPacket, parseToHub } from "../js/bridge-protocol.js";

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };

// ---- fakes --------------------------------------------------------------------------------------------------------
class Sched {
  constructor() { this.t = 0; this.q = []; this.next = 1; }
  now = () => 1e9 + this.t;
  setTimeout = (f, ms) => { const id = this.next++; this.q.push({ id, at: this.t + ms, f }); return id; };
  clearTimeout = (id) => { this.q = this.q.filter((x) => x.id !== id); };
  setInterval = (f, ms) => { const id = this.next++; this.q.push({ id, at: this.t + ms, f, every: ms }); return id; };
  clearInterval = this.clearTimeout;
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const due = this.q.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = due.at;
      if (due.every) due.at += due.every; else this.q = this.q.filter((x) => x !== due);
      due.f();
    }
    this.t = end;
  }
}

class FakeSocket {
  static all = [];
  static throwOnCreate = null;
  constructor(url) {
    if (FakeSocket.throwOnCreate) throw FakeSocket.throwOnCreate;
    this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0;
    FakeSocket.all.push(this);
  }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; }
  // the test plays the network
  open() { this.readyState = 1; this.onopen?.(); }
  receive(d) { this.onmessage?.({ data: typeof d === "object" && !(d instanceof ArrayBuffer) ? JSON.stringify(d) : d }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  get texts() { return this.sent.filter((x) => typeof x === "string").map((x) => JSON.parse(x)); }
  get binaries() { return this.sent.filter((x) => typeof x !== "string"); }
  ops(op) { return this.texts.filter((m) => m.op === op); }
}
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

function rig({ isolated = true, mode = "low", storage = null, id = "id-1" } = {}) {
  const sched = new Sched();
  FakeSocket.all = []; FakeSocket.throwOnCreate = null;
  let core;
  const workerFactory = () => {
    const w = { onmessage: null, postMessage: (m) => core.handle(m), terminate() {} };
    core = new BridgeWorkerCore({ post: (m) => w.onmessage && w.onmessage({ data: m }), WebSocket: FakeSocket, now: sched.now,
      setTimeout: sched.setTimeout, clearTimeout: sched.clearTimeout, setInterval: sched.setInterval, clearInterval: sched.clearInterval, random: () => 0.5 });
    return w;
  };
  const client = new BridgeClient({ url: "ws://127.0.0.1:47100/ws", name: "Test", mode, id, storage, env: { isolated }, workerFactory, now: sched.now, sampleRate: 48000 });
  const events = [];
  for (const t of ["status", "channels", "sync", "flush", "midi", "error", "welcome"]) client.on(t, (p) => events.push([t, p]));
  return { sched, client, events, core: () => core };
}
const welcome = (o = {}) => ({ op: "welcome", v: 1, hub: "Fake Hub", sampleRate: 48000, block: 512, epoch: 4, leader: "live", ...o });
const chan = (o) => ({ op: "channel", name: o.key, port: "remote", source: "app", online: true, latency: 0, reactive: false, ...o });
const sync = (o = {}) => ({ op: "sync", epoch: 4, tempo: 120, beat: 16, playing: true, quantum: 4, leader: "live", hub: 5000, ...o });
const tick = () => new Promise((r) => setTimeout(r, 40));  // MessagePort delivery takes a few turns of the event loop; on a loaded machine (tests side by side) more than a few ms

// ---- 1. hello → welcome → channels -----------------------------------------------------------------------------------
{
  const { client, events, sched } = rig();
  ok(client.mode === "low" && client.status === "idle", "isolated page: low latency available");
  client.connect();
  ok(client.status === "connecting" && last().url === "ws://127.0.0.1:47100/ws", "connecting");
  last().open();
  const hello = last().texts[0];
  eq(hello, { op: "hello", v: 1, id: "id-1", name: "Test", sampleRate: 48000, quantum: 128, mode: "low" }, "hello is the first message");
  ok(client.status === "handshake", "socket open, not welcomed yet");
  ok(last().ops("ping").length === 1, "a clock probe goes out at once");

  // the hub's clock runs 7000 ms ahead of the web's; 6 ms round trips
  const probe = (hubAhead = 7000, rtt = 6) => {  // rtt counts from now; the answer is symmetric around the middle
    const t = last().ops("ping").at(-1).t;
    const waited = sched.now() - t;  // the ping may have been sent a moment ago
    sched.advance(rtt);
    last().receive({ op: "pong", t, hub: t + (waited + rtt) / 2 + hubAhead });
  };
  probe();
  ok(Math.abs(client.clock.offset - 7000) < 0.01 && client.clock.rtt <= 6.0001, `clock offset ${client.clock.offset}`);
  sched.advance(494);  // quick pings every 250 ms at first; land on the one at 500 ms
  ok(last().ops("ping").length >= 2, "pings keep coming");
  probe(7000.4, 3);  // a better (shorter) round trip wins even with a different offset
  ok(Math.abs(client.clock.offset - 7000.4) < 0.01, "the shortest round trip is kept");
  sched.advance(247);  // the next ping is at 750 ms
  probe(9000, 40);
  ok(Math.abs(client.clock.offset - 7000.4) < 0.01, "a slow one is not");

  last().receive(welcome());
  ok(client.status === "open" && client.connected && client.hub.hub === "Fake Hub" && client.epoch === 4, "welcome opens the link");
  last().receive({ op: "channels", list: [
    { ch: 1, kind: "audio", dir: "toWeb", key: "live:1", name: "Track 1", port: "audio-in", source: "live", online: true, latency: 768, reactive: false },
    { ch: 2, kind: "midi", dir: "toWeb", key: "live:2", name: "Track 2", port: "midi-in", source: "live" },
    { ch: 3, kind: "audio", dir: "fromWeb", key: "live:3", name: "Track 3", port: "audio-out", source: "live" }] });
  eq(client.listChannels().map((c) => c.key), ["live:1", "live:2", "live:3"], "channels listed");
  ok(client.channelFor("live:2", "midi", "toWeb").ch === 2 && client.channelFor("nope") === null, "lookup by key");
  eq(last().ops("latency").map((m) => m.ch).sort(), [1, 2, 3], "our own latency is reported per channel");
  ok(Math.abs(last().ops("latency")[0].ms - 128 / 48000 * 1000) < 1e-9, "at least one render quantum");
  ok(events.some(([t]) => t === "channels"), "channels event");

  // unknown ops and junk do not hurt; bad known ops are reported
  last().receive({ op: "telepathy" });
  ok(!events.some(([t]) => t === "error"), "unknown op ignored");
  last().receive("{nope");
  ok(events.some(([t, p]) => t === "error" && p.code === "protocol"), "garbage reported");

  // a hub-announced channel can change and go away: the board keeps the node (ghost), so it stays listed
  last().receive(chan({ ch: 1, kind: "audio", dir: "toWeb", key: "live:1", port: "audio-in", online: false }));
  ok(client.channels.get(1).online === false, "offline flag");
  last().receive({ op: "channel-gone", ch: 2 });
  ok(client.channels.get(2).online === false && client.channels.has(2), "a gone channel stays as a ghost");

  // sync
  last().receive(sync());
  const wall = sched.now();
  ok(client.leader === "live" && client.playing && client.getTempo() === 120, "sync state");
  const beat = client.getBeat(), expect = 16 + (wall + client.clock.offset - 5000) * 120 / 60000;
  ok(Math.abs(beat - expect) < 1e-6, `beat extrapolates: ${beat} vs ${expect}`);
  sched.advance(500);
  ok(Math.abs(client.getBeat() - beat - 1) < 1e-6, "half a second at 120 bpm is a beat");
  last().receive(sync({ playing: false, hub: 6000, beat: 20 }));
  sched.advance(1000);
  ok(client.getBeat() === 20 && !client.playing, "stopped transport holds the beat");
  client.requestTempo(97.5); client.requestPlay(true);
  eq(last().ops("request"), [{ op: "request", tempo: 97.5 }, { op: "request", play: true }], "requests");
}

// ---- 2. MIDI: open, send with lookahead, epochs, flush -----------------------------------------------------------------
{
  const { client, events, sched } = rig();
  client.connect(); last().open(); last().receive(welcome()); last().receive(sync({ hub: sched.now() + 0 })); // the clock is not probed: offset 0
  const sock = last();
  const handle = client.openChannel({ key: "seq", kind: "midi", dir: "fromWeb", name: "Sequencer" });
  eq(sock.ops("open"), [{ op: "open", key: "seq", kind: "midi", dir: "fromWeb", name: "Sequencer" }], "open goes out");
  ok(handle.key === "seq", "handle");
  ok(client.sendMidi("seq", [[null, 0x90, 60, 100]]) === 0, "no channel yet: nothing sent");
  sock.receive(chan({ ch: 9, kind: "midi", dir: "fromWeb", key: "seq", name: "Sequencer" }));
  const b0 = client.getBeat();
  ok(client.sendMidi("seq", [[null, 0x90, 60, 100], { beat: 33, status: 0x80, d1: 60, d2: 0 }], { lookaheadBeats: 0.5 }) === 2, "sent");
  let m = sock.ops("midi").at(-1);
  ok(m.ch === 9 && m.epoch === 4 && m.ev.length === 2, "epoch defaults to the current one");
  ok(Math.abs(m.ev[0][0] - (b0 + 0.5)) < 1e-6 && m.ev[0][1] === 0x90, "a missing beat is now + lookahead");
  ok(m.ev[1][0] === 33, "an explicit beat is kept");
  client.lookaheadMs = 100;
  client.sendMidi(9, [[null, 0x90, 62, 90]]);
  m = sock.ops("midi").at(-1);
  ok(Math.abs(m.ev[0][0] - (client.getBeat() + 0.2)) < 1e-6, "default lookahead: 100 ms at 120 bpm = 0.2 beat");
  // stopped transport: "as soon as possible"
  sock.receive(sync({ playing: false, beat: 4, hub: sched.now() }));
  client.sendMidi("seq", [[null, 0x90, 64, 90]]);
  ok(sock.ops("midi").at(-1).ev[0][0] === -1, "no transport, beat = -1");
  eq(client.sendMidi("seq", [[0, 0x90, 64, 90]], { lookaheadBeats: 0 }), 1, "lookahead 0 is allowed");
  // a flush: the sequencer's events from the old epoch are dropped on our side, new ones go
  const before = sock.ops("midi").length;
  sock.receive({ op: "flush", epoch: 5 });
  ok(events.some(([t, p]) => t === "flush" && p.epoch === 5) && client.epoch === 5, "flush event and epoch");
  eq(client.sendMidi("seq", [[1, 0x90, 60, 1]], { epoch: 4 }), 0, "an old epoch is dropped");
  ok(sock.ops("midi").length === before && client.stats.staleMidiOut === 1, "…and not sent");
  eq(client.sendMidi("seq", [[1, 0x90, 60, 1]], { epoch: 5 }), 1, "the new epoch goes");
  ok(sock.ops("midi").at(-1).epoch === 5, "with its epoch");
  // wrong direction / unknown channel
  eq(client.sendMidi(77, [[1, 0x90, 60, 1]]), 0, "unknown channel");
  // 600 events are split in messages of at most 256
  const many = Array.from({ length: 600 }, (_, i) => [i, 0x90, 60, 1]);
  const n0 = sock.ops("midi").length;
  eq(client.sendMidi("seq", many), 600, "all sent");
  eq(sock.ops("midi").slice(n0).map((x) => x.ev.length), [256, 256, 88], "in chunks");

  // MIDI from the hub: stale epochs dropped, due time = hub time + the audio delay
  sock.receive(chan({ ch: 4, kind: "midi", dir: "toWeb", key: "in", port: "midi-in", source: "live" }));
  const sent = [];
  const node = { port: { postMessage: (x) => sent.push(x), addEventListener() {}, start() {} } };
  client.node = node;
  events.length = 0;
  sock.receive({ op: "midi", ch: 4, epoch: 4, t: 100, ev: [[-1, 0x90, 60, 100]] });
  ok(!events.some(([t]) => t === "midi") && client.stats.staleMidiIn === 1 && sent.length === 0, "an older epoch than ours is dropped");
  const wallNow = sched.now(), hubT = wallNow + client.clock.offset + 3;  // sent 3 ms "in the future" on our clock
  sock.receive({ op: "midi", ch: 4, epoch: 5, t: hubT, ev: [[-1, 0x90, 60, 100], [2.5, 0x80, 60, 0]] });
  const got = events.find(([t]) => t === "midi")[1];
  ok(got.key === "in" && got.ev.length === 2 && Math.abs(got.dueWebMs - (wallNow + 3 + 16)) < 1e-6, "due = hub time + 16 ms (low latency)");
  const post = sent.at(-1);
  ok(post.cmd === "bridge" && post.op === "midi" && post.key === "in" && post.events.length === 2, "forwarded to the worklet");
  ok(Math.abs(post.events[0].delay - 19 * 48) < 1e-6 && post.events[0].status === 0x90 && post.events[1].status === 0x80, "as a delay in samples");

  // MIDI the board made in the worklet goes out through the same path
  sock.receive(sync({ epoch: 5, playing: true, beat: 8, hub: sched.now() }));
  ok(client.sync.apply({ epoch: 4, tempo: 1, beat: 0, playing: true, quantum: 4, leader: "web", hub: 0 }) === false, "a sync from before the flush is ignored");
  client.sampleRate = 48000;
  sock.receive(chan({ ch: 8, kind: "midi", dir: "fromWeb", key: "board", name: "Board MIDI" }));
  client.openChannel({ key: "board", kind: "midi", dir: "fromWeb" });
  node.port.postMessage = (x) => sent.push(x);
  client.attachAudio({ port: { postMessage: (x) => { if (x.port) x.port.close(); }, addEventListener: (t, f) => { client._boardListener = f; }, start() {} } });
  client._boardListener({ data: { cmd: "bridge", op: "midi-out", key: "board", events: [[0, 0x90, 60, 100], [48, 0x80, 60, 0]] } });
  const out = sock.ops("midi").at(-1);
  ok(out.ch === 8 && out.ev.length === 2 && out.ev[0][0] >= 8 && Math.abs(out.ev[1][0] - out.ev[0][0] - 0.002) < 1e-6, "board MIDI: beats include the lookahead and the in-block offset (1 ms = 0.002 beat)");
  client.closeChannel("seq");
  ok(sock.ops("close").some((x) => x.key === "seq"), "close goes out");
}

// ---- 3. reconnect --------------------------------------------------------------------------------------------------------
{
  const { client, events, sched } = rig();
  client.connect(); last().open(); last().receive(welcome());
  client.openChannel({ key: "fx", kind: "audio", dir: "both", name: "FX" });
  last().receive(chan({ ch: 5, kind: "audio", dir: "fromWeb", key: "fx" }));
  last().receive(chan({ ch: 6, kind: "audio", dir: "toWeb", key: "fx" }));
  last().receive(chan({ ch: 7, kind: "audio", dir: "toWeb", key: "live:9", port: "audio-in", source: "live" }));
  ok(FakeSocket.all.length === 1 && client.listChannels().length === 3, "set up");
  last().drop();
  ok(client.status === "retrying" && client.listChannels().every((c) => !c.online) && client.listChannels().length === 3, "channels become ghosts, not gone");
  ok(events.some(([t, p]) => t === "status" && p.state === "retrying" && p.delayMs === 250), "first retry after 250 ms");
  sched.advance(249); ok(FakeSocket.all.length === 1, "not yet");
  sched.advance(2); ok(FakeSocket.all.length === 2, "second socket");
  last().drop();  // never opened: backs off
  ok(events.filter(([t, p]) => t === "status" && p.state === "retrying").at(-1)[1].delayMs === 250, "first failure retries at 250 ms");
  sched.advance(300);
  last().drop();
  ok(events.filter(([t, p]) => t === "status" && p.state === "retrying").at(-1)[1].delayMs === 500, "then 500 ms");
  sched.advance(500);
  last().drop();
  ok(events.filter(([t, p]) => t === "status" && p.state === "retrying").at(-1)[1].delayMs === 1000, "then 1 s");
  sched.advance(1000);
  ok(FakeSocket.all.length === 5, "keeps trying");
  last().open();
  eq(last().texts[0].op, "hello", "says hello again, with the same id");
  ok(last().texts[0].id === "id-1" && client.status === "handshake" && client.listChannels().length === 0, "the hub announces everything anew");
  last().receive(welcome());
  eq(last().ops("open").map((m) => m.key), ["fx"], "channels this page opened are opened again");
  last().receive(chan({ ch: 11, kind: "audio", dir: "fromWeb", key: "fx" }));
  ok(client.channelFor("fx", "audio", "fromWeb").ch === 11, "channel numbers may differ after a reconnect");
  // an established connection that drops retries from the short delay again
  last().drop();
  ok(events.filter(([t, p]) => t === "status" && p.state === "retrying").at(-1)[1].delayMs === 250, "backoff resets after a good connection");
  // disconnect stops it all
  const n = FakeSocket.all.length;
  client.disconnect();
  sched.advance(60_000);
  ok(FakeSocket.all.length === n && client.status === "closed", "no reconnect after disconnect()");
  client.connect();
  ok(FakeSocket.all.length === n + 1, "connect() again works");
}

// ---- 4. refusals, mode, id, explanations ----------------------------------------------------------------------------------
{
  const r = rig();
  r.client.connect(); last().open(); last().receive({ op: "error", code: "denied" });
  ok(r.client.status === "denied" && r.events.some(([t, p]) => t === "error" && p.code === "denied"), "denied is final");
  r.sched.advance(60_000);
  ok(FakeSocket.all.length === 1, "and is not retried");

  const b = rig();
  b.client.connect(); last().open(); last().receive({ op: "error", code: "busy" });
  last().drop();
  b.sched.advance(300);
  ok(FakeSocket.all.length === 2, "busy is retried");

  // a page that can never connect (Safari: mixed content throws at once)
  const s = rig();
  FakeSocket.throwOnCreate = new Error("The operation is insecure.");
  s.client.connect(); s.sched.advance(10_000);
  ok(s.client.status === "failed" && FakeSocket.all.length === 0, "a SecurityError is final");

  // gives up after enough attempts that never opened
  const g = rig();
  g.client.connect();
  for (let i = 0; i < 30 && g.client.status !== "failed"; ++i) { last().drop(); g.sched.advance(6000); }
  ok(g.client.status === "failed" && FakeSocket.all.length === 8, `gave up after ${FakeSocket.all.length} attempts`);

  // Low latency needs an isolated page
  const safe = rig({ isolated: false, mode: "low" });
  ok(safe.client.mode === "safe" && safe.client.requestedMode === "low" && /Safe/.test(safe.client.modeNote), "no isolation → Safe");
  safe.client.connect(); last().open();
  ok(last().texts[0].mode === "safe", "hello says what we really do");
  ok(rig({ mode: "safe" }).client.mode === "safe", "safe by request");
  ok(rig({ isolated: true, mode: "low" }).client.lookaheadMs === 50 && rig({ isolated: false }).client.lookaheadMs === 80, "lookahead defaults 50 / 80 ms");

  // ids
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const a = loadId(storage), a2 = loadId(storage);
  ok(a === a2 && /^[0-9a-f-]{36}$/.test(a), "the id is a UUID, kept in storage");
  ok(/^[0-9a-f-]{36}$/.test(loadId({ getItem() { throw new Error("blocked"); } })), "blocked storage still gives an id");
  ok(/^[0-9a-f-]{36}$/.test(loadId(null)), "no storage: a fresh id");
  ok(rig({ id: null, storage }).client.id === a, "BridgeClient takes it from storage");

  // words for failures (§4)
  const safariUA = "Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17 Safari/605", chromeUA = "Mozilla/5.0 Chrome/120 Safari/537";
  const web = { hostname: "bleep.example", protocol: "https:" }, app = { hostname: "127.0.0.1", protocol: "http:" };
  ok(servedByApp(app) && servedByApp({ hostname: "localhost" }) && !servedByApp(web), "served by the app?");
  ok(/Safari/.test(explainFailure({ loc: web, userAgent: safariUA })) && /http:\/\/127\.0\.0\.1:47100\//.test(explainFailure({ loc: web, userAgent: safariUA })), "Safari: mixed content, open the app's page");
  ok(/local network/.test(explainFailure({ loc: web, userAgent: chromeUA })), "Chrome: local network access");
  ok(/Start Bleep App/.test(explainFailure({ loc: app, userAgent: chromeUA })) && !/Safari/.test(explainFailure({ loc: app, userAgent: chromeUA })), "from the app's own page: just start the app");
  ok(/Web connection/.test(explainFailure({ loc: web, code: "denied" })), "denied");

  // connectToApp
  const c1 = rig();
  const p1 = connectToApp({ client: c1.client, loc: web, userAgent: chromeUA });
  last().open(); last().receive(welcome());
  const r1 = await p1;
  ok(r1.ok && r1.servedByApp === false && /Safe latency/.test(r1.message), "connected from a foreign page: works, says Safe");
  const c2 = rig();
  const p2 = connectToApp({ client: c2.client, loc: web, userAgent: safariUA });
  last().drop();
  const r2 = await p2;
  ok(!r2.ok && /Safari/.test(r2.message) && c2.client.status === "closed", "no hub: explained, and the client stops trying");
  const c3 = rig();
  FakeSocket.throwOnCreate = new Error("insecure");
  const r3 = await connectToApp({ client: c3.client, loc: web, userAgent: safariUA });
  ok(!r3.ok && /127\.0\.0\.1:47100/.test(r3.message), "Safari's immediate failure is explained too");
  const c4 = rig();
  const p4 = connectToApp({ client: c4.client, loc: app, userAgent: chromeUA });
  last().open(); last().receive({ op: "error", code: "denied" });
  ok(!(await p4).ok, "denied");
}

// ---- 5. audio through the Worker core, in both paths ------------------------------------------------------------------------
for (const isolated of [true, false]) {
  const label = isolated ? "ring" : "port";
  const { client, sched, core } = rig({ isolated });
  const endpoint = new BridgeEndpoint({ sampleRate: 48000 });
  const posted = [];
  const node = { port: { postMessage(m, tr) { posted.push(m); if (m.cmd === "bridge-port") endpoint.connect(m.port); }, addEventListener() {}, start() {} } };
  client.attachAudio(node, { sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.01 });
  ok(Math.abs(client.latencyMs - (128 / 48000 * 1000 + 15)) < 1e-9, "latency = quantum + the context's");
  client.connect(); last().open(); last().receive(welcome());
  last().receive(chan({ ch: 1, kind: "audio", dir: "toWeb", key: "in", port: "audio-in", source: "live" }));
  last().receive(chan({ ch: 3, kind: "audio", dir: "fromWeb", key: "out", port: "audio-out", source: "live" }));
  await tick();
  ok(endpoint.byCh.size === 2 && endpoint.hasAudio("in", "in") && endpoint.hasAudio("out", "out"), `${label}: the worklet knows both channels`);
  ok(endpoint.byCh.get(1).mode === (isolated ? "ring" : "port"), `${label}: mode`);

  // hub → worklet: packets of constant audio prime the buffer to its target, then it plays
  const feed = (n, seq0) => { for (let i = 0; i < n; ++i) last().receive(encodeAudioPacket({ channel: 1, seq: seq0 + i, sampleTime: (seq0 + i) * 128, left: new Float32Array(128).fill(0.5), right: new Float32Array(128).fill(-0.25) })); };
  const a0 = endpoint.pull("in", 0, 32);
  ok(a0 && a0.got === 0 && a0.l.subarray(0, 32).every((x) => x === 0), `${label}: silence before the buffer fills`);
  const need = isolated ? 8 : 26;  // Low: 16 ms = 768 frames; Safe: 64 ms = 3072 frames
  feed(need, 0);
  await tick();
  const a1 = endpoint.pull("in", 1, 32);
  ok(a1.got === 32 && a1.l[0] === 0.5 && a1.r[31] === -0.25, `${label}: audio arrives`);
  eq(core().stats.lost, 0, "no loss yet");
  feed(1, need + 4);  // four packets missing
  ok(core().stats.lost === 4, `${label}: lost packets counted`);
  last().receive(new Uint8Array([9, 9, 9]).buffer);
  last().receive(encodeAudioPacket({ channel: 99, seq: 0, sampleTime: 0, left: new Float32Array(4) }));
  ok(core().stats.bad === 1 && core().stats.unknownChannel === 1, "junk and unknown channels are counted, not fatal");
  // a ghost: silence, and the buffer starts over when it is back
  last().receive({ op: "channel-gone", ch: 1 });
  await tick();
  ok(endpoint.pull("in", 2, 32) === null, `${label}: a ghost channel is silent`);
  last().receive(chan({ ch: 1, kind: "audio", dir: "toWeb", key: "in", port: "audio-in", source: "live", online: true }));
  await tick();
  ok(endpoint.pull("in", 3, 32).got === 0, `${label}: it re-primes`);

  // worklet → hub: quanta of 128 frames become 128-frame packets
  const L = new Float32Array(128), R = new Float32Array(128);
  const owner = {};
  for (let q = 0; q < 3; ++q) {
    L.fill(0.1 * (q + 1)); R.fill(-0.1 * (q + 1));
    for (let c = 0; c < 4; ++c) endpoint.push("out", owner, L.subarray(c * 32, c * 32 + 32), R.subarray(c * 32, c * 32 + 32), 32);  // the engine pushes 32 frames at a time
    sched.advance(3);  // the pump runs every 2 ms in low mode
    await tick();
  }
  const bins = last().binaries;
  ok(bins.length === 3, `${label}: three packets sent, got ${bins.length}`);
  const p0 = decodeAudioPacket(bins[0]), p2 = decodeAudioPacket(bins[2]);
  ok(p0.channel === 3 && p0.frames === 128 && p0.seq === 0 && p0.sampleTime === 0 && p2.seq === 2 && p2.sampleTime === 256, `${label}: header counters`);
  ok(Math.abs(p0.left[5] - 0.1) < 1e-6 && Math.abs(p2.right[127] + 0.3) < 1e-6, `${label}: content`);
  // a second node on the same key does not mix into the first one's stream
  endpoint.push("out", {}, L.subarray(0, 32), R.subarray(0, 32), 32);
  sched.advance(3); await tick();
  ok(last().binaries.length === 3, `${label}: only the first node feeds a channel`);
  // backpressure: a socket that cannot keep up gets no more audio (late audio is worse than none)
  last().bufferedAmount = 10 * 1024 * 1024;
  for (let c = 0; c < 4; ++c) endpoint.push("out", owner, L.subarray(c * 32, c * 32 + 32), R.subarray(c * 32, c * 32 + 32), 32);
  sched.advance(3); await tick();
  ok(last().binaries.length === 3 && core().stats.droppedOut >= 1, `${label}: backpressure drops, counted`);
  last().bufferedAmount = 0;

  // the link drops: the worklet's channels are reset, then come back with the new socket
  last().drop();
  await tick();
  ok(endpoint.byCh.size === 2 || endpoint.byCh.size === 0, "channels are detached on reset or kept until the new socket resets them");
  sched.advance(300);
  last().open(); last().receive(welcome());
  await tick();
  ok(endpoint.byCh.size === 0, `${label}: a new socket starts with a clean worklet`);
  last().receive(chan({ ch: 1, kind: "audio", dir: "toWeb", key: "in", port: "audio-in", source: "live" }));
  await tick();
  ok(endpoint.hasAudio("in", "in"), `${label}: and gets its channels again`);
  for (const m of posted) if (m.port) m.port.close();
  client.terminate();
}

// ---- 6. the audio starts after the link ------------------------------------------------------------------------------------------
{
  const { client, core } = rig({ isolated: true });
  client.connect(); last().open(); last().receive(welcome());
  last().receive(chan({ ch: 1, kind: "audio", dir: "toWeb", key: "in", port: "audio-in" }));
  const endpoint = new BridgeEndpoint({ sampleRate: 48000 }), ports = [];
  client.attachAudio({ port: { postMessage(m) { ports.push(m); if (m.cmd === "bridge-port") endpoint.connect(m.port); }, addEventListener() {}, start() {} } }, { sampleRate: 44100, baseLatency: 0 });
  await tick();
  ok(endpoint.hasAudio("in", "in"), "channels that exist before the worklet does are handed over when it arrives");
  void core;
  for (const m of ports) if (m.port) m.port.close();
}

console.log(`bridge-client-test: ${checks} checks passed`);
process.exit(0);  // open MessagePorts would keep node alive
