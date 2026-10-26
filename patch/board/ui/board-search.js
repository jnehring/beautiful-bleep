// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-search.js — the search box (Tab on the canvas, or after dropping a cable on empty canvas): module types and cell presets.
//
//   P.BoardSearch.create(env)   env: { $, el, canvas, board, typeList, presets(), compatible, offered, toWorld, addAt } (`board`, `typeList`: getters)
//     returns { open(x, y, link), close(), isOpen() }; `link`: {from, type} of the cable that was dropped, so only what it can connect to is offered.
(function () {
  "use strict";
  const { priv: P } = window.BleepSeal;

  P.BoardSearch = {
    create(env) {
      const { $, el, canvas } = env;
      let searchState = null;  // {x, y, link, items, active}
      function openSearch(x, y, link) {
        if (!env.board) return;
        const s = $("search");
        s.hidden = false;
        s.style.left = Math.min(x, canvas.clientWidth - 270) + "px";
        s.style.top = Math.min(y, canvas.clientHeight - 340) + "px";
        searchState = { x, y, link, items: [], active: 0 };
        const input = $("search-input");
        input.value = "";
        renderSearch();
        input.focus();
      }
      // Lower is better: exact name, name prefix, word-prefix in the name, name substring, then matches only via category/tags/description.
      function nameRank(name, q) {
        const n = name.toLowerCase();
        if (n === q) return 0;
        if (n.startsWith(q)) return 1;
        if (n.split(/[\s\-_/]+/).some((w) => w.startsWith(q))) return 2;
        if (n.includes(q)) return 3;
        return 4;
      }
      function searchItems(q) {
        const out = [];
        const link = searchState && searchState.link;
        const accepts = (t) => !link || t.inputs.some((i) => env.compatible(link.type, i.type)) ||
          (link.type !== "notes" && t.params.some((p) => p.modulatable && p.kind === "float"));
        for (const t of env.typeList)
          if (env.offered(t) && accepts(t) && (t.name + " " + t.category).toLowerCase().includes(q))
            out.push({ label: t.name === "Cell" ? "New Cell" : t.name === "Voice Cell" ? "New Voice Cell" : t.name,
                       sub: t.category.replace(/\//g, " › "), hint: t.description, what: { type: t.type }, rank: nameRank(t.name, q) });
        if (!link)  // presets: every word in the name, category, tags or description
          for (const p of env.presets()) {
            const d = p.preset || {};
            const text = [p.name, p.category || "", d.description || "", ...(d.tags || [])].join(" ").toLowerCase();
            if (q.split(/\s+/).every((w) => text.includes(w)))
              out.push({ label: p.name, sub: "cell preset" + (p.category ? " · " + p.category.replace(/\//g, " › ") : ""),
                         hint: d.description, what: { preset: p.key }, rank: nameRank(p.name, q) });
          }
        return out.sort((a, b) => a.rank - b.rank);  // stable: ties keep modules before presets, then list order
      }
      function renderSearch() {
        const q = $("search-input").value.trim().toLowerCase();
        searchState.items = searchItems(q);
        searchState.active = Math.min(searchState.active, Math.max(0, searchState.items.length - 1));
        const list = $("search-list");
        list.innerHTML = "";
        searchState.items.forEach((it, i) => {
          const row = el("div", "s-item" + (i === searchState.active ? " active" : ""));
          row.append(el("span", "", it.label), el("span", "sub", it.sub));
          row.addEventListener("pointerdown", (e) => { e.preventDefault(); chooseSearch(i); });
          list.appendChild(row);
        });
        // The active item's description, under the list.
        const active = searchState.items[searchState.active], hint = $("search-hint");
        hint.textContent = (active && active.hint) || "";
        hint.hidden = !hint.textContent;
        if (list.children[searchState.active]) list.children[searchState.active].scrollIntoView({ block: "nearest" });
      }
      function chooseSearch(i) {
        const it = searchState && searchState.items[i];
        const st = searchState;
        closeSearch();
        if (!it) return;
        const r = canvas.getBoundingClientRect();
        const w = env.toWorld(st.x + r.left, st.y + r.top);
        env.addAt(it.what, w.x, w.y - 12, st.link);
      }
      function closeSearch() {
        $("search").hidden = true;
        searchState = null;
        canvas.focus();
      }
      $("search-input").addEventListener("input", () => { searchState.active = 0; renderSearch(); });
      $("search-input").addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { searchState.active++; renderSearch(); e.preventDefault(); }
        else if (e.key === "ArrowUp") { searchState.active = Math.max(0, searchState.active - 1); renderSearch(); e.preventDefault(); }
        else if (e.key === "Enter") { chooseSearch(searchState.active); e.preventDefault(); }
        else if (e.key === "Escape" || e.key === "Tab") { closeSearch(); e.preventDefault(); }
        e.stopPropagation();
      });
      $("search-input").addEventListener("blur", () => setTimeout(() => { if (searchState) closeSearch(); }, 100));

      return { open: openSearch, close: closeSearch, isOpen: () => !!searchState };
    },
  };
})();
