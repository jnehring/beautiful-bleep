// SPDX-License-Identifier: MIT
// Every factory instrument and effect that Bleep Play can play, run through the browser engine with the real modules: wired as playCell wires
// it (play-wrap.js), played, and checked for sound (needs the built site: scripts/build/build-web.sh, default build/web/site).
//
//   node patch/web/test/play-presets-test.mjs [site dir] [name filter]
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compileModule } from "../js/module-host.js";
import { Engine } from "../js/graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, "..", "..", "board", "ui");
const site = process.argv[2] && existsSync(process.argv[2]) ? process.argv[2] : join(here, "..", "..", "..", "build", "web", "site");
const only = process.argv[3] || "";
if (!existsSync(join(site, "manifest.json"))) {
  console.log("play-presets-test: skipped (no built site at " + site + ")");
  process.exit(0);
}
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(ui, "play-wrap.js"), "utf8"), ctx);
const W = ctx.window.BleepPlayWrap;
const factory = JSON.parse(readFileSync(join(ui, "factory-presets.json"), "utf8")).presets.map((p) => ({ name: p.name, preset: p.preset }));
const typeList = JSON.parse(readFileSync(join(ui, "demo-types.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(site, "manifest.json"), "utf8"));

const engine = new Engine(48000);
engine.setTypes(typeList);
for (const [slug, m] of Object.entries(manifest.modules)) engine.addModule(slug, await compileModule(readFileSync(join(site, m.file))), m.types);

const clone = (o) => JSON.parse(JSON.stringify(o));
const node = (id, type, extra = {}) => ({ id, type, name: id, x: 0, y: 0, parent: "", muted: false, params: {}, ...extra });
let cableId = 0;
const cable = (a, aj, b, bj) => ({ id: "k" + cableId++, from: { node: a, jack: aj }, to: { node: b, jack: bj }, amount: 1 });

/// A preset's nodes and cables into a board under an id prefix; returns the root's id.
function place(b, preset, prefix) {
  const id = (x) => prefix + x;
  for (const n of preset.nodes) {
    const c = clone(n);
    c.id = id(n.id);
    c.parent = n.id === preset.root ? "" : id(n.parent);
    delete c.port;
    b.nodes.push(c);
  }
  for (const c of preset.cables || []) b.cables.push({ ...clone(c), id: "k" + cableId++, from: { ...c.from, node: id(c.from.node) }, to: { ...c.to, node: id(c.to.node) } });
  return id(preset.root);
}

/// The board playCell builds: MIDI In → the cell → Audio Out, or a self-playing instrument → the effect → Audio Out.
function boardFor(p, role, input = false) {
  const plan = W.plan(p.preset, role);
  const b = { format: 1, id: "b", nodes: [node("keys", "midi-in", { port: "p-keys" }), node("out", "audio-out", { port: "p-out" })], cables: [] };
  let root;
  if (role === "instrument") {
    root = place(b, p.preset, "p_");
    for (const c of plan.midi) b.cables.push(cable("keys", c.from, root, c.to));
  } else if (input) {   // the microphone or a file: the Audio In port
    b.nodes.push(node("in", "audio-in", { port: "p-in" }));
    root = place(b, p.preset, "p_");
    plan.in.forEach((j, i) => b.cables.push(cable("in", i ? "r" : "l", root, j)));
  } else {
    const src = W.sources(factory)[0];
    const sp = W.plan(src.preset, "instrument");
    const sid = place(b, src.preset, "s_");
    root = place(b, p.preset, "p_");
    plan.in.forEach((j, i) => b.cables.push(cable(sid, sp.out[Math.min(i, sp.out.length - 1)], root, j)));
  }
  plan.out.forEach((j, i) => b.cables.push(cable(root, j, "out", i ? "r" : "l")));
  if (plan.out.length === 1) b.cables.push(cable(root, plan.out[0], "out", "r"));
  return b;
}

const render = (seconds, input = null) => {
  const n = Math.ceil((48000 * seconds) / 128) * 128, l = new Float32Array(n), r = new Float32Array(n);
  const noise = input && Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 48000) + 0.1 * Math.sin((2 * Math.PI * 1760 * i) / 48000));
  for (let i = 0; i < n; i += 128) engine.render(l.subarray(i, i + 128), r.subarray(i, i + 128), 128, noise && noise.subarray(i, i + 128));
  return l;
};

const results = { sound: [], silent: [], missing: [], broken: [] };
let audioSeconds = 0;
const started = Date.now();
for (const p of factory) {
  for (const role of ["instrument", "effect"]) {
    if (!p.preset.plays || !p.preset.plays[role] || (only && !p.name.includes(only))) continue;
    // An effect is tried twice: through a looping instrument and with the audio input (a tone and a bright overtone, as a file or a microphone).
    for (const input of role === "effect" ? [false, true] : [false]) {
      const b = boardFor(p, role, input);
      const missing = engine.missingSlugs(b, manifest);
      if (missing.length) { results.missing.push(`${p.name} (${missing.join(", ")})`); continue; }
      engine.setBoard(b);
      if (role === "instrument") engine.midi.noteOn(60, 0.9);
      const x = render(1.2, input);
      audioSeconds += 1.2;
      if (role === "instrument") engine.midi.allOff();
      render(0.5);
      const peak = x.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, Math.abs(v)) : Infinity), 0);
      const label = `${p.name} (${role}${input ? ", input" : ""})`;
      if (!Number.isFinite(peak)) results.broken.push(label);
      else if (peak < 1e-4) results.silent.push(label);
      else results.sound.push(label);
    }
  }
}
const took = (Date.now() - started) / 1000;
console.log(`${results.sound.length} play, ${results.silent.length} are silent, ${results.missing.length} need modules the site lacks, ${results.broken.length} give non-finite audio`);
console.log(`${audioSeconds.toFixed(0)} s of audio in ${took.toFixed(0)} s (${(audioSeconds / took).toFixed(1)}× real time, one preset at a time)`);
if (results.silent.length) console.log("silent:", results.silent.join(", "));
if (results.missing.length) console.log("missing:", results.missing.join(", "));
assert.deepEqual(results.broken, [], "no preset may produce NaN or infinity");
console.log("play-presets-test: done");
