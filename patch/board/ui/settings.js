// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// settings.js — the Settings section of the board window, in the standalone app, the plugins and Bleep Play (doc/specs/settings.md).
// The host names itself in the first answer of native "settings" "get" (state.host: "app", "plugin" or "web"; no host = "app") and
// that decides the tabs:
//   app     Audio, MIDI and sync, Web, Library, Security
//   plugin  Library, Security (Live owns the audio device and MIDI)
//   web     Audio, MIDI, App, Library, Security, Data (answered by the browser: patch/web/js/web-settings.js)
// Settings are applied as they are changed; there is no Save button.
//
//   P.BleepSettingsView.init({ library })   once, when the native side offers settings (native "init" says so)
//   show() / hide()                     the header's Settings button; File → Settings opens it too
(function () {
  "use strict";
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, onNative, priv: P } = window.BleepSeal;
  let state = null;           // native "settings", "get"
  let library = null;           // native "libraryStatus", when the app has a library
  let tab = "audio";
  let message = "";
  let host = "";              // "app" | "plugin" | "web", known after the first "get"
  let root, body, tabsEl, noteEl, poll = null, hasLibrary = false;
  const TABS = {
    app: [["audio", "Audio"], ["midi", "MIDI and sync"], ["web", "Web"], ["library", "Library"], ["security", "Security"]],
    plugin: [["library", "Library"], ["security", "Security"]],
    web: [["audio", "Audio"], ["midi", "MIDI"], ["app", "App"], ["library", "Library"], ["security", "Security"], ["data", "Data"]],
  };
  const tabsOf = () => (TABS[host] || []).filter(([id]) => hasLibrary || host === "web" || (id !== "library" && id !== "security"));
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /// `force`: the user did something, draw it. Without it (the refresh timer) a focused control is left alone: redrawing a
  /// dropdown while its menu is open cancels the choice.
  async function load(force) {
    state = await native("settings", "get", null);
    if (state && (state.host || "app") !== host) { host = state.host || "app"; buildTabs(); }
    if (hasLibrary) library = await native("libraryStatus");
    render(force);
  }

  /// Applies one change; the native side answers with the new state (and `error` when the audio device refused).
  async function change(fn, arg) {
    const next = await native("settings", fn, arg);
    if (next) { state = next; message = next.error || ""; }
    render(true);
  }

  async function libraryChange(patch) {
    await native("librarySettings", patch);
    library = await native("libraryStatus");
    render(true);
  }

  function row(label, control, hint) {
    const r = el("label", "se-row");
    r.appendChild(el("span", "se-label", label));
    r.appendChild(control);
    if (hint) r.appendChild(el("span", "se-hint", hint));
    body.appendChild(r);
    return r;
  }

  function select(options, value, onChange, format) {
    const s = el("select");
    for (const o of options) {
      const opt = el("option", "", format ? format(o) : o);
      opt.value = o;
      s.appendChild(opt);
    }
    s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }

  function checkbox(label, on, onChange) {
    const r = el("label", "se-check");
    const b = el("input");
    b.type = "checkbox";
    b.checked = !!on;
    b.addEventListener("change", () => onChange(b.checked));
    r.appendChild(b);
    r.appendChild(el("span", "", label));
    return r;
  }

  function channels(list, key) {
    const wrap = el("div", "se-channels");
    list.forEach((c, i) => wrap.appendChild(checkbox(c.name, c.on, (on) => {
      const flags = list.map((x, j) => (j === i ? on : x.on));
      change("audio", { [key]: flags });
    })));
    return wrap;
  }

  function renderAudio() {
    const a = state.audio;
    if (a.types.length > 1) row("Driver", select(a.types, a.type, (v) => change("audio", { type: v })));
    row("Output", select(["", ...(a.outputs || [])], a.output, (v) => change("audio", { output: v }), (v) => v || "None"));
    row("Input", select(["", ...(a.inputs || [])], a.input, (v) => change("audio", { input: v }), (v) => v || "None"));
    if (!a.running) {
      body.appendChild(el("div", "st-note bad", "No audio device is running. Pick an output above."));
      renderSystem();
      return;
    }
    row("Sample rate", select(a.rates, a.rate, (v) => change("audio", { rate: +v }), (v) => (+v / 1000) + " kHz"));
    row("Buffer size", select(a.buffers, a.buffer, (v) => change("audio", { buffer: +v }), (v) => v + " samples (" + (1000 * v / a.rate).toFixed(1) + " ms)"));
    if (a.outputChannels.length > 2) { body.appendChild(el("h3", "", "Output channels")); body.appendChild(channels(a.outputChannels, "outputChannels")); }
    if (a.inputChannels.length > 2) { body.appendChild(el("h3", "", "Input channels")); body.appendChild(channels(a.inputChannels, "inputChannels")); }
    body.appendChild(el("h3", "", "Right now"));
    body.appendChild(el("div", "st-row single", `Latency ${a.latencyMs.toFixed(1)} ms · CPU ${(a.cpu * 100).toFixed(0)}% · dropouts ${a.xruns < 0 ? "not reported" : a.xruns}`));
    renderSystem();
  }

  /// What the computer plays, as a System node on the board (doc/specs/system-audio.md). Shown with the audio device,
  /// also when no device runs: the capture does not need one.
  function renderSystem() {
    const s = state.system;
    if (!s) return;
    body.appendChild(el("h3", "", "System audio"));
    if (!s.supported) { body.appendChild(el("div", "st-note", s.reason)); return; }
    body.appendChild(checkbox("Capture what this computer plays", s.enabled, (on) => change("systemAudio", { on })));
    if (!s.enabled) {
      body.appendChild(el("div", "st-note", "Adds a System port with the sound of your music player, browser or video call: put its node on the board from Add → Port. Nothing is captured until you turn this on."));
      return;
    }
    const exclude = checkbox("Leave out Bleep App's own sound", s.exclude && s.canExclude, (on) => change("systemAudio", { exclude: on }));
    exclude.querySelector("input").disabled = !s.canExclude;
    body.appendChild(exclude);
    if (!s.canExclude) body.appendChild(el("div", "st-note", "This system cannot leave Bleep App out of the capture. Patching System to an output that you capture gives feedback: play Bleep App to another output."));
    if ((s.sources || []).length) {
      row("Output to capture", select(["", ...s.sources.map((d) => d.id)], s.source, (v) => change("systemAudio", { source: v }),
                                      (v) => (s.sources.find((d) => d.id === v) || { name: "Default output" }).name));
    }
    if (s.error) body.appendChild(el("div", "st-note bad", s.error));
    else if (s.running) {
      body.appendChild(el("div", "st-row single", `Capturing at ${(s.rate / 1000).toFixed(1)} kHz · ${s.excluding ? "Bleep App's own sound left out" : "Bleep App's own sound included"} · ${s.signal ? "signal" : "silent"}`));
      if (s.problem) body.appendChild(el("div", "st-note bad", s.problem));
      else if (!s.signal && s.hint) body.appendChild(el("div", "st-note", s.hint));
    }
  }

  function renderMidi() {
    const m = state.midi, l = state.link;
    body.appendChild(el("h3", "", "Inputs"));
    if (!m.inputs.length) body.appendChild(el("div", "st-empty", "No MIDI inputs found."));
    for (const d of m.inputs) body.appendChild(checkbox(d.name, d.on, (on) => change("midiInput", { id: d.id, on })));
    row("Output", select(["", ...m.outputs.map((d) => d.id)], m.output, (v) => change("midiOutput", { id: v }),
                         (v) => (m.outputs.find((d) => d.id === v) || { name: "None" }).name));
    const n = el("input");
    n.type = "number"; n.min = 0; n.max = 8; n.value = m.virtualPorts;
    n.addEventListener("change", () => change("virtualPorts", { n: Math.max(0, Math.min(8, +n.value || 0)) }));
    row("Bleep App MIDI ports", n, "Virtual ports other programs can connect to.");
    body.appendChild(el("h3", "", "Sync"));
    if (!l.available) body.appendChild(el("div", "st-note", "This build has no Ableton Link."));
    else {
      body.appendChild(checkbox("Ableton Link", l.enabled, (on) => change("link", { on })));
      body.appendChild(el("div", "st-row single", l.enabled ? `${l.peers} other ${l.peers === 1 ? "app" : "apps"} on the network` : "Off"));
    }
    const t = el("input");
    t.type = "number"; t.min = 20; t.max = 400; t.step = 0.1; t.value = l.tempo.toFixed(1);
    t.addEventListener("change", () => change("tempo", { bpm: +t.value }));
    row("Tempo", t, l.enabled && l.peers ? "Shared with the Link peers." : "Used when no one else sets it.");
  }

  /// The web link (doc/specs/bridges.md §4): Bleep Play pages and Live ports with Board = Bleep Play talk to this app.
  function renderWeb() {
    const w = state.web;
    if (!w) { body.appendChild(el("div", "st-empty", "This build has no web connection.")); return; }
    body.appendChild(checkbox("Let Bleep Play pages connect to this app", w.enabled, (on) => change("web", { on })));
    if (!w.enabled) {
      body.appendChild(el("div", "st-note", "Off by default. When on, the app listens on this computer only (127.0.0.1): Bleep Play can send and receive audio and MIDI through it, and Bleep plugins in Live with Board = Bleep Play are relayed to it."));
    }
    const port = el("input");
    port.type = "number"; port.min = 1024; port.max = 65535; port.value = w.port;
    port.addEventListener("change", () => change("web", { port: Math.max(1024, Math.min(65535, +port.value || 47100)) }));
    row("Port", port, "Takes effect at once.");
    if (w.error) body.appendChild(el("div", "st-note bad", w.error));
    if (w.running) {
      body.appendChild(el("div", "st-row single", "Listening. Open " + w.page + " for the board served by this app (lowest latency), or press Connect to app on the website."));
      const peers = (w.link && w.link.peers) || [];
      body.appendChild(el("h3", "", "Connected boards"));
      if (!peers.length) body.appendChild(el("div", "st-empty", "None."));
      for (const p of peers) body.appendChild(el("div", "st-row single", `${p.name} · ${p.mode === "low" ? "low latency" : "safe"} · ${p.channels} channel${p.channels === 1 ? "" : "s"}`));
      if (w.link && (w.link.lateEvents || w.link.staleEvents))
        body.appendChild(el("div", "st-note", `MIDI from the web: ${w.link.lateEvents} late, ${w.link.staleEvents} dropped after a tempo change or jump.`));
    }
    body.appendChild(el("h3", "", "Pages you allowed"));
    if (!w.origins.length) body.appendChild(el("div", "st-empty", "None. A page that is not served by this app asks first."));
    for (const o of w.origins) {
      const r = el("div", "st-row");
      r.appendChild(el("span", "", o));
      const b = el("button", "", "Forget");
      b.addEventListener("click", () => change("webForget", { origin: o }));
      r.appendChild(b);
      body.appendChild(r);
    }
  }

  function renderLibrary() {
    if (!hasLibrary || !library) { body.appendChild(el("div", "st-empty", "This build has no Bleep Library.")); return; }
    const s = library.settings;
    row("Channel", select(["stable", "beta"], s.channel, (v) => libraryChange({ channel: v })), "Beta has newer modules that are less tested.");
    body.appendChild(el("div", "st-note", s.libraryUrl + (library.index.ok ? "" : " (not reached)")));
    body.appendChild(checkbox("Check for module updates at start", s.updateCheck !== false, (on) => libraryChange({ updateCheck: on })));
    if (host === "plugin") body.appendChild(el("div", "st-note", "These settings and the modules are shared with Bleep App and the other plugins: one data folder."));
    const url = el("input");
    url.type = "text"; url.value = s.libraryUrl; url.spellcheck = false;
    const advanced = el("details", "se-advanced");
    advanced.appendChild(el("summary", "", "Advanced"));
    body.appendChild(advanced);
    const urlRow = el("label", "se-row");
    urlRow.appendChild(el("span", "se-label", "Library address"));
    urlRow.appendChild(url);
    urlRow.appendChild(el("span", "se-hint", "For a self-hosted or development library. Takes effect at the next start."));
    advanced.appendChild(urlRow);
    url.addEventListener("change", () => libraryChange({ libraryUrl: url.value.trim() }));
    const bar = el("div", "st-bar");
    const check = el("button", "", "Check for updates");
    check.addEventListener("click", async () => { check.disabled = true; await native("libraryRefresh"); setTimeout(() => load(true), 600); });
    bar.appendChild(check);
    const reveal = el("button", "", "Show data folder");
    reveal.addEventListener("click", () => native("libraryRevealData"));
    bar.appendChild(reveal);
    body.appendChild(bar);
    body.appendChild(el("div", "st-row single", "Data folder: " + library.dataDir));
    body.appendChild(el("div", "st-row single", library.index.ok ? `${library.index.modules.length} modules in the library · ${library.installed.length} installed` : "The library has not been reached yet" + (library.index.error ? ": " + library.index.error : "")));
  }

  function renderSecurity() {
    if (!hasLibrary || !library) { body.appendChild(el("div", "st-empty", "This build has no Bleep Library.")); return; }
    const s = library.settings;
    body.appendChild(el("div", "st-note", "Plugins and official modules from the Bleep Library are signed by their developer. Modules shared by the community are checked and signed by the library, and run in the sandbox like the rest. Only what has no signature (your own builds, files you copied in) stays off unless you allow it here. A broken or revoked signature is never loaded."));
    const toggle = (key, title, warning) => {
      const r = checkbox(title, s.allowUnsigned[key], (on) => {
        if (on && !window.confirm(warning)) { load(true); return; }
        libraryChange({ allowUnsigned: Object.assign({}, s.allowUnsigned, { [key]: on }) });
      });
      r.classList.add("st-toggle");
      body.appendChild(r);
    };
    toggle("module", "Allow unsigned modules",
      "Unsigned modules run in a sandbox: they cannot read your files or use the network, but they can use a lot of CPU and make noise.\n\nOnly enable this for modules you trust or have built yourself. Turn it on?");
    toggle("plugin", "Allow unsigned plugins",
      "Unsigned plugins are programs that run with all your rights inside your DAW.\n\nOnly enable this for software you trust. Turn it on?");
    body.appendChild(el("h3", "", "Developers you have installed from"));
    const seen = new Map();
    for (const m of library.installed) if (m.status === "signed") seen.set(m.publisher, (seen.get(m.publisher) || 0) + 1);
    if (!seen.size) body.appendChild(el("div", "st-empty", "None yet."));
    for (const [publisher, n] of seen) body.appendChild(el("div", "st-row single", `${publisher}: ${n} module${n === 1 ? "" : "s"}`));
  }

  // ---- Bleep Play: what the browser can do (patch/web/js/web-settings.js) ----------------------------------------------------

  const LATENCY_TEXT = { interactive: "Interactive (lowest delay)", balanced: "Balanced", playback: "Playback (fewest dropouts)" };

  function renderWebAudio() {
    const a = state.webAudio;
    if (a.canSelectOutput) {
      row("Output", select(["", ...a.outputs.map((o) => o.id)], a.output, (v) => change("webAudio", { output: v }),
                           (v) => (v ? a.outputs.find((o) => o.id === v).name : "Default")));
    } else {
      body.appendChild(el("div", "st-note", "This browser plays to the system's default output. Chrome and Edge can pick another one."));
    }
    row("Latency", select(a.latencies, a.latency, (v) => change("webAudio", { latency: v }), (v) => LATENCY_TEXT[v] || v),
        "Applies when audio starts.");
    if (a.reload) {
      body.appendChild(el("div", "st-note", "Audio is running with another latency. Restarting reloads this page: your board is kept, and you press Start audio again."));
      const bar = el("div", "st-bar");
      const b = el("button", "", "Restart audio");
      b.addEventListener("click", () => change("webAudio", { reload: true }));
      bar.appendChild(b);
      body.appendChild(bar);
    }
    body.appendChild(el("h3", "", "Right now"));
    body.appendChild(el("div", "st-row single", a.running
      ? `${(a.rate / 1000).toFixed(1)} kHz · base latency ${a.baseLatencyMs.toFixed(1)} ms · output latency ${a.outputLatencyMs.toFixed(1)} ms`
      : "Audio has not started."));
  }

  function renderWebMidi() {
    const m = state.webMidi;
    if (!m.supported) { body.appendChild(el("div", "st-note", "This browser has no Web MIDI (Safari does not have it).")); return; }
    if (!m.asked) {
      body.appendChild(el("div", "st-note", "The browser asks once whether this page may use your MIDI devices."));
      const bar = el("div", "st-bar");
      const b = el("button", "", "Allow MIDI access");
      b.addEventListener("click", () => change("webMidi", { allow: true }));
      bar.appendChild(b);
      body.appendChild(bar);
      return;
    }
    body.appendChild(el("h3", "", "Inputs"));
    if (!m.inputs.length) body.appendChild(el("div", "st-empty", "No MIDI inputs found."));
    for (const d of m.inputs) body.appendChild(checkbox(d.name, d.on, (on) => change("webMidi", { name: d.name, on })));
    body.appendChild(el("div", "st-note", "A MIDI Device node on the board picks its own controller. These switches apply to boards without one."));
  }

  function renderWebApp() {
    const a = state.webApp;
    if (!a.available) { body.appendChild(el("div", "st-empty", "The link to Bleep App is not loaded on this page.")); return; }
    body.appendChild(el("div", a.bad ? "st-note bad" : "st-row single", a.connected ? "Connected to Bleep App. " + a.text : (a.busy ? "Connecting… " : "Not connected. ") + a.text));
    const bar = el("div", "st-bar");
    const b = el("button", "", "Connect to app");
    b.disabled = a.busy || a.connected;
    b.addEventListener("click", () => change("webApp", { connect: true }));
    bar.appendChild(b);
    body.appendChild(bar);
    body.appendChild(el("div", "st-note", "Bleep App must be running with File → Settings → Web switched on; the port is set there. Live plugins whose Board is Bleep Play reach this page through the app."));
  }

  function renderWebLibrary() {
    const l = state.webLib;
    row("Channel", select(l.channels, l.channel, (v) => change("webLibrary", { channel: v })), "Beta has newer modules that are less tested.");
    webReload(l);
  }

  function renderWebSecurity() {
    const l = state.webLib;
    body.appendChild(el("div", "st-note", "Official modules from the Bleep Library are signed by their developer. Modules shared by the community are checked and signed by the library, and run in the sandbox like the rest. Only what has no signature (your own builds) stays off unless you allow it here. A broken or revoked signature is never loaded."));
    const r = checkbox("Allow unsigned modules", l.allowUnsigned.module, (on) => {
      if (on && !window.confirm("Unsigned modules run in the browser's sandbox: they cannot read your files or use the network, but they can use a lot of CPU and make noise.\n\nOnly enable this for modules you trust or have built yourself. Turn it on?")) { load(true); return; }
      change("webLibrary", { allowUnsigned: { module: on } });
    });
    r.classList.add("st-toggle");
    body.appendChild(r);
    body.appendChild(el("div", "st-note", "Bleep Play has no plugins, so there is no switch for unsigned plugins."));
    webReload(l);
  }

  function webReload(l) {
    if (!l.reload) return;
    body.appendChild(el("div", "st-note", "The library is read when the page loads: reload to use this."));
    const bar = el("div", "st-bar");
    const b = el("button", "", "Reload now");
    b.addEventListener("click", () => change("webLibrary", { reload: true }));
    bar.appendChild(b);
    body.appendChild(bar);
  }

  function renderWebData() {
    body.appendChild(el("div", "st-note", "What Bleep Play keeps in this browser: your board, your saved presets and these settings. Nothing is sent anywhere."));
    const labels = { board: ["Board", "Delete the board in this browser? The page reloads with the default board."],
                     presets: ["Saved presets", "Delete the presets saved in this browser?"],
                     settings: ["Settings", "Put the settings of this page back to their defaults?"],
                     all: ["Everything", "Delete the board, the presets and the settings kept in this browser? The page reloads."] };
    for (const kind of state.webData.kinds) {
      const r = el("div", "st-row");
      r.appendChild(el("span", "", labels[kind][0]));
      const b = el("button", "", "Clear");
      b.addEventListener("click", () => { if (window.confirm(labels[kind][1])) change("webClear", { what: kind }); });
      r.appendChild(b);
      body.appendChild(r);
    }
  }

  function render(force) {
    if (!root || !state) return;
    if (!force && root.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    body.innerHTML = "";
    for (const b of tabsEl.children) b.classList.toggle("on", b.dataset.tab === tab);
    noteEl.textContent = message;
    if (!tabsOf().some(([id]) => id === tab)) tab = (tabsOf()[0] || ["audio"])[0];   // the audio button in a plugin: no such tab
    for (const b of tabsEl.children) b.classList.toggle("on", b.dataset.tab === tab);
    if (state.stored === false) body.appendChild(el("div", "st-note", "This browser does not let the page store anything: settings last until the page is closed."));
    const shown = host === "web"
      ? { audio: renderWebAudio, midi: renderWebMidi, app: renderWebApp, library: renderWebLibrary, security: renderWebSecurity, data: renderWebData }
      : { audio: renderAudio, midi: renderMidi, web: renderWeb, library: renderLibrary, security: renderSecurity };
    (shown[tab] || (() => {}))();
  }

  /// The tab buttons of this host (known after the first "get").
  function buildTabs() {
    tabsEl.innerHTML = "";
    for (const [id, label] of tabsOf()) {
      const b = el("button", "", label);
      b.dataset.tab = id;
      b.addEventListener("click", () => { tab = id; message = ""; render(true); });
      tabsEl.appendChild(b);
    }
  }

  function build() {
    root = el("section");
    root.id = "settings";
    root.hidden = true;
    const head = el("div", "st-head-line");
    head.appendChild(el("h2", "", "Settings"));
    root.appendChild(head);
    tabsEl = el("div", "st-tabs");
    root.appendChild(tabsEl);
    noteEl = el("div", "st-message");
    root.appendChild(noteEl);
    body = el("div", "st-body");
    root.appendChild(body);
    document.body.appendChild(root);
  }

  P.BleepSettingsView = {
    async init(options) {
      hasLibrary = !!(options && options.library);
      build();
      P.BleepModal.mount(root, () => P.BleepSettingsView.hide());
      onNative("openSettings", () => P.BleepSettingsView.show());
    },
    /// `which`: the tab to show ("audio", "midi", "web", "library", "security", "app", "data"); without it the last one. A tab this host
    /// does not have (the audio button in a plugin) shows the first one.
    async show(which) {
      if (P.BleepLibraryView) P.BleepLibraryView.hide();
      if (P.BleepHelpView) P.BleepHelpView.hide();
      if (typeof which === "string") { tab = which; message = ""; }
      P.BleepModal.toggle(root, true);
      await load(true);
      // The readouts (CPU, dropouts, Link peers) move: refresh while the section is open and nothing is being edited.
      if (!poll) poll = setInterval(() => { if (!root.hidden) load(false); }, 1500);
    },
    hide() {
      if (root.hidden) return;
      P.BleepModal.toggle(root, false);
      if (poll) { clearInterval(poll); poll = null; }
    },
  };
})();
