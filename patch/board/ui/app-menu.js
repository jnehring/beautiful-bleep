// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// app-menu.js — the menu bar: File, Edit, View, Library, Help (one list for all three hosts) and the Help answers.
//
//   The list below (MODEL) is the only definition of the menus. The browser board and the plugin window draw it in the top bar;
//   the standalone app sends it to the native side (native "setMenu") and builds its menu bar from it. Choosing an item runs its
//   command: here in the page, except the project file commands of the app (`app`: New, Open File, Save, Save As), which the
//   native side performs itself. The board registers its own commands (P.BleepAppMenu.register).
//
//   item   { id, label, key?, appKey?, app?, when?(): shown, enabled?(): clickable }
//          key: the shortcut the page handles; appKey: one the native menu handles (shown in the native bar only)
//
//   P.BleepAppMenu.init({ nativeMenu, version })
//   P.BleepAppMenu.register(commands, enabled)   commands {id: fn(anchor)}; enabled {id: fn(): bool}
//   P.BleepAppMenu.refresh()                     the board's state changed (Undo/Redo availability): redraw / resend
(function () {
  "use strict";
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, onNative, priv: P } = window.BleepSeal;
  const DOCS = "/docs/musicians/overview/";
  const SITE = "https://brilliantbleep.com";
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let version = "";
  let openMenu = null;      // {button, list} while a menu is down
  let about = null;

  function closeMenu() {
    if (!openMenu) return;
    openMenu.list.hidden = true;
    openMenu.button.setAttribute("aria-expanded", "false");
    openMenu = null;
  }

  async function showDocs() {
    if (window.BleepWeb) { window.open(DOCS, "_blank", "noopener"); return; }   // the browser board lives on the site itself
    let site = SITE;
    try {
      const st = await native("libraryStatus");
      const u = st && st.settings && st.settings.libraryUrl;
      if (u) site = u.replace(/\/+$/, "");
    } catch (e) { /* the default address */ }
    await native("openUrl", site + DOCS);
  }

  async function readVersion() {
    if (version) return version;
    try { version = (await (await fetch("version.json")).json()).version || ""; } catch (e) { /* none */ }
    return version;
  }

  function closeAbout() {
    if (about) { about.remove(); about = null; }
    const c = document.getElementById("canvas");
    if (c) c.focus();
  }

  async function showAbout() {
    if (about) return;
    await readVersion();
    about = el("div", "am-about");
    about.setAttribute("role", "dialog");
    about.setAttribute("aria-label", "About Bleep");
    const box = el("div", "am-box");
    const logo = el("img", "am-logo");
    logo.src = "logo.svg";
    logo.alt = "Beautiful Bleep";
    const ok = el("button", "", "OK");
    ok.addEventListener("click", closeAbout);
    box.append(logo, el("div", "am-name", "Bleep"), el("div", "am-version", version ? "Version " + version : ""), ok);
    about.appendChild(box);
    about.addEventListener("pointerdown", (e) => { if (e.target === about) closeAbout(); });
    about.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeAbout(); } });
    document.body.appendChild(about);
    ok.focus();
  }

  const mac = /Mac/.test(navigator.platform || "");
  const cmdKey = (k) => (mac ? "⌘" + k : "Ctrl+" + k);
  const shiftCmd = (k) => (mac ? "⇧⌘" + k : "Ctrl+Shift+" + k);
  let native_ = false;                   // the native side draws the bar
  const commands = {};                   // id -> fn(anchor)
  const enabledBy = {};                  // id -> fn(): bool
  const has = (name) => () => !!P[name];
  const settingsOffered = () => !!(P.BleepSettingsView && document.getElementById("settings"));

  const MODEL = [
    ["File", [
      { id: "project.new", label: "New Project", appKey: cmdKey("N"), app: true },
      { id: "project.newPatch", label: "New Patch", when: () => !native_ && !document.body.classList.contains("plugin") && has("BleepProjectBrowser")() },
      { id: "project.browse", label: "Open Project…", appKey: cmdKey("P"), when: has("BleepProjectBrowser") },
      { id: "project.openFile", label: "Open Project File…", appKey: cmdKey("O"), app: true },
      { id: "project.import", label: "Open Project from File…", when: () => !native_ && !!P.BleepProjectBrowser },
      null,
      { id: "project.save", label: "Save Project", appKey: cmdKey("S"), app: true },
      { id: "project.saveAs", label: "Save Project As…", appKey: shiftCmd("S"), app: true },
      { id: "project.saveBrowser", label: "Save to My Projects…", when: has("BleepProjectBrowser"), enabled: () => P.BleepProjectBrowser.canSave() },
      { id: "project.download", label: "Download Project", when: () => !native_ && !!P.BleepProjectBrowser },
      null,
      { id: "file.settings", label: "Settings…", appKey: cmdKey(","), when: settingsOffered },
    ]],
    ["Edit", [
      { id: "edit.undo", label: "Undo", key: cmdKey("Z") },
      { id: "edit.redo", label: "Redo", key: shiftCmd("Z") },
      null,
      { id: "edit.cut", label: "Cut", key: cmdKey("X") },
      { id: "edit.copy", label: "Copy", key: cmdKey("C") },
      { id: "edit.paste", label: "Paste", key: cmdKey("V") },
      { id: "edit.copyPatch", label: "Copy Patch", when: has("BleepProjectBrowser") },
      { id: "edit.duplicate", label: "Duplicate", key: cmdKey("D") },
      { id: "edit.delete", label: "Delete", key: "⌫" },
      { id: "edit.selectAll", label: "Select All", key: cmdKey("A") },
      null,
      { id: "edit.group", label: "Group into Cell", key: cmdKey("G") },
      { id: "edit.ungroup", label: "Ungroup", key: shiftCmd("G") },
      null,
      { id: "edit.add", label: "Add Module…", key: "Tab" },
    ]],
    ["View", [
      { id: "view.panels", label: "Panels…", key: "P" },
      null,
      { id: "view.fit", label: "Fit Board", key: "F" },
      { id: "view.zoomIn", label: "Zoom In", key: "+" },
      { id: "view.zoomOut", label: "Zoom Out", key: "−" },
      null,
      { id: "view.trace", label: "Trace Signal", key: "T" },
      { id: "view.keyboard", label: "Screen Keyboard", when: () => !!(window.BleepWeb && window.BleepPlayKeys) },   // Bleep Play: the piano under the board, on or off
    ]],
    ["Library", [
      { id: "library.open", label: "Open Library…", when: () => !!document.getElementById("library") },
      { id: "library.upload", label: "Upload Project to Library…", when: () => !!(document.getElementById("library") && P.BleepAccount && P.BleepAccount.enabled && P.BleepSideMenu) },
    ]],
    ["Help", [
      { id: "help.docs", label: "Documentation" },
      { id: "help.topics", label: "Help Topics…", when: () => !!document.getElementById("help") },
      null,
      { id: "help.about", label: "Info" },
    ]],
  ];

  const internal = {
    "project.newPatch": () => P.BleepProjectBrowser && P.BleepProjectBrowser.newPatch(),
    "project.browse": () => P.BleepProjectBrowser && P.BleepProjectBrowser.open(),
    "project.saveBrowser": () => P.BleepProjectBrowser && P.BleepProjectBrowser.save(),
    "project.import": () => P.BleepProjectBrowser && P.BleepProjectBrowser.openFile(),
    "project.download": () => P.BleepProjectBrowser && P.BleepProjectBrowser.download(),
    "edit.copyPatch": () => P.BleepProjectBrowser && P.BleepProjectBrowser.copyPatch(),
    "file.settings": () => P.BleepSettingsView && P.BleepSettingsView.show(),
    "library.open": () => P.BleepLibraryView && P.BleepLibraryView.show(),
    "library.upload": () => P.BleepSideMenu && P.BleepSideMenu.upload(),
    "help.docs": () => showDocs(),
    "help.topics": () => P.BleepHelpView && P.BleepHelpView.show(),
    "help.about": () => showAbout(),
  };

  const ALIAS = { docs: "help.docs", about: "help.about" };   // the native events of older builds

  function run(id, anchor) {
    id = ALIAS[id] || id;
    const fn = commands[id] || internal[id];
    if (fn) fn(anchor || { clientX: 12, clientY: 48 });
  }

  const shown = (it) => !!it && (!it.app || native_) && (!it.when || it.when());
  const enabled = (it) => (!it.enabled || it.enabled()) && (!enabledBy[it.id] || enabledBy[it.id]());

  /// The menus as they are now, for the native side: titles with their visible items.
  function snapshot() {
    return MODEL.map(([title, items]) => {
      const out = [];
      for (const it of items) {
        if (it === null) { if (out.length && out[out.length - 1] !== null) out.push(null); continue; }
        if (!shown(it) && !(it.app && native_)) continue;
        out.push({ id: it.id, label: it.label, key: it.key || it.appKey || "", enabled: enabled(it), app: !!it.app });
      }
      while (out.length && out[out.length - 1] === null) out.pop();
      return { title, items: out };
    }).filter((m) => m.items.length);
  }

  let sent = 0;
  function sendNative() {
    if (!native_ || sent) return;
    sent = setTimeout(() => { sent = 0; native("setMenu", snapshot()); }, 0);
  }

  function build() {
    const top = document.getElementById("top");
    if (!top || document.body.classList.contains("plugin")) return;   // an instrument or FX window has no top bar
    const bar = el("nav", "am-bar");
    bar.setAttribute("aria-label", "Menu bar");
    const fill = (list, items) => {
      list.innerHTML = "";
      let pendingSep = false;
      for (const it of items) {
        if (it === null) { pendingSep = list.childElementCount > 0; continue; }
        if (!shown(it)) continue;
        if (pendingSep) { list.appendChild(el("div", "am-sep")); pendingSep = false; }
        const b = el("button", "am-item");
        b.append(el("span", "am-label", it.label), el("span", "am-key", it.key || ""));
        b.setAttribute("role", "menuitem");
        b.disabled = !enabled(it);
        b.addEventListener("click", () => {
          const r = list.parentElement.getBoundingClientRect();
          closeMenu();
          run(it.id, { clientX: r.left, clientY: r.bottom + 4 });
        });
        list.appendChild(b);
      }
      return list.childElementCount > 0;
    };
    for (const [title, items] of MODEL) {
      const wrap = el("div", "am-menu");
      const button = el("button", "am-title", title);
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const list = el("div", "am-list");
      list.setAttribute("role", "menu");
      list.hidden = true;
      const toggle = () => {
        const was = openMenu && openMenu.list === list;
        closeMenu();
        if (was) return;
        if (!fill(list, items)) return;
        list.hidden = false;
        button.setAttribute("aria-expanded", "true");
        openMenu = { button, list };
      };
      button.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
      button.addEventListener("pointerenter", () => { if (openMenu && openMenu.list !== list) toggle(); });   // as a menu bar does
      wrap.append(button, list);
      wrap.hidden = !items.some((it) => shown(it));   // nothing to offer here (no library in this build)
      bar.appendChild(wrap);
    }
    document.addEventListener("pointerdown", (e) => { if (openMenu && !bar.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { openMenu.button.focus(); closeMenu(); } }, true);
    top.prepend(bar);
  }

  P.BleepAppMenu = {
    init(opts) {
      version = opts.version || "";
      native_ = !!opts.nativeMenu;
      if (!native_) build(); else sendNative();
      onNative("menu", (what) => run(what));
    },
    register(cmds, enabledFns) {
      Object.assign(commands, cmds);
      Object.assign(enabledBy, enabledFns || {});
    },
    refresh: sendNative,
    snapshot,
  };
})();
