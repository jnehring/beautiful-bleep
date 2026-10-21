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
  /// A node that is no longer a Code node (it became a module): the engine's copy of its code module goes with it, so forget it was registered.
  const forgetNode = (id) => { registered.delete(id); };

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


  // ---- a Code node's own UI: JavaScript in a sandboxed frame (board-code-view.html) --------------------------------------------------------
  // The code can only compute and draw, and talk to the board through the messages below; it never touches the board, storage or the network.
  // The frame runs the UI in a worker that the page stops when it hangs, so a UI that came with a patch runs without asking.

  /// The sandboxed frame that runs a module's own UI (board-code-view.html) and the messages between it and the board.
  ///   sandboxUi(view, root, mount, source, spec, report, probes)  -> { onState(st, probeIds), stop() }
  ///     view    the BleepView of the node (its knob values and api); root: the view's element (the UI takes its colours from it)
  ///     mount   the element the frame goes into;  source: the UI's JavaScript;  spec: the node type description (params, buttons)
  ///     report  (message, line) for an error in the UI's code;  probes: an object the latest probe values are kept in
  function sandboxUi(view, root, mount, source, spec, report, probes) {
    const params = spec.params || [], buttons = (spec.buttons || []).map((b) => b.id);
    const themeOf = () => {
      const css = getComputedStyle(root), v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      return { bg: v("--canvas", "#111317"), panel: v("--panel-2", "#252932"), line: v("--line", "#333845"), text: v("--text", "#e7e9ee"), muted: v("--muted", "#8b92a3"), accent: v("--accent", "#4fd1c5"), warn: v("--warn", "#ff7a6b") };
    };
    const values = () => Object.fromEntries(params.map((p) => [p.id, view.node.params[p.id] ?? p.default]));
    const slim = () => params.map((p) => ({ id: p.id, name: p.name, kind: p.kind, min: p.min, max: p.max, map: p.map, centre: p.centre, choices: p.choices, steps: p.steps, label: p.label, default: p.default }));

    let ready = false, lastSent = 0, lastSet = 0, setCount = 0, setWindow = 0;
    const f = document.createElement("iframe");
    f.className = "bc-frame";
    f.title = "The module's own UI";
    f.setAttribute("sandbox", "allow-scripts");   // without the same-origin flag: an opaque origin, so no storage, no cookies, no parent access
    f.style.height = "160px";
    mount.hidden = false;
    mount.append(f);
    const send = (m) => { if (f.contentWindow) f.contentWindow.postMessage(m, "*"); };
    const onMessage = (e) => {
      if (!f.isConnected) { window.removeEventListener("message", onMessage); return; }
      if (e.source !== f.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== "object") return;
      const now = Date.now();
      switch (m.t) {
        case "hello": send({ t: "init", source, params: slim(), values: values(), probes, theme: themeOf() }); break;
        case "ready": ready = true; break;
        case "error": report(String(m.message || "error").slice(0, 300), Number.isInteger(m.line) ? m.line : null); break;
        case "size": if (Number.isFinite(m.h)) f.style.height = `${Math.max(40, Math.min(800, Math.round(m.h)))}px`; break;
        case "fill": mount.classList.add("fills"); break;   // a UI with a canvas("fill") follows its window; the others keep their height
        case "command": if (buttons.includes(m.id)) view.api.command(m.id, 1); break;
        case "set": {
          if (now - setWindow > 1000) { setWindow = now; setCount = 0; }
          if (++setCount > 240) break;   // a runaway loop cannot flood the engine
          const p = params.find((q) => q.id === m.id);
          if (!p) break;
          let x = Number.isFinite(m.x) ? m.x : Number.isFinite(m.units) && P.BleepCodeWidgets ? P.BleepCodeWidgets.fromUnits(p, m.units) : null;
          if (x === null) break;
          x = Math.max(0, Math.min(1, x));
          if (p.steps > 1) x = Math.round(x * (p.steps - 1)) / (p.steps - 1);
          if (now - lastSet > 400 && view.api.beginGesture) view.api.beginGesture();   // one undo step per movement
          lastSet = now;
          view.node.params[p.id] = x;
          view.api.setParam(p.id, x);
          break;
        }
        default: break;
      }
    };
    window.addEventListener("message", onMessage);
    f.src = new URL("board-code-view.html", document.baseURI).href;
    return {
      /// The engine's state arrives: the UI sees the knob values and the probes, up to 30 times a second.
      onState(st, probeIds) {
        for (const id of probeIds) { const v = Number(st && st[id]); if (Number.isFinite(v)) probes[id] = v; }
        const now = Date.now();
        if (!ready || now - lastSent < 33 || !f.contentWindow) return;
        lastSent = now;
        f.contentWindow.postMessage({ t: "state", values: values(), probes }, "*");
      },
      stop() { window.removeEventListener("message", onMessage); f.remove(); mount.classList.remove("fills"); },
    };
  }

  function customUi(view, root, spec) {
    const $ = (selector) => root.querySelector(selector);
    const tabs = [...root.querySelectorAll(".bc-tab")], panes = [...root.querySelectorAll(".bc-pane")];
    const select = (name) => {
      tabs.forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on)); });
      panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
      if (name === "meta") root.dispatchEvent(new CustomEvent("bc-meta-shown"));
    };
    tabs.forEach((t) => t.addEventListener("click", () => select(t.dataset.tab)));
    const mount = $(".bc-custom"), runButton = $(".bc-ui-run"), stopButton = $(".bc-ui-stop"), area = $(".bc-ui-source"), problems = $(".bc-ui-problems");

    // the UI's source: CodeMirror when its bundle is there, a text box until then
    let ed = null;
    const getView = () => (ed ? ed.getValue() : area.value);
    const setView = (text) => { if (ed) ed.setValue(text); else area.value = text; };
    area.value = (view.node.code && view.node.code.view) || "";
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const { selectionStart: s, selectionEnd: t, value } = area; area.value = value.slice(0, s) + "  " + value.slice(t); area.selectionStart = area.selectionEnd = s + 2; }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start(); }
    });
    area.addEventListener("keyup", (e) => e.stopPropagation());
    editorBundle().then(({ createEditor }) => {
      ed = createEditor({ parent: $(".bc-ui-editor"), doc: area.value, onRun: () => start() });
      area.hidden = true;
    }, () => { /* no editor bundle: the text box stays */ });

    let handle = null;
    const lastProbes = {};   // the latest value of every probe, kept so a UI that starts later sees them at once
    const show = (message, line) => { problems.replaceChildren(el("li", "error", line ? `Line ${line}: ${message}` : message)); };
    function stop() {
      if (handle) handle.stop();
      handle = null;
      mount.replaceChildren();
      mount.hidden = true;
      stopButton.disabled = true;
    }
    function start() {
      const source = getView();
      stop();
      problems.replaceChildren();
      if (!source.trim()) return;
      handle = sandboxUi(view, root, mount, source, spec, show, lastProbes);
      stopButton.disabled = false;
    }
    runButton.addEventListener("click", () => { start(); const code = view.node.code; if (code) view.api.setNodeProperty("code", { ...code, ...(getView().trim() ? { view: getView() } : {}) }); });
    stopButton.addEventListener("click", stop);

    // The UI runs in a worker inside the sandboxed frame, which is stopped if it hangs (board-code-view.html): a UI that came with a patch
    // needs no approval.
    if (getView().trim()) start();

    return {
      getView, setView, start,
      /// The engine's state arrives: the UI sees the knob values and the probes, up to 30 times a second.
      onState(st, probeIds) {
        for (const id of probeIds) { const v = Number(st && st[id]); if (Number.isFinite(v)) lastProbes[id] = v; }
        if (handle) handle.onState(st, probeIds);
      },
      stop,
    };
  }

  // ---- the module's help page: Markdown written in the Help tab, shown by the ? button of the module's window --------------------------------------
  /// The Markdown of a help page as HTML: the board's renderer (it escapes HTML and checks links), with images left out (a page from someone else's
  /// patch must not make the board fetch anything).
  function renderHelp(markdown) {
    const M = G.BleepMarkdown;
    if (!M) return "<pre></pre>".replace("</pre>", String(markdown).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>");
    return M.render(String(markdown)).replace(/<img\b[^>]*?alt="([^"]*)"[^>]*>/g, "$1").replace(/<img\b[^>]*>/g, "");
  }

  /// A page made from the module's own description (name, text, knobs, jacks) for a module whose author wrote none.
  function stubHelp(spec) {
    const range = (p) => {
      if (p.kind === "bool") return "off / on";
      if (p.kind === "choice") return (p.choices || []).join(", ");
      const unit = p.label ? " " + p.label : "";
      return `${p.min}${unit} to ${p.max}${unit}`;
    };
    const cell = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").replace(/\|/g, "/").trim();
    const lines = [`# ${spec.name || "Module"}`, "", spec.description || "", ""];
    const params = spec.params || [];
    if (params.length) lines.push("## Knobs", "", "| Knob | Range | What it does |", "|---|---|---|", ...params.map((p) => `| **${cell(p.name)}** | ${cell(range(p))} | ${cell(p.description)} |`), "");
    const jacks = (list, title) => list && list.length ? [`## ${title}`, "", ...list.map((j) => `- **${cell(j.name)}** (${cell(j.type)})${j.description ? ": " + cell(j.description) : ""}`), ""] : [];
    lines.push(...jacks(spec.inputs, "Inputs"), ...jacks(spec.outputs, "Outputs"));
    if ((spec.probes || []).length) lines.push("## Meters", "", ...spec.probes.map((p) => `- **${cell(p.name)}**${p.description ? ": " + cell(p.description) : ""}`), "");
    lines.push("*This page was made from the module's description. Its author can write a better one in the Code node's Help tab.*");
    return lines.join("\n");
  }

  function helpUi(view, root) {
    const $ = (selector) => root.querySelector(selector);
    const area = $(".bc-help-source"), shown = $(".bc-help-render"), editor = $(".bc-help-editor"), write = $(".bc-help-write"), preview = $(".bc-help-preview");
    area.value = (view.node.code && view.node.code.help) || "";
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();   // typing is not for the board's shortcuts or the computer keyboard's notes
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const { selectionStart: s, selectionEnd: t, value } = area; area.value = value.slice(0, s) + "  " + value.slice(t); area.selectionStart = area.selectionEnd = s + 2; }
    });
    area.addEventListener("keyup", (e) => e.stopPropagation());
    const save = () => {   // the page is part of the node: saved when the text box is left
      const code = view.node.code;
      if (code && (code.help || "") !== area.value) view.api.setNodeProperty("code", { ...code, help: area.value });
    };
    area.addEventListener("blur", save);
    const mode = (previewing) => {
      write.classList.toggle("on", !previewing); preview.classList.toggle("on", previewing);
      editor.hidden = previewing; shown.hidden = !previewing;
      if (previewing) {
        const spec = (view.node.code && view.node.code.interface) || {};
        shown.innerHTML = renderHelp(area.value.trim() ? area.value : stubHelp(spec));
        shown.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); });
      }
    };
    write.addEventListener("click", () => mode(false));
    preview.addEventListener("click", () => mode(true));
    return { getHelp: () => area.value, setHelp: (text) => { area.value = text; mode(false); } };
  }

  function build(view, root) {
    const node = view.node;
    const ui = {
      bar: root.querySelector(".bc-bar"), compile: root.querySelector(".bc-compile"), convert: root.querySelector(".bc-convert"), share: root.querySelector(".bc-share"),
      status: root.querySelector(".bc-status"), gutter: root.querySelector(".bc-gutter"), source: root.querySelector(".bc-source"),
      problems: root.querySelector(".bc-problems"), probes: root.querySelector(".bc-probes"), settings: root.querySelector(".bc-settings"),
      widgets: root.querySelector(".bc-widgets"),
    };
    // A module that declares a widget layout shows it in place of the automatic knobs, buttons and meters (board-code-widgets.js)
    const iface = node.code && node.code.interface;
    let widgets = null;
    if (iface && iface.layout && P.BleepCodeWidgets) {
      widgets = P.BleepCodeWidgets.build(view, iface.layout, iface, ui.widgets);
      ui.widgets.hidden = false;
      ui.probes.classList.add("covered");   // the layout has its own meters
      for (const e of view.root.querySelectorAll(".bv-controls, .bv-buttons")) e.hidden = true;
    }
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
    const custom = customUi(view, root, iface || {});
    const help = helpUi(view, root);
    const S = P.BleepCodeShare, U = G.BleepUserModules;
    const meta = S ? S.metaUi(view, root) : null;
    let once = false;
    root.addEventListener("bc-meta-shown", () => { if (!once && meta) { once = true; meta.showHandle(); } });
    // the UI's source, the help page and the metadata ride along with every save
    const withView = (code) => ({
      ...code, ...(custom.getView().trim() ? { view: custom.getView() } : {}), ...(help.getHelp().trim() ? { help: help.getHelp() } : {}), ...(meta ? { meta: meta.get() } : {}),
    });
    let examples = [];

    // ---- Convert to module / Share --------------------------------------------------------------------------------------------------------------
    // Convert: the node becomes the module (web/js/user-modules.js keeps it in this browser): same id, cables and knob values, the module's own UI and
    // the Add menu entry; the button on the module's window converts it back. Share: the dialog (board-code-share.js) publishes it in the library.
    const isScript = () => !!(U && S && node.code && node.code.interface && node.code.interface.kind !== "patch" && node.code.interface.name);
    const showButtons = () => { ui.convert.hidden = !isScript(); ui.share.hidden = !isScript(); };
    showButtons();
    async function compileFor(source, typeId, settings) { const { compile: run } = await compiler(); return run(source, { typeId, constants: settings }); }
    async function convertToModule() {
      const i = node.code && node.code.interface;
      if (!isScript() || !node.code.source) { setStatus("Compile the script first.", "bad"); return; }
      setStatus("converting…");
      ui.convert.disabled = true;
      try {
        const m = meta ? meta.get() : {}, settings = { ...settingValues };
        const publisher = U.slugOf(m.publisher) || U.LOCAL, slug = U.slugOf(i.name);
        if (!slug) { setStatus("Give the module a name: @module({ name: … }).", "bad"); return; }
        const type = U.typeId(publisher, slug), key = U.keyOf(publisher, slug);
        const r = await compileFor(node.code.source, type, settings);   // compiled again, for the type id of the module
        if (!r || !r.wasm || !r.specs.length) { setStatus("The module did not compile; nothing was converted.", "bad"); return; }
        await U.put({
          slug: key, type, publisher, name: i.name, category: r.specs[0].category || "Utility/Script", source: node.code.source, view: custom.getView(), help: help.getHelp(),
          meta: { ...(S ? S.defaults(i) : {}), ...m, publisher }, settings, spec: r.specs, wasm: r.wasm.buffer.slice(r.wasm.byteOffset, r.wasm.byteOffset + r.wasm.byteLength),
        });
        if (G.BleepLibrary && G.BleepLibrary.forget) G.BleepLibrary.forget(key);
        forgetNode(node.id);   // the engine is about to lose this node's code module: a later conversion back must register it again
        const name = i.name;
        await view.api.convertNode(type, (n) => { delete n.code; if (!n.name || n.name === "Code") n.name = name; });
      } catch (e) { setStatus(`Could not convert the node: ${e.message}`, "bad"); } finally { ui.convert.disabled = false; }
    }
    function openShare() {
      const i = node.code && node.code.interface;
      if (!isScript() || !node.code.source) { setStatus("Compile the script first.", "bad"); return; }
      const persist = () => { const code = view.node.code; if (code) view.api.setNodeProperty("code", withView({ ...code })); };
      S.shareDialog({
        name: i.name, slug: U.slugOf(i.name), hasUi: !!custom.getView().trim(),
        get: () => ({ source: node.code.source, settings: { ...settingValues }, meta: meta.get(), help: help.getHelp(), view: custom.getView() }),
        save: ({ meta: m, help: h }) => { meta.set(m); help.setHelp(h); persist(); },
        compile: compileFor,
      });
    }
    if (U && S) {
      ui.convert.addEventListener("click", convertToModule);
      ui.share.addEventListener("click", openShare);
    }

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
        view.api.setNodeProperty("code", withView({ source, interface: r.interface, settings }));
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
      view.api.applyGenerated(withView({ source, interface: r.interface, settings }), r);
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
      if (!getSource()) setSource(examples.find((e) => e.id === "fold").source);
      ui.compile.disabled = false;
      const saved = node.code && node.code.interface;
      setStatus(!saved ? "not compiled yet" : saved.kind === "patch" ? `${saved.name}: ${saved.summary.modules} modules and ${saved.summary.cables} cables made` : `${saved.name}: compiled${costText(saved)}`);
    }, () => {
      setStatus("The compiler is not part of this build.", "bad");
    });
    const probeIds = ((iface && iface.probes) || []).map((p) => p.id);
    view.code = { ui, key: keyOf(node), showProbes: (st) => { if (widgets) widgets.update(st); else showProbes(view, ui, st); custom.onState(st, probeIds); }, refreshWidgets: () => widgets && widgets.update(null) };
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

  // ---- the views of the modules saved from a Code node (web/js/user-modules.js) -----------------------------------------------------------
  // An installed module shows what its source declared: the widget layout in place of the automatic knobs, and its own UI above it. The UI is
  // the user's own code (they saved it), so it runs without asking, in the same sandboxed frame as a Code node's.
  const installedTypes = new Map();   // node type -> { entry, spec }

  function buildInstalled(view, root) {
    const rec = installedTypes.get(view.node.type);
    if (!rec) return;
    const { entry, spec } = rec;
    const widgetsEl = root.querySelector(".bc-widgets"), mount = root.querySelector(".bc-custom");
    let widgets = null;
    if (spec.layout && P.BleepCodeWidgets) {
      widgets = P.BleepCodeWidgets.build(view, spec.layout, spec, widgetsEl);
      widgetsEl.hidden = false;
      for (const e of view.root.querySelectorAll(".bv-controls, .bv-buttons")) e.hidden = true;
    }
    const probes = {}, probeIds = (spec.probes || []).map((p) => p.id);
    const ui = entry.view && entry.view.trim()
      ? sandboxUi(view, root, mount, entry.view, spec, (message, line) => { if (G.console) console.warn(`${entry.name}'s UI${line ? ", line " + line : ""}: ${message}`); }, probes)
      : null;
    view.installed = {
      onState(st) { if (widgets) widgets.update(st); if (ui) ui.onState(st, probeIds); },
      refresh() { if (widgets) widgets.update(null); },
    };

    // Convert to code: this node becomes a Code node holding the module's source, UI, help page and metadata; Share: the library dialog
    const U = G.BleepUserModules, S = P.BleepCodeShare;
    const statusEl = root.querySelector(".bc-status"), convert = root.querySelector(".bc-convert"), share = root.querySelector(".bc-share");
    const say = (text, cls = "") => { statusEl.textContent = text; statusEl.className = "bc-status " + cls; };
    say("");
    if (entry.packaged && !entry.source) { root.querySelector(".bc-bar").hidden = true; return; }   // from the library, without its source: nothing to convert or share
    if (entry.packaged) say("The source of this module is open: change it as a Code node, and convert it again to make your own.");
    convert.addEventListener("click", async () => {
      convert.disabled = true;
      try {
        await view.api.convertNode("code", (n) => {
          n.code = { source: entry.source, interface: entry.spec[0], settings: { ...(entry.settings || {}) }, ...(entry.view ? { view: entry.view } : {}),
                     ...(entry.help ? { help: entry.help } : {}),
                     meta: entry.meta || (entry.libraryMeta && S ? { ...S.defaults(entry.spec[0]), publisher: entry.spec[0].type.includes("/") ? U.slugOf(entry.spec[0].type.split("/")[0]) || U.LOCAL : U.LOCAL, version: entry.libraryMeta.version || "1.0.0", shared: entry.libraryMeta.version || undefined,
                       summary: entry.libraryMeta.summary || "", category: entry.libraryMeta.category || "", license: entry.libraryMeta.license || "MIT" } : (S ? S.defaults(entry.spec[0]) : {})) };
          if (n.name === entry.name) n.name = "Code";
        });
      } catch (e) { say(`Could not convert the node: ${e.message}`, "bad"); convert.disabled = false; }
    });
    share.hidden = !(U && S && U.persistent !== undefined) || !!entry.packaged;
    share.addEventListener("click", () => {
      if (!S) return;
      const current = () => installedTypes.get(view.node.type) || rec;
      S.shareDialog({
        name: entry.name, slug: entry.slug.slice(entry.slug.indexOf(".") + 1), hasUi: !!(entry.view && entry.view.trim()),
        get: () => ({ source: current().entry.source, settings: current().entry.settings || {}, meta: current().entry.meta || S.defaults(entry.spec[0]), help: current().entry.help || "", view: current().entry.view || "" }),
        save: ({ meta: m, help: h }) => U.put({ ...current().entry, meta: m, help: h }),
        compile: async (source, typeId, settings) => { const { compile: run } = await compiler(); return run(source, { typeId, constants: settings }); },
      });
    });
  }

  /// Registers the view of every module the user saved (BleepViews.register keeps the first registration of a type, and the hooks look the
  /// module up here, so a module saved again shows its new source). Called when the node types are listed.
  function registerInstalledViews(packaged) {
    const U = G.BleepUserModules;
    if (!G.BleepViews) return;
    // modules from the library that bring their own picture and/or help page (view.sandbox.js, doc/*.md): shown like the user's own, but with no source
    const fromLibrary = (packaged || []).map((m) => ({ slug: m.type, name: m.spec.name, view: m.view || "", help: m.help || "", source: m.source || "", libraryMeta: { ...(m.meta || {}), version: m.version }, spec: [m.spec], packaged: true }));
    for (const entry of [...(U ? U.list() : []), ...fromLibrary]) for (const spec of entry.spec || []) {
      installedTypes.set(spec.type, { entry, spec });
      if (G.BleepViews.get(spec.type)) continue;
      G.BleepViews.register(spec.type, {
        top: true,
        width: 900,
        template: `<div class="bv-panel bc">
          <div class="bc-bar"><div class="bc-actions"><button type="button" class="bc-convert" title="Turn this node back into a Code node with the module's source, to edit it">Convert to code</button>
            <button type="button" class="bc-share" title="Publish the module in the Bleep Library, for everyone" hidden>Share…</button></div><div class="bc-status"></div></div>
          <div class="bc-custom" hidden></div><div class="bc-widgets" hidden></div></div>`,
        afterBuild(view, customEl) { buildInstalled(view, customEl); },
        onState(st, view) { if (view.installed) view.installed.onState(st); },
        onRefresh(view) { if (view.installed) view.installed.refresh(); },
      });
    }
  }

  /// The help page of a node as Markdown, or null where there is none to show: a compiled Code node, or a module saved from one (the page its
  /// author wrote in the Help tab, else one made from the module's description).
  function helpOf(node) {
    if (!node) return null;
    let spec = null, text = "";
    if (node.type === "code") {
      const code = node.code;
      if (!code || !code.interface || code.interface.kind === "patch") return null;
      spec = code.interface; text = code.help || "";
    } else {
      const rec = installedTypes.get(node.type);
      if (!rec) return null;
      spec = rec.spec; text = rec.entry.help || "";
    }
    return text.trim() ? text : stubHelp(spec);
  }

  P.BleepCode = { registerInstalledViews, helpOf, renderHelp, stubHelp, type: TYPE, available, uiSpec, keyOf, sync, compile, compilePatch, applyGenerated, isPatch, hashOf, setHost };

  if (G.BleepViews) G.BleepViews.register("code", {
    top: true,
    width: 900,
    resizable: true,
    template: `<div class="bv-panel bc">
      <div class="bc-bar"><div class="bc-actions"><button class="bc-compile" title="Compile (Ctrl/Cmd+Enter)">Compile</button>
        <button type="button" class="bc-convert" title="Turn this node into the module itself: it keeps its cables and knobs, appears in the Add menu and shows its own UI. Convert it back to carry on editing" hidden>Convert to module</button>
        <button type="button" class="bc-share" title="Publish the module in the Bleep Library, for everyone" hidden>Share…</button></div>
        <div class="bc-status"></div></div>
      <div class="bc-settings" hidden></div>
      <div class="bc-custom" hidden></div>
      <div class="bc-widgets" hidden></div>
      <div class="bc-tabs" role="tablist"><button type="button" class="bc-tab on" data-tab="script" role="tab" aria-selected="true">Script</button><button type="button" class="bc-tab" data-tab="ui" role="tab" aria-selected="false">UI</button><button type="button" class="bc-tab" data-tab="help" role="tab" aria-selected="false">Help</button><button type="button" class="bc-tab" data-tab="meta" role="tab" aria-selected="false">Metadata</button></div>
      <div class="bc-pane" data-pane="script">
        <div class="bc-editor"><pre class="bc-gutter" aria-hidden="true"></pre><textarea class="bc-source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Source code"></textarea></div>
        <ul class="bc-problems" aria-label="Problems"></ul>
      </div>
      <div class="bc-pane" data-pane="ui" hidden>
        <div class="bc-ui-bar"><button type="button" class="bc-ui-run">Run UI</button><button type="button" class="bc-ui-stop" disabled>Stop</button>
          <span class="bc-ui-note">JavaScript that draws this module's own UI. It runs in a sandboxed worker with no network, no DOM and no access to the board, and is stopped if it hangs.</span></div>
        <div class="bc-ui-editor"><textarea class="bc-ui-source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="UI code"></textarea></div>
        <ul class="bc-ui-problems" aria-label="UI problems"></ul>
      </div>
      <div class="bc-pane" data-pane="help" hidden>
        <div class="bc-ui-bar"><button type="button" class="bc-help-write on">Write</button><button type="button" class="bc-help-preview">Preview</button>
          <span class="bc-ui-note">The module's help page, in Markdown: the <b>?</b> button of its window shows it. Headings, lists, tables, **bold**, <code>code</code> and links work; images are left out.</span></div>
        <div class="bc-help-editor"><textarea class="bc-help-source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Help page (Markdown)" placeholder="# My module&#10;&#10;What it does, what the knobs mean, how to use it."></textarea></div>
        <div class="bc-help-render v-doc" hidden></div>
      </div>
      <div class="bc-pane" data-pane="meta" hidden>
        <div class="bc-meta"></div>
      </div>
      <div class="bc-probes" hidden></div>
    </div>`,
    afterBuild(view, customEl) { build(view, customEl); },
    onState(st, view) { if (view.code) view.code.showProbes(st); },
    onRefresh(view) { if (view.code) view.code.refreshWidgets(); },
  });
})();
