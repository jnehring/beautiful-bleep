// SPDX-License-Identifier: MIT
// Neuron view (specs/modules/neuron.md §5): per neuron the membrane over the
// last 2 seconds with the threshold and hysteresis band, the gate as a strip
// below and a dot that flashes on each spike. Drag the threshold line to set
// Threshold. Below: which outputs the cross normals carry.
(function () {
  "use strict";
  const LO = -1.25, HI = 1.5;  // shown membrane range
  const param = (view, id) => view.type.params.find((x) => x.id === id);
  const units = (view, st, id) => { const p = param(view, id); return p.min + view.value(st, id) * (p.max - p.min); };

  function draw(view, st) {
    for (const k of ["a", "b"]) {
      const c = view.neuron[k];
      if (!c || !c.clientWidth) continue;
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const css = getComputedStyle(view.root);
      const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim();
      const muted = css.getPropertyValue("--muted").trim(), text = css.getPropertyValue("--text").trim();
      const top = 4, bottom = h - 16;
      const y = (v) => bottom - ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * (bottom - top);
      const th = units(view, st, k + "threshold"), hb = units(view, st, k + "hysteresis") * 0.25;  // h/2
      g.fillStyle = line;
      g.globalAlpha = 0.6;
      g.fillRect(0, y(th + hb), w, Math.max(1, y(th - hb) - y(th + hb)));
      g.globalAlpha = 1;
      g.strokeStyle = muted; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(0, y(th) + 0.5); g.lineTo(w, y(th) + 0.5); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(0, y(0) + 0.5); g.lineTo(w, y(0) + 0.5); g.stroke();
      const arrays = (st && st.arrays) || {};
      const m = arrays["membrane" + k.toUpperCase()], gate = arrays["gate" + k.toUpperCase()];
      if (m && m.length) {
        g.strokeStyle = accent; g.lineWidth = 1.5;
        g.beginPath();
        m.forEach((v, i) => { const x = (i / (m.length - 1)) * w; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
        g.stroke();
      }
      if (gate && gate.length) {
        g.fillStyle = accent;
        const cw = w / gate.length;
        gate.forEach((v, i) => { if (v > 0.5) g.fillRect(i * cw, h - 11, Math.ceil(cw), 8); });
      }
      const spikes = st ? st["spikes" + k.toUpperCase()] : undefined;
      if (spikes !== undefined && spikes !== view.neuron.spikes[k]) { view.neuron.flash[k] = 8; view.neuron.spikes[k] = spikes; }
      if (view.neuron.flash[k] > 0) {
        g.fillStyle = text; g.globalAlpha = view.neuron.flash[k] / 8;
        g.beginPath(); g.arc(w - 7, 9, 4, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        view.neuron.flash[k]--;
      }
      g.fillStyle = muted; g.font = "10px system-ui, sans-serif";
      g.fillText(k.toUpperCase(), 4, 12);
    }
    const cross = view.units("cross"), names = ["Out", "Gate", "Off"];
    view.neuron.cross.textContent = cross === 2 ? "no cross normals" : `A In 3 ⟵ B ${names[cross]} · B In 3 ⟵ A ${names[cross]}`;
  }

  function attach(view, canvas, k) {
    let dragging = false;
    const set = (e) => {
      const r = canvas.getBoundingClientRect(), bottom = r.height - 16, top = 4;
      const v = LO + (1 - (e.clientY - r.top - top) / (bottom - top)) * (HI - LO);
      const p = param(view, k + "threshold");
      view.api.setParam(p.id, Math.min(1, Math.max(0, (v - p.min) / (p.max - p.min))));
      view.node.params[p.id] = Math.min(1, Math.max(0, (v - p.min) / (p.max - p.min)));
      draw(view, view.neuron.state);
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      view.api.beginGesture();
      dragging = true;
      set(e);
    });
    canvas.addEventListener("pointermove", (e) => { if (dragging) set(e); });
    const end = () => (dragging = false);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  BleepViews.register("neuron", {
    top: true,
    width: 420,
    template: `<div class="bv-panel" style="flex:1 1 100%">
      <div style="display:flex;gap:8px">
        <canvas class="neuron-a" title="Membrane A: drag to set the threshold" style="flex:1;min-width:0;height:96px;cursor:ns-resize;touch-action:none"></canvas>
        <canvas class="neuron-b" title="Membrane B: drag to set the threshold" style="flex:1;min-width:0;height:96px;cursor:ns-resize;touch-action:none"></canvas>
      </div>
      <div class="neuron-cross" style="font-size:10px;color:var(--muted);text-align:center;margin-top:4px"></div>
    </div>`,
    afterBuild(view, el) {
      view.neuron = { a: el.querySelector(".neuron-a"), b: el.querySelector(".neuron-b"), cross: el.querySelector(".neuron-cross"),
                      spikes: {}, flash: { a: 0, b: 0 }, state: null };
      attach(view, view.neuron.a, "a");
      attach(view, view.neuron.b, "b");
      requestAnimationFrame(() => draw(view, null));
    },
    onState(st, view) { view.neuron.state = st; draw(view, st); },
    onRefresh(view) { draw(view, view.neuron.state); },
  });
})();
