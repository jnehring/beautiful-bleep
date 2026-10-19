// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// preset-index.js — one list for every kind of preset the browser shows (doc/specs/preset-system-plan.md, sections 1 and 4).
//
// Every preset is an entry with a kind and an origin, wherever it comes from:
//
//   kind     "project"  a whole board (Mine, Library)
//            "cell"     a cell preset, placed on the board
//            "demo"     a demo board of one module (five per advanced module)
//   origin   "factory"  ships with the app
//            "user"     made by the person using it
//            "community" shared in the Bleep Library
//
// The browser builds the entries from its sources and asks `select` what to show for a view and the chosen origins. No DOM here.
(function () {
  "use strict";

  const ORIGINS = ["factory", "user", "community"];
  const ORIGIN_LABELS = { factory: "Factory", user: "Mine", community: "Community" };

  /// An entry with every field present. `ref` is whatever the browser needs to load it (its source object).
  function entry(o) {
    const origin = ORIGINS.includes(o.origin) ? o.origin : "user";
    return {
      kind: o.kind,
      origin,
      name: String(o.name || ""),
      group: o.group || "",                      // cells: the category; demos: the module's name; projects: ""
      module: o.module || "",                    // demos: the module type
      description: o.description || "",
      tags: Array.isArray(o.tags) ? o.tags : [],
      plays: o.plays && typeof o.plays === "object" ? o.plays : null,   // {instrument?, effect?}: what a plugin can load it as
      author: o.author || "",
      served: !!o.served,                        // already filtered by the server (Library search): not matched against the words again
      current: !!o.current,
      ref: o.ref,
    };
  }

  /// "instrument", "effect" or "both" when the entry can be loaded as a plugin preset, else "".
  function playsAs(e) {
    const i = !!(e.plays && e.plays.instrument), f = !!(e.plays && e.plays.effect);
    return i && f ? "both" : i ? "instrument" : f ? "effect" : "";
  }

  /// Are two words the same but for one typo (a letter changed, left out, added or swapped with the next)?
  function near(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
  }

  /// Does one word match the text: as a piece of it, or (from four letters on, same first letter) as the start of one of its words
  /// within one typo? "gran" finds "Grains".
  function wordMatches(hay, tokens, w) {
    if (hay.includes(w)) return true;
    if (w.length < 4) return false;
    return tokens.some((t) => t[0] === w[0] && (near(w, t.slice(0, w.length)) || near(w, t.slice(0, w.length + 1)) || near(w, t.slice(0, w.length - 1))));
  }

  /// Does a text match every word of a search (lower-case words)? `exact`: only whole pieces, no typos.
  function textMatches(text, words, exact) {
    if (!words.length) return true;
    const hay = String(text).toLowerCase();
    if (exact) return words.every((w) => hay.includes(w));
    const tokens = hay.split(/[^a-z0-9\u00c0-\u024f]+/).filter(Boolean);
    return words.every((w) => wordMatches(hay, tokens, w));
  }

  const haystack = (e) => [e.name, e.group, e.tags.join(" "), e.description, e.author].join(" ");

  /// Does the entry match every word (name, group, tags, description, author), typos allowed?
  function matches(e, words, exact) {
    if (!words.length || e.served) return true;
    return textMatches(haystack(e), words, exact);
  }

  /// Does the entry belong to a view? Views: "all", "project" (saved, shared and factory projects), "cell", "demo" (factory projects), "instrument", "effect", "module:<type>", "cell:<category path>".
  function inView(e, view) {
    if (view === "all") return true;
    // The factory projects are "demos" (listed by module as well) and are projects too.
    if (view === "project") return e.kind === "project" || e.kind === "demo";
    if (view === "cell" || view === "demo") return e.kind === view;
    // A cell can be loaded as an instrument or effect (`plays`); a factory project says what it is with a tag.
    const tagged = (role) => e.kind === "demo" && e.tags.includes(role);
    if (view === "instrument") return playsAs(e) === "instrument" || playsAs(e) === "both" || tagged("instrument");
    if (view === "effect") return playsAs(e) === "effect" || playsAs(e) === "both" || tagged("effect");
    if (view.startsWith("module:")) return e.kind === "demo" && e.module === view.slice(7);
    if (view.startsWith("cell:")) {   // a category of cell presets and what is below it ("Drums" holds "Drums/Kicks")
      const cat = view.slice(5);
      return e.kind === "cell" && (e.group === cat || e.group.startsWith(cat + "/"));
    }
    return false;
  }

  /// The entries to show: in the view, from one of the origins (a Set or array; empty means all), matching the query.
  function select(entries, opts) {
    const view = (opts && opts.view) || "all";
    const origins = new Set((opts && opts.origins) || []);
    const words = String((opts && opts.query) || "").toLowerCase().split(/\s+/).filter(Boolean);
    const found = entries.filter((e) => inView(e, view) && (!origins.size || origins.has(e.origin)) && matches(e, words));
    // What matches as typed comes before what only matches with a typo allowed.
    return words.length ? [...found.filter((e) => matches(e, words, true)), ...found.filter((e) => !matches(e, words, true))] : found;
  }

  /// How many entries a view holds for the chosen origins (the numbers in the browser's list of views); the query is ignored.
  function count(entries, view, origins) {
    return select(entries, { view, origins }).length;
  }

  const sorted = (kids) => [...kids].sort((a, b) => a.name.localeCompare(b.name));

  /// The categories of the cell presets as a tree, sorted A–Z at every level: [{name, path, children: […]}].
  /// A category is a path with slashes ("Drums/Kicks"); `path` is what the view "cell:<path>" takes.
  function categories(entries) {
    const top = { kids: [], by: new Map() };
    for (const e of entries) {
      if (e.kind !== "cell" || !e.group) continue;
      let node = top, path = "";
      for (const part of e.group.split("/")) {
        path = path ? path + "/" + part : part;
        let c = node.by.get(part);
        if (!c) { c = { name: part, path, kids: [], by: new Map() }; node.by.set(part, c); node.kids.push(c); }
        node = c;
      }
    }
    const plain = (n) => ({ name: n.name, path: n.path, children: sorted(n.kids).map(plain) });
    return sorted(top.kids).map(plain);
  }

  /// The demos' modules as [[type, name], …] sorted by name.
  function modules(entries) {
    const m = new Map();
    for (const e of entries) if (e.kind === "demo" && e.module) m.set(e.module, e.group || e.module);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }

  window.BleepPresetIndex = { ORIGINS, ORIGIN_LABELS, entry, playsAs, matches, textMatches, inView, select, count, modules, categories };
})();
