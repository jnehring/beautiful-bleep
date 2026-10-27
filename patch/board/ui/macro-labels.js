// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// macro-labels.js — the view of the nodes that have macros (Macros, Bleep Instrument Input, Bleep FX Input): a name for each macro.
//
// A label is stored in the node's data ({labels: {m1: "Morph"}}). A macro without one is named after what it modulates, "<node>
// <parameter>" (LFO Morph), or "Macro 1" when nothing is patched. The same names are the parameter names in Live (Engine::macroLabels),
// so the grey text in each field is what Live will show.
(function () {
  "use strict";
  const CSS =
    ".ml{display:grid;grid-template-columns:max-content 1fr;gap:6px 10px;align-items:center;flex:1 1 100%;font-size:12px}" +
    ".ml label{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".ml input{font:inherit;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:3px 7px}";

  const macroIds = (view) => view.type.outputs.map((o) => o.id).filter((id) => /^m\d+$/.test(id));
  const labelsOf = (view) => (view.node.data && view.node.data.labels) || {};

  /// The name a macro without a label gets.
  function autoName(view, id) {
    const targets = view.api.cablesFrom(id);
    return targets.length ? targets[0] : "Macro " + id.slice(1);
  }

  function refresh(view) {
    if (!view.mlInputs) return;
    for (const [id, input] of view.mlInputs) {
      const own = labelsOf(view)[id] || "";
      if (document.activeElement !== input && input.value !== own) input.value = own;
      const auto = autoName(view, id);
      if (input.placeholder !== auto) input.placeholder = auto;
    }
  }

  function commit(view) {
    const labels = {};
    for (const [id, input] of view.mlInputs) if (input.value.trim()) labels[id] = input.value.trim().slice(0, 40);
    view.node.data = { ...(view.node.data || {}), labels };
    view.api.beginGesture();
    view.api.setData(view.node.data);
  }

  const hooks = {
    width: 360,
    template: `<style>${CSS}</style><div class="ml"></div>`,
    afterBuild(view, el0) {
      const box = el0.querySelector(".ml");
      view.mlInputs = new Map();
      for (const id of macroIds(view)) {
        const label = document.createElement("label");
        label.textContent = "Macro " + id.slice(1);
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 40;
        input.spellcheck = false;
        input.addEventListener("change", () => commit(view));
        input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); });
        label.htmlFor = input.id = "ml-" + view.node.id + "-" + id;
        box.append(label, input);
        view.mlInputs.set(id, input);
      }
      refresh(view);
    },
    onState(st, view) { refresh(view); },
    onRefresh(view) { refresh(view); },
  };
  for (const type of ["macros", "instrument", "audio-insert"]) BleepViews.register(type, hooks);
})();
