// SPDX-License-Identifier: MIT
//
// Shared by the drum sound categories (drum-*.mjs): one-shot synth drums.
// Each cell is one sound with inputs Trig and Velocity (hi-hats: Closed, Open
// and Velocity) and outputs Out L/R. Up to four layers go into an Audio Mixer
// (level in dB, pan −1…1), then through an optional chain of effects to Out L/R.
import { cell } from "./kit.mjs";

// Trigger jack, velocity jack and outputs of the sound sources; the rest are drum modules.
const SOURCE = {
  "perc-voice": ["trig", "accent", ["l", "r"]],
  "macro-osc": ["trig", "accent", ["out"]],
  "modal-voice": ["strike", "velocity", ["l", "r"]],
};
const sourceJacks = (type) => SOURCE[type] || ["trig", "velocity", ["out"]];
// Inputs and outputs of the effects.
const EFFECT = { resonator: [["in"], ["odd", "even"]] };
const effectJacks = (type) => EFFECT[type] || [["l", "r"], ["l", "r"]];

/// A layer: a source played by the cell's Trig, or by `on` (a cell input id).
/// A hi-hat module's Closed and Open follow the cell's; `on` can also map the
/// module's trigger jacks to cell inputs ({ open: "trig" }).
export const layer = (type, name, values, opts = {}) => ({ type, name, values, ...opts });
export const effect = (type, name, values) => ({ type, name, values });

/// A drum cell. `hats`: inputs Closed and Open instead of Trig. `patch(p, nodes)`
/// adds cables; `nodes` holds the layers, then the effects.
export function drum(name, { description, tags, help, hats = false, layers, effects = [], patch }) {
  const p = cell(name, { description, help, tags: ["drums", "one-shot", ...tags] });
  if (hats) p.input("closed", "Closed", "trigger").input("open", "Open", "trigger");
  else p.input("trig", "Trig", "trigger");
  p.input("velocity", "Velocity", "control").stereoOut();

  const mix = { limiter: false };
  layers.forEach((l, i) => {
    mix[`level${i + 1}`] = l.gain || 0;
    mix[`pan${i + 1}`] = l.pan || 0;
  });
  const mixer = p.add("audio-mixer", [1, 0], mix, { name: "Mixer" });
  const nodes = layers.map((l, i) => {
    const [trig, vel, outs] = sourceJacks(l.type);
    const n = p.add(l.type, [0, i], l.values, { name: l.name });
    const on = typeof l.on === "object" ? l.on
             : l.type.endsWith("-hats") && !l.on ? { closed: "closed", open: "open" } : { [trig]: l.on || "trig" };
    for (const [jack, input] of Object.entries(on)) p.cable(p.cin, input, n, jack);
    p.cable(p.cin, "velocity", n, vel);
    outs.forEach((o, j) => p.cable(n, o, mixer, `in${i + 1}${"lr"[j]}`));  // mono in: L feeds both
    return n;
  });
  let from = mixer, fromJacks = ["outl", "outr"];
  for (const [i, e] of effects.entries()) {
    const [ins, outs] = effectJacks(e.type);
    const n = p.add(e.type, [2 + i, 0], e.values, { name: e.name });
    ins.forEach((jack, j) => p.cable(from, fromJacks[Math.min(j, fromJacks.length - 1)], n, jack));
    nodes.push(n);
    from = n;
    fromJacks = outs;
  }
  p.cable(from, fromJacks[0], p.cout, "l").cable(from, fromJacks[fromJacks.length - 1], p.cout, "r");
  if (patch) patch(p, nodes);
  return p;
}

// Multi Filter modes (the Mode knob morphs LP › BP › HP › Notch).
export const LP = "LP", BP = "BP", HP = "HP";
