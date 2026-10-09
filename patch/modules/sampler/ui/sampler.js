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
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), text = css.getPropertyValue("--text").trim();
    const muted = css.getPropertyValue("--muted").trim(), line = css.getPropertyValue("--line").trim();
    const panel = css.getPropertyValue("--panel-3").trim() || line;
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
    g.fillStyle = muted;
    const bw = w / Math.max(peaks.length, 1);
    for (let i = 0; i < peaks.length; i++) {
      const v = Math.min(1, peaks[i]) * (h / 2 - 3);
      g.fillRect(i * bw, h / 2 - v, Math.max(1, bw), Math.max(1, 2 * v));
    }
    g.fillStyle = accent;
    g.font = "10px system-ui, sans-serif";
    g.textAlign = "left";
    for (let i = 0; i < markers.length; i++) g.fillRect(Math.round(x(markers[i])) - 1, 0, 2, h);
    if (markers.length < 64)
      for (let i = 0; i + 1 < bounds.length; i++) g.fillText(String(i + 1), x(bounds[i]) + 3, 11);
    g.fillRect(x(bounds[cur]), h - 3, Math.max(2, x(bounds[cur + 1]) - x(bounds[cur])), 3);
    g.fillStyle = text;
    for (let i = 0; i + 1 < heads.length; i += 2) {
      g.beginPath();
      g.arc(x(heads[i]), h / 2, 4, 0, Math.PI * 2);
      g.fill();
    }
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

  BleepViews.register("sampler", {
    top: true,
    width: 460,
    template:
      '<div class="bv-panel"><div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
      '<span class="sa-info" style="flex:1;color:var(--muted)"></span><span class="sa-drop bv-drop" style="padding:2px 8px">Import WAV</span></div>' +
      '<canvas class="sa-canvas" style="height:96px;touch-action:none"></canvas>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">' +
      field("Slicing", '<select class="sa-kind"><option value="manual">Manual</option><option value="threshold">Threshold</option><option value="beats">Beats</option></select>') +
      '<span data-kind="threshold" style="display:flex;gap:8px;align-items:center">' +
      field("Sensitivity", '<input class="sa-threshold" type="range" min="0" max="1" step="0.01" style="width:80px">') +
      field("Min gap ms", num("sa-mingap", 5, 500, 1)) + '<button class="sa-detect">Detect</button></span>' +
      '<span data-kind="beats" style="display:flex;gap:8px;align-items:center">' +
      field("Divisions", num("sa-beats", 2, 64, 1, 48)) + field("BPM", num("sa-bpm", 20, 400, 0.1)) + field("Bars", num("sa-bars", 1, 64, 1, 44)) +
      '<button class="sa-detect-bpm">Detect BPM</button><button class="sa-equal">Equal</button><button class="sa-grid">On BPM</button></span>' +
      '<button class="sa-clear">Clear</button></div>' +
      '<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">' +
      '<div class="sa-sel" style="font-weight:600;margin-bottom:4px"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      field("Mode", '<select class="sa-mode">' + MODES.map((m, i) => '<option value="' + (i - 1) + '">' + m + "</option>").join("") + "</select>") +
      field("Transpose", num("sa-transpose", -48, 48, 1)) + field("Level", num("sa-level", 0, 2, 0.05)) +
      field("Pan", num("sa-pan", -1, 1, 0.05)) + field("Reverse", '<input class="sa-reverse" type="checkbox">') +
      field("Choke", '<select class="sa-choke">' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => '<option value="' + n + '">' + (n || "–") + "</option>").join("") + "</select>") +
      '<button class="sa-audition">Audition</button></div></div>' +
      '<div class="sa-note" style="color:var(--muted);margin-top:4px;min-height:1em"></div></div>',
    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
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
      q(".sa-grid").addEventListener("click", () => {
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
      draw(view);
    },
  });
})();
