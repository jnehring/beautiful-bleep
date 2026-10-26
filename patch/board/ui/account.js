// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// account.js — the user's login to the Bleep Library and what needs it: sharing presets (developers/modules/library.md, "Login in the app").
// Same code in the app, the plugins and Bleep Play; only what `native("account", …)` does differs:
//   app, plugins   the device flow: a code to confirm on the website, the token kept in the OS keychain (patch/library/Account.cpp)
//   Bleep Play     the website's own session cookie (board-demo.js): logging in happens on the site
//
//   BleepAccount.status(verify)        { signedIn, name, email, libraryUrl, pending?, offline? }
//   BleepAccount.signIn(onCode)        the device flow; onCode({ userCode, url }) shows the code; resolves with the status or { error }
//   BleepAccount.cancel() / signOut()
//   BleepAccount.call(method, path, body)   a call to the library's API with the login: { status, body, error }
//   BleepAccount.share(kind, name, preset)  the Share… dialog; kind is "cells" or "boards" (the local preset kinds)
//   BleepAccount.urls(link)            the Library, Play and Embed links and the iframe code of a shared version (link = { pid, version })
//   BleepAccount.copy(text, what)      puts text on the clipboard and says so
//   BleepAccount.shareSubject / updateSubject / restoreSubject / copySubjectLink(subject, …)   the Share menu for a project or a cell
//   BleepAccount.ask(title, note, opts) a dialog with buttons and an optional list: { ok, value } (confirm() does not work in plugins)
(function () {
  "use strict";
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, priv: P } = window.BleepSeal;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = (url) => native("openUrl", url);

  let cancelled = false;
  const listeners = new Set();
  let last = null;
  async function status(verify) {
    last = (await native("account", "status", !!verify)) || { signedIn: false };
    for (const f of listeners) f(last);
    return last;
  }

  /// The device flow. Opens the website's confirmation page; resolves when the user answered there, or it ran out.
  async function signIn(onCode) {
    cancelled = false;
    const start = await native("account", "start", api.client || "Bleep");
    if (!start || start.error) return { error: (start && start.error) || "could not start the sign-in" };
    if (onCode) onCode(start);
    open(start.url);
    const until = Date.now() + start.expiresIn * 1000;
    while (!cancelled && Date.now() < until) {
      await wait(start.interval * 1000);
      if (cancelled) break;
      const r = await native("account", "poll");
      if (r.state === "approved") { await status(false); return r; }
      if (r.state === "denied") return { error: "The sign-in was refused on the website." };
      if (r.state === "expired" || r.state === "none") break;
      // "error": the network may be back at the next poll
    }
    await native("account", "cancel");
    return { error: cancelled ? "" : "The code ran out. Sign in again." };
  }
  async function cancel() { cancelled = true; await native("account", "cancel"); }
  async function signOut() { last = await native("account", "signOut"); for (const f of listeners) f(last); return last; }
  const call = (method, path, body) => native("account", "call", method, path, body === undefined ? null : body);

  /// "My Pad" → "my-pad": the address name the library would make of it.
  const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "preset";

  /// The upload dialog: what makes it clear that the user puts something in the library. `kind` is "cells" or "boards" (the local preset
  /// kinds); `opts` for a new version of a patch already there: { pid, title, summary, tags, label }. Resolves with
  /// { address, pid, version, label, sha256, visibility, title } when it was uploaded, else null.
  function share(kind, name, preset, opts) {
    opts = opts || {};
    const update = !!opts.pid;
    const noun = kind === "cells" ? "cell" : "project";
    return new Promise(async (resolve) => {
      const st = await status(false);
      const back = el("div", "ac-back");
      const box = el("div", "ac-box");
      back.appendChild(box);
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } };
      const close = (v) => { cancelled = true; document.removeEventListener("keydown", onKey, true); back.remove(); resolve(v || null); };
      document.addEventListener("keydown", onKey, true);   // Escape closes the dialog wherever the focus is
      back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
      const heading = update ? "Upload a new version of “" + (opts.title || name) + "”" : "Upload “" + name + "” to the Bleep Library";
      box.appendChild(el("h3", "", heading));
      const msg = el("div", "ac-msg");

      const form = () => {
        box.innerHTML = "";
        box.appendChild(el("h3", "", heading));
        const field = (label, input) => { const l = el("label", "", label); l.appendChild(input); box.appendChild(l); return input; };
        const title = field("Name (required)", el("input")); title.value = opts.title || name; title.maxLength = 120;
        const summary = field("Description (required)", el("textarea")); summary.maxLength = 280; summary.rows = 3;
        summary.value = (opts.summary !== undefined ? opts.summary : preset.description || "").slice(0, 280);
        const label = field("Version number (required, like 1.0)", el("input")); label.maxLength = 9; label.placeholder = "1.0"; label.value = opts.label || "";
        const tags = field("Tags (comma separated)", el("input")); tags.value = (opts.tags || preset.tags || []).join(", ");
        // A cell is in up to three places of the cell category tree (the Add menu's); no new categories.
        const picked = new Set((opts.picked || []).filter((c) => (opts.categories || []).includes(c)));
        let useRole = null;
        if (kind === "cells" && opts.categories) {
          const group = el("div", "ac-choice");
          const head = el("div", "ac-choice-label");
          const list = el("div", "ac-cats");
          const draw = () => {
            head.textContent = "Categories (required, up to 3): " + (picked.size ? [...picked].join(", ") : "none chosen");
            for (const i of list.querySelectorAll("input")) i.disabled = !i.checked && picked.size >= 3;
          };
          for (const c of opts.categories) {
            const l = el("label", "ac-radio");
            const i = el("input"); i.type = "checkbox"; i.checked = picked.has(c);
            i.addEventListener("change", () => { if (i.checked) picked.add(c); else picked.delete(c); draw(); });
            l.append(i, document.createTextNode(" " + c.replace(/\//g, " › ")));
            list.appendChild(l);
          }
          group.append(head, list);
          box.appendChild(group);
          draw();
          // What it can be loaded as: an instrument (notes in, audio out) or an effect (audio in and out), from the cell's jacks.
          const roleBox = el("div", "ac-choice");
          if (opts.plays) {
            const l = el("label", "ac-radio");
            useRole = el("input"); useRole.type = "checkbox"; useRole.checked = opts.useRole !== false;
            l.append(useRole, document.createTextNode(" Offer it as a Beautiful Bleep " + opts.plays.role));
            roleBox.appendChild(l);
            roleBox.appendChild(el("div", "", opts.plays.role === "instrument"
              ? "It then plays from MIDI in Bleep Instrument and in Bleep Play, with a keyboard."
              : "It then processes audio in Bleep FX and in Bleep Play."));
          } else {
            roleBox.appendChild(el("div", "", "This cell stays a cell for the board: an instrument has audio out and no audio in, an effect has audio in and out."));
          }
          box.appendChild(roleBox);
        }
        // Two radio buttons, not a drop-down: both choices are in sight, and a WebView needs no pop-up list for them.
        let vis = null;
        if (!update) {
          const group = el("div", "ac-choice");
          group.setAttribute("role", "radiogroup");
          group.appendChild(el("div", "ac-choice-label", "Who can open it"));
          const name_ = "ac-vis-" + Math.random().toString(36).slice(2, 7);
          vis = { value: "private", change: () => {} };
          for (const [v, t] of [["private", "Only me (private)"], ["public", "Everyone (public)"]]) {
            const l = el("label", "ac-radio");
            const r = el("input"); r.type = "radio"; r.name = name_; r.value = v; r.checked = v === vis.value;
            r.addEventListener("change", () => { vis.value = v; drawHint(); });
            l.append(r, document.createTextNode(" " + t));
            group.appendChild(l);
          }
          box.appendChild(group);
        }
        const hint = el("div", "ac-hint");
        box.appendChild(hint);
        const drawHint = () => {
          const pub = update || (vis && vis.value === "public");
          hint.className = "ac-hint" + (pub ? " public" : "");
          hint.textContent = update
            ? "This adds a new version to the Bleep Library. If the " + noun + " is public, everyone can see this version, play it, download it, copy it and change it, under the CC BY 4.0 license."
            : vis.value === "public"
              ? "Public: you are sharing this " + noun + " with everyone. Anyone can find it in the Bleep Library, play it, download it, copy it and change it, under the CC BY 4.0 license, if they credit you."
              : "Private: only you can open it, for now. You can make it public later on the website, and then everyone can use it under the CC BY 4.0 license.";
        };
        drawHint();
        box.appendChild(msg);
        const row = el("div", "ac-row");
        const cancelBtn = el("button", "", "Cancel");
        const go = el("button", "ac-primary", "Upload");
        cancelBtn.addEventListener("click", () => close());
        const problem = () => {
          if (!title.value.trim()) return "Give it a name.";
          if (!summary.value.trim()) return "Add a description, so others know what it is.";
          if (!/^\d{1,4}\.\d{1,4}$/.test(label.value.trim())) return "The version number looks like 1.0 (two numbers with a dot).";
          if (kind === "cells" && opts.categories && !picked.size) return "Choose at least one category, so others can find it.";
          return "";
        };
        go.addEventListener("click", async () => {
          const bad = problem();
          if (bad) { msg.className = "ac-msg bad"; msg.textContent = bad; return; }
          const big = window.BleepMedia.tooBig(preset.media);   // the audio it carries must fit what the library takes
          if (big) { msg.className = "ac-msg bad"; msg.textContent = "Not uploaded: " + big + "."; return; }
          go.disabled = true; msg.className = "ac-msg"; msg.textContent = "Uploading…";
          const { library, ...clean } = preset;   // the link to the library is the project's own; the file holds none, nor do its cells
          if (Array.isArray(clean.nodes)) clean.nodes = clean.nodes.map(({ library: l, ...n }) => n);
          if (kind === "cells" && opts.categories) {
            clean.category = [...picked][0];
            clean.categories = [...picked];
            if (useRole && useRole.checked) clean.plays = opts.plays.spec; else delete clean.plays;
          }
          const body = {
            title: title.value.trim(), summary: summary.value.trim(), type: kind === "cells" ? "cell" : "patch", version_label: label.value.trim(),
            tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean), preset: clean,
            slug: slugOf(opts.title || name),   // a slug of your own that exists is a new version; the pid is how an update finds its patch
          };
          if (kind === "cells" && opts.categories) body.categories = [...picked];
          if (update) body.pid = opts.pid; else body.visibility = vis.value;
          const r = await call("POST", "/api/presets", body);
          go.disabled = false;
          if (r && r.status === 201) {
            const done = { address: r.body.address, pid: r.body.pid, version: r.body.version, label: r.body.version_label, sha256: r.body.versions[0].sha256,
                           visibility: r.body.visibility, title: r.body.title };
            box.innerHTML = "";
            box.appendChild(el("h3", "", "Uploaded"));
            box.appendChild(el("div", "ac-note", "“" + r.body.title + "” is in the Bleep Library as version " + done.label + ", "
              + (done.visibility === "public" ? "public: everyone can use it." : "private: only you can open it until you make it public on the website (your account, Your presets).")));
            const row2 = el("div", "ac-row");
            const see = el("button", "", "Open in the library");
            see.addEventListener("click", () => open(urls(done).library));
            const ok = el("button", "ac-primary", "Done");
            ok.addEventListener("click", () => close(done));
            row2.append(see, ok);
            box.appendChild(row2);
            return;
          }
          if (r && r.status === 401) { await status(false); signedOut(); return; }
          if (r && r.status === 404 && update) { close({ gone: true }); return; }
          msg.className = "ac-msg bad";
          msg.textContent = (r && r.error) || "Could not upload it.";
        });
        row.append(cancelBtn, go);
        box.appendChild(row);
        title.focus();
      };

      const signedOut = () => {
        box.innerHTML = "";
        box.appendChild(el("h3", "", "Sign in to upload"));
        box.appendChild(el("div", "ac-note", last && last.playLogin
          ? "Uploading needs an account. Log in on the website, then come back here."
          : "Uploading needs an account on the Bleep Library. Sign in: the website shows a page where you confirm the code below."));
        const code = el("div", "ac-code");
        box.appendChild(code);
        box.appendChild(msg);
        msg.textContent = "";
        const row = el("div", "ac-row");
        const cancelBtn = el("button", "", "Cancel");
        const go = el("button", "ac-primary", last && last.playLogin ? "Log in" : "Sign in…");
        cancelBtn.addEventListener("click", () => close());
        go.addEventListener("click", async () => {
          if (last && last.playLogin) {   // Play: the login is the website's; look again when the user is back
            if (go.dataset.opened) {
              if ((await status(false)).signedIn) form(); else { msg.className = "ac-msg bad"; msg.textContent = "Not logged in yet."; }
              return;
            }
            go.dataset.opened = "1";
            go.textContent = "I have logged in";
            open(last.libraryUrl + "/login/");
            return;
          }
          go.disabled = true;
          const r = await signIn((c) => { code.textContent = c.userCode; msg.className = "ac-msg"; msg.textContent = "Waiting for you to confirm it in the browser…"; });
          if (r && r.error !== undefined) { go.disabled = false; code.textContent = ""; msg.className = "ac-msg bad"; msg.textContent = r.error; return; }
          form();
        });
        row.append(cancelBtn, go);
        box.appendChild(row);
      };

      document.body.appendChild(back);
      if (st.signedIn) form(); else signedOut();
    });
  }

  /// The links of one version of a shared patch (sharing.md): every link names the version, so it shows what was shared then.
  function urls(link) {
    const base = (last && last.libraryUrl) || "";
    const v = link.label || link.version;   // the author's number ("1.2"); the sequence number for links made before there were any
    const q = "patch=" + encodeURIComponent(link.pid) + "&v=" + encodeURIComponent(v);
    const embed = base + "/embed/?" + q;
    return {
      library: base + "/library/p/" + encodeURIComponent(link.pid) + "/" + encodeURIComponent(v),
      play: base + "/play/?" + q,
      embed,
      iframe: '<iframe src="' + embed + '" width="720" height="420" allow="autoplay; midi; fullscreen" loading="lazy"></iframe>',
    };
  }

  let toastTimer = 0;
  function toast(text) {
    let t = document.querySelector(".ac-toast");
    if (!t) { t = el("div", "ac-toast"); t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3000);
  }

  async function copy(text, what) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* denied or insecure context */ }
    if (!ok) {
      const ta = el("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { /* nothing more to try */ }
      ta.remove();
    }
    toast(ok ? (what || "Link") + " copied." : "Could not copy. Select it from the library page instead.");
    return ok;
  }

  /// A small dialog: a title, a note, an optional list to choose from (opts.items = [{ value, label }], the first is chosen) and buttons
  /// (opts.ok, default "OK"; opts.cancel = a label, or "" for none). Resolves { ok, value }.
  function ask(title, note, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const back = el("div", "ac-back");
      const box = el("div", "ac-box");
      back.appendChild(box);
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(false); } };
      const done = (ok, value) => { document.removeEventListener("keydown", onKey, true); back.remove(); resolve({ ok, value }); };
      document.addEventListener("keydown", onKey, true);
      back.addEventListener("mousedown", (e) => { if (e.target === back) done(false); });
      box.appendChild(el("h3", "", title));
      if (note) box.appendChild(el("div", "ac-note", note));
      let pick = null;
      if (opts.items) {
        pick = el("select");
        for (const it of opts.items) { const o = el("option", "", it.label); o.value = it.value; pick.appendChild(o); }
        box.appendChild(pick);
      }
      const row = el("div", "ac-row");
      if (opts.cancel !== "") {
        const no = el("button", "", opts.cancel || "Cancel");
        no.addEventListener("click", () => done(false));
        row.appendChild(no);
      }
      const yes = el("button", "ac-primary", opts.ok || "OK");
      yes.addEventListener("click", () => done(true, pick ? pick.value : undefined));
      row.appendChild(yes);
      box.appendChild(row);
      document.body.appendChild(back);
      yes.focus();
    });
  }

  // ---------------------------------------------------------------- what is shared: a project or a cell (sharing.md)
  // A "subject" is { kind: "boards" | "cells", name(), preset(): the file to upload, link(): the link to its patch or null,
  // setLink(link | null), apply(doc, link): puts a library version in its place }. The link is { pid, version, label, sha256 }.
  const validLink = (l) => (l && typeof l.pid === "string" && /^[a-z0-9]{10}$/.test(l.pid) && Number.isInteger(l.version) && l.version > 0
    ? { pid: l.pid, version: l.version, label: typeof l.label === "string" ? l.label : "", sha256: typeof l.sha256 === "string" ? l.sha256 : "" } : null);
  const shown = (l) => l.label || String(l.version);
  const bump = (label) => { const m = /^(\d+)\.(\d+)$/.exec(label || ""); return m ? m[1] + "." + (Number(m[2]) + 1) : ""; };
  const noun = (s) => (s.kind === "cells" ? "cell" : "project");

  /// "This patch is no longer available": what the library says of a deleted or private patch. The user may unlink what was shared.
  async function gone(s) {
    const r = await ask("The library patch is gone",
      "It was deleted, or it is not yours. The " + noun(s) + " can be uploaded again as a new patch, with a new link.", { ok: "Unlink", cancel: "Keep" });
    if (r.ok) s.setLink(null);
  }

  /// First upload: the dialog, then the subject is linked to its patch.
  async function shareSubject(s) {
    const preset = await s.preset();
    if (!preset) return;
    const done = await share(s.kind, s.name(), preset, s.shareOptions ? s.shareOptions() : {});
    if (done) s.setLink({ pid: done.pid, version: done.version, label: done.label, sha256: done.sha256 });
  }

  /// A new version of the linked patch (the dialog asks for name, description and version again).
  async function updateSubject(s) {
    const link = validLink(s.link());
    if (!link) return;
    if (!(await requireSignIn("Sign in to upload", "Uploading to the library needs your account."))) return;
    const m = await call("GET", "/api/patches/" + link.pid);
    if (!m || m.status === 404) { await gone(s); return; }
    if (m.status !== 200) { toast((m && m.error) || "The library could not be reached."); return; }
    if (m.body.version !== link.version) {
      const r = await ask("The library has a newer version",
        "The library has version " + m.body.version_label + "; this " + noun(s) + " is from version " + shown(link) + ". Upload this one as a new version anyway?",
        { ok: "Upload anyway" });
      if (!r.ok) return;
    }
    const preset = await s.preset();
    if (!preset) return;
    const more = s.shareOptions ? s.shareOptions() : {};
    const done = await share(s.kind, s.name(), preset, Object.assign(more, { pid: link.pid, title: m.body.title, summary: m.body.summary, tags: m.body.tags,
      label: bump(m.body.version_label), picked: m.body.categories, useRole: (m.body.roles || []).length > 0 }));
    if (!done) return;
    if (done.gone) { await gone(s); return; }
    s.setLink({ pid: link.pid, version: done.version, label: done.label, sha256: done.sha256 });
    toast("Uploaded version " + done.label + ". The Share menu has its links.");
  }

  /// Restore from Library: a version of the linked patch (a list, the newest first) takes the place of the subject.
  async function restoreSubject(s) {
    const link = validLink(s.link());
    if (!link) return;
    if (!(await requireSignIn("Sign in to restore", "A private patch needs your account to be read."))) return;
    const m = await call("GET", "/api/patches/" + link.pid);
    if (!m || m.status === 404) { await gone(s); return; }
    if (m.status !== 200) { toast((m && m.error) || "The library could not be reached."); return; }
    const items = m.body.versions.map((v) => ({ value: String(v.version),
      label: "Version " + v.label + " · " + String(v.created_at).slice(0, 10) + (v.version === link.version ? " (this " + noun(s) + ")" : "") }));
    const pick = await ask("Restore from the library", s.restoreNote || "Replaces it with that version. You can undo it.", { items, ok: "Restore" });
    if (!pick.ok) return;
    const v = m.body.versions.find((x) => String(x.version) === pick.value);
    const f = v ? await call("GET", "/api/patches/" + link.pid + "/" + encodeURIComponent(v.label || v.version) + "/file") : null;
    if (!f || f.status !== 200 || !f.body) { toast(f && f.status === 404 ? "This patch is no longer available." : "That version could not be downloaded."); return; }
    await s.apply(f.body, { pid: link.pid, version: v.version, label: v.label, sha256: v.sha256 });
  }

  /// Copies the Library, Play or Embed link of the version the subject is linked to. A private patch opens for its author only.
  async function copySubjectLink(s, which) {
    const link = validLink(s.link());
    if (!link) return;
    await status(false).catch(() => null);
    const m = await call("GET", "/api/patches/" + link.pid).catch(() => null);
    if (m && m.status === 404) { await gone(s); return; }
    const u = urls(link);
    const what = { library: "Library link", play: "Play link", embed: "Embed code" }[which];
    await copy(which === "embed" ? u.iframe : u[which], what);
    if (m && m.status === 200 && m.body.visibility !== "public") toast(what + " copied. Only you can open it until the patch is public.");
  }

  /// A dialog that asks the user to sign in because `title` needs the login (the patch assistant: its first use). Resolves true when the
  /// user is signed in (already, or after the dialog), false when they dismissed it.
  function requireSignIn(title, note) {
    return new Promise(async (resolve) => {
      const st = await status(false);
      if (st.signedIn) { resolve(true); return; }
      const back = el("div", "ac-back");
      const box = el("div", "ac-box");
      back.appendChild(box);
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(false); } };
      const close = (v) => { cancel(); document.removeEventListener("keydown", onKey, true); back.remove(); resolve(!!v); };
      document.addEventListener("keydown", onKey, true);
      back.addEventListener("mousedown", (e) => { if (e.target === back) close(false); });
      box.appendChild(el("h3", "", title));
      box.appendChild(el("div", "ac-note", note + (st.playLogin
        ? " Log in on the website, then come back here."
        : " Sign in with your Bleep Library account: the website shows a page where you confirm the code below. Your password never reaches this app.")));
      const code = el("div", "ac-code");
      const msg = el("div", "ac-msg");
      box.append(code, msg);
      const row = el("div", "ac-row");
      const later = el("button", "", "Not now");
      const go = el("button", "ac-primary", st.playLogin ? "Log in" : "Sign in…");
      later.addEventListener("click", () => close(false));
      go.addEventListener("click", async () => {
        if (st.playLogin) {
          if (go.dataset.opened) {
            if ((await status(false)).signedIn) close(true); else { msg.className = "ac-msg bad"; msg.textContent = "Not logged in yet."; }
            return;
          }
          go.dataset.opened = "1";
          go.textContent = "I have logged in";
          open(st.libraryUrl + "/login/");
          return;
        }
        go.disabled = true;
        const r = await signIn((c) => { code.textContent = c.userCode; msg.className = "ac-msg"; msg.textContent = "Waiting for you to confirm it in the browser…"; });
        if (r && r.error !== undefined) { go.disabled = false; code.textContent = ""; if (r.error) { msg.className = "ac-msg bad"; msg.textContent = r.error; } return; }
        close(true);
      });
      row.append(later, go);
      box.appendChild(row);
      document.body.appendChild(back);
      go.focus();
    });
  }

  const api = P.BleepAccount = { enabled: false, client: "Bleep", status, signIn, cancel, signOut, call, share, urls, copy, ask, toast, validLink, shareSubject, updateSubject, restoreSubject, copySubjectLink, requireSignIn, onChange: (f) => listeners.add(f), open, get last() { return last; } };
})();
