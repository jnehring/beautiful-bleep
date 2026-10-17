// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// web-settings.js: the state and the changes behind Bleep Play's Settings section, with a fake browser around it.
//
//   node patch/web/test/web-settings-test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WS = createRequire(import.meta.url)(join(here, "..", "js", "web-settings.js"));
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

/** A localStorage with a counter, optionally refusing writes. */
function fakeStorage(initial = {}, { refuse = false } = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (refuse) throw new Error("quota"); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

function env(over = {}) {
  const calls = { sink: [], reload: 0, configure: [], askMidi: 0, connect: 0 };
  const e = {
    storage: fakeStorage(),
    audio: () => null,
    canSelectOutput: true,
    setSink: async (id) => { calls.sink.push(id); },
    devices: async () => [
      { kind: "audiooutput", deviceId: "default", label: "Default" },
      { kind: "audiooutput", deviceId: "spk", label: "Speakers" },
      { kind: "audiooutput", deviceId: "hp", label: "" },
      { kind: "audioinput", deviceId: "mic", label: "Mic" },
    ],
    midi: () => ({ supported: true, inputs: [{ id: "a", name: "Launchkey" }, { id: "b", name: "IAC Bus" }] }),
    midiSupported: true,
    askMidi: async () => { calls.askMidi++; },
    bridge: () => ({ connected: false, busy: false, text: "", bad: false, connect: () => calls.connect++ }),
    library: { configure: (o) => calls.configure.push(o) },
    reload: () => calls.reload++,
    ...over,
  };
  return { e, calls };
}

await test("defaults", async () => {
  const { e } = env();
  const st = await WS.create(e).call("get");
  assert.equal(st.host, "web");
  assert.equal(st.webAudio.latency, "interactive");
  assert.equal(st.webAudio.output, "");
  assert.deepEqual(st.webAudio.outputs.map((o) => o.id), ["spk", "hp"], "default and inputs are not offered; the default is the empty choice");
  assert.equal(st.webAudio.outputs[1].name, "Output 2", "a device without a label is numbered");
  assert.equal(st.webLib.channel, "stable");
  assert.equal(st.webLib.allowUnsigned.module, false);
  assert.equal(st.webLib.reload, false);
  assert.equal(st.stored, true);
});

await test("an output is routed, remembered and survives a new page", async () => {
  const { e, calls } = env();
  const s = WS.create(e);
  const st = await s.call("webAudio", { output: "spk" });
  assert.deepEqual(calls.sink, ["spk"]);
  assert.equal(st.webAudio.output, "spk");
  assert.equal(WS.create(e).output(), "spk");
});

await test("an output that is gone is refused, and a saved one that vanished falls back to the default", async () => {
  const { e, calls } = env();
  const s = WS.create(e);
  const st = await s.call("webAudio", { output: "nowhere" });
  assert.equal(calls.sink.length, 0);
  assert.match(st.error, /not available/);
  await s.call("webAudio", { output: "spk" });
  e.devices = async () => [];
  assert.equal((await s.call("get")).webAudio.output, "");
});

await test("a browser that refuses the output reports it and keeps the old one", async () => {
  const { e } = env({ setSink: async () => { throw new Error("NotAllowedError"); } });
  const s = WS.create(e);
  const st = await s.call("webAudio", { output: "spk" });
  assert.match(st.error, /NotAllowedError/);
  assert.equal(st.webAudio.output, "");
});

await test("no output selection: the list is empty and says so", async () => {
  const { e } = env({ canSelectOutput: false });
  const st = await WS.create(e).call("get");
  assert.equal(st.webAudio.canSelectOutput, false);
  assert.deepEqual(st.webAudio.outputs, []);
});

await test("latency: only known modes, and a running context asks for a reload", async () => {
  let running = null;
  const { e, calls } = env({ audio: () => running });
  const s = WS.create(e);
  await s.call("webAudio", { latency: "bogus" });
  assert.equal(s.latencyHint(), "interactive");
  let st = await s.call("webAudio", { latency: "playback" });
  assert.equal(st.webAudio.latency, "playback");
  assert.equal(st.webAudio.reload, false, "nothing runs yet: it applies at the start");
  running = { rate: 48000, baseLatency: 0.01, outputLatency: 0.02, latencyHint: "interactive" };
  st = await s.call("get");
  assert.equal(st.webAudio.reload, true);
  assert.equal(Math.round(st.webAudio.baseLatencyMs), 10);
  await s.call("webAudio", { reload: true });
  assert.equal(calls.reload, 1);
});

await test("MIDI inputs: switches are remembered by name; not asked yet is reported", async () => {
  const { e, calls } = env();
  const s = WS.create(e);
  let st = await s.call("webMidi", { name: "IAC Bus", on: false });
  assert.deepEqual(st.webMidi.inputs.map((i) => [i.name, i.on]), [["Launchkey", true], ["IAC Bus", false]]);
  assert.equal(s.midiIgnored("IAC Bus"), true);
  assert.equal(s.midiIgnored("Launchkey"), false);
  st = await s.call("webMidi", { name: "IAC Bus", on: true });
  assert.equal(s.midiIgnored("IAC Bus"), false);
  const later = env({ midi: () => null });
  st = await WS.create(later.e).call("get");
  assert.deepEqual([st.webMidi.asked, st.webMidi.supported], [false, true]);
  await WS.create(later.e).call("webMidi", { allow: true });
  assert.equal(later.calls.askMidi, 1);
});

await test("library: channel and unsigned modules are applied at load, never unsigned plugins", async () => {
  const { e, calls } = env();
  const s = WS.create(e);
  let st = await s.call("webLibrary", { channel: "beta", allowUnsigned: { module: true } });
  assert.equal(st.webLib.reload, true, "the index is read once: a reload is needed");
  assert.equal(calls.configure.length, 0, "nothing is changed under a running page");
  const next = env({ storage: e.storage });
  WS.create(next.e).applyLibrary();
  assert.deepEqual(next.calls.configure, [{ channel: "beta", allowUnsigned: { module: true, plugin: false } }]);
  st = await WS.create(next.e).call("get");
  assert.equal(st.webLib.reload, false);
  await s.call("webLibrary", { channel: "nightly" });
  assert.equal((await s.call("get")).webLib.channel, "beta", "an unknown channel is ignored");
});

await test("the app link is shown and connect is passed on once", async () => {
  const { e, calls } = env();
  const s = WS.create(e);
  assert.equal((await s.call("get")).webApp.available, true);
  await s.call("webApp", { connect: true });
  assert.equal(calls.connect, 1);
  e.bridge = () => ({ connected: true, busy: false, text: "Low latency", bad: false, connect: () => calls.connect++ });
  const st = await s.call("webApp", { connect: true });
  assert.equal(calls.connect, 1, "already connected");
  assert.equal(st.webApp.connected, true);
  e.bridge = () => null;
  assert.equal((await s.call("get")).webApp.available, false);
});

await test("saved junk is ignored", async () => {
  const { e } = env({ storage: fakeStorage({ [WS.KEY]: JSON.stringify({ latency: 7, output: 3, midiOff: "x", channel: "evil", allowUnsignedModule: "yes" }) }) });
  const s = WS.create(e);
  assert.equal(s.latencyHint(), "interactive");
  const st = await s.call("get");
  assert.equal(st.webLib.channel, "stable");
  assert.equal(st.webLib.allowUnsigned.module, false, "only a real true turns it on");
  const broken = env({ storage: fakeStorage({ [WS.KEY]: "{not json" }) });
  assert.equal((await WS.create(broken.e).call("get")).webLib.channel, "stable");
});

await test("storage that refuses: the choices last for the visit and the page says so", async () => {
  const { e } = env({ storage: fakeStorage({}, { refuse: true }) });
  const s = WS.create(e);
  const st = await s.call("webAudio", { latency: "balanced" });
  assert.equal(st.stored, false);
  assert.equal(s.latencyHint(), "balanced");
  const none = env({ storage: null });
  assert.equal((await WS.create(none.e).call("get")).stored, false);
});

await test("clear removes only what it names", async () => {
  const storage = fakeStorage({
    "bleep-demo-board": "{}", "bleep-demo-presets": "[]", "bleep-demo-presets-drums": "[]", "bleep-demo-clipboard": '"x"',
    [WS.KEY]: JSON.stringify({ latency: "playback" }), "bleep.library.crl.serial": "4", "other-site-key": "keep",
  });
  const { e, calls } = env({ storage });
  const s = WS.create(e);
  await s.call("webClear", { what: "presets" });
  assert.deepEqual(Object.keys(storage.dump()).filter((k) => k.startsWith("bleep-demo-presets")), []);
  assert.ok("bleep-demo-board" in storage.dump());
  await s.call("webClear", { what: "board" });
  assert.ok(!("bleep-demo-board" in storage.dump()));
  assert.equal(calls.reload, 1, "the board comes back as the default one");
  await s.call("webClear", { what: "settings" });
  assert.equal(s.latencyHint(), "interactive");
  assert.ok(!(WS.KEY in storage.dump()));
  await s.call("webClear", { what: "all" });
  assert.deepEqual(Object.keys(storage.dump()), ["other-site-key"], "other sites' keys and anything not ours stay");
  const st = await s.call("webClear", { what: "everything" });
  assert.match(st.error, /Unknown kind/);
});

await test("an unknown call is reported, not ignored", async () => {
  const { e } = env();
  assert.match((await WS.create(e).call("nope")).error, /Unknown setting/);
});

let failed = 0;
for (const [name, err] of results) {
  console.log(`${err ? "FAIL" : "ok  "} ${name}`);
  if (err) { failed++; console.log(err.stack || err); }
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
