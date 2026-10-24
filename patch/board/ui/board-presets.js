// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-presets.js — the cell presets of the Add menu (spec §9.6): the factory ones and the user's own, saving a cell as a
// preset, and placing a preset (or copied panels) into the board.
//
//   P.BoardPresets.create(env)   env: the board and page helpers it needs (see the destructuring below); `board` is a getter.
//     returns { list(), order(), categories(), load(), setPresets(user), save(cell), insert(b, preset, lvl, x, y, source), addPanels(b, list, map) }
//     list(): [{key, name, category, factory, preset}], factory first. order(): the factory categories, in menu order.
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardPresets = {
    create(env) {
      const { $, el, uid, clone, canvas, nodesEl, closeSubmenus, descendants, isCellLike, insideVoiceCell, groupOpen, groupKey,
              panelList, panelsWithLoaded, credits, notice } = env;
      /// Small inline text fields (WebViews in plugins may not support prompt()).
      /// Resolves to the trimmed values, or null when cancelled.
      function ask(fields, at) {
        return new Promise((resolve) => {
          const m = $("menu");
          closeSubmenus(0);
          m.innerHTML = "";
          const box = el("div", "m-ask");
          const inputs = fields.map((f) => {
            box.appendChild(el("div", "m-ask-label", f.label));
            const input = el("input", "n-rename");
            input.value = f.value;
            if (f.suggestions) {
              const list = el("datalist");
              list.id = uid("dl");
              for (const sgg of f.suggestions) list.appendChild(new Option(sgg));
              box.appendChild(list);
              input.setAttribute("list", list.id);
            }
            box.appendChild(input);
            return input;
          });
          m.appendChild(box);
          m.hidden = false;
          m.style.left = at.x + "px";
          m.style.top = at.y + "px";
          inputs[0].focus();
          inputs[0].select();
          let done = false;
          const finish = (ok) => {
            if (done) return;
            done = true;
            m.hidden = true;
            canvas.focus();
            resolve(ok ? inputs.map((i) => i.value.trim()) : null);
          };
          for (const input of inputs) {
            input.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Enter") finish(true);
              if (e.key === "Escape") finish(false);
            });
            input.addEventListener("pointerdown", (e) => e.stopPropagation());
            input.addEventListener("blur", () => setTimeout(() => { if (!box.contains(document.activeElement)) finish(false); }, 0));
          }
        });
      }

      /// Factory presets, read-only: compiled ones (factory-presets.json, built from
      /// patch/presets) and hand-written ones (factory-presets.js); names are unique
      /// across both. Then the user's own (.bleepcell files), by category.
      let presets = [];            // [{key, name, category, factory, preset}], factory first
      let presetOrder = [];        // factory preset categories, in menu order
      let compiledPresets = [];
      async function loadFactoryPresets() {
        try {
          const doc = await (await fetch("factory-presets.json")).json();
          presetOrder = (doc.categories || []).map((c) => c.name);
          compiledPresets = doc.presets || [];
        } catch (e) {
          console.warn("factory-presets.json not loaded", e);
        }
      }
      /// Factory panels (factory-panels.json, built from patch/presets/panels.mjs), by preset name:
      /// they travel with the preset and are copied into the board when it is placed.
      let panelDefs = {};
      async function loadFactoryPanels() {
        try {
          panelDefs = (await (await fetch("factory-panels.json")).json()).panels || {};
        } catch (e) {
          console.warn("factory-panels.json not loaded", e);
        }
      }
      function setPresets(user) {
        const factory = compiledPresets.concat(window.BleepFactoryPresets || [])
          .map((p) => Object.assign({ key: "factory:" + p.name, factory: true }, p,
            panelDefs[p.name] ? { preset: Object.assign({}, p.preset, { panels: panelDefs[p.name] }) } : {}));
        presets = factory.concat((user || []).map((p) => Object.assign(
          { key: "user:" + p.name, category: (p.preset && p.preset.category) || "My Cells" }, p)));
      }
      function presetCategories() {
        const byCat = new Map();
        for (const p of presets) {
          const cat = p.category || (p.preset && p.preset.category) || "My Cells";
          if (!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat).push(p);
        }
        return byCat;
      }

      async function savePreset(cell) {
        const ne = nodesEl.querySelector(`[data-id="${cell.id}"]`);
        const r = canvas.getBoundingClientRect();
        const at = ne ? { x: ne.getBoundingClientRect().left - r.left, y: ne.getBoundingClientRect().bottom - r.top + 6 }
                      : { x: 40, y: 40 };
        const cats = [...new Set(["Synthesizers", ...presetCategories().keys()])];
        const answer = await ask([{ label: "Save cell as preset", value: cell.name },
                                  { label: "Category", value: cell.type === "voice-cell" ? "Synthesizers" : "My Cells", suggestions: cats },
                                  { label: "Description (optional)", value: "" }], at);
        if (!answer || !answer[0]) return;
        const [name, category, description] = answer;
        const nodes = [cell, ...descendants(cell.id)].map(clone);
        const ids = new Set(nodes.map((n) => n.id));
        const cables = env.board.cables.filter((c) => ids.has(c.from.node) && ids.has(c.to.node)).map(clone);
        const preset = { format: 1, root: cell.id, category: category || "My Cells", nodes, cables };
        const needs = P.BleepLibraryView ? await P.BleepLibraryView.needsFor(nodes) : {};
        if (Object.keys(needs).length) preset.needs = needs;
        const mine = panelsWithLoaded(panelList().filter((p) => p.cell && ids.has(p.cell)));
        if (mine.length) preset.panels = clone(mine).map((p) => { delete p.open; return p; });
        if (description) preset.description = description;
        if (cell.help && cell.help.text) preset.help = clone(cell.help);
        const made = credits().collect(nodes);   // the cell's own and those of the cells inside it
        if (made.length) preset.credits = made;
        // The audio files its modules use (a sampler's reel) go along: a preset is a copy that works on another computer.
        const lost = await window.BleepMedia.attach(preset, nodes, (id) => native("readMedia", id));
        if (lost.length) notice(`${lost.length === 1 ? "An audio file" : lost.length + " audio files"} of “${name}” could not be read and ${lost.length === 1 ? "is" : "are"} not in the preset.`);
        const saved = await native("savePreset", name, preset);
        if (saved) setPresets(saved);
      }

      /// Panels copied into the board (a placed preset, a paste, a duplicate): new ids, pointing at the new nodes.
      /// `map`: old node id → new. Panels of cells that weren't copied are left out.
      /// Stacks of a placed preset's panels start open: it is there to be looked at.
      function addPanels(b, list, map) {
        if (!list || !list.length) return;
        const pmap = new Map(list.map((q) => [q.id, uid("p")]));
        const key = (k) => (map.has(k) ? map.get(k) : k);   // "this" stays
        const ref = (r) => { const i = r.indexOf("."); return key(r.slice(0, i)) + r.slice(i); };
        for (const q of clone(list)) {
          if (q.cell && !map.has(q.cell)) continue;
          q.id = pmap.get(q.id);
          if (q.cell) q.cell = key(q.cell);
          if (q.modules) q.modules = q.modules.map(key);
          // A panel made with panel-wiring.js: its Panel cell, its bays (by target module: the bays and the jack the bundle uses) and each control's target and module.
          if (q.panelCell) q.panelCell = key(q.panelCell);
          if (q.bays) q.bays = Object.fromEntries(Object.entries(q.bays).map(([t, v]) => [key(t), { ...v, in: key(v.in), out: key(v.out), path: (v.path || []).map(key) }]));
          if (q.groups) {
            q.groups = Object.fromEntries(Object.entries(q.groups).map(([k, g]) => [key(k), g]));
            // Open unless the stack is long: a placed preset is there to be looked at, but not as a wall of nodes.
            for (const k of Object.keys(q.groups))
              if (b.nodes.filter((n) => (q.modules || []).includes(n.id) && (n.parent || "") === k).length <= 8) groupOpen.add(groupKey(q, k));
          }
          delete q.open;
          for (const c of q.controls) {
            for (const w of c.wire || []) {
              for (const k of ["param", "jack", "command"]) if (w[k]) w[k] = ref(w[k]);
              for (const k of ["press", "keyboard"]) if (w[k]) w[k] = key(w[k]);
            }
            if (c.source) c.source.out = [].concat(c.source.out).map(ref);
            if (c.target) c.target.node = key(c.target.node);
            if (c.module) c.module = key(c.module);
            if (c.node) c.node = key(c.node);
            if (c.type === "panel") c.panel = pmap.get(c.panel) || c.panel;
          }
          (b.panels || (b.panels = [])).push(q);
        }
      }

      /// `source`: the credit of the preset being placed (a factory or Library preset), added to the credits it carries.
      function insertPreset(b, preset, lvl, x, y, source) {
        const tmp = { nodes: clone(preset.nodes), cables: clone(preset.cables) };
        const root = tmp.nodes.find((n) => n.id === preset.root);
        if (!root) return null;
        if (root.type === "voice-cell" && insideVoiceCell(lvl, b)) return null;  // no nesting
        const map = new Map(tmp.nodes.map((n) => [n.id, uid(isCellLike(n) ? "c" : "n")]));
        for (const n of tmp.nodes) {
          n.id = map.get(n.id);
          n.parent = n === root ? lvl : map.get(n.parent) || lvl;
          delete n.port;
          b.nodes.push(n);
        }
        root.x = Math.round(x);
        root.y = Math.round(y);
        if (preset.help && preset.help.text) root.help = clone(preset.help);
        else delete root.help;
        delete root.credits;
        credits().stamp(root, preset.credits || [], source);
        for (const c of tmp.cables)
          if (map.has(c.from.node) && map.has(c.to.node))
            b.cables.push({ id: uid("k"), from: { node: map.get(c.from.node), jack: c.from.jack },
                            to: { node: map.get(c.to.node), jack: c.to.jack }, amount: c.amount });
        addPanels(b, preset.panels, map);
        return root.id;
      }

      return {
        list: () => presets, order: () => presetOrder, categories: presetCategories,
        load: async () => { await loadFactoryPresets(); await loadFactoryPanels(); },
        setPresets, save: savePreset, insert: insertPreset, addPanels,
      };
    },
  };
})();
