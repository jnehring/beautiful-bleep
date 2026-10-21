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
      stop() { window.removeEventListener("message", onMessage); f.remove(); },
    };
  }

  function customUi(view, root, spec) {
    const $ = (selector) => root.querySelector(selector);
    const tabs = [...root.querySelectorAll(".bc-tab")], panes = [...root.querySelectorAll(".bc-pane")];
    const select = (name) => {
      tabs.forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on)); });
      panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
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

  function build(view, root) {
    const node = view.node;
    const ui = {
      bar: root.querySelector(".bc-bar"), compile: root.querySelector(".bc-compile"), examples: root.querySelector(".bc-examples"),
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
    const withView = (code) => (custom.getView().trim() ? { ...code, view: custom.getView() } : code);   // the UI's source rides along with every save
    let examples = [];

    // ---- Save as module: keep the compiled module (and its UI) on this computer, in the Add menu (web/js/user-modules.js) ----------------------
    const U = G.BleepUserModules;
    const saveButton = root.querySelector(".bc-save"), removeButton = root.querySelector(".bc-unsave");
    const slugOfNode = () => { const i = node.code && node.code.interface; return U && i && i.kind !== "patch" && i.name ? U.slugOf(i.name) : ""; };
    function showSaveButtons() {
      const slug = slugOfNode();
      saveButton.hidden = !slug;
      removeButton.hidden = !slug || !U.get(slug);
      saveButton.textContent = slug && U.get(slug) ? "Update saved module" : "Save as module";
    }
    let confirming = null;
    const confirmFirst = (button, text, then) => {   // the second click within four seconds does it
      if (confirming && confirming.button === button) { clearTimeout(confirming.timer); confirming = null; showSaveButtons(); then(); return; }
      if (confirming) { clearTimeout(confirming.timer); showSaveButtons(); }
      const old = button.textContent;
      button.textContent = text;
      confirming = { button, timer: setTimeout(() => { confirming = null; button.textContent = old; showSaveButtons(); }, 4000) };
    };
    async function saveModule() {
      const slug = slugOfNode(), i = node.code && node.code.interface;
      if (!slug || !node.code || !node.code.source) { setStatus("Compile the script first.", "bad"); return; }
      setStatus("saving…");
      try {
        const { compile: run } = await compiler();
        const settings = { ...settingValues };
        const r = await run(node.code.source, { typeId: U.typeOf(slug), constants: settings });   // compiled again, for the type id of the saved module
        if (!r.wasm || !r.specs.length) { setStatus("The module did not compile; nothing was saved.", "bad"); return; }
        const replaced = !!U.get(slug);
        await U.put({
          slug, name: i.name, category: r.specs[0].category || "Utility/Script", source: node.code.source, view: custom.getView(), settings,
          spec: r.specs, wasm: r.wasm.buffer.slice(r.wasm.byteOffset, r.wasm.byteOffset + r.wasm.byteLength),
        });
        if (G.BleepLibrary && G.BleepLibrary.forget) G.BleepLibrary.forget(slug);
        showSaveButtons();
        const where = (r.specs[0].category || "Utility/Script").split("/").concat(i.name).join(" › ");
        setStatus(`${replaced ? "Updated" : "Saved"} “${i.name}”: Add › Module › ${where}` +
          (replaced ? ". Reload the page to use the new version in patches that already have it." : "") + (U.persistent() ? "" : " (this browser keeps it only until the page is closed)"), "ok");
      } catch (e) { setStatus(`Could not save the module: ${e.message}`, "bad"); }
    }
    if (U) {
      U.load().then(showSaveButtons);
      saveButton.addEventListener("click", saveModule);
      removeButton.addEventListener("click", () => confirmFirst(removeButton, "Remove? (nodes using it go missing)", async () => {
        const slug = slugOfNode();
        if (!slug) return;
        await U.remove(slug);
        showSaveButtons();
        setStatus(`Removed “${node.code.interface.name}” from this computer. Your Code node keeps its source.`, "ok");
      }));
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
      for (const ex of examples) ui.examples.append(new Option(ex.name, ex.id));
      if (U && U.list().length) {   // the modules saved from a Code node: open one to change it and update it
        const group = document.createElement("optgroup");
        group.label = "My modules";
        for (const e of U.list()) group.append(new Option(e.name, "user:" + e.slug));
        ui.examples.append(group);
      }
      if (!getSource()) setSource(examples.find((e) => e.id === "fold").source);
      ui.compile.disabled = false;
      const saved = node.code && node.code.interface;
      setStatus(!saved ? "not compiled yet" : saved.kind === "patch" ? `${saved.name}: ${saved.summary.modules} modules and ${saved.summary.cables} cables made` : `${saved.name}: compiled${costText(saved)}`);
    }, () => {
      setStatus("The compiler is not part of this build.", "bad");
      ui.examples.hidden = true;
    });
    ui.examples.addEventListener("change", () => {
      const mine = ui.examples.value.startsWith("user:") && U ? U.get(ui.examples.value.slice(5)) : null;
      const ex = mine ? { source: mine.source, view: mine.view || "" } : examples.find((e) => e.id === ui.examples.value);
      if (!ex) return;
      setSource(ex.source); showProblems([]);
      if (ex.view !== undefined) custom.setView(ex.view);   // an example with its own UI brings the code for it (the UI tab; press Run UI)
      ui.examples.value = "";
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
  }

  /// Registers the view of every module the user saved (BleepViews.register keeps the first registration of a type, and the hooks look the
  /// module up here, so a module saved again shows its new source). Called when the node types are listed.
  function registerInstalledViews() {
    const U = G.BleepUserModules;
    if (!U || !G.BleepViews) return;
    for (const entry of U.list()) for (const spec of entry.spec || []) {
      installedTypes.set(spec.type, { entry, spec });
      if (G.BleepViews.get(spec.type)) continue;
      G.BleepViews.register(spec.type, {
        top: true,
        width: 900,
        template: `<div class="bv-panel bc"><div class="bc-custom" hidden></div><div class="bc-widgets" hidden></div></div>`,
        afterBuild(view, customEl) { buildInstalled(view, customEl); },
        onState(st, view) { if (view.installed) view.installed.onState(st); },
        onRefresh(view) { if (view.installed) view.installed.refresh(); },
      });
    }
  }

  P.BleepCode = { registerInstalledViews, type: TYPE, available, uiSpec, keyOf, sync, compile, compilePatch, applyGenerated, isPatch, hashOf, setHost };

  if (G.BleepViews) G.BleepViews.register("code", {
    top: true,
    width: 900,
    resizable: true,
    template: `<div class="bv-panel bc">
      <h2>Code</h2>
      <div class="bc-bar"><button class="bc-compile" title="Compile (Ctrl/Cmd+Enter)">Compile</button>
        <select class="bc-examples" aria-label="Load an example"><option value="">Examples…</option></select>
        <button type="button" class="bc-save" title="Keep this module on this computer: it appears in the Add menu, with its own UI" hidden>Save as module</button>
        <button type="button" class="bc-unsave" title="Take the saved module off this computer" hidden>Remove module</button><span class="bc-status"></span></div>
      <div class="bc-settings" hidden></div>
      <div class="bc-custom" hidden></div>
      <div class="bc-widgets" hidden></div>
      <div class="bc-tabs" role="tablist"><button type="button" class="bc-tab on" data-tab="script" role="tab" aria-selected="true">Script</button><button type="button" class="bc-tab" data-tab="ui" role="tab" aria-selected="false">UI</button></div>
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
      <div class="bc-probes" hidden></div>
    </div>`,
    afterBuild(view, customEl) { build(view, customEl); },
    onState(st, view) { if (view.code) view.code.showProbes(st); },
    onRefresh(view) { if (view.code) view.code.refreshWidgets(); },
  });
})();
