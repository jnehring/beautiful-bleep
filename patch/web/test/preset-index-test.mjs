// SPDX-License-Identifier: MIT
// preset-index.js: entries, views, origins, search.
//
//   node patch/web/test/preset-index-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(here, "..", "..", "board", "ui", "preset-index.js"), "utf8"), ctx);
const X = ctx.window.BleepPresetIndex;
const names = (list) => list.map((e) => e.name);
const plain = (v) => JSON.parse(JSON.stringify(v));   // the vm's arrays have another prototype

const E = [
  X.entry({ kind: "cell", origin: "factory", name: "Basic Poly", group: "Synthesizers", tags: ["poly"], plays: { instrument: { notes: "voice" } } }),
  X.entry({ kind: "cell", origin: "factory", name: "Dub Echo", group: "Delays", description: "Tape-style repeats", plays: { effect: { in: ["l", "r"] } } }),
  X.entry({ kind: "cell", origin: "user", name: "My Both", group: "My Cells", plays: { instrument: {}, effect: {} } }),
  X.entry({ kind: "cell", origin: "user", name: "Lfo Thing", group: "Modulators" }),
  X.entry({ kind: "demo", origin: "factory", name: "Grains: Frozen Cloud", group: "Grains", module: "grains", description: "A frozen pad" }),
  X.entry({ kind: "demo", origin: "factory", name: "Verb: Cathedral", group: "Verb", module: "reverb" }),
  X.entry({ kind: "project", origin: "user", name: "Sketch 1" }),
  X.entry({ kind: "project", origin: "community", name: "Ambient Bed", author: "janne", served: true }),
];

// entry: defaults and unknown origins
assert.equal(X.entry({ kind: "project", name: "x", origin: "nonsense" }).origin, "user");
assert.deepEqual(plain(X.entry({ kind: "project", name: "x", tags: "no" }).tags), []);
assert.equal(X.entry({ kind: "cell", name: "x", plays: "no" }).plays, null);

// playsAs
assert.deepEqual(plain(E.map(X.playsAs)), ["instrument", "effect", "both", "", "", "", "", ""]);

// views
const view = (v, origins, query) => names(X.select(E, { view: v, origins, query }));
assert.equal(view("all").length, E.length);
assert.deepEqual(view("cell"), ["Basic Poly", "Dub Echo", "My Both", "Lfo Thing"]);
assert.deepEqual(view("project"), ["Sketch 1", "Ambient Bed"]);
assert.deepEqual(view("demo"), ["Grains: Frozen Cloud", "Verb: Cathedral"]);
assert.deepEqual(view("instrument"), ["Basic Poly", "My Both"]);
assert.deepEqual(view("effect"), ["Dub Echo", "My Both"]);
assert.deepEqual(view("module:grains"), ["Grains: Frozen Cloud"]);
assert.deepEqual(view("module:nothing"), []);
assert.deepEqual(view("bogus"), []);

// origins: none chosen means all; several combine
assert.equal(view("all", []).length, E.length);
assert.deepEqual(view("cell", ["user"]), ["My Both", "Lfo Thing"]);
assert.deepEqual(view("all", new Set(["community", "user"])), ["My Both", "Lfo Thing", "Sketch 1", "Ambient Bed"]);
assert.deepEqual(view("instrument", ["community"]), []);

// search: every word, over name, group, tags, description, author; served entries always pass
assert.deepEqual(view("all", [], "dub tape"), ["Dub Echo", "Ambient Bed"]);   // Ambient Bed is "served": the Library already filtered it
assert.deepEqual(view("cell", [], "poly"), ["Basic Poly"]);
assert.deepEqual(view("cell", [], "SYNTHESIZERS"), ["Basic Poly"]);
assert.deepEqual(view("demo", [], "frozen pad"), ["Grains: Frozen Cloud"]);
assert.deepEqual(view("cell", [], "tape repeats"), ["Dub Echo"]);
assert.deepEqual(view("project", [], "janne"), ["Ambient Bed"]);
assert.deepEqual(view("cell", [], "zzz"), []);

// counts ignore the query
assert.equal(X.count(E, "cell", []), 4);
assert.equal(X.count(E, "cell", ["factory"]), 2);

// modules: sorted by name
assert.deepEqual(plain(X.modules(E)), [["grains", "Grains"], ["reverb", "Verb"]]);

console.log("preset-index-test: ok");
