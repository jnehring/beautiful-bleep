// SPDX-License-Identifier: MIT
// Bender view (doc/specs/modules/bender.md §5): with transport sync, the
// decisions of the current and the next bar (computed from the same seeded
// hash as the audio, so you see what Chance and Seed will do before it
// happens) with the playing segment marked; otherwise the recent segments.
// Below: the read head inside the source segment, and the latched Freeze
// button (node data, ORed with the gate). Glitch comes from the buttons.
(function () {
  "use strict";

  function strip(view, st) {
    const c = view.bd.canvas;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim();
    const text = css.getPropertyValue("--text").trim(), muted = css.getPropertyValue("--muted").trim();
    const arrays = st.arrays || {};
    const plan = arrays.plan || [], hist = arrays.history || [];
    const synced = st.synced > 0.5 && plan.length > 0;
    const codes = synced ? plan : hist.slice(-32);
    const n = Math.max(codes.length, 1), cw = (w - 2) / n, top = 4, bh = h - 22;
    let playing = codes.length - 1;
    if (synced && st.beats > 0) playing = Math.floor((st.ppq - 4 * Math.floor(st.ppq / 4)) / st.beats);
    for (let i = 0; i < codes.length; i++) {
      const x = 1 + i * cw, code = codes[i];
      g.strokeStyle = line;
      g.strokeRect(Math.round(x) + 0.5, top + 0.5, Math.max(1, Math.round(cw) - 1), bh);
      g.fillStyle = accent;
      g.globalAlpha = synced && i > playing ? 0.45 : 1;  // upcoming
      if (code === 1 || code === 2) g.fillRect(x + 1, top + 1, Math.max(1, cw - 2), bh - 1);
      if (code === 3) for (let k = 0; k < 3; k++) g.fillRect(x + 1 + (k * cw) / 3, top + 1, Math.max(1, cw / 3 - 2), bh - 1);
      g.globalAlpha = 1;
    }
    if (synced) {
      const x = 1 + Math.min(playing, n - 1) * cw;
      g.fillStyle = text;
      g.fillRect(x, top + bh + 3, Math.max(2, cw), 3);
      g.fillStyle = muted;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText("this bar", 2, h - 2);
      g.fillText("next bar", w / 2 + 2, h - 2);
      g.strokeStyle = text;
      g.beginPath(); g.moveTo(Math.round(w / 2) + 0.5, 0); g.lineTo(Math.round(w / 2) + 0.5, h); g.stroke();
    } else {
      g.fillStyle = muted;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "right";
      g.fillText("recent segments →", w - 2, h - 2);
    }
  }

  BleepViews.register("bender", {
    top: true,
    template:
      '<div class="bv-panel"><canvas class="bd-strip" style="height:58px"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
      '<div class="bd-src" style="flex:1;height:14px;border:1px solid var(--line);border-radius:4px;position:relative;overflow:hidden">' +
      '<div class="bd-head" style="position:absolute;top:0;bottom:0;width:2px;background:var(--accent);display:none"></div></div>' +
      '<button class="bv-button bd-freeze">◉ Freeze</button></div></div>',
    afterBuild(view, el) {
      view.bd = { canvas: el.querySelector(".bd-strip"), head: el.querySelector(".bd-head"), freeze: el.querySelector(".bd-freeze") };
      view.bd.freeze.addEventListener("click", () => {
        const d = { freezeLatched: !(view.node.data && view.node.data.freezeLatched) };
        view.node.data = d;
        view.api.setData(d);
        view.bd.freeze.classList.toggle("on", d.freezeLatched);
      });
    },
    onState(st, view) {
      if (!view.bd || !st) return;
      const latched = !!(view.node.data && view.node.data.freezeLatched);
      view.bd.freeze.classList.toggle("on", latched || st.freeze > 0.5);
      const head = st.head;
      view.bd.head.style.display = head >= 0 ? "" : "none";
      if (head >= 0) view.bd.head.style.left = (head * 100).toFixed(2) + "%";
      strip(view, st);
    },
  });
})();
