// SPDX-License-Identifier: MIT
// LFO view: one cycle of the current wave (Pulse Width and Phase applied)
// and a dot that follows the live phase. Mirrors LfoDsp::value.
(function () {
  "use strict";
  const rnd = (k) => { const x = Math.sin(k * 12.9898 + 4.1) * 43758.5453; return 2 * (x - Math.floor(x)) - 1; };  // preview only
  function value(wave, p, pw, cycle) {
    switch (wave) {
      case 1: return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      case 2: return 2 * p - 1;
      case 3: return 1 - 2 * p;
      case 4: return p < pw ? 1 : -1;
      case 5: return rnd(cycle);
      case 6: { const k = 0.5 - 0.5 * Math.cos(p * Math.PI); return (1 - k) * rnd(cycle) + k * rnd(cycle + 1); }
      default: return Math.sin(p * 2 * Math.PI);
    }
  }
  const choice = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round((view.node.params[id] ?? p.default) * (p.steps - 1));
  };

  BleepViews.register("lfo", {
    template: '<div class="bv-panel"><h2>Wave</h2><canvas class="lfo-wave" style="height:64px"></canvas></div>',
    onState(st, view) {
      const c = view.root.querySelector(".lfo-wave");
      if (!c || !c.clientWidth) return;
      const wave = choice(view, "wave"), unipolar = choice(view, "polarity") === 1;
      const pw = 0.05 + 0.9 * view.value(st, "pw"), offset = view.value(st, "phase");
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const css = getComputedStyle(view.root);
      const y = (v) => {
        const u = unipolar ? 0.5 + 0.5 * v : v;
        return unipolar ? h - 4 - u * (h - 8) : h / 2 - u * (h / 2 - 4);
      };
      g.strokeStyle = css.getPropertyValue("--line");
      g.beginPath(); g.moveTo(0, y(unipolar ? -1 : 0)); g.lineTo(w, y(unipolar ? -1 : 0)); g.stroke();
      const at = (x) => { const s = x / w + offset; return value(wave, s - Math.floor(s), pw, Math.floor(s)); };
      g.strokeStyle = css.getPropertyValue("--accent");
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x++) x ? g.lineTo(x, y(at(x))) : g.moveTo(x, y(at(x)));
      g.stroke();
      if (st && typeof st.phase === "number") {
        const x = st.phase * w;
        g.fillStyle = css.getPropertyValue("--text");
        g.beginPath();
        g.arc(x, y(at(x)), 3.5, 0, Math.PI * 2);
        g.fill();
      }
    },
  });
})();
