// SPDX-License-Identifier: GPL-3.0-or-later
// OSC Bridge view (doc/specs/modules/osc-bridge.md §5): a status line (port, how many messages came and
// went, the newest message), the six receive lanes (address pattern, argument, mode, range) with a Learn
// button that takes the newest message's address, the six send lanes, and the host to send to. The lanes live
// in the node's data.
(function () {
  "use strict";
  const LANES = 6;
  const RX_MODES = ["Value", "Gate", "Trigger"], TX_MODES = ["Value", "Gate", "Trigger"];
  const STATUS = ["Off", "Listening", "Could not open the port (is it in use?)", "Another OSC Bridge has the port"];

  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    const rx = Array.isArray(d.receive) ? d.receive : [], tx = Array.isArray(d.send) ? d.send : [];
    const out = { host: typeof d.host === "string" ? d.host : "127.0.0.1", receive: [], send: [] };
    for (let i = 0; i < LANES; i++) {
      out.receive.push({ pattern: "/bleep/in/" + (i + 1), arg: 0, mode: 0, lo: 0, hi: 1, bipolar: 0, smooth: 0.01, ...(rx[i] || {}) });
      out.send.push({ address: "/bleep/out/" + (i + 1), mode: 0, lo: 0, hi: 1, bipolar: 0, rate: 50, ...(tx[i] || {}) });
    }
    return out;
  }
  function commit(view, d) {
    view.node.data = d;
    view.api.setData(JSON.parse(JSON.stringify(d)));
  }
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function text(view, value, onChange, cls, title) {
    const i = el("input", cls);
    i.type = "text";
    i.value = value;
    i.title = title || "";
    i.spellcheck = false;
    i.addEventListener("change", () => onChange(i.value.trim()));
    return i;
  }
  function number(view, value, onChange, step) {
    const i = el("input", "ob-num");
    i.type = "number";
    i.value = String(value);
    i.step = step || "any";
    i.addEventListener("change", () => { const v = parseFloat(i.value); if (isFinite(v)) onChange(v); });
    return i;
  }
  function select(view, list, value, onChange) {
    const s = el("select");
    list.forEach((t, i) => { const o = el("option", "", t); o.value = String(i); s.appendChild(o); });
    s.value = String(value);
    s.addEventListener("change", () => onChange(parseInt(s.value, 10)));
    return s;
  }

  function build(view) {
    const ob = view.ob;
    const d = data(view);
    ob.rx.replaceChildren();
    ob.tx.replaceChildren();
    const edit = (fn, rebuild) => { view.api.beginGesture(); const nd = data(view); fn(nd); commit(view, nd); if (rebuild) build(view); };
    d.receive.forEach((l, i) => {
      const row = el("div", "ob-row");
      row.appendChild(el("span", "ob-n", String(i + 1)));
      row.appendChild(text(view, l.pattern, (v) => edit((nd) => { nd.receive[i].pattern = v; }), "ob-addr", "Address pattern: ? * [a-z] {a,b}"));
      const learn = el("button", "", "Learn");
      learn.type = "button";
      learn.title = "Take the address of the newest message";
      learn.addEventListener("click", () => { if (ob.last) edit((nd) => { nd.receive[i].pattern = ob.last; }, true); });
      row.appendChild(learn);
      row.appendChild(select(view, ["Arg 1", "Arg 2", "Arg 3", "Arg 4"], l.arg, (v) => edit((nd) => { nd.receive[i].arg = v; })));
      row.appendChild(select(view, RX_MODES, l.mode, (v) => edit((nd) => { nd.receive[i].mode = v; }, true)));
      if (l.mode === 0) {
        row.appendChild(number(view, l.lo, (v) => edit((nd) => { nd.receive[i].lo = v; })));
        row.appendChild(el("span", "ob-to", "→"));
        row.appendChild(number(view, l.hi, (v) => edit((nd) => { nd.receive[i].hi = v; })));
        row.appendChild(select(view, ["0…1", "−1…+1"], l.bipolar ? 1 : 0, (v) => edit((nd) => { nd.receive[i].bipolar = v; })));
        row.appendChild(number(view, l.smooth, (v) => edit((nd) => { nd.receive[i].smooth = Math.max(0, v); }), "0.01"));
        row.appendChild(el("span", "ob-to", "s"));
      }
      ob.rx.appendChild(row);
    });
    d.send.forEach((l, i) => {
      const row = el("div", "ob-row");
      row.appendChild(el("span", "ob-n", String(i + 1)));
      row.appendChild(text(view, l.address, (v) => edit((nd) => { nd.send[i].address = v; }), "ob-addr", "Address to send to"));
      row.appendChild(select(view, TX_MODES, l.mode, (v) => edit((nd) => { nd.send[i].mode = v; })));
      row.appendChild(number(view, l.lo, (v) => edit((nd) => { nd.send[i].lo = v; })));
      row.appendChild(el("span", "ob-to", "→"));
      row.appendChild(number(view, l.hi, (v) => edit((nd) => { nd.send[i].hi = v; })));
      row.appendChild(select(view, ["0…1", "−1…+1"], l.bipolar ? 1 : 0, (v) => edit((nd) => { nd.send[i].bipolar = v; })));
      row.appendChild(number(view, l.rate, (v) => edit((nd) => { nd.send[i].rate = Math.max(1, v); }), "1"));
      row.appendChild(el("span", "ob-to", "/s"));
      ob.tx.appendChild(row);
    });
    ob.host.value = d.host;
  }

  BleepViews.register("osc-bridge", {
    partNames: ["Lanes"],
    top: true,
    width: 820,
    layout: [
      { title: "Network", params: ["active", "access", "listen", "sendport"] },
    ],
    template:
      "<style>" +
      ".ob{display:flex;flex-direction:column;gap:6px;font-size:12px}" +
      ".ob h3{margin:8px 0 2px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}" +
      ".ob-row{display:flex;gap:6px;align-items:center}" +
      ".ob-n{width:14px;color:var(--muted);text-align:right}" +
      ".ob input,.ob select{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:4px;padding:2px 4px;font:inherit}" +
      ".ob-addr{flex:1 1 180px;min-width:120px}.ob-num{width:62px}.ob-to{color:var(--muted)}" +
      ".ob-status{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".ob-status b{color:var(--text);font-weight:600}" +
      ".ob-host{display:flex;gap:6px;align-items:center;color:var(--muted)}" +
      "</style>" +
      '<div class="ob"><div class="ob-status"><b class="ob-st">Off</b><span>received <b class="ob-rc">0</b></span><span>sent <b class="ob-tx">0</b></span>' +
      '<span>newest <b class="ob-last">—</b></span></div>' +
      '<div class="ob-host">Send to host <input class="ob-hostin" type="text" spellcheck="false" style="width:160px"></div>' +
      "<h3>Receive: address → signal</h3><div class='ob-rx'></div><h3>Send: signal → address</h3><div class='ob-tx2'></div></div>",
    afterBuild(view, el0) {
      view.ob = { rx: el0.querySelector(".ob-rx"), tx: el0.querySelector(".ob-tx2"), host: el0.querySelector(".ob-hostin"), last: "",
                  st: el0.querySelector(".ob-st"), rc: el0.querySelector(".ob-rc"), sent: el0.querySelector(".ob-tx"), newest: el0.querySelector(".ob-last") };
      view.ob.host.addEventListener("change", () => {
        view.api.beginGesture();
        const nd = data(view);
        nd.host = view.ob.host.value.trim() || "127.0.0.1";
        commit(view, nd);
      });
      build(view);
    },
    onState(st, view) {
      const ob = view.ob;
      if (!ob || !st) return;
      ob.st.textContent = STATUS[st.status | 0] || "";
      ob.rc.textContent = String(st.received | 0);
      ob.sent.textContent = String(st.sent | 0);
      const a = st.arrays && st.arrays.last;
      if (a && a.length > 1) {
        const z = a.indexOf(0);
        const addr = String.fromCharCode(...a.slice(0, z < 0 ? a.length : z));
        const args = a.slice(z + 1).map((v) => Number(v.toFixed(3)));
        ob.last = addr;
        ob.newest.textContent = addr + (args.length ? " " + args.join(" ") : "");
      }
    },
    onRefresh(view) { if (view.ob && !view.root.contains(document.activeElement)) build(view); },
  });
})();
