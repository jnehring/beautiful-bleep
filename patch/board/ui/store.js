// SPDX-License-Identifier: MIT
// store.js — the Store section of the board window (doc/specs/store.md section 9): what is installed on this machine, what the
// Bleep Store offers, and the Security settings. The board is the other section. Not in the web board: it installs by itself.
//
//   BleepStoreView.init({ onTypes })   once, when the native side has a store (native "init" says so)
//   show() / hide()                    the header's Board and Store buttons
(function () {
  "use strict";
  let status = null;          // native "storeStatus"
  let tab = "modules";
  let query = "";
  let message = "";           // the last thing that went wrong or right, shown under the header
  let poll = null;
  let host = null;
  let root, body, tabsEl, noteEl, summaryEl;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const STATUS = {
    signed: ["signed", "ok"], unsigned: ["unsigned", "warn"], expired: ["expired", "warn"], revoked: ["revoked", "bad"], invalid: ["invalid", "bad"],
  };

  async function refresh() {
    status = await native("storeStatus");
    render();
    const busy = status && status.busy && Object.keys(status.busy).length;
    if (busy && !poll) poll = setInterval(refresh, 700);
    if (!busy && poll) { clearInterval(poll); poll = null; if (host.onTypes) host.onTypes(); }
  }

  async function act(fn, ...args) {
    message = "";
    await native(fn, ...args);
    await refresh();
  }

  /// One row per module: what is installed and what the store offers, by slug.
  function rows() {
    const by = new Map();
    for (const m of status.installed) by.set(m.slug, { slug: m.slug, installed: m });
    for (const m of status.index.modules) by.set(m.slug, Object.assign(by.get(m.slug) || { slug: m.slug }, { offered: m }));
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...by.values()]
      .filter((r) => words.every((w) => (r.slug + " " + ((r.installed || r.offered).types || []).join(" ")).toLowerCase().includes(w)))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const newer = (a, b) => {  // is version a newer than b
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };

  function badge(m) {
    const [text, cls] = STATUS[m.status] || [m.status, "warn"];
    const b = el("span", "st-badge " + cls, m.status === "signed" ? "signed by " + m.publisher : text);
    b.title = m.why || "";
    return b;
  }

  function renderModules() {
    const top = el("div", "st-bar");
    const search = el("input", "st-search");
    search.placeholder = "Search modules";
    search.value = query;
    search.addEventListener("input", () => { query = search.value; renderModulesList(list); });
    top.appendChild(search);
    const refreshBtn = el("button", "", "Refresh");
    refreshBtn.addEventListener("click", async () => { message = ""; await native("storeRefresh"); setTimeout(refresh, 400); });
    top.appendChild(refreshBtn);
    const missing = status.index.modules.filter((m) => !status.installed.some((i) => i.slug === m.slug)).length;
    const all = el("button", "primary", missing ? `Install the default modules (${missing})` : "All modules installed");
    all.disabled = !missing;
    all.addEventListener("click", () => act("storeInstallAll"));
    top.appendChild(all);
    body.appendChild(top);
    if (!status.index.ok)
      body.appendChild(el("div", "st-note bad", status.index.error ? "The Bleep Store cannot be reached: " + status.index.error : "Reading the Bleep Store…"));
    if (!status.installed.length && status.index.ok)
      body.appendChild(el("div", "st-note warn", "The default modules are not installed. Boards show placeholders until they are."));
    if (!status.hasRoots)
      body.appendChild(el("div", "st-note warn", "This build trusts no developer keys, so nothing from the store can be verified. Add the store's root key (see doc/operations/website.md)."));
    const list = el("div", "st-list");
    body.appendChild(list);
    renderModulesList(list);
  }

  function renderModulesList(list) {
    list.innerHTML = "";
    const head = el("div", "st-row st-head");
    for (const t of ["Module", "Installed", "In the store", "Signature", ""]) head.appendChild(el("span", "", t));
    list.appendChild(head);
    for (const r of rows()) {
      const row = el("div", "st-row");
      const types = (r.installed || r.offered).types || [];
      const name = el("span", "st-name", r.slug);
      name.title = types.join(", ");
      row.appendChild(name);
      row.appendChild(el("span", "st-ver", r.installed ? r.installed.version + (r.installed.source === "local" ? " (local)" : "") : "—"));
      row.appendChild(el("span", "st-ver", r.offered ? r.offered.version : "—"));
      const sig = el("span", "st-sig");
      if (r.installed) sig.appendChild(badge(r.installed));
      if (r.installed && !r.installed.loaded && r.installed.allowed === false) sig.appendChild(el("span", "st-why", r.installed.why));
      row.appendChild(sig);
      const actions = el("span", "st-actions");
      const busy = status.busy[r.slug];
      if (busy) actions.appendChild(el("span", "st-busy", busy + "…"));
      else {
        if (r.offered && (!r.installed || (r.installed.source !== "local" && newer(r.offered.version, r.installed.version)))) {
          const b = el("button", r.installed ? "" : "primary", r.installed ? "Update" : "Install");
          b.addEventListener("click", () => act("storeInstall", r.slug));
          actions.appendChild(b);
        }
        if (r.installed && r.installed.source === "registry") {
          const b = el("button", "", "Remove");
          b.addEventListener("click", () => act("storeRemove", r.slug));
          actions.appendChild(b);
        }
      }
      row.appendChild(actions);
      list.appendChild(row);
    }
    if (!list.querySelector(".st-row:not(.st-head)")) list.appendChild(el("div", "st-empty", "No modules match."));
  }

  function renderPlugins() {
    body.appendChild(el("div", "st-note", "Plugins are installed from the Bleep Patch app, with Live closed: replacing a plugin that Live has loaded can crash it. The plugin family is installed together (the default plugin bundle)."));
    const list = el("div", "st-list");
    body.appendChild(list);
    native("storePlugins").then((plugins) => {
      list.innerHTML = "";
      const head = el("div", "st-row st-head plugins");
      for (const t of ["Plugin", "Installed", "Where"]) head.appendChild(el("span", "", t));
      list.appendChild(head);
      for (const p of plugins || []) {
        const row = el("div", "st-row plugins");
        row.appendChild(el("span", "st-name", p.name));
        row.appendChild(el("span", "st-ver", p.installed ? "yes" : "no"));
        row.appendChild(el("span", "st-why", p.path || ""));
        list.appendChild(row);
      }
    });
  }

  function renderPresets() {
    body.appendChild(el("div", "st-note", "Your presets: cells and patches you saved. Add → Cell lists the cells; the Presets button on the board loads patches."));
    const list = el("div", "st-list");
    body.appendChild(list);
    Promise.all([native("presets", "cells"), native("presets", "patches")]).then(([cells, patches]) => {
      list.innerHTML = "";
      const group = (title, items) => {
        list.appendChild(el("div", "st-row st-head single", `${title} (${(items || []).length})`));
        for (const p of items || []) list.appendChild(el("div", "st-row single", p.name));
      };
      group("Cells", cells);
      group("Patches", patches);
    });
  }

  function renderSecurity() {
    const s = status.settings;
    body.appendChild(el("div", "st-note", "Modules and plugins from the Bleep Store are signed by their developer. Anything unsigned stays off unless you allow it here. A broken or revoked signature is never loaded."));
    const toggle = (key, title, warning) => {
      const row = el("label", "st-toggle");
      const box = el("input");
      box.type = "checkbox";
      box.checked = !!s.allowUnsigned[key];
      box.addEventListener("change", async () => {
        if (box.checked && !window.confirm(warning)) { box.checked = false; return; }
        await act("storeSettings", { allowUnsigned: Object.assign({}, s.allowUnsigned, { [key]: box.checked }) });
      });
      row.appendChild(box);
      row.appendChild(el("span", "", title));
      body.appendChild(row);
    };
    toggle("module", "Allow unsigned modules",
      "Unsigned modules run in a sandbox: they cannot read your files or use the network, but they can use a lot of CPU and make noise.\n\nOnly enable this for modules you trust or have built yourself. Turn it on?");
    toggle("plugin", "Allow unsigned plugins",
      "Unsigned plugins are programs that run with all your rights inside your DAW.\n\nOnly enable this for software you trust. Turn it on?");
    body.appendChild(el("h3", "", "Developers you have installed from"));
    const seen = new Map();
    for (const m of status.installed) if (m.status === "signed") seen.set(m.publisher, (seen.get(m.publisher) || 0) + 1);
    if (!seen.size) body.appendChild(el("div", "st-empty", "None yet."));
    for (const [publisher, n] of seen) body.appendChild(el("div", "st-row single", `${publisher}: ${n} module${n === 1 ? "" : "s"}`));
    body.appendChild(el("h3", "", "Where things are"));
    body.appendChild(el("div", "st-row single", "Store: " + s.storeUrl + " (channel " + s.channel + ")"));
    body.appendChild(el("div", "st-row single", "Data folder: " + status.dataDir));
  }

  function render() {
    if (!root || !status) return;
    body.innerHTML = "";
    for (const b of tabsEl.children) b.classList.toggle("on", b.dataset.tab === tab);
    const n = status.installed.length;
    summaryEl.textContent = `${n} module${n === 1 ? "" : "s"} installed · ${status.index.ok ? status.index.modules.length + " in the store" : "store not reached"}`;
    noteEl.textContent = message;
    ({ modules: renderModules, plugins: renderPlugins, presets: renderPresets, security: renderSecurity })[tab]();
  }

  function build() {
    root = el("section");
    root.id = "store";
    root.hidden = true;
    const head = el("div", "st-head-line");
    head.appendChild(el("h2", "", "Store"));
    summaryEl = el("span", "st-summary");
    head.appendChild(summaryEl);
    root.appendChild(head);
    tabsEl = el("div", "st-tabs");
    for (const [id, label] of [["modules", "Modules"], ["plugins", "Plugins"], ["presets", "Presets"], ["security", "Security"]]) {
      const b = el("button", "", label);
      b.dataset.tab = id;
      b.addEventListener("click", () => { tab = id; render(); });
      tabsEl.appendChild(b);
    }
    root.appendChild(tabsEl);
    noteEl = el("div", "st-message");
    root.appendChild(noteEl);
    body = el("div", "st-body");
    root.appendChild(body);
    document.body.appendChild(root);
  }

  /// Installs the module that provides a node type (the Install button of a placeholder on the board). True if it is there now.
  async function installType(type) {
    message = "";
    status = await native("storeStatus");
    if (!status.index.ok) { await native("storeRefresh"); await new Promise((r) => setTimeout(r, 900)); status = await native("storeStatus"); }
    const m = status.index.modules.find((x) => (x.types || []).includes(type));
    if (!m) { message = status.index.ok ? "the store has no module for " + type : "the store cannot be reached: " + status.index.error; return false; }
    await native("storeInstall", m.slug);
    for (let i = 0; i < 300; i++) {  // wait for the install: the native side does it on another thread
      await new Promise((r) => setTimeout(r, 400));
      status = await native("storeStatus");
      if (!status.busy[m.slug]) break;
    }
    if (host.onTypes) await host.onTypes();
    return status.installed.some((x) => x.slug === m.slug && x.loaded);
  }

  /// The setup assistant (doc/specs/store.md 5a): once, on the first launch, offers the two default bundles. Either may be declined.
  async function firstRun() {
    status = await native("storeStatus");
    if (status.settings.firstRunDone) return;
    const back = el("div", "st-modal");
    const card = el("div", "st-card");
    card.appendChild(el("h2", "", "Set up Bleep Patch"));
    card.appendChild(el("p", "", "Modules are installed on this machine, from the Bleep Store. Until they are, a board shows placeholders where they belong. You can do this later from the Store section."));
    const mods = el("label", "st-toggle");
    const modBox = el("input");
    modBox.type = "checkbox";
    modBox.checked = true;
    mods.appendChild(modBox);
    mods.appendChild(el("span", "", "Download the default modules"));
    card.appendChild(mods);
    let plugBox = null;
    if (host.standalone) {
      const plugs = el("label", "st-toggle");
      plugBox = el("input");
      plugBox.type = "checkbox";
      plugBox.checked = true;
      plugs.appendChild(plugBox);
      plugs.appendChild(el("span", "", "Install the default plugins (the Bleep VST3 plugins, for your DAW; close Ableton Live first)"));
      card.appendChild(plugs);
    }
    const result = el("div", "st-message");
    card.appendChild(result);
    const buttons = el("div", "st-bar");
    const later = el("button", "", "Not now");
    const go = el("button", "primary", "Set up");
    buttons.append(later, go);
    card.appendChild(buttons);
    back.appendChild(card);
    document.body.appendChild(back);
    const finish = async () => { await native("storeSettings", { firstRunDone: true }); back.remove(); };
    later.addEventListener("click", finish);
    go.addEventListener("click", async () => {
      go.disabled = later.disabled = true;
      const lines = [];
      if (plugBox && plugBox.checked) {
        const r = await native("storeInstallPlugins");
        lines.push(r.message);
        result.textContent = lines.join("\n");
      }
      if (modBox.checked) {
        result.textContent = lines.concat("Reading the Bleep Store…").join("\n");
        await native("storeRefresh");
        for (let i = 0; i < 40; i++) {  // the native side reads the index on another thread
          await new Promise((r) => setTimeout(r, 400));
          status = await native("storeStatus");
          if (status.index.ok || status.index.error) break;
        }
        if (!status.index.ok) {
          result.textContent = lines.concat("The Bleep Store cannot be reached" + (status.index.error ? ": " + status.index.error : "") + ". Try again from the Store section.").join("\n");
          go.disabled = later.disabled = false;
          later.textContent = "Close";
          return;
        }
        await native("storeInstallAll");
        window.BleepStoreView.show();
        await refresh();
      }
      await finish();
    });
  }

  window.BleepStoreView = {
    installType,
    lastMessage: () => message,
    async init(options) {
      host = options || {};
      build();
      setTimeout(firstRun, 600);
      const header = document.getElementById("sections");
      header.hidden = false;
      document.getElementById("sec-board").addEventListener("click", () => window.BleepStoreView.hide());
      document.getElementById("sec-store").addEventListener("click", () => window.BleepStoreView.show());
    },
    async show() {
      document.body.classList.add("in-store");
      root.hidden = false;
      document.getElementById("sec-store").classList.add("on");
      document.getElementById("sec-board").classList.remove("on");
      await refresh();
      if (status && !status.index.ok) native("storeRefresh").then(() => setTimeout(refresh, 600));
    },
    hide() {
      document.body.classList.remove("in-store");
      root.hidden = true;
      document.getElementById("sec-board").classList.add("on");
      document.getElementById("sec-store").classList.remove("on");
    },
  };
})();
