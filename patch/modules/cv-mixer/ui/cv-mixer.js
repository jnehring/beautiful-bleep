// SPDX-License-Identifier: MIT
// CV Mixer view: the four channel levels as glowing bars, how the mode combines
// them (sum, average, max, min, or a scan that crossfades neighbours at the Scan
// position: CvMixerDsp.h) and the live Out level at the right.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".cm-cv{height:106px!important}";
  document.head.appendChild(style);
  const real = (view, st, id) => {
    const p = view.type.params.find((q) => q.id === id);
    return p.min + (p.max - p.min) * view.value(st, id);
  };
  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const mode = view.units("mode"), scan = view.value(st, "scan");
    const lv = [1, 2, 3, 4].map((k) => real(view, st, "level" + k));
    const pad = 8, top = 10, bot = h - 18, mid = (top + bot) / 2, half = (bot - top) / 2;
    const barsW = w * 0.6, slot = barsW / 4, bw = Math.min(46, slot * 0.5);
    // scan weights
    const pos = scan * 3, lo = Math.min(Math.floor(pos), 2), tt = pos - lo;
    const wgt = [0, 0, 0, 0];
    if (mode === 4) { wgt[lo] = 1 - tt; wgt[lo + 1] = tt; }
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath();
    g.moveTo(pad, Math.round(mid) + 0.5); g.lineTo(w - pad, Math.round(mid) + 0.5); g.stroke();
    g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    for (let k = 0; k < 4; k++) {
      const cx = pad + slot * (k + 0.5), v = Math.max(-1, Math.min(1, lv[k] / 1)), y = mid - v * half;
      const lit = mode === 4 ? 0.25 + 0.75 * wgt[k] : 1;
      const gr = g.createLinearGradient(0, mid, 0, y);
      gr.addColorStop(0, "transparent"); gr.addColorStop(1, th.accent);
      g.globalAlpha = lit;
      g.fillStyle = gr; g.fillRect(cx - bw / 2, Math.min(mid, y), bw, Math.abs(y - mid));
      BleepView.glow(g, th.accent, 10);
      g.strokeStyle = th.accent; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - bw / 2, y); g.lineTo(cx + bw / 2, y); g.stroke();
      g.shadowBlur = 0; g.globalAlpha = 1;
      g.fillStyle = th.muted; g.fillText(`CH ${k + 1}`, cx, h - 4);
    }
    if (mode === 4) {  // the scan head between the bars
      const sx = pad + slot * (0.5 + pos);
      BleepView.glow(g, th.mod, 12); g.strokeStyle = th.mod; g.lineWidth = 2;
      g.beginPath(); g.moveTo(sx, top - 4); g.lineTo(sx, bot); g.stroke(); g.shadowBlur = 0;
    }
    // the combiner and the output
    const ox = w - pad - Math.min(70, w * 0.12), oy = mid - (view._out || 0) * half;
    const name = ["SUM", "AVERAGE", "MAX", "MIN", "SCAN"][mode] || "";
    g.fillStyle = th.text; g.font = "11px system-ui, sans-serif"; g.textAlign = "center";
    g.fillText(name, pad + barsW + (ox - pad - barsW) / 2, mid - 6);
    g.strokeStyle = th.line; g.beginPath(); g.moveTo(pad + barsW + 6, mid + 6); g.lineTo(ox - 6, mid + 6); g.stroke();
    g.beginPath(); g.moveTo(ox - 12, mid + 2); g.lineTo(ox - 6, mid + 6); g.lineTo(ox - 12, mid + 10); g.stroke();
    const ow = 22, oyc = Math.max(top, Math.min(bot, oy));
    g.fillStyle = th.accent; g.globalAlpha = 0.25; g.fillRect(ox, Math.min(mid, oyc), ow, Math.abs(oyc - mid)); g.globalAlpha = 1;
    BleepView.glow(g, th.accent, 12); g.strokeStyle = th.accent; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(ox, oyc); g.lineTo(ox + ow, oyc); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.fillText("OUT", ox + ow / 2, h - 4);
  }
  BleepViews.register("cv-mixer", {
    template: '<div class="bv-panel"><h2>Mix</h2><canvas class="cm-cv"></canvas></div>',
    layout: [
      { title: "Channels", params: ["level1", "level2", "level3", "level4"] },
      { title: "Combine", params: ["mode", "scan"] },
      { title: "Output", params: ["master", "offset", "clip"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      view._st = st;
      const o = st && st.outputs;
      if (o && typeof o.out === "number") view._out = Math.max(-1, Math.min(1, o.out));
    },
  });
})();
