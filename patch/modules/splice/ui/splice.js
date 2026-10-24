// SPDX-License-Identifier: GPL-3.0-only
// Splice view (doc/specs/modules/splice.md §5): the whole reel with its splices
// (alternating tints, current and pending marked, markers, play heads), a
// zoom on the current splice with the window shaded, and a drop target for
// WAV files. Click a splice to select it, double-click to add a marker
// (double-click a marker to remove it), drag a marker to move it.
//
// The audio thread owns the reel while it records; the view mirrors its
// structure (liveArrays "markers", liveValues length / current) back into the
// node's data, and saves the reel to the media folder (exportMedia("reel"))
// after the audio changed, keeping the returned id in the data.
(function () {
  "use strict";
  const HIT = 5;  // px around a marker
  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

  function data(view) {
    const d = view.node.data && typeof view.node.data === "object" ? view.node.data : {};
    return {
      reel: typeof d.reel === "string" ? d.reel : "",
      length: d.length | 0,
      markers: Array.isArray(d.markers) ? d.markers.slice() : [],
      current: d.current | 0,
      names: d.names && typeof d.names === "object" ? d.names : {},
    };
  }
  function send(view, d) {
    view.node.data = d;
    view.api.setData(JSON.parse(JSON.stringify(d)));
  }

  /// Live structure from the engine (markers in frames).
  function live(view) {
    const st = view.sp.state || {};
    const m = ((st.arrays && st.arrays.markers) || []).map((x) => Math.round(x));
    return { length: Math.round(st.length || 0), markers: m, current: st.current | 0, pending: st.pending ?? -1 };
  }

  /// Mirrors the engine's structure into the data; saves changed audio.
  function sync(view) {
    const st = view.sp.state;
    if (!st || st.loading > 0.5 || st.missing > 0.5) return;  // missing: keep the saved markers
    const d = data(view), l = live(view);
    if (d.length !== l.length || d.current !== l.current || JSON.stringify(d.markers) !== JSON.stringify(l.markers)) {
      if (!view.sp.drag) send(view, { ...d, length: l.length, markers: l.markers, current: l.current });
    }
    if (view.sp.cleared && l.length === 0 && d.reel) {  // Clear reel: forget the saved file too
      view.sp.cleared = false;
      send(view, { ...data(view), reel: "" });
    }
    const now = performance.now();
    if (st.dirty > 0.5 && st.recording < 0.5 && !view.sp.saving) {
      if (!view.sp.dirtySince) view.sp.dirtySince = now;
      if (now - view.sp.dirtySince > 800) save(view);
    } else view.sp.dirtySince = 0;
  }

  async function save(view) {
    view.sp.saving = true;
    try {
      const r = await view.api.exportMedia("reel");
      if (r && r.id) send(view, { ...data(view), reel: r.id });
      else if (r && r.error) view.sp.note = "Saving the reel failed: " + r.error;
    } finally {
      view.sp.saving = false;
      view.sp.dirtySince = 0;
    }
  }

  function geometry(view) {
    const l = view.sp.drag ? { ...live(view), markers: view.sp.drag.markers } : live(view);
    const bounds = [0, ...l.markers, l.length];
    return { l, bounds };
  }

  function draw(view) {
    const sp = view.sp, st = sp.state || {};
    for (const c of [sp.reel, sp.zoom]) {
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (!w) return;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    }
    const css = getComputedStyle(view.root);
    const accent = css.getPropertyValue("--accent").trim(), text = css.getPropertyValue("--text").trim();
    const muted = css.getPropertyValue("--muted").trim(), line = css.getPropertyValue("--line").trim();
    const panel = css.getPropertyValue("--panel-3").trim() || line;
    const peaks = (st.arrays && st.arrays.peaks) || [];
    const heads = (st.arrays && st.arrays.heads) || [];
    const { l, bounds } = geometry(view);
    const total = Math.max(l.length, 1);

    // Whole reel.
    {
      const c = sp.reel, g = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const x = (f) => (f / total) * w;
      for (let i = 0; i + 1 < bounds.length && l.length > 0; i++) {
        g.fillStyle = i % 2 ? panel : line;
        g.globalAlpha = i === l.current ? 1 : 0.5;
        g.fillRect(x(bounds[i]), 0, Math.max(1, x(bounds[i + 1]) - x(bounds[i])), h);
      }
      g.globalAlpha = 1;
      g.fillStyle = muted;
      const bw = w / Math.max(peaks.length, 1);
      for (let i = 0; i < peaks.length; i++) {
        const v = Math.min(1, peaks[i]) * (h / 2 - 3);
        g.fillRect(i * bw, h / 2 - v, Math.max(1, bw), Math.max(1, 2 * v));
      }
      if (l.pending >= 0 && l.pending + 1 < bounds.length) {
        g.strokeStyle = text;
        g.setLineDash([4, 3]);
        g.strokeRect(x(bounds[l.pending]) + 1, 1, Math.max(2, x(bounds[l.pending + 1]) - x(bounds[l.pending]) - 2), h - 2);
        g.setLineDash([]);
      }
      g.fillStyle = accent;
      for (const m of l.markers) g.fillRect(Math.round(x(m)) - 1, 0, 2, h);
      if (l.current + 1 < bounds.length && l.length > 0) {  // current: a bar along the top
        g.fillRect(x(bounds[l.current]), 0, Math.max(2, x(bounds[l.current + 1]) - x(bounds[l.current])), 3);
      }
      g.fillStyle = text;
      for (const p of heads) g.fillRect(x(p), 0, 1.5, h);
      if (l.length === 0) {
        g.fillStyle = muted;
        g.font = "11px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(st.missing > 0.5 ? "Reel missing: drop the WAV file to relink" : "Empty reel: record, or drop a WAV file", w / 2, h / 2 + 4);
      }
    }
    // Current splice, zoomed, with the window.
    {
      const c = sp.zoom, g = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (l.length === 0 || l.current + 1 >= bounds.length) return;
      const a = bounds[l.current], b = Math.max(bounds[l.current + 1], a + 1);
      const x = (f) => ((f - a) / (b - a)) * w;
      if (st.winLength > 0) {
        g.fillStyle = line;
        g.fillRect(x(st.winStart), 0, Math.max(2, x(st.winStart + st.winLength) - x(st.winStart)), h);
      }
      g.fillStyle = muted;
      const per = peaks.length / total;
      for (let px = 0; px < w; px++) {
        const f0 = a + ((b - a) * px) / w, f1 = a + ((b - a) * (px + 1)) / w;
        let v = 0;
        for (let k = Math.floor(f0 * per); k <= Math.min(peaks.length - 1, Math.floor(f1 * per)); k++) v = Math.max(v, peaks[k] || 0);
        v = Math.min(1, v) * (h / 2 - 2);
        g.fillRect(px, h / 2 - v, 1, Math.max(1, 2 * v));
      }
      g.fillStyle = accent;
      for (const p of heads) if (p >= a - 1 && p <= b + 1) g.fillRect(x(p) - 1, 0, 2, h);
    }
  }

  function attach(view) {
    const sp = view.sp, c = sp.reel;
    const frameAt = (e) => {
      const r = c.getBoundingClientRect();
      return Math.round(((e.clientX - r.left) / r.width) * Math.max(live(view).length, 1));
    };
    const markerAt = (e) => {
      const r = c.getBoundingClientRect(), l = live(view);
      const px = e.clientX - r.left;
      return l.markers.findIndex((m) => Math.abs((m / Math.max(l.length, 1)) * r.width - px) <= HIT);
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !live(view).length) return;
      e.stopPropagation();
      const i = markerAt(e);
      if (i >= 0) {
        c.setPointerCapture(e.pointerId);
        view.api.beginGesture();
        sp.drag = { index: i, markers: live(view).markers.slice() };
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (!sp.drag) { c.style.cursor = markerAt(e) >= 0 ? "ew-resize" : "pointer"; return; }
      const m = sp.drag.markers, i = sp.drag.index, l = live(view);
      const lo = (i > 0 ? m[i - 1] : 0) + 1, hi = (i + 1 < m.length ? m[i + 1] : l.length) - 1;
      m[i] = Math.min(hi, Math.max(lo, frameAt(e)));
      draw(view);
    });
    const end = () => {
      if (!sp.drag) return;
      const markers = sp.drag.markers;
      sp.drag = null;
      send(view, { ...data(view), markers });
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("click", (e) => {
      const l = live(view), f = frameAt(e);
      if (!l.length || markerAt(e) >= 0) return;
      const i = [0, ...l.markers, l.length].findIndex((b, k, arr) => k + 1 < arr.length && f >= b && f < arr[k + 1]);
      if (i >= 0) view.api.command("select", i);
    });
    c.addEventListener("dblclick", (e) => {
      const l = live(view);
      if (!l.length) return;
      e.stopPropagation();
      view.api.beginGesture();
      const i = markerAt(e);
      const markers = l.markers.slice();
      if (i >= 0) markers.splice(i, 1);  // merge with the next splice
      else {
        markers.push(frameAt(e));
        markers.sort((a, b) => a - b);
      }
      send(view, { ...data(view), markers, current: Math.min(l.current, markers.length) });
    });
  }

  if (!document.getElementById("sp-style")) {
    const st = document.createElement("style");
    st.id = "sp-style";
    st.textContent = ".bleep-view.sp .bv-knob{width:56px}.bleep-view.sp .bv-knob svg{width:40px;height:40px}.bleep-view.sp .bv-sec-knobs{gap:2px 0}.bleep-view.sp .bv-label{font-size:9px;letter-spacing:.04em}";
    document.head.appendChild(st);
  }

  BleepViews.register("splice", {
    partNames: ["Reel and zoom"],
    layout: [
      { title: "Playback", params: ["speed", "loop", "endmode", "sync"] },
      { title: "Windows", params: ["window", "position", "overlap", "pick", "fade"] },
      { title: "Levels", params: ["overdub", "level"] },
      { title: "Record", params: ["rectarget", "recmode", "monitor"] },
      { title: "Reel", params: ["reel", "shift", "seed"] },
    ],
    template:
      '<div class="bv-panel" style="width:100%;flex:1 1 100%"><div class="sp-head" style="display:flex;gap:8px;align-items:center;margin-bottom:4px">' +
      '<span class="sp-rec" style="font-weight:600"></span><span class="sp-info" style="flex:1;color:var(--muted)"></span>' +
      '<span class="sp-drop bv-drop" style="padding:2px 8px">Import audio</span></div>' +
      '<div style="display:flex;gap:8px;align-items:stretch">' +
      '<canvas class="sp-reel" style="flex:1 1 60%;min-width:0;height:64px;touch-action:none"></canvas>' +
      '<canvas class="sp-zoom" style="flex:1 1 40%;min-width:0;height:64px"></canvas></div>' +
      '<div class="sp-note" style="color:var(--muted);margin-top:4px;min-height:1em"></div></div>',
    afterBuild(view, el) {
      view.root.classList.add("sp");
      view.sp = {
        reel: el.querySelector(".sp-reel"), zoom: el.querySelector(".sp-zoom"), rec: el.querySelector(".sp-rec"),
        info: el.querySelector(".sp-info"), note: "", noteEl: el.querySelector(".sp-note"), state: null,
      };
      const drop = el.querySelector(".sp-drop");
      BleepView.mediaDrop(drop, view.api, (r) => {
        view.api.beginGesture();
        send(view, { reel: r.id, length: 0, markers: [], current: 0, names: {} });
        view.sp.note = "Imported " + (r.name || "WAV") + " (" + r.seconds.toFixed(1) + " s)";
      }, (msg) => (view.sp.note = msg));
      // Dropping straight onto the reel works too.
      for (const c of [view.sp.reel, view.sp.zoom]) {
        c.addEventListener("dragover", (e) => e.preventDefault());
        c.addEventListener("drop", (e) => {
          e.preventDefault();
          drop.dispatchEvent(new DragEvent("drop", { dataTransfer: e.dataTransfer }));
        });
      }
      // "Clear reel" (a module button) also clears the saved reel id.
      const clear = view.root.querySelector('[data-command="clear"]');
      if (clear) clear.addEventListener("click", () => (view.sp.cleared = true));
      attach(view);
    },
    onState(st, view) {
      if (!view.sp || !st) return;
      view.sp.state = st;
      const sr = st.sampleRate || 48000;
      view.sp.rec.textContent = st.recording > 0.5 ? "● REC" : st.loading > 0.5 ? "loading…" : "";
      view.sp.rec.style.color = st.recording > 0.5 ? "#ef4444" : "";
      const n = st.splices | 0;
      view.sp.info.textContent = "reel " + fmt((st.length || 0) / sr) + " / " + fmt((st.capacity || 0) / sr) +
        "   " + n + (n === 1 ? " splice" : " splices") + (st.dirty > 0.5 ? "  · unsaved" : "");
      view.sp.noteEl.textContent = view.sp.note || "";
      sync(view);
      draw(view);
    },
  });
})();
