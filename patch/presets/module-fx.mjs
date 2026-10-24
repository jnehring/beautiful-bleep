// SPDX-License-Identifier: MIT
// Module FX: every factory preset of an effect module (modules/<type>.mjs) as a Bleep FX preset of its own: the module alone
// between In L/R and Out L/R, with its own view pinned as the panel, so the plugin opens straight on the module's UI
// (and its preset bar). They are the same presets as the module's preset bar, written once.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cell, category, types } from "./kit.mjs";

/// The effect modules with a stereo audio in and out, and how long each rings on after the input stops (seconds): a feedback
/// delay or a long reverb needs its tail, or Live cuts it on stop.
// (Wavefolder is not here: it has an oscillator of its own and sounds with nothing patched in.)
const MODULES = {
  chorus: 1, compressor: 0, crunch: 0, delay: 30, "delay-network": 8, eq: 0, "freq-shifter": 8, limiter: 0, phaser: 1,
  "pitch-shifter": 1, reverb: 60, "room-print": 4, saturator: 0, "shape-table": 0, "zone-delay": 60,
  filter: 0, "dual-filter": 0,
};

/// Knobs that make a module sound with nothing patched in (hiss, a DC offset): a preset that sets one is not an effect setting.
/// Presets that never stop on their own (a looper holds what it heard), so they have no tail to declare.
const ENDLESS = new Set(["Zone Delay: Looper"]);
const SELF_SOUND = { saturator: ["age", "bias"] };

/// A module's view in a panel, in grid units (a panel's controls are 20 px); the default is a panel's usual 24 × 14.
const VIEW = {};
const view = (type) => VIEW[type] || [28, 16];

const dir = fileURLToPath(new URL("./modules/", import.meta.url));
const files = new Set(readdirSync(dir).map((f) => f.replace(/\.mjs$/, "")));

const nameOf = (type, preset) => `${types[type].name}: ${preset}`;

/// [{ type, name (the cell's), preset (the module preset's name), values, description }] in module order.
const entries = [];
for (const type of Object.keys(MODULES)) {
  if (!types[type]) throw new Error(`module-fx: no module type '${type}'`);
  if (!files.has(type)) continue;
  const list = (await import(new URL(`./modules/${type}.mjs`, import.meta.url))).default;
  for (const [preset, values, description, data] of list) {
    if (data !== undefined) continue;   // a preset that carries data (steps, curves) is not an effect setting
    if (ENDLESS.has(nameOf(type, preset))) continue;
    if ((SELF_SOUND[type] || []).some((k) => values[k])) continue;
    entries.push({ type, name: nameOf(type, preset), preset, values, description });
  }
}

function make({ type, name, preset, values, description }) {
  const t = types[type];
  const p = cell(name, {
    description: `${description || `${t.name}, set to ${preset}.`} The ${t.name} module on its own, with its view as the panel.`,
    tags: [type, t.name.toLowerCase(), "module", "single module", ...t.category.toLowerCase().split(/[\/&]/).map((s) => s.trim()).filter(Boolean)],
    help: `${description || `${t.name} with its ${preset} setting.`}\n\n` +
      `This is the ${t.name} module on its own between In L/R and Out L/R. The panel is the module's own view, with its ` +
      `preset bar: change any knob, or pick another preset, and it follows.\n\n` +
      `Tip: open the board to cable the module's other jacks, or to put more modules around it.`,
  }).stereoIn().stereoOut()
    .plays({ effect: { in: ["l", "r"], out: ["l", "r"], tail: MODULES[type] } });
  const m = p.add(type, [1, 0], values, { id: "fx" });
  p.stereo(p.cin, m).stereo(m, p.cout);
  return p;
}

/// The pinned panels, keyed by cell preset name (panels.mjs puts them next to the hand-written ones).
export const panels = Object.fromEntries(entries.map((e) => {
  const [w, h] = view(e.type);
  return [e.name, [{
    id: e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name: e.name, cell: "root", cols: w + 2, rows: h + 4,
    controls: [
      { id: "c1", type: "label", at: [1, 0], size: [w, 2], text: types[e.type].name, style: "title" },
      { id: "c2", type: "view", at: [1, 3], size: [w, h], node: "fx" },
    ],
  }]];
}));

export default category("Module FX", "Each effect module on its own, with its view as the panel: every factory preset of Reverb, Delay, EQ and the rest as a Bleep FX preset.",
  entries.map((e) => () => make(e)));
