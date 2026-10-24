// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The web link inside the graph runner: nodes bound to a channel key (node.remote) carry what the hub sent and send
// what is patched into them; port types only, so no wasm build is needed.   node patch/web/test/bridge-engine-test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Engine } from "../js/graph.js";
import { BridgeEndpoint } from "../js/bridge-worklet.js";
import { REMOTE_TYPES } from "../js/bridge-types.js";

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const types = [...JSON.parse(readFileSync(new URL("../../board/ui/demo-types.json", import.meta.url))), ...REMOTE_TYPES];
const node = (id, type, extra = {}) => ({ id, type, name: id, x: 0, y: 0, parent: "", muted: false, params: {}, ...extra });
const cable = (id, a, aj, b, bj, amount = 1) => ({ id, from: { node: a, jack: aj }, to: { node: b, jack: bj }, amount });

function rig(board) {
  const engine = new Engine(48000);
  engine.setTypes(types);
  const ep = new BridgeEndpoint({ sampleRate: 48000 });
  ep.now = () => engine.samplePos;
  engine.bridge = ep;
  const sentMidi = [], sentAudio = [];
  ep.main = (m) => sentMidi.push(m);
  ep.fromWorker({ t: "attach", ch: 1, key: "in", kind: "audio", dir: "in", mode: "port", srSource: 48000, targetFrames: 256, capacity: 4096 });
  ep.fromWorker({ t: "attach", ch: 2, key: "out", kind: "audio", dir: "out", mode: "port" });
  ep.port = { postMessage: (m) => sentAudio.push(m) };
  engine.setBoard({ format: 1, id: "t", nodes: board.nodes, cables: board.cables });
  const fill = (n, l, r) => ep.fromWorker({ t: "audio", ch: 1, l: new Float32Array(n).fill(l), r: new Float32Array(n).fill(r) });
  const render = (quanta) => {
    const L = new Float32Array(128 * quanta), R = new Float32Array(128 * quanta);
    for (let q = 0; q < quanta; ++q) engine.render(L.subarray(q * 128, q * 128 + 128), R.subarray(q * 128, q * 128 + 128), 128);
    return { L, R };
  };
  const out = (id, jack) => { const st = engine.steps.find((s) => s.id === id); return st.host.views.outputs[st.spec.outputs.findIndex((o) => o.id === jack) * 32 + 31]; };
  return { engine, ep, fill, render, sentMidi, sentAudio, out };
}

// 1. An Audio In node bound to a channel: what Live sent comes out of its outputs (and, patched to a local Audio Out, the speakers).
{
  const r = rig({ nodes: [node("in", "audio-in", { remote: "in" }), node("spk", "audio-out", { port: "p" })],
    cables: [cable("c1", "in", "l", "spk", "l"), cable("c2", "in", "r", "spk", "r")] });
  r.fill(512, 0.5, -0.25);  // 512 ≥ the 256-frame target
  const { L, R } = r.render(2);
  ok(Math.abs(L[100] - 0.5 * 0.9999) < 0.05 || Math.abs(L[100] - 0.5) < 1e-3 || L[100] > 0.3, `left carries the hub's audio (${L[100]})`);
  ok(R[100] < -0.1, "and the right one");
  // an unbound Audio In stays silent as before
  const s = rig({ nodes: [node("in", "audio-in"), node("spk", "audio-out", { port: "p" })], cables: [cable("c1", "in", "l", "spk", "l")] });
  s.fill(512, 0.5, 0.5);
  ok(s.render(1).L.every((x) => x === 0), "without node.remote nothing changes");
}

// 2. An Audio Out bound to a channel goes to the hub and not to the local speakers.
{
  const r = rig({ nodes: [node("in", "audio-in", { remote: "in" }), node("toLive", "audio-out", { port: "q", remote: "out" }), node("spk", "audio-out", { port: "p" })],
    cables: [cable("c1", "in", "l", "toLive", "l"), cable("c2", "in", "r", "toLive", "r")] });
  r.fill(900, 0.5, -0.25);  // below 4 x the target: no overrun
  const { L } = r.render(4);
  ok(L.every((x) => x === 0), "a bound Audio Out is not a local speaker");
  ok(r.sentAudio.length >= 3, `audio went to the Worker (${r.sentAudio.length} messages)`);
  const m = r.sentAudio.at(-1);
  ok(m.t === "audio" && m.ch === 2 && m.l.length === 128 && m.l[10] > 0.4 && m.r[10] < -0.2, "in 128-frame messages, left and right apart");
}

// 3. Remote Audio (both directions in one node) round-trips through the board.
{
  const r = rig({ nodes: [node("ra", "remote-audio", { remote: "in" }), node("rb", "remote-audio", { remote: "out" })],
    cables: [cable("c1", "ra", "l", "rb", "l"), cable("c2", "ra", "r", "rb", "r")] });
  r.fill(900, 0.25, 0.75);
  r.render(4);
  ok(r.sentAudio.length >= 3 && Math.abs(r.sentAudio.at(-1).l[50] - 0.25) < 1e-6 && Math.abs(r.sentAudio.at(-1).r[50] - 0.75) < 1e-6, "audio from the hub passes through the board back to the hub");
}

// 4. MIDI: hub notes drive a MIDI In node's outputs; a Remote MIDI node passes them on to the hub as bytes.
{
  const r = rig({ nodes: [node("m", "midi-in", { remote: "live:midi" }), node("rm", "remote-midi", { remote: "web:midi" }), node("rx", "remote-midi", { remote: "live:midi" })],
    cables: [cable("n1", "rx", "notes", "rm", "notes")] });
  r.ep.message({ op: "midi", key: "live:midi", events: [{ delay: 0, status: 0x90, d1: 64, d2: 127 }, { delay: 3 * 128 + 40, status: 0x80, d1: 64, d2: 0 }] });
  r.render(1);
  ok(r.out("m", "gate") === 1 && Math.abs(r.out("m", "pitch") - (64 - 60) / 12) < 1e-6 && r.out("m", "velocity") === 1, "note on: gate, pitch and velocity");
  ok(r.sentMidi.length === 1 && r.sentMidi[0].cmd === "bridge" && r.sentMidi[0].op === "midi-out" && r.sentMidi[0].key === "web:midi", "and it was passed on");
  assert.deepEqual(r.sentMidi[0].events[0].slice(1), [0x90, 64, 127]); checks++;
  r.render(2);  // 384 frames in; the note off is at frame 424
  ok(r.out("m", "gate") === 1, "still held before its time");
  r.render(1);
  ok(r.out("m", "gate") === 0, "note off at its time");
  const off = r.sentMidi.at(-1).events[0];
  ok(off[1] === 0x80 && off[0] >= 0 && off[0] < 32, `note off with its offset inside the chunk (${off})`);
  // the local MIDI (computer keyboard) does not leak into a bound node, nor the hub's into an unbound one
  r.engine.midi.noteOn(70);
  r.render(1);
  ok(r.out("m", "gate") === 0, "a bound MIDI In ignores the keyboard");
  r.ep.message({ op: "midi", key: "live:midi", events: [{ delay: 0, status: 0xb0, d1: 1, d2: 127 }, { delay: 0, status: 0xe0, d1: 0, d2: 127 }] });
  r.render(1);
  ok(Math.abs(r.out("m", "mod") - 1) < 1e-6 && r.out("m", "bend") > 0.99, "CC 1 and pitch bend");
}

// 5. A bound Instrument: MIDI in from the hub, the board's audio back to it, and nothing to the local speakers.
{
  const r = rig({ nodes: [node("inst", "instrument", { remote: "in", port: "i" }), node("src", "audio-in", { remote: "in" })],
    cables: [cable("c1", "src", "l", "inst", "l")] });
  r.fill(512, 0.5, 0.5);
  r.ep.fromWorker({ t: "attach", ch: 4, key: "in", kind: "audio", dir: "out", mode: "port" });
  r.ep.message({ op: "midi", key: "in", events: [{ delay: 0, status: 0x90, d1: 60, d2: 100 }] });
  const { L } = r.render(2);
  ok(L.every((x) => x === 0) && r.out("inst", "gate") === 1, "instrument: MIDI in, audio not local");
}

// 6. No bridge: nothing breaks, remote nodes are plain silent port nodes.
{
  const engine = new Engine(48000);
  engine.setTypes(types);
  engine.setBoard({ format: 1, id: "t", nodes: [node("ra", "remote-audio", { remote: "k" }), node("spk", "audio-out", { port: "p" })], cables: [cable("c", "ra", "l", "spk", "l")] });
  const L = new Float32Array(128), R = new Float32Array(128);
  engine.render(L, R, 128);
  ok(L.every((x) => x === 0), "an engine without a bridge runs remote nodes silently");
}

console.log(`bridge-engine-test: ${checks} checks passed`);
