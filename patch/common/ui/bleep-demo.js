// SPDX-License-Identifier: MIT
// bleep-demo.js — a fake backend so a module UI runs in a plain browser
// (python3 tools/ui_server.py <module>). Inactive inside a plugin.
// The description comes from window.BleepModule.demo in the module's <slug>.js.
(function () {
  "use strict";
  if (window.__JUCE__) return;
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const describe = () => (window.BleepModule && window.BleepModule.demo) || null;
  const values = {};
  const connections = {};
  const sources = [
    { uid: "1111222233334444", output: "Out", owner: "Random", track: "Drums", type: "control", self: false },
    { uid: "5555666677778888", output: "A", owner: "Wobble", track: "Bass", type: "control", self: false },
  ];

  let t = 0;
  setInterval(() => {
    const m = describe();
    if (!m) return;
    t += 1 / 30;
    const params = {}, mods = {}, outputs = {}, inputs = {};
    for (const p of m.params) {
      if (!(p.id in values)) values[p.id] = p.default;
      params[p.id] = { v: values[p.id], text: values[p.id].toFixed(2) };
      const patched = p.input && connections[p.input];
      if (patched) mods[p.id] = { v: Math.min(1, Math.max(0, values[p.id] + patched[0].amount * Math.sin(t * 2))), active: true };
    }
    m.outputs.forEach((o, i) => {
      const s = Math.sin(t * 2.2 + i * 1.3);
      outputs[o.name] = o.type === "trigger" || o.type === "gate" ? (s > 0.95 ? 1 : 0) : o.bipolar ? s : 0.5 + 0.5 * s;
    });
    m.inputs.forEach((i) => (inputs[i.name] = !!connections[i.name]));
    emit("state", { params, mods, outputs, inputs });
  }, 1000 / 30);

  window.BleepDemo = {
    listen: (e, f) => (listeners[e] = listeners[e] || []).push(f),
    call(name, a) {
      const m = describe();
      switch (name) {
        case "describe": return m && Object.assign({ status: "Demo mode (no plugin host)", uid: "00c0ffee00c0ffee", name: m.product }, m);
        case "sources": return sources;
        case "connections": return connections;
        case "setParam": values[a[0]] = a[1]; return null;
        case "setName": return a[0];
        case "connect":
          connections[a[0]] = [{ uid: a[1], output: a[2], amount: a[3], present: true }];
          setTimeout(() => emit("patch", { connections }));
          return "ok";
        case "setAmount": if (connections[a[0]]) connections[a[0]][0].amount = a[3]; return null;
        case "disconnect": delete connections[a[0]]; setTimeout(() => emit("patch", { connections })); return null;
        default: return null;
      }
    },
  };
})();
