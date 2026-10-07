// SPDX-License-Identifier: MIT
// demo.js — a fake backend so the module UI runs in a plain browser
// (python3 -m http.server in this folder). Inactive inside a plugin.
(function () {
  "use strict";
  if (window.__JUCE__) return;
  const listeners = {};
  const values = { rise: 0.45, fall: 0.5, shape: 0.5, spread: 0, cycle: 1, sync: 0 };
  const module = {
    product: "Function", vendor: "Brilliant Bleep", colour: "#4fd1c5", name: "Bass Wobble",
    uid: "00c0ffee00c0ffee", status: "Demo mode (no plugin host)",
    params: [
      { id: "rise", name: "Rise", kind: "float", default: 0.45, steps: 0, input: "Rise" },
      { id: "fall", name: "Fall", kind: "float", default: 0.45, steps: 0, input: "Fall" },
      { id: "shape", name: "Shape", kind: "float", default: 0.5, steps: 0, input: "Shape" },
      { id: "spread", name: "Spread", kind: "float", default: 0, steps: 0, input: "Spread" },
      { id: "cycle", name: "Cycle", kind: "bool", default: 1, steps: 2 },
      { id: "sync", name: "Sync", kind: "choice", default: 0, steps: 10,
        choices: ["Free", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars", "8 bars"] },
    ],
    inputs: [{ name: "Trig", type: "gate" }],
    outputs: ["A", "B", "C", "D"].map((n) => ({ name: n, type: "control", bipolar: false }))
      .concat([{ name: "EOC", type: "trigger", bipolar: false }]),
  };
  const sources = [
    { uid: "1111222233334444", output: "Out", owner: "Random", track: "Drums", type: "control", self: false },
    { uid: "00c0ffee00c0ffee", output: "A", owner: "Bass Wobble", track: "Bass", type: "control", self: true },
  ];
  const connections = { Shape: [{ uid: "1111222233334444", output: "Out", amount: 0.3, present: true }] };
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  let t = 0;
  setInterval(() => {
    t += 1 / 30;
    const params = {}, mods = {};
    for (const p of module.params) params[p.id] = { v: values[p.id], text: values[p.id].toFixed(2) };
    mods.shape = { v: Math.min(1, Math.max(0, values.shape + 0.3 * Math.sin(t * 2))), active: true };
    const ph = (t * 0.7) % 1;
    const tri = (x) => (x < 0.5 ? x * 2 : 2 - x * 2);
    emit("state", { params, mods, inputs: { Trig: false },
      outputs: { A: tri(ph), B: tri((ph + 0.25) % 1), C: tri((ph + 0.5) % 1), D: tri((ph + 0.75) % 1), EOC: ph < 0.03 ? 1 : 0 } });
  }, 1000 / 30);
  window.BleepDemo = {
    listen: (e, f) => (listeners[e] = listeners[e] || []).push(f),
    call(name, a) {
      switch (name) {
        case "describe": return module;
        case "sources": return sources;
        case "connections": return connections;
        case "setParam": values[a[0]] = a[1]; return null;
        case "setName": module.name = a[0]; return a[0];
        case "connect": connections[a[0]] = [{ uid: a[1], output: a[2], amount: a[3], present: true }];
          setTimeout(() => emit("patch", { connections })); return "ok";
        case "setAmount": if (connections[a[0]]) connections[a[0]][0].amount = a[3]; return null;
        case "disconnect": delete connections[a[0]]; setTimeout(() => emit("patch", { connections })); return null;
        default: return null;
      }
    },
  };
})();
