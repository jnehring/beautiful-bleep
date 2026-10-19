// SPDX-License-Identifier: MIT
// Sampler view (doc/specs/modules/sampler.md §5): the waveform with slice markers,
// the current slice highlighted and a dot per playhead; slicing controls
// (manual, threshold, beats); per-slice settings for the selected slice; a
// drop target for WAV files. Click a slice to select it (shift-click to hear
// it), double-click to add a marker (double-click a marker to remove it), drag
// a marker to move it. Threshold detection and the tempo estimate run in the
// engine (perform "detect" / "bpm") and come back through the node's data.
(function () {
  "use strict";
  const HIT = 5;  // px around a marker
  const MODES = ["Inherit", "Gate", "To end of sample", "To end of slice", "Loop", "One-shot"];

  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    const sl = d.slicing && typeof d.slicing === "object" ? d.slicing : {};
    return {
      clip: typeof d.clip === "string" ? d.clip : "",
      length: d.length | 0,
      markers: Array.isArray(d.markers) ? d.markers.slice() : [],
      current: d.current | 0,
      slices: d.slices && typeof d.slices === "object" ? d.slices : {},
      slicing: {
        kind: sl.kind || "manual", threshold: sl.threshold ?? 0.5, minGap: sl.minGap ?? 30,
        beats: sl.beats ?? 16, bpm: sl.bpm ?? 120, bars: sl.bars ?? 4,
      },
    };
  }
  function send(view, d) {
    view.node.data = d;
    view.api.setData(JSON.parse(JSON.stringify(d)));
  }
  const total = (view) => Math.max(1, ((view.sp.state || {}).length | 0) || data(view).length);

  /// Equal divisions: `beats` slices over the file, or `bars` bars at `bpm`.
  function beatMarkers(view, fromBpm) {
    const d = data(view), st = view.sp.state || {}, n = total(view), sr = st.sampleRate || 48000;
    let step;
    if (fromBpm) step = (60 / d.slicing.bpm) * sr * 4 / Math.max(1, d.slicing.beats / d.slicing.bars);
    else step = n / d.slicing.beats;
    const out = [];
    for (let f = step; f < n - 1 && out.length < 127; f += step) out.push(Math.round(f));
    return out;
  }

  function draw(view) {
    const sp = view.sp, st = sp.state || {}, c = sp.canvas;
    const { g, w, h } = BleepView.fit(c);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), accent = th.accent, text = th.text, muted = th.muted, line = th.line;
    const panel = getComputedStyle(view.root).getPropertyValue("--panel-3").trim() || line;
    const peaks = (st.arrays && st.arrays.peaks) || [];
    const heads = (st.arrays && st.arrays.heads) || [];
    const d = data(view), len = total(view);
    const markers = sp.drag ? sp.drag.markers : ((st.arrays && st.arrays.markers) || d.markers).map(Math.round);
    const bounds = [0, ...markers, len];
    const x = (f) => (f / len) * w;
    if (!(st.length > 0)) {
      g.fillStyle = muted;
      g.font = "11px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText(st.missing > 0.5 ? "Sample missing: drop the WAV file to relink" : "No sample: drop a WAV file here", w / 2, h / 2 + 4);
      return;
    }
    const cur = Math.min(d.current, bounds.length - 2);
    for (let i = 0; i + 1 < bounds.length; i++) {
      g.fillStyle = i % 2 ? panel : line;
      g.globalAlpha = i === cur ? 1 : 0.45;
      g.fillRect(x(bounds[i]), 0, Math.max(1, x(bounds[i + 1]) - x(bounds[i])), h);
    }
    g.globalAlpha = 1;
    // the waveform: a glowing mirrored silhouette, the current slice in the accent colour
    const bw = w / Math.max(peaks.length, 1);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, muted); grad.addColorStop(0.5, text); grad.addColorStop(1, muted);
    for (let i = 0; i < peaks.length; i++) {
      const v = Math.min(1, peaks[i]) * (h / 2 - 3), fx = ((i + 0.5) / peaks.length) * len;
      const inCur = fx >= bounds[cur] && fx < bounds[cur + 1];
      g.fillStyle = inCur ? accent : grad;
      g.globalAlpha = inCur ? 0.95 : 0.7;
      g.fillRect(i * bw, h / 2 - v, Math.max(1, bw), Math.max(1, 2 * v));
    }
    g.globalAlpha = 1;
    g.fillStyle = accent;
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "left";
    BleepView.glow(g, accent, 6);
    for (let i = 0; i < markers.length; i++) g.fillRect(Math.round(x(markers[i])) - 1, 0, 2, h);
    g.shadowBlur = 0;
    if (markers.length < 64)
      for (let i = 0; i + 1 < bounds.length; i++) g.fillText(String(i + 1), x(bounds[i]) + 3, 11);
    g.fillRect(x(bounds[cur]), h - 3, Math.max(2, x(bounds[cur + 1]) - x(bounds[cur])), 3);
    g.fillStyle = text;
    BleepView.glow(g, text, 10);
    for (let i = 0; i + 1 < heads.length; i += 2) {
      g.beginPath();
      g.arc(x(heads[i]), h / 2, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
  }

  // The amplitude envelope drawn from Attack, Decay, Sustain and Release (the
  // stage widths follow the knob positions); a spark runs along it like a note.
  function envelope(view, t) {
    const c = view.sp && view.sp.env;
    if (!c) return;
    const { g, w, h } = BleepView.fit(c);
    if (!w || !h) return;
    const th = BleepView.theme(view.root), st = view.sp.state || {};
    const A = 0.1 + view.value(st, "attack"), D = 0.1 + view.value(st, "decay"), R = 0.1 + view.value(st, "release");
    const S = view.value(st, "sustain"), H = 0.6;
    const tot = A + D + H + R, L = 6, W = w - 12, top = 8, bot = h - 6;
    const px = (u) => L + (u / tot) * W, py = (v) => bot - v * (bot - top);
    const pts = [[0, 0], [A, 1], [A + D, S], [A + D + H, S], [tot, 0]];
    g.beginPath();
    g.moveTo(px(0), py(0));
    // decay and release as exponentials, attack as a rise
    for (let i = 0; i <= 60; i++) { const u = i / 60 * tot; g.lineTo(px(u), py(envAt(u, A, D, S, H, R))); }
    g.lineTo(px(tot), py(0));
    const fg = g.createLinearGradient(0, top, 0, bot);
    fg.addColorStop(0, th.accent); fg.addColorStop(1, "transparent");
    g.globalAlpha = 0.25; g.fillStyle = fg; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = th.accent; g.lineWidth = 2; BleepView.glow(g, th.accent, 8);
    g.beginPath();
    for (let i = 0; i <= 60; i++) { const u = i / 60 * tot; const X = px(u), Y = py(envAt(u, A, D, S, H, R)); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke(); g.shadowBlur = 0;
    g.strokeStyle = th.line; g.lineWidth = 1; g.setLineDash([2, 3]);
    for (const [u] of pts.slice(1, 4)) { g.beginPath(); g.moveTo(Math.round(px(u)) + 0.5, top); g.lineTo(Math.round(px(u)) + 0.5, bot); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = th.muted; g.font = "9px system-ui, sans-serif"; g.textAlign = "center";
    g.fillText("A", px(A / 2), h - 0); g.fillText("D", px(A + D / 2), h - 0); g.fillText("S", px(A + D + H / 2), h - 0); g.fillText("R", px(A + D + H + R / 2), h - 0);
    const u = ((t * 0.35) % 1) * tot * 1.0;
    g.fillStyle = th.text; BleepView.glow(g, th.text, 12);
    g.beginPath(); g.arc(px(u), py(envAt(u, A, D, S, H, R)), 3.2, 0, 6.2832); g.fill();
    g.shadowBlur = 0;
  }
  function envAt(u, A, D, S, H, R) {
    if (u < A) return u / A;
    if (u < A + D) { const k = (u - A) / D; return S + (1 - S) * (1 - k) * (1 - k) * (1 - k * 0.3) ; }
    if (u < A + D + H) return S;
    const k = (u - A - D - H) / R;
    return S * Math.max(0, (1 - k) * (1 - k));
  }

  function attach(view) {
    const sp = view.sp, c = sp.canvas;
    const frameAt = (e) => {
      const r = c.getBoundingClientRect();
      return Math.round(((e.clientX - r.left) / r.width) * total(view));
    };
    const markers = () => (((sp.state || {}).arrays || {}).markers || data(view).markers).map(Math.round);
    const markerAt = (e) => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left;
      return markers().findIndex((m) => Math.abs((m / total(view)) * r.width - px) <= HIT);
    };
    const sliceAt = (f) => markers().filter((m) => m <= f).length;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !(sp.state && sp.state.length > 0)) return;
      e.stopPropagation();
      const i = markerAt(e);
      if (i >= 0) {
        c.setPointerCapture(e.pointerId);
        view.api.beginGesture();
        sp.drag = { index: i, markers: markers() };
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (!sp.drag) { c.style.cursor = markerAt(e) >= 0 ? "ew-resize" : "pointer"; return; }
      const m = sp.drag.markers, i = sp.drag.index;
      const lo = (i > 0 ? m[i - 1] : 0) + 1, hi = (i + 1 < m.length ? m[i + 1] : total(view)) - 1;
      m[i] = Math.min(hi, Math.max(lo, frameAt(e)));
      draw(view);
    });
    const end = () => {
      if (!sp.drag) return;
      const m = sp.drag.markers;
      sp.drag = null;
      send(view, { ...data(view), markers: m });
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("click", (e) => {
      if (markerAt(e) >= 0 || !(sp.state && sp.state.length > 0)) return;
      const i = sliceAt(frameAt(e));
      view.api.beginGesture();
      send(view, { ...data(view), current: i });
      if (e.shiftKey) view.api.command("audition", data(view).slicing.kind === "x" ? -1 : i);
      slicePanel(view);
    });
    c.addEventListener("dblclick", (e) => {
      if (!(sp.state && sp.state.length > 0)) return;
      e.stopPropagation();
      view.api.beginGesture();
      const m = markers(), i = markerAt(e);
      if (i >= 0) m.splice(i, 1);
      else { m.push(frameAt(e)); m.sort((a, b) => a - b); }
      send(view, { ...data(view), markers: m, slicing: { ...data(view).slicing, kind: "manual" } });
    });
  }

  function slicePanel(view) {
    const sp = view.sp, d = data(view), cfg = d.slices[d.current] || {};
    const set = (k, v) => {
      view.api.beginGesture();
      const slices = { ...d.slices };
      slices[d.current] = { ...(slices[d.current] || {}), [k]: v };
      send(view, { ...data(view), slices });
    };
    sp.sel.textContent = "Slice " + (d.current + 1) + " of " + (d.markers.length + 1);
    sp.mode.value = String(cfg.mode ?? -1);
    sp.transpose.value = cfg.transpose ?? 0;
    sp.level.value = cfg.level ?? 1;
    sp.pan.value = cfg.pan ?? 0;
    sp.reverse.checked = !!cfg.reverse;
    sp.choke.value = String(cfg.choke ?? 0);
    sp.set = set;
  }

  function slicingPanel(view) {
    const sl = data(view).slicing;
    view.sp.kind.value = sl.kind;
    view.sp.threshold.value = sl.threshold;
    view.sp.minGap.value = sl.minGap;
    view.sp.beats.value = sl.beats;
    view.sp.bpm.value = sl.bpm;
    view.sp.bars.value = sl.bars;
    for (const row of view.root.querySelectorAll("[data-kind]")) row.style.display = row.dataset.kind === sl.kind ? "" : "none";
  }

  const field = (label, el) => '<label style="display:flex;gap:4px;align-items:center">' + label + el + "</label>";
  const num = (cls, min, max, step, w) =>
    '<input class="' + cls + '" type="number" min="' + min + '" max="' + max + '" step="' + step + '" style="width:' + (w || 56) + 'px">';

  if (!document.getElementById("sa-style")) {
    const st = document.createElement("style");
    st.id = "sa-style";
    st.textContent = ".bleep-view.sa .bv-knob{width:56px}.bleep-view.sa .bv-knob svg{width:38px;height:38px}" +
      ".bleep-view.sa .bv-sec-knobs{gap:2px 0;align-items:flex-start}.bleep-view.sa .bv-label{white-space:nowrap}.sa-beat-btns{display:flex;gap:3px;margin-top:2px}.sa-beat-btns button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:5px;font:inherit;font-size:10px;padding:0 5px;cursor:pointer}.sa-beat-btns button:hover{border-color:var(--accent)}.bleep-view.sa .bv-label{font-size:9px;letter-spacing:.04em}" +
      ".sa-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font-size:11px}" +
      ".sa-grid label{display:flex;justify-content:space-between;align-items:center;gap:4px;color:var(--muted)}" +
      ".sa-grid input,.sa-grid select,.bleep-view.sa .sa-tools input,.bleep-view.sa .sa-tools select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:5px;font:inherit;font-size:11px;padding:1px 3px}" +
      ".sa-grid input[type=number]{width:52px}.sa-grid select{width:84px}" +
      ".sa-tools button,.sa-grid button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:5px;font:inherit;font-size:11px;padding:1px 8px;cursor:pointer}" +
      ".sa-tools button:hover,.sa-grid button:hover{border-color:var(--accent)}";
    document.head.appendChild(st);
  }

  BleepViews.register("sampler", {
    partNames: ["Waveform and slices"],
    width: 900,
    layout: [
      { title: "Sample", params: ["start", "end", "position", "loopfade", "positionmode", "mode", "loopstyle"] },
      { title: "Pitch", params: ["transpose", "fine", "speed", "keytrack", "warp", "root", "quality"] },
      { title: "Tempo Sync", params: ["beats", "sync", "ppqn"] },
      { title: "Envelope", params: ["attack", "decay", "sustain", "release"] },
      { title: "Filter", params: ["cutoff", "resonance", "filterenv"] },
      { title: "Output", params: ["level", "pan", "velocity", "crush"] },
      { title: "Voices", params: ["voices", "voicemode", "layers", "layerpitch", "layeroffset", "triggerby", "slicemode", "output", "voiceouts"] },
    ],
    template:
      '<div style="display:flex;gap:8px;width:100%;flex:1 1 100%;flex-wrap:wrap">' +
      '<div class="bv-panel" style="flex:3 1 440px;min-width:0;display:flex;flex-direction:column"><div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">' +
      '<span class="sa-info" style="flex:1;color:var(--muted)"></span><span class="sa-drop bv-drop" style="padding:2px 8px">Import WAV</span></div>' +
      '<canvas class="sa-canvas" style="flex:1 1 80px;min-height:80px;touch-action:none"></canvas>' +
      '<div class="sa-tools" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;font-size:11px">' +
      field("Slicing", '<select class="sa-kind"><option value="manual">Manual</option><option value="threshold">Threshold</option><option value="beats">Beats</option></select>') +
      '<span data-kind="threshold" style="display:flex;gap:8px;align-items:center">' +
      field("Sensitivity", '<input class="sa-threshold" type="range" min="0" max="1" step="0.01" style="width:70px">') +
      field("Min gap ms", num("sa-mingap", 5, 500, 1, 46)) + '<button class="sa-detect">Detect</button></span>' +
      '<span data-kind="beats" style="display:flex;gap:8px;align-items:center">' +
      field("Divisions", num("sa-beats", 2, 64, 1, 42)) + field("BPM", num("sa-bpm", 20, 400, 0.1, 50)) + field("Bars", num("sa-bars", 1, 64, 1, 40)) +
      '<button class="sa-detect-bpm">Detect BPM</button><button class="sa-equal">Equal</button><button class="sa-grid-btn">On BPM</button></span>' +
      '<button class="sa-clear">Clear</button></div>' +
      '<div class="sa-note" style="color:var(--muted);margin-top:2px;min-height:1em;font-size:11px"></div></div>' +
      '<div class="bv-panel" style="flex:1 1 250px;display:flex;flex-direction:column;gap:6px">' +
      '<div class="sa-sel" style="font-weight:600"></div>' +
      '<div class="sa-grid">' +
      field("Mode", '<select class="sa-mode">' + MODES.map((m, i) => '<option value="' + (i - 1) + '">' + m + "</option>").join("") + "</select>") +
      field("Transpose", num("sa-transpose", -48, 48, 1)) + field("Level", num("sa-level", 0, 2, 0.05)) +
      field("Pan", num("sa-pan", -1, 1, 0.05)) + field("Reverse", '<input class="sa-reverse" type="checkbox">') +
      field("Choke", '<select class="sa-choke" style="width:52px">' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => '<option value="' + n + '">' + (n || "–") + "</option>").join("") + "</select>") +
      '<button class="sa-audition" style="grid-column:1/3">Audition</button></div></div></div>',
    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
      view.root.classList.add("sa");
      view.sp = {
        canvas: q(".sa-canvas"), info: q(".sa-info"), noteEl: q(".sa-note"), note: "", state: null, sel: q(".sa-sel"),
        kind: q(".sa-kind"), threshold: q(".sa-threshold"), minGap: q(".sa-mingap"), beats: q(".sa-beats"), bpm: q(".sa-bpm"), bars: q(".sa-bars"),
        mode: q(".sa-mode"), transpose: q(".sa-transpose"), level: q(".sa-level"), pan: q(".sa-pan"), reverse: q(".sa-reverse"), choke: q(".sa-choke"),
      };
      const sp = view.sp;
      const drop = q(".sa-drop");
      BleepView.mediaDrop(drop, view.api, (r) => {
        view.api.beginGesture();
        send(view, { clip: r.id, length: 0, markers: [], current: 0, slices: {}, slicing: data(view).slicing });
        sp.note = "Imported " + (r.name || "WAV") + " (" + r.seconds.toFixed(1) + " s)";
      }, (msg) => (sp.note = msg));
      sp.canvas.addEventListener("dragover", (e) => e.preventDefault());
      sp.canvas.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.dispatchEvent(new DragEvent("drop", { dataTransfer: e.dataTransfer }));
      });
      const slicing = (patch) => {
        view.api.beginGesture();
        send(view, { ...data(view), slicing: { ...data(view).slicing, ...patch } });
        slicingPanel(view);
      };
      sp.kind.addEventListener("change", () => slicing({ kind: sp.kind.value }));
      sp.threshold.addEventListener("change", () => slicing({ threshold: +sp.threshold.value }));
      sp.minGap.addEventListener("change", () => slicing({ minGap: +sp.minGap.value }));
      sp.beats.addEventListener("change", () => slicing({ beats: +sp.beats.value }));
      sp.bpm.addEventListener("change", () => slicing({ bpm: +sp.bpm.value }));
      sp.bars.addEventListener("change", () => slicing({ bars: +sp.bars.value }));
      q(".sa-detect").addEventListener("click", () => {
        view.api.beginGesture();
        view.api.perform("detect", +sp.threshold.value, +sp.minGap.value);
        sp.note = "Detecting…";
      });
      q(".sa-detect-bpm").addEventListener("click", () => view.api.perform("bpm"));
      q(".sa-equal").addEventListener("click", () => {
        view.api.beginGesture();
        send(view, { ...data(view), markers: beatMarkers(view, false), current: 0 });
      });
      q(".sa-grid-btn").addEventListener("click", () => {
        view.api.beginGesture();
        send(view, { ...data(view), markers: beatMarkers(view, true), current: 0 });
      });
      q(".sa-clear").addEventListener("click", () => {
        view.api.beginGesture();
        send(view, { ...data(view), markers: [], slices: {}, current: 0 });
      });
      q(".sa-audition").addEventListener("click", () => view.api.command("audition", data(view).current));
      const bind = (el, key, conv) => el.addEventListener("change", () => sp.set && sp.set(key, conv(el)));
      bind(sp.mode, "mode", (e) => +e.value);
      bind(sp.transpose, "transpose", (e) => +e.value);
      bind(sp.level, "level", (e) => +e.value);
      bind(sp.pan, "pan", (e) => +e.value);
      bind(sp.reverse, "reverse", (e) => e.checked);
      bind(sp.choke, "choke", (e) => +e.value);
      attach(view);
      // The envelope drawing sits in the Envelope card, under its knobs.
      const envBox = view.knobs.get("attack") && view.knobs.get("attack").box.closest(".bv-sec");
      if (envBox) {
        sp.env = document.createElement("canvas");
        sp.env.title = "Amplitude envelope";
        sp.env.style.cssText = "width:100%;height:46px;display:block;margin-top:2px";
        envBox.appendChild(sp.env);
      }
      // Tempo Sync: ÷2 / ×2 halve and double the number of beats the sample lasts; Fit reads it from the detected BPM.
      const bk = view.knobs.get("beats");
      if (bk) {
        const lo = 0.25, hi = 256;
        const beatsNow = () => lo * Math.pow(hi / lo, view.node.params.beats ?? Math.log(4 / lo) / Math.log(hi / lo));
        const setBeats = (v) => {
          v = Math.min(hi, Math.max(lo, v));
          view.api.beginGesture();
          view.node.params.beats = Math.log(v / lo) / Math.log(hi / lo);
          view.api.setParam("beats", view.node.params.beats);
          bk.draw();
        };
        sp.setBeats = setBeats;
        const box = document.createElement("div");
        box.className = "sa-beat-btns";
        const mk = (label, title, fn) => {
          const b = document.createElement("button");
          b.textContent = label;
          b.title = title;
          b.addEventListener("click", fn);
          box.appendChild(b);
        };
        mk("÷2", "Half the beats: twice as fast", () => setBeats(beatsNow() / 2));
        mk("×2", "Double the beats: half as fast", () => setBeats(beatsNow() * 2));
        mk("Fit", "Guess the beats from the detected tempo", () => { sp.fit = Date.now(); view.api.perform("bpm"); });
        bk.box.appendChild(box);
      }
      BleepView.loop(view.root, (t) => envelope(view, t));
      slicingPanel(view);
      slicePanel(view);
    },
    onState(st, view) {
      if (!view.sp || !st) return;
      view.sp.state = st;
      const sr = st.sampleRate || 48000;
      const n = st.slices | 0;
      view.sp.info.textContent = st.length > 0
        ? (st.length / sr).toFixed(2) + " s · " + (st.channels > 1 ? "stereo" : "mono") + " · " + n + (n === 1 ? " slice" : " slices")
        : "";
      view.sp.noteEl.textContent = view.sp.note || "";
      if (!view.sp.editing) { slicingPanel(view); slicePanel(view); }
      if (view.sp.fit && Date.now() - view.sp.fit > 200 && st.length > 0 && view.sp.setBeats) {
        view.sp.fit = 0;
        const secs = st.length / sr, raw = (secs * data(view).slicing.bpm) / 60;
        view.sp.setBeats(Math.pow(2, Math.round(Math.log2(Math.max(raw, 0.25)))));  // loops are 1, 2, 4, 8 … beats
        view.sp.note = "Fitted to " + data(view).slicing.bpm + " BPM";
      }
      draw(view);
    },
  });
})();
