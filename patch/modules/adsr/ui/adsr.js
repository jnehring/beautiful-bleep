// SPDX-License-Identifier: GPL-3.0-or-later
// ADSR view: the real envelope curve of the (modulated) settings: a linear
// attack, an exponential decay to the sustain level and an exponential release,
// both reaching -80 dB after their set time (AdsrDsp.h). A glowing dot follows
// the live Env output; the sustain stage has a fixed width.
(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = ".adsr-cv{height:150px!important}";
  document.head.appendChild(style);

  function real(view, st, id) {
    const p = view.type.params.find((q) => q.id === id), x = view.value(st, id);
    if (p.map === "skew") {
      const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
      return x <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(x) / skew);
    }
    return p.min + (p.max - p.min) * x;
  }
  const secs = (t) => (t < 1 ? Math.round(t * 1000) + " ms" : t.toFixed(t < 10 ? 2 : 1) + " s");
  const DECAY = Math.pow(10, -4);  // -80 dB

  function curve(view, st) {
    const a = real(view, st, "attack"), d = real(view, st, "decay"), r = real(view, st, "release");
    const s = view.value(st, "sustain");
    // stage widths: compressed with a root so a 5 ms attack and a 10 s release both show
    const wa = 0.12 + Math.sqrt(a), wd = 0.12 + Math.sqrt(d), ws = 0.9, wr = 0.12 + Math.sqrt(r);
    const tot = wa + wd + ws + wr;
    return { a, d, r, s, wa: wa / tot, wd: wd / tot, ws: ws / tot, wr: wr / tot };
  }
  /// Level at x (0..1 across the display).
  function levelAt(c, x) {
    if (x < c.wa) return x / c.wa;
    x -= c.wa;
    if (x < c.wd) return c.s + (1 - c.s) * Math.pow(DECAY, x / c.wd);
    x -= c.wd;
    if (x < c.ws) return c.s;
    x -= c.ws;
    return c.s * Math.pow(DECAY, Math.min(x / c.wr, 1)) * (x >= c.wr ? 0 : 1);
  }

  function draw(view, cv) {
    const { g, w, h } = BleepView.fit(cv);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view._st;
    const c = curve(view, st);
    const padT = 10, padB = 16, ph = h - padT - padB;
    const X = (x) => x * w, Y = (l) => padT + (1 - l) * ph;
    // stage backdrops and labels
    const bounds = [0, c.wa, c.wa + c.wd, c.wa + c.wd + c.ws, 1];
    const names = ["A", "D", "S", "R"], times = [secs(c.a), secs(c.d), Math.round(c.s * 100) + "%", secs(c.r)];
    g.font = "10px system-ui, sans-serif"; g.textAlign = "center";
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) { g.fillStyle = th.line; g.globalAlpha = 0.25; g.fillRect(X(bounds[i]), 0, X(bounds[i + 1]) - X(bounds[i]), h - padB + 2); g.globalAlpha = 1; }
      g.fillStyle = th.muted;
      g.fillText(`${names[i]}  ${times[i]}`, X((bounds[i] + bounds[i + 1]) / 2), h - 3);
    }
    g.strokeStyle = th.line; g.lineWidth = 1; g.beginPath();
    for (const l of [0.5, 1]) { g.moveTo(0, Math.round(Y(l)) + 0.5); g.lineTo(w, Math.round(Y(l)) + 0.5); }
    g.stroke();
    // the curve, filled with a gradient
    const pts = [];
    for (let x = 0; x <= w; x += 2) pts.push([x, Y(levelAt(c, x / w))]);
    const gr = g.createLinearGradient(0, padT, 0, padT + ph);
    gr.addColorStop(0, th.accent); gr.addColorStop(1, "transparent");
    g.globalAlpha = 0.28; g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, Y(0));
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(w, Y(0)); g.closePath(); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = th.accent; g.lineWidth = 2; g.lineJoin = "round";
    BleepView.glow(g, th.accent, 10);
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.shadowBlur = 0;
    // the live position: follows the Env output; stage guessed from its direction
    const o = (st && st.outputs) || {};
    const env = typeof o.env === "number" ? Math.min(Math.max(o.env, 0), 1) : 0;
    const act = typeof o.active === "number" ? o.active > 0.5 : env > 0.001;
    const m = view._m || (view._m = { stage: "I", last: 0 });
    if (!act || env < 1e-4) m.stage = "I";
    else if (env > m.last + 1e-4) m.stage = "A";
    else if (env < m.last - 1e-4) m.stage = (m.stage === "A" || m.stage === "D") && env > c.s + 0.01 ? "D" : "R";
    else if (m.stage !== "R" && Math.abs(env - c.s) < 0.02) m.stage = "S";
    m.last = env;
    if (m.stage !== "I") {
      let x;
      const peak = Math.max(env, 1e-4);
      if (m.stage === "A") x = c.wa * Math.min(env, 1);
      else if (m.stage === "D") x = c.wa + c.wd * Math.min(1, Math.log(Math.max((env - c.s) / Math.max(1 - c.s, 1e-4), DECAY)) / Math.log(DECAY));
      else if (m.stage === "S") x = c.wa + c.wd + c.ws * 0.5;
      else x = c.wa + c.wd + c.ws + c.wr * Math.min(1, Math.log(Math.max(peak / Math.max(c.s, 1e-4), DECAY)) / Math.log(DECAY));
      const px = X(x), py = Y(env);
      g.strokeStyle = th.text; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(px + 0.5, padT); g.lineTo(px + 0.5, Y(0)); g.stroke(); g.globalAlpha = 1;
      BleepView.glow(g, th.accent, 16);
      g.fillStyle = th.text; g.beginPath(); g.arc(px, py, 4.5, 0, 7); g.fill();
      g.shadowBlur = 0;
    }
  }

  BleepViews.register("adsr", {
    template: '<div class="bv-panel"><h2>Envelope</h2><canvas class="adsr-cv"></canvas></div>',
    layout: [
      { title: "Envelope", params: ["attack", "decay", "sustain", "release"] },
      { title: "Dynamics", params: ["velamount"] },
    ],
    afterBuild(view, custom) {
      const cv = custom.querySelector("canvas");
      BleepView.loop(view.root, () => draw(view, cv));
    },
    onState(st, view) { view._st = st; },
  });
})();
