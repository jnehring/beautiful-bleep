// SPDX-License-Identifier: GPL-3.0-only
// Room Print view: the prepared impulse response as an envelope (as the module
// built it after stretch, trim and damping), with the early/late split marked,
// and a drop target for a WAV used when Impulse is set to "Sample".
(function () {
  "use strict";

  BleepViews.register("room-print", {
    width: 860,
    layout: [
      { title: "Response", params: ["source"] },
      { title: "Wet", params: ["mix", "predelay", "balance", "width", "level"] },
      { title: "Shape", params: ["stretch", "trimstart", "trimend", "damplow", "damphigh"] },
    ],
    template: '<div class="bv-panel"><h2>Impulse response <span class="rp-info" style="float:right;font-weight:normal;text-transform:none"></span></h2>' +
      '<canvas class="rp-ir" style="width:100%;height:96px"></canvas>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><span class="rp-drop bv-drop" style="padding:2px 8px">Drop or choose a WAV</span>' +
      '<span class="rp-name" style="flex:1;color:var(--muted)"></span></div></div>',
    afterBuild(view, el) {
      const drop = el.querySelector(".rp-drop");
      view.rp = { name: el.querySelector(".rp-name"), info: el.querySelector(".rp-info") };
      BleepView.mediaDrop(drop, view.api, (r) => {
        const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
        view.api.beginGesture();
        view.node.data = { ...d, clip: r.id, name: r.name || "" };
        view.api.setData(JSON.parse(JSON.stringify(view.node.data)));
        // choose "Sample" so the new file is heard
        view.node.params.source = 1;
        view.api.setParam("source", 1);
      }, (msg) => (view.rp.name.textContent = msg));
    },
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
      view.rp.name.textContent = d.name ? "Sample: " + d.name : "Sample: none";
      if (st && st.missing) view.rp.name.textContent += " (file not found in the media folder)";
      view.rp.info.textContent = st && st.seconds ? st.seconds.toFixed(2) + " s" : "";
      const c = view.root.querySelector(".rp-ir");
      if (!c || !c.clientWidth) return;
      const { g, w, h } = BleepView.fit(c);
      const peaks = (st && st.arrays && st.arrays.ir) || [];
      const n = peaks.length / 2;
      g.strokeStyle = th.line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.globalAlpha = 1;
      if (!n) return;
      const max = Math.max(1e-6, ...peaks.map(Math.abs));
      g.fillStyle = th.accent; g.globalAlpha = 0.85;
      for (let i = 0; i < n; i++) {
        const x = i / n * w, lo = peaks[2 * i] / max, hi = peaks[2 * i + 1] / max;
        g.fillRect(x, h / 2 - hi * (h / 2 - 3), Math.max(1, w / n - 0.5), Math.max(1, (hi - lo) * (h / 2 - 3)));
      }
      g.globalAlpha = 1;
      // the early/late boundary (about 60–120 ms) on the time axis of this response
      const secs = st.seconds || 0;
      if (secs > 0.12) {
        g.strokeStyle = th.text; g.globalAlpha = 0.4; g.setLineDash([3, 3]);
        for (const t of [0.06, 0.12]) { const x = t / secs * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        g.setLineDash([]); g.globalAlpha = 1;
      }
    },
  });
})();
