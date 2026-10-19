// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-code.js — the Code node: a module written in Bleep Script (doc/specs/bleep-script.md). Each Code node carries its own
// source and its own interface:
//
//   node.code = { source, interface }      interface: the node type description the compiler generated (jacks, knobs, probes)
//
// The board reads a Code node's jacks and knobs from node.code.interface (BleepCode.uiSpec, used by typeOf in board-model.js), so a
// saved patch shows its cables and knobs at once; the compiler is loaded only when a Code node is edited or has to run.
// The engine gets the compiled module under a type of its own for that node and source: "code:<node id>:<source hash>" (BleepWeb.registerCode, bleep-web.js).
//
//   BleepCode.type          the generic "Code" node type, added to the Add-module list where a compiler exists
//   BleepCode.available()   Promise<bool>: is the compiler bundle there
//   BleepCode.uiSpec(node)  the node's type description for the UI (type "code")
//   BleepCode.sync(board)   compile and register the board's Code nodes the engine does not have yet (never throws)
//   BleepCode.keyOf(node)   changes when the node's interface changes (the view is rebuilt then)
(function () {
  "use strict";
  const P = typeof window !== "undefined" ? window : globalThis;

  const TYPE = {
    type: "code", name: "Code", category: "Utility/Script", colour: "#94a3b8",
    description: "A module written in code (Bleep Script): its jacks, knobs and sound come from the source. Open it to edit and compile.",
    port: "", creatable: true, standaloneOnly: false, params: [], inputs: [], outputs: [],
  };

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
        if (P.console) console.warn("Bleep Script compiler:", e.message || "failed to load");
      };
    }
    return new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); worker.postMessage({ id, ...message }); });
  }
  let initLoad = null;
  /// { compile(source, { typeId }), examples } once the worker has loaded the bundle.
  const compiler = () => {
    if (!initLoad) initLoad = ask({ cmd: "init" }).then((r) => ({
      examples: r.examples,
      compile: (source, options = {}) => ask({ cmd: "compile", source, typeId: options.typeId }).then((m) => m.result),
    }), (e) => { initLoad = null; throw e; });
    return initLoad;
  };
  const available = () => fetch("bleep-script-compiler.js", { method: "HEAD" }).then((r) => r.ok, () => false);

  // ---- compiled sources: hash -> result (only successes), and what the engine has -----------------------------------------------
  const built = new Map();        // source hash -> { wasm, interface }
  const registered = new Map();   // node id -> source hash the engine runs
  const pending = new Map();      // source hash -> Promise

  /// Compiles a source. { ok, interface, wasm, problems, ms }. The same source is compiled once.
  async function compile(source) {
    const key = hashOf(source);
    if (built.has(key)) return { ok: true, ...built.get(key), problems: [], ms: 0 };
    const { compile: run } = await compiler();
    const r = await run(source, { typeId: "code" });
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

  /// Hands a compiled node to the engine, where there is one that runs modules (the web build).
  function register(node, result) {
    const key = hashOf(node.code ? node.code.source : "");
    registered.set(node.id, key);
    if (P.BleepWeb && P.BleepWeb.registerCode) P.BleepWeb.registerCode(node.id, engineSpec(node.id, result.interface, key), result.wasm);
  }

  // ---- what the board asks -----------------------------------------------------------------------------------------------------------------
  const specs = new WeakMap();   // node.code.interface -> its UI description (the same object each time: typeOf is called a lot)
  function uiSpec(node) {
    const iface = node && node.code && node.code.interface;
    if (!iface) return TYPE;
    let spec = specs.get(iface);
    if (!spec) {
      spec = { ...iface, type: "code", name: "Code", category: TYPE.category, creatable: true, standaloneOnly: false, port: "" };
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
      if (n.type !== "code" || !n.code || !n.code.source) continue;
      const key = hashOf(n.code.source);
      if (registered.get(n.id) === key) continue;
      registered.set(n.id, key);   // claimed: a second board message must not start another compile
      const id = n.id, node = { id, code: { source: n.code.source } };
      if (!pending.has(key)) pending.set(key, compile(n.code.source).finally(() => pending.delete(key)));
      pending.get(key).then((r) => {
        if (r.ok) register(node, r);
        else { registered.delete(id); if (P.console) console.warn(`Code node ${id}: ${r.problems.filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`); }
      }, (e) => { registered.delete(id); if (P.console) console.warn(`Code node ${id}: the compiler could not be loaded: ${e.message}`); });
    }
  }

  // ---- the view of a Code node ---------------------------------------------------------------------------------------------------------------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function build(view, root) {
    const node = view.node;
    const ui = {
      bar: root.querySelector(".bc-bar"), compile: root.querySelector(".bc-compile"), examples: root.querySelector(".bc-examples"),
      status: root.querySelector(".bc-status"), gutter: root.querySelector(".bc-gutter"), source: root.querySelector(".bc-source"),
      problems: root.querySelector(".bc-problems"), probes: root.querySelector(".bc-probes"),
    };
    const setStatus = (text, cls = "") => { ui.status.textContent = text; ui.status.className = "bc-status " + cls; };
    let examples = [];

    const drawGutter = (errorLines = new Set()) => {
      const n = ui.source.value.split("\n").length;
      ui.gutter.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const line = el("span", errorLines.has(i + 1) ? "err" : "", String(i + 1));
        return line;
      }));
      ui.gutter.scrollTop = ui.source.scrollTop;
    };
    const jump = (line) => {
      const lines = ui.source.value.split("\n");
      let start = 0;
      for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
      ui.source.focus();
      ui.source.setSelectionRange(start, start + (lines[line - 1] || "").length);
      ui.source.scrollTop = Math.max(0, (line - 4) * 18);
    };
    const showProblems = (problems) => {
      ui.problems.replaceChildren(...problems.map((p) => {
        const li = el("li", p.severity);
        li.append(el("span", "where", p.line ? `${p.line}${p.column ? ":" + p.column : ""}` : p.file || ""), el("span", "", p.message));
        if (p.line) li.addEventListener("click", () => jump(p.line));
        return li;
      }));
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
        const source = ui.source.value;
        const r = await compile(source);
        showProblems(r.problems);
        if (!r.ok) {
          const errors = r.problems.filter((p) => p.severity === "error").length;
          setStatus(`${errors} error${errors === 1 ? "" : "s"}; the previous version keeps running`, "bad");
          return;
        }
        register({ id: view.node.id, code: { source } }, r);
        view.api.setNodeProperty("code", { source, interface: r.interface });
        setStatus(`${r.interface.name}: ${r.wasm.length} bytes, compiled in ${r.ms} ms`, "ok");
      } catch (e) {
        setStatus(`the compiler could not run: ${e.message}`, "bad");
      } finally { busy = false; ui.compile.disabled = false; }
    }
    ui.compile.addEventListener("click", run);

    ui.compile.disabled = true;
    ui.source.value = node.code && node.code.source != null ? node.code.source : "";
    drawGutter();
    compiler().then((c) => {
      examples = c.examples;
      for (const ex of examples) ui.examples.append(new Option(ex.name, ex.id));
      if (!ui.source.value) ui.source.value = examples.find((e) => e.id === "fold").source;
      drawGutter();
      ui.compile.disabled = false;
      setStatus(node.code && node.code.interface ? `${node.code.interface.name}: compiled` : "not compiled yet");
    }, () => {
      setStatus("The compiler is not part of this build.", "bad");
      ui.examples.hidden = true;
    });
    ui.examples.addEventListener("change", () => {
      const ex = examples.find((e) => e.id === ui.examples.value);
      if (!ex) return;
      ui.source.value = ex.source; drawGutter(); showProblems([]);
      ui.examples.value = "";
    });
    view.code = { ui, key: keyOf(node), showProbes: (st) => showProbes(view, ui, st) };
    view.codeKey = keyOf(node);
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

  P.BleepCode = { type: TYPE, available, uiSpec, keyOf, sync, compile, hashOf };

  if (P.BleepViews) P.BleepViews.register("code", {
    top: true,
    width: 900,
    template: `<div class="bv-panel bc">
      <h2>Code</h2>
      <div class="bc-bar"><button class="bc-compile" title="Compile (Ctrl/Cmd+Enter)">Compile</button>
        <select class="bc-examples" aria-label="Load an example"><option value="">Examples…</option></select><span class="bc-status"></span></div>
      <div class="bc-editor"><pre class="bc-gutter" aria-hidden="true"></pre><textarea class="bc-source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Source code"></textarea></div>
      <ul class="bc-problems" aria-label="Problems"></ul>
      <div class="bc-probes" hidden></div>
    </div>`,
    afterBuild(view, customEl) { build(view, customEl); },
    onState(st, view) { if (view.code) view.code.showProbes(st); },
  });
})();
