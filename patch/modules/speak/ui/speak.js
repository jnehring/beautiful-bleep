// SPDX-License-Identifier: GPL-3.0-or-later
// Speak view: the phoneme text (edited here, parsed by the module) with a
// progress bar through the sounds, and a short key to the symbols.
(function () {
  "use strict";

  BleepViews.register("speak", {
    width: 750,
    layout: [
      { title: "Voice", params: ["mode", "speed", "coarse", "fine", "formant"] },
      { title: "Character", params: ["breath", "intonation", "glide", "level"] },
    ],
    template: '<div class="bv-panel"><h2>Text <span style="float:right;font-weight:normal;text-transform:none">' +
      "' accent · : lengthen · space . pause · , - short pause · _ separator</span></h2>" +
      '<textarea class="sp-text" rows="3" spellcheck="false" maxlength="400" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:13px;resize:vertical"></textarea>' +
      '<div class="sp-bar" style="height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden"><div class="sp-fill" style="height:100%;width:0;background:currentColor"></div></div>' +
      '<div style="margin-top:6px;font-size:11px;opacity:0.75">vowels a e i o u ee oo ae uh er · nasals m n ng · l r w y · s sh f th h · z zh v dh · p t k b d g ch j</div></div>',
    afterBuild(view, el) {
      const t = el.querySelector(".sp-text");
      view.sp = { text: t, focus: false };
      t.addEventListener("focus", () => (view.sp.focus = true));
      t.addEventListener("blur", () => (view.sp.focus = false));
      t.addEventListener("change", () => {
        const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
        view.api.beginGesture();
        view.node.data = { ...d, text: t.value };
        view.api.setData(JSON.parse(JSON.stringify(view.node.data)));
      });
    },
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
      if (!view.sp.focus && typeof d.text === "string" && view.sp.text.value !== d.text) view.sp.text.value = d.text;
      const n = st ? st.count | 0 : 0, k = st ? st.segment | 0 : 0;
      const fill = view.root.querySelector(".sp-fill");
      if (fill) {
        fill.style.width = n > 0 ? ((k + 1) / n * 100).toFixed(1) + "%" : "0";
        fill.style.color = th.accent;
      }
    },
  });
})();
