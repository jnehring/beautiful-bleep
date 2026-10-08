// SPDX-License-Identifier: MIT
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
//              perform(action, ...args)  (performance gestures: not saved, no undo),
//              presets(kind), savePreset(kind, name, preset), deletePreset(kind, name)
//                → the library's [{name, preset}] (kind "drums": Drum Grid patterns) }
//   view.root                     the element to insert
//   view.update(nodeState)        live values: { params: {id: {v, e, a, t}}, outputs }
//   view.refresh(node)            the node changed (cables, values from undo)
//
// A module adds its own displays with BleepViews.register(type, hooks):
//   template   HTML for the custom section
//   top        true: the custom section comes before the knobs
//   settingsTop  true: the settings (choices, toggles) come first
//   width      the view window's width in px (default 340)
//   afterBuild(view, customElement)
//   onState(nodeState, view)
//   onRefresh(view)    the node changed (undo, another edit)
(function () {
  "use strict";
  const hooks = {};
  window.BleepViews = { register: (type, h) => (hooks[type] = h), get: (type) => hooks[type] || null };

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
  function dragValue(target, get, set, onStart) {
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
    const end = () => (dragging = false);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    return () => dragging;
  }

  function create(type, node, api) {
    const root = el("div", "bleep-view");
    root.style.setProperty("--accent", type.colour || "#4fd1c5");
    const knobsEl = el("section", "bv-knobs");
    const customEl = el("section", "bv-custom");
    const settingsEl = el("section", "bv-settings");
    const h = hooks[type.type];
    const sections = h && h.top ? [customEl, knobsEl] : [knobsEl, customEl];
    if (h && h.settingsTop) root.append(settingsEl, ...sections);
    else root.append(...sections, settingsEl);
    if (type.description) root.appendChild(el("p", "bv-description", type.description));

    const view = { root, type, node, api, knobs: new Map(), settings: new Map() };

    function setParam(id, v) {
      v = clamp01(v);
      view.node.params[id] = v;
      api.setParam(id, v);
    }

    // ---- knobs: every modulatable float is a destination (spec §7.3)
    function makeKnob(p) {
      const box = el("div", "bv-knob");
      box.dataset.param = p.id;
      if (p.modulatable) box.classList.add("bv-target");
      box.appendChild(el("div", "bv-label", p.name));
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
      const k = { p, box, arc, ring, pointer, value, amounts, eff: null };
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
      s.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setParam(p.id, (view.node.params[p.id] ?? p.default) - e.deltaY / (e.shiftKey ? 3000 : 600));
        k.draw();
      }, { passive: false });
      k.renderAmounts = () => {
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
          x.addEventListener("click", (e) => { e.stopPropagation(); api.removeCable(c.id); });
          chip.append(label, pct, x);
          dragValue(chip, () => (c.amount + 1) / 2, (v) => {
            c.amount = Math.round((clamp01(v) * 2 - 1) * 1000) / 1000;
            show();
            api.setAmount(c.id, c.amount);
          }, () => api.beginGesture());
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
      const s = { p, box };
      const steps = Math.max(2, p.steps);
      if (p.kind === "bool") {
        label.remove();
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

    for (const p of type.params) {
      if (p.kind === "float") {
        const k = makeKnob(p);
        view.knobs.set(p.id, k);
        knobsEl.appendChild(k.box);
      } else {
        const s = makeSetting(p);
        view.settings.set(p.id, s);
        settingsEl.appendChild(s.box);
      }
    }
    if (!knobsEl.childElementCount) knobsEl.remove();
    if (!settingsEl.childElementCount) settingsEl.remove();

    if (h && h.template) customEl.innerHTML = h.template;
    if (h && h.afterBuild) h.afterBuild(view, customEl);
    if (!customEl.childElementCount) customEl.remove();

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
      }
      if (h && h.onState) h.onState(st, view);
    };
    view.refresh = (n) => {
      view.node = n;
      for (const k of view.knobs.values()) { k.renderAmounts(); k.draw(); }
      for (const s of view.settings.values()) s.draw();
      if (h && h.onRefresh) h.onRefresh(view);
    };
    /// Effective value of a param (modulated if active), for custom displays.
    view.value = (st, id) => {
      const ps = st && st.params && st.params[id];
      if (ps) return ps.a ? ps.e : ps.v;
      return view.node.params[id] ?? 0;
    };
    return view;
  }

  window.BleepView = { create };
})();
