// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-menus.js — adding modules and cells, the Add menu, the context menus of nodes and cells, and renaming.
//
// P.BoardMenus.create(s)   s: the board and page helpers it needs (see the destructuring below); `board`, `types`, `ports`, `standalone`, `typeList` are getters.
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardMenus = {
    create(s) {
            const { $, APP_PORTS, NODE_W, buildPanel, canBypass, canDuplicate, canGroup, canGroupVoice, canvas,
              closeSearch, compatible, connect, controllerMenuItems, copy, credits, cut, deleteSelection,
              descendants, duplicate, edit, el, enterCell, group, insertPreset, insideVoiceCell, isBoundary,
              isCellLike, isFixedBoundary, isFixedPort, isPort, isStructural, level, levelKey, newPanel, nodeById,
              nodesAt, nodesEl, notice, openPanel, panelOpen, panelsOfCell, paste, presetCategories, presetList,
              presetOrder, removeFromCell, render, savePreset, searchOpen, sel, setPresets, toWorld, toggleBypass,
              toggleMute, togglePanel, toggleTrace, toggleView, uid, ungroup, views } = s;
      function addAtCentre(what) {
        const r = canvas.getBoundingClientRect();
        const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
        addAt(what, w.x - NODE_W / 2, w.y - 40);
      }

      /// Adds a module, an empty cell or a cell preset at world position (x, y).
      /// `link` (from a cable dropped on empty canvas) is connected to the new node.
      function addAt(what, x, y, link, checked) {
        if (!s.board) return;
        if (what.preset && !what.audioReady) {   // the audio a preset carries (a sampler's reel) goes into the media folder first
          const q = presetList().find((r) => r.key === what.preset);
          if (q && q.preset.media && Object.keys(q.preset.media).length) {
            window.BleepMedia.importAll(q.preset.media, (name, data) => native("importMedia", name, data)).then((problems) => {
              if (problems.length) notice(`Some audio of “${q.name}” could not be imported: ${problems.join("; ")}`);
              addAt({ ...what, audioReady: true }, x, y, link, checked);
            });
            return;
          }
        }
        if (what.preset && !checked && !s.hasLibrary) {   // no library to ask (the web board): the cell runs the module versions it names
          const q = presetList().find((r) => r.key === what.preset);
          if (q && q.preset.needs && Object.keys(q.preset.needs).length) {
            P.BoardEdit.pinToMade(q.preset, s.types).then(() => addAt(what, x, y, link, true), () => addAt(what, x, y, link, true));
            return;
          }
        }
        if (what.preset && !checked && s.hasLibrary && P.BleepLibraryView) {  // modules the preset needs: offer to install them first
          const q = presetList().find((r) => r.key === what.preset);
          if (q) {
            P.BleepLibraryView.ensureNeeds(q.preset, q.name).then(
              (ok) => {
                if (!ok) return;
                // The library only knows the modules it lists or has installed. A preset may use module types this app has never
                // heard of (a newer module, one not installed on this machine): say so, the board keeps them as placeholders.
                const unknown = [...new Set((q.preset.nodes || []).map((n) => n.type))].filter((t) => !s.types[t]);
                if (unknown.length) notice(`“${q.name}” uses modules this app doesn't have: ${unknown.join(", ")}. They show as “not installed”.`);
                addAt(what, x, y, link, true);
              },
              (e) => {   // the library check itself failed or did not answer: the preset is still wanted
                notice(`Could not check the library for “${q.name}” (${e && e.message ? e.message : e}); adding it without.`);
                addAt(what, x, y, link, true);
              });
            return;
          }
        }
        // Don't land exactly on another node (e.g. several adds at the canvas centre).
        for (let i = 0; i < 20 && nodesAt(level()).some((n) => Math.abs(n.x - x) < 40 && Math.abs(n.y - y) < 40); i++) {
          x += 36;
          y += 36;
        }
        let newId = null;
        const placed = edit("add", (b) => {
          const lvl = level();
          if (what.preset) {
            const p = presetList().find((q) => q.key === what.preset);
            if (!p) return false;
            newId = insertPreset(b, p.preset, lvl, x, y, p.factory ? credits().factory(p.name) : null);
          } else if (what.type === "voice-cell") {
            newId = addVoiceCell(b, lvl, x, y);
            if (!newId) return false;
          } else if (what.type === "cell") {
            newId = uid("c");
            b.nodes.push({ id: newId, type: "cell", name: "Cell", x: Math.round(x), y: Math.round(y), parent: lvl,
                           params: {}, inputs: [], outputs: [] });
            b.nodes.push({ id: uid("ci"), type: "cell-in", name: "Cell In", x: 40, y: 120, parent: newId, params: {} });
            b.nodes.push({ id: uid("co"), type: "cell-out", name: "Cell Out", x: 640, y: 120, parent: newId, params: {} });
          } else {
            const t = s.types[what.type];
            if (!t) return false;
            newId = uid("n");
            const params = {};
            for (const p of t.params) params[p.id] = p.default;
            const node = { id: newId, type: t.type, name: t.name, x: Math.round(x), y: Math.round(y), parent: lvl, params };
            if (t.port) {  // a port the user adds (MIDI Device): the app follows it by this id
              if (lvl) return false;  // ports live on the top level (spec §6)
              node.port = what.port || uid("mdev-");  // an app port (standalone): the one the user picked
              if (what.port && what.name) node.name = node.track = what.name;
            }
            b.nodes.push(node);
            if (t.memoryHeavy && lvl && insideVoiceCell(lvl, b))
              notice(`${t.name} uses a lot of memory: inside a Voice Cell it runs once per voice.`);
            if (link) {
              const j = t.inputs.find((i) => compatible(link.type, i.type));
              if (j) connect(b, link.from, { node: newId, jack: j.id }, 1);
              else if (link.type !== "notes" && t.params.find((p) => p.modulatable && p.kind === "float"))
                connect(b, link.from, { node: newId, jack: t.params.find((p) => p.modulatable && p.kind === "float").id }, 1);
            }
          }
          sel.clear();
          sel.add(newId);
        });
        // The app answers every edit with the board it kept: say so when it did not keep what was just placed.
        Promise.resolve(placed).then(() => {
          if (newId && s.board && !nodeById(newId)) notice(`The app did not keep the ${what.preset ? "cell" : "module"} you added. Check the Library section for modules that failed to load.`);
        }).catch((e) => notice(`Could not add it: ${e && e.message ? e.message : e}`));
      }

      /// A Dial, Button or Keyboard module for a panel control, in `b`: inside the panel's cell (a Keyboard next to it,
      /// since its notes go in through the cell's Notes jack), or on the board. Returns its id.
      function addControlModule(b, panel, type, name) {
        const t = s.types[type];
        if (!t) return null;
        const cell = panel.cell && nodeById(panel.cell, b);
        let lvl = cell ? cell.id : "";
        if (cell && type === "keyboard") lvl = cell.parent || "";
        const mine = b.nodes.filter((n) => (n.parent || "") === lvl && !(b.panels || []).some((q2) => (q2.modules || []).includes(n.id)));
        const id = uid("n");
        const params = {};
        for (const p of t.params) params[p.id] = p.default;
        b.nodes.push({ id, type: t.type, name: name || t.name, x: 0, y: 0, parent: lvl, params });
        (panel.modules || (panel.modules = [])).push(id);
        if (!panel.groups) panel.groups = {};
        if (!panel.groups[levelKey(lvl)]) panel.groups[levelKey(lvl)] = { x: 40, y: mine.length ? Math.max(...mine.map((n) => n.y)) + 170 : 40 };
        return id;
      }

      /// A Voice Cell with its fixed nodes and a starter voice (spec §8.3.3):
      /// Oscillator → VCA, an ADSR on the VCA's gain and on Voice Out's Active.
      function addVoiceCell(b, lvl, x, y) {
        if (lvl && insideVoiceCell(lvl, b)) return null;  // no nesting
        const id = uid("vc");
        const vt = s.types["voice-cell"];
        const params = {};
        for (const p of vt.params) params[p.id] = p.default;
        const defaults = (type) => Object.fromEntries(s.types[type].params.map((p) => [p.id, p.default]));
        const n = (nid, type, name, nx, ny, extra) =>
          Object.assign({ id: nid, type, name, x: nx, y: ny, parent: id, params: s.types[type] ? defaults(type) : {} }, extra || {});
        const vin = uid("vi"), vout = uid("vo"), osc = uid("n"), env = uid("n"), amp = uid("n");
        b.nodes.push({ id, type: "voice-cell", name: "Voice Cell", x: Math.round(x), y: Math.round(y), parent: lvl,
                       params, inputs: [], outputs: [] },
          n(vin, "voice-in", "Voice In", 40, 60), n(vout, "voice-out", "Voice Out", 900, 80),
          n(uid("co"), "cell-out", "Cell Out", 900, 460),
          n(osc, "oscillator", "Oscillator", 320, 40), n(env, "adsr", "ADSR", 320, 260), n(amp, "vca", "VCA", 620, 80));
        const k = (fn, fj, tn, tj) => ({ id: uid("k"), from: { node: fn, jack: fj }, to: { node: tn, jack: tj }, amount: 1 });
        b.cables.push(k(vin, "pitch", osc, "pitch"), k(vin, "gate", env, "gate"), k(vin, "trigger", env, "retrig"),
          k(vin, "velocity", env, "velocity"), k(osc, "out", amp, "l"), k(env, "env", amp, "gain"),
          k(amp, "l", vout, "l"), k(amp, "r", vout, "r"), k(env, "active", vout, "active"));
        return id;
      }

      /// Right-click → Make Voice Cell: an ordinary cell gets Voice In and Voice Out (spec §8.3.3).
      function makeVoiceCell(cellId) {
        edit("make voice cell", (b) => {
          const cell = nodeById(cellId, b);
          if (!cell || cell.type !== "cell" || insideVoiceCell(cell.parent, b)) return false;
          if (descendants(cellId, b).some((d) => d.type === "voice-cell" || isPort(d))) return false;
          cell.type = "voice-cell";
          cell.params = Object.fromEntries(s.types["voice-cell"].params.map((p) => [p.id, p.default]));
          const kids = b.nodes.filter((m) => m.parent === cellId);
          const x0 = Math.min(...kids.map((m) => m.x), 300), x1 = Math.max(...kids.map((m) => m.x), 600);
          b.nodes.push({ id: uid("vi"), type: "voice-in", name: "Voice In", x: x0 - 280, y: 40, parent: cellId, params: {} },
                       { id: uid("vo"), type: "voice-out", name: "Voice Out", x: x1 + 280, y: 40, parent: cellId, params: {} });
        });
      }


      /// Types this board offers (MIDI Device only in the standalone app, spec §12).
      const offered = (t) => t.creatable && (!t.standaloneOnly || s.standalone) &&
        !((t.type === "cell-in" || t.type === "cell-out") && !level());  // boundaries live inside a cell

      /// The Add menu (spec §9.6): Module › category › modules; Cell › new cells and presets by category.
      /// `at` is a canvas position, or null for the middle of the canvas.
      function addMenu(at) {
        const place = (what) => () => {
          if (!at) return addAtCentre(what);
          const r = canvas.getBoundingClientRect();
          const w = toWorld(at.x + r.left, at.y + r.top);
          addAt(what, w.x, w.y);
        };
        // A category path nests: "Drums/Ring" is Module › Drums › Ring.
        const cats = [];
        const submenu = (items, label) => {
          let m = items.find((it) => it.items && it.label === label);
          if (!m) items.push(m = { label, items: [] });
          return m.items;
        };
        for (const t of s.typeList)
          if (offered(t) && t.category !== "Cells")
            t.category.split("/").reduce(submenu, cats).push({ label: t.name, hint: t.description, run: place({ type: t.type }) });
        const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
        // Subcategories first, then the modules, each A–Z.
        const sortTree = (items) => {
          items.sort((a, b) => !a.items - !b.items || byLabel(a, b));
          for (const it of items) if (it.items) sortTree(it.items);
          return items;
        };
        sortTree(cats);
        const hintOf = (type) => s.types[type] && s.types[type].description;  // the hover line under the menu
        const cells = [{ label: "New Cell", hint: hintOf("cell"), run: place({ type: "cell" }) },
                       { label: "New Voice Cell", hint: hintOf("voice-cell"), run: place({ type: "voice-cell" }) }];
        if (level()) cells.push("-", { label: "Cell In", hint: hintOf("cell-in"), run: place({ type: "cell-in" }) },
                                    { label: "Cell Out", hint: hintOf("cell-out"), run: place({ type: "cell-out" }) });
        const byCat = presetCategories();
        if (byCat.size) cells.push("-");
        // Preset categories nest like module categories: "Drums/Kicks" is Cell › Drums › Kicks.
        // Factory presets keep their authored order; the user's own follow, A–Z.
        const tree = [];
        for (const [cat, list] of byCat) {
          const items = cat.split("/").reduce(submenu, tree);
          const entry = (p) => ({ label: p.name, hint: p.preset && p.preset.description, run: place({ preset: p.key }) });
          const own = list.filter((p) => !p.factory).sort((a, b) => byLabel({ label: a.name }, { label: b.name }));
          items.push(...list.filter((p) => p.factory).map(entry), ...own.map((p) => Object.assign(entry(p), { own: true })));
          if (own.length)  // the user's own presets can be deleted here
            items.push({ label: "Delete preset", deletes: true, items: own.map((p) => ({
              label: p.name, run: async () => setPresets((await native("deletePreset", p.name)) || []) })) });
        }
        // Categories A–Z at every level.
        const sortPresets = (items) => {
          const subs = items.filter((it) => it.items && !it.deletes).sort(byLabel);
          const factory = items.filter((it) => !it.items && !it.own), own = items.filter((it) => it.own);
          const del = items.filter((it) => it.deletes);
          for (const it of subs) it.items = sortPresets(it.items);
          return [...subs, ...factory, ...(factory.length && own.length ? ["-"] : []), ...own, ...(del.length ? ["-", ...del] : [])];
        };
        cells.push(...sortPresets(tree));
        const menu = [{ label: "Module", items: cats }, { label: "Cell", items: cells }];
        // The standalone app's own ports that are not on the board (audio channels, MIDI, Link).
        if (s.standalone && !level()) {
          const free = Object.entries(s.ports)
            .filter(([id, p]) => APP_PORTS.has(p.kind) && !s.board.nodes.some((n) => n.port === id))
            .map(([id, p]) => ({ id, p, t: Object.values(s.types).find((t) => t.port === p.kind) }))
            .filter((e) => e.t);
          if (free.length)
            menu.push({ label: "Port", items: free.map(({ id, p, t }) => ({
              label: p.kind === "link" ? t.name : `${p.track || t.name} · ${t.name}`, run: place({ type: t.type, port: id, name: p.track || t.name }) })) });
        }
        return menu;
      }

      // ------------------------------------------------------------------ menus
      /// Menus; an item with `items` opens a submenu to its right on hover.
      function showMenu(ev, items) {
        closeSubmenus(0);
        const m = $("menu");
        fillMenu(m, items, 0);
        const r = canvas.getBoundingClientRect();
        m.hidden = false;
        // The canvas is clipped, not scrolled, yet the browser may scroll it to reveal a focused panel window: positions follow its scroll.
        m.style.left = Math.max(4, Math.min(ev.clientX - r.left, canvas.clientWidth - m.offsetWidth - 8)) + canvas.scrollLeft + "px";
        m.style.top = Math.max(4, Math.min(ev.clientY - r.top, canvas.clientHeight - m.offsetHeight - 8)) + canvas.scrollTop + "px";
      }
      const submenus = [];
      function closeSubmenus(depth) {
        while (submenus.length > depth) submenus.pop().remove();
      }
      function fillMenu(m, items, depth) {
        m.innerHTML = "";
        // Items with a hint (preset descriptions) show it in a line under the menu while hovered.
        const hint = items.some((it) => it && it.hint) ? el("div", "m-hint") : null;
        for (const it of items) {
          if (it === "-") { m.appendChild(el("div", "m-sep")); continue; }
          const row = el("div", "m-item" + (it.disabled ? " disabled" : "") + (it.items ? " has-sub" : ""));
          row.append(el("span", "", it.label));
          if (it.key) row.appendChild(el("span", "key", it.key));
          if (it.items) row.appendChild(el("span", "key", "›"));
          // Run on click, and keep focus where it is: the action may open a text field.
          row.addEventListener("pointerdown", (e) => e.stopPropagation());
          row.addEventListener("mousedown", (e) => e.preventDefault());
          row.addEventListener("mouseenter", () => {
            closeSubmenus(depth);
            if (it.items && !it.disabled) openSubmenu(row, it.items, depth);
            if (hint) hint.textContent = it.hint || "";
          });
          row.addEventListener("click", (e) => {
            e.stopPropagation();
            if (it.items) return;
            hidePopovers();
            it.run();
          });
          m.appendChild(row);
        }
        if (hint) m.appendChild(hint);
      }
      function openSubmenu(row, items, depth) {
        const sm = el("div", "popover submenu");
        canvas.appendChild(sm);
        submenus.push(sm);
        fillMenu(sm, items, depth + 1);
        const r = canvas.getBoundingClientRect(), rr = row.getBoundingClientRect();
        let x = rr.right - r.left + 2;
        if (x + sm.offsetWidth > canvas.clientWidth - 4) x = rr.left - r.left - sm.offsetWidth - 2;
        sm.style.left = Math.max(4, x) + canvas.scrollLeft + "px";
        sm.style.top = Math.max(4, Math.min(rr.top - r.top - 4, canvas.clientHeight - sm.offsetHeight - 8)) + canvas.scrollTop + "px";
      }
      /// The help of a cell (its `help: {text, images}` metadata, copied from the preset): paragraphs, then the images, in a popover
      /// under the "?" button. Built from nodes: the text is never parsed as markup.
      function showCellHelp(n, anchor) {
        hidePopovers();
        const pop = $("help-pop");
        pop.innerHTML = "";
        pop.appendChild(el("div", "h-title", n.name));
        for (const para of n.help.text.split(/\n\s*\n/)) pop.appendChild(el("p", "", para.replace(/\s*\n\s*/g, " ")));
        for (const im of n.help.images || []) {
          const fig = el("figure", "h-fig");
          const img = el("img");
          img.src = im.src;
          img.alt = im.alt || "";
          img.addEventListener("error", () => fig.remove());  // a missing picture leaves the text alone
          fig.appendChild(img);
          if (im.caption) fig.appendChild(el("figcaption", "", im.caption));
          pop.appendChild(fig);
        }
        // Credits: the presets this cell was copied from (text nodes only).
        const made = credits().merge(n.credits);
        if (made.length) {
          const line = el("p", "h-credits", "Based on " + made.map((c) => c.name + (c.author ? " by " + c.author : "")).join(", ") + " (" + made[0].license + ").");
          pop.appendChild(line);
        }
        pop.hidden = false;
        const r = anchor.getBoundingClientRect(), host = pop.offsetParent ? pop.offsetParent.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
        const x = Math.min(r.left - host.left, Math.max(0, host.width - pop.offsetWidth - 8));
        const y = Math.min(r.bottom - host.top + 4, Math.max(0, host.height - pop.offsetHeight - 8));
        pop.style.left = Math.max(0, x) + "px";
        pop.style.top = Math.max(0, y) + "px";
      }

      function hidePopovers() {
        closeSubmenus(0);
        $("menu").hidden = true;
        $("cable-pop").hidden = true;
        $("help-pop").hidden = true;
        if (searchOpen()) closeSearch();
      }

      function showNodeMenu(n, ev) {
        const items = [];
        if (!isStructural(n)) items.push({ label: views.has(n.id) ? "Close view" : "Open view", run: () => toggleView(n.id) });
        if (isCellLike(n)) {
          const mine = panelsOfCell(n.id);
          for (const p of mine) {
            const suffix = mine.length > 1 ? " “" + p.name + "”" : "";
            items.push({ label: (panelOpen(p.id) ? "Close panel" : "Open panel") + suffix, run: () => togglePanel(p.id) });
            items.push({ label: "Edit panel" + suffix, run: () => openPanel(p.id, { edit: true }) });
          }
          items.push({ label: "New panel", run: () => newPanel(n.id) });
          items.push({ label: "Build panel from cell", run: () => buildPanel(n.id) });
        }
        if (isCellLike(n)) items.push({ label: "Enter cell", key: "dbl-click", run: () => enterCell(n.id) });
        items.push(...controllerMenuItems(n));
        items.push({ label: "Rename", run: () => startRename(n, nodesEl.querySelector(`[data-id="${n.id}"]`)) });
        if (!isStructural(n)) items.push({ label: n.muted ? "Unmute" : "Mute", key: "M", run: toggleMute });
        if (canBypass(n)) items.push({ label: n.bypassed ? "Switch on (end bypass)" : "Bypass", run: () => toggleBypass(n.id) });
        items.push("-");
        items.push({ label: "Cut", key: "⌘X", run: cut, disabled: !canDuplicate() });
        items.push({ label: "Copy", key: "⌘C", run: copy, disabled: !canDuplicate() });
        items.push({ label: "Paste", key: "⌘V", run: () => paste() });
        items.push({ label: "Duplicate", key: "⌘D", run: () => duplicate(false), disabled: !canDuplicate() });
        items.push({ label: "Create cell", key: "⌘G", run: () => group(), disabled: !canGroup() });
        items.push({ label: "Create voice cell", run: () => group("voice"), disabled: !canGroupVoice() });
        if (level() && !isPort(n) && !isBoundary(n)) items.push({ label: "Remove from cell", run: removeFromCell });
        if (isCellLike(n)) items.push({ label: "Unbuild cell", key: "⌘⇧G", run: () => ungroup(n.id), disabled: insideVoiceCell(n.parent) && n.type === "voice-cell" });
        if (n.type === "cell") {
          items.push({ label: "Make Voice Cell", run: () => makeVoiceCell(n.id), disabled: insideVoiceCell(n.parent) });
        }
        if (isCellLike(n)) items.push({ label: "Save as preset…", run: () => savePreset(n) });
        items.push({ label: "Trace signal flow", key: "T", run: toggleTrace });
        items.push("-");
        items.push({ label: "Delete", key: "⌫", run: deleteSelection, disabled: isFixedPort(n) || isFixedBoundary(n) });
        showMenu(ev, items);
      }

      // -------------------------------------------------------------- renaming
      function startRename(n, nodeEl) {
        if (!nodeEl) return;
        const title = nodeEl.querySelector(".n-title");
        const input = el("input", "n-rename");
        input.value = n.name;
        input.maxLength = 63;
        title.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          const name = input.value.trim();
          if (save && name && name !== n.name) edit("rename", (b) => { nodeById(n.id, b).name = name; });
          else render();
        };
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
      }

      return {
        addAtCentre, addAt, addControlModule, offered, addMenu, showMenu, closeSubmenus, showCellHelp,
        hidePopovers, showNodeMenu, startRename,
      };
    },
  };
})();
