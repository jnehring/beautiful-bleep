// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// A look at a running hub: connects to the app's web link with Node's WebSocket, says hello and prints what comes back
// (welcome, channels, sync, the first pong). Without a hub it says "no hub" and exits 0, so it is safe in scripts.
//
//   node patch/web/test/bridge-smoke.mjs [ws://127.0.0.1:47100/ws] [seconds]
//
// Node's WebSocket sends no Origin header, so a hub that insists on one will refuse it: that is the hub's pairing
// check working (doc/specs/bridges.md §10.2), and is reported as such.
import { msg, parseFromHub, text, decodeAudioPacket, ProtocolError } from "../js/bridge-protocol.js";

const url = process.argv[2] || "ws://127.0.0.1:47100/ws";
const seconds = Number(process.argv[3] || 3);
const say = (...a) => console.log("bridge-smoke:", ...a);

if (typeof WebSocket === "undefined") { say("this Node has no global WebSocket (needs Node 22 or newer)"); process.exit(0); }

let opened = false, ws;
try { ws = new WebSocket(url); } catch (e) { say("no hub:", e.message); process.exit(0); }
ws.binaryType = "arraybuffer";
const counts = { welcome: 0, channel: 0, sync: 0, pong: 0, audioPackets: 0 };
const finish = (code = 0) => { try { ws.close(); } catch { /* closed */ } say(opened ? "done" : "no hub", JSON.stringify(counts)); setTimeout(() => process.exit(code), 50); };

const timer = setTimeout(() => finish(opened ? 0 : 0), seconds * 1000);
ws.onerror = () => {};
ws.onclose = (e) => { clearTimeout(timer); if (!opened) { say(`no hub at ${url} (code ${e.code}); start the app and turn on File → Settings → Web connection`); process.exit(0); } };
ws.onopen = () => {
  opened = true;
  say("connected to", url);
  ws.send(text(msg.hello({ id: "smoke-" + process.pid, name: "bridge-smoke (node)", sampleRate: 48000, mode: "safe" })));
  ws.send(text(msg.ping(performance.timeOrigin + performance.now())));
};
ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") {
    try { const p = decodeAudioPacket(ev.data); if (!counts.audioPackets++) say(`audio packet: channel ${p.channel}, ${p.frames} frames, seq ${p.seq}, sampleTime ${p.sampleTime}`); }
    catch (e) { say("bad binary frame:", e.message); }
    return;
  }
  let m;
  try { m = parseFromHub(ev.data); } catch (e) { say(e instanceof ProtocolError && e.code === "unknown-op" ? "unknown op (ignored):" : "INVALID message:", ev.data.slice(0, 200)); return; }
  if (m.op in counts) counts[m.op]++;
  if (m.op === "sync" && counts.sync > 3) return;  // sync arrives at 20 Hz: show a few
  say(m.op, JSON.stringify(m));
};
