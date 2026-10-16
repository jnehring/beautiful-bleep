// SPDX-License-Identifier: MIT
// modal.js — Library, Settings and Help open as modal dialogs over the board (the board stays visible behind them).
//
//   BleepModal.mount(root, close)   puts `root` (a section the view built) into a dialog with a ✕ button; `close()` hides the view
//   BleepModal.toggle(root, on)     shows or hides it (also sets root.hidden); a click on the backdrop and Esc call `close`
(function () {
  "use strict";
  const backs = new Map();   // root -> its backdrop
  const closers = new Map(); // root -> close()

  // Esc closes the open dialog, wherever the focus is (a field being edited keeps its own Esc).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName)) return;
    for (const [root, back] of backs) if (!back.hidden) { e.stopPropagation(); closers.get(root)(); return; }
  }, true);

  window.BleepModal = {
    mount(root, close) {
      const back = document.createElement("div");
      back.className = "modal-back";
      back.hidden = true;
      root.classList.add("modal");
      const x = document.createElement("button");
      x.className = "modal-close";
      x.textContent = "✕";
      x.title = "Close (Esc)";
      x.setAttribute("aria-label", "Close");
      x.addEventListener("click", close);
      root.prepend(x);
      root.setAttribute("role", "dialog");
      back.appendChild(root);
      back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
      document.body.appendChild(back);
      backs.set(root, back);
      closers.set(root, close);
    },
    toggle(root, on) {
      root.hidden = !on;
      const back = backs.get(root);
      if (back) back.hidden = !on;
      if (!on) { const c = document.getElementById("canvas"); if (c && backs.get(root) && document.activeElement && root.contains(document.activeElement)) c.focus(); }
    },
  };
})();
