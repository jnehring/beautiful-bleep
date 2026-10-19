// SPDX-License-Identifier: GPL-3.0-or-later
// Recorder view (doc/specs/modules/recorder.md §5): a status lamp and time, a level bar, and the take's
// waveform growing from the left across the length limit. When a take is done the view saves it to the
// media folder (exportMedia("take"), at once if Save When Done is on, else with the Save button) and
// keeps its id in the node's data; Show File opens the folder with the file selected.
(function () {
  "use strict";
  const STATES = ["Idle", "Armed: waiting", "Recording", "Take ready"];
  const fmt = (s) => Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0");
  const toggleOn = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return (view.node.params[id] ?? p.default) > 0.5;
  };

  function draw(view) {
    const rc = view.rec;
    if (!rc || !rc.canvas.clientWidth) return;
    const { g, w, h } = BleepView.fit(rc.canvas);
    const th = BleepView.theme(view.root);
    const st = rc.st || {}, peaks = rc.peaks;
    g.strokeStyle = th.line;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    if (!peaks || !st.limit) return;
    const used = Math.min(1, (st.seconds || 0) / st.limit);
    const n = peaks.length, cols = Math.max(1, Math.floor(used * n));
    g.fillStyle = st.state === 2 ? "#f87171" : th.accent;
    for (let c = 0; c < cols; c++) {
      const a = Math.min(1, peaks[c]) * (h / 2 - 2);
      if (a < 0.4) continue;
      const x = (c / n) * w;
      g.fillRect(x, h / 2 - a, Math.max(1, w / n - 0.5), a * 2);
    }
    if (st.state === 2) {
      g.fillStyle = "#f87171";
      g.fillRect((cols / n) * w, 0, 1, h);
    }
  }

  async function save(view) {
    const rc = view.rec;
    if (rc.saving) return;
    rc.saving = true;
    rc.note.textContent = "Saving…";
    try {
      const r = await view.api.exportMedia("take");
      if (r && r.id) {
        const d = { take: r.id, seconds: r.seconds };
        view.node.data = d;
        view.api.setData(d);
        rc.note.textContent = "";
      } else {
        rc.note.textContent = r && r.error ? "Could not save: " + r.error : "";
      }
    } finally {
      rc.saving = false;
      refresh(view);
    }
  }

  function refresh(view) {
    const rc = view.rec;
    if (!rc) return;
    const st = rc.st || {}, d = view.node.data || {};
    rc.state.textContent = STATES[st.state | 0] || "";
    rc.lamp.className = "rcd-lamp s" + (st.state | 0);
    rc.time.textContent = fmt(st.seconds || 0) + " / " + fmt(st.limit || 0);
    rc.level.style.width = Math.min(100, Math.round(100 * (st.level || 0))) + "%";
    rc.save.disabled = (st.state | 0) !== 3 || rc.saving;
    rc.reveal.disabled = !d.take;
    rc.file.textContent = d.take ? "Saved as " + d.take + (d.seconds ? " · " + fmt(d.seconds) : "") : "";
    rc.dirty = true;
  }

  BleepViews.register("recorder", {
    partNames: ["Take"],
    top: true,
    width: 700,
    layout: [
      { title: "Start", params: ["start", "threshold", "preroll", "gatecontrol"] },
      { title: "Take", params: ["limit", "autosave"] },
    ],
    template:
      "<style>" +
      ".rcd{flex:1 1 100%}" +
      ".rcd-top{display:flex;align-items:center;gap:10px;font-size:13px}" +
      ".rcd-time{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--muted)}" +
      ".rcd-lamp{width:12px;height:12px;border-radius:50%;background:var(--panel-3);border:1px solid var(--line)}" +
      ".rcd-lamp.s1{background:#fbbf24;border-color:#fbbf24}.rcd-lamp.s2{background:#f87171;border-color:#f87171;box-shadow:0 0 8px #f87171}" +
      ".rcd-lamp.s3{background:var(--accent);border-color:var(--accent)}" +
      ".rcd-bar{height:4px;border-radius:2px;background:var(--panel-3);margin:6px 0;overflow:hidden}" +
      ".rcd-bar i{display:block;height:100%;width:0;background:var(--accent)}" +
      ".rcd-wave{display:block;width:100%;height:90px;background:var(--panel-2);border-radius:6px}" +
      ".rcd-row{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:11px;color:var(--muted)}" +
      "</style>" +
      '<div class="rcd"><div class="rcd-top"><span class="rcd-lamp"></span><b class="rcd-state"></b><span class="rcd-time"></span></div>' +
      '<div class="rcd-bar"><i></i></div><canvas class="rcd-wave"></canvas>' +
      '<div class="rcd-row"><button class="rcd-save" type="button">Save Take</button><button class="rcd-reveal" type="button">Show File</button>' +
      '<span class="rcd-file"></span><span class="rcd-note"></span></div></div>',
    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
      view.rec = { canvas: q("canvas"), state: q(".rcd-state"), lamp: q(".rcd-lamp"), time: q(".rcd-time"), level: q(".rcd-bar i"),
                   save: q(".rcd-save"), reveal: q(".rcd-reveal"), file: q(".rcd-file"), note: q(".rcd-note"),
                   st: null, peaks: null, dirty: true, saving: false, lastState: 0 };
      view.rec.save.addEventListener("click", () => save(view));
      view.rec.reveal.addEventListener("click", async () => {
        const d = view.node.data || {};
        const r = d.take && (await view.api.revealMedia(d.take));
        if (r && r.error) view.rec.note.textContent = "Could not show the file: " + r.error;
      });
      BleepView.loop(view.root, () => { if (view.rec.dirty) { draw(view); view.rec.dirty = false; } });
      refresh(view);
    },
    onState(st, view) {
      const rc = view.rec;
      if (!rc || !st) return;
      const was = rc.lastState;
      rc.st = st;
      rc.lastState = st.state | 0;
      if (st.arrays && st.arrays.peaks) rc.peaks = st.arrays.peaks;
      if (was === 2 && rc.lastState === 3 && toggleOn(view, "autosave")) save(view);
      refresh(view);
    },
    onRefresh(view) { refresh(view); },
  });
})();
