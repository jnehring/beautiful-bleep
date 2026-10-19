// SPDX-License-Identifier: GPL-3.0-or-later
// Turns what a patch script described (run.mjs) into real board content: a cell with its modules and cables. Everything the script asked
// for is checked here, against the module types of the board: the module exists and can be added, the knobs exist and the values fit,
// the jacks exist and the signal types match. The checks and the unit conversions are those of patch/presets/kit.mjs (the factory
// preset kit), which builds the factory cells the same way from node scripts.

const GRID_X = 240, GRID_Y = 150;   // the layout step for modules a script does not place
const PLACED_X = 300, PLACED_Y = 220;   // the grid `at: [column, row]` uses, as in the preset kit

/// Notes connect only to notes; every other signal converts.
const compatible = (a, b) => (a === "notes") === (b === "notes");

/// Units to the knob's 0..1, as ParamSpec::toNormalised (patch/engine/Spec.h).
export function normalise(p, v) {
  const { min, max } = p;
  if (max <= min) return 0;
  v = Math.min(Math.max(v, min), max);
  let x;
  if (p.map === "exp") x = Math.log(v / min) / Math.log(max / min);
  else if (p.map === "skew") {
    const skew = Math.log(0.5) / Math.log((p.centre - min) / (max - min));
    const q = (v - min) / (max - min);
    x = q <= 0 ? 0 : Math.pow(q, skew);
  } else x = (v - min) / (max - min);
  return Math.round(Math.min(Math.max(x, 0), 1) * 1e6) / 1e6;
}

/// One knob value in units to its normalised value. Floats and ints take numbers; choices take the name (or index); toggles take booleans.
export function resolveParam(where, p, v) {
  if (v && typeof v === "object" && "raw" in v) return v.raw;
  if (p.kind === "choice") {
    let i = typeof v === "number" ? v : (p.choices || []).indexOf(v);
    if (i < 0) i = (p.choices || []).findIndex((c) => c.toLowerCase() === String(v).toLowerCase());
    if (!Number.isInteger(i) || i < 0 || i >= (p.choices || []).length) throw new Error(`${where}: '${v}' is not one of ${(p.choices || []).map((c) => `'${c}'`).join(", ")}`);
    return normalise(p, i + p.min);
  }
  if (p.kind === "bool") {
    if (typeof v !== "boolean") throw new Error(`${where}: expected true or false, got ${JSON.stringify(v)}`);
    return v ? 1 : 0;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${where}: expected a number, got ${JSON.stringify(v)}`);
  if (p.kind === "int" && !Number.isInteger(v)) throw new Error(`${where}: expected a whole number, got ${v}`);
  const eps = 1e-6 * Math.max(1, Math.abs(p.max - p.min));
  if (v < p.min - eps || v > p.max + eps) throw new Error(`${where}: ${v} is outside ${p.min} to ${p.max}`);
  return normalise(p, v);
}

const SIGNALS = new Set(["audio", "control", "pitch", "gate", "trigger", "notes"]);

/// spec: the script's result. types: { id: type description } of the board. options:
///   cellId     the id of the cell node to make; modules inside get ids that start with it
///   parent     the cell the new cell goes in ("" for the top level)
///   x, y       where the cell node goes on the canvas
///   generatedBy  the id of the Code node, written on every node so a recompile can replace them
/// Resolves to { ok, nodes, cables, problems, summary }. `nodes[0]` is the cell node.
export function materialize(spec, types, { cellId, parent = "", x = 0, y = 0, generatedBy } = {}) {
  const problems = [];
  const err = (line, message) => problems.push({ severity: "error", message, line: line || null });
  const prefix = cellId + "/";
  const nodeId = (id) => prefix + id;

  // the cell's own jacks
  const inputs = [], outputs = [];
  for (const j of spec.inputs || []) {
    if (!SIGNALS.has(j.type)) err(0, `input '${j.id}': type must be one of ${[...SIGNALS].join(", ")}, not '${j.type}'`);
    else if (inputs.some((q) => q.id === j.id)) err(0, `input '${j.id}' is declared twice`);
    else inputs.push({ id: j.id, name: j.name, type: j.type });
  }
  for (const j of spec.outputs || []) {
    if (!SIGNALS.has(j.type)) err(0, `output '${j.id}': type must be one of ${[...SIGNALS].join(", ")}, not '${j.type}'`);
    else if (outputs.some((q) => q.id === j.id)) err(0, `output '${j.id}' is declared twice`);
    else outputs.push({ id: j.id, name: j.name, type: j.type });
  }

  // modules
  const byId = new Map();   // script id -> { type }
  const placed = [], unplaced = [];
  for (const n of spec.nodes || []) {
    const t = types[n.type];
    if (!t || !t.creatable || t.port) { err(n.line, `'${n.type}' is not a module a patch can hold${t ? "" : " (no module of that name)"}`); continue; }
    const node = { id: nodeId(n.id), type: n.type, name: n.name || t.name, x: 0, y: 0, parent: cellId, params: {}, ...(generatedBy ? { generatedBy } : {}) };
    for (const [k, v] of Object.entries(n.values || {})) {
      const p = (t.params || []).find((q) => q.id === k);
      if (!p) { err(n.line, `${node.name}: no such knob or setting '${k}' (${(t.params || []).map((q) => q.id).join(", ")})`); continue; }
      try { node.params[k] = resolveParam(`${node.name} › ${p.name}`, p, v); } catch (e) { err(n.line, e.message); }
    }
    if (n.data !== undefined) node.data = n.data;
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) { node.x = n.x; node.y = n.y; placed.push(node); }
    else if (Array.isArray(n.at) && n.at.length === 2 && n.at.every(Number.isFinite)) { node.x = 40 + (n.at[0] + 1) * PLACED_X; node.y = 40 + n.at[1] * PLACED_Y; placed.push(node); }
    else unplaced.push(node);
    byId.set(n.id, { node, type: t });
  }
  // the ones the script did not place go in a grid between the Cell In and the Cell Out
  const cols = Math.max(1, Math.ceil(Math.sqrt(unplaced.length)));
  unplaced.forEach((node, i) => { node.x = 40 + (1 + (i % cols)) * GRID_X; node.y = 40 + Math.floor(i / cols) * GRID_Y; });
  const rightEdge = Math.max(40 + 2 * GRID_X, ...[...placed, ...unplaced].map((n) => n.x + GRID_X));

  const cin = { id: nodeId("ci"), type: "cell-in", name: "Cell In", x: 40, y: 40, parent: cellId, params: {}, ...(generatedBy ? { generatedBy } : {}) };
  const cout = { id: nodeId("co"), type: "cell-out", name: "Cell Out", x: rightEdge, y: 40, parent: cellId, params: {}, ...(generatedBy ? { generatedBy } : {}) };

  // cables
  const outType = (nodeRef, jack) => {
    if (nodeRef === "ci") return (inputs.find((j) => j.id === jack) || {}).type;
    if (nodeRef === "co") return undefined;
    const e = byId.get(nodeRef);
    if (!e) return undefined;
    const j = (e.type.outputs || []).find((o) => o.id === jack);
    return j && j.type;
  };
  const inType = (nodeRef, jack) => {
    if (nodeRef === "co") return (outputs.find((j) => j.id === jack) || {}).type;
    if (nodeRef === "ci") return undefined;
    const e = byId.get(nodeRef);
    if (!e) return undefined;
    const j = (e.type.inputs || []).find((i) => i.id === jack);
    if (j) return j.type;
    const p = (e.type.params || []).find((q) => q.id === jack);
    return p && p.modulatable ? "control" : undefined;
  };
  const label = (ref) => (ref === "ci" ? "Cell In" : ref === "co" ? "Cell Out" : (byId.get(ref) || { node: { name: ref } }).node.name);
  const known = (ref) => ref === "ci" || ref === "co" || byId.has(ref);
  const cables = [];
  for (const c of spec.cables || []) {
    const { from, to } = c;
    if (!known(from.node)) { err(c.line, `cable from '${from.node}': that is not a module of this cell`); continue; }
    if (!known(to.node)) { err(c.line, `cable to '${to.node}': that is not a module of this cell`); continue; }
    const ft = outType(from.node, from.jack), tt = inType(to.node, to.jack);
    if (!ft) { err(c.line, `${label(from.node)} has no output '${from.jack}'${from.node === "ci" ? " (declare it with c.input first)" : ""}`); continue; }
    if (!tt) { err(c.line, `${label(to.node)} has no input or modulatable knob '${to.jack}'${to.node === "co" ? " (declare it with c.output first)" : ""}`); continue; }
    if (!compatible(ft, tt)) { err(c.line, `${label(from.node)}.${from.jack} (${ft}) can't feed ${label(to.node)}.${to.jack} (${tt})`); continue; }
    if (!(c.amount >= -1 && c.amount <= 1)) { err(c.line, `cable amount ${c.amount} is outside -1 to +1`); continue; }
    cables.push({ id: `${prefix}k${cables.length + 1}`, from: { node: nodeId(from.node), jack: from.jack }, to: { node: nodeId(to.node), jack: to.jack }, amount: Math.round(c.amount * 1e6) / 1e6, ...(generatedBy ? { generatedBy } : {}) });
  }

  const cell = { id: cellId, type: "cell", name: spec.name, x, y, parent, params: {}, inputs, outputs, ...(generatedBy ? { generatedBy } : {}) };
  const nodes = [cell, cin, cout, ...placed, ...unplaced];
  return { ok: problems.length === 0, nodes, cables, problems, summary: { modules: byId.size, cables: cables.length } };
}
