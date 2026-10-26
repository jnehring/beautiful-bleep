// SPDX-License-Identifier: MIT
// /embed/?patch=<pid>&v=<version>: see index.html.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const pid = q.get("patch") || "";
  const v = parseInt(q.get("v"), 10) || 0;
  const message = (text, bad) => { $("message").hidden = false; $("message").textContent = text; $("message").className = bad ? "bad" : ""; };
  const GONE = "This patch is no longer available.";

  async function start() {
    if (!/^[a-z0-9]{10}$/.test(pid)) return message(GONE, true);
    let meta;
    try {
      const r = await fetch("/api/patches/" + pid);   // no credentials from a frame on another site: a private patch is "gone" here
      if (!r.ok) return message(GONE, true);
      meta = await r.json();
    } catch (e) { return message("The Bleep Library could not be reached.", true); }
    const version = v || meta.version;
    if (!meta.versions.some((x) => x.version === version)) return message("This version does not exist.", true);
    const play = "/play/index.html?patch=" + pid + "&v=" + version;
    $("kind").textContent = meta.type === "cell" ? "Bleep cell" : "Bleep patch";
    $("title").textContent = meta.title;
    $("by").textContent = "by " + meta.author_name;
    $("open").href = "/play/index.html?patch=" + pid + "&v=" + version;
    $("message").hidden = true;
    $("poster").hidden = false;
    $("play").addEventListener("click", () => {
      $("poster").hidden = true;
      message("Loading Bleep…");
      const f = $("player");
      f.addEventListener("load", () => { $("message").hidden = true; f.hidden = false; $("bar").hidden = false; }, { once: true });
      f.src = play + "&embed=1";
    });
    $("full").addEventListener("click", () => {
      const d = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (d.requestFullscreen) d.requestFullscreen().catch(() => window.open($("open").href, "_blank", "noopener"));
      else window.open($("open").href, "_blank", "noopener");   // iOS has no Fullscreen API for pages: the patch opens on its own
    });
  }
  start();
})();
