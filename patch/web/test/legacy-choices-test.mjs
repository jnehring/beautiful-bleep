// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The web board migrates choices saved against an earlier list (the type's "legacy" lists) as the engine does
// (engine/Board.cpp, migrateLegacyChoice; controller_modules_test.cpp): the Multi Filter's Type from the 25- and the
// 32-algorithm lists moves to the same name; today's values, pinned versions and other params stay.
// usage: node legacy-choices-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const types = JSON.parse(readFileSync(new URL("../../board/ui/demo-types.json", import.meta.url)));
const window = { location: { hostname: "localhost", href: "http://localhost/" }, addEventListener() {}, document: { addEventListener() {} } };
const context = vm.createContext({ window, console, setTimeout, clearTimeout, document: window.document, navigator: {}, location: window.location });
vm.runInContext(readFileSync(new URL("../js/bleep-web.js", import.meta.url), "utf8"), context);
const upgrade = (board) => window.BleepWeb.upgradeBoard(board, types);

const type = types.find((t) => t.type === "filter").params.find((p) => p.id === "type");
const n = type.choices.length;
assert.ok(type.legacy && type.legacy.length === 2, "the filter's Type carries its earlier lists");
assert.deepEqual(type.legacy.map((l) => l.length), [25, 32]);
const filter = (value, extra = {}) => ({ id: "f", type: "filter", name: "F", x: 0, y: 0, parent: "", params: { type: value, cutoff: 0.5 }, ...extra });

for (const old of type.legacy) {  // old: k / (old − 1) → the same name in today's list
  for (let k = 0; k < old.length; k++) {
    const b = upgrade({ nodes: [filter(k / (old.length - 1))], cables: [] });
    const j = type.choices.indexOf(old[k]);
    assert.ok(j >= 0, old[k]);
    assert.ok(Math.abs(b.nodes[0].params.type - j / (n - 1)) < 1e-9, `${old[k]} (${k} of ${old.length})`);
    assert.equal(b.nodes[0].params.cutoff, 0.5);
  }
}
for (let j = 0; j < n; j++) {  // today's values stay
  const b = upgrade({ nodes: [filter(j / (n - 1))], cables: [] });
  assert.equal(b.nodes[0].params.type, j / (n - 1));
}
{  // a node pinned to a module version runs that version, with its own list: left alone
  const v = 22 / 31;
  const b = upgrade({ nodes: [filter(v, { version: "0.1.0" })], cables: [] });
  assert.equal(b.nodes[0].params.type, v);
}
console.log("legacy choices: ok");
