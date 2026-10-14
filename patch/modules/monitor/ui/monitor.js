// SPDX-License-Identifier: MIT
// Monitor view (doc/specs/modules/monitor.md §5): a table of the MIDI events that
// arrive (newest on top, with filters, Pause and Clear) over a keyboard that shows
// the held notes, and below it three meters side by side: the audio bars (peak and
// RMS, peak hold, clip lights), the CV readout (value, range, note name, history)
// and the gate meter (lamp, pulse count, rate, length, duty, history).
//
// The events arrive as the live array "midi": [count, type, channel, number, data, …],
// the newest 64; the view keeps the count it has seen and adds what is new.
(function () {
  "use strict";
  const FLOORS = [-24, -36, -48, -60, -72, -96];     // MonitorModule.cpp: the Floor setting
  const FALL = 24;                                    // dB per second, the bar's fall
  const HOLD = 3;                                     // seconds the peak line stays
  const TICKS = [0, -6, -12, -24, -36, -48, -60, -72, -96];
  const MAX_ROWS = 120, KEEP = 400, HIST = 200;
  const NOTE = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  const CC_NAMES = { 0: "Bank MSB", 1: "Mod Wheel", 2: "Breath", 4: "Foot", 5: "Portamento Time", 7: "Volume",
    8: "Balance", 10: "Pan", 11: "Expression", 32: "Bank LSB", 64: "Sustain", 65: "Portamento", 66: "Sostenuto",
    67: "Soft Pedal", 71: "Resonance", 72: "Release", 73: "Attack", 74: "Cutoff", 91: "Reverb", 93: "Chorus",
    120: "All Sound Off", 121: "Reset Controllers", 123: "All Notes Off" };
  const SYSTEM = { 0xf8: "Clock", 0xfa: "Start", 0xfb: "Continue", 0xfc: "Stop" };
  // Event types are NoteEvent::Type; a filter chip covers one or more.
  const FILTERS = [
    { id: "notes", label: "Notes", types: [0, 1], on: true },
    { id: "cc", label: "CC", types: [3], on: true },
    { id: "pc", label: "Program", types: [4], on: true },
    { id: "bend", label: "Bend", types: [5], on: true },
    { id: "pressure", label: "Pressure", types: [2, 6], on: true },
    { id: "clock", label: "Clock", types: [7], on: false },
  ];
  const TYPE_NAMES = ["Note On", "Note Off", "Poly Pressure", "CC", "Program", "Pitch Bend", "Ch Pressure", "System"];

  const toDb = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const noteName = (n) => NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  const dbText = (db, floor) => (db <= floor ? "−∞" : (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1));
  const choice = (view, id) => {
    const p = view.type.params.find((x) => x.id === id);
    return Math.round((view.node.params[id] ?? p.default) * (p.steps - 1));
  };
  const cell = (tr, text, cls) => {
    const td = document.createElement("td");
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
    return td;
  };
  /// A value with sign and three decimals, "−0.250".
  const num = (v, d = 3) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  /// The note a control value names (1 V/octave, 0 = C4), "A4 +12 ct".
  const cvNote = (v) => {
    const semis = 60 + v * 12, n = Math.round(semis), cents = Math.round((semis - n) * 100);
    if (n < 0 || n > 127) return "";
    return noteName(n) + (cents ? " " + (cents > 0 ? "+" : "−") + Math.abs(cents) + " ct" : "");
  };
  /// A round range at least as large as `x`, for the CV scale.
  const niceRange = (x) => [1, 2, 5, 10, 20, 50, 100].find((r) => r >= x) || Math.ceil(x);

  // ---- the MIDI table -----------------------------------------------------------------------------
  function describe(e) {
    const [type, ch, a, b] = e;
    switch (type) {
      case 0: case 1: return { ch: ch + 1, kind: TYPE_NAMES[type], number: noteName(a) + "  (" + a + ")", value: String(b), bar: b / 127 };
      case 2: return { ch: ch + 1, kind: TYPE_NAMES[type], number: noteName(a) + "  (" + a + ")", value: String(b), bar: b / 127 };
      case 3: return { ch: ch + 1, kind: "CC", number: a + (CC_NAMES[a] ? "  " + CC_NAMES[a] : ""), value: String(b), bar: b / 127 };
      case 4: return { ch: ch + 1, kind: "Program", number: String(a), value: "", bar: -1 };
      case 5: return { ch: ch + 1, kind: "Pitch Bend", number: "", value: (b > 0 ? "+" : b < 0 ? "−" : "") + Math.abs(b), bar: (b + 8192) / 16383 };
      case 6: return { ch: ch + 1, kind: "Ch Pressure", number: "", value: String(b), bar: b / 127 };
      default: return { ch: "", kind: SYSTEM[a] || "System", number: a ? "0x" + a.toString(16).toUpperCase() : "", value: "", bar: -1 };
    }
  }
  const visible = (e) => FILTERS.some((f) => f.on && f.types.includes(e[0]));

  function addRow(m, e, at) {
    const d = describe(e), tr = document.createElement("tr");
    tr.className = "mn-t" + e[0];
    cell(tr, (at / 1000).toFixed(3), "mn-time");
    cell(tr, String(d.ch), "mn-ch");
    cell(tr, d.kind, "mn-kind");
    cell(tr, d.number, "mn-number");
    const v = cell(tr, d.value, "mn-value");
    if (d.bar >= 0) {
      const bar = document.createElement("i");
      bar.style.width = Math.round(clamp(d.bar, 0, 1) * 100) + "%";
      v.appendChild(bar);
    }
    m.body.insertBefore(tr, m.body.firstChild);
    while (m.body.childElementCount > MAX_ROWS) m.body.lastChild.remove();
  }
  function rebuild(m) {
    m.body.textContent = "";
    for (const [e, at] of m.buffer) if (visible(e)) {
      addRow(m, e, at);
      if (m.body.childElementCount >= MAX_ROWS) break;
    }
    m.empty.style.display = m.body.childElementCount ? "none" : "";
  }
  function clearTable(m) {
    m.buffer.length = 0;
    m.body.textContent = "";
    m.empty.style.display = "";
  }

  /// Takes the newest events from the "midi" array: [count, (type, ch, a, b) × n].
  function takeEvents(view, arr, now) {
    const m = view.mon;
    if (!arr || arr.length < 1) return;
    const count = arr[0], n = (arr.length - 1) >> 2;
    const fresh = m.seen === null ? n : Math.min(n, (count - m.seen + 0x1000000) % 0x1000000);
    const missed = m.seen === null ? 0 : (count - m.seen + 0x1000000) % 0x1000000 - fresh;
    m.seen = count;
    if (m.paused || (!fresh && !missed)) return;
    if (missed > 0 && missed < 0x800000) m.missed += missed;
    const start = 1 + (n - fresh) * 4;
    let added = false;
    for (let k = 0; k < fresh; k++) {
      const e = arr.slice(start + k * 4, start + k * 4 + 4);
      const at = now - m.t0;
      m.buffer.unshift([e, at]);
      if (visible(e)) { addRow(m, e, at); added = true; }
    }
    if (m.buffer.length > KEEP) m.buffer.length = KEEP;
    if (added) m.empty.style.display = "none";
  }

  function drawKeys(view) {
    const m = view.mon, c = m.keys;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root), col = (v) => css.getPropertyValue(v).trim();
    const kw = w / 128;
    for (let n = 0; n < 128; n++) {
      const held = (m.held[n >> 5] >>> (n & 31)) & 1;
      g.fillStyle = held ? col("--sig-gate") : BLACK[n % 12] ? col("--panel-3") : col("--line");
      g.fillRect(n * kw + 0.5, BLACK[n % 12] ? 0 : h * 0.35, Math.max(1, kw - 1), BLACK[n % 12] ? h * 0.65 : h * 0.65);
      if (held) { g.fillStyle = col("--sig-gate"); g.fillRect(n * kw + 0.5, 0, Math.max(1, kw - 1), h); }
    }
    g.fillStyle = col("--muted");
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    for (let n = 0; n < 128; n += 12) g.fillText("C" + (n / 12 - 1), n * kw + 1, h);
  }

  // ---- the audio bars ---------------------------------------------------------------------------
  function newChannel() { return { bar: -200, rms: -200, hold: -200, holdAt: 0, clip: false }; }

  function drawAudio(view) {
    const a = view.mon.audio, c = a.canvas;
    if (!c.clientWidth) return;
    const floor = FLOORS[choice(view, "floor")];
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root), col = (v) => css.getPropertyValue(v).trim();
    const shown = a.stereo ? a.ch : [a.ch[0]];
    const left = 16, right = 6, bw = w - left - right, top = 16, bh = 18, gap = 6;
    const x = (db) => left + bw * clamp(1 - db / floor, 0, 1);
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let lastX = -Infinity;
    for (const t of TICKS) {
      if (t < floor || Math.abs(x(t) - lastX) < 22) continue;
      lastX = x(t);
      g.fillStyle = col("--muted");
      g.fillText(t === 0 ? "0" : "−" + -t, x(t), 6);
      g.fillStyle = col("--line");
      g.fillRect(Math.round(x(t)), top - 3, 1, shown.length * (bh + gap));
    }
    const grad = g.createLinearGradient(left, 0, left + bw, 0);
    const z6 = clamp(1 - -6 / floor, 0, 1);
    grad.addColorStop(0, col("--sig-gate")); grad.addColorStop(Math.max(0.01, z6 - 0.02), col("--sig-gate"));
    grad.addColorStop(Math.min(0.99, z6 + 0.02), col("--mod")); grad.addColorStop(1, col("--warn"));
    shown.forEach((ch, k) => {
      const y = top + k * (bh + gap);
      g.fillStyle = col("--panel-3");
      g.fillRect(left, y, bw, bh);
      g.fillStyle = grad;
      if (ch.bar > floor) { g.globalAlpha = 0.4; g.fillRect(left, y, x(Math.min(6, ch.bar)) - left, bh); }
      if (ch.rms > floor) { g.globalAlpha = 1; g.fillRect(left, y + 3, x(Math.min(6, ch.rms)) - left, bh - 6); }
      g.globalAlpha = 1;
      if (ch.hold > floor) {
        g.fillStyle = ch.hold > 0 ? col("--warn") : col("--text");
        g.fillRect(Math.round(x(Math.min(0, ch.hold))) - 1, y - 2, 2, bh + 4);
      }
      g.fillStyle = col("--muted");
      g.textAlign = "left";
      g.fillText(a.stereo ? (k ? "R" : "L") : "M", 3, y + bh / 2);
      g.textAlign = "center";
    });
    a.labels.forEach((l, k) => {
      const ch = a.ch[k], on = k === 0 || a.stereo;
      l.box.style.display = on ? "" : "none";
      l.peak.textContent = dbText(ch.hold, floor);
      l.rms.textContent = dbText(ch.rms, floor);
      l.clip.classList.toggle("on", ch.clip);
    });
  }
  function resetAudio(view) {
    for (const ch of view.mon.audio.ch) { ch.hold = -200; ch.clip = false; }
    drawAudio(view);
  }

  // ---- the CV readout ---------------------------------------------------------------------------
  function drawCv(view) {
    const cv = view.mon.cv, c = cv.canvas;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root), col = (v) => css.getPropertyValue(v).trim();
    const th = BleepView.theme(view.root);
    let peak = 0;
    for (let i = 0; i < HIST; i++) peak = Math.max(peak, Math.abs(cv.lo[i]), Math.abs(cv.hi[i]));
    peak = Math.max(peak, Math.abs(cv.now));
    const range = niceRange(Math.max(peak, 1e-6));
    const y = (v) => h / 2 - (clamp(v, -range, range) / range) * (h / 2 - 3);
    g.fillStyle = col("--line");
    g.fillRect(0, Math.round(h / 2), w, 1);
    g.fillStyle = col("--muted");
    g.font = "9px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("+" + range, 2, 1);
    g.textBaseline = "bottom";
    g.fillText("−" + range, 2, h - 1);
    // The band between the lowest and highest value of each update, and the value itself on it.
    g.globalAlpha = 0.35;
    g.fillStyle = th.accent;
    for (let i = 0; i < HIST; i++) {
      const k = (cv.at + i) % HIST, px = (w * i) / (HIST - 1), top = y(cv.hi[k]), bot = y(cv.lo[k]);
      g.fillRect(px, top, Math.max(1, w / HIST), Math.max(1, bot - top));
    }
    g.globalAlpha = 1;
    g.beginPath();
    for (let i = 0; i < HIST; i++) {
      const k = (cv.at + i) % HIST, px = (w * i) / (HIST - 1);
      i ? g.lineTo(px, y(cv.val[k])) : g.moveTo(px, y(cv.val[k]));
    }
    g.strokeStyle = th.accent;
    g.lineWidth = 1.5;
    g.lineJoin = "round";
    g.stroke();
    cv.range = range;
  }
  function resetCv(view) {
    const cv = view.mon.cv;
    cv.min = cv.max = cv.now;
    cv.hasRange = false;
  }

  // ---- the gate meter ---------------------------------------------------------------------------
  function drawGate(view) {
    const gt = view.mon.gate, c = gt.canvas;
    if (!c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(view.root), col = (v) => css.getPropertyValue(v).trim();
    g.fillStyle = col("--panel-3");
    g.fillRect(0, 0, w, h);
    g.fillStyle = col("--sig-gate");
    for (let i = 0; i < HIST; i++) {
      const k = (gt.at + i) % HIST, level = gt.hist[k];
      if (level <= 0) continue;
      const px = (w * i) / HIST;
      g.globalAlpha = level;
      g.fillRect(px, 3, Math.max(1, w / HIST + 0.5), h - 6);
    }
    g.globalAlpha = 1;
  }
  function resetGate(view) {
    view.mon.gate.base = view.mon.gate.count;
  }

  // ---- the view ---------------------------------------------------------------------------------
  BleepViews.register("monitor", {
    partNames: ["Monitor"],
    width: 820,
    top: true,
    layout: [{ title: "Audio meter", params: ["response", "floor"] }],
    template:
      "<style>" +
      ".mn{display:flex;flex-direction:column;gap:8px;flex:1 1 100%;font-size:11px}" +
      ".mn-card{background:var(--panel-2,var(--panel-3));border:1px solid var(--line);border-radius:6px;padding:8px;min-width:0}" +
      ".mn-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}" +
      ".mn-head h4{margin:0 8px 0 0;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}" +
      ".mn-chip,.mn-btn{font:inherit;font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid var(--line);" +
      "background:var(--panel-3);color:var(--muted);cursor:pointer}" +
      ".mn-chip.on{color:var(--text);border-color:var(--text)}" +
      ".mn-btn.on{background:var(--warn);color:#000;border-color:var(--warn)}" +
      ".mn-sp{flex:1}" +
      ".mn-cnt{color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".mn-scroll{height:170px;overflow:auto;border:1px solid var(--line);border-radius:4px;position:relative}" +
      ".mn-scroll table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}" +
      ".mn-scroll th{position:sticky;top:0;background:var(--panel-3);text-align:left;font-weight:600;color:var(--muted);" +
      "padding:2px 6px;border-bottom:1px solid var(--line)}" +
      ".mn-scroll td{padding:1px 6px;white-space:nowrap;border-bottom:1px solid var(--line)}" +
      ".mn-time{color:var(--muted);width:4.5em}.mn-ch{width:2.2em;text-align:center}.mn-kind{width:7.5em}" +
      ".mn-value{position:relative;width:7em;text-align:right}" +
      ".mn-value i{position:absolute;left:0;bottom:0;height:2px;background:var(--sig-gate);opacity:.7}" +
      "tr.mn-t0 .mn-kind{color:var(--sig-gate)}tr.mn-t1 .mn-kind{color:var(--muted)}tr.mn-t3 .mn-kind{color:var(--mod)}" +
      "tr.mn-t7{color:var(--muted)}" +
      ".mn-empty{position:absolute;inset:26px 0 0 0;display:flex;align-items:center;justify-content:center;" +
      "color:var(--muted);text-align:center;padding:0 12px;pointer-events:none}" +
      ".mn-keys{width:100%;height:34px;margin-top:6px;display:block}" +
      ".mn-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}" +
      ".mn-card canvas{width:100%;display:block}" +
      ".mn-audio canvas{height:64px;cursor:pointer}.mn-cvc{height:70px}.mn-gc{height:22px;border-radius:3px}" +
      ".mn-big{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1}" +
      ".mn-sub{color:var(--muted);font-variant-numeric:tabular-nums;min-height:1.3em}" +
      ".mn-grid{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;margin-top:4px;font-variant-numeric:tabular-nums}" +
      ".mn-grid span:nth-child(odd){color:var(--muted)}.mn-grid span:nth-child(even){text-align:right}" +
      ".mn-lamp{width:14px;height:14px;border-radius:50%;border:1px solid var(--line);background:var(--panel-3);display:inline-block;" +
      "vertical-align:-2px;margin-right:6px}.mn-lamp.on{background:var(--sig-gate);border-color:var(--sig-gate);box-shadow:0 0 8px var(--sig-gate)}" +
      ".mn-ach{display:flex;gap:14px;justify-content:center;margin-top:4px}" +
      ".mn-ac{display:grid;grid-template-columns:auto auto auto;gap:0 6px;align-items:center;font-variant-numeric:tabular-nums}" +
      ".mn-ac .mn-clip{grid-row:span 2}" +
      ".mn-ac .mn-cap{color:var(--muted);font-size:9px}" +
      ".mn-clip{width:10px;height:10px;border-radius:50%;border:1px solid var(--line);background:var(--panel-3);padding:0;cursor:pointer}" +
      ".mn-clip.on{background:var(--warn);border-color:var(--warn)}" +
      ".mn-off{opacity:.6}" +
      "</style>" +
      '<div class="mn">' +
      '<div class="mn-card mn-midi"><div class="mn-head"><h4>MIDI</h4><span class="mn-chips"></span><span class="mn-sp"></span>' +
      '<span class="mn-cnt"></span><button class="mn-btn mn-pause" title="Stop adding events to the table">Pause</button>' +
      '<button class="mn-btn mn-clear" title="Empty the table">Clear</button></div>' +
      '<div class="mn-scroll"><table><thead><tr><th>Time</th><th>Ch</th><th>Event</th><th>Number</th><th>Value</th></tr></thead>' +
      '<tbody></tbody></table><div class="mn-empty"></div></div><canvas class="mn-keys" title="The notes that are on now"></canvas></div>' +
      '<div class="mn-row">' +
      '<div class="mn-card mn-audio"><div class="mn-head"><h4>Audio</h4></div><canvas title="Click to reset the peak hold and clip lights"></canvas>' +
      '<div class="mn-ach"></div></div>' +
      '<div class="mn-card mn-cv"><div class="mn-head"><h4>CV</h4></div><div class="mn-big">0.000</div><div class="mn-sub"></div>' +
      '<canvas class="mn-cvc" title="Click to reset the range"></canvas><div class="mn-grid"><span>Min</span><span class="mn-min"></span>' +
      '<span>Max</span><span class="mn-max"></span><span>Range</span><span class="mn-rng"></span></div></div>' +
      '<div class="mn-card mn-gate"><div class="mn-head"><h4>Gate</h4></div><div class="mn-big"><i class="mn-lamp"></i><span class="mn-state">LOW</span></div>' +
      '<canvas class="mn-gc" title="Click to reset the pulse count"></canvas><div class="mn-grid"><span>Pulses</span><span class="mn-pulses"></span>' +
      '<span>Rate</span><span class="mn-rate"></span><span>Length</span><span class="mn-len"></span><span>Duty</span><span class="mn-duty"></span></div></div>' +
      "</div></div>",

    afterBuild(view, el) {
      const q = (s) => el.querySelector(s);
      const m = {
        body: q("tbody"), empty: q(".mn-empty"), keys: q(".mn-keys"), count: q(".mn-cnt"),
        buffer: [], seen: null, missed: 0, paused: false, t0: performance.now(), held: [0, 0, 0, 0],
        patched: false,
        audio: { canvas: q(".mn-audio canvas"), ch: [newChannel(), newChannel()], stereo: false, labels: [], last: 0 },
        cv: { canvas: q(".mn-cvc"), big: q(".mn-big"), sub: q(".mn-sub"), min: 0, max: 0, hasRange: false, now: 0, range: 1,
              lo: new Float32Array(HIST), hi: new Float32Array(HIST), val: new Float32Array(HIST), at: 0, patched: false,
              minEl: q(".mn-min"), maxEl: q(".mn-max"), rngEl: q(".mn-rng") },
        gate: { canvas: q(".mn-gc"), hist: new Float32Array(HIST), at: 0, count: 0, base: 0, state: q(".mn-state"), lamp: q(".mn-lamp"),
                pulses: q(".mn-pulses"), rate: q(".mn-rate"), len: q(".mn-len"), duty: q(".mn-duty"), patched: false },
      };
      view.mon = m;

      const chips = q(".mn-chips");
      for (const f of FILTERS) {
        const b = document.createElement("button");
        b.className = "mn-chip" + (f.on ? " on" : "");
        b.textContent = f.label;
        b.title = "Show or hide " + f.label + " events";
        b.addEventListener("click", () => { f.on = !f.on; b.classList.toggle("on", f.on); rebuild(m); });
        chips.appendChild(b);
      }
      const pause = q(".mn-pause");
      pause.addEventListener("click", () => { m.paused = !m.paused; pause.classList.toggle("on", m.paused); pause.textContent = m.paused ? "Paused" : "Pause"; });
      q(".mn-clear").addEventListener("click", () => { clearTable(m); m.missed = 0; });

      const ach = q(".mn-ach");
      m.audio.labels = [0, 1].map((k) => {
        const box = document.createElement("div");
        box.className = "mn-ac";
        box.innerHTML = '<button class="mn-clip" title="Clip: a sample over 0 dBFS. Click to reset."></button>' +
          '<span class="mn-peak"></span><span class="mn-cap">peak</span><span class="mn-rms"></span><span class="mn-cap">rms</span>';
        const clip = box.firstChild;
        ach.appendChild(box);
        clip.addEventListener("click", () => resetAudio(view));
        return { box, peak: box.querySelector(".mn-peak"), rms: box.querySelector(".mn-rms"), clip };
      });
      m.audio.canvas.addEventListener("click", () => resetAudio(view));
      m.cv.canvas.addEventListener("click", () => resetCv(view));
      m.gate.canvas.addEventListener("click", () => resetGate(view));
      m.empty.textContent = "Patch a Notes cable into Notes to see MIDI events here.";
      drawKeys(view); drawAudio(view); drawCv(view); drawGate(view);
    },

    onState(st, view) {
      const m = view.mon;
      if (!m || !st) return;
      const now = performance.now(), dt = m.audio.last ? Math.min(0.5, (now - m.audio.last) / 1000) : 0;
      m.audio.last = now;

      // MIDI
      m.patched = !!st.notesPatched;
      m.empty.textContent = m.patched ? "Waiting for MIDI events …" : "Patch a Notes cable into Notes to see MIDI events here.";
      if (st.arrays && st.arrays.midi) takeEvents(view, st.arrays.midi, now);
      if (!m.buffer.length) m.empty.style.display = "";
      m.held = [st.held0 || 0, st.held1 || 0, st.held2 || 0, st.held3 || 0].map((x) => x >>> 0);
      let held = 0;
      for (const w of m.held) { let x = w; while (x) { x &= x - 1; held++; } }
      m.count.textContent = (held ? held + " held · " : "") + (m.missed ? m.missed + " missed · " : "") + m.buffer.length + " events";

      // audio
      const a = m.audio, floor = FLOORS[choice(view, "floor")];
      a.stereo = !!st.stereo;
      [["peakL", "rmsL", "clipL"], ["peakR", "rmsR", "clipR"]].forEach(([pk, rk, ck], k) => {
        const ch = a.ch[k], peak = toDb(st[pk] || 0);
        ch.bar = Math.max(peak, ch.bar - FALL * dt);
        ch.rms = toDb(st[rk] || 0);
        if (peak >= ch.hold) { ch.hold = peak; ch.holdAt = now; }
        else if ((now - ch.holdAt) / 1000 > HOLD) ch.hold = ch.bar;
        if (st[ck]) ch.clip = true;
      });
      m.audio.canvas.parentElement.classList.toggle("mn-off", !st.audioPatched);

      // CV
      const cv = m.cv;
      cv.now = st.cv || 0;
      const lo = Math.min(st.cvLo ?? cv.now, cv.now), hi = Math.max(st.cvHi ?? cv.now, cv.now);
      cv.lo[cv.at] = lo; cv.hi[cv.at] = hi; cv.val[cv.at] = cv.now;
      cv.at = (cv.at + 1) % HIST;
      if (!cv.hasRange) { cv.min = lo; cv.max = hi; cv.hasRange = true; }
      cv.min = Math.min(cv.min, lo); cv.max = Math.max(cv.max, hi);
      cv.big.textContent = num(cv.now);
      cv.sub.textContent = cvNote(cv.now);
      cv.minEl.textContent = num(cv.min);
      cv.maxEl.textContent = num(cv.max);
      cv.rngEl.textContent = "±" + cv.range;
      cv.canvas.parentElement.classList.toggle("mn-off", !st.cvPatched);

      // gate
      const gt = m.gate, high = st.gate > 0.5;
      gt.hist[gt.at] = high ? 1 : st.gateAny ? 0.6 : 0;
      gt.at = (gt.at + 1) % HIST;
      gt.count = st.gateCount || 0;
      if (gt.base > gt.count) gt.base = 0;
      gt.lamp.classList.toggle("on", high || !!st.gateAny);
      gt.state.textContent = high ? "HIGH" : "LOW";
      gt.pulses.textContent = String(gt.count - gt.base);
      const hz = st.gateRate || 0;
      gt.rate.textContent = hz > 0 ? (hz >= 10 ? hz.toFixed(1) : hz.toFixed(2)) + " Hz · " + (hz * 60).toFixed(hz * 60 >= 100 ? 0 : 1) + " BPM" : "–";
      const len = st.gateLength || 0;
      gt.len.textContent = len > 0 ? (len >= 1 ? len.toFixed(2) + " s" : (len * 1000).toFixed(len >= 0.01 ? 0 : 1) + " ms") : "–";
      gt.duty.textContent = Math.round((st.gateDuty || 0) * 100) + " %";
      gt.canvas.parentElement.classList.toggle("mn-off", !st.gatePatched);

      drawKeys(view); drawAudio(view); drawCv(view); drawGate(view);
    },
    onRefresh(view) {
      if (!view.mon) return;
      drawKeys(view); drawAudio(view); drawCv(view); drawGate(view);
    },
  });
})();
