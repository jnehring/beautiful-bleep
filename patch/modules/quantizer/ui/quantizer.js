// SPDX-License-Identifier: MIT
// Quantizer view (doc/specs/modules/quantizer.md §5): a one-octave keyboard
// showing the scale and the current note. Clicking a key edits the scale:
// the shown scale is copied into the Custom mask (node data) first, so any
// scale is a starting point.
(function () {
  "use strict";
  // Same order and notes as patch/common/dsp/Scales.h; index 17 is Custom.
  const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
    [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
    [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 3, 7, 8],
  ];
  const CUSTOM = SCALES.length;
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const BLACK = [1, 3, 6, 8, 10];
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const mod = (a, m) => ((a % m) + m) % m;
  const maskOf = (notes) => notes.reduce((m, k) => m | (1 << k), 0);

  function setting(view, id) {
    const p = view.type.params.find((x) => x.id === id);
    const v = view.node.params[id] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  /// The scale shown, relative to the root (bit k = k semitones above it).
  function mask(view) {
    const scale = setting(view, "scale");
    if (scale < CUSTOM) return maskOf(SCALES[scale]);
    const m = view.node.data && view.node.data.customMask;
    return typeof m === "number" ? m & 0xfff : maskOf(SCALES[1]);
  }

  function toggle(view, pitchClass, root) {
    const m = mask(view) ^ (1 << mod(pitchClass - root, 12));
    view.api.beginGesture();
    if (setting(view, "scale") !== CUSTOM) {
      view.node.params.scale = 1;  // the last choice: Custom
      view.api.setParam("scale", 1);
      const s = view.settings.get("scale");
      if (s) s.draw();
    }
    view.node.data = { customMask: m };
    view.api.setData({ customMask: m });
    draw(view);
  }

  function draw(view) {
    const kb = view.kb;
    if (!kb) return;
    const st = kb.state || {};
    const root = typeof st.root === "number" ? st.root : setting(view, "root");
    const m = mask(view);
    const note = typeof st.note === "number" ? st.note : null;
    for (const [pc, key] of kb.keys) {
      key.classList.toggle("on", ((m >> mod(pc - root, 12)) & 1) === 1);
      key.classList.toggle("root", pc === root);
      key.classList.toggle("now", note !== null && mod(note, 12) === pc);
    }
    kb.name.textContent = note === null ? "" : NAMES[mod(note, 12)] + (Math.floor((60 + note) / 12) - 1);
  }

  BleepViews.register("quantizer", {
    top: true,
    template:
      '<div class="bv-panel"><h2>Scale</h2>' +
      "<style>" +
      ".qz-kb{position:relative;height:64px;margin:4px 0}" +
      ".qz-kb div{position:absolute;box-sizing:border-box;border:1px solid var(--line);border-radius:0 0 3px 3px;cursor:pointer}" +
      ".qz-kb .w{top:0;height:64px;background:var(--panel-3)}" +
      ".qz-kb .b{top:0;height:38px;background:var(--panel);z-index:1}" +
      ".qz-kb .on{background:color-mix(in srgb,var(--accent) 45%,transparent)}" +
      ".qz-kb .root{box-shadow:inset 0 -4px 0 var(--accent)}" +
      ".qz-kb .now{background:var(--accent)}" +
      ".qz-name{font-size:12px;color:var(--muted);min-height:16px}" +
      "</style>" +
      '<div class="qz-kb"></div><div class="qz-name"></div></div>',
    afterBuild(view, el) {
      const box = el.querySelector(".qz-kb");
      const keys = new Map();
      const ww = 100 / WHITE.length;
      WHITE.forEach((pc, i) => {
        const k = document.createElement("div");
        k.className = "w";
        k.style.left = i * ww + "%";
        k.style.width = ww + "%";
        keys.set(pc, k);
      });
      BLACK.forEach((pc) => {
        const k = document.createElement("div");
        k.className = "b";
        const left = WHITE.indexOf(pc - 1) + 1;
        k.style.left = left * ww - ww * 0.3 + "%";
        k.style.width = ww * 0.6 + "%";
        keys.set(pc, k);
      });
      for (const [pc, k] of keys) {
        k.title = NAMES[pc];
        k.addEventListener("click", (e) => {
          e.stopPropagation();
          const st = view.kb.state || {};
          toggle(view, pc, typeof st.root === "number" ? st.root : setting(view, "root"));
        });
        box.appendChild(k);
      }
      view.kb = { keys, name: el.querySelector(".qz-name"), state: null };
      draw(view);
    },
    onState(st, view) {
      if (!view.kb) return;
      view.kb.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
