// SPDX-License-Identifier: GPL-3.0-or-later
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
  // A pitch-class ring (C at the top): the scale as a glowing polygon, the chord inside it,
  // the root ringed, and a fading glow on the notes just played. Shared by the pitch modules.
  const pitchRing = window.BleepPitchRing || (window.BleepPitchRing = function (canvas, th, o) {
    const { g, w, h } = BleepView.fit(canvas);
    if (w < 24 || h < 24) return;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 15, TAU = Math.PI * 2;
    const P = (pc, r) => { const a = pc * Math.PI / 6 - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const has = (m, pc) => ((m >> pc) & 1) === 1;
    g.lineWidth = 1; g.strokeStyle = th.line;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.globalAlpha = 0.45; g.beginPath(); g.arc(cx, cy, R * 0.5, 0, TAU); g.stroke(); g.globalAlpha = 1;
    const poly = (mask, fill, stroke, lw, blur, r) => {
      const pcs = []; for (let i = 0; i < 12; i++) if (has(mask, i)) pcs.push(i);
      if (pcs.length < 2) return;
      g.beginPath();
      pcs.forEach((pc, i) => { const [x, y] = P(pc, r); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath();
      g.globalAlpha = fill; g.fillStyle = stroke; g.fill();
      g.globalAlpha = 1; g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = "round";
      BleepView.glow(g, stroke, blur); g.stroke(); g.shadowBlur = 0;
    };
    poly(o.scale, 0.1, th.accent, 1.5, 8, R);
    if (o.chord) poly(o.chord, 0.3, th.text, 1.5, 10, R * 0.86);
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const NM = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    for (let pc = 0; pc < 12; pc++) {
      const [x, y] = P(pc, R), heat = o.heat ? o.heat[pc] : 0, inS = has(o.scale, pc), inC = o.chord && has(o.chord, pc);
      if (heat > 0.02) {
        const gr = g.createRadialGradient(x, y, 0, x, y, 8 + 14 * heat);
        gr.addColorStop(0, th.accent); gr.addColorStop(1, "transparent");
        g.globalAlpha = heat; g.fillStyle = gr; g.beginPath(); g.arc(x, y, 8 + 14 * heat, 0, TAU); g.fill(); g.globalAlpha = 1;
      }
      g.fillStyle = inC ? th.text : inS ? th.accent : th.line;
      if (inS || inC) BleepView.glow(g, inC ? th.text : th.accent, 6);
      g.beginPath(); g.arc(x, y, inC ? 4.5 : inS ? 3.2 : 1.8, 0, TAU); g.fill(); g.shadowBlur = 0;
      if (pc === o.root) { g.strokeStyle = th.text; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 7.5, 0, TAU); g.stroke(); }
      const [lx, ly] = P(pc, R + 11);
      g.fillStyle = inS ? th.text : th.muted; g.globalAlpha = inS ? 0.9 : 0.5; g.fillText(NM[pc], lx, ly); g.globalAlpha = 1;
    }
    if (o.now != null) {  // the note sounding: a spoke from the centre
      const [x, y] = P(o.now, R);
      g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 12);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); g.shadowBlur = 0;
    }
  });
  /// Fades `heat` (12 values) by dt and lights the notes in `lit` (pitch classes).
  const heatStep = (heat, dt, lit) => {
    const f = Math.exp(-dt * 1.6);
    for (let i = 0; i < 12; i++) heat[i] *= f;
    for (const pc of lit) heat[pc] = 1;
  };
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
    layout: [
      { title: "Scale", params: ["root", "scale", "rounding"] },
      { title: "Tracking", params: ["range", "hysteresis", "glide"] },
    ],
    template:
      '<div class="bv-panel"><h2>Scale</h2>' +
      "<style>" +
      ".qz-wrap{display:flex;gap:14px;align-items:center}" +
      ".bv-panel canvas.qz-ring{width:150px;height:150px;flex:none}" +
      ".qz-main{flex:1;min-width:0}" +
      ".qz-kb{position:relative;height:96px;margin:4px 0}" +
      ".qz-kb div{position:absolute;box-sizing:border-box;border:1px solid var(--line);border-radius:0 0 3px 3px;cursor:pointer}" +
      ".qz-kb .w{top:0;height:96px;background:var(--panel-3)}" +
      ".qz-kb .b{top:0;height:58px;background:var(--panel);z-index:1}" +
      ".qz-kb .on{background:color-mix(in srgb,var(--accent) 45%,transparent)}" +
      ".qz-kb .root{box-shadow:inset 0 -4px 0 var(--accent)}" +
      ".qz-kb .now{background:var(--accent)}" +
      ".qz-name{font-size:22px;font-weight:600;min-height:28px}" +
      "</style>" +
      '<div class="qz-wrap"><canvas class="qz-ring"></canvas><div class="qz-main"><div class="qz-name"></div>' +
      '<div class="qz-kb"></div></div></div></div>',
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
      view.kb = { keys, name: el.querySelector(".qz-name"), state: null, heat: new Float32Array(12), lastNote: null, t: 0 };
      const ring = el.querySelector(".qz-ring");
      BleepView.loop(view.root, (t) => {
        const kb = view.kb, st = kb.state || {};
        const dt = kb.t ? Math.min(0.1, t - kb.t) : 0;
        kb.t = t;
        const note = typeof st.note === "number" ? mod(st.note, 12) : null;
        heatStep(kb.heat, dt, note !== null && note !== kb.lastNote ? [note] : []);
        kb.lastNote = note;
        const root = typeof st.root === "number" ? st.root : setting(view, "root");
        const m = mask(view), abs = [...Array(12).keys()].reduce((a, pc) => a | (((m >> mod(pc - root, 12)) & 1) << pc), 0);
        pitchRing(ring, BleepView.theme(view.root), { scale: abs, root: mod(root, 12), now: note, heat: kb.heat });
      });
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
