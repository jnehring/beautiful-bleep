// SPDX-License-Identifier: MIT
// preset-browser.js — the preset browser (spec §11.5; standalone app, plugins and web): whole patches to load.
//
//   Demo patches   five per advanced module (demo-patches.json, built from patch/presets/demos)
//   My patches     the user's own, saved from the current board (native "presets"/"savePreset" kind "patches")
//
// Loading replaces the board (native "loadPatch"; the standalone app asks about unsaved changes first).
//
// In Bleep Instrument and Bleep FX (host.cells) it lists the cell presets the plugin can play instead
// (native "cellPresets", by category) and loading one replaces the plugin's cell (native "loadCellPreset").
(function () {
  "use strict";
  let host = null;            // {board(), apply(message)} from board.js
  let demos = [];             // [{name, module, moduleName, preset}]
  let mine = [];              // [{name, preset}]
  let group = "all";          // "all", "mine" or a module type
  let query = "";
  let cells = [];             // plugin mode: [{name, category, description, tags, current}]
  let root = null, listEl, groupsEl, searchEl, saveRow;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));

  async function loadDemos() {
    try {
      demos = (await (await fetch("demo-patches.json")).json()).patches || [];
    } catch (e) {
      console.warn("demo-patches.json not loaded", e);
    }
  }
  async function loadMine() {
    mine = (await native("presets", "patches")) || [];
  }

  async function loadCells() {
    cells = (await native("cellPresets")) || [];
  }

  /// The patches shown: the group's, filtered by the search words (name, module, tags, description).
  function visible() {
    if (host.cells) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return cells.filter((c) => (group === "all" || c.category === group) &&
        words.every((w) => [c.name, c.category, (c.tags || []).join(" "), c.description || ""].join(" ").toLowerCase().includes(w)))
        .map((c) => ({ name: c.name, moduleName: c.category, current: c.current, cell: true,
                       preset: { tags: c.tags, description: c.description } }));
    }
    const mineItems = mine.map((p) => ({ name: p.name, own: true, moduleName: "My patch", preset: p.preset }));
    let list = group === "mine" ? mineItems : group === "all" ? demos.concat(mineItems)
      : demos.filter((d) => d.module === group);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length)
      list = list.filter((p) => {
        const hay = [p.name, p.moduleName, (p.preset.tags || []).join(" "), p.preset.description || ""].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    return list;
  }

  function renderGroups() {
    groupsEl.innerHTML = "";
    const add = (id, label, count) => {
      const b = el("div", "pb-group" + (group === id ? " active" : ""));
      b.appendChild(el("span", "", label));
      b.appendChild(el("span", "pb-count", String(count)));
      b.addEventListener("click", () => { group = id; render(); });
      groupsEl.appendChild(b);
    };
    if (host.cells) {
      add("all", "All presets", cells.length);
      groupsEl.appendChild(el("div", "pb-sep", "Categories"));
      const cats = new Map();
      for (const c of cells) cats.set(c.category, (cats.get(c.category) || 0) + 1);
      for (const [name, n] of cats) add(name, name, n);
      return;
    }
    add("all", "All patches", demos.length + mine.length);
    add("mine", "My patches", mine.length);
    groupsEl.appendChild(el("div", "pb-sep", "Demos by module"));
    const mods = new Map();
    for (const d of demos) mods.set(d.module, d.moduleName);
    [...mods].sort((a, b) => a[1].localeCompare(b[1])).forEach(([type, name]) =>
      add(type, name, demos.filter((d) => d.module === type).length));
  }

  function renderList() {
    listEl.innerHTML = "";
    const items = visible();
    if (!items.length) {
      listEl.appendChild(el("div", "pb-empty", group === "mine" && !query
        ? "Nothing saved yet. “Save current patch…” keeps the board you are working on here."
        : "No patches match."));
      return;
    }
    for (const p of items) {
      const card = el("div", "pb-card" + (p.current ? " current" : ""));
      const head = el("div", "pb-card-head");
      head.appendChild(el("span", "pb-name", p.name));
      head.appendChild(el("span", "pb-chip", p.moduleName));
      card.appendChild(head);
      if (p.preset.description) card.appendChild(el("div", "pb-desc", p.preset.description));
      const foot = el("div", "pb-foot");
      const tags = el("span", "pb-tags", (p.preset.tags || []).join(" · "));
      foot.appendChild(tags);
      if (p.own) {
        const del = el("button", "pb-del", "Delete");
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Sure?"; setTimeout(() => { del.dataset.sure = ""; del.textContent = "Delete"; }, 2500); return; }
          mine = (await native("deletePreset", p.name, "patches")) || [];
          render();
        });
        foot.appendChild(del);
      }
      const load = el("button", "pb-load", p.current ? "Loaded" : "Load");
      load.addEventListener("click", (e) => { e.stopPropagation(); loadPatch(p); });
      foot.appendChild(load);
      card.appendChild(foot);
      card.addEventListener("dblclick", () => loadPatch(p));
      listEl.appendChild(card);
    }
  }

  function render() {
    renderGroups();
    renderList();
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

  async function loadPatch(p) {
    if (p.cell) {
      close();
      await native("loadCellPreset", p.name);
      return;
    }
    const src = p.preset;
    const board = { format: 1, id: uuid(), nodes: clone(src.nodes), cables: clone(src.cables) };
    if (host.mapPorts) mapPorts(board);
    close();
    host.apply(await native("loadPatch", board, src.tempo || 0, p.name));
  }

  function showSave() {
    saveRow.hidden = false;
    saveRow.querySelector("input").focus();
  }
  async function save() {
    const [name, desc] = [...saveRow.querySelectorAll("input")].map((i) => i.value.trim());
    const board = host.board();
    if (!name || !board) return;
    const preset = { format: 1, description: desc, tags: [], nodes: clone(board.nodes), cables: clone(board.cables) };
    mine = (await native("savePreset", name, preset, "patches")) || [];
    saveRow.hidden = true;
    for (const i of saveRow.querySelectorAll("input")) i.value = "";
    group = "mine";
    render();
  }

  function build() {
    root = el("div");
    root.id = "pb";
    root.hidden = true;
    const box = el("div", "pb-box");
    const head = el("div", "pb-head");
    head.appendChild(el("span", "pb-title", "Presets"));
    searchEl = el("input", "pb-search");
    searchEl.placeholder = host.cells ? "Search presets" : "Search patches";
    searchEl.spellcheck = false;
    searchEl.autocomplete = "off";
    searchEl.addEventListener("input", () => { query = searchEl.value; renderList(); });
    head.appendChild(searchEl);
    const saveBtn = el("button", "", "Save current patch…");
    saveBtn.addEventListener("click", showSave);
    if (!host.cells) head.appendChild(saveBtn);
    const closeBtn = el("button", "pb-close", "✕");
    closeBtn.title = "Close (Esc)";
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    box.appendChild(head);

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
    listEl = el("div", "pb-list");
    body.append(groupsEl, listEl);
    box.appendChild(body);
    root.appendChild(box);
    root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.getElementById("main").appendChild(root);
  }

  async function open() {
    if (!host) return;
    if (host.cells) await loadCells();
    else await loadMine();
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

  window.BleepPresetBrowser = {
    /// host: {board(): the current board, apply(message): show the engine's answer, cells: list cell presets}
    async init(h) {
      host = h;
      if (!host.cells) await loadDemos();
      build();
      onNative("openPresets", open);
    },
    open,
    close,
    isOpen: () => !!root && !root.hidden,
  };
})();
