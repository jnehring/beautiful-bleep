// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-edit.js — what the user does to the selection: delete, bypass, mute, duplicate, copy, cut and paste (spec §9.6).
//
// P.BoardEdit.create(s)   s: the board and page helpers it needs (see the destructuring below); `board`, `types`, `selCable`, `pointer`, `pointerInside` are getters.
//   returns { selectedNodes, canDuplicate, canGroup, selectAll, deleteSelection, canBypass, setPowerButton, toggleBypass, toggleMute, duplicate, copy, cut, paste }
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardEdit = {
    /// Where no dialog asks (the web board runs the version a project, cell or paste names): the nodes of `preset` that come from a
    /// module this page runs in another version than its `needs` say get pinned to that version, and the page loads it. `types` is the
    /// board's type table: the older version's description is put in, so the nodes are known at once. The app asks instead (library.js).
    async pinToMade(preset, types) {
      const needs = preset && preset.needs;
      if (!needs || !Object.keys(needs).length || !Array.isArray(preset.nodes)) return;
      if (P.BleepLibraryView && document.getElementById("library")) return;
      let have;
      try { have = await native("moduleNeeds", [...new Set(preset.nodes.map((n) => n.type))]); } catch (e) { return; }
      const pins = [];
      for (const [slug, h] of Object.entries(have || {})) {
        const made = needs[slug] && needs[slug].version;
        if (!made || made === h.version) continue;
        for (const n of preset.nodes) if (h.types.includes(n.type)) { n.version = made; pins.push([n.type, made]); }
      }
      if (!pins.length) return;
      let specs = [];
      try { specs = (await native("loadVersions", pins)) || []; } catch (e) { /* the nodes wait as placeholders until the module arrives */ }
      for (const t of specs) types[t.type + "@" + t.version] = t;
    },
    create(s) {
      const { addPanels, canvas, clearCableSel, clone, closeView, descendants, edit, inVoiceCell, inputsOf,
              insideVoiceCell, isBoundary, isCellLike, isFixedBoundary, isFixedPort, isPort, isStructural, level,
              nodeById, nodesAt, notice, outputsOf, panelList, panelsWithLoaded, removeCables, renderSelection, sel,
              selectedCableIds, toWorld, uid } = s;
      function selectedNodes(b = s.board) { return [...sel].map((id) => nodeById(id, b)).filter(Boolean); }
      const canDuplicate = () => selectedNodes().some((n) => !isPort(n) && !isBoundary(n));
      const canGroup = () => selectedNodes().some((n) => !isPort(n) && !isBoundary(n));

      function selectAll() {
        sel.clear();
        for (const n of nodesAt(level())) sel.add(n.id);
        renderSelection();
      }

      /// True when deleting n would take the last Cell In / Cell Out of its cell, counting those already doomed.
      const doomedBoundary = (n, doomed) =>
        !s.board.nodes.some((m) => m.id !== n.id && m.parent === n.parent && m.type === n.type && !doomed.has(m.id));

      function deleteSelection(label = "delete") {
        if (s.selCable) return removeCables(selectedCableIds());
        const doomed = new Set();
        for (const n of selectedNodes()) {
          if (isFixedPort(n) || isFixedBoundary(n) ||  // spec §6, §8.3.1
              (isBoundary(n) && !(n.type === "cell-in" && inVoiceCell(n)) && doomedBoundary(n, doomed))) continue;
          doomed.add(n.id);
          if (isCellLike(n)) descendants(n.id).forEach((d) => doomed.add(d.id));
        }
        if (!doomed.size) return;
        for (const id of doomed) closeView(id);
        sel.clear();
        edit(label, (b) => {
          b.nodes = b.nodes.filter((n) => !doomed.has(n.id));
          b.cables = b.cables.filter((c) => !doomed.has(c.from.node) && !doomed.has(c.to.node));
        });
      }

      /// A module with audio in and audio out can be bypassed: its input audio goes straight to its output.
      function canBypass(n) {
        if (isPort(n) || isCellLike(n) || isStructural(n) || !s.types[n.version ? n.type + "@" + n.version : n.type]) return false;
        return inputsOf(n).some((j) => j.type === "audio") && outputsOf(n).some((j) => j.type === "audio");
      }
      function setPowerButton(b, n) {
        b.classList.toggle("on", !n.bypassed);
        b.title = n.bypassed ? "Bypassed: the audio passes through. Click to switch the module on." : "On. Click to bypass (pass the audio through unprocessed).";
        b.setAttribute("aria-label", "Power " + n.name);
        b.setAttribute("aria-pressed", n.bypassed ? "false" : "true");
      }
      function toggleBypass(id) {
        const n = nodeById(id);
        if (!n || !canBypass(n)) return;
        const on = !n.bypassed;
        edit(on ? "bypass" : "end bypass", (b) => { nodeById(id, b).bypassed = on; });
      }

      function toggleMute() {
        const ns = selectedNodes().filter((n) => !isStructural(n));
        if (!ns.length) return;
        const mute = !ns.every((n) => n.muted);
        edit(mute ? "mute" : "unmute", (b) => ns.forEach((n) => (nodeById(n.id, b).muted = mute)));
      }

      /// Copies nodes (cells with their contents) with fresh ids. Returns old → new id.
      function copyNodes(b, roots, dx, dy) {
        const map = new Map();
        const all = [];
        for (const r of roots) {
          all.push(r);
          if (isCellLike(r)) all.push(...descendants(r.id, b));
        }
        for (const n of all) map.set(n.id, uid(isCellLike(n) ? "c" : "n"));
        for (const n of all) {
          const c = clone(n);
          c.id = map.get(n.id);
          if (map.has(n.parent)) c.parent = map.get(n.parent);
          if (roots.includes(n)) { c.x += dx; c.y += dy; }
          delete c.port;
          b.nodes.push(c);
        }
        for (const c of [...b.cables])
          if (map.has(c.from.node) && map.has(c.to.node))
            b.cables.push({ id: uid("k"), from: { node: map.get(c.from.node), jack: c.from.jack },
                            to: { node: map.get(c.to.node), jack: c.to.jack }, amount: c.amount });
        addPanels(b, panelsWithLoaded(((s.board && s.board.panels) || []).filter((q) => q.cell && map.has(q.cell))), map);
        return map;
      }

      function duplicate(keepIncoming) {
        const roots = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
        if (!roots.length) return;
        edit("duplicate", (b) => {
          const rs = roots.map((r) => nodeById(r.id, b));
          const map = copyNodes(b, rs, 30, 30);
          if (keepIncoming)
            for (const c of [...b.cables])
              if (!map.has(c.from.node) && rs.some((r) => r.id === c.to.node))
                b.cables.push({ id: uid("k"), from: clone(c.from), to: { node: map.get(c.to.node), jack: c.to.jack },
                                amount: c.amount });
          sel.clear();
          rs.forEach((r) => sel.add(map.get(r.id)));
        });
      }

      /// ⌘C (spec §9.6): the selection (cells with their contents) and the cables
      /// between them go to the system clipboard as JSON, so they can be pasted
      /// into another cell, another set or another board window.
      const CLIP_FORMAT = "bleep-board-clip";
      function copy() {
        const roots = selectedNodes().filter((n) => !isPort(n) && !isBoundary(n));
        if (!roots.length) return false;
        const nodes = [];
        for (const r of roots) nodes.push(r, ...(isCellLike(r) ? descendants(r.id) : []));
        const ids = new Set(nodes.map((n) => n.id));
        const clip = {
          format: CLIP_FORMAT, version: 1,
          roots: roots.map((r) => r.id),
          nodes: nodes.map((n) => { const c = clone(n); delete c.port; return c; }),
          cables: s.board.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node)).map(clone),
          panels: clone(panelsWithLoaded(panelList().filter((q) => q.cell && ids.has(q.cell)))),
        };
        // What the modules were at: the paste checks it against its own (the clipboard may come from the web board or another machine).
        const write = () => native("copyText", JSON.stringify(clip));
        needsOf(clip.nodes).then((needs) => {
          if (needs && Object.keys(needs).length) clip.needs = Object.fromEntries(Object.entries(needs).map(([slug, v]) => [slug, { min: v.min, version: v.version }]));
        }, () => {}).then(write);
        return true;
      }

      /// `needs` for these nodes: each module and the version it is installed in (the app's Library, or the web board's loaded modules).
      async function needsOf(nodes) {
        if (P.BleepLibraryView && document.getElementById("library")) return P.BleepLibraryView.needsFor(nodes);
        return native("moduleNeeds", [...new Set(nodes.map((n) => n.type))]);
      }

      function cut() {
        if (!copy()) return;
        clearCableSel();
        deleteSelection("cut");
      }

      /// ⌘V: the clipboard's nodes land at the pointer (or `at`, in canvas
      /// coordinates), keeping their layout, with fresh ids; the paste is selected.
      async function paste(at) {
        if (!s.board) return;
        let clip = null;
        try { clip = JSON.parse(await native("pasteText")); } catch (e) { return notice("Nothing to paste: the clipboard holds no copied Bleep modules."); }
        if (!clip || clip.format !== CLIP_FORMAT || !Array.isArray(clip.nodes) || !Array.isArray(clip.roots))
          return notice("Nothing to paste: the clipboard holds no copied Bleep modules.");
        await P.BoardEdit.pinToMade(clip, s.types);
        const lvl = level();
        const byId = new Map(clip.nodes.map((n) => [n.id, n]));
        const known = (n) => isCellLike(n) || isBoundary(n) || !!s.types[n.version ? n.type + "@" + n.version : n.type];
        const unknownTypes = () => [...new Set(clip.nodes.filter((n) => !known(n)).map((n) => n.type))];
        // Modules this build lacks: offer them from the library first (the node types are known again once they are installed).
        // Also when the modules are all here: they may be installed in another version than the one these were copied from.
        const versioned = !!(clip.needs && Object.keys(clip.needs).length) || clip.nodes.some((n) => n.version);
        if ((unknownTypes().length || versioned) && s.hasLibrary && P.BleepLibraryView
            && !(await P.BleepLibraryView.ensureNeeds({ nodes: clip.nodes, needs: clip.needs }, "Pasted modules", { isKnown: (ty) => known({ type: ty }) }))) return;
        const missing = unknownTypes();
        const roots = clip.roots.map((id) => byId.get(id)).filter((n) => n && known(n) && !isPort(n) && !isBoundary(n)
          && !(n.type === "voice-cell" && insideVoiceCell(lvl)));  // no nesting
        if (!roots.length)
          return notice(missing.length ? "Nothing pasted: this build has no " + missing.join(", ") + "." : "Nothing pasted here.");
        if (missing.length) notice("Pasted without " + missing.join(", ") + ": this build does not have them.");
        // Each root's subtree (its contents, for cells).
        const all = [];
        const walk = (id) => { for (const n of clip.nodes) if (n.parent === id && known(n)) { all.push(n); if (isCellLike(n)) walk(n.id); } };
        for (const r of roots) { all.push(r); if (isCellLike(r)) walk(r.id); }
        // Top-left of the copied roots goes to the pointer; step aside from an exact overlap (repeated pastes).
        const x0 = Math.min(...roots.map((n) => n.x)), y0 = Math.min(...roots.map((n) => n.y));
        const r = canvas.getBoundingClientRect();
        const p = at || (s.pointerInside ? s.pointer : { x: r.width / 2, y: r.height / 2 });
        const w = toWorld(r.left + p.x, r.top + p.y);
        let dx = Math.round(w.x - x0), dy = Math.round(w.y - y0);
        const here = nodesAt(lvl);
        for (let i = 0; i < 20 && roots.some((n) => here.some((m) => Math.abs(m.x - n.x - dx) < 20 && Math.abs(m.y - n.y - dy) < 20)); i++) {
          dx += 30;
          dy += 30;
        }
        edit("paste", (b) => {
          const map = new Map(all.map((n) => [n.id, uid(isCellLike(n) ? "c" : "n")]));
          for (const n of all) {
            const c = clone(n);
            c.id = map.get(n.id);
            c.parent = roots.includes(n) ? lvl : map.get(n.parent);
            if (roots.includes(n)) { c.x += dx; c.y += dy; }
            delete c.port;
            b.nodes.push(c);
          }
          for (const c of clip.cables || [])
            if (c && c.from && c.to && map.has(c.from.node) && map.has(c.to.node))
              b.cables.push({ id: uid("k"), from: { node: map.get(c.from.node), jack: c.from.jack },
                              to: { node: map.get(c.to.node), jack: c.to.jack }, amount: c.amount });
          addPanels(b, Array.isArray(clip.panels) ? clip.panels : [], map);
          sel.clear();
          clearCableSel();
          roots.forEach((n) => sel.add(map.get(n.id)));
        });
      }

      return {
        selectedNodes, canDuplicate, canGroup, selectAll, deleteSelection, canBypass, setPowerButton,
        toggleBypass, toggleMute, duplicate, copy, cut, paste,
      };
    },
  };
})();
