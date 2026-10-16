// SPDX-License-Identifier: MIT
// help.js — the Help section of the board window: one tile per article of the documentation (help-articles.json, written by
// scripts/docs/build-help-index.py from website/content) and a search over the articles and the module manuals (help-search.json,
// the same ranking as the website's search box). A click opens the page on the site in the browser. The site is the Store's
// address, so Help is offered where the Store is.
//
//   BleepHelpView.init()      once, when the native side has a store (native "init" says so)
//   show() / hide()           the header's Help button
(function () {
  "use strict";
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, priv: P } = window.BleepSeal;
  let articles = null;        // help-articles.json: [{group, title, description, path}]
  let index = null;           // help-search.json: [{group, title, path, text}]
  let query = "";
  let siteUrl = "";           // the site's address, from the Store's settings
  let message = "";
  let root, body, noteEl, addressEl, searchEl;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const MAX_HITS = 20;
  const tokens = (q) => q.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);

  /// Every term must occur in the title or the text. A title hit weighs more than a text hit; the snippet is centred on the
  /// first text match. (The website's SearchBox.tsx, with more hits.)
  function search(q) {
    const terms = tokens(q);
    if (!terms.length) return [];
    const hits = [];
    for (const entry of index) {
      const title = entry.title.toLowerCase(), text = entry.text.toLowerCase();
      let score = 0, first = -1, ok = true;
      for (const t of terms) {
        const inTitle = title.includes(t), at = text.indexOf(t);
        if (!inTitle && at < 0) { ok = false; break; }
        if (inTitle) score += 10;
        if (at >= 0) {
          score += Math.min(text.split(t).length - 1, 5);
          if (first < 0 || at < first) first = at;
        }
      }
      if (!ok) continue;
      if (title.includes(q.toLowerCase().trim())) score += 5;
      const from = Math.max(0, (first < 0 ? 0 : first) - 40);
      hits.push({ entry, score, snippet: (from > 0 ? "… " : "") + entry.text.slice(from, from + 140) + (from + 140 < entry.text.length ? " …" : "") });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
  }

  /// `text` with the search terms wrapped in <mark>, as nodes (no markup from the docs is ever parsed).
  function marked(parent, text, terms) {
    if (!terms.length) { parent.appendChild(document.createTextNode(text)); return; }
    const re = new RegExp("(" + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    text.split(re).forEach((part, i) => {
      if (i % 2) parent.appendChild(el("mark", "", part)); else if (part) parent.appendChild(document.createTextNode(part));
    });
  }

  async function fetchJson(name, what) {
    try { return await (await fetch(name)).json(); }
    catch (e) { message = "The " + what + " could not be read."; return []; }
  }

  async function load() {
    if (!articles) articles = await fetchJson("help-articles.json", "help articles");
    if (!index) index = await fetchJson("help-search.json", "search index");
    const status = await native("storeStatus");
    siteUrl = ((status && status.settings && status.settings.storeUrl) || "").replace(/\/+$/, "");
    render();
  }

  async function open(article) {
    message = "";
    if (!siteUrl) message = "The address of the documentation is not known.";
    else if (!(await native("openUrl", siteUrl + article.path))) message = "The browser could not be opened for " + siteUrl + article.path;
    noteEl.textContent = message;
  }

  function render() {
    body.innerHTML = "";
    noteEl.textContent = message;
    addressEl.textContent = siteUrl ? "Opens in your browser · " + siteUrl : "";
    if (query.trim()) { renderHits(); return; }
    if (!articles.length) body.appendChild(el("div", "hp-empty", "No articles."));
    let grid = null, group = null;
    for (const a of articles) {
      if (a.group !== group) {
        group = a.group;
        body.appendChild(el("h3", "", group));
        grid = el("div", "hp-grid");
        body.appendChild(grid);
      }
      const tile = el("button", "hp-tile");
      tile.type = "button";
      tile.title = siteUrl + a.path;
      tile.appendChild(el("span", "hp-title", a.title));
      tile.appendChild(el("span", "hp-desc", a.description));
      tile.addEventListener("click", () => open(a));
      grid.appendChild(tile);
    }
  }

  function renderHits() {
    const hits = search(query), terms = tokens(query);
    if (!hits.length) { body.appendChild(el("div", "hp-empty", "Nothing found for “" + query.trim() + "”.")); return; }
    const list = el("div", "hp-hits");
    for (const { entry, snippet } of hits) {
      const row = el("button", "hp-hit");
      row.type = "button";
      row.title = siteUrl + entry.path;
      const title = el("span", "hp-title");
      marked(title, entry.title, terms);
      title.appendChild(el("span", "hp-group", entry.group));
      const text = el("span", "hp-desc");
      marked(text, snippet, terms);
      row.append(title, text);
      row.addEventListener("click", () => open(entry));
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  function build() {
    root = el("section");
    root.id = "help";
    root.hidden = true;
    const head = el("div", "st-head-line");
    head.appendChild(el("h2", "", "Help"));
    addressEl = el("span", "hp-address");
    head.appendChild(addressEl);
    root.appendChild(head);
    searchEl = el("input", "hp-search");
    searchEl.type = "search";
    searchEl.placeholder = "Search the documentation and the module manuals";
    searchEl.spellcheck = false;
    searchEl.autocomplete = "off";
    searchEl.addEventListener("input", () => { query = searchEl.value; render(); });
    searchEl.addEventListener("keydown", (e) => { if (e.key === "Escape") { searchEl.value = query = ""; render(); } });
    root.appendChild(searchEl);
    noteEl = el("div", "st-message");
    root.appendChild(noteEl);
    body = el("div", "hp-body");
    root.appendChild(body);
    document.body.appendChild(root);
  }

  P.BleepHelpView = {
    async init() {
      build();
      document.getElementById("sections").hidden = false;
      const btn = document.getElementById("sec-help");
      btn.hidden = false;
      btn.addEventListener("click", () => P.BleepHelpView.show());
      document.getElementById("sec-board").addEventListener("click", () => P.BleepHelpView.hide());
    },
    async show() {
      if (P.BleepStoreView) P.BleepStoreView.hide();
      if (P.BleepSettingsView && document.getElementById("settings")) P.BleepSettingsView.hide();
      document.body.classList.add("in-store");
      root.hidden = false;
      document.getElementById("sec-help").classList.add("on");
      document.getElementById("sec-board").classList.remove("on");
      await load();
      searchEl.focus();
    },
    hide() {
      if (!root || root.hidden) return;
      root.hidden = true;
      document.getElementById("sec-help").classList.remove("on");
    },
  };
})();
