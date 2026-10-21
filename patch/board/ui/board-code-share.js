// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-code-share.js — what a module script says about itself (the Code node's Metadata tab), and sharing it with the Bleep Library (the Share
// button): a dialog that asks for the summary, category, licence, version and help text, builds the package in the browser (web/js/bleepmod.js)
// and uploads it as a community module under the user's library name.
//
//   BleepCodeShare.defaults(iface)         the metadata of a module script that has none yet
//   BleepCodeShare.metaUi(view, root)      the Metadata tab: { get(), set(meta), showHandle() }; changes are saved on the node
//   BleepCodeShare.libraryHandle(create)   Promise<{ signedIn, handle?, offline? }>: the library name of the logged-in user (made when `create`)
//   BleepCodeShare.shareDialog(opts)       opens the dialog; opts: { name, slug, get(): { source, settings, meta, help }, save({ meta, help }),
//                                          compile(source, typeId, settings): Promise<{ wasm, specs }|null>, hasUi }   (get() also returns the UI's source: view)
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const P = (G.BleepSeal && G.BleepSeal.priv) || G;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  const LICENSES = ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "CC0-1.0", "Unlicense", "MPL-2.0", "LGPL-3.0-or-later", "GPL-3.0-or-later"];
  const SEMVER = /^\d+\.\d+\.\d+$/;
  const nextVersion = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || ""); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.0"; };

  const defaults = (iface) => ({
    publisher: "mine", name: (iface && iface.name) || "", version: "1.0.0", summary: (iface && iface.description) || "", category: (iface && iface.category) || "",
    license: "MIT", shareSource: true, tags: "", homepage: "", notes: "",
  });

  /// The name the user's modules go by in the library. { signedIn: false } when nobody is logged in, { offline: true } where there is no library.
  async function libraryHandle(create) {
    try {
      const r = await G.fetch(create ? "/api/registry/community/handle" : "/api/registry/community/me", { method: create ? "POST" : "GET", credentials: "same-origin" });
      if (r.status === 401) return { signedIn: false };
      if (r.status === 404 || r.status === 405) return { offline: true, old: true };   // a library without the community endpoints
      if (!r.ok) return { offline: true };
      const body = await r.json();
      return { signedIn: true, handle: body.handle || null };
    } catch (e) { return { offline: true }; }
  }

  /// A labelled field. kind: "text" | "area" | "select" | "readonly" | "check".
  function field(label, kind, hint, options) {
    const row = el("label", "bc-field" + (kind === "check" ? " check" : "")), name = el("span", "bc-field-name", label);
    let input;
    if (kind === "check") { input = el("input"); input.type = "checkbox"; }
    else if (kind === "area") input = el("textarea");
    else if (kind === "select") { input = el("select"); for (const o of options) input.append(new Option(o, o)); }
    else { input = el("input"); input.type = "text"; if (kind === "readonly") input.readOnly = true; }
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => e.stopPropagation());   // typing is not for the board's shortcuts or the computer keyboard's notes
    input.addEventListener("keyup", (e) => e.stopPropagation());
    if (kind === "check") row.append(input, name); else row.append(name, input);
    if (hint) row.append(el("span", "bc-field-hint", hint));
    return { row, input, name };
  }

  /// The Metadata tab. Saved on the node (node.code.meta) when a field is left.
  function metaUi(view, root) {
    const mount = root.querySelector(".bc-meta"), node = view.node;
    const iface = (node.code && node.code.interface) || {};
    const saved = (node.code && node.code.meta) || null;
    const values = { ...defaults(iface), ...(saved || {}) };
    values.name = iface.name || values.name;   // the name is the script's own (@module)
    const f = {
      publisher: field("Publisher", "text", "Your name in the library; the module is Add › … › " + (iface.name || "name") + " under it. Modules you convert without signing in use “mine”. A shared module always goes out under your library name."),
      name: field("Module name", "readonly", "Set in the script: @module({ name: … })."),
      version: field("Version", "text", "x.y.z. Every share needs a higher one than the last."),
      summary: field("Summary", "area", "One or two sentences for the library's tile (up to 280 characters)."),
      category: field("Category", "text", "Where the module sits in the Add menu, for example Effects/Distortion."),
      license: field("Licence", "select", "What others may do with the module. Everything you share is published under it.", LICENSES),
      shareSource: field("Share the source code", "check", "Include the script when you share, so everyone can open the module in a Code node (Convert to code), change it and make their own. The licence above applies to the source too. Turn it off to share only the compiled module."),
      tags: field("Tags", "text", "A few words, separated by commas."),
      homepage: field("Web page", "text", "Optional: where to read more or report problems (https://…)."),
      notes: field("Release notes", "area", "What is new in this version."),
    };
    f.summary.input.maxLength = 280; f.summary.input.rows = 3; f.notes.input.rows = 3;
    f.category.input.setAttribute("list", "bc-categories");
    const list = document.getElementById("bc-categories") || (() => {
      const d = el("datalist"); d.id = "bc-categories";
      const cats = new Set();
      for (const t of Object.values((view.api.types && view.api.types()) || {})) if (t && t.category && t.category !== "Cells") cats.add(t.category);
      for (const c of [...cats].sort()) d.append(new Option(c, c));
      document.body.append(d);
      return d;
    })();
    void list;
    const form = el("div", "bc-meta-form");
    for (const k of ["publisher", "name", "version", "summary", "category", "license", "shareSource", "tags", "homepage", "notes"]) form.append(f[k].row);
    mount.append(form);

    const set = (m) => {
      for (const k of Object.keys(f)) {
        const input = f[k].input;
        if (input.type === "checkbox") { input.checked = m[k] !== false; continue; }   // on unless it was turned off
        const v = m[k] != null ? m[k] : "";
        if (input.tagName === "SELECT" && !LICENSES.includes(v)) input.append(new Option(v, v));
        input.value = v;
      }
      check();
    };
    const get = () => Object.fromEntries(Object.keys(f).map((k) => [k, f[k].input.type === "checkbox" ? f[k].input.checked : f[k].input.value.trim()]));
    const check = () => {
      f.version.input.classList.toggle("bad", !SEMVER.test(f.version.input.value.trim()));
      f.homepage.input.classList.toggle("bad", !!f.homepage.input.value.trim() && !/^https?:\/\//.test(f.homepage.input.value.trim()));
    };
    const save = () => {
      check();
      const code = view.node.code;
      if (!code) return;
      const next = get();
      if (JSON.stringify(code.meta || null) !== JSON.stringify(next)) view.api.setNodeProperty("code", { ...code, meta: next });
    };
    for (const k of Object.keys(f)) { f[k].input.addEventListener("change", save); f[k].input.addEventListener("blur", save); f[k].input.addEventListener("input", check); }
    set(values);

    /// Fills in the publisher with the library name of the logged-in user, as long as the author has not chosen one.
    function showHandle() {
      if (saved && saved.publisher) return;
      libraryHandle(false).then((who) => { if (who.signedIn && who.handle && !(view.node.code && view.node.code.meta && view.node.code.meta.publisher)) { f.publisher.input.value = who.handle; } });
    }
    return { get, set, save, showHandle };
  }

  // ---- the Share dialog ----------------------------------------------------------------------------------------------------------------------
  function shareDialog(opts) {
    const U = G.BleepUserModules, Mod = G.BleepMod;
    const state = opts.get();
    const meta = { ...defaults({ name: opts.name }), ...(state.meta || {}) };
    const section = el("section", "share-dialog"), title = el("h2", "", `Share “${opts.name}”`);
    const intro = el("p", "share-intro", "");
    const fields = {
      summary: field("Summary", "area", "One or two sentences for the library's tile (up to 280 characters)."),
      category: field("Category", "text", ""),
      license: field("Licence", "select", "", LICENSES),
      version: field("Version", "text", "x.y.z, higher than the last one you shared."),
      shareSource: field("Share the source code", "check", "So everyone can open the module in a Code node (Convert to code) and change it. The licence applies to it too."),
      help: field("Help page", "area", "Markdown: shown by the module's ? button. Images are left out."),
    };
    fields.summary.input.maxLength = 280; fields.summary.input.rows = 3; fields.help.input.rows = 9;
    fields.summary.input.value = meta.summary; fields.category.input.value = meta.category;
    if (!LICENSES.includes(meta.license)) fields.license.input.append(new Option(meta.license, meta.license));
    fields.license.input.value = meta.license;
    fields.version.input.value = meta.shared ? nextVersion(meta.shared) : meta.version;
    fields.shareSource.input.checked = meta.shareSource !== false;
    fields.help.input.value = state.help || "";
    const note = el("p", "share-note", opts.hasUi ? "The module's own picture (its UI) goes with it. It only ever runs in the same sandbox as in your Code node: no network, no storage, and it is stopped if it hangs." : "");
    const status = el("p", "share-status", "");
    const cancel = el("button", "", "Cancel"), go = el("button", "primary", "Share");
    cancel.type = go.type = "button";
    const buttons = el("div", "share-buttons"); buttons.append(cancel, go);
    section.append(title, intro, fields.summary.row, fields.category.row, fields.license.row, fields.version.row, fields.shareSource.row, fields.help.row, note, status, buttons);
    section.hidden = true;
    const close = () => { P.BleepModal.toggle(section, false); setTimeout(() => P.BleepModal.unmount(section), 0); };
    P.BleepModal.mount(section, close);
    section.classList.add("share");
    P.BleepModal.toggle(section, true);
    cancel.addEventListener("click", close);

    const say = (text, cls = "") => { status.textContent = text; status.className = "share-status " + cls; };
    let who = null;
    const slug = opts.slug;
    libraryHandle(false).then((w) => {
      who = w;
      if (w.signedIn && w.handle) intro.textContent = `It will be published as ${w.handle}/${slug} in the Bleep Library, under your name, for everyone to install.`;
      else if (w.signedIn) intro.textContent = `It will be published in the Bleep Library under your library name (made when you share), for everyone to install.`;
      else if (w.old) intro.textContent = "This Bleep Library cannot take shared modules yet: its website needs an update.";
      else if (w.offline) intro.textContent = "There is no Bleep Library to share to here.";
      else intro.innerHTML = "You are not logged in to the Bleep Library. <a href=\"/login/\" target=\"_blank\" rel=\"noopener\">Log in</a> (in another tab), then press Share again.";
    });

    let finished = false;
    go.addEventListener("click", async () => {
      if (finished) { close(); return; }
      const version = fields.version.input.value.trim();
      if (!SEMVER.test(version)) { say("The version is three numbers with dots, such as 1.0.1.", "bad"); return; }
      if (!fields.summary.input.value.trim()) { say("Write a summary: it is what the library shows next to the module.", "bad"); return; }
      go.disabled = true;
      try {
        say("asking the library for your name…");
        const me = await libraryHandle(true);
        if (me.old) { say("This Bleep Library cannot take shared modules yet: its website needs an update.", "bad"); return; }
        if (me.offline) { say("There is no Bleep Library to share to here.", "bad"); return; }
        if (!me.signedIn || !me.handle) { say("You are not logged in to the Bleep Library: log in (another tab), then press Share again.", "bad"); return; }
        const edited = { ...meta, summary: fields.summary.input.value.trim(), category: fields.category.input.value.trim(), license: fields.license.input.value, version, shareSource: fields.shareSource.input.checked };
        const help = fields.help.input.value;
        opts.save({ meta: edited, help });   // what was typed here is kept, whether or not the upload works
        say(`compiling for ${me.handle}/${slug}…`);
        const now = opts.get();
        const r = await opts.compile(now.source, `${me.handle}/${slug}`, now.settings || {});
        if (!r || !r.wasm || !r.specs || !r.specs.length) { say("The module did not compile.", "bad"); return; }
        const bytes = Mod.build({ handle: me.handle, slug, version, title: opts.name, summary: edited.summary, category: edited.category, license: edited.license, spec: r.specs,
          wasm: r.wasm, help, view: now.view, source: edited.shareSource ? now.source : "" });
        say(`uploading ${Math.round(bytes.length / 1024)} KB…`);
        const done = await Mod.upload(bytes, slug, version);
        if (!done.ok) { say(done.error || "The library refused the module.", "bad"); return; }
        opts.save({ meta: { ...edited, shared: version }, help });
        say(`Shared as ${done.id} ${done.version}. It appears in the library shortly; install it from there like any module.`, "ok");
        go.textContent = "Done";
        finished = true;
      } catch (e) { say(`Could not share: ${e.message}`, "bad"); } finally { go.disabled = false; }
    });
    return { close };
  }

  P.BleepCodeShare = { defaults, metaUi, libraryHandle, shareDialog, nextVersion, SEMVER };
})();
