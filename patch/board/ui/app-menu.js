// SPDX-License-Identifier: MIT
// app-menu.js — the File and Help menus (the board in the browser and in the plugin windows) and the Help answers (all three).
//
//   The standalone app has these as its native menu bar (File, Help); the page then only answers Help → Documentation and Info
//   (native event "menu": "docs" | "about"). Elsewhere the page draws the bar itself, in the top bar:
//     File   Presets…, Save as Preset…, Settings… (where offered)
//     Help   Documentation (the getting-started guide in the browser), Info (the logo and the version)
//
//   BleepAppMenu.init({ nativeMenu, version })
(function () {
  "use strict";
  const DOCS = "/docs/musicians/start/getting-started/";
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
      const st = await native("storeStatus");
      const u = st && st.settings && st.settings.storeUrl;
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

  function build() {
    const top = document.getElementById("top");
    if (!top || document.body.classList.contains("plugin")) return;   // an instrument or FX window has no top bar
    const bar = el("nav", "am-bar");
    bar.setAttribute("aria-label", "Menu bar");
    const menus = [
      ["File", [
        ["Presets…", () => window.BleepPresetBrowser && BleepPresetBrowser.open(), () => !!window.BleepPresetBrowser],
        ["Save as Preset…", () => window.BleepPresetBrowser && BleepPresetBrowser.save(), () => !!window.BleepPresetBrowser],
        null,
        ["Settings…", () => window.BleepSettingsView.show(), () => !!(window.BleepSettingsView && document.getElementById("sec-settings") && !document.getElementById("sec-settings").hidden)],
      ]],
      ["Help", [
        ["Documentation", showDocs, () => true],
        null,
        ["Info", showAbout, () => true],
      ]],
    ];
    for (const [title, items] of menus) {
      const wrap = el("div", "am-menu");
      const button = el("button", "am-title", title);
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const list = el("div", "am-list");
      list.setAttribute("role", "menu");
      list.hidden = true;
      for (const it of items) {
        if (!it) { list.appendChild(el("div", "am-sep")); continue; }
        const b = el("button", "am-item", it[0]);
        b.setAttribute("role", "menuitem");
        b.addEventListener("click", () => { closeMenu(); it[1](); });
        b.dataset.enabled = "1";
        b._enabled = it[2];
        list.appendChild(b);
      }
      const toggle = () => {
        const was = openMenu && openMenu.list === list;
        closeMenu();
        if (was) return;
        for (const b of list.querySelectorAll(".am-item")) b.hidden = !b._enabled();
        list.hidden = false;
        button.setAttribute("aria-expanded", "true");
        openMenu = { button, list };
      };
      button.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
      button.addEventListener("pointerenter", () => { if (openMenu && openMenu.list !== list) toggle(); });   // as a menu bar does
      wrap.append(button, list);
      bar.appendChild(wrap);
    }
    document.addEventListener("pointerdown", (e) => { if (openMenu && !bar.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { openMenu.button.focus(); closeMenu(); } }, true);
    document.getElementById("top").prepend(bar);
  }

  window.BleepAppMenu = {
    init(opts) {
      version = opts.version || "";
      if (!opts.nativeMenu) build();
      onNative("menu", (what) => { if (what === "docs") showDocs(); else if (what === "about") showAbout(); });
    },
  };
})();
