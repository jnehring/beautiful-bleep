// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-code.js — the Code node: a module written in Bleep Script (doc/specs/bleep-script.md). Each Code node carries its own
// source and its own interface:
//
//   node.code = { source, interface, settings }   interface: the node type description the compiler generated (jacks, knobs, probes);
//                                                  settings: { CHANNELS: 8 } the values chosen for the settings the source declares
//
// The board reads a Code node's jacks and knobs from node.code.interface (BleepCode.uiSpec, used by typeOf in board-model.js), so a
// saved patch shows its cables and knobs at once; the compiler is loaded only when a Code node is edited or has to run.
// The engine gets the compiled module under a type of its own for that node and source: "code:<node id>:<source hash>" (BleepWeb.registerCode, bleep-web.js).
//
// A Code node holds one of two kinds of script. A module script (it has @module) compiles to a module that runs in the engine. A patch
// script (it ends with export default cell(...)) runs once, in a sandbox, and builds a cell of modules and cables on the board:
// node.code.interface.kind is "patch", and the cell it made is marked generatedBy the node.
//
//   BleepCode.setHost(h)    where the native engine is the one that runs modules: h.registerCode(nodeId, code, wasm) (board.js)
//   BleepCode.type          the generic "Code" node type, added to the Add-module list where a compiler exists
//   BleepCode.available()   Promise<bool>: is the compiler bundle there
//   BleepCode.uiSpec(node)  the node's type description for the UI (type "code")
//   BleepCode.sync(board)   compile and register the board's Code nodes the engine does not have yet (never throws)
//   BleepCode.keyOf(node)   changes when the node's interface changes (the view is rebuilt then)
(function () {
  "use strict";
  // The module views are third-party scripts in this page: what is privileged lives in the board's private namespace (bleep-bridge.js),
  // not on `window`. G is the page itself, for what is public anyway.
  const G = typeof window !== "undefined" ? window : globalThis;
  const P = (G.BleepSeal && G.BleepSeal.priv) || G;

  const TYPE = {
    type: "code", name: "Code", category: "Utility/Script", colour: "#94a3b8",
    description: "A module written in code (Bleep Script): its jacks, knobs and sound come from the source. Open it to edit and compile.",
    port: "", creatable: true, standaloneOnly: false, params: [], inputs: [], outputs: [],
  };

  /// A source with the values of its settings: what one compile is of.
  const keyFor = (source, settings) => hashOf(source + "\u0000" + JSON.stringify(Object.keys(settings || {}).sort().map((k) => [k, settings[k]])));
  const hashOf = (text) => {   // FNV-1a: only to tell sources apart
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + ":" + text.length;
  };

  // ---- the compiler: a Worker that loads the bundle (patch/script, npm run bundle) on first use --------------------------------------
  let worker = null, nextId = 1;
  const waiting = new Map();
  function ask(message) {
    if (!worker) {
      worker = new Worker(new URL("board-code-worker.js", document.baseURI).href, { type: "module" });
      worker.onmessage = ({ data }) => {
        const w = waiting.get(data.id);
        if (!w) return;
        waiting.delete(data.id);
        if (data.error) w.reject(new Error(data.error)); else w.resolve(data);
      };
      worker.onerror = (e) => {   // the bundle is missing or does not load: every waiting request fails
        const err = new Error("the compiler could not be loaded");
        for (const w of waiting.values()) w.reject(err);
        waiting.clear();
        worker.terminate();
        worker = null;
        if (G.console) console.warn("Bleep Script compiler:", e.message || "failed to load");
      };
    }
    return new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); worker.postMessage({ id, ...message }); });
  }
  let initLoad = null;
  const compilerAsk = async () => { await compiler(); return { ask }; };
  let editorLoad = null;
  /// { createEditor } (patch/script/editor), loaded in the page on first use; rejects when the build has no editor bundle.
  const editorBundle = () => {
    if (!editorLoad) editorLoad = import(new URL("bleep-script-editor.js", document.baseURI).href);
    return editorLoad;
  };
  /// { compile(source, { typeId }), examples } once the worker has loaded the bundle.
  const compiler = () => {
    if (!initLoad) initLoad = ask({ cmd: "init" }).then((r) => ({
      examples: r.examples,
      compile: (source, options = {}) => ask({ cmd: "compile", source, typeId: options.typeId, constants: options.constants }).then((m) => m.result),
    }), (e) => { initLoad = null; throw e; });
    return initLoad;
  };
  const available = () => fetch("bleep-script-compiler.js", { method: "HEAD" }).then((r) => r.ok, () => false);

  // ---- compiled sources: hash -> result (only successes), and what the engine has -----------------------------------------------
  const built = new Map();        // source hash -> { wasm, interface }
  const registered = new Map();   // node id -> source hash the engine runs
  const pending = new Map();      // source hash -> Promise

  /// Compiles a source. { ok, interface, wasm, problems, ms }. The same source is compiled once.
  async function compile(source, settings = {}) {
    const key = keyFor(source, settings);
    if (built.has(key)) return { ok: true, ...built.get(key), problems: [], ms: 0 };
    const { compile: run } = await compiler();
    const r = await run(source, { typeId: "code", constants: settings });
    if (!r.wasm || !r.specs.length) {
      if (!r.problems.some((p) => p.severity === "error")) r.problems.push({ severity: "error", message: "no @module class found", line: null, column: null });
      return { ok: false, problems: r.problems, ms: r.ms };
    }
    const value = { wasm: r.wasm, interface: r.specs[0] };
    built.set(key, value);
    return { ok: true, ...value, problems: r.problems, ms: r.ms };
  }

  /// The engine's copy of a node's description: a type of its own, which changes with the source (the engine keeps a node's running
  /// module as long as its type id stays the same).
  const engineSpec = (id, iface, key) => ({ ...iface, type: "code:" + id + ":" + key });

  // The engine that runs a Code node's module: the web build's (BleepWeb.registerCode) or, in the app and the plugins, the native engine over
  // the bridge (setHost, from board.js): registerCode(nodeId, code, wasm) -> Promise<{ ok } | { error }>.
  let host = null;
  const setHost = (h) => { host = h; };

  /// Hands a compiled node to the engine. Resolves when the engine has it (the web engine takes it at once); rejects if the engine refuses it.
  async function register(node, result) {
    const key = keyFor(node.code ? node.code.source : "", node.code && node.code.settings);
    registered.set(node.id, key);
    if (G.BleepWeb && G.BleepWeb.registerCode) G.BleepWeb.registerCode(node.id, engineSpec(node.id, result.interface, key), result.wasm);
    else if (host) {
      const code = { source: node.code.source, interface: result.interface, settings: node.code.settings || {} };
      const r = await host.registerCode(node.id, code, result.wasm);
      if (r && r.error) { registered.delete(node.id); throw new Error(r.error); }
    }
  }

  // ---- what the board asks -----------------------------------------------------------------------------------------------------------------
  const specs = new WeakMap();   // node.code.interface -> its UI description (the same object each time: typeOf is called a lot)
  function uiSpec(node) {
    const iface = node && node.code && node.code.interface;
    if (!iface) return TYPE;
    let spec = specs.get(iface);
    if (!spec) {
      spec = iface.kind === "patch"
        ? { ...TYPE, description: iface.description || "A patch script: it builds the cell next to this node." }   // no jacks or knobs: the cell it built has them
        : { ...iface, type: "code", name: "Code", category: TYPE.category, creatable: true, standaloneOnly: false, port: "" };
      specs.set(iface, spec);
    }
    return spec;
  }
  const keyOf = (node) => (node && node.code && node.code.interface ? JSON.stringify(node.code.interface) : "");

  /// A board arrived (BleepWeb.setBoard): make sure every Code node with source runs. Compilation is asynchronous and the engine is
  /// told as each one finishes; a source that does not compile leaves its node silent.
  function sync(board) {
    if (!board || !board.nodes) return;
    for (const n of board.nodes) {
      if (n.type !== "code" || !n.code || !n.code.source || isPatch(n.code.source) || (n.code.interface && n.code.interface.kind === "patch")) continue;
      const key = keyFor(n.code.source, n.code.settings);
      if (registered.get(n.id) === key) continue;
      registered.set(n.id, key);   // claimed: a second board message must not start another compile
      const id = n.id, node = { id, code: { source: n.code.source, settings: n.code.settings } };
      if (!pending.has(key)) pending.set(key, compile(n.code.source, n.code.settings).finally(() => pending.delete(key)));
      pending.get(key).then((r) => {
        if (r.ok) register(node, r).catch((e) => { registered.delete(id); if (G.console) console.warn(`Code node ${id}: the engine refused the module: ${e.message}`); });
        else { registered.delete(id); if (G.console) console.warn(`Code node ${id}: ${r.problems.filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`); }
      }, (e) => { registered.delete(id); if (G.console) console.warn(`Code node ${id}: the compiler could not be loaded: ${e.message}`); });
    }
  }

  // ---- the view of a Code node ---------------------------------------------------------------------------------------------------------------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function build(view, root) {
    const node = view.node;
    const ui = {
      bar: root.querySelector(".bc-bar"), compile: root.querySelector(".bc-compile"), examples: root.querySelector(".bc-examples"),
      status: root.querySelector(".bc-status"), gutter: root.querySelector(".bc-gutter"), source: root.querySelector(".bc-source"),
      problems: root.querySelector(".bc-problems"), probes: root.querySelector(".bc-probes"), settings: root.querySelector(".bc-settings"),
    };
    // the settings the source declares (a count, such as the number of channels): changing one compiles again
    const settingValues = { ...((node.code && node.code.settings) || {}) };
    const declared = (node.code && node.code.interface && node.code.interface.settings) || [];
    ui.settings.hidden = !declared.length;
    for (const s of declared) {
      const label = el("label", "bc-setting", s.name), input = el("input");
      input.type = "number"; input.min = s.min; input.max = s.max; input.step = 1; input.value = settingValues[s.id] ?? s.value ?? s.init;
      input.setAttribute("aria-label", s.name);
      input.addEventListener("keydown", (e) => e.stopPropagation());
      input.addEventListener("change", () => {
        const v = Math.max(s.min, Math.min(s.max, Math.round(Number(input.value) || s.init)));
        input.value = v; settingValues[s.id] = v; run();
      });
      label.append(input);
      ui.settings.append(label);
    }
    const setStatus = (text, cls = "") => { ui.status.textContent = text; ui.status.className = "bc-status " + cls; };
    let examples = [];

    // The source is in a CodeMirror editor once its bundle has loaded (bleep-script-editor.js); until then, and where it is missing,
    // a plain textarea with a line-number gutter does the same job.
    let ed = null;
    const getSource = () => (ed ? ed.getValue() : ui.source.value);
    const setSource = (text) => { if (ed) ed.setValue(text); else { ui.source.value = text; drawGutter(); } };
    const drawGutter = (errorLines = new Set()) => {
      if (ed) return;
      const n = ui.source.value.split("\n").length;
      ui.gutter.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const line = el("span", errorLines.has(i + 1) ? "err" : "", String(i + 1));
        return line;
      }));
      ui.gutter.scrollTop = ui.source.scrollTop;
    };
    const jump = (line) => {
      if (ed) return ed.jump(line);
      const lines = ui.source.value.split("\n");
      let start = 0;
      for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
      ui.source.focus();
      ui.source.setSelectionRange(start, start + (lines[line - 1] || "").length);
      ui.source.scrollTop = Math.max(0, (line - 4) * 18);
    };
    const MAX_SHOWN = 30;   // a script with many mistakes lists the first ones
    const showProblems = (problems) => {
      const hidden = Math.max(0, problems.length - MAX_SHOWN);
      ui.problems.replaceChildren(...problems.slice(0, MAX_SHOWN).map((p) => {
        const li = el("li", p.severity);
        li.append(el("span", "where", p.line ? `${p.line}${p.column ? ":" + p.column : ""}` : p.file || ""), el("span", "", p.message));
        if (p.line) li.addEventListener("click", () => jump(p.line));
        return li;
      }), ...(hidden ? [el("li", "warning", `… and ${hidden} more`)] : []));
      if (ed) ed.setProblems(problems);
      drawGutter(new Set(problems.filter((p) => p.severity === "error" && p.line).map((p) => p.line)));
    };

    // the editor
    ui.source.addEventListener("input", () => drawGutter());
    ui.source.addEventListener("scroll", () => { ui.gutter.scrollTop = ui.source.scrollTop; });
    ui.source.addEventListener("keydown", (e) => {
      e.stopPropagation();   // typing is not for the board's shortcuts or the computer keyboard's notes
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: t, value } = ui.source;
        ui.source.value = value.slice(0, s) + "  " + value.slice(t);
        ui.source.selectionStart = ui.source.selectionEnd = s + 2;
        drawGutter();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
    });
    ui.source.addEventListener("keyup", (e) => e.stopPropagation());

    // compile: the source and the interface it declares are saved on the node in one step; the board then rebuilds this view
    let busy = false;
    async function run() {
      if (busy) return;
      busy = true; ui.compile.disabled = true;
      try {
        setStatus("compiling…");
        const source = getSource();
        if (isPatch(source)) { await runPatch(source); return; }
        const r = await compile(source, settingValues);
        showProblems(r.problems);
        if (!r.ok) {
          const errors = r.problems.filter((p) => p.severity === "error").length;
          setStatus(`${errors} error${errors === 1 ? "" : "s"}; the previous version keeps running`, "bad");
          return;
        }
        const settings = Object.fromEntries((r.interface.settings || []).map((s) => [s.id, s.value]));
        try { await register({ id: view.node.id, code: { source, settings } }, r); }
        catch (e) { showProblems([{ severity: "error", message: `the engine refused the module: ${e.message}`, line: null, column: null }]); setStatus("the engine refused the module; the previous version keeps running", "bad"); return; }
        view.api.setNodeProperty("code", { source, interface: r.interface, settings });
        setStatus(`${r.interface.name}: ${r.wasm.length} bytes, compiled in ${r.ms} ms${costText(r.interface)}`, "ok");
      } catch (e) {
        setStatus(`the compiler could not run: ${e.message}`, "bad");
      } finally { busy = false; ui.compile.disabled = false; }
    }
    /// A patch script: run it in the sandbox, build the cell, and put it on the board next to this node.
    async function runPatch(source) {
      const r = await compilePatch(source, settingValues, view.api.types(), view.node.id);
      showProblems(r.problems);
      if (!r.ok) { setStatus(`${r.problems.filter((p) => p.severity === "error").length} error(s); the cell stays as it was`, "bad"); return; }
      const settings = Object.fromEntries((r.interface.settings || []).map((s) => [s.id, s.value]));
      view.api.applyGenerated({ source, interface: r.interface, settings }, r);
      setStatus(`${r.interface.name}: ${r.interface.summary.modules} modules and ${r.interface.summary.cables} cables made`, "ok");
    }
    ui.compile.addEventListener("click", run);

    ui.compile.disabled = true;
    ui.source.value = node.code && node.code.source != null ? node.code.source : "";
    drawGutter();
    editorBundle().then(({ createEditor }) => {
      const mount = root.querySelector(".bc-editor");
      ed = createEditor({ parent: mount, doc: ui.source.value, onRun: () => run() });
      ui.source.hidden = true; ui.gutter.hidden = true;
      mount.classList.add("cm");
    }, () => { /* no editor bundle in this build: the textarea stays */ });
    compiler().then((c) => {
      examples = c.examples;
      for (const ex of examples) ui.examples.append(new Option(ex.name, ex.id));
      if (!getSource()) setSource(examples.find((e) => e.id === "fold").source);
      ui.compile.disabled = false;
      const saved = node.code && node.code.interface;
      setStatus(!saved ? "not compiled yet" : saved.kind === "patch" ? `${saved.name}: ${saved.summary.modules} modules and ${saved.summary.cables} cables made` : `${saved.name}: compiled${costText(saved)}`);
    }, () => {
      setStatus("The compiler is not part of this build.", "bad");
      ui.examples.hidden = true;
    });
    ui.examples.addEventListener("change", () => {
      const ex = examples.find((e) => e.id === ui.examples.value);
      if (!ex) return;
      setSource(ex.source); showProblems([]);
      ui.examples.value = "";
    });
    view.code = { ui, key: keyOf(node), showProbes: (st) => showProbes(view, ui, st) };
    view.codeKey = keyOf(node);
  }

  /// " · about 3,000 ops per block (1 % of the limit)": the checker's estimate of the work in 32 samples (subset.mjs)
  function costText(iface) {
    const c = iface && iface.cost;
    if (!c || !c.ops) return "";
    return ` · about ${c.ops.toLocaleString("en")} ops per block (${Math.max(1, Math.round((100 * c.ops) / c.limit))} % of the limit)`;
  }

  const probeRows = new WeakMap();
  function showProbes(view, ui, st) {
    const probes = (view.node.code && view.node.code.interface && view.node.code.interface.probes) || [];
    if (!probes.length) { ui.probes.hidden = true; return; }
    ui.probes.hidden = false;
    let rows = probeRows.get(view);
    if (!rows) {
      rows = new Map();
      for (const p of probes) {
        const row = el("div", "bc-probe"), bar = el("span", "bar"), fill = el("i"), out = el("output");
        bar.append(fill);
        row.append(el("span", "name", p.name), bar, out);
        ui.probes.append(row);
        rows.set(p.id, { fill, out });
      }
      probeRows.set(view, rows);
    }
    for (const [id, r] of rows) {
      const v = Number(st[id]);
      if (!Number.isFinite(v)) continue;
      r.fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
      r.out.textContent = v.toFixed(3);
    }
  }

  // ---- patch scripts (layer 1) ---------------------------------------------------------------------------------------------------------------
  /// A patch script builds a cell with cell(...); a module script has @module. (Decided from the text: the compiler is not needed for it.)
  const isPatch = (source) => !/@module\b/.test(source) && /\bcell\s*\(/.test(source);

  /// The module types as the script runner needs them: ids, jacks, and knobs with their ranges and mappings.
  function slimTypes(types) {
    const out = {};
    for (const [id, t] of Object.entries(types || {})) {
      out[id] = { type: t.type, name: t.name, creatable: t.creatable, port: t.port || "",
        params: (t.params || []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, min: p.min, max: p.max, map: p.map, centre: p.centre, choices: p.choices, modulatable: p.modulatable })),
        inputs: (t.inputs || []).map((j) => ({ id: j.id, type: j.type })), outputs: (t.outputs || []).map((j) => ({ id: j.id, type: j.type })) };
    }
    return out;
  }

  /// Runs a patch script and builds its cell. { ok, problems, nodes, cables, interface } (the nodes and cables of materialize.mjs).
  async function compilePatch(source, settings, types, codeId) {
    const { ask } = await compilerAsk();
    const r = await ask({ cmd: "patch", source, settings: settings || {}, types: slimTypes(types), options: { cellId: "gen-" + codeId, parent: "", x: 0, y: 0, generatedBy: codeId } });
    return r.result;
  }

  /// Puts what a patch script built on the board, in place of what it built before: removes the generated nodes and the cables inside them,
  /// adds the new ones, keeps the cables that arrive at the cell's own jacks from outside if the jack is still there, and saves `code` on the
  /// Code node. For board.edit(): true if it changed the board, false if the Code node is gone.
  function applyGenerated(b, codeId, code, result) {
    const node = b.nodes.find((n) => n.id === codeId);
    if (!node) return false;
    const old = new Set(b.nodes.filter((n) => n.generatedBy === codeId).map((n) => n.id));
    const cell = result.nodes[0];
    const oldCell = b.nodes.find((n) => n.id === cell.id);
    const fits = (c) => {
      const fromCell = c.from.node === cell.id, toCell = c.to.node === cell.id;
      if (fromCell === toCell) return false;
      const other = fromCell ? c.to.node : c.from.node;
      if (old.has(other)) return false;
      return (fromCell ? cell.outputs : cell.inputs).some((j) => j.id === (fromCell ? c.from.jack : c.to.jack));
    };
    const kept = new Set(b.cables.filter(fits).map((c) => c.id));
    b.cables = b.cables.filter((c) => kept.has(c.id) || !(old.has(c.from.node) || old.has(c.to.node)));
    b.nodes = b.nodes.filter((n) => !old.has(n.id));
    const previous = node.code && node.code.interface && node.code.interface.name;
    const placed = { ...cell, x: oldCell ? oldCell.x : node.x + 240, y: oldCell ? oldCell.y : node.y, parent: oldCell ? oldCell.parent : node.parent || "",
      name: oldCell && oldCell.name !== previous ? oldCell.name : cell.name };   // a name the user gave the cell stays
    if (oldCell && oldCell.muted) placed.muted = true;
    b.nodes.push(placed, ...result.nodes.slice(1));
    b.cables.push(...result.cables);
    node.code = code;
    return true;
  }

  P.BleepCode = { type: TYPE, available, uiSpec, keyOf, sync, compile, compilePatch, applyGenerated, isPatch, hashOf, setHost };

  if (G.BleepViews) G.BleepViews.register("code", {
    top: true,
    width: 900,
    template: `<div class="bv-panel bc">
      <h2>Code</h2>
      <div class="bc-bar"><button class="bc-compile" title="Compile (Ctrl/Cmd+Enter)">Compile</button>
        <select class="bc-examples" aria-label="Load an example"><option value="">Examples…</option></select><span class="bc-status"></span></div>
      <div class="bc-settings" hidden></div>
      <div class="bc-editor"><pre class="bc-gutter" aria-hidden="true"></pre><textarea class="bc-source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Source code"></textarea></div>
      <ul class="bc-problems" aria-label="Problems"></ul>
      <div class="bc-probes" hidden></div>
    </div>`,
    afterBuild(view, customEl) { build(view, customEl); },
    onState(st, view) { if (view.code) view.code.showProbes(st); },
  });
})();
