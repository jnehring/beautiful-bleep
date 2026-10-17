// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep-credits.js: cleaning, merging without repeats, collecting from nodes, stamping a cell.
//
//   node patch/web/test/credits-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(here, "..", "..", "common", "ui", "bleep-credits.js"), "utf8"), ctx);
const C = ctx.window.BleepCredits;
const plain = (v) => JSON.parse(JSON.stringify(v));   // the vm's arrays and objects have another prototype

// clean: known fields only, trimmed, cut, licence defaults to CC-BY-4.0; no name, no credit
assert.deepEqual(plain(C.clean({ name: "  Dub Echo ", author: "janne", address: "janne/dub-echo", license: "CC-BY-4.0", evil: 1 })),
                 { name: "Dub Echo", author: "janne", address: "janne/dub-echo", license: "CC-BY-4.0" });
assert.deepEqual(plain(C.clean({ name: "X" })), { name: "X", author: "", license: "CC-BY-4.0" });
assert.equal(C.clean({ name: "   " }), null);
assert.equal(C.clean(null), null);
assert.equal(C.clean("Dub Echo"), null);
assert.equal(C.clean({ name: 5 }), null);
assert.equal(C.clean({ name: "x".repeat(500) }).name.length, 120);
assert.equal("address" in C.clean({ name: "X", address: "  " }), false);

// merge: the first one stays, repeats by address or by author + name (any case), only lists count, capped
const a = C.library("Dub Echo", "janne/dub-echo");
assert.deepEqual(plain(C.merge([a], [{ name: "Dub Echo (copy)", author: "x", address: "JANNE/dub-echo" }])), [plain(a)]);
assert.equal(C.merge([C.factory("Basic Poly")], [C.factory("basic poly")]).length, 1);
assert.equal(C.merge([C.factory("Basic Poly")], [{ name: "Basic Poly", author: "someone" }]).length, 2);
assert.deepEqual(plain(C.merge(undefined, null, "x", { name: "y" })), []);
assert.equal(C.merge(Array.from({ length: 80 }, (_, i) => ({ name: "p" + i, author: "a" }))).length, C.MAX_CREDITS);

// factory and library credits
assert.deepEqual(plain(C.factory("Basic Poly")), { name: "Basic Poly", author: "bleep", license: "CC-BY-4.0" });
assert.equal(C.library("T", "janne/t").author, "janne");
assert.equal(C.library("T", "janne/t", "Janne H").author, "Janne H");

// collect: nodes without credits are skipped, cells inside cells add up, repeats collapse
const nodes = [
  { id: "c1", type: "cell", credits: [C.factory("Basic Poly")] },
  { id: "n1", type: "filter" },
  { id: "c2", type: "cell", credits: [C.factory("Basic Poly"), C.library("Dub Echo", "janne/dub-echo")] },
  null,
];
assert.deepEqual(plain(C.collect(nodes)).map((c) => c.name), ["Basic Poly", "Dub Echo"]);
assert.deepEqual(plain(C.collect(undefined)), []);

// stamp: own list first, extras after (a list or one credit), no empty field left behind
const cell = { id: "c1", credits: [C.library("Dub Echo", "janne/dub-echo")] };
C.stamp(cell, C.factory("Basic Poly"));
assert.deepEqual(plain(cell.credits).map((c) => c.name), ["Dub Echo", "Basic Poly"]);
C.stamp(cell, [C.factory("Basic Poly")], undefined);
assert.equal(cell.credits.length, 2);
const bare = { id: "c2", credits: [] };
C.stamp(bare);
assert.equal("credits" in bare, false);

console.log("credits-test: ok");
