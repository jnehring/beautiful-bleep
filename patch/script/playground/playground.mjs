// SPDX-License-Identifier: GPL-3.0-or-later
// The Code module as a page: source -> asc + the Bleep transform (in this page) -> a module that runs in an AudioWorklet,
// with the automatic panel built by BleepView (the board's own view code) from the generated description.
import { compileScript } from "../compiler/compile.mjs";
import { loadExamples } from "./examples.mjs";

const $ = (id) => document.getElementById(id);
const STORE = "bleep-script-playground";

const ui = { source: $("source"), gutter: $("gutter"), problems: $("problems"), status: $("status"), compile: $("compile"),
  example: $("example"), panel: $("panel"), probes: $("probes"), spec: $("spec"), signal: $("signal"), volume: $("volume") };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: nothing is kept */ } },
};
const setStatus = (text, cls = "") => { ui.status.textContent = text; ui.status.className = cls; };

// ---- the compiler, loaded once ------------------------------------------------------------------------------------------
const lib = {};
let asc = null;
async function loadCompiler() {
  const t0 = performance.now();
  [asc] = await Promise.all([
    import("assemblyscript/asc").then((m) => m.default),
    ...["abi", "dsp", "format", "notes"].map(async (n) => { lib[`src/bleep/${n}.ts`] = await (await fetch(`/script/src/bleep/${n}.ts`)).text(); }),
  ]);
  return performance.now() - t0;
}

/// Compiles the source: { wasm, specs, generated, problems, ms }; `wasm` is null when there are errors.
const compile = (text) => compileScript(asc, text, { lib });

// ---- audio --------------------------------------------------------------------------------------------------------------------
let ctx = null, node = null, installing = null;
let ready = false;   // true once the worklet runs the latest module: live values before that are the old module's
async function audio() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule("./worklet.js");
    node = new AudioWorkletNode(ctx, "bleep-playground", { outputChannelCount: [2] });
    node.connect(ctx.destination);
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === "live") { if (ready) showProbes(m.live.values || {}); }
      else if (m.cmd === "error") setStatus(`the module stopped: ${m.message}`, "bad");
      else if (m.cmd === "installed") { ready = true; if (installing) { installing(); installing = null; } }
    };
    node.port.postMessage({ cmd: "signal", value: ui.signal.value });
    node.port.postMessage({ cmd: "volume", value: Number(ui.volume.value) });
  }
  if (ctx.state === "suspended") await ctx.resume();
  return node;
}

// ---- panel and probes ---------------------------------------------------------------------------------------------------------
let values = {};         // param id -> normalised value, kept across compiles for params that still exist
let probeRows = new Map();

function buildPanel(spec) {
  const type = { ...spec, buttons: spec.buttons || [] };
  const params = {};
  spec.params.forEach((p) => { params[p.id] = values[p.id] !== undefined ? values[p.id] : p.default; });
  values = params;
  const index = new Map(spec.params.map((p, i) => [p.id, i]));
  const api = new Proxy({
    setParam(id, v) { values[id] = v; if (node) node.port.postMessage({ cmd: "knob", index: index.get(id), value: v }); },
    cablesInto: () => [], isPatched: () => false, presets: () => [],   // no cables here; what BleepView reads as lists or flags
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const view = window.BleepView.create(type, { id: "play", type: spec.type, name: spec.name, params, x: 0, y: 0, parent: "", muted: false }, api);
  ui.panel.replaceChildren(view.root);
  return params;
}

function showProbes(live) {
  for (const [id, value] of Object.entries(live)) {
    let row = probeRows.get(id);
    if (!row) {
      const el = document.createElement("div"); el.className = "probe";
      const name = document.createElement("span"); name.textContent = id;
      const bar = document.createElement("span"); bar.className = "bar"; bar.append(document.createElement("i"));
      const out = document.createElement("output");
      el.append(name, bar, out); ui.probes.append(el);
      row = { bar: bar.firstChild, out }; probeRows.set(id, row);
    }
    row.bar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    row.out.textContent = Number(value).toFixed(3);
  }
}

// ---- the editor ---------------------------------------------------------------------------------------------------------------------
function drawGutter(errorLines = new Set()) {
  const n = ui.source.value.split("\n").length;
  let html = "";
  for (let i = 1; i <= n; i++) html += errorLines.has(i) ? `<span class="err">${i}</span>\n` : `${i}\n`;
  ui.gutter.innerHTML = html;
  ui.gutter.scrollTop = ui.source.scrollTop;
}
function showProblems(problems) {
  ui.problems.replaceChildren(...problems.map((p) => {
    const li = document.createElement("li");
    li.className = p.severity;
    const where = document.createElement("span"); where.className = "where";
    where.textContent = p.line ? `${p.line}${p.column ? ":" + p.column : ""}` : p.file || "";
    const text = document.createElement("span"); text.textContent = p.message;
    li.append(where, text);
    if (p.line) li.addEventListener("click", () => jump(p.line));
    return li;
  }));
  drawGutter(new Set(problems.filter((p) => p.severity === "error" && p.line).map((p) => p.line)));
}
function jump(line) {
  const lines = ui.source.value.split("\n");
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  ui.source.focus();
  ui.source.setSelectionRange(start, start + (lines[line - 1] || "").length);
  ui.source.scrollTop = Math.max(0, (line - 4) * 18.75);
}
ui.source.addEventListener("input", () => { drawGutter(); store.set(STORE, ui.source.value); });
ui.source.addEventListener("scroll", () => { ui.gutter.scrollTop = ui.source.scrollTop; });
ui.source.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: t, value } = ui.source;
    ui.source.value = value.slice(0, s) + "  " + value.slice(t);
    ui.source.selectionStart = ui.source.selectionEnd = s + 2;
    ui.source.dispatchEvent(new Event("input"));
  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
});

// ---- compile and run -----------------------------------------------------------------------------------------------------------------
let busy = false;
async function run() {
  if (busy || !asc) return;
  busy = true; ui.compile.disabled = true;
  try {
    const node_ = audio();   // from the click: the browser lets the audio start
    setStatus("compiling…");
    const result = await compile(ui.source.value);
    showProblems(result.problems);
    ui.spec.textContent = result.specs.length ? JSON.stringify(result.specs, null, 2) : "";
    if (!result.wasm) {
      const errors = result.problems.filter((p) => p.severity === "error").length;
      setStatus(`${errors} error${errors === 1 ? "" : "s"}; the previous version keeps playing`, "bad");
      return;
    }
    const spec = result.specs[0];
    if (!spec) { setStatus("no @module class found", "bad"); return; }
    const params = buildPanel(spec);
    ui.probes.replaceChildren(); probeRows = new Map();
    const worklet = await node_;
    ready = false;
    await new Promise((resolve) => { installing = resolve; worklet.port.postMessage({ cmd: "module", bytes: result.wasm.slice().buffer, type: spec.type, knobs: params }); });
    const cost = spec.cost && spec.cost.ops ? `, about ${spec.cost.ops.toLocaleString("en")} ops per block (${Math.max(1, Math.round(100 * spec.cost.ops / spec.cost.limit))} % of the limit)` : "";
    setStatus(`${spec.name}: ${result.wasm.length} bytes, compiled in ${result.ms.toFixed(0)} ms${cost}${result.specs.length > 1 ? `, showing the first of ${result.specs.length} modules` : ""}`, "ok");
  } catch (e) {
    setStatus(String(e && e.message || e), "bad");
  } finally { busy = false; ui.compile.disabled = false; }
}

// ---- start ---------------------------------------------------------------------------------------------------------------------------------
ui.compile.addEventListener("click", run);
ui.signal.addEventListener("change", () => node && node.port.postMessage({ cmd: "signal", value: ui.signal.value }));
ui.volume.addEventListener("input", () => node && node.port.postMessage({ cmd: "volume", value: Number(ui.volume.value) }));

const examples = await loadExamples();
for (const ex of examples) ui.example.append(new Option(ex.name, ex.id));
ui.example.append(new Option("Your code", "mine"));
ui.example.addEventListener("change", () => {
  const ex = examples.find((e) => e.id === ui.example.value);
  if (ex) { ui.source.value = ex.source; ui.source.dispatchEvent(new Event("input")); showProblems([]); }
});
const saved = store.get(STORE);
if (saved) { ui.source.value = saved; ui.example.value = "mine"; } else ui.source.value = examples[0].source;
drawGutter();
const ms = await loadCompiler();
setStatus(`compiler ready (${ms.toFixed(0)} ms)`);
ui.compile.disabled = false;
window.__playground = { compile, run, ui };
