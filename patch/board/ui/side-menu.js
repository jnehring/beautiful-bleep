// SPDX-License-Identifier: MIT
// side-menu.js — the board's side menu, collapsed by default (plugin, standalone app and browser).
//
//   Connect to App   the browser only: the button that joins this page to the Bleep App (web/js/bridge-ui.js)
//   Transport        play and stop (Play lights while it plays), tempo and sync. The app drives its own clock (native "settings" play/tempo/link),
//                    a plugin only shows Live's transport, the browser drives its worklet (BleepWeb.setTempo/setPlaying)
//                    and can follow the app once connected.
//   Preset           the name and source of the loaded preset (factory, library with link, user), and Upload to Library.
//
//   BleepSideMenu.init({ mode: "app" | "plugin" | "web", board(): the current board })
(function () {
  "use strict";
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let mode = "app", host = null;
  let root, toggle, body;
  let t = { bpm: 120, playing: false, link: false, linkAvailable: false, peers: 0 };   // what the menu shows of the transport
  let follow = false;           // web: follow the app's transport while connected
  let refs = {};                // the live parts of the DOM
  let timer = 0;

  const section = (title) => { const s = el("section", "sm-sec"); s.appendChild(el("h3", "", title)); body.appendChild(s); return s; };

  // ---------------------------------------------------------------- Connect to App
  function buildConnect() {
    const ui = window.BleepWeb && BleepWeb.bridgeUI;
    if (mode !== "web" || !ui) return;
    const s = section("Connect to App");
    const b = el("button", "sm-wide");
    const note = el("div", "sm-note");
    b.addEventListener("click", () => { if (!ui.connected && !ui.busy) ui.connect(); });
    s.append(b, note);
    const draw = () => {
      b.textContent = ui.connected ? "⇄ Connected" : ui.busy ? "⇄ Connecting…" : "⇄ Connect to app";
      b.disabled = ui.connected || ui.busy;
      b.classList.toggle("on", ui.connected);
      note.textContent = ui.text;
      note.classList.toggle("bad", ui.bad);
      if (!ui.connected && follow) { follow = false; if (refs.sync) refs.sync.checked = false; }
      drawTransport();
    };
    ui.onChange = draw;
    draw();
  }

  // ---------------------------------------------------------------- Transport
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

  function buildTransport() {
    const s = section("Transport");
    const row = el("div", "sm-row");
    refs.play = el("button", "sm-play", "▶ Play");
    refs.play.addEventListener("click", () => { if (!t.playing) setPlaying(true); });
    refs.stop = el("button", "sm-play", "■ Stop");
    refs.stop.addEventListener("click", () => setPlaying(false));
    row.append(refs.play, refs.stop);
    refs.bpm = el("input", "sm-bpm");
    refs.bpm.type = "number"; refs.bpm.min = 20; refs.bpm.max = 400; refs.bpm.step = 0.1;
    refs.bpm.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") refs.bpm.blur(); });
    refs.bpm.addEventListener("change", () => setTempo(+refs.bpm.value));
    const lab = el("label", "sm-field");
    lab.append(el("span", "", "Tempo"), refs.bpm, el("span", "sm-unit", "BPM"));
    row.appendChild(lab);
    s.appendChild(row);

    const sy = el("label", "sm-check");
    refs.sync = el("input");
    refs.sync.type = "checkbox";
    refs.syncText = el("span");
    sy.append(refs.sync, refs.syncText);
    refs.sync.addEventListener("change", () => setSync(refs.sync.checked));
    s.appendChild(sy);
    refs.syncNote = el("div", "sm-note");
    s.appendChild(refs.syncNote);
  }

  function setPlaying(on) {
    if (mode === "plugin") return;
    if (mode === "web") {
      const c = follow && BleepWeb.bridgeUI && BleepWeb.bridgeUI.client;
      if (c) c.requestPlay(on); else BleepWeb.setPlaying(on);
    } else native("settings", "play", { on }).then(poll);
    t.playing = on;
    drawTransport();
  }
  function setTempo(bpm) {
    if (mode === "plugin" || !(bpm >= 20 && bpm <= 400)) { drawTransport(); return; }
    if (mode === "web") {
      const c = follow && BleepWeb.bridgeUI && BleepWeb.bridgeUI.client;
      if (c) c.requestTempo(bpm); else BleepWeb.setTempo(bpm);
    } else native("settings", "tempo", { bpm }).then(poll);
    t.bpm = bpm;
    drawTransport();
  }
  function setSync(on) {
    if (mode === "app") native("settings", "link", { on }).then(poll);
    else if (mode === "web") { follow = on; tick(); }
  }

  /// Reads the transport and redraws. The plugin gets it with the engine's state events (below); the app asks for it.
  async function poll() {
    if (mode === "app") {
      const st = await native("settings", "get", null);
      const l = st && st.link;
      if (l) t = Object.assign(t, { bpm: num(l.tempo, t.bpm), playing: !!l.playing, link: !!l.enabled, linkAvailable: !!l.available, peers: l.peers | 0 });
    }
    drawTransport();
  }
  /// The browser: follows the app while asked to, otherwise it owns its transport.
  function tick() {
    if (mode !== "web") return;
    const c = BleepWeb.bridgeUI && BleepWeb.bridgeUI.client;
    if (follow && c && BleepWeb.bridgeUI.connected) {
      const s = c.syncState();
      if (s.tempo > 0 && Math.abs(s.tempo - BleepWeb.transport.bpm) > 0.01) BleepWeb.setTempo(s.tempo);
      if (s.playing !== BleepWeb.transport.playing) BleepWeb.setPlaying(s.playing);
    }
    t.bpm = BleepWeb.transport.bpm;
    t.playing = BleepWeb.transport.playing;
    drawTransport();
  }

  function drawTransport() {
    if (!refs.play) return;
    const locked = mode === "plugin";
    refs.play.classList.toggle("on", t.playing);
    refs.play.disabled = locked;
    refs.stop.disabled = locked;
    refs.bpm.disabled = locked;
    if (document.activeElement !== refs.bpm) refs.bpm.value = (+t.bpm).toFixed(1);
    if (mode === "plugin") {
      refs.sync.parentNode.hidden = true;
      refs.syncNote.textContent = "Live drives the transport. Start, stop and tempo follow the set.";
    } else if (mode === "app") {
      refs.sync.parentNode.hidden = false;
      refs.syncText.textContent = "Sync with Ableton Link";
      refs.sync.disabled = !t.linkAvailable;
      refs.sync.checked = t.link;
      refs.syncNote.textContent = !t.linkAvailable ? "This build has no Ableton Link."
        : t.link ? (t.peers ? `Shared with ${t.peers} Link ${t.peers === 1 ? "peer" : "peers"}.` : "Link is on; no peers yet.") : "The app's own clock.";
    } else {
      const on = !!(BleepWeb.bridgeUI && BleepWeb.bridgeUI.connected);
      refs.sync.parentNode.hidden = false;
      refs.syncText.textContent = "Sync with the Bleep App";
      refs.sync.disabled = !on;
      refs.sync.checked = follow && on;
      refs.syncNote.textContent = !on ? "Connect to the app to follow its tempo and start/stop."
        : follow ? "Following the app. Changes here are requests; the app decides." : "This page runs its own clock.";
    }
  }

  // ---------------------------------------------------------------- Preset
  const SOURCES = { factory: "Factory preset", library: "Bleep Library", user: "User preset" };

  function libraryLink(c) {
    const acct = window.BleepAccount;
    const base = (acct && acct.last && acct.last.libraryUrl) || "";
    return c.address && base ? base + "/library/detail/?kind=preset&slug=" + encodeURIComponent(c.address) : "";
  }

  function buildPreset() {
    const s = section("Preset");
    refs.pName = el("div", "sm-pname");
    refs.pSource = el("div", "sm-psource");
    refs.pLink = el("a", "sm-link", "Open in the Bleep Library");
    refs.pLink.href = "#";
    refs.pLink.addEventListener("click", (e) => { e.preventDefault(); if (refs.pLink.dataset.url) native("openUrl", refs.pLink.dataset.url).then((ok) => { if (!ok) window.open(refs.pLink.dataset.url, "_blank", "noopener"); }); });
    refs.upload = el("button", "sm-wide", "Upload to Library");
    refs.upload.addEventListener("click", upload);
    refs.pNote = el("div", "sm-note");
    s.append(refs.pName, refs.pSource, refs.pLink, refs.upload, refs.pNote);
    drawPreset();
  }

  async function drawPreset() {
    if (!refs.pName) return;
    const c = window.BleepPresetBrowser && BleepPresetBrowser.current();
    refs.pName.textContent = c ? c.name : "No preset loaded";
    refs.pName.classList.toggle("none", !c);
    refs.pSource.textContent = c ? SOURCES[c.source] || c.source : "A board you built yourself";
    let url = "";
    if (c && c.source === "library" && c.address) {
      if (window.BleepAccount && BleepAccount.status) { try { await BleepAccount.status(false); } catch (e) { /* offline */ } }
      url = libraryLink(c);
    }
    refs.pLink.hidden = !url;
    refs.pLink.dataset.url = url;
    const can = !!(window.BleepAccount && BleepAccount.enabled);
    refs.upload.hidden = !can;
  }

  async function upload() {
    const b = host && host.board();
    if (!b || !window.BleepAccount) return;
    const c = BleepPresetBrowser.current();
    const base = c && c.preset ? c.preset : {};
    const preset = { format: 1, description: base.description || "", tags: base.tags || [],
      nodes: JSON.parse(JSON.stringify(b.nodes)), cables: JSON.parse(JSON.stringify(b.cables)) };
    if (base.tempo) preset.tempo = base.tempo;
    const needs = window.BleepLibraryView ? await BleepLibraryView.needsFor(preset.nodes) : {};
    if (Object.keys(needs).length) preset.needs = needs;
    const done = await BleepAccount.share("boards", (c && c.name) || "My patch", preset);
    refs.pNote.textContent = done ? `Shared as ${done.address}.` : "";
  }

  // ---------------------------------------------------------------- the menu itself
  function setOpen(on) {
    root.classList.toggle("open", on);
    toggle.setAttribute("aria-expanded", on ? "true" : "false");
    root.setAttribute("aria-hidden", on ? "false" : "true");
    root.inert = !on;
    clearInterval(timer);
    if (on) { poll(); tick(); drawPreset(); timer = setInterval(() => { poll(); tick(); }, 1000); }
  }

  window.BleepSideMenu = {
    init(opts) {
      host = opts;
      mode = opts.mode;
      toggle = document.getElementById("side-toggle");
      toggle.hidden = false;
      toggle.addEventListener("click", () => setOpen(!root.classList.contains("open")));
      root = el("aside");
      root.id = "side-menu";
      root.setAttribute("aria-label", "Menu");
      root.inert = true;
      body = el("div", "sm-body");
      root.appendChild(body);
      document.getElementById("main").appendChild(root);
      buildConnect();
      buildTransport();
      buildPreset();
      drawTransport();
      if (window.BleepPresetBrowser) BleepPresetBrowser.onChange(drawPreset);
      if (mode === "plugin") onNative("state", (s) => {   // Live's transport comes with the engine's state events
        if (s && s.transport) { t.bpm = num(s.transport.bpm, t.bpm); t.playing = !!s.transport.playing; if (root.classList.contains("open")) drawTransport(); }
      });
      root.addEventListener("keydown", (e) => { if (e.key === "Escape") { setOpen(false); toggle.focus(); } e.stopPropagation(); });
    },
    toggle: () => setOpen(!root.classList.contains("open")),
  };
})();
