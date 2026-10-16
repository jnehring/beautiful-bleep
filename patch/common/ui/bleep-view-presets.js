// SPDX-License-Identifier: MIT
// bleep-view-presets.js — the preset bar of a module view (bleep-view.js): the module's factory presets and the user's own,
// the previous/next buttons, the menu and Save.
//
//   BleepViewPresets.makePresetBar(view, type, applyPreset) → {el, update()}
//   BleepViewPresets.loadFactoryPresets() → Promise      factoryOf(type) → the factory presets of a module type
(function () {
  "use strict";
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // Factory presets are written in units and compiled to normalised values by patch/presets/build-modules.mjs;
  // a preset lists only the knobs it sets (the rest follow the module's defaults).
  let factoryDoc = { modules: {} }, factoryLoad = null;
  function loadFactoryPresets() {
    if (!factoryLoad)
      factoryLoad = fetch("module-presets.json").then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && d.modules) factoryDoc = d; }).catch(() => {});
    return factoryLoad;
  }
  loadFactoryPresets();
  const factoryOf = (type) => factoryDoc.modules[type] || [];
  const userKind = (type) => "module:" + type;
  const userCache = new Map();    // module type → the user's presets [{name, preset}], as last read
  const lastLoaded = new Map();   // node id → {origin: "factory" | "user", name}: what the node was set from
  const sameValue = (a, b) => Math.abs(a - b) < 5e-4;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let openMenu = null;            // the one preset menu on screen

  function closeMenu() {
    if (!openMenu) return;
    openMenu.el.remove();
    document.removeEventListener("pointerdown", openMenu.away, true);
    document.removeEventListener("keydown", openMenu.key, true);
    openMenu = null;
  }

  /// The preset bar of a view: view.presets = {el, update()} (null without factory presets).
  function makePresetBar(view, type, applyPreset) {
    const bar = el("div", "bv-presets");
    const prev = el("button", "bv-pbtn", "‹"), next = el("button", "bv-pbtn", "›");
    const pick = el("button", "bv-ppick");
    const label = el("span", "bv-pname"), mark = el("span", "bv-pmark");
    pick.append(label, mark, el("span", "bv-pcaret", "▾"));
    const save = el("button", "bv-pbtn bv-psave", "Save");
    prev.title = "Previous preset"; next.title = "Next preset"; pick.title = "Presets";
    bar.append(prev, pick, next, save);

    const factory = () => factoryOf(type.type).map((p) => ({ origin: "factory", name: p.name, params: p.params, data: p.data, description: p.description }));
    const user = () => (userCache.get(type.type) || []).map((p) => ({ origin: "user", name: p.name, params: p.preset.params || {}, data: p.preset.data, description: p.preset.description }));
    const all = () => factory().concat(user());
    const matches = (p) => type.params.every((q) => sameValue(view.node.params[q.id] ?? q.default, q.id in p.params ? p.params[q.id] : q.default));
    /// The preset the node is set to: the one it was loaded from (if the knobs still agree, else modified), or any that agrees.
    function current() {
      const list = all(), seen = lastLoaded.get(view.node.id);
      const from = seen && list.find((p) => p.origin === seen.origin && p.name === seen.name);
      if (from) return { preset: from, modified: !matches(from) };
      const hit = list.find(matches);
      return hit ? { preset: hit, modified: false } : { preset: null, modified: false };
    }
    function update() {
      const c = current();
      label.textContent = c.preset ? c.preset.name : "Custom";
      label.classList.toggle("bv-pnone", !c.preset);
      mark.textContent = c.modified ? "●" : "";
      mark.title = c.modified ? "Changed since loaded" : "";
      pick.classList.toggle("bv-pmod", c.modified);
      // Save: a changed user preset is overwritten; anything else asks for a name.
      save.title = c.preset && c.preset.origin === "user" ? (c.modified ? "Overwrite “" + c.preset.name + "”" : "Save as a new preset…") : "Save as a new preset…";
      save.classList.toggle("bv-pdirty", c.modified && !!c.preset && c.preset.origin === "user");
    }
    function load(p) {
      lastLoaded.set(view.node.id, { origin: p.origin, name: p.name });
      applyPreset(p);
      update();
    }
    function step(d) {
      const list = all();
      if (!list.length) return;
      const c = current();
      const i = c.preset ? list.findIndex((p) => p.origin === c.preset.origin && p.name === c.preset.name) : -1;
      load(list[i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length]);
    }
    prev.addEventListener("click", () => refreshUser().then(() => step(-1)));
    next.addEventListener("click", () => refreshUser().then(() => step(1)));
    async function refreshUser() {
      if (!view.api.presets) return;
      try {
        const list = await view.api.presets(userKind(type.type));
        if (Array.isArray(list)) userCache.set(type.type, list.filter((p) => p && typeof p.name === "string" && p.preset && p.preset.params));
      } catch (e) { /* the library is unavailable: factory presets only */ }
    }

    // ---- saving
    function snapshot() {
      const params = {};
      for (const q of type.params) params[q.id] = view.node.params[q.id] ?? q.default;
      const out = { format: 1, params };
      if (view.node.data !== undefined && view.node.data !== null) out.data = clone(view.node.data);
      return out;
    }
    async function store(name, existing) {
      if (!view.api.savePreset) return "Presets cannot be saved here.";
      const preset = snapshot();
      if (existing && existing.description) preset.description = existing.description;
      const list = await view.api.savePreset(userKind(type.type), name, preset);
      if (!Array.isArray(list)) return "The preset could not be saved.";
      userCache.set(type.type, list.filter((p) => p && p.preset && p.preset.params));
      lastLoaded.set(view.node.id, { origin: "user", name });
      update();
      return "";
    }
    save.addEventListener("click", async () => {
      await refreshUser();
      const c = current();
      if (c.preset && c.preset.origin === "user" && c.modified) {
        const err = await store(c.preset.name, c.preset);
        if (err) showMenu(err);
      } else showMenu(null, true);
    });

    // ---- the menu (attached to the page, so a window's scrolling does not clip it)
    async function showMenu(notice, saving) {
      closeMenu();
      await refreshUser();
      const menu = el("div", "bv-pmenu");
      menu.style.setProperty("--accent", getComputedStyle(view.root).getPropertyValue("--accent"));
      const c = current();
      const isCurrent = (p) => c.preset && c.preset.origin === p.origin && c.preset.name === p.name;
      const item = (p) => {
        const row = el("div", "bv-pitem" + (isCurrent(p) ? " on" : ""));
        row.append(el("span", "bv-pitem-name", p.name));
        if (p.description) row.title = p.description;
        row.addEventListener("click", () => { closeMenu(); load(p); });
        return row;
      };
      const fac = factory();
      menu.append(el("div", "bv-phead", "Factory"));
      for (const p of fac) menu.appendChild(item(p));
      menu.append(el("div", "bv-phead", "User"));
      const mine = user();
      if (!mine.length) menu.append(el("div", "bv-pempty", "Nothing saved yet. Use Save to keep the current settings."));
      for (const p of mine) {
        const row = item(p);
        const del = el("button", "bv-pdel", "×");
        del.title = "Delete preset";
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!del.classList.contains("sure")) {
            del.classList.add("sure"); del.textContent = "Delete?";
            setTimeout(() => { del.classList.remove("sure"); del.textContent = "×"; }, 3000);
            return;
          }
          const list = await view.api.deletePreset(userKind(type.type), p.name);
          if (Array.isArray(list)) userCache.set(type.type, list.filter((q) => q && q.preset && q.preset.params));
          const seen = lastLoaded.get(view.node.id);
          if (seen && seen.origin === "user" && seen.name === p.name) lastLoaded.delete(view.node.id);
          update();
          showMenu();
        });
        row.appendChild(del);
        menu.appendChild(row);
      }
      // Footer: save under a name, back to the defaults.
      const foot = el("div", "bv-pfoot");
      const form = el("form", "bv-pform");
      const input = el("input", "bv-pinput");
      input.placeholder = "Name of a new preset";
      input.maxLength = 60;
      input.value = saving && c.preset && c.preset.origin === "user" ? c.preset.name : "";
      const go = el("button", "bv-pbtn", "Save");
      go.type = "submit";
      const msg = el("div", "bv-pmsg", notice || "");
      form.append(input, go);
      let replace = "";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { msg.textContent = "Give the preset a name."; return; }
        if (fac.some((p) => p.name.toLowerCase() === name.toLowerCase())) { msg.textContent = "“" + name + "” is a factory preset and cannot be replaced. Pick another name."; return; }
        const old = mine.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (old && replace !== name.toLowerCase() && !(c.preset && c.preset.origin === "user" && c.preset.name === old.name)) {
          replace = name.toLowerCase();
          msg.textContent = "“" + old.name + "” exists. Save again to replace it.";
          return;
        }
        const err = await store(old ? old.name : name, old);
        if (err) msg.textContent = err;
        else closeMenu();
      });
      input.addEventListener("input", () => { msg.textContent = ""; replace = ""; });
      const init = el("button", "bv-pbtn bv-pinit", "Reset to defaults");
      init.addEventListener("click", () => { closeMenu(); lastLoaded.delete(view.node.id); applyPreset({ params: {} }); update(); });
      foot.append(form, msg, init);
      menu.appendChild(foot);

      document.body.appendChild(menu);
      const r = pick.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
      const below = innerHeight - r.bottom - 12;
      menu.style.top = r.bottom + 4 + "px";
      menu.style.maxHeight = Math.max(160, below) + "px";
      const away = (e) => { if (!menu.contains(e.target) && !pick.contains(e.target) && !save.contains(e.target)) closeMenu(); };
      const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } };
      document.addEventListener("pointerdown", away, true);
      document.addEventListener("keydown", key, true);
      openMenu = { el: menu, away, key, owner: pick };
      const sel = menu.querySelector(".bv-pitem.on");
      if (sel) sel.scrollIntoView({ block: "nearest" });
      if (saving) input.focus();
    }
    // The user's presets, read once per module type, so a node set to one of them shows its name straight away.
    if (!userCache.has(type.type)) refreshUser().then(update);
    pick.addEventListener("click", () => (openMenu && openMenu.owner === pick ? closeMenu() : showMenu()));
    update();
    return { el: bar, update };
  }

  window.BleepViewPresets = { makePresetBar, loadFactoryPresets, factoryOf };
})();
