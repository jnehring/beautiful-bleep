// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// live-params.js — the Live Params node's view: for each of its four rows, what the Bleep Live Link device on the node's channel has
// mapped it to (the parameter's name and whether it is continuous or discrete), and for a discrete parameter its choices and the value
// that picks each one. The knobs below are the rows' values and their Min and Max. The engine sends the device's report as text with
// the node's live state (Module::liveText, "info": {channel, rows: [{row, kind, name, current, min, max, items}]}).
(function () {
  "use strict";
  const ROWS = 4;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (v) => Math.round(Math.min(1, Math.max(0, v)) * 100) + "%";

  const CSS =
    ".lp{display:flex;flex-direction:column;gap:6px;flex:1 1 100%;font-size:12px}" +
    ".lp-row{background:var(--panel-3);border-radius:8px;padding:6px 9px;display:flex;flex-direction:column;gap:4px}" +
    ".lp-head{display:flex;align-items:baseline;gap:8px;min-width:0}" +
    ".lp-head b{font-weight:600;min-width:3.4em}" +
    ".lp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".lp-kind{font-size:10px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);border-radius:99px;padding:0 7px;color:var(--muted)}" +
    ".lp-kind.continuous{color:var(--accent);border-color:var(--accent)}" +
    ".lp-kind.discrete{color:var(--mod);border-color:var(--mod)}" +
    ".lp-note,.lp-empty{color:var(--muted);font-size:11px}" +
    ".lp-items{max-height:8.6em;overflow:auto;border-radius:6px}" +
    ".lp-items table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}" +
    ".lp-items th{position:sticky;top:0;background:var(--panel-3);text-align:left;font-size:10px;font-weight:500;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;padding:1px 6px}" +
    ".lp-items td{padding:1px 6px;border-top:1px solid var(--line)}" +
    ".lp-items td.num{text-align:right}" +
    ".lp-items tr.now td{background:var(--accent);color:#0d1014}";

  /// The device's report as the engine sends it with the node's state, or null.
  function parse(st) {
    if (!st || typeof st.info !== "string" || !st.info) return null;
    try { return JSON.parse(st.info); } catch (e) { return null; }
  }

  function channelOf(view) {
    const p = view.type.params.find((x) => x.id === "channel");
    const v = view.node.params.channel ?? (p ? p.default : 0);
    return p ? Math.round(p.min + v * (p.max - p.min)) : 1;
  }

  /// One row's card. `st`: the node's live state (the effective knob values); `info`: what the device reported for this row, or undefined.
  function card(view, r, info, st) {
    const params = view.node.params;
    const eff = (id, fallback) => {
      const e = st && st.params && st.params[id];
      return e && typeof e.e === "number" ? e.e : (params[id] ?? fallback);
    };
    const value = eff("v" + (r + 1), 0.5);
    if (!info) {
      return `<div class="lp-row"><div class="lp-head"><b>Row ${r + 1}</b><span class="lp-name lp-empty">not mapped</span></div>` +
        `<div class="lp-empty">Map a parameter in the Bleep Live Link device on channel ${channelOf(view)}, row ${r + 1}.</div></div>`;
    }
    const kind = info.kind === "discrete" ? "discrete" : "continuous";
    let body;
    if (kind === "continuous") {
      const lo = params["lo" + (r + 1)] ?? 0, hi = params["hi" + (r + 1)] ?? 1;
      const scaled = lo + Math.min(1, Math.max(0, value)) * (hi - lo);
      body = `<div class="lp-note">Moves through <b>${pct(Math.min(lo, hi))}–${pct(Math.max(lo, hi))}</b> of the parameter's range ` +
        `(Min and Max). Now at ${pct(scaled)}.</div>`;
    } else {
      const n = Math.max(2, info.items && info.items.length ? info.items.length : Math.round((info.max ?? 1) - (info.min ?? 0)) + 1);
      const names = Array.from({ length: n }, (_, i) => (info.items && info.items[i] !== undefined ? info.items[i] : String((info.min ?? 0) + i)));
      const picked = Math.round(Math.min(1, Math.max(0, value)) * (n - 1));
      const rows = names.map((name, i) => {
        const send = i / (n - 1);
        return `<tr${i === picked ? ' class="now"' : ""}><td>${i}</td><td>${esc(name)}</td><td class="num">${send.toFixed(2)}</td><td class="num">${pct(send)}</td></tr>`;
      }).join("");
      body = `<div class="lp-items"><table><tr><th>#</th><th>Choice</th><th>Send</th><th>Knob</th></tr>${rows}</table></div>` +
        `<div class="lp-note">The row's value picks the choice: send the number in <b>Send</b> (0 to 1), or set the knob to the percentage. Min and Max do not apply.</div>`;
    }
    return `<div class="lp-row"><div class="lp-head"><b>Row ${r + 1}</b><span class="lp-kind ${kind}">${kind}</span>` +
      `<span class="lp-name" title="${esc(info.name || "")}">${esc(info.name || "")}</span></div>${body}</div>`;
  }

  function render(view, st) {
    const box = view.lpBox;
    if (!box) return;
    view.lpState = st;
    const info = parse(st);
    const byRow = new Map(((info && info.rows) || []).map((x) => [x.row, x]));
    const html = Array.from({ length: ROWS }, (_, r) => card(view, r, byRow.get(r), st)).join("");
    if (html !== view.lpHtml) {   // the state arrives many times a second: touch the page only when something changed
      view.lpHtml = html;
      box.innerHTML = html;
    }
  }

  BleepViews.register("live-params", {
    width: 560,
    top: true,
    template: `<style>${CSS}</style><div class="lp"></div>`,
    layout: [
      { title: "Channel", params: ["channel"] },
      ...Array.from({ length: ROWS }, (_, r) => ({ title: "Row " + (r + 1), params: ["v" + (r + 1), "lo" + (r + 1), "hi" + (r + 1)] })),
    ],
    afterBuild(view, el) {
      view.lpBox = el.querySelector(".lp");
      render(view, null);
    },
    onState(st, view) { render(view, st); },
    onRefresh(view) { render(view, view.lpState || null); },
  });
})();
