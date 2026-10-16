// SPDX-License-Identifier: MIT
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

  /// Does the entry match every word (name, group, tags, description, author)?
  function matches(e, words) {
    if (!words.length || e.served) return true;
    const hay = [e.name, e.group, e.tags.join(" "), e.description, e.author].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  }

  /// Does the entry belong to a view? Views: "all", "project", "cell", "demo", "instrument", "effect", "module:<type>".
  function inView(e, view) {
    if (view === "all") return true;
    if (view === "project" || view === "cell" || view === "demo") return e.kind === view;
    if (view === "instrument") return playsAs(e) === "instrument" || playsAs(e) === "both";
    if (view === "effect") return playsAs(e) === "effect" || playsAs(e) === "both";
    if (view.startsWith("module:")) return e.kind === "demo" && e.module === view.slice(7);
    return false;
  }

  /// The entries to show: in the view, from one of the origins (a Set or array; empty means all), matching the query.
  function select(entries, opts) {
    const view = (opts && opts.view) || "all";
    const origins = new Set((opts && opts.origins) || []);
    const words = String((opts && opts.query) || "").toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => inView(e, view) && (!origins.size || origins.has(e.origin)) && matches(e, words));
  }

  /// How many entries a view holds for the chosen origins (the numbers in the browser's list of views); the query is ignored.
  function count(entries, view, origins) {
    return select(entries, { view, origins }).length;
  }

  /// The demos' modules as [[type, name], …] sorted by name.
  function modules(entries) {
    const m = new Map();
    for (const e of entries) if (e.kind === "demo" && e.module) m.set(e.module, e.group || e.module);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }

  window.BleepPresetIndex = { ORIGINS, ORIGIN_LABELS, entry, playsAs, matches, inView, select, count, modules };
})();
