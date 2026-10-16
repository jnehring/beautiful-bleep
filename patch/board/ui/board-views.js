// SPDX-License-Identifier: MIT
// board-views.js — the floating module views: a window with the module's controls, opened from its node, and the doc hint behind it.
//
// P.BoardViews.create(s)   s: the board and page helpers it needs (see the destructuring below); `board` is a getter.
//   returns { placeWin, toggleView, makeApi, openView, front, closeView, pinTitle, closeUnpinnedViews, closeTopView, watch }
(function () {
  "use strict";
  const { native, priv: P } = window.BleepSeal;

  P.BoardViews = {
    create(s) {
      const { $, cablesInto, canBypass, canvas, clone, drivesJacks, edit, el, gesture, isPort, isStructural,
              jackName, knobMenuItems, nodeById, nodesEl, panelMenuFor, removeCable, renderCables, renderNodes,
              savePreset, setPowerButton, showMenu, toggleBypass, typeOf, views } = s;
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
          importMedia: (name, base64) => native("importMedia", name, base64),
          exportMedia: (slot) => native("exportMedia", id, slot),
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
          setNodeProperty: (key, value) => edit("set " + key, (b) => { const m = nodeById(id, b); if (!m) return false; m[key] = value; }),
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
        const doc = el("div", "v-doc");
        doc.hidden = true;
        win.append(head, body);
        const api = makeApi(id);
        const bv = BleepView.create(t, clone(n), api);
        const hook = BleepViews.get(t.type);
        if (hook && hook.width) win.style.width = hook.width + "px";
        else if (isPort(n)) win.classList.add("port");   // In/Out nodes have a few controls: fit them
        if (!n.params) n.params = {};
        body.append(bv.root, doc);
        $("views").appendChild(win);
        const v = { win, bv, pinned: false, power };
        moduleDoc(t.type).then((md) => {
          if (md === null) return;
          help.hidden = false;
          doc.innerHTML = BleepMarkdown.render(md);
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

        win.addEventListener("pointerdown", () => front(win));
        pin.addEventListener("click", () => { v.pinned = !v.pinned; pin.classList.toggle("on", v.pinned); pin.title = pinTitle(v.pinned); });
        help.addEventListener("click", () => {
          const open = doc.hidden;
          doc.hidden = !open;
          bv.root.hidden = open;
          help.classList.toggle("on", open);
          win.classList.toggle("doc", open);
          help.title = open ? "Back to the controls" : "Documentation";
          body.scrollTop = 0;
          // The docs are wider: keep the window, and its buttons, inside the canvas.
          const maxLeft = canvas.clientWidth - win.offsetWidth - 8;
          if (win.offsetLeft > maxLeft) win.style.left = Math.max(8, maxLeft) + "px";
        });
        doc.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); });  // the page must not navigate
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
        if (hook && hook.resizable) {  // drag the lower right corner to change the width
          const grip = el("div", "v-grip");
          grip.title = "Drag to resize";
          win.appendChild(grip);
          grip.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            grip.setPointerCapture(e.pointerId);
            const sx = e.clientX, w0 = win.offsetWidth, max = canvas.clientWidth - win.offsetLeft - 8;
            const move = (m) => { win.style.width = Math.max(360, Math.min(max, w0 + m.clientX - sx)) + "px"; };
            const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
          });
        }
        head.addEventListener("pointerdown", (e) => {
          if (e.target.closest("button")) return;
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
      function closeView(id) {
        const v = views.get(id);
        if (!v) return;
        if (v.panelId) v.destroy();
        v.win.remove();
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
        closeTopView, watch,
      };
    },
  };
})();
