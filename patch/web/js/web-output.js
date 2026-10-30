// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// web-output.js — the view of the Audio Out node in Bleep Play: which device of this computer the board plays to. It is the same
// choice as Settings → Audio → Output (web-settings.js, asked through BleepWeb.settings): the browser has one output, so every
// Audio Out node shows and changes it. Loaded after bleep-view.js (scripts/build/build-web.sh puts it there).
(function () {
  "use strict";
  if (!window.BleepViews || !window.BleepWeb || !window.BleepWeb.settings) return;
  const settings = (fn, arg) => window.BleepWeb.settings(fn, arg);

  const CSS =
    ".wo{display:grid;grid-template-columns:max-content 1fr;gap:6px 10px;align-items:center;flex:1 1 100%;font-size:12px}" +
    ".wo label{color:var(--muted);white-space:nowrap}" +
    ".wo select{font:inherit;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:3px 7px}" +
    ".wo .wo-note{grid-column:1/-1;color:var(--muted);line-height:1.35}" +
    ".wo .wo-note.bad{color:#f87171}";

  function draw(view, st, problem) {
    const box = view.wo;
    if (!box || !st || !st.webAudio) return;
    const a = st.webAudio;
    const sel = box.querySelector("select");
    const note = box.querySelector(".wo-note");
    sel.disabled = !a.canSelectOutput;
    if (document.activeElement !== sel) {   // a redraw while the menu is open would cancel the choice
      sel.textContent = "";
      for (const o of [{ id: "", name: "System default" }, ...a.outputs]) {
        const opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = o.name;
        sel.appendChild(opt);
      }
      sel.value = a.output;
    }
    note.classList.toggle("bad", !!problem);
    note.textContent = problem
      || (!a.canSelectOutput ? "This browser plays to the system's default output. Chrome and Edge can pick another one."
        : !a.outputs.length ? "The devices show here once the browser lets Bleep Play use them: allow it when Start audio asks, or in the site settings."
        : "");
    note.hidden = !note.textContent;
  }

  async function load(view, fn, arg) {
    let st = null;
    try { st = await settings(fn || "get", arg); } catch (e) { st = null; }
    if (st) draw(view, st, st.error || "");
  }

  BleepViews.register("audio-out", {
    width: 320,
    template: `<style>${CSS}</style><div class="wo"><label>Device</label><select></select><div class="wo-note" hidden></div></div>`,
    afterBuild(view, el0) {
      view.wo = el0.querySelector(".wo");
      const sel = view.wo.querySelector("select");
      sel.id = "wo-" + view.node.id;
      view.wo.querySelector("label").htmlFor = sel.id;
      sel.addEventListener("change", () => { const v = sel.value; sel.blur(); load(view, "webAudio", { output: v }); });
      sel.addEventListener("keydown", (e) => e.stopPropagation());   // the arrow keys pick a device, not play the board
      // A device plugged in or out, or the names given once audio started (not on the click: the open menu would be redrawn).
      sel.addEventListener("pointerenter", () => load(view));
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        const changed = () => { if (!view.wo.isConnected) navigator.mediaDevices.removeEventListener("devicechange", changed); else load(view); };
        navigator.mediaDevices.addEventListener("devicechange", changed);
      }
      load(view);
    },
    onRefresh(view) { load(view); },
  });
})();
