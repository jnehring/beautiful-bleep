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

  /// The Share… dialog. Resolves with { address, version } when the preset was shared, else null.
  function share(kind, name, preset, host) {
    return new Promise(async (resolve) => {
      const st = await status(false);
      const back = el("div", "ac-back");
      const box = el("div", "ac-box");
      back.appendChild(box);
      const close = (v) => { cancelled = true; back.remove(); resolve(v || null); };
      back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
      box.appendChild(el("h3", "", "Share “" + name + "”"));
      const msg = el("div", "ac-msg");

      const form = () => {
        box.innerHTML = "";
        box.appendChild(el("h3", "", "Share “" + name + "”"));
        box.appendChild(el("div", "ac-note", "You are signed in as " + (last.name || last.email || "you") + "."));
        const field = (label, input) => { const l = el("label", "", label); l.appendChild(input); box.appendChild(l); return input; };
        const title = field("Title", el("input")); title.value = name; title.maxLength = 120;
        const summary = field("Description", el("textarea")); summary.maxLength = 280; summary.rows = 3;
        summary.value = (preset.description || "").slice(0, 280);
        const tags = field("Tags (comma separated)", el("input")); tags.value = (preset.tags || []).join(", ");
        const vis = field("Visibility", el("select"));
        for (const [v, t] of [["private", "Private: only you can open it"], ["public", "Public: anyone can find, play and download it"]]) {
          const o = el("option", "", t); o.value = v; vis.appendChild(o);
        }
        box.appendChild(el("div", "ac-note", "Public patches are licensed CC BY 4.0: others may copy and change them if they credit you. You can make it public later."));
        box.appendChild(msg);
        const row = el("div", "ac-row");
        const cancelBtn = el("button", "", "Cancel");
        const go = el("button", "ac-primary", "Share");
        cancelBtn.addEventListener("click", () => close());
        go.addEventListener("click", async () => {
          const big = window.BleepMedia.tooBig(preset.media);   // the audio it carries must fit what the library takes
          if (big) { msg.className = "ac-msg bad"; msg.textContent = "Not shared: " + big + "."; return; }
          go.disabled = true; msg.className = "ac-msg"; msg.textContent = "Sharing…";
          const { library, ...clean } = preset;   // the link to the library is the project's own; the file holds none
          const body = {
            title: title.value.trim(), summary: summary.value.trim(), type: kind === "cells" ? "cell" : "patch",
            tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean), preset: clean, visibility: vis.value,
            slug: slugOf(name),   // a slug of your own that exists is a new version; the project's link (pid) is how Update finds it
          };
          const r = await call("POST", "/api/presets", body);
          go.disabled = false;
          if (r && r.status === 201) {
            const done = { address: r.body.address, pid: r.body.pid, version: r.body.version, sha256: r.body.versions[0].sha256, visibility: r.body.visibility };
            box.innerHTML = "";
            box.appendChild(el("h3", "", "Shared"));
            box.appendChild(el("div", "ac-note", "“" + r.body.title + "” is in the Bleep Library as version " + r.body.version + ", "
              + (done.visibility === "public" ? "public." : "private: only you can open it until you make it public on the website (your account, Your presets).")));
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
          msg.className = "ac-msg bad";
          msg.textContent = (r && r.error) || "Could not share the preset.";
        });
        row.append(cancelBtn, go);
        box.appendChild(row);
        title.focus();
      };

      const signedOut = () => {
        box.innerHTML = "";
        box.appendChild(el("h3", "", "Sign in to share"));
        box.appendChild(el("div", "ac-note", last && last.playLogin
          ? "Sharing needs an account. Log in on the website, then come back here."
          : "Sharing needs an account on the Bleep Library. Sign in: the website shows a page where you confirm the code below."));
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
    const q = "patch=" + encodeURIComponent(link.pid) + "&v=" + link.version;
    const embed = base + "/embed/?" + q;
    return {
      library: base + "/library/p/" + encodeURIComponent(link.pid) + "/" + link.version,
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
      const done = (ok, value) => { back.remove(); resolve({ ok, value }); };
      back.addEventListener("mousedown", (e) => { if (e.target === back) done(false); });
      back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } });
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

  /// A dialog that asks the user to sign in because `title` needs the login (the patch assistant: its first use). Resolves true when the
  /// user is signed in (already, or after the dialog), false when they dismissed it.
  function requireSignIn(title, note) {
    return new Promise(async (resolve) => {
      const st = await status(false);
      if (st.signedIn) { resolve(true); return; }
      const back = el("div", "ac-back");
      const box = el("div", "ac-box");
      back.appendChild(box);
      const close = (v) => { cancel(); back.remove(); resolve(!!v); };
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

  const api = P.BleepAccount = { enabled: false, client: "Bleep", status, signIn, cancel, signOut, call, share, urls, copy, ask, toast, requireSignIn, onChange: (f) => listeners.add(f), open, get last() { return last; } };
})();
