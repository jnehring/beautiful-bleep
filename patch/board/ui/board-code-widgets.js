// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-code-widgets.js — the widget layout of a Code node (doc: Bleep Script, Custom UIs). A module script declares
// `layout: [{ fader: "vol", meter: "level" }, ...]` in @module; the compiler checks it and expands it (transform/bleep.mjs, normalizeLayout) and
// this file draws the tree in the node's view in place of the automatic knobs. The widgets read and write the node's knob values through the
// view's own api, so undo, automation and panels see the same values as with any module.
//
//   BleepCodeWidgets.build(view, layout, spec, mount)  -> { update(state) }
//     view    the BleepView of the node (view.node.params, view.api)
//     layout  the tree: { type, param?, probe?, button?, text?, label?, title?, children? }
//     spec    the node's type description (params with their ranges)
//     mount   the element to draw into
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const P = (G.BleepSeal && G.BleepSeal.priv) || G;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // ---- the knob's travel and its value in units, as the engine maps it (engine/Spec.h) ---------------------------------------------
  function toUnits(p, x) {
    let v;
    if (p.map === "exp") v = p.min * Math.pow(p.max / p.min, x);
    else if (p.map === "skew") { const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min)); v = x <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(x) / skew); }
    else v = p.min + (p.max - p.min) * x;
    return p.kind === "float" ? v : Math.round(v);
  }
  function fromUnits(p, v) {
    v = Math.min(Math.max(v, p.min), p.max);
    if (p.map === "exp") return Math.log(v / p.min) / Math.log(p.max / p.min);
    if (p.map === "skew") { const q = (v - p.min) / (p.max - p.min); return q <= 0 ? 0 : Math.pow(q, Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min))); }
    return (v - p.min) / (p.max - p.min);
  }
  function text(p, x) {
    if (p.kind === "bool") return x >= 0.5 ? "On" : "Off";
    if (p.kind === "choice") return (p.choices || [])[Math.round(x * (p.choices.length - 1))] || "";
    const v = toUnits(p, x);
    if (p.minText && x <= 0.001) return p.minText;
    const digits = p.kind === "int" ? 0 : Math.max(0, Math.min(6, p.decimals ?? 2));
    const n = (Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v).toFixed(digits);
    return p.label ? `${n} ${p.label}` : n;
  }

  function build(view, layout, spec, mount) {
    const params = new Map((spec.params || []).map((p) => [p.id, p]));
    const live = [];   // { update(st) } of every widget
    const valueOf = (id) => { const p = params.get(id); return view.node.params[id] ?? p.default; };

    // a value changed by a widget: one undo step per gesture (api.beginGesture), the same path as the automatic knobs
    function setValue(id, x) {
      const p = params.get(id);
      let v = clamp01(x);
      if (p.steps > 1) v = Math.round(v * (p.steps - 1)) / (p.steps - 1);
      view.node.params[id] = v;
      view.api.setParam(id, v);
      for (const w of live) w.refresh && w.refresh();
    }

    function drag(target, onStart, onMove) {
      target.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        view.api.beginGesture && view.api.beginGesture();
        const start = { x: e.clientX, y: e.clientY, rect: target.getBoundingClientRect(), shift: e.shiftKey };
        onStart(start, e);
        const move = (ev) => onMove(start, ev);
        const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
        target.addEventListener("pointercancel", up);
      });
    }

    const labelled = (box, w, fallback) => { const l = el("div", "bcw-label", w.label !== undefined ? w.label : fallback); box.append(l); return l; };
    const probeBar = (vertical) => {
      const bar = el("div", "bcw-bar" + (vertical ? " vertical" : "")), fill = el("i");
      bar.append(fill);
      return { bar, set(v) { const f = Math.max(0, Math.min(1, v)); fill.style[vertical ? "height" : "width"] = `${f * 100}%`; } };
    };

    const widgets = {
      knob(w) {
        const p = params.get(w.param), box = el("div", "bcw bcw-knob");
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 64 64");
        const arc = (r, a0, a1) => {
          const pt = (a) => { const t = (a - 90) * Math.PI / 180; return [32 + r * Math.cos(t), 32 + r * Math.sin(t)]; };
          const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
          return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
        };
        const track = document.createElementNS(ns, "path"), value = document.createElementNS(ns, "path"), pointer = document.createElementNS(ns, "line");
        track.setAttribute("class", "bcw-track"); value.setAttribute("class", "bcw-arc"); pointer.setAttribute("class", "bcw-pointer");
        track.setAttribute("d", arc(24, -135, 135));
        svg.append(track, value, pointer);
        const readout = el("div", "bcw-value");
        const draw = () => {
          const x = valueOf(w.param), a = -135 + 270 * x;
          value.setAttribute("d", x > 0.001 ? arc(24, -135, a) : "");
          const t = (a - 90) * Math.PI / 180;
          pointer.setAttribute("x1", 32 + 8 * Math.cos(t)); pointer.setAttribute("y1", 32 + 8 * Math.sin(t));
          pointer.setAttribute("x2", 32 + 20 * Math.cos(t)); pointer.setAttribute("y2", 32 + 20 * Math.sin(t));
          readout.textContent = text(p, x);
        };
        drag(svg, (s) => { s.x0 = valueOf(w.param); }, (s, e) => setValue(w.param, s.x0 + (s.y - e.clientY) / (e.shiftKey ? 800 : 160)));
        svg.addEventListener("dblclick", () => setValue(w.param, p.default));
        svg.addEventListener("wheel", (e) => { e.preventDefault(); setValue(w.param, valueOf(w.param) - Math.sign(e.deltaY) * (p.steps > 1 ? 1 / (p.steps - 1) : 0.02)); }, { passive: false });
        svg.setAttribute("role", "slider"); svg.setAttribute("aria-label", w.label ?? p.name); svg.tabIndex = 0;
        svg.addEventListener("keydown", (e) => {
          const step = p.steps > 1 ? 1 / (p.steps - 1) : 0.02;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { setValue(w.param, valueOf(w.param) + step); e.preventDefault(); }
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { setValue(w.param, valueOf(w.param) - step); e.preventDefault(); }
        });
        box.append(svg, readout);
        labelled(box, w, p.name);
        live.push({ refresh: draw });
        draw();
        return box;
      },
      fader(w) {
        const p = params.get(w.param), box = el("div", "bcw bcw-fader");
        const body = el("div", "bcw-fader-body"), track = el("div", "bcw-fader-track"), thumb = el("div", "bcw-fader-thumb");
        track.append(thumb);
        body.append(track);
        let meter = null;
        if (w.probe) { meter = probeBar(true); body.append(meter.bar); live.push({ update: (st) => meter.set(Number(st && st[w.probe]) || 0) }); }
        const readout = el("div", "bcw-value");
        const draw = () => { const x = valueOf(w.param); thumb.style.bottom = `calc(${x * 100}% - 6px)`; readout.textContent = text(p, x); };
        const at = (e, rect) => clamp01(1 - (e.clientY - rect.top) / rect.height);
        drag(track, (s, e) => setValue(w.param, at(e, s.rect)), (s, e) => setValue(w.param, at(e, s.rect)));
        track.addEventListener("dblclick", () => setValue(w.param, p.default));
        track.setAttribute("role", "slider"); track.setAttribute("aria-label", w.label ?? p.name); track.tabIndex = 0;
        track.addEventListener("keydown", (e) => {
          const step = p.steps > 1 ? 1 / (p.steps - 1) : 0.02;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { setValue(w.param, valueOf(w.param) + step); e.preventDefault(); }
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { setValue(w.param, valueOf(w.param) - step); e.preventDefault(); }
        });
        box.append(body, readout);
        labelled(box, w, p.name);
        live.push({ refresh: draw });
        draw();
        return box;
      },
      toggle(w) {
        const p = params.get(w.param), b = el("button", "bcw bcw-toggle", w.label ?? p.name);
        b.type = "button";
        const draw = () => { const on = valueOf(w.param) >= 0.5; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); };
        b.addEventListener("click", () => { view.api.beginGesture && view.api.beginGesture(); setValue(w.param, valueOf(w.param) >= 0.5 ? 0 : 1); });
        live.push({ refresh: draw });
        draw();
        return b;
      },
      select(w) {
        const p = params.get(w.param), box = el("div", "bcw bcw-select"), s = el("select");
        (p.choices || []).forEach((c, i) => s.append(new Option(c, String(i))));
        s.setAttribute("aria-label", w.label ?? p.name);
        const draw = () => { s.value = String(Math.round(valueOf(w.param) * (p.choices.length - 1))); };
        s.addEventListener("change", () => { view.api.beginGesture && view.api.beginGesture(); setValue(w.param, Number(s.value) / (p.choices.length - 1)); });
        box.append(s);
        labelled(box, w, p.name);
        live.push({ refresh: draw });
        draw();
        return box;
      },
      meter(w) {
        const box = el("div", "bcw bcw-meter"), m = probeBar(false), readout = el("div", "bcw-value");
        box.append(m.bar, readout);
        labelled(box, w, w.probe);
        live.push({ update(st) { const v = Number(st && st[w.probe]); if (Number.isFinite(v)) { m.set(v); readout.textContent = v.toFixed(3); } } });
        return box;
      },
      value(w) {
        const p = params.get(w.param), box = el("div", "bcw bcw-readout"), readout = el("div", "bcw-value big");
        box.append(readout);
        labelled(box, w, p.name);
        const draw = () => { readout.textContent = text(p, valueOf(w.param)); };
        live.push({ refresh: draw });
        draw();
        return box;
      },
      button(w) {
        const b = el("button", "bcw bcw-button", w.label ?? ((spec.buttons || []).find((x) => x.id === w.button) || {}).name ?? w.button);
        b.type = "button";
        b.addEventListener("click", () => view.api.command(w.button, 1));
        return b;
      },
      label(w) { return el("div", "bcw bcw-text", w.text); },
      spacer() { return el("div", "bcw bcw-spacer"); },
    };

    const draw = (w) => {
      if (w.type === "row" || w.type === "column") {
        const box = el("div", `bcw-group ${w.type}`);
        if (w.title) box.append(el("div", "bcw-title", w.title));
        const inner = el("div", "bcw-inner");
        for (const c of w.children || []) inner.append(draw(c));
        box.append(inner);
        return box;
      }
      return (widgets[w.type] || (() => el("div", "bcw bcw-text", `?${w.type}`)))(w);
    };
    const root = el("div", "bcw-layout");
    for (const w of layout) root.append(draw(w));
    mount.replaceChildren(root);
    return {
      /// The engine's state for the node (probes by id, params when watched): meters move, knob values follow automation and undo.
      update(st) { for (const w of live) { w.refresh && w.refresh(); w.update && w.update(st); } },
    };
  }

  P.BleepCodeWidgets = { build, toUnits, fromUnits, text };
})();
