// SPDX-License-Identifier: MIT
// project-browser.js — Open Project: the project browser (spec §11.5; standalone app, plugins and web). A project is a whole board with
// its panels. Three sources, shown as groups:
//
//   Demo       five projects per advanced module (demo-patches.json, built from patch/presets/demos)
//   Mine       the user's own. App and plugin: a folder on the computer (native "presets"/"savePreset" kind "projects").
//              Web: the user's account on the website (/api/projects), so saving needs a login.
//   Community  projects shared in the Bleep Library, searched there (/api/presets?type=patch) and downloaded on Load
//
// Web only: Download Project (the `.bleepboard` file) and Open from a file. Loading replaces the board (native "loadPatch"; the
// standalone app asks about unsaved changes first).
//
// In Bleep Instrument and Bleep FX (host.cells) it lists the cell presets the plugin can play instead
// (native "cellPresets", by category) and loading one replaces the plugin's cell (native "loadCellPreset").
(function () {
  "use strict";
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, onNative, download: saveFile, priv: P } = window.BleepSeal;
  let host = null;            // {board(), apply(message)} from board.js
  let demos = [];             // [{name, module, moduleName, preset}]
  let mine = [];              // [{name, preset, id?}]
  let lib = { items: [], note: "", busy: false };   // the Library group: [{name, address, author, preset}]
  let group = "all";          // plugin mode: "all" or a category of cell presets
  let view = "all";           // board mode: a view of preset-index.js ("all", "project", "cell", "instrument", "effect", "demo", "module:<type>")
  const origins = new Set(["factory", "user"]);   // board mode: which origins show (Community needs the Library); none on shows all
  let query = "";
  let cells = [];             // plugin mode: [{name, category, description, tags, current}]
  let root = null, listEl, groupsEl, originsEl, searchEl, saveRow, saveBtn, fileInput, noteEl;
  let signedIn = null;        // web: is there a login (null: not asked yet)
  let current = null;         // the loaded project for the side menu: {name, source: "factory" | "user" | "community", address?, preset}
  const listeners = [];
  function setCurrent(c) { current = c; listeners.forEach((f) => f(current)); }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
  const web = () => !!window.BleepWeb;
  const account = () => !!(P.BleepAccount && P.BleepAccount.enabled);
  const webMine = () => web() && account();          // Mine lives on the website
  const libraryView = () => !!(P.BleepLibraryView && document.getElementById("library"));   // initialised: the host has a library
  const canSave = () => !webMine() || signedIn === true;

  async function loadDemos() {
    try {
      demos = (await (await fetch("demo-patches.json")).json()).patches || [];
    } catch (e) {
      console.warn("demo-patches.json not loaded", e);
    }
  }

  // ---------------------------------------------------------------- Mine
  async function refreshLogin() {
    if (!webMine()) return;
    try { signedIn = !!(await P.BleepAccount.status(false)).signedIn; } catch (e) { signedIn = false; }
  }
  async function mineList() {
    if (!webMine()) return (await native("presets", "projects")) || [];
    await refreshLogin();
    if (!signedIn) return [];
    const r = await P.BleepAccount.call("GET", "/api/projects");
    if (!r || r.status !== 200) return [];
    return r.body.items.map((i) => ({ name: i.name, id: i.id, preset: { description: i.description, tags: i.tags } }));
  }
  async function mineSave(name, preset) {
    if (!webMine()) return (await native("savePreset", name, preset, "projects")) || [];
    const r = await P.BleepAccount.call("POST", "/api/projects", { name, preset });
    if (!r || r.status !== 200) throw new Error((r && r.error) || "The project could not be saved.");
    return mineList();
  }
  async function mineDelete(p) {
    if (!webMine()) return (await native("deletePreset", p.name, "projects")) || [];
    await P.BleepAccount.call("DELETE", "/api/projects/" + p.id);
    return mineList();
  }
  /// The whole project of a Mine entry (on the website the list holds only names and descriptions).
  async function mineLoad(p) {
    if (p.preset && Array.isArray(p.preset.nodes)) return p.preset;
    const r = await P.BleepAccount.call("GET", "/api/projects/" + p.id);
    if (!r || r.status !== 200) throw new Error((r && r.error) || "The project could not be loaded.");
    return r.body;
  }
  async function loadMine() { mine = await mineList(); }

  // ---------------------------------------------------------------- Library
  let libTimer = 0;
  async function searchLibrary() {
    if (!account()) return;
    lib.busy = true; lib.note = "";
    renderList();
    const q = encodeURIComponent(query.trim());
    let r = null;
    try { r = await P.BleepAccount.call("GET", "/api/presets?type=patch&page_size=60&q=" + q); } catch (e) { /* offline */ }
    lib.busy = false;
    if (!r || r.status !== 200) {
      lib.items = [];
      lib.note = (r && r.error) || "The Library could not be reached.";
    } else {
      lib.items = r.body.items.map((i) => ({
        name: i.title, address: i.address, library: true, moduleName: "by " + (i.author_name || i.author),
        preset: { description: i.summary, tags: i.tags }, meta: i,
      }));
    }
    if (communityOn()) { renderGroups(); renderList(); }
  }

  /// A file of the Library, a project file or a bare board as the flat project the browser loads, or null.
  function toFlat(doc) {
    if (!doc || typeof doc !== "object") return null;
    if (doc.board && Array.isArray(doc.board.nodes))
      return { name: doc.name, preset: Object.assign({}, doc.board, { description: doc.description || "", tags: doc.tags || [], tempo: doc.tempo, needs: doc.needs, credits: doc.credits, media: doc.media }) };
    if (doc.preset && Array.isArray(doc.preset.nodes))   // the Library's envelope
      return { name: doc.title, preset: Object.assign({}, doc.preset, { needs: doc.needs || doc.preset.needs, tags: doc.tags || doc.preset.tags }) };
    if (Array.isArray(doc.nodes)) return { name: doc.name, preset: doc };
    return null;
  }

  async function loadCells() {
    cells = (await native("cellPresets")) || [];
  }

  /// Plugin mode: the cell presets the plugin can play, filtered by the group (a category) and the search words.
  function pluginCells() {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return cells.filter((c) => (group === "all" || c.category === group) &&
      words.every((w) => [c.name, c.category, (c.tags || []).join(" "), c.description || ""].join(" ").toLowerCase().includes(w)))
      .map((c) => ({ name: c.name, moduleName: c.category, current: c.current, cell: true,
                     preset: { tags: c.tags, description: c.description, needs: c.needs, nodes: c.nodes } }));
  }

  /// Every preset the board browser knows as one list of entries (preset-index.js): demos and the Library's projects, the user's own
  /// projects and the board's cell presets. `ref` is the source object that loads it.
  function entries() {
    const I = window.BleepPresetIndex;
    const out = [];
    for (const c of host.cellPresets ? host.cellPresets() : [])
      out.push(I.entry({ kind: "cell", origin: c.factory ? "factory" : "user", name: c.name, group: c.category, description: c.description,
                         tags: c.tags, plays: c.plays, ref: { cellKey: c.key, name: c.name } }));
    for (const d of demos)
      out.push(I.entry({ kind: "demo", origin: "factory", name: d.name, group: d.moduleName, module: d.module,
                         description: d.preset.description, tags: d.preset.tags, ref: d }));
    for (const m of mine)
      out.push(I.entry({ kind: "project", origin: "user", name: m.name, description: m.preset && m.preset.description,
                         tags: m.preset && m.preset.tags, plays: m.preset && m.preset.plays, ref: Object.assign({}, m, { own: true }) }));
    for (const l of lib.items)
      out.push(I.entry({ kind: "project", origin: "community", name: l.name, author: l.meta && (l.meta.author_name || l.meta.author),
                         description: l.preset && l.preset.description, tags: l.preset && l.preset.tags, served: true, ref: l }));
    return out;
  }

  /// The entries of the chosen view and origins that match the search.
  function visible() {
    return window.BleepPresetIndex.select(entries(), { view, origins, query });
  }

  const KIND_LABELS = { project: "Project", cell: "Cell", demo: "Demo" };
  /// Community presets come from the Library: they need an account (the apps with a library, Play) and a search.
  const communityOn = () => account() && origins.has("community");

  function renderGroups() {
    groupsEl.innerHTML = "";
    if (host.cells) {   // plugin: the cell presets it can play, by category
      const add = (id, label, count) => {
        const b = el("div", "pb-group" + (group === id ? " active" : ""));
        b.appendChild(el("span", "", label));
        b.appendChild(el("span", "pb-count", String(count)));
        b.addEventListener("click", () => { group = id; render(); });
        groupsEl.appendChild(b);
      };
      add("all", "All presets", cells.length);
      groupsEl.appendChild(el("div", "pb-sep", "Categories"));
      const cats = new Map();
      for (const c of cells) cats.set(c.category, (cats.get(c.category) || 0) + 1);
      for (const [name, n] of cats) add(name, name, n);
      return;
    }
    const I = window.BleepPresetIndex;
    const all = entries();
    const add = (id, label) => {
      const b = el("div", "pb-group" + (view === id ? " active" : ""));
      b.appendChild(el("span", "", label));
      b.appendChild(el("span", "pb-count", String(I.count(all, id, origins))));
      b.addEventListener("click", () => { view = id; render(); });
      groupsEl.appendChild(b);
    };
    add("all", "Everything");
    add("project", "Projects");
    if (host.cellPresets) add("cell", "Cells");
    add("instrument", "Instruments");
    add("effect", "Effects");
    groupsEl.appendChild(el("div", "pb-sep", "Demos by module"));
    add("demo", "All demos");
    for (const [type, name] of I.modules(all)) add("module:" + type, name);
  }

  /// The Factory / Mine / Community switches above the list; none on shows everything.
  function renderOrigins() {
    originsEl.innerHTML = "";
    if (host.cells) return;
    for (const o of window.BleepPresetIndex.ORIGINS) {
      if (o === "community" && !account()) continue;
      const b = el("button", "pb-origin-switch" + (origins.has(o) ? " on" : ""), window.BleepPresetIndex.ORIGIN_LABELS[o]);
      b.title = o === "community" ? "Presets shared in the Bleep Library" : o === "user" ? "Presets and projects you saved" : "Presets that come with the app";
      b.addEventListener("click", () => {
        if (origins.has(o)) origins.delete(o); else origins.add(o);
        if (o === "community" && origins.has(o)) searchLibrary();
        render();
      });
      originsEl.appendChild(b);
    }
  }

  function emptyText() {
    if (communityOn() && lib.busy) return "Searching the Library…";
    if (communityOn() && lib.note) return lib.note;
    if (view === "cell" && !query) return "No cell presets here.";
    if (origins.size === 1 && origins.has("user") && !query) {
      if (webMine() && signedIn === false) return "Log in on the website to keep projects in your account.";
      return "Nothing saved yet. “Save current project…” keeps the board you are working on here.";
    }
    return "Nothing matches.";
  }

  function renderList() {
    listEl.innerHTML = "";
    const items = host.cells ? pluginCells().map((p) => ({ name: p.name, group: p.moduleName, current: p.current, origin: "", plays: null, description: p.preset.description, tags: p.preset.tags || [], ref: p }))
      : visible();
    if (!items.length) {
      listEl.appendChild(el("div", "pb-empty", emptyText()));
      return;
    }
    for (const e of items) {
      const p = e.ref;
      const card = el("div", "pb-card" + (e.current || p.current ? " current" : ""));
      const head = el("div", "pb-card-head");
      head.appendChild(el("span", "pb-name", e.name));
      if (e.origin) head.appendChild(el("span", "pb-badge pb-badge-" + e.origin, window.BleepPresetIndex.ORIGIN_LABELS[e.origin]));
      head.appendChild(el("span", "pb-chip", e.kind === "project" ? (e.author ? "by " + e.author : KIND_LABELS.project) : e.group || KIND_LABELS[e.kind] || ""));
      const as = window.BleepPresetIndex.playsAs(e);
      if (as) head.appendChild(el("span", "pb-chip", as === "both" ? "Instrument · Effect" : as === "instrument" ? "Instrument" : "Effect"));
      card.appendChild(head);
      if (e.description) card.appendChild(el("div", "pb-desc", e.description));
      const foot = el("div", "pb-foot");
      foot.appendChild(el("span", "pb-tags", e.tags.join(" · ")));
      if (p.own) {
        const del = el("button", "pb-del", "Delete");
        del.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Sure?"; setTimeout(() => { del.dataset.sure = ""; del.textContent = "Delete"; }, 2500); return; }
          mine = await mineDelete(p);
          render();
        });
        foot.appendChild(del);
        if (account()) {   // the apps with a library, and Play
          const share = el("button", "pb-del", "Share…");
          share.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            try { P.BleepAccount.share("boards", p.name, await mineLoad(p)); } catch (err) { say(err.message); }
          });
          foot.appendChild(share);
        }
      }
      const isCell = e.kind === "cell";
      const load = el("button", "pb-load", isCell ? "Add" : e.current || p.current ? "Loaded" : "Load");
      load.addEventListener("click", (ev) => { ev.stopPropagation(); activate(e); });
      foot.appendChild(load);
      card.appendChild(foot);
      card.addEventListener("dblclick", () => activate(e));
      listEl.appendChild(card);
    }
  }

  /// Load a project or demo, or place a cell preset on the board.
  function activate(e) {
    if (e.kind === "cell") { close(); host.placeCell(e.ref.cellKey); return; }
    loadPatch(e.ref);
  }

  function say(text) { if (noteEl) { noteEl.textContent = text || ""; noteEl.hidden = !text; } }

  function render() {
    renderGroups();
    renderOrigins();
    renderList();
    if (saveBtn) {
      saveBtn.disabled = !canSave();
      saveBtn.title = canSave() ? "" : "Log in on the website to keep projects in your account";
    }
  }

  /// In a plugin the patch's port nodes (Out 1/2, …) take the ports this board already has, by type;
  /// extra ones are left out, with their cables.
  function mapPorts(board) {
    const free = ((host.board() || {}).nodes || []).filter((n) => n.port);
    board.nodes = board.nodes.filter((n) => {
      if (!n.port) return true;
      const i = free.findIndex((f) => f.type === n.type);
      if (i < 0) return false;
      const [f] = free.splice(i, 1);
      for (const k of ["port", "track", "colour"]) if (f[k] !== undefined) n[k] = f[k];
      return true;
    });
    const ids = new Set(board.nodes.map((n) => n.id));
    board.cables = board.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node));
  }

  /// Downloads a Library project (its file is public) or fetches an entry of Mine, then loads it.
  async function fetchPreset(p) {
    say("");
    if (p.library) {
      const [author, slug] = p.address.split("/");
      const r = await P.BleepAccount.call("GET", `/api/presets/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/file`);
      const flat = r && r.status === 200 ? toFlat(r.body) : null;
      if (!flat) throw new Error((r && r.error) || "The project could not be downloaded.");
      return flat.preset;
    }
    if (p.own) return mineLoad(p);
    return p.preset;
  }

  async function loadPatch(p) {
    try {
      if (!p.cell) p = Object.assign({}, p, { preset: await fetchPreset(p) });
    } catch (e) { say(e.message); return; }
    if (libraryView() && p.preset && !(await P.BleepLibraryView.ensureNeeds(p.preset, p.name))) return;
    if (p.cell) {
      close();
      await native("loadCellPreset", p.name);
      setCurrent({ name: p.name, source: "factory", preset: p.preset });
      return;
    }
    const src = p.preset;
    if (src.media) {   // the audio the project carries goes into the media folder first
      const problems = await window.BleepMedia.importAll(src.media, (name, data) => native("importMedia", name, data));
      if (problems.length) say("Some audio could not be imported: " + problems.join("; "));
    }
    const board = { format: 1, id: uuid(), nodes: clone(src.nodes), cables: clone(src.cables || []) };
    if (Array.isArray(src.panels) && src.panels.length) board.panels = clone(src.panels);
    if (host.mapPorts) mapPorts(board);
    close();
    host.apply(await native("loadPatch", board, src.tempo || 0, p.name));
    setCurrent({ name: p.name, source: p.address ? "community" : p.own ? "user" : "factory", address: p.address, preset: src });
  }

  // ---------------------------------------------------------------- Save, download, open from a file
  function showSave() {
    if (!canSave()) { say("Log in on the website to keep projects in your account. Download Project saves a file."); return; }
    saveRow.hidden = false;
    saveRow.querySelector("input").focus();
  }

  /// The board as one flat project: nodes, cables and panels with description, tags and what it needs.
  async function currentProject(description) {
    const board = host.board();
    if (!board) return null;
    const preset = { format: 1, description: description || "", tags: [], nodes: clone(board.nodes), cables: clone(board.cables) };
    // Credits: the cells' own, those the loaded project carried, and the project it was loaded from (a Library or factory one).
    const C = window.BleepCredits;
    const from = !current ? null : current.source === "community" && current.address ? C.library(current.name, current.address)
      : current.source === "factory" ? C.factory(current.name) : null;
    const made = C.merge(C.collect(preset.nodes), current && current.preset && current.preset.credits, from ? [from] : []);
    if (made.length) preset.credits = made;
    // The audio the board's modules use goes along (common/ui/bleep-media.js); one that cannot be read is left out, with a note.
    const lost = await window.BleepMedia.attach(preset, preset.nodes, (id) => native("readMedia", id));
    if (lost.length) say(`${lost.length === 1 ? "An audio file" : lost.length + " audio files"} could not be read and ${lost.length === 1 ? "is" : "are"} not in the project.`);
    if ((board.panels || []).length) preset.panels = clone(board.panels).map((q) => { delete q.open; return q; });
    const needs = libraryView() ? await P.BleepLibraryView.needsFor(preset.nodes) : {};
    if (Object.keys(needs).length) preset.needs = needs;
    return preset;
  }

  async function save() {
    const [name, desc] = [...saveRow.querySelectorAll("input")].map((i) => i.value.trim());
    if (!name) return;
    const preset = await currentProject(desc);
    if (!preset) return;
    try { mine = await mineSave(name, preset); } catch (e) { say(e.message); return; }
    say("");
    setCurrent({ name, source: "user", preset });
    saveRow.hidden = true;
    for (const i of saveRow.querySelectorAll("input")) i.value = "";
    view = "project";
    origins.add("user");
    render();
  }

  /// Download Project (web): the board as a `.bleepboard` file, the same one the standalone app saves.
  async function download() {
    const preset = await currentProject(current && current.preset ? current.preset.description : "");
    if (!preset) return;
    const name = (current && current.name) || "Untitled";
    const { description, tags, tempo, needs, credits, media, ...board } = preset;
    const doc = { format: 2, app: "Bleep", name, description, tags, needs, credits, media, board };
    // Through the page's lock: a script-made click is otherwise dropped (common/ui/bleep-bridge.js).
    saveFile(JSON.stringify(doc, null, 1), name.replace(/[^\w .-]+/g, "_") + ".bleepboard", "application/json");
  }

  /// Open from a file (web): a `.bleepboard` project, a Library file or a bare board.
  function openFile() {
    if (!fileInput) {
      fileInput = el("input");
      fileInput.type = "file";
      fileInput.accept = ".bleepboard,.bleeppreset,.json,application/json";
      fileInput.hidden = true;
      fileInput.addEventListener("change", async () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!f) return;
        let flat = null;
        try { flat = toFlat(JSON.parse(await f.text())); } catch (e) { /* not JSON */ }
        if (!flat) { await open(); say("“" + f.name + "” is not a Bleep project."); return; }
        loadPatch({ name: flat.name || f.name.replace(/\.[^.]+$/, ""), preset: flat.preset });
      });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }

  function build() {
    root = el("div");
    root.id = "pb";
    root.hidden = true;
    const box = el("div", "pb-box");
    const head = el("div", "pb-head");
    head.appendChild(el("span", "pb-title", host.cells ? "Presets" : "Presets and Projects"));
    searchEl = el("input", "pb-search");
    searchEl.placeholder = host.cells ? "Search presets" : "Search presets and projects";
    searchEl.spellcheck = false;
    searchEl.autocomplete = "off";
    searchEl.addEventListener("input", () => {
      query = searchEl.value;
      if (communityOn()) { clearTimeout(libTimer); libTimer = setTimeout(searchLibrary, 300); }
      renderGroups();
      renderList();
    });
    head.appendChild(searchEl);
    saveBtn = el("button", "", "Save to My Projects…");
    saveBtn.addEventListener("click", showSave);
    if (!host.cells) head.appendChild(saveBtn);
    if (web() && !host.cells) {
      const fromFile = el("button", "", "From file…");
      fromFile.addEventListener("click", openFile);
      head.appendChild(fromFile);
    }
    const closeBtn = el("button", "pb-close", "✕");
    closeBtn.title = "Close (Esc)";
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    box.appendChild(head);
    noteEl = el("div", "pb-note");
    noteEl.hidden = true;
    box.appendChild(noteEl);

    saveRow = el("div", "pb-save");
    saveRow.hidden = true;
    const name = el("input"), desc = el("input");
    name.placeholder = "Name";
    desc.placeholder = "Description (optional)";
    for (const i of [name, desc]) {
      i.spellcheck = false;
      i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") save(); if (e.key === "Escape") saveRow.hidden = true; });
    }
    const ok = el("button", "", "Save"), no = el("button", "", "Cancel");
    ok.addEventListener("click", save);
    no.addEventListener("click", () => { saveRow.hidden = true; });
    saveRow.append(name, desc, ok, no);
    box.appendChild(saveRow);

    const body = el("div", "pb-body");
    groupsEl = el("div", "pb-groups");
    const main = el("div", "pb-main");
    originsEl = el("div", "pb-origins");
    listEl = el("div", "pb-list");
    main.append(originsEl, listEl);
    body.append(groupsEl, main);
    box.appendChild(body);
    root.appendChild(box);
    root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.getElementById("main").appendChild(root);
  }

  async function open() {
    if (!host) return;
    say("");
    if (host.cells) await loadCells();
    else await loadMine();
    if (communityOn()) searchLibrary();
    render();
    root.hidden = false;
    searchEl.focus();
    searchEl.select();
  }
  function close() {
    if (!root || root.hidden) return false;
    root.hidden = true;
    document.getElementById("canvas").focus();
    return true;
  }

  P.BleepProjectBrowser = {
    /// host: {board(): the current board, apply(message): show the engine's answer, cells: list cell presets}
    async init(h) {
      host = h;
      if (!host.cells) await loadDemos();
      build();
      onNative("openPresets", open);
      if (webMine()) {
        refreshLogin().then(() => { if (!root.hidden) render(); });
        if (P.BleepAccount.onChange) P.BleepAccount.onChange((st) => { signedIn = !!st.signedIn; });
      }
    },
    open,
    close,
    /// File → Save to My Projects…: opens the browser with its Save row ready.
    async save() { await open(); if (!host.cells) showSave(); },
    /// Download Project and Open from a file: the browser board only.
    download,
    openFile,
    canSave,
    /// My projects, for the Library dialog: [{name, preset}] and the whole project of one of them.
    mineList,
    mineLoad,
    /// Loads a project shared in the Bleep Library, by its address ("author/slug"), as the Load button does (Bleep Play's ?preset=).
    /// Throws when it cannot be fetched.
    async loadShared(address, name) {
      const r = await fetch("/api/presets/" + address.split("/").map(encodeURIComponent).join("/") + "/file");
      if (!r.ok) throw new Error(r.status === 404 ? "That project is not in the Bleep Library." : "The project could not be downloaded (" + r.status + ").");
      const flat = toFlat(await r.json());
      if (!flat) throw new Error("That file is not a project.");
      flat.preset.cables = flat.preset.cables || [];
      await loadPatch({ name: name || flat.name || address.split("/").pop(), preset: flat.preset, address });
    },
    /// Loads a demo board by its name ("Grains: Frozen Cloud"), as the module pages' *Run in Play* does (Bleep Play's ?demo=).
    /// Throws when there is no such demo.
    async loadDemo(name) {
      const d = demos.find((x) => x.name === name);
      if (!d) throw new Error("There is no demo called “" + name + "”.");
      await loadPatch(d);
    },
    isOpen: () => !!root && !root.hidden,
    /// The project the board came from, or null. `onChange(fn)` calls fn(current) after every load or save.
    current: () => current,
    onChange: (fn) => { listeners.push(fn); },
  };
})();
