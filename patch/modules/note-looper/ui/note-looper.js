// SPDX-License-Identifier: GPL-3.0-or-later
// Note Looper view (doc/note-looper.md): the loop as a piano-roll strip. Bars
// and beats are the grid, every recorded note a bar at its pitch, a later
// layer drawn paler; the head runs across it and the strip's frame glows red
// while it records.
(function () {
  "use strict";
  const F = 5;  // start, length, note, velocity, layer per note
  const knob = (view, id) => view.units(id);

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st || {}, arr = (st.arrays && st.arrays.notes) || [];
    const loop = st.loop || knob(view, "bars") * knob(view, "beatsperbar"), perBar = knob(view, "beatsperbar");
    const padL = 22, pw = w - padL - 4, top = 4, ph = h - 8;
    let lo = 127, hi = 0, maxLayer = 0;
    for (let i = 0; i + F <= arr.length; i += F) { lo = Math.min(lo, arr[i + 2]); hi = Math.max(hi, arr[i + 2]); maxLayer = Math.max(maxLayer, arr[i + 4]); }
    if (lo > hi) { lo = 55; hi = 72; }
    lo = Math.max(0, lo - 2); hi = Math.min(127, Math.max(hi + 2, lo + 11));
    const rows = hi - lo + 1, rh = ph / rows;
    // pitch rows: black keys darker
    for (let n = lo; n <= hi; n++) {
      const y = top + (hi - n) * rh, black = [1, 3, 6, 8, 10].includes(n % 12);
      g.fillStyle = th.line; g.globalAlpha = black ? 0.35 : 0.12; g.fillRect(padL, y, pw, rh);
      if (n % 12 === 0) { g.globalAlpha = 1; g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "right"; g.fillText("C" + (n / 12 - 1), padL - 3, y + rh - 1); }
    }
    g.globalAlpha = 1;
    // beats and bars
    for (let b = 0; b <= loop + 1e-6; b++) {
      const x = Math.round(padL + (b / loop) * pw) + 0.5, bar = b % perBar === 0;
      g.strokeStyle = th.line; g.globalAlpha = bar ? 1 : 0.4; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + ph); g.stroke();
    }
    g.globalAlpha = 1;
    // notes (a note crossing the end wraps to the start)
    for (let i = 0; i + F <= arr.length; i += F) {
      const s = arr[i], len = arr[i + 1], n = arr[i + 2], v = arr[i + 3], layer = arr[i + 4];
      if (s >= loop) continue;
      const y = top + (hi - n) * rh;
      g.fillStyle = th.accent; g.globalAlpha = (0.35 + 0.65 * v) * (layer === maxLayer ? 1 : 0.55);
      const x0 = padL + (s / loop) * pw, x1 = padL + (Math.min(s + len, loop) / loop) * pw;
      g.fillRect(x0, y + 0.5, Math.max(2, x1 - x0), Math.max(2, rh - 1));
      if (s + len > loop) g.fillRect(padL, y + 0.5, Math.max(2, ((s + len - loop) / loop) * pw), Math.max(2, rh - 1));
    }
    g.globalAlpha = 1;
    // the head
    if (typeof st.pos === "number") {
      const x = padL + Math.min(1, st.pos) * pw;
      BleepView.glow(g, th.accent, 8);
      g.strokeStyle = th.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + ph); g.stroke();
      g.shadowBlur = 0; g.lineWidth = 1;
    }
    if (st.mode) {  // recording
      g.strokeStyle = "#f2564b"; g.lineWidth = 2; g.globalAlpha = st.mode === 1 ? 1 : 0.7;
      g.strokeRect(padL + 1, top + 1, pw - 2, ph - 2); g.globalAlpha = 1; g.lineWidth = 1;
    }
    g.fillStyle = th.muted; g.font = "10px system-ui, sans-serif"; g.textAlign = "right";
    const label = (st.mode === 1 ? "recording" : st.mode === 2 ? "overdub" : "playing") + (st.running ? "" : " · free-running");
    g.fillText(label, w - 6, top + 11);
    if (!arr.length) { g.textAlign = "center"; g.fillText("Set Mode to Record (or patch a gate into Rec) and play", padL + pw / 2, top + ph / 2); }
  }

  BleepViews.register("note-looper", {
    width: 500,
    top: true,
    template: '<div class="bv-panel"><h2>Loop</h2><canvas class="nl-roll" style="height:150px"></canvas></div>',
    partNames: ["Loop"],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
