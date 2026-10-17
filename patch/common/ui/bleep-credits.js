// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep-credits.js — the credits of a preset (doc/specs/preset-system-plan.md, section 3).
//
// A preset is copied, never referenced. Where it came from is only a label: a list of credits that travels with the copy.
//
//   credit = { name, author, address?, license }
//     name     the preset's title
//     author   who made it ("bleep" for the factory presets)
//     address  "<author handle>/<slug>" in the Bleep Library, if it has one; used to find "used in", never fetched on load
//     license  "CC-BY-4.0" (every shared preset)
//
// A cell carries its credits as `credits` on the cell node (like `help`); a saved cell preset, a project file and a shared preset
// carry the credits of everything inside them. The list is plain data: the user may edit it, the Library only reads it.
(function () {
  "use strict";

  const MAX_CREDITS = 50;
  const LICENSE = "CC-BY-4.0";
  const LIMITS = { name: 120, author: 80, address: 130, license: 40 };

  const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

  /// One credit, cleaned: only the known fields, trimmed and cut to length; null without a name.
  function clean(c) {
    if (!c || typeof c !== "object") return null;
    const name = clip(c.name, LIMITS.name);
    if (!name) return null;
    const out = { name, author: clip(c.author, LIMITS.author) };
    const address = clip(c.address, LIMITS.address);
    if (address) out.address = address;
    out.license = clip(c.license, LIMITS.license) || LICENSE;
    return out;
  }

  /// What makes two credits the same preset: the address, or else author and name.
  function key(c) {
    return (c.address || c.author + "/" + c.name).toLowerCase();
  }

  /// Several lists as one: cleaned, without repeats (the first one stays), at most MAX_CREDITS. Anything that is not a list counts as empty.
  function merge(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const c = clean(raw);
        if (!c || seen.has(key(c))) continue;
        seen.add(key(c));
        out.push(c);
        if (out.length >= MAX_CREDITS) return out;
      }
    }
    return out;
  }

  /// The credit for a factory preset.
  function factory(name) {
    return { name, author: "bleep", license: LICENSE };
  }

  /// The credit for a Library preset. `address` is "<author>/<slug>"; the author defaults to its first part.
  function library(name, address, author) {
    const a = typeof address === "string" ? address : "";
    return { name, author: author || a.split("/")[0] || "", address: a, license: LICENSE };
  }

  /// The credits of a set of nodes (the cells among them), merged.
  function collect(nodes) {
    return merge(...(nodes || []).map((n) => n && n.credits));
  }

  /// Stamps the credits on a cell node: its own list plus `extra` (a list or one credit); removes the field when there are none.
  function stamp(node, ...extra) {
    const list = merge(node.credits, ...extra.map((e) => (Array.isArray(e) ? e : e ? [e] : [])));
    if (list.length) node.credits = list;
    else delete node.credits;
    return node;
  }

  window.BleepCredits = { MAX_CREDITS, LICENSE, clean, key, merge, factory, library, collect, stamp };
})();
