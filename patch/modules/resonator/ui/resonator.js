// SPDX-License-Identifier: GPL-3.0-only
// Resonator view: the active voice's modes (Modal) or strings (Sympathetic)
// as lines on a log frequency axis (height = amplitude, brightness = what is
// still ringing), or the string with its excitation point and two pickups
// (String); and four dots for the voices (filled = ringing, ring = active).
(function () {
  "use strict";
  const choice = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round((view.node.params[id] ?? p.default) * (p.steps - 1));
  };

  const canvas = (c) => BleepView.fit(c);

  BleepViews.register("resonator", {
    width: 690,
    layout: [
      { title: "Body", params: ["model", "modes", "polyphony"] },
      { title: "Tuning", params: ["frequency", "structure"] },
      { title: "Tone", params: ["brightness", "damping", "position"] },
      { title: "Excitation", params: ["exciter", "inputgain"] },
      { title: "Strum / Output", params: ["strumsource", "seed", "width", "dry"] },
    ],
    template:
      '<div class="bv-panel"><h2>Body</h2><canvas class="res-body" style="height:88px"></canvas>' +
      '<canvas class="res-voices" style="height:14px;margin-top:4px"></canvas></div>',
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const accent = th.accent, line = th.line, text = th.text;
      const arrays = (st && st.arrays) || {};
      const model = choice(view, "model");  // 0 Modal, 1 Sympathetic, 2 String
      const body = view.root.querySelector(".res-body");
      if (body && body.clientWidth) {
        const { g, w, h } = canvas(body);
        if (model === 2) {
          // The string, its excitation point and the two pickups.
          const pos = view.value(st, "position");
          const y = h / 2, x0 = 8, x1 = w - 8, at = (p) => x0 + (x1 - x0) * p;
          const energy = (st && st["voiceEnergy" + (((st && st.active) || 0) + 1)]) || 0;
          const level = st && "active" in st ? Math.min(1, energy * 4) : 0.5 + 0.4 * Math.sin(performance.now() / 180);
          g.strokeStyle = accent; g.lineWidth = 2;
          BleepView.glow(g, accent, 10);
          g.beginPath();
          for (let x = x0; x <= x1; x++) {
            const u = (x - x0) / (x1 - x0);
            const yy = y - Math.sin(Math.PI * u) * level * (h / 2 - 6);
            x === x0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
          }
          g.stroke(); g.lineWidth = 1; g.shadowBlur = 0;
          g.fillStyle = line;
          g.fillRect(x0 - 3, y - 10, 3, 20); g.fillRect(x1, y - 10, 3, 20);
          const marker = (p, label) => {
            const x = at(p);
            g.strokeStyle = text; g.setLineDash([2, 3]);
            g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - 12); g.stroke(); g.setLineDash([]);
            g.fillStyle = text; g.font = "9px sans-serif"; g.textAlign = "center";
            g.fillText(label, x, h - 2);
          };
          marker(pos, "excite / L");
          marker(1 - pos, "R");
        } else if (!(arrays.modeHz && arrays.modeHz.length)) {
          // No live modes: the partials the knobs describe (Frequency = f0, Structure stretches them,
          // Position notches the ones with a node at the strike point, Brightness tilts the amplitudes).
          g.strokeStyle = line; g.globalAlpha = 0.5;
          g.beginPath(); g.moveTo(0, h - 2); g.lineTo(w, h - 2); g.stroke(); g.globalAlpha = 1;
          const f0 = 261.6 * Math.pow(2, view.units("frequency") / 12 + (view.value(st, "frequency") * 96 - 48 - view.units("frequency")) / 12);
          const str = view.value(st, "structure"), br = view.value(st, "brightness"), dm = view.value(st, "damping"), pos = view.value(st, "position");
          const x = (hz) => (Math.log(Math.max(hz, 16) / 16) / Math.log(20000 / 16)) * w, t = performance.now() / 1000;
          g.strokeStyle = accent; g.lineWidth = model === 1 ? 3 : 2;
          for (let n = 1; n <= 40; n++) {
            const hz = f0 * Math.pow(n, 1 + 0.5 * str) * (1 + 0.02 * str * n);
            if (hz > 20000) break;
            const a = Math.pow(n, -(2.4 - 2 * br)) * Math.abs(Math.sin(Math.PI * n * pos)) * 1.4;
            if (a < 0.01) continue;
            const ring = Math.exp(-n * dm * 0.35) * (0.8 + 0.2 * Math.sin(t * 2 + n));
            g.globalAlpha = 0.25 + 0.75 * ring;
            BleepView.glow(g, accent, 8);
            const xx = x(hz);
            g.beginPath(); g.moveTo(xx, h - 2); g.lineTo(xx, h - 2 - Math.min(1, a) * (h - 8)); g.stroke();
          }
          g.shadowBlur = 0; g.globalAlpha = 1; g.lineWidth = 1;
        } else if (arrays.modeHz && arrays.modeHz.length) {
          g.strokeStyle = line;
          g.beginPath(); g.moveTo(0, h - 2); g.lineTo(w, h - 2); g.stroke();
          const x = (hz) => (Math.log(Math.max(hz, 16) / 16) / Math.log(20000 / 16)) * w;
          const maxAmp = Math.max(...arrays.modeAmp, 1e-6);
          const maxLevel = Math.max(...arrays.modeLevel, 1e-6);
          g.lineWidth = model === 1 ? 3 : 2;
          g.strokeStyle = accent;
          for (let k = arrays.modeHz.length - 1; k >= 0; k--) {
            const a = arrays.modeAmp[k] / maxAmp;
            if (a < 0.002) continue;
            const ringing = Math.min(1, arrays.modeLevel[k] / maxLevel);
            g.globalAlpha = 0.25 + 0.75 * Math.sqrt(ringing);
            const xx = x(arrays.modeHz[k]);
            BleepView.glow(g, accent, 8);
            g.beginPath(); g.moveTo(xx, h - 2); g.lineTo(xx, h - 2 - a * (h - 6)); g.stroke();
          }
          g.shadowBlur = 0; g.globalAlpha = 1; g.lineWidth = 1;
        }
      }
      const dots = view.root.querySelector(".res-voices");
      if (dots && dots.clientWidth) {
        const { g, h } = canvas(dots);
        const poly = [1, 2, 4][choice(view, "polyphony")] || 1;
        const active = (st && st.active) || 0;
        for (let v = 0; v < 4; v++) {
          const x = 8 + v * 16, r = h / 2 - 2;
          const ringing = ((st && st["voiceEnergy" + (v + 1)]) || 0) > 1e-5;
          g.globalAlpha = v < poly ? 1 : 0.3;
          g.beginPath(); g.arc(x, h / 2, r, 0, Math.PI * 2);
          if (ringing) { g.fillStyle = accent; g.fill(); }
          g.strokeStyle = v === active ? text : line; g.lineWidth = v === active ? 2 : 1; g.stroke();
        }
        g.globalAlpha = 1; g.lineWidth = 1;
      }
    },
  });
})();
