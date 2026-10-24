// SPDX-License-Identifier: GPL-3.0-only
// Drum Notes view (doc/drum-notes.md): one pad per drum with the General MIDI notes that play it;
// a pad lights up when its note arrives, brighter for a harder hit.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".dn-cv{height:120px!important}";
  document.head.appendChild(style);
  const DRUMS = [
    ["kick", "Kick", "35 36"], ["snare", "Snare", "38 40"], ["rim", "Rim", "37"], ["clap", "Clap", "39"],
    ["hat", "Closed Hat", "42 44"], ["open", "Open Hat", "46"], ["tom", "Tom", "41–50"], ["bell", "Cowbell", "56"],
    ["ride", "Ride", "51 53 59"], ["crash", "Crash", "49 52 55 57"],
  ];
  const COLS = 5;

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root);
    const gap = 6, pw = (w - gap * (COLS + 1)) / COLS, ph = (h - gap * 3) / 2;
    g.textAlign = "center";
    DRUMS.forEach(([id, name, notes], i) => {
      const x = gap + (i % COLS) * (pw + gap), y = gap + Math.floor(i / COLS) * (ph + gap);
      const f = view._flash[i];
      if (f > 0.01) view._flash[i] = f * 0.9;
      g.globalAlpha = 0.18 + 0.82 * f;
      g.fillStyle = th.accent;
      if (f > 0.05) BleepView.glow(g, th.accent, 14 * f);
      g.fillRect(x, y, pw, ph);
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      g.strokeStyle = th.line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
      g.fillStyle = th.text; g.font = "600 11px system-ui, sans-serif";
      g.fillText(name, x + pw / 2, y + ph / 2 - 1);
      g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif";
      g.fillText(notes, x + pw / 2, y + ph / 2 + 12);
    });
  }

  BleepViews.register("drum-notes", {
    width: 420,
    template: '<div class="bv-panel"><h2>Drums</h2><canvas class="dn-cv"></canvas></div>',
    layout: [],
    afterBuild(view, custom) {
      view._flash = new Float32Array(DRUMS.length);
      view._hits = new Array(DRUMS.length).fill(null);
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) {
      if (!st || !view._flash) return;
      DRUMS.forEach(([id], i) => {
        const n = st["hits_" + id];
        if (n === undefined) return;
        if (view._hits[i] !== null && n !== view._hits[i]) view._flash[i] = Math.max(0.35, st.velocity || 1);
        view._hits[i] = n;
      });
    },
  });
})();
