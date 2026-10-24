// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// play-source.js — what an effect plays through in Bleep Play (play-wrap.js, board.js playCell): a looping instrument that comes with the app,
// the microphone, or an audio file of your own. A bar under the board with the choice; it only draws, board.js does the rest.
//
//   BleepPlaySource.show({name, loops, current, choose})
//     name: the effect's name; loops: [names of the looping instruments]; current: "loop:<name>", "mic" or "file";
//     choose({kind: "loop", name} | {kind: "mic"} | {kind: "file", file}): called when the visitor picks one
//   BleepPlaySource.hide()
(function () {
  "use strict";
  let bar = null, label, select, hint, fileInput, onChoose = null, current = "";

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function build() {
    bar = el("div", "ps");
    bar.id = "play-source";
    label = el("span", "ps-name");
    const pick = el("label", "ps-pick", "Plays through ");
    select = el("select");
    select.addEventListener("change", () => {
      const v = select.value;
      if (v === "file") { select.value = current; fileInput.click(); return; }   // the file dialog decides; until then nothing changes
      if (onChoose) onChoose(v === "mic" ? { kind: "mic" } : { kind: "loop", name: v.slice(5) });
    });
    pick.appendChild(select);
    hint = el("span", "ps-hint");
    fileInput = el("input");
    fileInput.type = "file";
    fileInput.accept = "audio/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (f && onChoose) onChoose({ kind: "file", file: f });
    });
    bar.append(label, pick, hint, fileInput);
    document.getElementById("main").appendChild(bar);
  }

  window.BleepPlaySource = {
    show(o) {
      if (!bar) build();
      onChoose = o.choose;
      current = o.current;
      label.textContent = o.name || "";
      select.innerHTML = "";
      for (const n of o.loops || []) { const opt = el("option", "", "Loop: " + n); opt.value = "loop:" + n; select.appendChild(opt); }
      const mic = el("option", "", "Microphone"); mic.value = "mic"; select.appendChild(mic);
      const file = el("option", "", "Audio file…"); file.value = "file"; select.appendChild(file);
      // A file is only a choice once it plays: while it does the bar says so under its own entry.
      if (current === "file") { const f = el("option", "", "Your audio file"); f.value = "file-loaded"; select.insertBefore(f, file); }
      select.value = current === "file" ? "file-loaded" : current;
      hint.textContent = current === "mic" ? "Use headphones: through speakers the effect can feed back." : current === "file" ? "The file loops." : "";
      bar.hidden = false;
    },
    hide() { if (bar) bar.hidden = true; },
    visible: () => !!bar && !bar.hidden,
  };
})();
