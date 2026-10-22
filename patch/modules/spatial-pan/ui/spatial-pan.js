// SPDX-License-Identifier: GPL-3.0-or-later
// Spatial Pan view: the listener from above (nose up) with the source on its
// azimuth and distance (modulation included), and a side view of elevation.
// Dragging in the top view sets azimuth and distance.
(function () {
  "use strict";

  BleepViews.register("spatial-pan", {
    width: 580,
    layout: [
      { title: "Position", params: ["azimuth", "distance", "elevation", "orbit"] },
      { title: "Space", params: ["doppler", "room", "size", "air"] },
      { title: "Listener", params: ["head", "level"] },
    ],
    template: '<div class="bv-panel" style="display:flex;gap:12px"><div style="flex:none;width:180px"><h2>Top view</h2>' +
      '<canvas class="sp-top" style="width:100%;height:150px;cursor:crosshair"></canvas></div>' +
      '<div style="flex:none;width:120px"><h2>Elevation</h2><canvas class="sp-side" style="width:100%;height:150px"></canvas></div></div>',
    afterBuild(view, el) {
      const c = el.querySelector(".sp-top");
      const move = (e) => {
        const r = c.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2, y = r.height / 2 - (e.clientY - r.top);
        const az = Math.atan2(x, y) * 180 / Math.PI;
        const rad = Math.min(1, Math.hypot(x, y) / (Math.min(r.width, r.height) / 2 - 8));
        view.node.params.azimuth = (az + 180) / 360;
        view.node.params.distance = rad;
        view.api.setParam("azimuth", view.node.params.azimuth);
        view.api.setParam("distance", rad);
      };
      c.addEventListener("pointerdown", (e) => {
        c.setPointerCapture(e.pointerId);
        view.api.beginGesture();
        move(e);
        c.onpointermove = move;
      });
      c.addEventListener("pointerup", () => (c.onpointermove = null));
    },
    onState(st, view) {
      const th = BleepView.theme(view.root);
      const az = (view.value(st, "azimuth") * 360 - 180) * Math.PI / 180;
      const dist = view.value(st, "distance"), el = (view.value(st, "elevation") * 180 - 90) * Math.PI / 180;
      const top = view.root.querySelector(".sp-top");
      if (top && top.clientWidth) {
        const { g, w, h } = BleepView.fit(top);
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8;
        g.strokeStyle = th.line; g.globalAlpha = 0.6;
        for (const f of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * f, 0, 6.2832); g.stroke(); }
        g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = th.text; g.beginPath(); g.arc(cx, cy, 9, 0, 6.2832); g.fill();
        g.beginPath(); g.moveTo(cx - 3, cy - 8); g.lineTo(cx, cy - 15); g.lineTo(cx + 3, cy - 8); g.fill();
        const sx = cx + Math.sin(az) * dist * R, sy = cy - Math.cos(az) * dist * R;
        g.strokeStyle = th.accent; g.globalAlpha = 0.4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(sx, sy); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = th.accent; BleepView.glow(g, th.accent, 10); g.beginPath(); g.arc(sx, sy, 6, 0, 6.2832); g.fill(); g.shadowBlur = 0;
      }
      const side = view.root.querySelector(".sp-side");
      if (side && side.clientWidth) {
        const { g, w, h } = BleepView.fit(side);
        const cx = w * 0.35, cy = h / 2, R = h / 2 - 10;
        g.strokeStyle = th.line; g.globalAlpha = 0.6; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); g.stroke();
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R, cy); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = th.text; g.beginPath(); g.arc(cx, cy, 7, 0, 6.2832); g.fill();
        const sx = cx + Math.cos(el) * R, sy = cy - Math.sin(el) * R;
        g.fillStyle = th.accent; BleepView.glow(g, th.accent, 10); g.beginPath(); g.arc(sx, sy, 6, 0, 6.2832); g.fill(); g.shadowBlur = 0;
      }
    },
  });
})();
