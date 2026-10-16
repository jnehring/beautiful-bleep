// SPDX-License-Identifier: MIT
// library.js — the Library section of the board window (developers/modules/library.md section 9): what is installed on this machine, what the
// Bleep Library offers, and the Security settings. The board is the other section. Not in Bleep Play: it installs by itself.
//
//   BleepLibraryView.init({ onTypes })   once, when the native side has a library (native "init" says so)
//   show() / hide()                    the header's Board and Library buttons
(function () {
  "use strict";
  let status = null;          // native "libraryStatus"
  let tab = "modules";
  let query = "";
  let category = "";          // the modules' category filter, "" = all
  let message = "";           // the last thing that went wrong or right, shown under the header
  let poll = null;
  let host = {};
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
    status = await native("libraryStatus");
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

  /// One row per module: what is installed and what the library offers, by slug.
  function rows() {
    const by = new Map();
    for (const m of status.installed) by.set(m.slug, { slug: m.slug, installed: m });
    for (const m of status.index.modules) by.set(m.slug, Object.assign(by.get(m.slug) || { slug: m.slug }, { offered: m }));
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...by.values()]
      .filter((r) => !category || (r.offered && (r.offered.category === category || (r.offered.category || "").startsWith(category + "/"))))
      .filter((r) => words.every((w) => (r.slug + " " + ((r.installed || r.offered).types || []).join(" ") + " " + tileText(r.offered)).toLowerCase().includes(w)))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const tileText = (e) => (e ? [e.title, e.summary, e.category].join(" ") : "");

  /// The picture of a tile: the screenshot from the library, or a placeholder with the first letter when there is none (or it cannot load).
  function picture(src, name, kind) {
    const box = el("div", "st-pic " + kind);
    const placeholder = () => { box.innerHTML = ""; box.appendChild(el("span", "", (name || "?").trim().charAt(0).toUpperCase())); };
    if (!src) { placeholder(); return box; }
    const img = el("img");
    img.loading = "lazy";
    img.alt = name + " screenshot";
    img.addEventListener("error", placeholder);
    img.src = src;
    box.appendChild(img);
    return box;
  }

  /// A tile: picture, kind and category tags, title, description, and a line and buttons the caller fills in.
  function tile(kind, e, fallbackName) {
    const t = el("div", "st-tile");
    t.appendChild(picture(e && e.imageUrl, (e && e.title) || fallbackName, kind));
    const b = el("div", "st-tile-body");
    const tags = el("div", "st-tags");
    tags.appendChild(el("span", "st-tag " + kind, kind));
    if (e && e.category) tags.appendChild(el("span", "st-tag", e.category.replace(/\//g, " › ")));
    b.appendChild(tags);
    b.appendChild(el("div", "st-name", (e && e.title) || fallbackName));
    b.appendChild(el("div", "st-summary", (e && e.summary) || "No description yet."));
    t.appendChild(b);
    return { tile: t, body: b };
  }

  const newer = (a, b) => {  // is version a newer than b
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };

  /// The modules installed from the library for which the library offers a newer version: [{ slug, title, have, offer }].
  function updatesOf(st) {
    const out = [];
    for (const o of st.index.modules) {
      const i = st.installed.find((m) => m.slug === o.slug);
      if (i && i.source !== "local" && o.version && i.version && newer(o.version, i.version))
        out.push({ slug: o.slug, title: o.title || o.slug, have: i.version, offer: o.version });
    }
    return out;
  }

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
    refreshBtn.addEventListener("click", async () => { message = ""; await native("libraryRefresh"); setTimeout(refresh, 400); });
    top.appendChild(refreshBtn);
    const missing = status.index.modules.filter((m) => !status.installed.some((i) => i.slug === m.slug)).length;
    const all = el("button", "primary", missing ? `Install the default modules (${missing})` : "All modules installed");
    all.disabled = !missing;
    all.addEventListener("click", () => act("libraryInstallAll"));
    top.appendChild(all);
    const updates = updatesOf(status);
    if (updates.length) {
      const upd = el("button", "primary", `Update all (${updates.length})`);
      upd.addEventListener("click", () => act("libraryUpdateAll"));
      top.appendChild(upd);
    }
    body.appendChild(top);
    if (!status.index.ok)
      body.appendChild(el("div", "st-note bad", status.index.error ? "The Bleep Library cannot be reached: " + status.index.error : "Reading the Bleep Library…"));
    if (status.index.ok && status.index.cached)   // offline: the list the library gave the last time it answered
      body.appendChild(el("div", "st-note", `The Bleep Library was not reached. This is the list saved ${status.index.cachedAt ? new Date(status.index.cachedAt * 1000).toLocaleString() : "earlier"}.`));
    if (!status.installed.length && status.index.ok)
      body.appendChild(el("div", "st-note warn", "The default modules are not installed. Boards show placeholders until they are."));
    if (!status.hasRoots)
      body.appendChild(el("div", "st-note warn", "This build trusts no developer keys, so nothing from the library can be verified. Add the library's root key (see doc/operations/website.md)."));
    const cats = [...new Set(status.index.modules.map((m) => m.category).filter(Boolean))].sort();
    if (category && !cats.includes(category)) category = "";
    if (cats.length) {
      const bar = el("div", "st-chips");
      const select = (label, value, options, onChange) => {
        const sel = el("select", "st-select");
        sel.setAttribute("aria-label", label);
        for (const [v, text] of options) sel.appendChild(Object.assign(el("option", "", text), { value: v }));
        sel.value = value;
        sel.addEventListener("change", () => onChange(sel.value));
        bar.appendChild(sel);
      };
      const top = category.split("/")[0];
      const tops = [...new Set(cats.map((c) => c.split("/")[0]))];
      select("Category", top, [["", "All categories"], ...tops.map((c) => [c, c])], (v) => { category = v; render(); });
      const subs = top ? cats.filter((c) => c.startsWith(top + "/")) : [];
      if (subs.length)
        select("Subcategory", category === top ? "" : category, [["", "All of " + top], ...subs.map((c) => [c, c.slice(top.length + 1)])], (v) => { category = v || top; render(); });
      body.appendChild(bar);
    }
    const list = el("div", "st-tiles");
    body.appendChild(list);
    renderModulesList(list);
  }

  function renderModulesList(list) {
    list.innerHTML = "";
    for (const r of rows()) {
      const e = r.offered || null;
      const types = (r.installed || r.offered).types || [];
      const { tile: t, body: b } = tile("module", e, r.slug);
      t.title = types.join(", ");
      const info = el("div", "st-info");
      info.appendChild(el("span", "st-ver", (r.installed ? "installed " + r.installed.version + (r.installed.source === "local" ? " (local)" : "") : "not installed") +
                                              (e ? " · library " + e.version : "")));
      if (r.installed) info.appendChild(badge(r.installed));
      if (r.installed && !r.installed.loaded && r.installed.allowed === false) info.appendChild(el("span", "st-why", r.installed.why));
      b.appendChild(info);
      const actions = el("div", "st-actions");
      const busy = status.busy[r.slug];
      if (busy) actions.appendChild(el("span", "st-busy", busy + "…"));
      else {
        if (r.offered && (!r.installed || (r.installed.source !== "local" && newer(r.offered.version, r.installed.version)))) {
          const btn = el("button", r.installed ? "" : "primary", r.installed ? "Update" : "Install");
          btn.addEventListener("click", () => act("libraryInstall", r.slug));
          actions.appendChild(btn);
        }
        if (r.installed && r.installed.source === "registry") {
          const btn = el("button", "", "Remove");
          btn.addEventListener("click", () => act("libraryRemove", r.slug));
          actions.appendChild(btn);
        }
      }
      b.appendChild(actions);
      list.appendChild(t);
    }
    if (!list.firstChild) list.appendChild(el("div", "st-empty", "No modules match."));
  }

  function renderPlugins() {
    body.appendChild(el("div", "st-note", "Plugins are installed from the Bleep App, with Live closed: replacing a plugin that Live has loaded can crash it. The plugin family is installed together (the default plugin bundle)."));
    const list = el("div", "st-list");
    body.appendChild(list);
    if (host.standalone) {
      const bar = el("div", "st-bar");
      const msg = el("span", "st-why");
      const btn = el("button", "primary", "Install or update the default plugins");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const r = await native("libraryInstallPlugins");
        if (r.started) {
          for (let i = 0; i < 900; i++) {
            await new Promise((res) => setTimeout(res, 500));
            const s = await native("libraryStatus");
            msg.textContent = s.pluginJob.message;
            if (s.pluginJob.state === "done") break;
          }
        } else msg.textContent = r.message;
        btn.disabled = false;
        message = msg.textContent;  // kept under the header when the list is drawn again
        if (tab === "plugins") render();
      });
      bar.append(btn, msg);
      body.insertBefore(bar, list);
    }
    native("libraryPlugins").then((plugins) => {
      list.innerHTML = "";
      list.className = "st-tiles";
      const local = new Map((plugins || []).map((p) => [p.name, p]));
      const offered = status.index.plugins || [];
      // What the library offers (the app itself is not a plugin to install into a DAW); else what is known to be installable.
      const entries = offered.filter((p) => p.slug !== "bleep-app").map((p) => ({ e: p, name: (p.title || p.slug).replace(/\s*\(VST3\)$/, "") }));
      for (const p of plugins || []) if (!entries.some((x) => x.name === p.name)) entries.push({ e: null, name: p.name });
      for (const { e, name } of entries) {
        const { tile: t, body: b } = tile("plugin", e ? Object.assign({}, e, { title: name }) : null, name);
        const here = local.get(name);
        const info = el("div", "st-info");
        info.appendChild(el("span", "st-ver", (here && here.installed ? "installed" : "not installed") + (e ? " · library " + e.version : "")));
        if (here && here.path) info.appendChild(el("span", "st-why", here.path));
        b.appendChild(info);
        list.appendChild(t);
      }
    });
  }

  function renderPresets() {
    body.appendChild(el("div", "st-note", "What you saved: cell presets and projects. Add → Cell lists the cells; File → Open Project… loads a project."));
    const list = el("div");
    body.appendChild(list);
    Promise.all([native("presets", "cells"), window.BleepProjectBrowser ? BleepProjectBrowser.mineList() : []]).then(([cells, boards]) => {
      list.innerHTML = "";
      const group = (title, kind, items) => {
        list.appendChild(el("h3", "", `${title} (${(items || []).length})`));
        const grid = el("div", "st-tiles");
        for (const p of items || []) {
          const d = (p.preset && p.preset.description) || p.description || "";
          const cat = p.category || (p.preset && p.preset.category) || "";
          const { tile: t, body: b } = tile("preset", { title: p.name, summary: d, category: cat || kind }, p.name);
          if (window.BleepAccount && BleepAccount.enabled && p.preset) {
            const share = el("button", "", "Share…");
            share.title = "Publish it in the Bleep Library (needs an account)";
            share.addEventListener("click", async () => {
              const preset = kind === "cell" || !window.BleepProjectBrowser ? p.preset : await BleepProjectBrowser.mineLoad(p);
              const done = await BleepAccount.share(kind === "cell" ? "cells" : "boards", p.name, preset);
              if (done) { message = `Shared as ${done.address} (version ${done.version}).`; render(); }
            });
            b.appendChild(share);
          }
          grid.appendChild(t);
        }
        list.appendChild(grid);
      };
      group("Cells", "cell", cells);
      group("Projects", "patch", boards);
    });
  }

  /// The login to the Bleep Library: needed to share presets (comments and ratings are on the website, with the same account).
  function renderAccount() {
    const box = el("div", "st-account");
    body.appendChild(box);
    const draw = (st) => {
      box.innerHTML = "";
      if (st.signedIn) {
        box.appendChild(el("div", "st-note", "Signed in as " + (st.name || st.email || "you") + (st.email && st.name ? " (" + st.email + ")" : "") + (st.offline ? " · the library could not be reached just now" : "") + "."));
        box.appendChild(el("div", "st-note", "You can share presets from the Presets tab. Comments and ratings are on the library's pages, with the same account."));
        const row = el("div", "ac-row");
        const site = el("button", "", "My account on the website");
        site.addEventListener("click", () => BleepAccount.open(st.libraryUrl + "/account/"));
        const out = el("button", "", "Sign out");
        out.addEventListener("click", async () => draw(await BleepAccount.signOut()));
        row.append(site, out);
        box.appendChild(row);
        return;
      }
      box.appendChild(el("div", "st-note", st.playLogin
        ? "Log in on the website to share presets."
        : "Sign in to share presets in the Bleep Library, comment and rate. The website shows a page where you confirm the code below; nothing is typed here, and your password never reaches this app."));
      const code = el("div", "ac-code");
      const msg = el("div", "ac-msg");
      box.append(code, msg);
      const row = el("div", "ac-row");
      const go = el("button", "ac-primary", st.playLogin ? "Log in on the website" : "Sign in…");
      go.addEventListener("click", async () => {
        if (st.playLogin) { BleepAccount.open(st.libraryUrl + "/login/"); return; }
        go.disabled = true;
        const r = await BleepAccount.signIn((c) => { code.textContent = c.userCode; msg.textContent = "Waiting for you to confirm it in the browser…"; });
        if (r && r.error !== undefined) { go.disabled = false; code.textContent = ""; msg.className = "ac-msg bad"; msg.textContent = r.error; return; }
        draw(await BleepAccount.status(false));
      });
      row.appendChild(go);
      box.appendChild(row);
    };
    BleepAccount.status(true).then(draw);
  }

  function renderSecurity() {
    const s = status.settings;
    body.appendChild(el("div", "st-note", "Modules and plugins from the Bleep Library are signed by their developer. Anything unsigned stays off unless you allow it here. A broken or revoked signature is never loaded."));
    const toggle = (key, title, warning) => {
      const row = el("label", "st-toggle");
      const box = el("input");
      box.type = "checkbox";
      box.checked = !!s.allowUnsigned[key];
      box.addEventListener("change", async () => {
        if (box.checked && !window.confirm(warning)) { box.checked = false; return; }
        await act("librarySettings", { allowUnsigned: Object.assign({}, s.allowUnsigned, { [key]: box.checked }) });
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
    body.appendChild(el("div", "st-row single", "Library: " + s.libraryUrl + " (channel " + s.channel + ")"));
    body.appendChild(el("div", "st-row single", "Data folder: " + status.dataDir));
  }

  function render() {
    if (!root || !status) return;
    body.innerHTML = "";
    for (const b of tabsEl.children) b.classList.toggle("on", b.dataset.tab === tab);
    const n = status.installed.length;
    summaryEl.textContent = `${n} module${n === 1 ? "" : "s"} installed · ${status.index.ok ? status.index.modules.length + (status.index.cached ? " in the saved library list" : " in the library") : "library not reached"}`;
    noteEl.textContent = message;
    ({ modules: renderModules, plugins: renderPlugins, presets: renderPresets, account: renderAccount, security: renderSecurity })[tab]();
  }

  function build() {
    root = el("section");
    root.id = "library";
    root.hidden = true;
    const head = el("div", "st-head-line");
    head.appendChild(el("h2", "", "Library"));
    summaryEl = el("span", "st-summary");
    head.appendChild(summaryEl);
    root.appendChild(head);
    tabsEl = el("div", "st-tabs");
    for (const [id, label] of [["modules", "Modules"], ["plugins", "Plugins"], ["presets", "Presets"], ["account", "Account"], ["security", "Security"]]) {
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

  /// Installs a module from the library and waits for it (the native side works on another thread). True if it is loaded now.
  async function installSlug(slug) {
    await native("libraryInstall", slug);
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 400));
      status = await native("libraryStatus");
      if (!status.busy[slug]) break;
    }
    if (host.onTypes) await host.onTypes();
    return status.installed.some((x) => x.slug === slug && x.loaded);
  }

  /// The library's status with its index read (asks the native side to fetch it if it has not yet).
  async function statusWithIndex() {
    status = await native("libraryStatus");
    if (!status.index.ok) { await native("libraryRefresh"); await new Promise((r) => setTimeout(r, 900)); status = await native("libraryStatus"); }
    return status;
  }

  /// Installs the module that provides a node type (the Install button of a placeholder on the board). True if it is there now.
  async function installType(type) {
    message = "";
    await statusWithIndex();
    const m = status.index.modules.find((x) => (x.types || []).includes(type));
    if (!m) { message = status.index.ok ? "the library has no module for " + type : "the library cannot be reached: " + status.index.error; return false; }
    return installSlug(m.slug);
  }

  // ---- Dependencies of presets (developers/modules/library.md section 6) ----------------------------------------------------------
  // A preset (a cell or a whole patch) may carry  needs: { "<module slug>": { min: "1.2.0", max: "1.9.0" } }  (both optional and
  // inclusive). Whatever it lists is checked, and so is every module that provides one of its node types, with no version limit.

  const cmp = (a, b) => (newer(a, b) ? 1 : newer(b, a) ? -1 : 0);
  const inRange = (v, n) => (!n.min || cmp(v, n.min) >= 0) && (!n.max || cmp(v, n.max) <= 0);
  const rangeText = (n) => (n.min && n.max ? `${n.min} to ${n.max}` : n.min ? `${n.min} or newer` : n.max ? `up to ${n.max}` : "any version");

  /// What a preset needs: Map slug → { min, max } from its `needs` plus the modules behind its node types.
  function neededBy(preset) {
    const need = new Map();
    for (const [slug, r] of Object.entries(preset.needs || {})) need.set(slug, { min: (r && r.min) || "", max: (r && r.max) || "" });
    const provider = new Map();
    for (const m of status.installed.concat(status.index.modules)) for (const t of m.types || []) if (!provider.has(t)) provider.set(t, m.slug);
    for (const n of preset.nodes || []) {
      const slug = provider.get(n.type);
      if (slug && !need.has(slug)) need.set(slug, { min: "", max: "" });
    }
    return need;
  }

  /// One verdict per needed module: ok, install (missing), update (too old), or a reason it cannot be met.
  function judge(slug, n) {
    const have = status.installed.find((m) => m.slug === slug && m.loaded) || status.installed.find((m) => m.slug === slug);
    const offer = status.index.modules.find((m) => m.slug === slug);
    const row = { slug, need: n, have: have && have.version, offer: offer && offer.version };
    if (have && have.loaded && inRange(have.version, n)) return Object.assign(row, { action: "ok" });
    if (have && have.source === "local") return Object.assign(row, { action: "blocked", why: `your local copy (${have.version}) is outside ${rangeText(n)}` });
    if (!status.index.ok && !(have && have.loaded)) return Object.assign(row, { action: "blocked", why: "the library cannot be reached" });
    if (have && have.loaded && n.max && cmp(have.version, n.max) > 0) {
      // The library keeps only the newest version, so a too-new module cannot be replaced by an older one.
      return Object.assign(row, { action: "blocked", why: `installed ${have.version} is newer than ${n.max}` });
    }
    if (!offer) return Object.assign(row, { action: "blocked", why: have ? "the library has no newer version" : "the library does not have it" });
    if (!inRange(offer.version, n)) return Object.assign(row, { action: "blocked", why: `the library has ${offer.version}, the preset needs ${rangeText(n)}` });
    if (have && have.loaded) return Object.assign(row, { action: "update" });
    if (have) return Object.assign(row, { action: "blocked", why: have.why || "installed but not allowed to load" });
    return Object.assign(row, { action: "install" });
  }

  /// Before a preset is loaded or placed: if modules it needs are missing or too old, asks to install them from the library.
  /// Resolves true to go on loading (also with "Load anyway": the board keeps placeholders), false when the user cancels.
  async function ensureNeeds(preset, name) {
    if (!preset) return true;
    // Placing a preset must work offline: look at the modules installed here and at the library index if it is already
    // loaded, never wait for the network. (An index that is not loaded yet is fetched in the background, for next time.)
    // If even the local status does not answer, the caller places the preset anyway.
    status = await Promise.race([native("libraryStatus"), new Promise((_, no) => setTimeout(() => no(new Error("the app did not answer in time")), 5000))]);
    if (!status) return true;  // no library behind this board (the browser demo): place the preset anyway
    if (!status.index.ok) native("libraryRefresh").catch(() => {});
    const rows = [...neededBy(preset)].map(([slug, n]) => judge(slug, n)).filter((r) => r.action !== "ok");
    if (!rows.length) return true;
    return new Promise((resolve) => {
      const back = el("div", "st-modal");
      const card = el("div", "st-card");
      card.appendChild(el("h2", "", `"${name || "This preset"}" needs modules`));
      const list = el("div", "st-list");
      for (const r of rows) {
        const ver = r.need.min || r.need.max ? ` (needs ${rangeText(r.need)})` : "";
        const line = r.action === "install" ? `not installed${r.offer ? `, library has ${r.offer}` : ""}${ver}`
          : r.action === "update" ? `installed ${r.have}, library has ${r.offer}${ver}` : r.why;
        const row = el("div", "st-row single");
        row.appendChild(el("b", "", r.slug));
        row.appendChild(el("span", "", ` – ${line}`));
        list.appendChild(row);
      }
      card.appendChild(list);
      const result = el("div", "st-message");
      card.appendChild(result);
      const fixable = rows.filter((r) => r.action === "install" || r.action === "update");
      const buttons = el("div", "st-bar");
      const cancel = el("button", "", "Cancel");
      const anyway = el("button", "", "Load anyway");
      const go = el("button", "primary", `Download ${fixable.length} from the Bleep Library`);
      buttons.append(cancel);
      buttons.append(anyway);
      if (fixable.length) buttons.append(go);
      card.appendChild(buttons);
      back.appendChild(card);
      document.body.appendChild(back);
      const done = (v) => { back.remove(); resolve(v); };
      cancel.addEventListener("click", () => done(false));
      anyway.addEventListener("click", () => done(true));
      go.addEventListener("click", async () => {
        go.disabled = anyway.disabled = cancel.disabled = true;
        const failed = [];
        for (const r of fixable) {
          result.textContent = `Installing ${r.slug}…`;
          if (!(await installSlug(r.slug))) failed.push(r.slug);
        }
        if (!failed.length) { done(true); return; }
        result.textContent = `Could not install ${failed.join(", ")}. ${message || "See the Library section."}`;
        anyway.disabled = cancel.disabled = false;
        anyway.textContent = "Load anyway";
      });
    });
  }

  /// The `needs` to write into a preset that is being saved: the modules its node types come from, at least the version installed now.
  async function needsFor(nodes) {
    status = await native("libraryStatus");
    const out = {};
    const need = neededBy({ nodes });
    for (const [slug] of need) {
      const have = status.installed.find((m) => m.slug === slug);
      if (have && have.version) out[slug] = { min: have.version };
    }
    return out;
  }

  /// The setup assistant (developers/modules/library.md 5a): once, on the first launch, offers the two default bundles. Either may be declined.
  async function firstRun() {
    status = await native("libraryStatus");
    if (status.settings.firstRunDone) return;
    const back = el("div", "st-modal");
    const card = el("div", "st-card");
    card.appendChild(el("h2", "", "Set up Beautiful Bleep"));
    card.appendChild(el("p", "", "Modules are installed on this machine, from the Bleep Library. Until they are, a board shows placeholders where they belong. You can do this later from the Library section."));
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
    const finish = async () => { await native("librarySettings", { firstRunDone: true }); back.remove(); };
    later.addEventListener("click", finish);
    go.addEventListener("click", async () => {
      go.disabled = later.disabled = true;
      const lines = [];
      if (plugBox && plugBox.checked) {
        const r = await native("libraryInstallPlugins");
        if (r.started) {  // downloaded from the library, on another thread
          for (let i = 0; i < 900; i++) {
            await new Promise((res) => setTimeout(res, 500));
            status = await native("libraryStatus");
            result.textContent = lines.concat(status.pluginJob.message).join("\n");
            if (status.pluginJob.state === "done") break;
          }
          lines.push(status.pluginJob.message);
        } else lines.push(r.message);
        result.textContent = lines.join("\n");
      }
      if (modBox.checked) {
        result.textContent = lines.concat("Reading the Bleep Library…").join("\n");
        await native("libraryRefresh");
        for (let i = 0; i < 40; i++) {  // the native side reads the index on another thread
          await new Promise((r) => setTimeout(r, 400));
          status = await native("libraryStatus");
          if (status.index.ok || status.index.error) break;
        }
        if (!status.index.ok) {
          result.textContent = lines.concat("The Bleep Library cannot be reached" + (status.index.error ? ": " + status.index.error : "") + ". Try again from the Library section.").join("\n");
          go.disabled = later.disabled = false;
          later.textContent = "Close";
          return;
        }
        await native("libraryInstallAll");
        window.BleepLibraryView.show();
        await refresh();
      }
      await finish();
    });
  }

  /// On every start of the standalone app, after the setup assistant: asks the library what is new and offers to install the updates.
  async function updatesPrompt() {
    status = await native("libraryStatus");
    if (!status.settings.firstRunDone) return;   // the setup assistant is on screen, or was left for later
    await native("libraryRefresh");
    for (let i = 0; i < 40; i++) {  // the native side reads the index on another thread; a saved copy does not count as an answer
      await new Promise((r) => setTimeout(r, 400));
      status = await native("libraryStatus");
      if ((status.index.ok && !status.index.cached) || status.index.error) break;
    }
    if (!status.index.ok || status.index.cached) return;
    const updates = updatesOf(status);
    if (!updates.length) return;
    const back = el("div", "st-modal");
    const card = el("div", "st-card");
    card.appendChild(el("h2", "", updates.length === 1 ? "A module update is available" : `${updates.length} module updates are available`));
    const shown = updates.slice(0, 8).map((u) => `${u.title}  ${u.have} → ${u.offer}`);
    if (updates.length > shown.length) shown.push(`and ${updates.length - shown.length} more`);
    card.appendChild(el("p", "", "The Bleep Library has newer versions of modules you have installed. Install them now?"));
    card.appendChild(el("div", "st-message", shown.join("\n")));
    const result = el("div", "st-message");
    card.appendChild(result);
    const buttons = el("div", "st-bar");
    const later = el("button", "", "Not now");
    const go = el("button", "primary", updates.length === 1 ? "Update" : "Update all");
    buttons.append(later, go);
    card.appendChild(buttons);
    back.appendChild(card);
    document.body.appendChild(back);
    later.addEventListener("click", () => back.remove());   // asked again at the next start
    go.addEventListener("click", async () => {
      go.disabled = later.disabled = true;
      result.textContent = "Updating…";
      await native("libraryUpdateAll");
      for (let i = 0; i < 900; i++) {
        await new Promise((r) => setTimeout(r, 500));
        status = await native("libraryStatus");
        if (!status.busy["*"]) break;
      }
      const left = updatesOf(status).length;
      await refresh();
      if (!left) { back.remove(); return; }
      result.textContent = `${left} could not be updated. Try again from the Library section.`;
      later.disabled = false;
      later.textContent = "Close";
    });
  }

  window.BleepLibraryView = {
    installType,
    ensureNeeds,
    needsFor,
    lastMessage: () => message,
    async init(options) {
      host = options || {};
      build();
      BleepModal.mount(root, () => window.BleepLibraryView.hide());
      setTimeout(async () => {
        await firstRun();
        if (host.standalone) await updatesPrompt();
      }, 600);
      // The standalone app has Security in its Settings section; plugin windows keep it here.
      if (host.settings) tabsEl.querySelector('[data-tab="security"]').remove();
    },
    async show() {
      if (window.BleepSettingsView && document.getElementById("settings")) window.BleepSettingsView.hide();
      if (window.BleepHelpView) window.BleepHelpView.hide();
      BleepModal.toggle(root, true);
      await refresh();
      if (status && !status.index.ok) native("libraryRefresh").then(() => setTimeout(refresh, 600));
    },
    hide() {
      if (!root) return;  // init() never ran (no library in this host)
      BleepModal.toggle(root, false);
    },
  };
})();
