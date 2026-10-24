// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Voice Cells in the browser engine (js/voices.js): the expansion into one cell per voice, the note allocator, and a whole Voice Cell playing
// through the graph runner with the real modules (needs the built site: scripts/build/build-web.sh, default build/web/site).
//
//   node patch/web/test/voices-test.mjs [site dir]
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandVoiceCells, VoiceAllocNode, voiceSettings } from "../js/voices.js";
import { CHUNK } from "../js/module-host.js";

const here = dirname(fileURLToPath(import.meta.url));
const typeList = JSON.parse(readFileSync(join(here, "..", "..", "board", "ui", "demo-types.json"), "utf8"));
const types = new Map(typeList.map((t) => [t.type, t]));

const node = (id, type, params = {}, extra = {}) => ({ id, type, name: id, x: 0, y: 0, parent: "", muted: false, params, ...extra });
const cable = (id, a, aj, b, bj, amount = 1) => ({ id, from: { node: a, jack: aj }, to: { node: b, jack: bj }, amount });
const knob = (type, id, units) => { const p = types.get(type).params.find((q) => q.id === id); return (units - p.min) / (p.max - p.min); };

/// A Voice Cell with the smallest voice: Voice In → Oscillator → VCA (gain from an ADSR on the gate) → Voice Out, played by MIDI In.
function board(settings = {}, extraCables = []) {
  const v = { voices: knob("voice-cell", "voices", 4), spread: 0, ...settings };
  return {
    format: 1, id: "b",
    nodes: [
      node("keys", "midi-in", {}, { port: "p-keys" }), node("out", "audio-out", {}, { port: "p-out" }),
      node("V", "voice-cell", v, { inputs: [], outputs: [] }),
      node("vi", "voice-in", {}, { parent: "V" }), node("osc", "oscillator", {}, { parent: "V" }), node("env", "adsr", {}, { parent: "V" }),
      node("amp", "vca", { gain: 0 }, { parent: "V" }), node("vo", "voice-out", {}, { parent: "V" }),
    ],
    cables: [
      cable("n", "keys", "notes", "V", "notes"), cable("o", "V", "l", "out", "l"),
      cable("c1", "vi", "pitch", "osc", "pitch"), cable("c2", "vi", "gate", "env", "gate"), cable("c3", "osc", "sine", "amp", "l"),
      cable("c4", "env", "env", "amp", "gain"), cable("c5", "amp", "l", "vo", "l"), ...extraCables,
    ],
  };
}

// ---- settings ---------------------------------------------------------------------------------------------------------------
const vs = voiceSettings(board({ mode: 0.5, allocation: 0.5, stealing: 1 }).nodes[2], types.get("voice-cell"));
assert.deepEqual([vs.voices, vs.mode, vs.allocation, vs.stealing], [4, 1, 1, 4]);
assert.equal(voiceSettings(node("x", "voice-cell"), types.get("voice-cell")).voices, 8);   // the default

// ---- expansion --------------------------------------------------------------------------------------------------------------
{
  const e = expandVoiceCells(board(), types, 16);
  const ids = e.board.nodes.map((n) => n.id);
  assert.ok(!ids.includes("V") && !ids.includes("osc") && !ids.includes("vi"), "the cell and what is inside it are replaced");
  for (let k = 0; k < 4; ++k) for (const id of ["V~" + k, "V~" + k + "~in", "V~" + k + "~out", "osc~" + k, "env~" + k, "amp~" + k])
    assert.ok(ids.includes(id), id);
  assert.equal(e.board.nodes.filter((n) => n.type === "cell").length, 4);
  assert.equal(ids.at(-1), "V~alloc", "the allocator comes last");
  assert.deepEqual(e.copies.get("osc"), ["osc~0", "osc~1", "osc~2", "osc~3"]);
  assert.equal(e.alias.get("osc~0"), "osc");
  assert.equal(e.alias.get("osc~1"), null);
  assert.equal(e.alias.get("V~alloc"), null);
  const spec = e.specs[0].spec;
  assert.equal(spec.outputs.length, 4 * 8);
  assert.equal(spec.inputs.length, 1 + 4 * 3);
  const into = (to) => e.board.cables.filter((c) => c.to.node === to.node && c.to.jack === to.jack);
  assert.equal(into({ node: "V~alloc", jack: "notes" }).length, 1, "the notes go to the allocator");
  assert.equal(into({ node: "out", jack: "l" }).length, 4, "every voice feeds the output");
  assert.ok(into({ node: "out", jack: "l" }).every((c) => Math.abs(c.amount - 0.5) < 1e-6), "compensated: 1/sqrt(4) with no pan");
  assert.equal(into({ node: "osc~2", jack: "pitch" })[0].from.node, "V~alloc");
  assert.equal(into({ node: "osc~2", jack: "pitch" })[0].from.jack, "pitch2");
  assert.equal(into({ node: "V~alloc", jack: "al3" })[0].from.node, "amp~3", "the allocator watches each voice's output");
  assert.equal(e.board.cables.filter((c) => c.id.startsWith("c1")).length, 4);
  // a board without a Voice Cell is returned as it is
  const plain = { format: 1, id: "p", nodes: [node("a", "oscillator")], cables: [] };
  assert.equal(expandVoiceCells(plain, types).board, plain);
  // the limit, mono mode, a muted cell, a Voice Cell inside a Voice Cell
  assert.equal(expandVoiceCells(board(), types, 2).board.nodes.filter((n) => n.type === "cell").length, 2);
  assert.equal(expandVoiceCells(board({ mode: 0.5 }), types, 16).board.nodes.filter((n) => n.type === "cell").length, 1);
  const muted = board(); muted.nodes[2].muted = true;
  assert.equal(expandVoiceCells(muted, types).board, muted);
  // pan: spread 100 % puts the first voice left and the last right (the cable amounts carry it)
  const wide = expandVoiceCells(board({ spread: 1, output: 0 }), types, 16).board.cables.filter((c) => c.to.node === "out");
  assert.ok(wide[0].amount > 1.3 && wide[3].amount < 0.2, wide.map((c) => c.amount.toFixed(2)).join(" "));
}

// ---- the allocator ----------------------------------------------------------------------------------------------------------
{
  const alloc = (settings, observe = true) => {
    const { specs } = expandVoiceCells(board(settings), types, 16);
    const a = new VoiceAllocNode(specs[0].spec, { sampleRate: 48000 });
    const step = (events, chunks = 1) => { for (let i = 0; i < chunks; ++i) { a.setNotesIn(0, events); a.process(CHUNK); events = []; } };
    const out = (k, sig, at = CHUNK - 1) => a.views.outputs[(k * 8 + ["pitch", "gate", "trigger", "velocity", "release", "pressure", "voice", "random"].indexOf(sig)) * CHUNK + at];
    return { a, step, out };
  };
  const on = (note, offset = 0, value = 0.8) => ({ type: 0, offset, note, pitch: (note - 60) / 12, value });
  const off = (note, offset = 0) => ({ type: 1, offset, note, pitch: (note - 60) / 12, value: 0 });

  // round robin: three notes go to voices 0, 1, 2; the trigger is one sample, the gate stays
  let t = alloc();
  t.step([on(60), on(64), on(67)]);
  assert.deepEqual([0, 1, 2, 3].map((k) => t.out(k, "gate")), [1, 1, 1, 0]);
  assert.deepEqual([0, 1, 2].map((k) => Math.round(t.out(k, "pitch") * 12)), [0, 4, 7]);
  assert.equal(t.out(0, "trigger", 0), 1);
  assert.equal(t.out(0, "trigger", 1), 0);
  assert.ok(Math.abs(t.out(1, "velocity") - 0.8) < 1e-6);
  assert.equal(t.out(2, "voice"), 2);
  assert.notEqual(t.out(0, "random"), t.out(1, "random"));
  // note off: the gate falls, a free voice comes next in the ring
  t.step([off(64)]);
  assert.deepEqual([0, 1, 2].map((k) => t.out(k, "gate")), [1, 0, 1]);
  // a released voice that is still sounding is not reused (nothing silent is watched here: the allocator hears silence after 50 ms)
  t.step([on(72)]);
  assert.equal(t.out(3, "gate"), 1, "the next free voice in the ring");
  // all four busy: the oldest is stolen and its envelopes restart (the gate dips for the sample of the trigger)
  t.step([on(74)]);
  assert.equal(Math.round(t.out(0, "pitch") * 12), 14, "voice 0 was the oldest");
  assert.equal(t.out(0, "trigger", 0), 1);
  assert.equal(t.out(0, "gate", 0), 0, "a stolen voice drops its gate for one sample so its envelopes restart");
  assert.equal(t.out(0, "gate", 1), 1);

  // stealing: none ignores the note
  t = alloc({ stealing: 1 });
  t.step([on(60), on(62), on(64), on(65), on(67)]);
  assert.equal(Math.round(t.out(0, "pitch") * 12), 0, "nothing stolen");
  assert.equal(t.a.voices.filter((v) => v.gate).length, 4);

  // lowest free allocation
  t = alloc({ allocation: 0.5 });
  t.step([on(60), on(62)]);
  t.step([off(60)]);
  t.step([], 100);   // 3 ms is not enough for silence detection: the voice still sounds... fed with silence for 50 ms it is free
  t.step([on(64)]);
  assert.equal(Math.round(t.out(0, "pitch") * 12), 4, "lowest free voice");

  // mono: one voice, the last note wins, releasing it goes back to the one still held, without a new attack
  t = alloc({ mode: 0.5 });
  t.step([on(60), on(67)]);
  assert.equal(Math.round(t.out(0, "pitch") * 12), 7);
  t.step([off(67)]);
  assert.equal(Math.round(t.out(0, "pitch") * 12), 0);
  assert.equal(t.out(0, "gate"), 1);
  assert.equal(t.out(0, "trigger", 0), 0);
  t.step([off(60)]);
  assert.equal(t.out(0, "gate"), 0);

  // legato: the second note slides in without a trigger
  t = alloc({ mode: 1 });
  t.step([on(60)]);
  t.step([on(64)]);
  assert.equal(t.out(0, "trigger", 0), 0);
  assert.equal(Math.round(t.out(0, "pitch") * 12), 4);

  // events at their sample positions
  t = alloc();
  t.step([on(60, 10)]);
  assert.equal(t.out(0, "gate", 9), 0);
  assert.equal(t.out(0, "gate", 10), 1);
  assert.equal(t.out(0, "trigger", 10), 1);
}

// ---- the whole engine -------------------------------------------------------------------------------------------------------
const site = process.argv[2] || join(here, "..", "..", "..", "build", "web", "site");
if (!existsSync(join(site, "manifest.json"))) {
  console.log("voices-test: ok (the engine part is skipped: no built site at " + site + ")");
  process.exit(0);
}
const { compileModule } = await import("../js/module-host.js");
const { Engine } = await import("../js/graph.js");
const manifest = JSON.parse(readFileSync(join(site, "manifest.json"), "utf8"));
const engine = new Engine(48000);
engine.setTypes(typeList);
for (const [slug, m] of Object.entries(manifest.modules)) engine.addModule(slug, await compileModule(readFileSync(join(site, m.file))), m.types);

const render = (seconds) => {
  const n = Math.ceil((48000 * seconds) / 128) * 128, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i += 128) engine.render(l.subarray(i, i + 128), r.subarray(i, i + 128), 128);
  return l;
};
/// The amplitude of one frequency in a signal (Goertzel), for telling which notes sound.
const level = (x, hz) => {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; ++i) { const a = (2 * Math.PI * hz * i) / 48000; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a); }
  return (2 * Math.hypot(re, im)) / x.length;
};
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const C4 = 261.63, G4 = 392.0, E4 = 329.63;

engine.setBoard(board());
assert.ok(peak(render(0.2)) < 1e-6, "silent until a note plays");

engine.midi.noteOn(60, 0.8);
let x = render(0.6);
assert.ok(peak(x) > 0.05, `a note sounds (peak ${peak(x)})`);
const c = level(x.subarray(24000), C4);
assert.ok(c > 0.05 && level(x.subarray(24000), G4) < c * 0.1, "it is a C4");
console.log("one note: ok, C4 level", c.toFixed(3));

engine.midi.noteOn(67, 0.8);
x = render(0.6);
assert.ok(level(x.subarray(24000), C4) > 0.05 && level(x.subarray(24000), G4) > 0.05, "two notes sound together: polyphony");
console.log("two notes: ok, C4", level(x.subarray(24000), C4).toFixed(3), "G4", level(x.subarray(24000), G4).toFixed(3));

engine.midi.noteOff(60); engine.midi.noteOff(67);
render(3);
assert.ok(peak(render(0.2)) < 1e-3, "released notes die away");
console.log("release: ok");

// more notes than voices: no crash, still sound
for (const n of [60, 62, 64, 65, 67, 69]) engine.midi.noteOn(n, 0.8);
assert.ok(peak(render(0.4)) > 0.05);
engine.midi.allOff();
render(3);
console.log("stealing: ok");

// a voice that is neither held nor sounding does not run
{
  engine.setBoard(board());
  const runs = {};
  for (const st of engine.steps) if (st.id.startsWith("osc~")) { const run = st.host.process.bind(st.host); st.host.process = (n) => { runs[st.id] = (runs[st.id] || 0) + 1; run(n); }; }
  render(0.2);
  assert.deepEqual(runs, {}, "idle voices do not run");
  engine.midi.noteOn(60, 0.8);
  render(0.2);
  assert.equal(Object.keys(runs).length, 1, "one note runs one voice: " + Object.keys(runs));
  engine.midi.noteOn(64, 0.8);
  render(0.2);
  assert.equal(Object.keys(runs).length, 2, "two notes run two voices");
  engine.midi.allOff();
  render(3);
  const before = { ...runs };
  render(0.5);
  assert.deepEqual(runs, before, "after the release has died away the voices sleep again");
  console.log("sleeping voices: ok");
}

// a knob inside the cell reaches every voice: one octave up
engine.setBoard(board());
engine.setKnob("osc", "octave", 4 / 6);
engine.midi.noteOn(60, 0.8);
x = render(0.6);
assert.ok(level(x.subarray(24000), 2 * C4) > 0.05 && level(x.subarray(24000), C4) < 0.1, "octave knob on the copies");
engine.midi.allOff();
render(3);
engine.midi.noteOn(64, 0.8);   // another voice, same patch
x = render(0.6);
assert.ok(level(x.subarray(24000), 2 * E4) > 0.05, "…also on the next voice");
engine.midi.allOff();
render(3);
console.log("knobs on all voices: ok");

// the UI sees the first voice's node by its own id, and nothing else of the expansion
const snap = Object.keys(engine.snapshot().nodes);
assert.ok(snap.includes("osc") && snap.includes("out"));
assert.ok(!snap.some((id) => id.includes("~")), snap.join(","));
console.log("snapshot ids: ok");

// mono
engine.setBoard(board({ mode: 0.5 }));
engine.midi.noteOn(60, 0.8); engine.midi.noteOn(67, 0.8);
x = render(0.6);
assert.ok(level(x.subarray(24000), G4) > 0.05 && level(x.subarray(24000), C4) < 0.02, "mono: the last note only");
console.log("mono: ok");

console.log("voices-test: ok");
