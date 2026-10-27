// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// board-views.js — the floating module views: a window with the module's controls, opened from its node, and the doc hint behind it.
//
// P.BoardViews.create(s)   s: the board and page helpers it needs (see the destructuring below); `board` is a getter.
//   returns { placeWin, toggleView, makeApi, openView, front, closeView, pinTitle, closeUnpinnedViews, closeTopView, watch, rebuildView }
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardViews = {
    create(s) {
      // (s.types, the board's module types by id, is for the Code node: api.types() below)
      const { $, cablesInto, canBypass, canvas, clone, drivesJacks, edit, el, gesture, isPort, isStructural,
              jackName, knobMenuItems, nodeById, nodesEl, panelMenuFor, removeCable, renderCables, renderNodes,
              savePreset, setPowerButton, showMenu, toggleBypass, typeOf, views, hidePopovers } = s;
      let viewZ = 1;
      /// Puts a floating window at (x, y), keeping its title bar inside the canvas so it can always be grabbed.
      function placeWin(win, x, y) {
        const head = win.querySelector(".v-head"), hh = head ? head.offsetHeight : 28, keep = 80;
        win.style.left = Math.max(keep - win.offsetWidth, Math.min(x, canvas.clientWidth - keep)) + "px";
        win.style.top = Math.max(0, Math.min(y, canvas.clientHeight - hh)) + "px";
      }
      window.addEventListener("resize", () => { for (const v of views.values()) placeWin(v.win, v.win.offsetLeft, v.win.offsetTop); });
      // Opening a view replaces the other unpinned ones; pinned views stay.
      function toggleView(id) {
        if (views.has(id)) return closeView(id);
        closeUnpinnedViews();
        openView(id, { centre: true });
      }

      /// What a module view (or a panel) calls to change node `id`.
      function makeApi(id) {
        // A module view may only touch the libraries of its own kind: "drums" (Drum Grid patterns) and "module:<type>" (its presets), never the user's boards and cells.
        const viewKind = (kind) => typeof kind === "string" && /^(drums|module:[A-Za-z0-9._-]{1,64})$/.test(kind);
        return Object.freeze({
          knobMenu: (pid, ev) => { const items = knobMenuItems(id, pid); if (items.length) showMenu(ev, items); },
          // Right-click on a part of the view (a display, a section of knobs, the buttons) or on its background: "Add to panel".
          partMenu: (partId, ev) => { const m = nodeById(id), items = m ? panelMenuFor(m, partId) : []; if (items.length) showMenu(ev, items); },
          setParam: (pid, v) => {
            const m = nodeById(id);
            if (m) m.params[pid] = v;
            native("setParam", id, pid, v);
            if (m && m.type === "voice-cell" && pid === "voices") { renderNodes(); renderCables(); }  // ×N and the dots
            else if (m && drivesJacks(m, pid)) { renderNodes(); renderCables(); }  // jacks shown or renamed by a mode
          },
          beginGesture: gesture,
          setAmount: (cableId, v) => {
            const c = s.board.cables.find((x) => x.id === cableId);
            if (c) c.amount = v;
            native("setAmount", cableId, v);
          },
          removeCable,
          command: (cmd, value) => native("command", id, cmd, value),
          isPatched: (jack) => s.board.cables.some((c) => c.to.node === id && c.to.jack === jack),
          // A folder chooser (app and plugins): the full path chosen, or "" when cancelled. Bleep Play has no dialog (the Audio Console hides its folder there).
          chooseFolder: async (start) => { try { return (await native("chooseFolder", start)) || ""; } catch (e) { return ""; } },
          importMedia: (name, base64) => native("importMedia", name, base64),
          exportMedia: (slot) => native("exportMedia", id, slot),
          revealMedia: (mediaId) => native("revealMedia", mediaId),
          // Recordings the browser keeps in memory (web-recordings.js: the Audio Console in Bleep Play): null where the host writes files itself.
          recordings: () => (window.BleepWeb && BleepWeb.recordings ? BleepWeb.recordings.list() : null),
          downloadRecording: (recordingId) => (window.BleepWeb && BleepWeb.recordings ? BleepWeb.recordings.download(recordingId) : { error: "no recordings here" }),
          discardRecording: (recordingId) => { if (window.BleepWeb && BleepWeb.recordings) BleepWeb.recordings.discard(recordingId); },
          setData: (data) => {
            const m = nodeById(id);
            if (m) m.data = clone(data);
            native("setData", id, data);
          },
          // Performance gestures (Button presses, Keyboard keys): not saved, no undo.
          perform: (action, ...args) => native("perform", id, action, args),
          // Preset libraries shared by all sets, e.g. Drum Grid patterns ("drums").
          presets: async (kind) => (viewKind(kind) && (await native("presets", kind))) || [],
          savePreset: async (kind, name, preset) => (viewKind(kind) && (await native("savePreset", name, preset, kind))) || [],
          deletePreset: async (kind, name) => (viewKind(kind) && (await native("deletePreset", name, kind))) || [],
          // The MIDI inputs the app sees (MIDI Device's controller list).
          midiDevices: async () => (await native("midiDevices")) || [],
          // For the Code node (board-code.js): the board's module types, and a patch script's result put on the board in one undoable step.
          types: () => s.types,
          applyGenerated: (code, result) => edit("generate patch", (b) => (P.BleepCode ? P.BleepCode.applyGenerated(b, id, code, result) : false)),
          setNodeProperty: (key, value) => edit("set " + key, (b) => { const m = nodeById(id, b); if (!m) return false; m[key] = value; }),
          // Turns node `id` into a node of another type in one undoable step (a Code node into the module made from it, and back): `apply(node)` makes the
          // other changes (its code, its name). The board's list of node types and the engine's list of modules are read again first, so the new type is known.
          convertNode: async (toType, apply) => {
            if (s.refreshTypes) await s.refreshTypes();
            if (window.BleepWeb && window.BleepWeb.refreshModules) await window.BleepWeb.refreshModules();
            await edit("convert to " + toType, (b) => { const m = nodeById(id, b); if (!m) return false; apply(m); m.type = toType; });
          },
          // What the cables leaving output `jack` of this node feed: "<node> <input or knob>", for naming a macro after what it moves.
          cablesFrom: (jack) => s.board.cables.filter((c) => c.from.node === id && c.from.jack === jack).map((c) => {
            const dst = nodeById(c.to.node);
            return dst ? `${dst.name} ${jackName(dst, c.to.jack, false)}` : "?";
          }),
          cablesInto: (pid) => cablesInto(id, pid).map((c) => {
            const src = nodeById(c.from.node);
            return { id: c.id, amount: c.amount, label: src ? `${src.name} › ${jackName(src, c.from.jack, true)}` : "?" };
          }),
        });
      }

      /// `opts.centre`: a view opened by hand lands in the middle of the canvas; one a cable opens sits beside its node.
      function openView(id, opts = {}) {
        const n = nodeById(id);
        if (!n || isStructural(n)) return;
        const t = typeOf(n);
        const win = el("div", "vwin");
        win.dataset.node = id;
        win.style.setProperty("--accent", n.colour || t.colour || "#4fd1c5");
        const head = el("div", "v-head");
        const vTitle = el("span", "v-title", n.name);
        const pen = el("button", "pen", "✎");
        pen.title = "Rename";
        pen.setAttribute("aria-label", "Rename " + n.name);
        head.append(vTitle, pen, el("span", "v-sub", t.name), el("span", "spacer"));
        const help = el("button", "help", "?");
        help.title = "Documentation";
        help.hidden = true;
        const pin = el("button", "pin", "📌");
        pin.title = pinTitle(false);
        const close = el("button", "", "×");
        close.title = "Close (Esc)";
        const power = canBypass(n) ? el("button", "power", "⏻") : null;   // a power switch: lit = the module runs
        if (power) {
          setPowerButton(power, n);
          power.addEventListener("click", () => toggleBypass(id));
          head.appendChild(power);
        }
        head.append(help, pin, close);
        const body = el("div", "v-body");
        win.append(head, body);
        const api = makeApi(id);
        const bv = BleepView.create(t, clone(n), api);
        const hook = t.older ? null : BleepViews.get(t.type);
        if (hook && hook.width) win.style.width = hook.width + "px";
        else if (isPort(n)) win.classList.add("port");   // In/Out nodes have a few controls: fit them
        if (!n.params) n.params = {};
        body.append(bv.root);
        $("views").appendChild(win);
        const v = { win, bv, pinned: false, power, docRoot: null, help, type: t.type };
        let docHtml = null;
        // A Code node and a module saved from one have the help page their author wrote (Help tab), or one made from the module's description
        const ownHelp = () => (P.BleepCode && P.BleepCode.helpOf ? P.BleepCode.helpOf(nodeById(id)) : null);
        v.showHelpButton = () => { if (ownHelp() !== null) help.hidden = false; };
        v.showHelpButton();
        // A module's help page opens with its version; one without a doc file still has the page made from its name and description.
        const versionLine = () => (t.version ? `<p class="doc-version">Version ${String(t.version).replace(/[^0-9A-Za-z.+-]/g, "")}${t.older ? " (older, kept because this board pins it)" : ""}</p>` : "");
        moduleDoc(t.type).then((md) => {
          if (md === null && !(t.version && t.description)) return;
          help.hidden = false;
          docHtml = versionLine() + (md === null ? BleepMarkdown.render(`# ${t.name}\n\n${t.description}`) : BleepMarkdown.render(md));
        });
        views.set(id, v);

        // Next to the node, inside the canvas.
        const ne = nodesEl.querySelector(`[data-id="${id}"]`);
        const r = canvas.getBoundingClientRect();
        let x = 40, y = 40;
        if (ne) {
          // Beside the node, never over it: its ports must stay reachable.
          // Right if it fits, else left, else (a window as wide as the canvas) below or above.
          const nr = ne.getBoundingClientRect(), w = win.offsetWidth, h = win.offsetHeight, gap = 16;
          const nl = nr.left - r.left, nrt = nr.right - r.left, nt = nr.top - r.top, nb = nr.bottom - r.top;
          y = nt;
          if (nrt + gap + w <= r.width - 10) x = nrt + gap;
          else if (nl - gap - w >= 8) x = nl - gap - w;
          else {
            x = nl;
            y = nb + gap + h <= r.height - 8 || nt - gap - h < 8 ? nb + gap : nt - gap - h;
          }
        }
        if (opts.centre) { x = (r.width - win.offsetWidth) / 2; y = (r.height - win.offsetHeight) / 2; }
        x = Math.max(8, Math.min(x, r.width - win.offsetWidth - 10));
        y = Math.max(8, opts.centre ? Math.min(y, r.height - win.offsetHeight - 8) : Math.min(y, r.height - Math.min(win.offsetHeight, 200)));
        win.style.left = x + "px";
        win.style.top = y + "px";
        front(win);

        // The canvas ignores presses inside a view, so a menu opened from the view (right-click) closes here.
        win.addEventListener("pointerdown", () => { hidePopovers(); front(win); });
        pin.addEventListener("click", () => { v.pinned = !v.pinned; pin.classList.toggle("on", v.pinned); pin.title = pinTitle(v.pinned); });
        // The module's manual opens in a dialog over the board (modal.js), built on first use.
        help.addEventListener("click", () => {
          const own = ownHelp();
          if (own !== null && own !== v.ownHelp) {   // the page may have changed since it was last opened
            if (v.docRoot) { P.BleepModal.unmount(v.docRoot); v.docRoot = null; }
            v.ownHelp = own;
            docHtml = P.BleepCode.renderHelp(own);
          }
          if (docHtml === null) return;
          if (!v.docRoot) {
            const section = el("section", "mod-doc");
            const doc = el("div", "v-doc");
            doc.innerHTML = docHtml;
            doc.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); });  // the page must not navigate
            section.appendChild(doc);
            section.hidden = true;
            v.docRoot = section;
            P.BleepModal.mount(section, () => { P.BleepModal.toggle(section, false); help.classList.remove("on"); });
          }
          const open = v.docRoot.hidden;
          P.BleepModal.toggle(v.docRoot, open);
          help.classList.toggle("on", open);
        });
        close.addEventListener("click", () => closeView(id));
        pen.addEventListener("click", () => {
          const cur = nodeById(id);
          if (!cur) return;
          const input = el("input", "n-rename v-rename");
          input.value = cur.name;
          input.maxLength = 63;
          vTitle.replaceWith(input);
          input.focus();
          input.select();
          let done = false;
          const finish = (save) => {
            if (done) return;
            done = true;
            const name = input.value.trim();
            input.replaceWith(vTitle);
            if (save && name && name !== cur.name) edit("rename", (b) => { nodeById(id, b).name = name; });
          };
          input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
          });
          input.addEventListener("blur", () => finish(true));
          input.addEventListener("pointerdown", (e) => e.stopPropagation());
        });
        if (hook && hook.resizable) {  // drag the lower right corner to change the width and height; the button fills the board
          const grip = el("div", "v-grip");
          grip.title = "Drag to resize";
          win.appendChild(grip);
          const full = el("button", "full", "⛶");
          full.title = "Fullscreen (F11)";
          full.setAttribute("aria-label", "Fullscreen");
          head.insertBefore(full, head.querySelector(".help"));
          let before = null;
          const setFull = (on) => {
            if (on === win.classList.contains("fs")) return;
            if (on) before = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
            win.classList.toggle("fs", on);
            win.classList.toggle("sized", on || !!(before && before.height));
            if (!on && before) Object.assign(win.style, before);
            full.classList.toggle("on", on);
            full.title = on ? "Leave fullscreen (F11 or Esc)" : "Fullscreen (F11)";
            if (on) win.classList.add("sized");
            win.dispatchEvent(new Event("bv-resized"));
          };
          full.addEventListener("click", () => setFull(!win.classList.contains("fs")));
          win.addEventListener("keydown", (e) => {
            if (e.key === "F11") { e.preventDefault(); setFull(!win.classList.contains("fs")); }
            else if (e.key === "Escape" && win.classList.contains("fs")) { e.preventDefault(); e.stopPropagation(); setFull(false); }
          }, true);
          head.addEventListener("dblclick", (e) => { if (!e.target.closest("button, input")) setFull(!win.classList.contains("fs")); });
          grip.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            grip.setPointerCapture(e.pointerId);
            const sx = e.clientX, sy = e.clientY, w0 = win.offsetWidth, h0 = win.offsetHeight;
            const maxW = canvas.clientWidth - win.offsetLeft - 8, maxH = canvas.clientHeight - win.offsetTop - 8;
            const move = (m) => {
              win.classList.add("sized");
              win.style.width = Math.max(360, Math.min(maxW, w0 + m.clientX - sx)) + "px";
              win.style.height = Math.max(240, Math.min(maxH, h0 + m.clientY - sy)) + "px";
              win.dispatchEvent(new Event("bv-resized"));
            };
            const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
          });
        }
        head.addEventListener("pointerdown", (e) => {
          if (e.target.closest("button") || win.classList.contains("fs")) return;
          const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
          const move = (m) => placeWin(win, m.clientX - sx, m.clientY - sy);
          const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
        watch();
      }
      /// A module's documentation (modules/<name>/doc/<type>.md), or null if it has none.
      const docs = new Map();
      function moduleDoc(type) {
        if (!docs.has(type))
          docs.set(type, fetch(encodeURIComponent(type) + ".md")
            .then((r) => (r.ok ? r.text() : null))
            .then((md) => (md && md.trim() ? md : null))
            .catch(() => null));
        return docs.get(type);
      }
      function front(win) {
        for (const w of document.querySelectorAll(".vwin")) w.classList.remove("front");
        win.classList.add("front");
        win.style.zIndex = ++viewZ;
      }
      /// Builds a view again from the node's current type description, in the same window (a Code node's interface changed).
      function rebuildView(id) {
        const v = views.get(id), n = nodeById(id);
        if (!v || !n || v.panelId) return;
        const t = typeOf(n), bv = BleepView.create(t, clone(n), makeApi(id));
        v.bv.root.replaceWith(bv.root);
        v.bv = bv;
        if (v.type !== t.type) {   // the node became another type (a Code node converted to its module, or back): the window follows
          v.type = t.type;
          const title = v.win.querySelector(".v-title"), sub = v.win.querySelector(".v-sub"), hook = t.older ? null : BleepViews.get(t.type);
          if (title) title.textContent = n.name;
          if (sub) sub.textContent = t.name;
          v.win.style.setProperty("--accent", n.colour || t.colour || "#4fd1c5");
          if (hook && hook.width) v.win.style.width = hook.width + "px";
          if (v.docRoot) { P.BleepModal.unmount(v.docRoot); v.docRoot = null; }
          v.ownHelp = null;
          if (v.help) v.help.hidden = true;
        }
        if (v.showHelpButton) v.showHelpButton();   // a Code node that has just compiled has a help page to show
      }
      function closeView(id) {
        const v = views.get(id);
        if (!v) return;
        if (v.panelId) v.destroy();
        v.win.remove();
        if (v.docRoot) P.BleepModal.unmount(v.docRoot);
        views.delete(id);
        watch();
      }
      function pinTitle(on) {
        return (on ? "Pinned: stays open" : "Not pinned: closes") + " when opening other views or entering and leaving cells (click to " + (on ? "unpin" : "pin") + ")";
      }
      function closeUnpinnedViews() { for (const [id, v] of [...views]) if (!v.pinned) closeView(id); }
      function closeTopView() {
        let top = null;
        for (const [id, v] of views) if (!top || +v.win.style.zIndex > +views.get(top).win.style.zIndex) top = id;
        if (top) closeView(top);
        return !!top;
      }
      function watch() {
        native("watch", [...views].flatMap(([id, v]) => (v.panelId ? v.nodes() : [id])));
      }

      return {
        placeWin, toggleView, makeApi, openView, front, closeView, pinTitle, closeUnpinnedViews,
        closeTopView, watch, rebuildView,
      };
    },
  };
})();
