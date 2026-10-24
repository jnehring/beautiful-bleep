// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// live-params.js — the Live Params node's view. It is the node's control surface: one card per row, with what the Bleep Live Link
// device on the node's channel has mapped the row to (the parameter's name, continuous or discrete) and the row's controls.
//
//   continuous  a horizontal slider with TWO handles, Min and Max: the part of the parameter's range the row moves through. Inside it a
//               triangle is the row's value (drag it: it is the knob, 0 at Min and 1 at Max), and a thin line is where the row is
//               asking the parameter to be right now (knob plus CV input plus cables), as the engine reports it.
//   discrete    the parameter's choices, each with the value that picks it. Click a choice to set the row to it.
//   unmapped    nothing to control yet.
//
// The Channel is a menu in the top right corner. The row knobs, Min and Max are the node's parameters (v1..4, lo1..4, hi1..4); this
// view hides their usual knobs and draws them as above. The node also has a CV input per row (it adds to the row's value).
// The engine sends the device's report as text with the node's live state (Module::liveText, "info": {channel, rows: [{row, kind,
// name, current, min, max, items}]}) and each row's position as pos1..pos4 (Module::liveValues).
(function () {
  "use strict";
  const ROWS = 4;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const pct = (v) => Math.round(clamp01(v) * 100) + "%";

  const CSS =
    ".lp-top{position:absolute;top:8px;right:10px;display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);z-index:1}" +
    ".lp-top select{font:inherit;letter-spacing:normal;text-transform:none;font-size:12px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:2px 4px}" +
    ".lp{display:flex;flex-direction:column;gap:6px;flex:1 1 100%;font-size:12px}" +
    ".lp-row{background:var(--panel-3);border-radius:8px;padding:7px 10px 8px;display:flex;flex-direction:column;gap:5px}" +
    ".lp-head{display:flex;align-items:baseline;gap:8px;min-width:0}" +
    ".lp-head b{font-weight:600;min-width:3.4em}" +
    ".lp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".lp-now{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".lp-kind{font-size:10px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);border-radius:99px;padding:0 7px;color:var(--muted)}" +
    ".lp-kind.continuous{color:var(--accent);border-color:var(--accent)}" +
    ".lp-kind.discrete{color:var(--mod);border-color:var(--mod)}" +
    ".lp-note,.lp-empty{color:var(--muted);font-size:11px}" +
    // the two-handle slider
    ".lp-slider{position:relative;height:30px;margin:2px 9px 0;touch-action:none;user-select:none;-webkit-user-select:none}" +
    ".lp-bar{position:absolute;left:0;right:0;top:12px;height:6px;border-radius:3px;background:var(--panel);box-shadow:inset 0 0 0 1px var(--line)}" +
    ".lp-span{position:absolute;top:12px;height:6px;border-radius:3px;background:var(--accent);opacity:.55}" +
    ".lp-span.inverted{background:repeating-linear-gradient(90deg,var(--accent) 0 6px,transparent 6px 10px)}" +
    ".lp-handle{position:absolute;top:7px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:var(--accent);border:2px solid var(--panel-3);box-shadow:0 0 0 1px var(--accent);cursor:ew-resize;box-sizing:border-box}" +
    ".lp-handle.max{border-radius:4px}" +
    ".lp-val{position:absolute;top:19px;width:0;height:0;margin-left:-6px;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid var(--text);cursor:ew-resize}" +
    ".lp-pos{position:absolute;top:4px;width:2px;height:22px;margin-left:-1px;background:var(--text);opacity:.85;pointer-events:none;border-radius:1px}" +
    ".lp-read{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}" +
    ".lp-read b{color:var(--text);font-weight:500}" +
    // the choices
    ".lp-items{max-height:8.6em;overflow:auto;border-radius:6px}" +
    ".lp-items table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}" +
    ".lp-items th{position:sticky;top:0;background:var(--panel-3);text-align:left;font-size:10px;font-weight:500;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;padding:1px 6px}" +
    ".lp-items td{padding:2px 6px;border-top:1px solid var(--line)}" +
    ".lp-items td.num{text-align:right}" +
    ".lp-items tr.choice{cursor:pointer}" +
    ".lp-items tr.choice:hover td{background:var(--panel-2)}" +
    ".lp-items tr.now td{background:var(--accent);color:#0d1014}";

  /// The device's report as the engine sends it with the node's state, or null.
  function parse(st) {
    if (!st || typeof st.info !== "string" || !st.info) return null;
    try { return JSON.parse(st.info); } catch (e) { return null; }
  }

  const spec = (view, id) => view.type.params.find((x) => x.id === id);
  const get = (view, id) => view.node.params[id] ?? (spec(view, id) ? spec(view, id).default : 0);
  /// Sets a node parameter (normalised) the way the view's own knobs do.
  function set(view, id, v) {
    v = clamp01(v);
    view.node.params[id] = v;
    view.api.setParam(id, v);
  }

  function channelOf(view) {
    const p = spec(view, "channel");
    return p ? Math.round(p.min + get(view, "channel") * (p.max - p.min)) : 1;
  }
  /// The Channel menu in the top right corner follows the node (undo, another edit) and moves it.
  function syncChannel(view) {
    const sel = view.lpChannel;
    if (sel && document.activeElement !== sel) sel.value = String(channelOf(view));
  }

  /// Makes `handle` draggable along `track`: onMove(position 0..1) for every move. One undo step per drag. `where()` is the handle's
  /// position now: grabbing it off its centre does not make it jump to the pointer.
  function dragAlong(view, track, handle, where, onMove, onReset) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event has no pointer to capture */ }
      view.api.beginGesture();
      const at = (ev) => {
        const r = track.getBoundingClientRect();
        return r.width > 0 ? (ev.clientX - r.left) / r.width : 0;
      };
      const grab = where() - at(e);
      const move = (ev) => onMove(clamp01(at(ev) + grab));
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    if (onReset) handle.addEventListener("dblclick", (e) => { e.stopPropagation(); view.api.beginGesture(); onReset(); });
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /// A row's card, built once per kind of report (the parts that change are updated by `update`).
  function build(view, r, info) {
    const card = el("div", "lp-row");
    const id = (p) => p + (r + 1);
    const head = el("div", "lp-head");
    head.appendChild(el("b", null, "Row " + (r + 1)));
    const parts = { card, head };
    if (!info) {
      head.appendChild(el("span", "lp-name lp-empty", "not mapped"));
      card.appendChild(head);
      card.appendChild(el("div", "lp-empty", `Map a parameter in the Bleep Live Link device on channel ${channelOf(view)}, row ${r + 1}.`));
      return parts;
    }
    const kind = info.kind === "discrete" ? "discrete" : "continuous";
    head.appendChild(el("span", "lp-kind " + kind, kind));
    const name = el("span", "lp-name", info.name || "");
    name.title = info.name || "";
    head.appendChild(name);
    parts.now = el("span", "lp-now");
    head.appendChild(parts.now);
    card.appendChild(head);

    if (kind === "continuous") {
      const slider = el("div", "lp-slider");
      slider.appendChild(el("div", "lp-bar"));
      parts.span = el("div", "lp-span");
      parts.pos = el("div", "lp-pos");
      parts.min = el("div", "lp-handle min");
      parts.max = el("div", "lp-handle max");
      parts.val = el("div", "lp-val");
      parts.min.title = "Min: where the row's 0 is. Drag; double-click resets it to 0%.";
      parts.max.title = "Max: where the row's 1 is. Drag; double-click resets it to 100%.";
      parts.val.title = "The row's value (its knob). Drag; double-click resets it to the middle.";
      for (const p of [parts.span, parts.pos, parts.min, parts.max, parts.val]) slider.appendChild(p);
      card.appendChild(slider);
      const read = el("div", "lp-read");
      parts.rmin = el("span");
      parts.rval = el("span");
      parts.rval.title = "The row's own value: how far along the span from Min to Max it is set (0% is Min, 100% is Max). The triangle shows it. " +
        "Min, Max and \"now\" are positions in the parameter's whole range; this one is a position inside the span.";
      parts.rmax = el("span");
      for (const p of [parts.rmin, parts.rval, parts.rmax]) read.appendChild(p);
      card.appendChild(read);
      const lo = () => get(view, id("lo")), hi = () => get(view, id("hi"));
      dragAlong(view, slider, parts.min, lo, (x) => { set(view, id("lo"), x); update(view, r, parts, null); }, () => { set(view, id("lo"), 0); update(view, r, parts, null); });
      dragAlong(view, slider, parts.max, hi, (x) => { set(view, id("hi"), x); update(view, r, parts, null); }, () => { set(view, id("hi"), 1); update(view, r, parts, null); });
      // The value triangle sits at Min + value × (Max − Min): dragging it sets the value that puts it where the pointer is.
      dragAlong(view, slider, parts.val, () => lo() + clamp01(get(view, id("v"))) * (hi() - lo()), (x) => {
        set(view, id("v"), Math.abs(hi() - lo()) < 1e-6 ? 0.5 : (x - lo()) / (hi() - lo()));
        update(view, r, parts, null);
      }, () => { set(view, id("v"), spec(view, id("v")).default); update(view, r, parts, null); });
      return parts;
    }

    const n = Math.max(2, info.items && info.items.length ? info.items.length : Math.round((info.max ?? 1) - (info.min ?? 0)) + 1);
    const names = Array.from({ length: n }, (_, i) => (info.items && info.items[i] !== undefined ? info.items[i] : String((info.min ?? 0) + i)));
    const wrap = el("div", "lp-items");
    const table = el("table");
    const hr = el("tr");
    for (const t of ["#", "Choice", "Send", "Knob"]) hr.appendChild(el("th", null, t));
    table.appendChild(hr);
    parts.choices = [];
    names.forEach((label, i) => {
      const tr = el("tr", "choice");
      tr.title = "Click to set the row to this choice";
      const send = i / (n - 1);
      tr.appendChild(el("td", null, String(i)));
      tr.appendChild(el("td", null, label));
      tr.appendChild(el("td", "num", send.toFixed(2)));
      tr.appendChild(el("td", "num", pct(send)));
      tr.addEventListener("click", () => {
        view.api.beginGesture();
        set(view, id("v"), send);
        update(view, r, parts, null);
      });
      table.appendChild(tr);
      parts.choices.push(tr);
    });
    parts.n = n;
    parts.names = names;
    wrap.appendChild(table);
    card.appendChild(wrap);
    card.appendChild(el("div", "lp-note", "The row's value picks the choice: click one, send its number in Send (0 to 1), or set the row to the percentage. Min and Max do not apply."));
    return parts;
  }

  /// The parts of a card that move: handles, markers, read-outs, the current choice. `st`: the node's live state, or null.
  function update(view, r, parts, st) {
    if (!parts.now) return;   // an unmapped card has nothing that moves
    const id = (p) => p + (r + 1);
    const lo = get(view, id("lo")), hi = get(view, id("hi")), v = clamp01(get(view, id("v")));
    const live = st && typeof st["pos" + (r + 1)] === "number" ? clamp01(st["pos" + (r + 1)]) : null;
    if (parts.span) {   // continuous
      const a = Math.min(lo, hi), b = Math.max(lo, hi);
      parts.span.style.left = a * 100 + "%";
      parts.span.style.width = (b - a) * 100 + "%";
      parts.span.classList.toggle("inverted", lo > hi);
      parts.min.style.left = lo * 100 + "%";
      parts.max.style.left = hi * 100 + "%";
      const own = lo + v * (hi - lo);
      parts.val.style.left = own * 100 + "%";
      const at = live === null ? own : live;
      parts.pos.style.left = at * 100 + "%";
      parts.now.textContent = "now " + pct(at);
      parts.rmin.innerHTML = "Min <b>" + pct(lo) + "</b>";
      parts.rval.innerHTML = (lo > hi ? "Max below Min, turned round: " : "") + "Row <b>" + pct(v) + "</b> of the way from Min to Max";
      parts.rmax.innerHTML = "Max <b>" + pct(hi) + "</b>";
    } else {            // discrete
      const at = live === null ? v : live;
      const picked = Math.round(at * (parts.n - 1));
      parts.choices.forEach((tr, i) => tr.classList.toggle("now", i === picked));
      parts.now.textContent = parts.names[picked] !== undefined ? parts.names[picked] : "";
    }
  }

  function render(view, st) {
    const box = view.lpBox;
    if (!box) return;
    view.lpState = st;
    const info = parse(st);
    const byRow = new Map(((info && info.rows) || []).map((x) => [x.row, x]));
    if (!view.lpCards) view.lpCards = [];
    for (let r = 0; r < ROWS; ++r) {
      const i = byRow.get(r);
      // The structure only changes when the report does (or the channel, for the text of an unmapped card).
      const sig = JSON.stringify([i ? [i.kind, i.name, i.items, i.min, i.max] : null, i ? 0 : channelOf(view)]);
      let c = view.lpCards[r];
      if (!c || c.sig !== sig) {
        const parts = build(view, r, i);
        parts.sig = sig;
        if (c) box.replaceChild(parts.card, c.card);
        else box.appendChild(parts.card);
        view.lpCards[r] = c = parts;
      }
      update(view, r, c, st);
    }
  }

  BleepViews.register("live-params", {
    width: 560,
    top: true,
    template: `<style>${CSS}</style><div class="lp"></div>`,
    // The controls are drawn in the cards; the node's knobs stay its parameters (and the CV inputs are its jacks).
    hideParams: ["channel", ...Array.from({ length: ROWS }, (_, r) => ["v", "lo", "hi"].map((p) => p + (r + 1))).flat()],
    afterBuild(view, el0) {
      view.lpBox = el0.querySelector(".lp");
      // The Channel menu: top right corner of the view. The description makes room for it.
      const p = spec(view, "channel");
      const top = el("label", "lp-top");
      top.appendChild(document.createTextNode("Channel"));
      const sel = el("select");
      for (let c = p.min; c <= p.max; ++c) sel.appendChild(Object.assign(el("option"), { value: String(c), textContent: String(c) }));
      sel.addEventListener("change", () => {
        view.api.beginGesture();
        set(view, "channel", (parseInt(sel.value, 10) - p.min) / (p.max - p.min));
        render(view, view.lpState || null);
      });
      top.appendChild(sel);
      view.root.style.position = "relative";
      view.root.appendChild(top);
      const description = view.root.querySelector(".bv-description");
      if (description) description.style.paddingRight = "130px";
      view.lpChannel = sel;
      syncChannel(view);
      render(view, null);
    },
    onState(st, view) { syncChannel(view); render(view, st); },
    onRefresh(view) { syncChannel(view); render(view, view.lpState || null); },
  });
})();
