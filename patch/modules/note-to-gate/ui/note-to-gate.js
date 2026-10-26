// SPDX-License-Identifier: GPL-3.0-only
// Note to Gate view (doc/note-to-gate.md): the latest notes that came in, newest first, so you can read off
// which note to set on a gate; a chip is lit while a gate listens to that note. Under it a lamp per gate.
//
// The notes arrive as the live array "notes": [count, note, velocity, …], the newest 12; the view keeps the
// count it has seen and flashes the chips that are new.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent =
    ".ng-notes{display:flex;flex-wrap:wrap;gap:6px;min-height:34px}" +
    ".ng-chip{padding:3px 8px;border-radius:6px;border:1px solid var(--bv-line,#444);font:600 12px system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-width:46px}" +
    ".ng-chip small{font:10px system-ui,sans-serif;opacity:.65}" +
    ".ng-chip.new{outline:2px solid var(--bv-accent,#c084fc)}" +
    ".ng-chip.used{background:color-mix(in srgb,var(--bv-accent,#c084fc) 30%,transparent)}" +
    ".ng-empty{opacity:.6;font:12px system-ui,sans-serif}" +
    ".ng-gates{display:flex;flex-wrap:wrap;gap:6px}" +
    ".ng-gate{width:46px;padding:4px 0;text-align:center;border-radius:6px;border:1px solid var(--bv-line,#444);font:11px system-ui,sans-serif}" +
    ".ng-gate b{display:block;font-size:12px}" +
    ".ng-gate.on{background:var(--bv-accent,#c084fc);color:#000}";
  document.head.appendChild(style);
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const noteName = (n) => NAMES[n % 12] + (Math.floor(n / 12) - 1);  // 60 is C4, as on the keyboard

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  /// The notes the gates listen to, in gate order.
  function gateNotes(view) {
    const n = setting(view, "gates");
    return Array.from({ length: n }, (_, k) => setting(view, "note" + (k + 1)));
  }

  function renderGates(view) {
    const notes = gateNotes(view), box = view._gates;
    const key = notes.join(",");
    if (view._gateKey === key) return;
    view._gateKey = key;
    box.textContent = "";
    view._lamps = notes.map((n, k) => {
      const d = document.createElement("div");
      d.className = "ng-gate";
      d.innerHTML = "<b></b><span></span>";
      d.firstChild.textContent = "Gate " + (k + 1);
      d.lastChild.textContent = noteName(n) + " · " + n;
      box.appendChild(d);
      return d;
    });
  }

  function takeNotes(view, arr) {
    const total = arr[0], fresh = view._seen === null ? 0 : (total - view._seen + 0x1000000) % 0x1000000;
    view._seen = total;
    const used = new Set(gateNotes(view)), box = view._list;
    box.textContent = "";
    const n = (arr.length - 1) >> 1;
    if (!n) {
      const e = document.createElement("span");
      e.className = "ng-empty";
      e.textContent = "Play a note: it shows up here.";
      box.appendChild(e);
      return;
    }
    for (let i = 0; i < n; i++) {
      const note = arr[1 + i * 2], vel = arr[2 + i * 2];
      const c = document.createElement("div");
      c.className = "ng-chip" + (i < fresh ? " new" : "") + (used.has(note) ? " used" : "");
      c.innerHTML = "<span></span><small></small>";
      c.firstChild.textContent = noteName(note) + " · " + note;
      c.lastChild.textContent = "vel " + vel;
      box.appendChild(c);
    }
  }

  BleepViews.register("note-to-gate", {
    width: 460,
    template:
      '<div class="bv-panel"><h2>Notes heard</h2><div class="ng-notes"></div></div>' +
      '<div class="bv-panel"><h2>Gates</h2><div class="ng-gates"></div></div>',
    layout: [
      { title: "Gates", params: ["gates"] },
      { title: "Notes", params: Array.from({ length: 16 }, (_, k) => "note" + (k + 1)), columns: true },
    ],
    afterBuild(view, custom) {
      view._list = custom.querySelector(".ng-notes");
      view._gates = custom.querySelector(".ng-gates");
      view._seen = null;
      view._gateKey = null;
      renderGates(view);
    },
    onState(st, view) {
      if (!st || !view._gates) return;
      renderGates(view);
      if (st.arrays && st.arrays.notes) takeNotes(view, st.arrays.notes);
      (view._lamps || []).forEach((d, k) => d.classList.toggle("on", !!st["gate" + (k + 1)]));
    },
  });
})();
