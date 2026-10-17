// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// bridge-ui.js — the "Connect to app" control of Bleep Play (doc/specs/bridges.md §4), and the glue between
// the web link and the board: Live ports the hub announces become port nodes (board-demo.js mirrorPort), and
// Remote Audio / Remote MIDI nodes open their channel as soon as they are on the board. A classic script, loaded
// after bleep-web.js; nothing connects until the visitor presses the button. The button itself is in the board's
// side menu (board/ui/side-menu.js), which reads and drives this through BleepWeb.bridgeUI.
(function () {
  "use strict";
  if (window.__JUCE__ || !window.BleepWeb) return;
  const W = window.BleepWeb;
  const seal = window.BleepSeal;  // the page's lock (common/ui/bleep-bridge.js): the demo engine is only reachable through it once the board has sealed
  const url = (p) => new URL(p, document.baseURI).href;
  let client = null, mod = null;
  const ui = W.bridgeUI = { connected: false, busy: false, text: "", bad: false, connect: () => connect(), onChange: null };
  const changed = () => { if (ui.onChange) ui.onChange(ui); };
  const opened = new Map();   // node id → "audio" | "midi": Remote nodes this page has opened

  /// The page the app serves talks to its own host; a page from anywhere else (the website, a Docker container on
  /// localhost:8080) talks to the app's default address. Only the app answers /health with its name.
  async function socketUrl() {
    const here = location;
    if (here.protocol !== "http:") return undefined;
    try {
      const r = await fetch("/health", { cache: "no-store" });
      const j = r.ok ? await r.json() : null;
      if (j && j.app === "bleep-patch") return `ws://${here.host}/ws`;
    } catch (e) { /* not the app */ }
    return undefined;
  }

  function show(text, bad) {
    ui.text = text;
    ui.bad = !!bad;
    changed();
  }

  /// A Remote node on the board opens its channel; one that was deleted closes it.
  function syncRemoteNodes(board) {
    if (!client || !board) return;
    const live = new Set();
    for (const n of board.nodes) {
      if (n.type !== "remote-audio" && n.type !== "remote-midi") continue;
      live.add(n.id);
      if (opened.has(n.id)) continue;
      const kind = n.type === "remote-audio" ? "audio" : "midi";
      client.openChannel({ key: n.id, kind, dir: "both", name: n.name || n.type });
      opened.set(n.id, kind);
    }
    for (const id of [...opened.keys()])
      if (!live.has(id)) { client.closeChannel(id); opened.delete(id); }
  }

  /// Channels of Live ports (and nothing this page opened itself) become port nodes, one per key.
  function mirrorChannels(list) {
    const byKey = new Map();
    for (const c of list) {
      if (c.source !== "live") continue;
      const e = byKey.get(c.key) || { online: false, channels: [] };
      e.online = e.online || c.online !== false;
      e.channels.push(c);
      byKey.set(c.key, e);
    }
    for (const [key, e] of byKey) {
      const c = e.channels[0];
      const type = mod.nodeTypeForChannel(c);
      const demo = seal && seal.demo();
      if (type && demo && demo.mirrorPort)
        demo.mirrorPort({ id: "link:" + key, key, type, name: c.name || "Live", live: e.online });
    }
  }

  async function connect() {
    ui.busy = true;
    show("connecting…");
    try {
      mod = await import(url("js/bridge-client.js"));
      client = await W.connectBridge({ url: await socketUrl(), name: "Web: " + (navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)/) || ["Browser"])[0] });
      client.on("status", ({ state, code }) => {
        if (state === "open") { ui.connected = true; ui.busy = false; show(`${client.mode === "low" ? "Low" : "Safe"} latency${client.modeNote ? " · " + client.modeNote : ""}`); }
        else if (state === "retrying" || state === "connecting" || state === "handshake") show("connecting… If the Bleep app asks whether to allow this page, answer there.");
        else if (state === "denied" || state === "failed" || state === "closed") {
          ui.connected = false;
          ui.busy = false;
          show(mod.explainFailure({ code }), true);
        }
      });
      client.on("channels", mirrorChannels);
      ui.client = client;
      W.onBoardSet = syncRemoteNodes;
      syncRemoteNodes(W.boardDoc);
    } catch (e) {
      ui.busy = false;
      show(e && e.message ? e.message : String(e), true);
    }
  }
})();
