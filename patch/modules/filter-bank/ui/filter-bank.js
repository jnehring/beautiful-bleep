// SPDX-License-Identifier: MIT
// Filter Bank view (doc/specs/modules/filter-bank.md §5): the ten Level knobs as
// a slider bank (drag across to draw, double-click for 0 dB), the effective
// gain of each band (after tilt, odd/even, scan and vocode) as an outline,
// live envelope meters, band frequencies (note names in Harmonic and Scale
// tuning), the scan window, and level presets. Live arrays from
// FilterBankModule::liveArrays: env, gain, freq.
(function () {
  "use strict";
  const BANDS = 10, H = 104, SLIDER = [5, 64], METER = [70, 86], LABEL = 98, WINDOW = 102;
  const E = Math.log(60 / 72) / Math.log(0.75);  // the Level knob's skew (FilterBankModule.cpp)
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const PRESETS = {
    Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    Smile: [6, 4, 2, 0, -2, -2, 0, 2, 4, 6],
    Telephone: [-60, -60, -60, -6, 0, 0, 0, -6, -60, -60],
    "Odd only": [0, -60, 0, -60, 0, -60, 0, -60, 0, -60],
    Comb: [0, 0, -60, -60, 0, 0, -60, -60, 0, 0],
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const toDb = (x) => -60 + 72 * Math.pow(clamp(x, 0, 1), E);
  const fromDb = (db) => Math.pow(clamp((db + 60) / 72, 0, 1), 1 / E);
  const id = (k) => "level" + (k + 1);

  function setting(view, pid) {
    const p = view.type.params.find((x) => x.id === pid);
    const v = view.node.params[pid] ?? p.default;
    return Math.round(p.min + v * (p.max - p.min));
  }
  function label(hz, tuning) {
    if (!(hz > 0)) return "";
    if (tuning > 0) {
      const n = Math.round(69 + 12 * Math.log2(hz / 440));
      return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
    }
    return hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + "k" : Math.round(hz) + "";
  }
  function setLevel(view, k, x) {
    x = clamp(x, 0, 1);
    view.node.params[id(k)] = x;
    view.api.setParam(id(k), x);
  }

  function draw(view) {
    const c = view.fb && view.fb.canvas;
    if (!c || !c.clientWidth) return;
    const st = view.fb.state || {}, arrays = st.arrays || {};
    c.style.height = H + "px";
    const { g, w } = BleepView.fit(c);
    if (!w) return;
    const th = BleepView.theme(view.root);
    const accent = th.accent, line = th.line, muted = th.muted || th.line, text = th.text;
    const col = w / BANDS, tuning = setting(view, "tuning");
    const sy = (x) => SLIDER[1] - clamp(x, 0, 1) * (SLIDER[1] - SLIDER[0]);
    g.strokeStyle = line;
    g.beginPath(); g.moveTo(0, sy(0.75) + 0.5); g.lineTo(w, sy(0.75) + 0.5); g.stroke();  // 0 dB
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    for (let k = 0; k < BANDS; k++) {
      const x0 = k * col + 3, bw = col - 6;
      const knob = view.node.params[id(k)] ?? view.type.params.find((p) => p.id === id(k)).default;
      const eff = view.value(st, id(k));
      const gr = g.createLinearGradient(0, sy(knob), 0, SLIDER[1]);
      gr.addColorStop(0, accent); gr.addColorStop(1, "transparent");
      g.fillStyle = gr;
      g.globalAlpha = 0.8;
      g.fillRect(x0, sy(knob), bw, SLIDER[1] - sy(knob));
      g.globalAlpha = 1;
      g.fillStyle = accent;
      BleepView.glow(g, accent, 8);
      g.fillRect(x0, sy(knob) - 1, bw, 2);
      g.shadowBlur = 0;
      if (Math.abs(eff - knob) > 0.002) {  // modulated: the value really used
        g.fillStyle = text;
        g.fillRect(x0 - 1, sy(eff) - 1, bw + 2, 2);
      }
      if (arrays.gain) {  // effective gain after tilt, odd/even, scan, vocode
        const gl = arrays.gain[k];
        const ex = gl > 0 ? fromDb(20 * Math.log10(gl)) : 0;
        g.strokeStyle = text;
        g.strokeRect(x0 + 0.5, sy(ex) + 0.5, bw - 1, Math.max(0, SLIDER[1] - sy(ex) - 1));
      }
      const env = arrays.env ? clamp(arrays.env[k], 0, 1) : 0;
      g.fillStyle = muted;
      g.globalAlpha = 0.25; g.fillRect(x0, METER[0], bw, METER[1] - METER[0]); g.globalAlpha = 1;
      g.fillStyle = text;
      g.fillRect(x0, METER[1] - env * (METER[1] - METER[0]), bw, env * (METER[1] - METER[0]));
      g.fillStyle = muted;
      g.fillText(label(arrays.freq ? arrays.freq[k] : 0, tuning), x0 + bw / 2, LABEL);
    }
    // Scan window (Width < 10).
    const width = 1 + 9 * view.value(st, "width"), scan = view.value(st, "scan");
    if (width < 9.99) {
      const flat = 0.5 * (width - 1), centre = 9 * scan, xOf = (b) => (b + 0.5) * col;
      g.strokeStyle = accent;
      g.lineWidth = 3;
      BleepView.glow(g, accent, 8);
      g.beginPath();
      g.moveTo(xOf(clamp(centre - flat - 1, -0.5, 9.5)), WINDOW);
      g.lineTo(xOf(clamp(centre + flat + 1, -0.5, 9.5)), WINDOW);
      g.stroke();
      g.shadowBlur = 0;
      g.lineWidth = 1;
    }
  }

  function attach(view, c) {
    let drag = false;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return { k: clamp(Math.floor((e.clientX - r.left) / (c.clientWidth / BANDS)), 0, BANDS - 1), y: e.clientY - r.top };
    };
    const apply = (e) => {
      const { k, y } = at(e);
      setLevel(view, k, (SLIDER[1] - y) / (SLIDER[1] - SLIDER[0]));
      draw(view);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || at(e).y > SLIDER[1] + 4) return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      view.api.beginGesture();  // one undo step per drag
      drag = true;
      apply(e);
    });
    c.addEventListener("pointermove", (e) => { if (drag) apply(e); });
    const end = () => (drag = false);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      view.api.beginGesture();
      setLevel(view, at(e).k, fromDb(0));
      draw(view);
    });
  }

  BleepViews.register("filter-bank", {
    width: 900,
    layout: [
      { title: "Tuning", params: ["tuning", "root", "scale", "spacing", "shift"] },
      { title: "Bands", params: ["q", "slope", "edgeBands"] },
      { title: "Shape", params: ["tilt", "oddEven", "scan", "width"] },
      { title: "Envelope / Vocoder", params: ["attack", "release", "vocode", "envFrom"] },
      { title: "Output", params: ["stereo", "jacks", "mix"] },
    ],
    top: true,
    hideParams: ["level1", "level2", "level3", "level4", "level5", "level6", "level7", "level8", "level9", "level10"],  // the slider bank edits them
    template: '<div class="bv-panel"><h2>Bands <select class="fb-presets" style="float:right">' +
      '<option value="">Presets…</option>' + Object.keys(PRESETS).map((n) => `<option>${n}</option>`).join("") +
      '</select></h2><canvas class="fb-bank" style="height:' + H + 'px;width:100%;cursor:ns-resize"></canvas></div>',
    afterBuild(view, el) {
      view.fb = { canvas: el.querySelector(".fb-bank"), state: null };
      attach(view, view.fb.canvas);
      const sel = el.querySelector(".fb-presets");
      sel.addEventListener("change", () => {
        const levels = PRESETS[sel.value];
        sel.value = "";
        if (!levels) return;
        view.api.beginGesture();  // the ten levels are one undo step
        levels.forEach((db, k) => setLevel(view, k, fromDb(db)));
        draw(view);
      });
    },
    onState(st, view) {
      if (view.fb) view.fb.state = st;
      draw(view);
    },
    onRefresh(view) { draw(view); },
  });
})();
