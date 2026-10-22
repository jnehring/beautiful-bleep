// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Module versions on the board (board/ui/library.js): a preset, project or paste says which version of a module it was made with
// (`needs.<slug>.version`, or a node's own `version`); if the installed module is another version, the dialog asks which to use,
// and the nodes follow the choice: pinned to the version they were made with, or released to run with what is installed.
//
//   node patch/web/test/module-versions-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "..", "board", "ui", "library.js"), "utf8");

// A DOM just big enough for the dialog: elements that remember their children and listeners.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.className = ""; this.textContent = ""; this.hidden = false; this.style = {}; }
  append(...c) { this.children.push(...c); }
  appendChild(c) { this.children.push(c); return c; }
  remove() { this.removed = true; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  click() { for (const f of this.listeners.click || []) f(); }
  set innerHTML(v) { this.children = []; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}

/// A library in a given state: `installed` modules (newest of each), older `versions`, what the `index` offers, `pinning` support.
function setup({ installed, versions = [], offered = [], pinning = true }) {
  const state = { installed: installed.map((m) => ({ loaded: true, allowed: true, source: "registry", ...m })), versions: versions.map((m) => ({ loaded: true, allowed: true, source: "registry", ...m })), busy: {} };
  const calls = [];
  const body = new El("body");
  const document = { createElement: (t) => new El(t), body, getElementById: () => null };
  const native = async (name, ...a) => {
    calls.push([name, ...a]);
    if (name === "libraryStatus") return { settings: { firstRunDone: true }, installed: state.installed, versions: state.versions, pinning, busy: state.busy, index: { ok: true, modules: offered }, pluginJob: {} };
    if (name === "libraryInstallVersion") { state.versions.push({ slug: a[0], version: a[1], loaded: true, allowed: true, source: "registry", types: ["filter"] }); return {}; }
    if (name === "libraryInstall") { const o = offered.find((m) => m.slug === a[0]); state.installed = state.installed.filter((m) => m.slug !== a[0]).concat({ ...o, loaded: true, allowed: true, source: "registry" }); return {}; }
    return {};
  };
  const priv = {};
  const window = { BleepSeal: { native, priv }, setInterval, clearInterval, setTimeout };
  vm.runInNewContext(source, { window, document, console, setTimeout, clearTimeout, setInterval, clearInterval, Promise });
  return { View: priv.BleepLibraryView, body, calls, state };
}

/// Presses the dialog's button: the primary one (Install or Continue), after picking the radio with this label if given.
async function answer(body, { pick = "", press = "primary" } = {}) {
  for (let i = 0; i < 50 && !body.children.length; i++) await new Promise((r) => setTimeout(r, 5));
  const card = body.children[body.children.length - 1];
  const all = card.all();
  if (pick) {
    const radio = all.filter((e) => e.tag === "input" && e.type === "radio")[pick === "made" ? 1 : 0];
    radio.checked = true;
    for (const f of radio.listeners.change || []) f();
  }
  const bar = all.find((e) => e.className === "st-bar");
  const button = bar.children.find((b) => (press === "primary" ? b.className === "primary" : b.textContent === press));
  button.click();
  return card;
}
const settle = () => new Promise((r) => setTimeout(r, 900));
const filterNode = (over = {}) => ({ id: "n1", type: "filter", name: "Multi Filter", params: {}, ...over });
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "\n", e); } };

await test("the same version: no dialog, nodes untouched", async () => {
  const { View, body } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }] });
  const preset = { nodes: [filterNode()], needs: { filter: { min: "0.2.0", version: "0.2.0" } } };
  assert.equal(await View.ensureNeeds(preset, "x"), true);
  assert.equal(body.children.length, 0);
  assert.equal(preset.nodes[0].version, undefined);
});

await test("another version installed: asked; 'latest' leaves the nodes unpinned", async () => {
  const { View, body } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }] });
  const preset = { nodes: [filterNode()], needs: { filter: { min: "0.1.2", version: "0.1.2" } } };
  const done = View.ensureNeeds(preset, "x");
  const card = await answer(body);   // the default is the latest
  assert.match(JSON.stringify(card.all().map((e) => e.textContent)), /made with 0\.1\.2, installed 0\.2\.0/);
  assert.equal(await done, true);
  assert.equal(preset.nodes[0].version, undefined);
});

await test("another version installed: 'the versions it was made with' pins the nodes and fetches that version", async () => {
  const { View, body, calls } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }], offered: [{ slug: "filter", version: "0.2.0", types: ["filter"] }] });
  const preset = { nodes: [filterNode(), filterNode({ id: "n2" }), { id: "k", type: "keyboard", params: {} }], needs: { filter: { min: "0.1.2", version: "0.1.2" } } };
  const done = View.ensureNeeds(preset, "x");
  await answer(body, { pick: "made" });
  assert.equal(await done, true);
  assert.deepEqual(preset.nodes.map((n) => n.version), ["0.1.2", "0.1.2", undefined]);
  assert.ok(calls.some((c) => c[0] === "libraryInstallVersion" && c[1] === "filter" && c[2] === "0.1.2"));
  assert.ok(!calls.some((c) => c[0] === "libraryInstall"), "the newest is not installed for it");
});

await test("the version it was made with is already installed next to the newest: nodes pinned, nothing to fetch", async () => {
  const { View, body, calls } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }], versions: [{ slug: "filter", version: "0.1.2", types: ["filter"] }] });
  const preset = { nodes: [filterNode({ version: "0.1.2" })], needs: { filter: { min: "0.1.2", version: "0.1.2" } } };
  assert.equal(await View.ensureNeeds(preset, "x"), true, "pinned nodes whose version is here need no question");
  assert.equal(body.children.length, 0);
  assert.equal(preset.nodes[0].version, "0.1.2");
  assert.ok(!calls.some((c) => c[0] === "libraryInstallVersion"));
});

await test("nodes pinned to a version that is not here: fetched on demand, or released to the newest", async () => {
  {
    const { View, body, calls } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }] });
    const preset = { nodes: [filterNode({ version: "0.1.2" })] };
    const done = View.ensureNeeds(preset, "x");
    await answer(body, { pick: "made" });
    assert.equal(await done, true);
    assert.equal(preset.nodes[0].version, "0.1.2");
    assert.ok(calls.some((c) => c[0] === "libraryInstallVersion" && c[2] === "0.1.2"));
  }
  {
    const { View, body, calls } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }] });
    const preset = { nodes: [filterNode({ version: "0.1.2" })] };
    const done = View.ensureNeeds(preset, "x");
    await answer(body, { pick: "latest" });
    assert.equal(await done, true);
    assert.equal(preset.nodes[0].version, undefined, "the pin is dropped");
    assert.ok(!calls.some((c) => c[0] === "libraryInstallVersion" || c[0] === "libraryInstall"));
  }
});

await test("cancel changes nothing", async () => {
  const { View, body } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }] });
  const preset = { nodes: [filterNode()], needs: { filter: { version: "0.1.2" } } };
  const done = View.ensureNeeds(preset, "x");
  await answer(body, { press: "Cancel" });
  assert.equal(await done, false);
  assert.equal(preset.nodes[0].version, undefined);
});

await test("an app that cannot run older versions only offers the installed one", async () => {
  const { View, body } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }], pinning: false });
  const preset = { nodes: [filterNode()], needs: { filter: { version: "0.1.2" } } };
  const done = View.ensureNeeds(preset, "x");
  const card = await answer(body);
  const radio = card.all().filter((e) => e.tag === "input" && e.type === "radio");
  assert.equal(radio[1].disabled, true);
  assert.equal(await done, true);
  assert.equal(preset.nodes[0].version, undefined);
});

await test("saving writes the version the nodes were made with (needsFor)", async () => {
  const { View } = setup({ installed: [{ slug: "filter", version: "0.2.0", types: ["filter"] }], versions: [{ slug: "filter", version: "0.1.2", types: ["filter"] }] });
  assert.equal(JSON.stringify(await View.needsFor([filterNode()])), JSON.stringify({ filter: { min: "0.2.0", version: "0.2.0" } }));
  assert.equal(JSON.stringify(await View.needsFor([filterNode({ version: "0.1.2" })])), JSON.stringify({ filter: { min: "0.2.0", version: "0.1.2" } }));
});

setTimeout(() => { console.log(failures ? `${failures} failed` : "module-versions: all passed"); process.exit(failures ? 1 : 0); }, 50);
