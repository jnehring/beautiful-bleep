#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Compiles the factory cell presets (one file per category in this folder)
// into patch/board/ui/factory-presets.json, the file the board loads.
//
//   node patch/presets/build.mjs              write factory-presets.json
//   node patch/presets/build.mjs --check      fail if it is out of date (CI)
//   node patch/presets/build.mjs --reference  print every module's knobs in units
//   node patch/presets/build.mjs --only basses --out /tmp/b.json   one category, elsewhere
//
// The engine then checks the compiled file (ctest patch.factory-presets).
//
// The board also shows the hand-written presets in ../board/ui/factory-presets.js
// (Basic Poly, the drum machines and single drum sounds) in the same categories;
// names must be unique across both.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { reference } from "./kit.mjs";
import panelsByPreset, { checkPanels } from "./panels.mjs";

// Category files, in Add-menu order.
const CATEGORIES = [
  "synthesizers", "basses", "leads", "pads", "plucks-and-mallets",
  "drum-machines", "drum-kicks", "drum-snares-and-claps", "drum-hats-and-cymbals", "drum-toms-and-percussion",
  "drum-fx", "sequencers", "effects", "modulators", "generative",
];

const OUT = fileURLToPath(new URL("../board/ui/factory-presets.json", import.meta.url));
const PANELS = fileURLToPath(new URL("../board/ui/factory-panels.json", import.meta.url));
const HAND_WRITTEN = fileURLToPath(new URL("../board/ui/factory-presets.js", import.meta.url));

/// The presets factory-presets.js defines (it sets window.BleepFactoryPresets).
function handWritten() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(HAND_WRITTEN, "utf8"), sandbox);
  return sandbox.window.BleepFactoryPresets || [];
}

async function compile(only) {
  const categories = [], presets = [], names = new Set(handWritten().map((p) => p.name));
  for (const file of only ? [only] : CATEGORIES) {
    const cat = (await import(`./${file}.mjs`)).default;
    categories.push({ name: cat.name, blurb: cat.blurb });
    for (const make of cat.presets) {
      const p = typeof make === "function" ? make() : make;
      if (names.has(p.name)) throw new Error(`two presets are called '${p.name}' (here or in factory-presets.js)`);
      names.add(p.name);
      presets.push({ name: p.name, category: cat.name, preset: p.build(cat.name) });
    }
  }
  return { categories, presets };
}

/// The hand-written panels (panels.mjs), each checked against its preset.
function panels(doc) {
  const all = [...doc.presets, ...handWritten()];
  for (const [name, list] of Object.entries(panelsByPreset)) {
    const p = all.find((q) => q.name === name);
    if (!p) throw new Error(`panels.mjs: no preset called '${name}'`);
    checkPanels(p.preset, list);
  }
  return panelsByPreset;
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
    const doc = await compile(option("--only"));
    const text = format(doc);
    const panelText = formatPanels(panels(doc));
    if (arg === "--check") {
      const stale = [[OUT, text], [PANELS, panelText]].filter(([file, want]) => {
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
    } else writeFileSync(option("--out"), text);
    const extra = handWritten();
    const count = (name) => doc.presets.filter((p) => p.category === name).length +
      extra.filter((p) => p.category === name).length;
    const counts = doc.categories.map((c) => `${c.name} ${count(c.name)}`);
    console.log(`${doc.presets.length} compiled factory presets (+ ${extra.length} in factory-presets.js); ` +
                `per category: ${counts.join(", ")}`);
  } catch (e) {
    console.error("factory presets: " + e.message);
    process.exit(1);
  }
}
