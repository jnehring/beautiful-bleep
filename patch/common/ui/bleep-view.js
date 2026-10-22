// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep-view.js — module views (spec §9.4): a module's knobs, settings and
// custom displays, built from its type description. The board shows them in
// floating windows; panels (later) will combine several.
//
//   const view = BleepView.create(type, node, api)
//     type   node type from init().types
//     node   the node from the board document
//     api    { setParam(id, v), beginGesture(), setAmount(cableId, v),
//              removeCable(cableId), cablesInto(paramId) → [{id, label, amount}],
//              setNodeProperty(key, value), setData(data),
//              isPatched(inputJack) → bool, command(id, value),
//              importMedia(name, base64) → Promise<{id, name, seconds, channels} | {error}>,
//              exportMedia(slot) → Promise<{id, seconds, channels} | {error}>,
//              revealMedia(id) → Promise<{ok} | {error}>  (shows the file in the computer's file manager),
//              knobMenu(paramId, event)  (optional: right-click on a knob),
//              perform(action, ...args)  (performance gestures: not saved, no undo),
//              presets(kind), savePreset(kind, name, preset), deletePreset(kind, name)
//                → the library's [{name, preset}] (kind "drums": Drum Grid patterns) }
//
// From the type description it also handles: stepped knobs (modulatable
// choices and integers), knob groups ("group"), knobs and settings shown only
// in some modes ("show"), names that follow a setting ("names") and the
// module's buttons ("buttons", sent through api.command).
//
// BleepView.mediaDrop(element, api, onImported) makes `element` accept a
// dropped WAV file (or a click to choose one) and imports it into the media
// folder; onImported({id, name, seconds, channels}) gets the result.
//   view.root                     the element to insert
//   view.update(nodeState)        live values: { params: {id: {v, e, a, t}}, outputs }
//   view.refresh(node)            the node changed (cables, values from undo)
//
// Presets: a module with factory presets (module-presets.json, built from patch/presets/modules)
// gets a preset bar above its controls, the same for every module: previous / next, a menu with
// the Factory presets (read-only) and the user's own, and Save. User presets live in the
// "module:<type>" library of api.presets / savePreset / deletePreset: {format, params, data?}.
//
// A module adds its own displays with BleepViews.register(type, hooks):
//   template   HTML for the custom section
//   top        false: the controls come before the custom section (default: after it)
//   settingsTop  true: the settings (choices, toggles) come first
//   width      the view window's width in px (default 760: views are landscape)
//   side       true: the custom section sits left, the controls right (else the custom
//              section is a full-width band above or, with top:false, below the controls)
//   layout     the controls in logical order, as sections (cards) side by side:
//                [{ title: "Pitch", params: ["octave", "coarse", "fine"] }, ...]
//              knobs, choices and toggles alike; params not listed follow in a last
//              untitled section; "columns": true stacks a section's knobs vertically.
//              Without a layout the module's ParamSpec groups become the sections.
//   hideParams   ids of knobs/settings the custom section replaces (they stay
//                modulatable through cables, just not drawn twice)
//   parts      names (and, where the template alone does not say, selectors) for the displays
//              of the custom section, so a panel can show one alone:
//                [{ id: "display", name: "Grain display", select: ".bv-panel" }, ...]
//              Without it every top-level element of the template is a part, named after its
//              <h2> (the text before " · "), else "Display".
//   partNames  names for those top-level elements, in order, instead of the <h2>s: ["Pattern grid"]
//   partSizes  the box a panel gives each of them, in grid units [columns, rows], in the same order, where the
//              default [24, 10] is too small or too big: [[35, 10]]. (With parts: a size on each entry.)
//
// Parts (panels show them alone, spec panels.md "Parts of a module view"): the displays of the
// custom section ("d:<slug>"), each titled section of knobs ("s:<slug>") and the button bar
// ("b:buttons"). BleepView.partsOf(type) → [{id, name, kind, knobs}] lists them without building
// a view; view.parts is the built ones, view.showOnly(id) hides everything but one (it stays
// laid out, so a display that measures its siblings keeps drawing) and fills the view's box.
// api.partMenu(partId | null, event) (optional) is called on a right-click on a part, or on the
// view's background.
//   visible(item, view)  false hides a knob or setting on top of "show"; the view calls applyLayout() again
//                        whenever a param for which revealedBy(paramId) is true changes (EQ: only the selected band's controls)
//   revealedBy(paramId)  see visible
//   afterBuild(view, customElement)
//   onState(nodeState, view)
//   onRefresh(view)    the node changed (undo, another edit)
//
// Drawing helpers for custom displays (BleepView.*):
//   fit(canvas) → {g, w, h}   sizes the canvas to its CSS box and the device pixel ratio
//   theme(root) → {accent, line, muted, text, panel, mod}   the colours as strings
//   glow(g, colour, blur)     the next strokes glow (call g.shadowBlur = 0 to end)
//   loop(root, fn)            calls fn(t seconds) every animation frame while the view
//                             is on screen; stops by itself once it is removed
(function () {
  "use strict";
  const hooks = new Map();
  // The first registration of a type stays: a view script loaded later (an installed module's) cannot take over another module's view.
  window.BleepViews = { register: (type, h) => { if (!hooks.has(type)) hooks.set(type, h); }, get: (type) => hooks.get(type) || null };

  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const svg = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const START = -135, END = 135;
  const angle = (v) => START + (END - START) * v;
  function polar(r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [32 + r * Math.cos(a), 32 + r * Math.sin(a)];
  }
  function arcPath(r, from, to) {
    if (to < from) [from, to] = [to, from];
    if (to - from < 0.5) to = from + 0.5;
    const [x1, y1] = polar(r, from), [x2, y2] = polar(r, to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /// Vertical drag helper: 200 px for the full range, Shift for fine.
  function dragValue(target, get, set, onStart, onEnd) {
    let startY = 0, startV = 0, dragging = false;
    target.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      target.setPointerCapture(e.pointerId);
      startY = e.clientY; startV = get(); dragging = true;
      if (onStart) onStart();
    });
    target.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      set(startV + (startY - e.clientY) / (e.shiftKey ? 1000 : 200));
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (onEnd) onEnd();
    };
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    return () => dragging;
  }

  // ---- parts: what a panel can show of a view on its own
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  const shortTitle = (t) => String(t).split(/\s[·—–:]\s/)[0].trim();
  const notStyle = (e) => e.tagName !== "STYLE" && e.tagName !== "SCRIPT";
  /// The top-level elements of a template, without building a view.
  function templateKids(html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    return [...t.content.children].filter(notStyle);
  }
  const uniqueId = (taken, base) => { let id = base, i = 2; while (taken.has(id)) id = base + "-" + i++; taken.add(id); return id; };
  /// The displays of the custom section: {id, name, select?, index?}; index -1 is the section itself.
  function displayParts(h, taken) {
    if (!h) return [];
    if (h.parts) return h.parts.map((d) => ({ id: uniqueId(taken, "d:" + d.id), name: d.name, select: d.select, size: d.size, kind: "display" }));
    const kids = h.template ? templateKids(h.template) : [];
    if (!kids.length) return h.template ? [{ id: uniqueId(taken, "d:display"), name: "Display", index: -1, kind: "display" }] : [];
    // the <h2>'s own text, not what its buttons and selects add to it
    const own = (t) => [...t.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    const names = kids.map((k, i) => {
      if (h.partNames && h.partNames[i]) return h.partNames[i];
      const t = k.tagName === "H2" ? k : k.querySelector("h2");
      return t && own(t) ? shortTitle(own(t)) : "";
    });
    return kids.map((k, i) => {
      const name = names[i] || (kids.length > 1 ? "Display " + (i + 1) : "Display");
      return { id: uniqueId(taken, "d:" + slug(name)), name, index: i, size: h.partSizes && h.partSizes[i], kind: "display" };
    });
  }
  /// The titled sections of knobs: [{id, name, knobs}] in the order the view lays them out.
  function sectionParts(type, h, taken) {
    const out = [];
    const add = (name, ids) => { if (name && ids.length) out.push({ id: uniqueId(taken, "s:" + slug(name)), name, kind: "controls", knobs: ids.length }); };
    const hide = new Set((h && h.hideParams) || []);
    const known = new Set(type.params.map((p) => p.id));
    if (h && h.layout) for (const l of h.layout) add(l.title, l.params.filter((id) => known.has(id) && !hide.has(id)));
    else {
      const groups = new Map();
      for (const p of type.params) if (p.group && !hide.has(p.id) && (p.kind === "float" || (p.modulatable && !p.cableable))) groups.set(p.group, (groups.get(p.group) || 0) + 1);
      for (const [g, n] of groups) add(g, new Array(n));
    }
    return out;
  }
  /// Everything of this module's view a panel can show alone: [{id, name, kind: "display" | "controls" | "buttons", knobs?, size?}].
  function partsOf(type) {
    const h = type.older ? undefined : hooks.get(type.type), taken = new Set();
    const out = [...displayParts(h, taken), ...sectionParts(type, h, taken)];
    if (type.buttons && type.buttons.length) out.push({ id: "b:buttons", name: "Buttons", kind: "buttons" });
    return out.map(({ id, name, kind, knobs, size }) => ({ id, name, kind, ...(knobs ? { knobs } : {}), ...(size ? { size } : {}) }));
  }


  const { makePresetBar, loadFactoryPresets, factoryOf } = window.BleepViewPresets;   // bleep-view-presets.js
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function create(type, node, api) {
    const root = el("div", "bleep-view");
    root.style.setProperty("--accent", type.colour || "#4fd1c5");
    const customEl = el("section", "bv-custom");
    const stage = el("div", "bv-stage");  // the custom display and the controls
    // An older version a node pins gets the plain view: the view script that is loaded belongs to the newest version.
    const h = type.older ? undefined : hooks.get(type.type);
    if (type.description) root.appendChild(el("p", "bv-description", type.description));
    root.appendChild(stage);

    const view = { root, type, node, api, knobs: new Map(), settings: new Map() };

    const paramById = new Map(type.params.map((p) => [p.id, p]));
    /// A param's value in its own units (rounded, for settings).
    function units(id) {
      const p = paramById.get(id);
      if (!p) return 0;
      return Math.round(p.min + (view.node.params[id] ?? p.default) * (p.max - p.min));
    }
    const isShown = (item) => (!item.show || (units(item.show.param) >= item.show.min && units(item.show.param) <= item.show.max)) &&
      !(h && h.visible && h.visible(item, view) === false);
    const shownName = (item) => (item.names && item.names.list[units(item.names.by)]) || item.name;
    view.isShown = isShown;
    view.shownName = shownName;
    view.units = units;
    /// Params some knob, setting or jack depends on (show / names).
    const drivers = new Set();
    for (const item of [...type.params, ...type.inputs, ...type.outputs]) {
      if (item.show) drivers.add(item.show.param);
      if (item.names) drivers.add(item.names.by);
    }

    function setParam(id, v) {
      v = clamp01(v);
      const p = paramById.get(id);
      if (p && p.steps > 1) v = Math.round(v * (p.steps - 1)) / (p.steps - 1);  // stepped knobs snap
      view.node.params[id] = v;
      api.setParam(id, v);
      // A module's hook can tie knobs together: linked(id, view) -> the ids that follow this one.
      if (h && h.linked && !view._linking) {
        view._linking = true;
        try {
          for (const o of h.linked(id, view) || []) {
            if (o === id) continue;
            setParam(o, v);
            const k = view.knobs.get(o), st = view.settings.get(o);
            if (k) { k.renderAmounts(); k.draw(); }
            if (st) st.draw();
          }
        } finally { view._linking = false; }
      }
      if (drivers.has(id) || (h && h.revealedBy && h.revealedBy(id))) applyLayout();
      if (view.presets) view.presets.update();
    }
    /// Shows, hides and renames knobs and settings after a mode change.
    function applyLayout() {
      for (const [id, k] of view.knobs) {
        k.box.hidden = !isShown(k.p);
        k.label.textContent = shownName(k.p);
      }
      for (const [id, s] of view.settings) {
        s.box.hidden = !isShown(s.p);
        if (s.label) s.label.textContent = shownName(s.p);
      }
      for (const g of root.querySelectorAll(".bv-sec"))
        g.hidden = ![...g.querySelectorAll(".bv-knob, .bv-setting")].some((b) => !b.hidden);
    }

    view.applyLayout = applyLayout;

    // ---- knobs: every modulatable float is a destination (spec §7.3)
    function makeKnob(p) {
      const box = el("div", "bv-knob");
      box.dataset.param = p.id;
      if (p.modulatable) box.classList.add("bv-target");
      if (p.kind !== "float") box.classList.add("bv-stepped");
      const label = el("div", "bv-label", p.name);
      box.appendChild(label);
      const s = svg("svg", { viewBox: "0 0 64 64" });
      const track = svg("path", { class: "bv-track", d: arcPath(24, START, END) });
      const arc = svg("path", { class: "bv-arc" });
      const ring = svg("path", { class: "bv-ring", opacity: 0 });
      const pointer = svg("line", { class: "bv-pointer" });
      s.append(track, arc, ring, pointer);
      box.appendChild(s);
      const value = el("div", "bv-value", "");
      box.appendChild(value);
      const amounts = el("div", "bv-amounts");
      box.appendChild(amounts);
      const k = { p, box, label, arc, ring, pointer, value, amounts, eff: null };
      k.draw = () => {
        const v = view.node.params[p.id] ?? p.default;
        arc.setAttribute("d", arcPath(24, START, angle(v)));
        const [x1, y1] = polar(10, angle(v)), [x2, y2] = polar(20, angle(v));
        pointer.setAttribute("x1", x1); pointer.setAttribute("y1", y1);
        pointer.setAttribute("x2", x2); pointer.setAttribute("y2", y2);
        const active = k.eff !== null;
        ring.setAttribute("opacity", active ? 1 : 0);
        if (active) ring.setAttribute("d", arcPath(29, angle(v), angle(k.eff)));
        box.classList.toggle("bv-modulated", active);
      };
      k.dragging = dragValue(s, () => view.node.params[p.id] ?? p.default,
        (v) => { setParam(p.id, v); k.draw(); }, () => api.beginGesture());
      s.addEventListener("dblclick", () => { api.beginGesture(); setParam(p.id, p.default); k.draw(); });
      // Right-click: the board offers "Add to panel" (api.knobMenu, optional).
      box.addEventListener("contextmenu", (e) => {
        if (!api.knobMenu) return;
        e.preventDefault();
        e.stopPropagation();
        api.knobMenu(p.id, e);
      });
      s.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setParam(p.id, (view.node.params[p.id] ?? p.default) - e.deltaY / (e.shiftKey ? 3000 : 600));
        k.draw();
      }, { passive: false });
      // A refresh during an amount drag (beginGesture answers with the board)
      // must not replace the chip under the pointer; it re-renders on release.
      let chipDrag = false, stale = false;
      k.renderAmounts = () => {
        if (chipDrag) { stale = true; return; }
        stale = false;
        amounts.innerHTML = "";
        if (!p.modulatable || !api.cablesInto) return;
        for (const c of api.cablesInto(p.id)) {
          const chip = el("div", "bv-amount");
          chip.title = "Drag up/down to change the amount, double-click to reset";
          const label = el("span", "bv-amount-label", c.label);
          const pct = el("span", "bv-amount-value");
          const show = () => (pct.textContent = Math.round(c.amount * 100) + "%");
          show();
          const x = el("button", "bv-amount-remove", "×");
          x.title = "Remove cable";
          x.addEventListener("pointerdown", (e) => e.stopPropagation());
          x.addEventListener("click", (e) => { e.stopPropagation(); api.removeCable(c.id); });
          chip.append(label, pct, x);
          dragValue(chip, () => (c.amount + 1) / 2, (v) => {
            c.amount = Math.round((clamp01(v) * 2 - 1) * 1000) / 1000;
            show();
            api.setAmount(c.id, c.amount);
          }, () => { chipDrag = true; api.beginGesture(); },
          () => { chipDrag = false; if (stale) k.renderAmounts(); });
          chip.addEventListener("dblclick", () => { api.beginGesture(); c.amount = 1; show(); api.setAmount(c.id, 1); });
          amounts.appendChild(chip);
        }
      };
      k.renderAmounts();
      k.draw();
      return k;
    }

    // ---- settings: choices, toggles, integers
    function makeSetting(p) {
      const box = el("div", "bv-setting");
      const label = el("span", "bv-label", p.name);
      box.appendChild(label);
      const s = { p, box, label };
      const steps = Math.max(2, p.steps);
      if (p.kind === "bool") {
        label.remove();
        s.label = null;
        const b = el("button", "bv-toggle", p.name);
        b.addEventListener("click", () => {
          api.beginGesture();
          setParam(p.id, (view.node.params[p.id] ?? p.default) >= 0.5 ? 0 : 1);
          s.draw();
        });
        box.appendChild(b);
        s.draw = () => b.classList.toggle("on", (view.node.params[p.id] ?? p.default) >= 0.5);
      } else if (p.kind === "choice" || steps <= 33) {
        const select = el("select");
        let group = null;  // consecutive choices with the same group share an <optgroup>
        for (let i = 0; i < steps; i++) {
          const opt = new Option(p.choices ? p.choices[i] : String(Math.round(p.min + i)), i);
          if (p.groups && p.groups[i]) {
            if (!group || group.label !== p.groups[i]) {
              group = el("optgroup");
              group.label = p.groups[i];
              select.appendChild(group);
            }
            group.appendChild(opt);
          } else select.appendChild(opt);
        }
        select.addEventListener("change", () => {
          api.beginGesture();
          setParam(p.id, parseInt(select.value, 10) / (steps - 1));
        });
        box.appendChild(select);
        s.draw = () => {
          if (document.activeElement !== select)
            select.value = Math.round((view.node.params[p.id] ?? p.default) * (steps - 1));
        };
      } else {
        const input = el("input", "bv-number");
        input.type = "number";
        input.min = p.min; input.max = p.max; input.step = 1;
        input.addEventListener("change", () => {
          api.beginGesture();
          const v = Math.min(p.max, Math.max(p.min, Math.round(parseFloat(input.value) || 0)));
          setParam(p.id, (v - p.min) / (p.max - p.min));
        });
        box.appendChild(input);
        s.draw = () => {
          if (document.activeElement !== input)
            input.value = Math.round(p.min + (view.node.params[p.id] ?? p.default) * (p.max - p.min));
        };
      }
      s.draw();
      return s;
    }

    // ---- build every knob and setting, then place them in sections
    const hidden = new Set((h && h.hideParams) || []);
    const items = new Map();   // param id → its knob or setting box
    for (const p of type.params) {
      if (hidden.has(p.id)) continue;
      if (p.kind === "float" || (p.modulatable && !p.cableable)) {  // stepped knobs are knobs too; a cableable setting stays a setting
        const k = makeKnob(p);
        view.knobs.set(p.id, k);
        items.set(p.id, k.box);
      } else {
        const s = makeSetting(p);
        view.settings.set(p.id, s);
        items.set(p.id, s.box);
      }
    }
    const controlsEl = el("section", "bv-controls");
    const section = (title) => {
      const sec = el("div", "bv-sec");
      if (title) sec.appendChild(el("div", "bv-sec-title", title));
      const body = el("div", "bv-sec-body");
      sec.appendChild(body);
      controlsEl.appendChild(sec);
      return sec;
    };
    const put = (sec, id) => {
      const box = items.get(id);
      if (!box) return;
      items.delete(id);
      const isSetting = box.classList.contains("bv-setting");
      let row = sec.querySelector(isSetting ? ".bv-sec-settings" : ".bv-sec-knobs");
      if (!row) {
        row = el("div", isSetting ? "bv-sec-settings" : "bv-sec-knobs");
        sec.querySelector(".bv-sec-body").appendChild(row);
      }
      row.appendChild(box);
    };
    if (h && h.layout) {
      for (const l of h.layout) {
        const sec = section(l.title);
        if (l.columns) sec.classList.add("bv-column");
        for (const id of l.params) put(sec, id);
      }
      if (items.size) { const rest = section(""); for (const id of [...items.keys()]) put(rest, id); }
    } else {
      // The ParamSpec groups; knobs outside a group share an untitled section, settings go last.
      const secs = new Map();
      let loose = null;
      for (const p of type.params) {
        if (!items.has(p.id)) continue;
        if (items.get(p.id).classList.contains("bv-setting")) continue;
        if (p.group) {
          if (!secs.has(p.group)) { secs.set(p.group, section(p.group)); if (type.groupColumns) secs.get(p.group).classList.add("bv-column"); }
          put(secs.get(p.group), p.id);
        } else {
          if (!loose) loose = section("");
          put(loose, p.id);
        }
      }
      if (items.size) { const rest = section(""); rest.classList.add("bv-sec-flat"); for (const id of [...items.keys()]) put(rest, id); }
    }
    controlsEl.querySelectorAll(".bv-sec").forEach((sec) => { if (!sec.querySelector(".bv-knob, .bv-setting")) sec.remove(); });
    if (!controlsEl.childElementCount) controlsEl.remove();
    if (h && h.settingsTop) controlsEl.classList.add("bv-settings-first");
    stage.append(...(h && h.top === false ? [controlsEl, customEl] : [customEl, controlsEl]));
    if (h && h.side) root.classList.add("bv-side");

    // ---- buttons (ModuleSpec::buttons): momentary ones also send 0 on release
    let buttonsEl = null;
    if (type.buttons && type.buttons.length && api.command) {
      const bar = el("section", "bv-buttons");
      for (const b of type.buttons) {
        const btn = el("button", "bv-button", b.name);
        btn.dataset.command = b.id;
        if (b.momentary) {
          btn.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            btn.setPointerCapture(e.pointerId);
            btn.classList.add("on");
            api.command(b.id, 1);
          });
          const up = () => {
            if (!btn.classList.contains("on")) return;
            btn.classList.remove("on");
            api.command(b.id, 0);
          };
          btn.addEventListener("pointerup", up);
          btn.addEventListener("pointercancel", up);
        } else btn.addEventListener("click", () => api.command(b.id, 1));
        bar.appendChild(btn);
      }
      stage.after(bar);
      buttonsEl = bar;
    }
    applyLayout();

    let tplKids = [];
    if (h && h.template) { customEl.innerHTML = h.template; tplKids = [...customEl.children].filter(notStyle); }
    if (h && h.afterBuild) h.afterBuild(view, customEl);

    // ---- parts (see the header): the elements a panel can show alone
    view.parts = new Map();
    const taken = new Set();
    for (const d of displayParts(h, taken)) {
      const e = d.select ? customEl.querySelector(d.select) : d.index === -1 ? customEl : tplKids[d.index];
      if (e) view.parts.set(d.id, { ...d, el: e });
    }
    for (const sp of sectionParts(type, h, taken)) {
      const e = [...controlsEl.querySelectorAll(".bv-sec")].find((x) => { const t = x.querySelector(".bv-sec-title"); return t && t.textContent === sp.name; });
      if (e) view.parts.set(sp.id, { ...sp, el: e });
    }
    if (!customEl.childElementCount) customEl.remove();
    if (buttonsEl) view.parts.set("b:buttons", { id: "b:buttons", name: "Buttons", kind: "buttons", el: buttonsEl });

    /// Hides everything but one part (it stays laid out, only invisible, so displays that measure
    /// their neighbours keep drawing) and lets the part fill the view's box. False: no such part.
    view.showOnly = (id) => {
      const part = view.parts.get(id);
      if (!part || !root.contains(part.el)) return false;
      root.classList.add("bv-part");
      for (let e = part.el; e !== root; e = e.parentElement) {
        e.classList.add("bv-path");
        for (const sib of e.parentElement.children) if (sib !== e && notStyle(sib)) sib.classList.add("bv-off");
      }
      // a lone canvas takes the box's height instead of its own
      const canvases = part.el.tagName === "CANVAS" ? [part.el] : part.el.querySelectorAll("canvas");
      if (canvases.length === 1 && (canvases[0] === part.el || canvases[0].parentElement === part.el)) canvases[0].classList.add("bv-fill");
      return true;
    };

    // ---- right-click: "Add to panel" for the part under the pointer, else for the view
    if (api.partMenu) {
      const partMenu = (id) => (e) => {
        if (e.defaultPrevented || e.target.closest("input, select, textarea")) return;
        e.preventDefault();
        e.stopPropagation();
        api.partMenu(id, e);
      };
      for (const [id, part] of view.parts) part.el.addEventListener("contextmenu", partMenu(id));
      root.addEventListener("contextmenu", partMenu(null));
    }

    // ---- presets: a bar above the controls for modules with factory presets (same for all)
    /// Sets every knob and setting from a preset {params: {id: 0..1}, data?}; knobs it does not list go to their defaults.
    view.applyPreset = (preset) => {
      api.beginGesture();
      for (const p of type.params) {
        const v = preset.params && p.id in preset.params ? preset.params[p.id] : p.default;
        setParam(p.id, v);
      }
      if (preset.data !== undefined && preset.data !== null && api.setData) {
        view.node.data = clone(preset.data);
        api.setData(view.node.data);
      }
      for (const k of view.knobs.values()) k.draw();
      for (const s of view.settings.values()) s.draw();
      applyLayout();
      if (h && h.onRefresh) h.onRefresh(view);
    };
    view.presets = null;
    const addPresetBar = () => {
      if (view.presets || !factoryOf(type.type).length || !type.params.length) return;
      view.presets = makePresetBar(view, type, view.applyPreset);
      root.insertBefore(view.presets.el, stage);
    };
    addPresetBar();
    if (!view.presets) loadFactoryPresets().then(addPresetBar);

    view.update = (st) => {
      if (!st) return;
      if (st.params) {
        for (const [id, k] of view.knobs) {
          const ps = st.params[id];
          if (!ps) continue;
          if (!k.dragging()) view.node.params[id] = ps.v;
          k.eff = ps.a ? ps.e : null;
          k.value.textContent = ps.t;
          k.draw();
        }
        for (const [id, s] of view.settings) {
          const ps = st.params[id];
          if (ps) view.node.params[id] = ps.v;
          s.draw();
        }
        if (drivers.size || (h && h.visible)) applyLayout();
      }
      if (h && h.onState) h.onState(st, view);
    };
    view.refresh = (n) => {
      view.node = n;
      for (const k of view.knobs.values()) { k.renderAmounts(); k.draw(); }
      for (const s of view.settings.values()) s.draw();
      applyLayout();
      if (h && h.onRefresh) h.onRefresh(view);
      if (view.presets) view.presets.update();
    };
    /// Effective value of a param (modulated if active), for custom displays.
    view.value = (st, id) => {
      const ps = st && st.params && st.params[id];
      if (ps) return ps.a ? ps.e : ps.v;
      return view.node.params[id] ?? 0;
    };
    return view;
  }

  /// Decodes any audio file the web view understands (MP3, AIFF, FLAC, OGG, M4A …) and returns it as 16-bit PCM WAV bytes.
  async function toWav(file) {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) throw new Error("this view cannot decode audio files");
    const buf = await new Ctx(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
    const ch = Math.min(2, buf.numberOfChannels), n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); out.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVEfmt ");
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
    out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch).keys()].map((c) => buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++)
      for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.round(Math.max(-1, Math.min(1, data[c][i])) * 32767), true);
    return new Uint8Array(out.buffer);
  }

  /// Drop target / click-to-choose for an audio file (WAV, or MP3, AIFF, FLAC … converted to WAV), imported into the media folder.
  function mediaDrop(target, api, onImported, onError) {
    target.classList.add("bv-drop");
    const report = (msg) => (onError ? onError(msg) : (target.title = msg));
    async function importFile(file) {
      if (!file) return;
      if (!/\.(wav|mp3|aiff?|aifc|flac|ogg|oga|m4a|aac|caf)$/i.test(file.name) && !(file.type || "").startsWith("audio/"))
        return report("That is not an audio file.");
      target.classList.add("busy");
      try {
        let name = file.name, bytes;
        if (/\.wav$/i.test(name)) bytes = new Uint8Array(await file.arrayBuffer());
        else {
          try { bytes = await toWav(file); } catch (e) { return report("Could not decode " + name + ": " + ((e && e.message) || "unsupported format")); }
          name = name.replace(/\.[^.]*$/, "") + ".wav";
        }
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        const r = await api.importMedia(name, btoa(bin));
        if (!r || r.error) report((r && r.error) || "Import failed.");
        else onImported(r);
      } finally {
        target.classList.remove("busy");
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg,.m4a";
    input.hidden = true;
    input.addEventListener("change", () => { const f = input.files[0]; input.value = ""; importFile(f); });  // cleared, so the same file can be chosen again
    target.appendChild(input);
    target.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
    target.addEventListener("dragover", (e) => { e.preventDefault(); target.classList.add("over"); });
    target.addEventListener("dragleave", () => target.classList.remove("over"));
    target.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      target.classList.remove("over");
      importFile(e.dataTransfer && e.dataTransfer.files[0]);
    });
  }

  /// Sizes a canvas to its CSS box at the device pixel ratio and returns a context in CSS pixels.
  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function theme(root) {
    const css = getComputedStyle(root), c = (v) => css.getPropertyValue(v).trim();
    return { accent: c("--accent"), line: c("--line"), muted: c("--muted"), text: c("--text"),
             panel: c("--panel"), panel2: c("--panel-2"), mod: c("--mod") };
  }
  function glow(g, colour, blur) { g.shadowColor = colour; g.shadowBlur = blur === undefined ? 8 : blur; }
  /// Calls fn(seconds) on every animation frame while `root` is attached to the page.
  function loop(root, fn) {
    let id = 0, seen = false;
    const frame = (ms) => {
      if (root.isConnected) { seen = true; if (root.offsetParent !== null) fn(ms / 1000); }
      else if (seen) return;  // removed: stop
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }

  window.BleepView = { create, partsOf, mediaDrop, fit, theme, glow, loop };
})();
