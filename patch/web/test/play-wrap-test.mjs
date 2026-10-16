// SPDX-License-Identifier: MIT
// play-wrap.js: which factory presets Bleep Play can play on their own, and how they are wired.
//
//   node patch/web/test/play-wrap-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, "..", "..", "board", "ui");
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(ui, "play-wrap.js"), "utf8"), ctx);
const W = ctx.window.BleepPlayWrap;
const plain = (v) => JSON.parse(JSON.stringify(v));
const factory = JSON.parse(readFileSync(join(ui, "factory-presets.json"), "utf8")).presets;
const find = (name) => factory.find((p) => p.name === name).preset;

// shapes of `plays.instrument.notes`
assert.deepEqual(plain(W.plan(find("808 Boom"), "instrument")), {
  ok: true, role: "instrument", midi: [{ from: "trigger", to: "trig" }, { from: "velocity", to: "velocity" }], in: [], out: ["l", "r"], notes: [] });
const hats = plain(W.plan(find("808 Hats"), "instrument"));
assert.ok(hats.ok && hats.midi[0].to === "closed" && hats.notes.some((n) => n.includes("drum map")));
assert.deepEqual(plain(W.plan(find("Seasons Turning"), "instrument").midi), [{ from: "pitch", to: "root" }]);
assert.deepEqual(plain(W.plan(find("Bongo Garden"), "instrument").midi), []);   // plays by itself
const eff = plain(W.plan(find("Cathedral Hall"), "effect"));
assert.deepEqual([eff.ok, eff.in, eff.out], [true, ["l", "r"], ["l", "r"]]);

// refusals: a voice cell, the wrong role, a missing jack
const hasVoices = (p) => p.preset.nodes.some((n) => n.type === "voice-cell");
const voiceCell = factory.find((p) => p.preset.plays && p.preset.plays.instrument && p.preset.nodes.find((n) => n.id === p.preset.root).type === "voice-cell");
const nested = factory.find((p) => p.preset.plays && p.preset.plays.instrument && p.preset.nodes.find((n) => n.id === p.preset.root).type === "cell" && hasVoices(p));
assert.equal(W.plan(nested.preset, "instrument").reason, "voices", nested.name);   // a Voice Cell inside a plain cell
const voice = plain(W.plan(voiceCell.preset, "instrument"));
assert.deepEqual([voice.ok, voice.reason], [false, "voices"]);
assert.equal(W.plan(find("808 Boom"), "effect").reason, "role");
assert.equal(W.plan(find("Cathedral Hall"), "instrument").reason, "role");
assert.equal(W.plan(null, "instrument").reason, "role");
const broken = JSON.parse(JSON.stringify(find("808 Boom")));
broken.plays.instrument.notes.velocity = "nothing";
assert.ok(W.plan(broken, "instrument").notes.some((n) => n.includes("“nothing” is missing")));
const noIn = JSON.parse(JSON.stringify(find("Cathedral Hall")));
noIn.plays.effect.in = ["x"];
assert.equal(W.plan(noIn, "effect").reason, "jacks");

// every factory preset with `plays`: voice cells are refused, all others are playable and every cable ends on a jack the cell has
let playable = 0, voices = 0;
for (const p of factory) {
  for (const role of ["instrument", "effect"]) {
    if (!p.preset.plays || !p.preset.plays[role]) continue;
    const root = p.preset.nodes.find((n) => n.id === p.preset.root);
    const r = W.plan(p.preset, role);
    if (hasVoices(p)) { assert.equal(r.reason, "voices", p.name); voices++; continue; }
    assert.ok(r.ok, `${p.name}: ${r.message}`);
    const ins = new Set(root.inputs.map((j) => j.id)), outs = new Set(root.outputs.map((j) => j.id));
    for (const c of r.midi) assert.ok(ins.has(c.to), `${p.name}: ${c.to}`);
    for (const j of r.in) assert.ok(ins.has(j), `${p.name}: in ${j}`);
    assert.ok(r.out.length >= 1 && r.out.every((j) => outs.has(j)), `${p.name}: out`);
    playable++;
  }
}
assert.equal(voices, factory.filter((p) => p.preset.plays && (p.preset.plays.instrument || p.preset.plays.effect) && hasVoices(p)).length);
assert.ok(playable >= 50 && voices >= 60, `${playable} playable, ${voices} with voices`);

// sources for an effect: self-playing instruments only
const src = W.sources(factory).map((s) => s.name);
assert.ok(src.includes("Bongo Garden") && src.includes("Wind Chimes"));
assert.ok(!src.includes("808 Boom") && !src.includes("Cathedral Hall"));
assert.ok(src.length >= 4, src.join(", "));

console.log(`play-wrap-test: ok (${playable} playable, ${voices} need voices, ${src.length} effect sources)`);
