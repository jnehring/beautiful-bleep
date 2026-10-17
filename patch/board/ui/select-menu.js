// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Replaces the native popup of every <select> in the board UI (the board's own and the module
// views') with a menu in the board's own style. The closed select keeps being the real element, so
// the views read and write `.value` and listen for `change` as before; only the list is ours.
(function () {
  let open = null;  // { select, menu, items, active }

  function close() {
    if (!open) return;
    open.menu.remove();
    open.select.focus({ preventScroll: true });
    open = null;
  }

  function choose(item) {
    const sel = open.select;
    const changed = sel.value !== item.value;
    close();
    if (!changed) return;
    sel.value = item.value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setActive(i) {
    if (!open) return;
    open.active = i;
    open.items.forEach((it, k) => it.el.classList.toggle("active", k === i));
    if (open.items[i]) open.items[i].el.scrollIntoView({ block: "nearest" });
  }

  function move(step) {
    let i = open.active;
    do { i += step; } while (open.items[i] && open.items[i].disabled);
    if (open.items[i]) setActive(i);
  }

  function show(sel) {
    close();
    const menu = document.createElement("div");
    menu.className = "popover sel-menu";
    const items = [];
    const add = (opt, parent) => {
      const el = document.createElement("div");
      el.className = "m-item sel-item" + (opt.disabled ? " disabled" : "") + (opt.selected ? " current" : "");
      el.textContent = opt.textContent;
      const item = { el, value: opt.value, disabled: opt.disabled };
      el.addEventListener("mousemove", () => { if (!item.disabled) setActive(items.indexOf(item)); });
      el.addEventListener("click", () => { if (!item.disabled) choose(item); });
      items.push(item);
      parent.appendChild(el);
    };
    for (const child of sel.children) {
      if (child.tagName === "OPTGROUP") {
        const g = document.createElement("div");
        g.className = "sel-group";
        g.textContent = child.label;
        menu.appendChild(g);
        for (const o of child.children) add(o, menu);
      } else if (child.tagName === "OPTION") add(child, menu);
    }
    document.body.appendChild(menu);

    const r = sel.getBoundingClientRect();
    menu.style.minWidth = r.width + "px";
    const below = innerHeight - r.bottom - 8, above = r.top - 8;
    const flip = below < Math.min(menu.scrollHeight, 220) && above > below;
    menu.style.maxHeight = Math.max(80, Math.min(flip ? above : below, 360)) + "px";
    menu.style.left = Math.max(4, Math.min(r.left, innerWidth - menu.offsetWidth - 4)) + "px";
    menu.style.top = flip ? Math.max(4, r.top - menu.offsetHeight - 4) + "px" : r.bottom + 4 + "px";

    open = { select: sel, menu, items, active: -1 };
    setActive(Math.max(0, items.findIndex((it) => it.value === sel.value)));
  }

  document.addEventListener("mousedown", (e) => {
    const sel = e.target.closest && e.target.closest("select");
    if (sel && !sel.disabled && !sel.multiple) {
      e.preventDefault();
      e.stopPropagation();
      if (open && open.select === sel) close(); else { sel.focus({ preventScroll: true }); show(sel); }
    } else if (open && !open.menu.contains(e.target)) close();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (open) {
      const k = e.key;
      if (k === "Escape") close();
      else if (k === "ArrowDown") move(1);
      else if (k === "ArrowUp") move(-1);
      else if (k === "Home") { setActive(-1); move(1); }
      else if (k === "End") { setActive(open.items.length); move(-1); }
      else if (k === "Enter" || k === " ") { if (open.items[open.active]) choose(open.items[open.active]); }
      else if (k !== "Tab") return;
      e.preventDefault();
      e.stopPropagation();
    } else if (e.target.tagName === "SELECT" && !e.target.multiple && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      show(e.target);
    }
  }, true);

  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
  document.addEventListener("wheel", (e) => { if (open && !open.menu.contains(e.target)) close(); }, { capture: true, passive: true });
})();
