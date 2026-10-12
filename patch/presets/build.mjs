#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Compiles the factory cell presets (one file per category in this folder)
// into patch/board/ui/factory-presets.json, the file the board loads, and the
// demo patches (demos/<module>.mjs, five whole boards per advanced module) into
// patch/board/ui/demo-patches.json, which the standalone app's preset browser loads.
//
//   node patch/presets/build.mjs              write factory-presets.json
//   node patch/presets/build.mjs --check      fail if it is out of date (CI)
//   node patch/presets/build.mjs --reference  print every module's knobs in units
//   node patch/presets/build.mjs --only basses --out /tmp/b.json   one category, elsewhere
//   node patch/presets/build.mjs --demos grains,reverb --out /tmp/d.json   just these modules' demo patches
//
// The engine then checks the compiled file (ctest patch.factory-presets).
//
// The board also shows the hand-written presets in ../board/ui/factory-presets.js
// (Basic Poly, the drum machines and single drum sounds) in the same categories;
// names must be unique across both.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { reference, types, derivePlays, checkPlays, normaliseHelp } from "./kit.mjs";
import panelsByPreset, { checkPanels, panelEdits } from "./panels.mjs";

// Category files, in Add-menu order.
const CATEGORIES = [
  "synthesizers", "basses", "leads", "pads", "plucks-and-mallets", "feedback-pings",
  "drum-machines", "drum-kicks", "drum-snares-and-claps", "drum-hats-and-cymbals", "drum-toms-and-percussion",
  "drum-fx", "sequencers", "effects", "processors", "modulators", "generative", "starters", "test",
];

const OUT = fileURLToPath(new URL("../board/ui/factory-presets.json", import.meta.url));
const PANELS = fileURLToPath(new URL("../board/ui/factory-panels.json", import.meta.url));
const PANEL_BUILD = fileURLToPath(new URL("../board/ui/panel-build.js", import.meta.url));
const DEMOS = fileURLToPath(new URL("../board/ui/demo-patches.json", import.meta.url));
const HAND_OUT = fileURLToPath(new URL("../board/ui/hand-written-presets.json", import.meta.url));
const DEMO_DIR = new URL("./demos/", import.meta.url);
const HAND_WRITTEN = fileURLToPath(new URL("../board/ui/factory-presets.js", import.meta.url));

/// The presets factory-presets.js defines (it sets window.BleepFactoryPresets).
function handWritten() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(HAND_WRITTEN, "utf8"), sandbox);
  return sandbox.window.BleepFactoryPresets || [];
}

/// The presets in factory-presets.js carry their `plays` by hand; it must equal what the kit derives from their jacks.
/// A preset's help is present and every image it names is a file in board/ui/.
function checkHelp(name, preset) {
  if (!normaliseHelp(name, preset.help)) throw new Error(`'${name}' needs help`);
  for (const im of preset.help.images || [])
    if (!existsSync(fileURLToPath(new URL("../board/ui/" + im.src, import.meta.url))))
      throw new Error(`'${name}': help image ${im.src} is not in patch/board/ui/`);
}

function checkHandWritten() {
  for (const p of handWritten()) {
    checkHelp(p.name, p.preset);
    const want = derivePlays(p.preset, p.category);
    if (JSON.stringify(p.preset.plays) !== JSON.stringify(want))
      throw new Error(`factory-presets.js: '${p.name}' needs "plays": ${JSON.stringify(want)} in its preset`);
    if (want) checkPlays(p.name, p.preset, want);
  }
}

async function compile(only) {
  const categories = [], presets = [], names = new Set(handWritten().map((p) => p.name));
  checkHandWritten();
  for (const file of only ? [only] : CATEGORIES) {
    const cat = (await import(`./${file}.mjs`)).default;
    categories.push({ name: cat.name, blurb: cat.blurb });
    for (const make of cat.presets) {
      const p = typeof make === "function" ? make() : make;
      if (names.has(p.name)) throw new Error(`two presets are called '${p.name}' (here or in factory-presets.js)`);
      names.add(p.name);
      const preset = p.build(cat.name);
      checkHelp(p.name, preset);
      presets.push({ name: p.name, category: cat.name, preset });
    }
  }
  return { categories, presets };
}

/// The demo patches: demos/<module type>.mjs each export five patches that show off that module.
async function compileDemos(only) {
  const patches = [], names = new Set();
  const files = readdirSync(DEMO_DIR).filter((f) => f.endsWith(".mjs") && (!only || only.includes(f.replace(/\.mjs$/, "")))).sort();
  for (const file of files) {
    const type = file.replace(/\.mjs$/, "");
    if (!types[type]) throw new Error(`demos/${file}: no module type '${type}'`);
    const list = (await import(new URL(file, DEMO_DIR))).default;
    if (!Array.isArray(list) || list.length !== 5) throw new Error(`demos/${file}: needs exactly five demo patches`);
    for (const make of list) {
      const p = typeof make === "function" ? make() : make;
      if (names.has(p.name)) throw new Error(`demos/${file}: two demo patches are called '${p.name}'`);
      names.add(p.name);
      if (!p.name.startsWith(types[type].name + ": ")) throw new Error(`demos/${file}: '${p.name}' must start with '${types[type].name}: '`);
      const doc = p.build();
      if (doc.module !== type) throw new Error(`demos/${file}: '${p.name}' demonstrates '${doc.module}'`);
      patches.push({ name: p.name, module: type, moduleName: types[type].name, preset: doc });
    }
  }
  return patches;
}

/// One node or cable per line, as above.
function formatDemos(patches) {
  const line = (v) => JSON.stringify(v);
  return ["{", `  "format": 1,`, `  "patches": [`,
    patches.map(({ name, module, moduleName, preset }) => {
      const { nodes, cables, ...head } = preset;
      return [
        "    {",
        `      "name": ${line(name)}, "module": ${line(module)}, "moduleName": ${line(moduleName)},`,
        `      "preset": {`,
        ...Object.entries(head).map(([k, v]) => `        ${line(k)}: ${line(v)},`),
        `        "nodes": [`,
        nodes.map((n) => "          " + line(n)).join(",\n"),
        `        ],`,
        `        "cables": [`,
        cables.map((c) => "          " + line(c)).join(",\n"),
        `        ]`,
        `      }`,
        "    }",
      ].join("\n");
    }).join(",\n"), "  ]", "}", ""].join("\n");
}

/// A dial wired to a cell input is a jack the panel feeds, and it doesn't keep its position in the app. For these
/// presets each such dial goes straight to the knob its input modulates, which has a value of its own.
function wireDialsToKnobs(doc, preset, root) {
  for (const c of doc.controls) {
    const w = (c.wire || []).find((q) => q.cell);
    if (!w || c.type !== "dial") continue;
    const cab = preset.cables.find((k) => k.from.jack === w.cell && preset.nodes.find((n) => n.id === k.from.node)?.type === "cell-in"
      && types[preset.nodes.find((n) => n.id === k.to.node).type].params.some((p) => p.id === k.to.jack));
    if (!cab) throw new Error(`${preset.nodes[0].name}: input '${w.cell}' modulates no knob, so its dial can't be wired to one`);
    c.wire = [{ param: `${cab.to.node}.${cab.to.jack}` }];
  }
}

/// A panel for every cell preset without a hand-written one: the board's
/// "Build panel from cell" (board/ui/panel-build.js) run on the preset, so the
/// factory cells and the command give the same draft (panels.md §6).
/// Controller modules inside a cell are the panel's own controls (panels.md), not modules to draw knobs for.
const CONTROLLERS = new Set(["dial", "wheel", "xy-pad", "button", "keyboard"]);
function generatedPanels(all) {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(PANEL_BUILD, "utf8"), sandbox);
  const { build } = sandbox.window.BleepPanelBuild;
  const isBoundary = (n) => ["cell-in", "cell-out", "voice-in", "voice-out"].includes(n.type);
  // bundle jacks (patch bays) are not controls
  const inputsOf = (n) => (n.type === "voice-cell" ? [{ id: "notes", name: "Notes", type: "notes" }] : []).concat((n.inputs || []).filter((j) => j.type !== "patchbay"));
  const out = {};
  for (const { name, preset } of all) {
    if (panelsByPreset[name] || !preset.root) continue;
    const outer = preset.nodes.find((n) => n.id === preset.root);
    // A plain cell around a Voice Cell, with its own controllers beside it: the panel is the Voice Cell's, for the wrapper.
    const wrapped = outer.type === "cell" ? preset.nodes.find((n) => n.type === "voice-cell" && n.parent === outer.id) : null;
    const root = wrapped || outer;
    const inside = new Set(wrapped ? [wrapped.id] : []);
    if (wrapped) for (let grew = true; grew;) { grew = false; for (const n of preset.nodes) if (inside.has(n.parent) && !inside.has(n.id)) { inside.add(n.id); grew = true; } }
    const nodes = preset.nodes.filter((n) => n !== root && (!wrapped || inside.has(n.id)) && !CONTROLLERS.has(n.type) && (!isBoundary(n) || n.type === "voice-out" || n.type === "cell-out"))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const doc = build(root, { nodes, types, inputsOf, cables: preset.cables });
    if (wrapped) {   // the panel belongs to the wrapper: its name, title and cell
      doc.cell = outer.id;
      doc.name = outer.name;
      for (const c of doc.controls) if (c.type === "label" && c.style === "title") c.text = outer.name;
    }
    if (preset.category === "Feedback & Pings") wireDialsToKnobs(doc, preset, root);
    if (panelEdits[name]) panelEdits[name](doc, preset);
    doc.id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    out[name] = [doc];
  }
  return out;
}

/// The hand-written panels (panels.mjs) and the generated ones, each checked against its preset.
function panels(doc) {
  const all = [...doc.presets, ...handWritten()];
  const generated = generatedPanels(all);
  for (const [name, list] of Object.entries(generated)) checkPanels(all.find((q) => q.name === name).preset, list);
  for (const [name, list] of Object.entries(panelsByPreset)) {
    const p = all.find((q) => q.name === name);
    if (!p) throw new Error(`panels.mjs: no preset called '${name}'`);
    checkPanels(p.preset, list);
  }
  const result = { ...panelsByPreset, ...generated };
  // Bleep Instrument and Bleep FX open on the preset's panel: every preset they can load has one.
  for (const q of all) if (q.preset.plays && !result[q.name]?.length) throw new Error(`'${q.name}' can be loaded as a plugin but has no panel`);
  return result;
}

/// The presets of factory-presets.js as JSON, for the plugins' preset library (the board reads the .js itself):
/// one preset per line.
function formatHandWritten() {
  const line = (v) => JSON.stringify(v);
  return ["{", `  "format": 1,`, `  "presets": [`,
    handWritten().map((p) => "    " + line({ name: p.name, category: p.category, preset: p.preset })).join(",\n"), "  ]", "}", ""].join("\n");
}

/// One control per line: readable diffs.
function formatPanels(all) {
  const line = (v) => JSON.stringify(v);
  return ["{", `  "format": 1,`, `  "panels": {`,
    Object.entries(all).map(([name, list]) => `    ${line(name)}: [\n` + list.map((p) => {
      const { controls, ...head } = p;
      return `      {${Object.entries(head).map(([k, v]) => `${line(k)}: ${line(v)}`).join(", ")}, "controls": [\n` +
        controls.map((c) => "        " + line(c)).join(",\n") + "\n      ]}";
    }).join(",\n") + "\n    ]").join(",\n"),
    "  }", "}", ""].join("\n");
}

/// JSON with one node or cable per line: readable diffs, small file.
function format(doc) {
  const line = (v) => JSON.stringify(v);
  const out = ["{", `  "format": 1,`, `  "categories": [`];
  out.push(doc.categories.map((c) => "    " + line(c)).join(",\n"));
  out.push("  ],", `  "presets": [`);
  out.push(doc.presets.map(({ name, category, preset }) => {
    const { nodes, cables, ...head } = preset;
    return [
      "    {",
      `      "name": ${line(name)}, "category": ${line(category)},`,
      `      "preset": {`,
      ...Object.entries(head).map(([k, v]) => `        ${line(k)}: ${line(v)},`),
      `        "nodes": [`,
      nodes.map((n) => "          " + line(n)).join(",\n"),
      `        ],`,
      `        "cables": [`,
      cables.map((c) => "          " + line(c)).join(",\n"),
      `        ]`,
      `      }`,
      "    }",
    ].join("\n");
  }).join(",\n"));
  out.push("  ]", "}", "");
  return out.join("\n");
}

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const arg = args[0];
if (arg === "--reference") {
  console.log(reference());
} else {
  try {
    if (option("--demos")) {  // authoring: build just these modules' demo patches into --out
      const only = option("--demos").split(",");
      const demos = await compileDemos(only);
      writeFileSync(option("--out"), formatDemos(demos));
      console.log(`${demos.length} demo patches for ${only.join(", ")} written to ${option("--out")}`);
      process.exit(0);
    }
    const doc = await compile(option("--only"));
    const panelText = formatPanels(panels(doc));   // first: a panel may add the modules its controls are made with to its preset
    const text = format(doc);
    const demos = option("--only") ? [] : await compileDemos();
    const demoText = formatDemos(demos);
    if (arg === "--check") {
      const stale = [[OUT, text], [PANELS, panelText], ...(option("--only") ? [] : [[DEMOS, demoText], [HAND_OUT, formatHandWritten()]])].filter(([file, want]) => {
        let old = "";
        try { old = readFileSync(file, "utf8"); } catch {}
        return old !== want;
      });
      if (stale.length) {
        console.error(`${stale.map(([f]) => f.replace(/.*\/board\/ui\//, "patch/board/ui/")).join(" and ")} out of date: run node patch/presets/build.mjs`);
        process.exit(1);
      }
    } else if (!option("--out")) {
      writeFileSync(OUT, text);
      writeFileSync(PANELS, panelText);
      writeFileSync(DEMOS, demoText);
      writeFileSync(HAND_OUT, formatHandWritten());
    } else writeFileSync(option("--out"), text);
    const extra = handWritten();
    const count = (name) => doc.presets.filter((p) => p.category === name).length +
      extra.filter((p) => p.category === name).length;
    const counts = doc.categories.map((c) => `${c.name} ${count(c.name)}`);
    console.log(`${doc.presets.length} compiled factory presets (+ ${extra.length} in factory-presets.js); ` +
                `per category: ${counts.join(", ")}; ${demos.length} demo patches`);
  } catch (e) {
    console.error("factory presets: " + e.message);
    process.exit(1);
  }
}
