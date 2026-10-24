// SPDX-License-Identifier: GPL-3.0-only
// Bit Formula view: the formula as text (the built-in ones are shown read-only,
// "Custom" is edited here and compiled by the module), the eight bits of the
// current byte as lamps, and the output over a few milliseconds.
(function () {
  "use strict";

  const PRESETS = [
    "t*(1+(a>>5))", "(t&255)<a ? 255 : 0", "(t>>(1+(b>>6))) * (1+(a>>5)) ^ (t>>(c>>5))", "t & (t>>(1+(a>>5))) | (t>>(b>>5))",
    "t*((t>>(1+(a>>5)))|(t>>(1+(b>>5))))&c", "t*(((t>>(a>>4))|(t>>(b>>4)))&(c>>2)&(t>>5))", "(t*t>>(a>>4)) ^ (t>>(b>>5))",
    "t*(1+((t>>(a>>4))&7)) & (128|c)", "(t*(t>>(a>>5)) ^ (t>>(b>>4))) & c", "(t>>(a>>5)) ^ (t>>(b>>5)) ^ (t>>(c>>5)) ^ t",
    "((t&255) + ((t*(1+(a>>4))>>2)&255)) >> 1 ^ (b&t>>4)", "(t&a) ^ ((t>>3)&b) ^ ((t>>6)&c)", "(t&128 ? ~t : t) * (1+(a>>6)) ^ (t>>(4+(b>>6)))",
    "((t>>(a>>5)) & (t>>(b>>5)) & 1) * c + (t&31)", "(x & (a|63)) ^ (t & b & 15) ^ (t>>4 & c & 7)", "x*(1+(a>>5)) ^ (t&b) ^ (c>>5)",
  ];

  BleepViews.register("bit-formula", {
    width: 750,
    layout: [
      { title: "Formula", params: ["formula", "a", "b", "c"] },
      { title: "Clock", params: ["rate", "bits", "smooth", "level"] },
    ],
    template: '<div class="bv-panel"><h2>Expression <span class="bf-note" style="float:right;font-weight:normal;text-transform:none"></span></h2>' +
      '<input class="bf-text" type="text" spellcheck="false" maxlength="160" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:13px">' +
      '<div style="display:flex;gap:12px;margin-top:8px"><div class="bf-bits" style="flex:none;display:flex;gap:4px;align-items:center"></div>' +
      '<canvas class="bf-scope" style="flex:1;min-width:0;height:70px"></canvas></div></div>',
    afterBuild(view, el) {
      const bits = el.querySelector(".bf-bits");
      for (let i = 7; i >= 0; i--) {
        const d = document.createElement("span");
        d.style.cssText = "width:12px;height:12px;border-radius:50%;background:var(--line)";
        bits.append(d);
      }
      const input = el.querySelector(".bf-text");
      view.bf = { input, note: el.querySelector(".bf-note"), focus: false };
      input.addEventListener("focus", () => (view.bf.focus = true));
      input.addEventListener("blur", () => (view.bf.focus = false));
      input.addEventListener("change", () => {
        const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
        view.api.beginGesture();
        view.node.data = { ...d, formula: input.value };
        view.api.setData(JSON.parse(JSON.stringify(view.node.data)));
      });
    },
    onState(st, view) {
      const a = (st && st.arrays) || {};
      const th = BleepView.theme(view.root);
      const sel = Math.round(view.value(st, "formula") * 16);
      const custom = sel >= 16;
      const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
      const input = view.bf.input;
      input.readOnly = !custom;
      input.style.opacity = custom ? "1" : "0.7";
      const text = custom ? (typeof d.formula === "string" ? d.formula : "") : PRESETS[Math.min(15, sel)];
      if (!view.bf.focus && input.value !== text) input.value = text;
      const ok = !st || st.customOk !== 0;
      if (custom && !ok) {
        const at = st.errorAt | 0;
        view.bf.note.textContent = "error near character " + (at + 1);
        view.bf.note.style.color = "#f87171";
      } else {
        view.bf.note.textContent = custom ? "t a b c x · + - * / % & | ^ ~ ! << >> < > == ?:" : "pick Custom to write your own";
        view.bf.note.style.color = "";
      }
      const byte = st ? st.byte | 0 : 0;
      view.root.querySelectorAll(".bf-bits span").forEach((s, i) => {
        const on = (byte >> (7 - i)) & 1;
        s.style.background = on ? th.accent : th.line;
        s.style.boxShadow = on ? "0 0 6px " + th.accent : "none";
      });
      const c = view.root.querySelector(".bf-scope");
      if (c && c.clientWidth && a.wave) {
        const { g, w, h } = BleepView.fit(c);
        g.strokeStyle = th.line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
        g.globalAlpha = 1; g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 8);
        g.beginPath();
        a.wave.forEach((v, i) => { const x = i / (a.wave.length - 1) * w, y = h / 2 - v * (h / 2 - 3); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
      }
    },
  });
})();
