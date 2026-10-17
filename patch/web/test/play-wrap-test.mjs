// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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
assert.deepEqual(plain(W.plan(find("Pocket Thump"), "instrument")), {
  ok: true, role: "instrument", midi: [{ from: "trigger", to: "trig" }, { from: "velocity", to: "velocity" }], in: [], out: ["l", "r"], notes: [] });
// a drum map: the Drum Notes module sits between MIDI In and the cell, and the keys start at the General MIDI drum notes
const hats = plain(W.plan(find("Glass Hats"), "instrument"));
assert.ok(hats.ok && hats.octave === 2 && W.DRUM_OCTAVE === 2);
assert.deepEqual(hats.midi, [], "trigger and velocity come from Drum Notes");
assert.deepEqual(hats.drums.filter((d) => d.to === "open"), [{ from: "open", to: "open" }], "note 46 opens the hat");
assert.deepEqual(hats.drums.filter((d) => d.to === "closed").map((d) => d.from).sort(), ["bell", "clap", "crash", "hat", "kick", "ride", "rim", "snare", "tom"], "every other drum closes it");
assert.ok(hats.drums.some((d) => d.from === "velocity" && d.to === "velocity"));
assert.ok(hats.notes.some((n) => n.includes("A♯2 plays “open”") && n.includes("every other drum key plays “closed”")), hats.notes.join(" "));
assert.equal(W.noteName(60), "C4");
assert.equal(W.noteName(46), "A♯2");
assert.equal("drums" in plain(W.plan(find("Pocket Thump"), "instrument")), false, "a plain trigger needs no Drum Notes");
const pitched = JSON.parse(JSON.stringify(find("Pocket Thump")));   // a plain cell whose notes drive a pitch jack
pitched.plays.instrument.notes = { pitch: "trig" };
assert.deepEqual(plain(W.plan(pitched, "instrument").midi), [{ from: "pitch", to: "trig" }]);
assert.deepEqual(plain(W.plan(find("Tin Roof Rain"), "instrument").midi), []);   // plays by itself
const eff = plain(W.plan(find("Glass Plate"), "effect"));
assert.deepEqual([eff.ok, eff.in, eff.out], [true, ["l", "r"], ["l", "r"]]);

// a Voice Cell as the root takes the notes; one inside a plain cell is reached through that cell's notes jack
const hasVoices = (p) => p.preset.nodes.some((n) => n.type === "voice-cell");
const voiceCell = factory.find((p) => p.preset.plays && p.preset.plays.instrument && p.preset.nodes.find((n) => n.id === p.preset.root).type === "voice-cell");
assert.deepEqual(plain(W.plan(voiceCell.preset, "instrument")), { ok: true, role: "instrument", midi: [{ from: "notes", to: "notes" }], in: [], out: ["l", "r"], notes: [] });
const nested = factory.find((p) => p.preset.plays && p.preset.plays.instrument && p.preset.nodes.find((n) => n.id === p.preset.root).type === "cell" && hasVoices(p));
if (nested) assert.deepEqual(plain(W.plan(nested.preset, "instrument").midi), [{ from: "notes", to: "notes" }], nested.name);   // no factory cell wraps a Voice Cell any more

// refusals: the wrong role, a missing jack
assert.equal(W.plan(find("Pocket Thump"), "effect").reason, "role");
assert.equal(W.plan(find("Glass Plate"), "instrument").reason, "role");
assert.equal(W.plan(null, "instrument").reason, "role");
const broken = JSON.parse(JSON.stringify(find("Pocket Thump")));
broken.plays.instrument.notes.velocity = "nothing";
assert.ok(W.plan(broken, "instrument").notes.some((n) => n.includes("“nothing” is missing")));
const noIn = JSON.parse(JSON.stringify(find("Glass Plate")));
noIn.plays.effect.in = ["x"];
assert.equal(W.plan(noIn, "effect").reason, "jacks");

// every factory preset with `plays` is playable, and every cable ends on a jack the cell has (a Voice Cell's notes, l and r are fixed)
let playable = 0, voices = 0;
for (const p of factory) {
  for (const role of ["instrument", "effect"]) {
    if (!p.preset.plays || !p.preset.plays[role]) continue;
    const root = p.preset.nodes.find((n) => n.id === p.preset.root);
    const r = W.plan(p.preset, role);
    if (p.preset.media) { assert.equal(r.reason, "media", p.name); continue; }   // Play cannot load recordings yet
    assert.ok(r.ok, `${p.name}: ${r.message}`);
    const fixed = root.type === "voice-cell" ? ["notes"] : [];
    const ins = new Set([...root.inputs.map((j) => j.id), ...fixed]), outs = new Set([...root.outputs.map((j) => j.id), ...(fixed.length ? ["l", "r"] : [])]);
    for (const c of r.midi) assert.ok(ins.has(c.to), `${p.name}: ${c.to}`);
    for (const d of r.drums || []) assert.ok(ins.has(d.to), `${p.name}: drum ${d.to}`);
    for (const j of r.in) assert.ok(ins.has(j), `${p.name}: in ${j}`);
    assert.ok(r.out.length >= 1 && r.out.every((j) => outs.has(j)), `${p.name}: out`);
    playable++;
    if (hasVoices(p)) voices++;
  }
}
assert.ok(playable >= 140 && voices >= 40, `${playable} playable, ${voices} with voices`);

// sources for an effect: self-playing instruments only
const src = W.sources(factory).map((s) => s.name);
assert.ok(src.includes("Tin Roof Rain") && src.includes("Phase Claves"));
assert.ok(!src.includes("Pocket Thump") && !src.includes("Glass Plate"));
assert.ok(src.length >= 4, src.join(", "));

console.log(`play-wrap-test: ok (${playable} playable, ${voices} of them with voices, ${src.length} effect sources)`);
