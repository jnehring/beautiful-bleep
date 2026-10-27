// SPDX-License-Identifier: GPL-3.0-or-later
// Audio Console view (doc/specs/modules/audio-console.md §5): a row of channel strips (name, mono/stereo, filters,
// EQ, sends, pan, fader with meter, S / M / R), one strip per aux bus, the master, and below them the Record
// panel: Record, Arm all / Unarm all, the time left, the Setup and Record settings, and the View toggles that
// hide the EQ, filters, sends or the S / M / R buttons. Hidden sections keep working; only the view changes.
(function () {
  "use strict";
  const NCH = 32, NAUX = 4;
  const FALL = 24;  // dB per second, the meters' fall
  const NS = "http://www.w3.org/2000/svg";
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const toDb = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const HIDDEN = /^(ch\d+_|aux\d_|master_)/;
  const VIEW_KEYS = ["eq", "flt", "snd", "btn"];

  // A param's normalised value <-> its units (ParamSpec::fromNormalised / toNormalised).
  function units(p, x) {
    if (p.map === "exp") return p.min * Math.pow(p.max / p.min, x);
    if (p.map !== "skew") return p.min + (p.max - p.min) * x;
    const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
    return x <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(x) / skew);
  }
  function norm(p, v) {
    if (p.map === "exp") return clamp01(Math.log(v / p.min) / Math.log(p.max / p.min));
    if (p.map !== "skew") return clamp01((v - p.min) / (p.max - p.min));
    const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
    const q = (v - p.min) / (p.max - p.min);
    return q <= 0 ? 0 : clamp01(Math.pow(q, skew));
  }
  const signed = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const dbText = (p, x) => {
    const v = units(p, x);
    return v <= p.min + 0.05 ? "−∞" : signed(v, 1);
  };
  const hzText = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : Math.round(v) + "");
  const clock = (s) => {
    s = Math.max(0, Math.round(s));
    return s >= 3600 ? Math.floor(s / 3600) + " h " + Math.floor((s % 3600) / 60) + " min"
      : s >= 60 ? Math.floor(s / 60) + " min " + (s % 60) + " s" : s + " s";
  };
  const bytesText = (b) => (b >= 1e12 ? (b / 1e12).toFixed(1) + " TB" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB");

  const param = (view, id) => view.type.params.find((p) => p.id === id);
  const get = (view, id) => view.node.params[id] ?? param(view, id).default;
  const units_ = (view, id) => units(param(view, id), get(view, id));
  function setValue(view, id, v) {
    v = clamp01(v);
    view.node.params[id] = v;
    view.api.setParam(id, v);
  }

  /// Drag helper: `set(event)` while the pointer is down, after one undo gesture.
  function drag(target, view, set) {
    let on = false;
    target.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      target.setPointerCapture(e.pointerId);
      on = true;
      if (view.ac) view.ac.down = true;
      view.api.beginGesture();
      set(e, true);
    });
    target.addEventListener("pointermove", (e) => { if (on) set(e, false); });
    const end = () => { on = false; if (view.ac) view.ac.down = false; };
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  /// A dial. kind: "pan" (bipolar, C / L / R), "eq" (bipolar, dB), "hp" / "lp" (Hz), "send" (dB, from the left).
  function dial(view, id, caption, kind) {
    const p = param(view, id);
    const box = el("div", "ac-dial");
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 40 40");
    const track = document.createElementNS(NS, "path"), arc = document.createElementNS(NS, "path"), ptr = document.createElementNS(NS, "line");
    track.setAttribute("class", "ac-track"); arc.setAttribute("class", "ac-arc"); ptr.setAttribute("class", "ac-ptr");
    s.append(track, arc, ptr);
    const pt = (r, deg) => {
      const a = (deg - 90) * Math.PI / 180;
      return [20 + r * Math.cos(a), 20 + r * Math.sin(a)];
    };
    const path = (from, to) => {
      if (to < from) [from, to] = [to, from];
      if (to - from < 0.5) to = from + 0.5;
      const [x1, y1] = pt(15, from), [x2, y2] = pt(15, to);
      return `M ${x1} ${y1} A 15 15 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
    };
    track.setAttribute("d", path(-135, 135));
    const text = el("div", "ac-val");
    box.append(s, el("div", "ac-cap", caption), text);
    const bipolar = kind === "pan" || kind === "eq";
    const d = { box, id };
    d.draw = () => {
      const v = get(view, id), a = -135 + 270 * v;
      arc.setAttribute("d", path(bipolar ? 0 : -135, a));
      const [x1, y1] = pt(6, a), [x2, y2] = pt(13, a);
      ptr.setAttribute("x1", x1); ptr.setAttribute("y1", y1); ptr.setAttribute("x2", x2); ptr.setAttribute("y2", y2);
      const u = units(p, v);
      text.textContent = kind === "pan" ? (Math.abs(u) < 0.01 ? "C" : (u < 0 ? "L" : "R") + Math.round(Math.abs(u) * 100))
        : kind === "eq" ? signed(u, 1)
        : kind === "hp" ? (u <= 20.5 ? "Off" : hzText(u))
        : kind === "lp" ? (u >= 19500 ? "Off" : hzText(u))
        : dbText(p, v);
    };
    let startY = 0, startV = 0;
    drag(s, view, (e, first) => {
      if (first) { startY = e.clientY; startV = get(view, id); }
      setValue(view, id, startV + (startY - e.clientY) / (e.shiftKey ? 1000 : 200));
      d.draw();
    });
    s.addEventListener("dblclick", () => { view.api.beginGesture(); setValue(view, id, p.default); d.draw(); });
    s.addEventListener("wheel", (e) => {
      e.preventDefault();
      setValue(view, id, get(view, id) - e.deltaY / (e.shiftKey ? 3000 : 600));
      d.draw();
    }, { passive: false });
    d.draw();
    return d;
  }

  /// A toggle button bound to a setting. `cls` is the colour class (solo, mute, arm).
  function toggle(view, id, label, title, cls) {
    const b = el("button", "ac-btn " + (cls || ""), label);
    b.title = title;
    b.addEventListener("click", () => {
      view.api.beginGesture();
      setValue(view, id, get(view, id) >= 0.5 ? 0 : 1);
      b.classList.toggle("on", get(view, id) >= 0.5);
      view.ac.armed();
    });
    return { box: b, draw: () => b.classList.toggle("on", get(view, id) >= 0.5) };
  }

  /// A vertical fader with a meter beside it; the meter shares the fader's taper, so 0 dB lines up on both.
  function fader(view, id, bars) {
    const p = param(view, id);
    const box = el("div", "ac-fader");
    const track = el("div", "ac-ftrack"), fill = el("div", "ac-ffill"), knob = el("div", "ac-fknob"), zero = el("div", "ac-fzero");
    zero.style.bottom = norm(p, 0) * 100 + "%";
    const meters = el("div", "ac-meters");
    const bar = [];
    for (let i = 0; i < bars; i++) {
      const m = el("div", "ac-meter"), lvl = el("div", "ac-mlvl"), hold = el("div", "ac-mhold"), clip = el("div", "ac-mclip");
      clip.title = "Clip: over 0 dBFS. Click to reset.";
      clip.addEventListener("click", () => { for (const b of bar) { b.clipped = false; b.hold = -200; } });
      m.append(lvl, hold);
      meters.append(m, clip);
      bar.push({ lvl, holdEl: hold, clip, db: -200, hold: -200, holdAt: 0, clipped: false });
    }
    // A cable dropped on the fader modulates it (the board finds .bv-target); the bar shows the modulated value.
    box.classList.add("bv-target");
    box.dataset.param = id;
    const mod = el("div", "ac-fmod");
    mod.hidden = true;
    const amounts = el("div", "ac-amounts");
    track.append(fill, mod, zero, knob);
    const text = el("div", "ac-val");
    const row = el("div", "ac-frow");
    row.append(track, meters);
    box.append(row, text, amounts);
    const f = { box, id, eff: null };
    f.draw = () => {
      const v = get(view, id);
      fill.style.height = v * 100 + "%";
      knob.style.bottom = v * 100 + "%";
      text.textContent = dbText(p, v);
      mod.hidden = f.eff === null;
      if (f.eff !== null) {
        mod.style.bottom = Math.min(v, f.eff) * 100 + "%";
        mod.style.height = Math.abs(f.eff - v) * 100 + "%";
      }
    };
    /// One chip per cable into the fader: drag to set its amount, × removes the cable.
    // A refresh during an amount drag (beginGesture answers with the board) must not replace the chip under the pointer: it re-renders on release.
    let chipDrag = false, stale = false;
    f.renderAmounts = () => {
      if (chipDrag) { stale = true; return; }
      stale = false;
      amounts.innerHTML = "";
      if (!view.api.cablesInto) return;
      for (const c of view.api.cablesInto(id)) {
        const chip = el("div", "ac-amount");
        chip.title = c.label + ": drag up/down to change the amount, double-click to reset";
        const pct = el("span");
        const show = () => (pct.textContent = Math.round(c.amount * 100) + "%");
        show();
        const x = el("button", "", "×");
        x.title = "Remove cable";
        x.addEventListener("pointerdown", (e) => e.stopPropagation());
        x.addEventListener("click", (e) => { e.stopPropagation(); view.api.removeCable(c.id); });
        chip.append(pct, x);
        let y0 = null, a0 = 0;
        chip.addEventListener("pointerdown", (e) => { y0 = e.clientY; a0 = c.amount; chipDrag = true; chip.setPointerCapture(e.pointerId); view.api.beginGesture(); });
        chip.addEventListener("pointermove", (e) => {
          if (y0 === null) return;
          c.amount = Math.round(clamp01((a0 + 1) / 2 + (y0 - e.clientY) / (e.shiftKey ? 1000 : 100)) * 2000 - 1000) / 1000;
          show();
          view.api.setAmount(c.id, c.amount);
        });
        const end = () => { y0 = null; chipDrag = false; if (stale) f.renderAmounts(); };
        chip.addEventListener("pointerup", end);
        chip.addEventListener("pointercancel", end);
        chip.addEventListener("dblclick", () => { view.api.beginGesture(); c.amount = 1; show(); view.api.setAmount(c.id, 1); });
        amounts.appendChild(chip);
      }
    };
    f.renderAmounts();
    (view.faders = view.faders || []).push(f);
    drag(track, view, (e) => {
      const r = track.getBoundingClientRect();
      setValue(view, id, 1 - (e.clientY - r.top) / r.height);
      f.draw();
    });
    track.addEventListener("dblclick", () => { view.api.beginGesture(); setValue(view, id, p.default); f.draw(); });
    track.addEventListener("wheel", (e) => {
      e.preventDefault();
      setValue(view, id, get(view, id) - e.deltaY / (e.shiftKey ? 3000 : 600));
      f.draw();
    }, { passive: false });
    /// One peak per bar (linear); `dt` seconds since the last call.
    f.meter = (peaks, dt, now) => {
      bar.forEach((b, i) => {
        const db = toDb(peaks[i] || 0);
        b.db = Math.max(db, b.db - FALL * dt);
        if (db >= b.hold) { b.hold = db; b.holdAt = now; }
        else if (now - b.holdAt > 1.5) b.hold = Math.max(b.db, b.hold - FALL * dt);
        if (db > 0) b.clipped = true;
        b.lvl.style.height = norm(p, b.db) * 100 + "%";
        b.lvl.classList.toggle("hot", b.db > 0);
        b.lvl.classList.toggle("warm", b.db > -6 && b.db <= 0);
        b.holdEl.style.bottom = norm(p, b.hold) * 100 + "%";
        b.holdEl.hidden = b.hold <= p.min;
        b.clip.classList.toggle("on", b.clipped);
      });
    };
    f.draw();
    return f;
  }

  const section = (cls) => el("div", "ac-sec " + cls);

  function channelStrip(view, k) {
    const n = k + 1, pre = "ch" + n + "_";
    const strip = el("div", "ac-strip");
    const name = el("input", "ac-name");
    name.maxLength = 24;
    name.placeholder = "Ch " + n;
    name.title = "Channel name; it names the recorded file";
    name.addEventListener("change", () => view.ac.rename(k, name.value));
    name.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") name.blur(); });
    const stereo = toggle(view, pre + "stereo", "Mono", "Mono or stereo: stereo reads In R too and the pan becomes a balance", "mode");
    const flt = section("flt"), eq = section("eq"), snd = section("snd");
    const hp = dial(view, pre + "hp", "HP", "hp"), lp = dial(view, pre + "lp", "LP", "lp");
    flt.append(hp.box, lp.box);
    const hi = dial(view, pre + "hi", "Hi", "eq"), mid = dial(view, pre + "mid", "Mid", "eq"), lo = dial(view, pre + "lo", "Lo", "eq");
    eq.append(hi.box, mid.box, lo.box);
    const sends = [];
    for (let j = 1; j <= NAUX; j++) {
      const s = dial(view, pre + "send" + j, "Snd " + j, "send");
      s.box.dataset.aux = j;
      sends.push(s);
      snd.append(s.box);
    }
    const pan = dial(view, pre + "pan", "Pan", "pan");
    const fad = fader(view, pre + "level", 1);
    const body = section("body");
    body.append(pan.box, fad.box);
    const solo = toggle(view, pre + "solo", "S", "Solo", "solo");
    const mute = toggle(view, pre + "mute", "M", "Mute", "mute");
    const arm = toggle(view, pre + "arm", "R", "Record arm", "arm");
    const btn = section("btn");
    const grid = el("div", "ac-b3");
    grid.append(solo.box, mute.box, arm.box);
    btn.append(grid);
    strip.append(name, stereo.box, flt, eq, snd, body, btn);
    const draws = [stereo, hp, lp, hi, mid, lo, ...sends, pan, fad, solo, mute, arm];
    return {
      box: strip, name, fader: fad, sends, arm, stereo,
      draw() {
        for (const d of draws) d.draw();
        const st = get(view, pre + "stereo") >= 0.5;
        stereo.box.textContent = st ? "Stereo" : "Mono";
        pan.box.querySelector(".ac-cap").textContent = st ? "Bal" : "Pan";
      },
    };
  }

  function auxStrip(view, j) {
    const n = j + 1, pre = "aux" + n + "_";
    const strip = el("div", "ac-strip ac-aux");
    strip.append(el("div", "ac-title", "Aux " + n), el("div", "ac-sub", "Send / return"));
    const bal = dial(view, pre + "bal", "Bal", "pan");
    const fad = fader(view, pre + "return", 2);
    const body = section("body");
    body.append(bal.box, fad.box);
    const mute = toggle(view, pre + "mute", "M", "Mute the return", "mute");
    const arm = toggle(view, pre + "arm", "R", "Record arm: records the send bus", "arm");
    const btn = section("btn");
    const grid = el("div", "ac-b3");
    grid.append(el("i"), mute.box, arm.box);
    btn.append(grid);
    strip.append(body, btn);
    const draws = [bal, fad, mute, arm];
    return { box: strip, fader: fad, draw() { for (const d of draws) d.draw(); } };
  }

  function masterStrip(view) {
    const strip = el("div", "ac-strip ac-master");
    strip.append(el("div", "ac-title", "Master"), el("div", "ac-sub", "Stereo"));
    const flt = section("flt"), eq = section("eq");
    const hp = dial(view, "master_hp", "HP", "hp"), lp = dial(view, "master_lp", "LP", "lp");
    flt.append(hp.box, lp.box);
    const hi = dial(view, "master_hi", "Hi", "eq"), mid = dial(view, "master_mid", "Mid", "eq"), lo = dial(view, "master_lo", "Lo", "eq");
    eq.append(hi.box, mid.box, lo.box);
    const bal = dial(view, "master_bal", "Bal", "pan");
    const fad = fader(view, "master_level", 2);
    const body = section("body");
    body.append(bal.box, fad.box);
    const mute = toggle(view, "master_mute", "M", "Mute the main output", "mute");
    const arm = toggle(view, "master_arm", "R", "Record arm: records the main output", "arm");
    const btn = section("btn");
    const grid = el("div", "ac-b3");
    grid.append(el("i"), mute.box, arm.box);
    btn.append(grid);
    const gr = el("div", "ac-gr");
    strip.append(flt, eq, body, btn, gr);
    const draws = [hp, lp, hi, mid, lo, bal, fad, mute, arm];
    return { box: strip, fader: fad, gr, draw() { for (const d of draws) d.draw(); } };
  }

  BleepViews.register("audio-console", {
    width: 940,
    partNames: ["Console strips", "Record"],
    partSizes: [[48, 14], [48, 8]],
    layout: [
      { title: "Setup", params: ["channels", "aux", "directs", "directpoint", "mono", "limiter", "sendpoint1", "sendpoint2", "sendpoint3", "sendpoint4"] },
      { title: "Record settings", params: ["recmode", "recformat", "rectap"] },
    ],
    hideParams: (() => {
      const ids = [];
      for (let k = 1; k <= NCH; k++)
        for (const f of ["level", "pan", "hp", "lp", "lo", "mid", "hi", "send1", "send2", "send3", "send4", "mute", "solo", "arm", "stereo"]) ids.push("ch" + k + "_" + f);
      for (let j = 1; j <= NAUX; j++) for (const f of ["return", "bal", "mute", "arm"]) ids.push("aux" + j + "_" + f);
      for (const f of ["level", "bal", "hp", "lp", "lo", "mid", "hi", "mute", "arm"]) ids.push("master_" + f);
      return ids;
    })(),
    template:
      "<style>" +
      ".ac{display:flex;flex-direction:column;gap:10px;flex:1 1 100%;min-width:0}" +
      ".ac-strips{display:flex;gap:6px;align-items:stretch;overflow-x:auto;padding-bottom:4px}" +
      ".ac-strip{flex:0 0 auto;width:108px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 4px;" +
      "background:var(--panel-2,var(--panel-3));border:1px solid var(--line);border-radius:6px}" +
      ".ac-master{width:112px;border-color:var(--accent)}.ac-aux{border-color:var(--muted)}" +
      ".ac-title{font-size:12px;font-weight:600;color:var(--text)}.ac-sub{font-size:10px;color:var(--muted);text-transform:uppercase}" +
      ".ac-name{width:96px;box-sizing:border-box;text-align:center;font-size:12px;font-weight:600;color:var(--text);background:transparent;" +
      "border:1px solid transparent;border-radius:4px;padding:1px 2px}" +
      ".ac-folder{width:100%;max-width:340px;box-sizing:border-box;font-size:11px;color:var(--text);background:var(--panel-3);border:1px solid var(--line);border-radius:4px;padding:3px 6px}" +
      ".ac-name:hover,.ac-name:focus{border-color:var(--line);background:var(--panel-3)}" +
      ".ac-sec{width:100%;display:flex;flex-wrap:wrap;gap:2px 2px;justify-content:center;border-top:1px solid var(--line);padding-top:5px}" +
      ".ac-sec.body{flex-direction:column;align-items:center}" +
      ".ac-hide-eq .ac-sec.eq,.ac-hide-flt .ac-sec.flt,.ac-hide-snd .ac-sec.snd,.ac-hide-btn .ac-sec.btn{display:none}" +
      ".ac-dial{display:flex;flex-direction:column;align-items:center;width:30px;gap:0}" +
      ".ac-dial svg{width:28px;height:28px;cursor:ns-resize;touch-action:none}" +
      ".ac-track{fill:none;stroke:var(--line);stroke-width:3;stroke-linecap:round}" +
      ".ac-arc{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round}" +
      ".ac-ptr{stroke:var(--text);stroke-width:2;stroke-linecap:round}" +
      ".ac-cap{font-size:9px;color:var(--muted);text-transform:uppercase}" +
      ".ac-val{font-size:10px;font-variant-numeric:tabular-nums;color:var(--text);text-align:center;min-height:1.2em}" +
      ".ac-b3{display:grid;grid-template-columns:repeat(3,26px);gap:4px;justify-content:center}" +
      ".ac-btn{font-size:11px;font-weight:600;height:24px;padding:0 8px;border:1.5px solid var(--muted);border-radius:5px;" +
      "background:var(--panel-3);color:var(--text);cursor:pointer}" +
      ".ac-btn:hover{border-color:var(--text)}" +
      ".ac-b3 .ac-btn{padding:0;width:26px}.ac-b3 i{width:26px;height:24px}" +
      ".ac-btn.on{background:var(--accent);color:#000;border-color:var(--accent)}" +
      ".ac-btn.solo{color:#fde047;border-color:#fde047}.ac-btn.solo.on{background:#fde047;color:#1c1700}" +
      ".ac-btn.mute{color:var(--warn);border-color:var(--warn)}.ac-btn.mute.on{background:var(--warn);color:#1c0d00}" +
      ".ac-btn.arm{color:#fca5a5;border-color:#fca5a5}.ac-btn.arm.on{background:#ef4444;border-color:#ef4444;color:#fff}" +
      ".ac-btn.mode{width:62px}" +
      ".ac-frow{display:flex;gap:6px;justify-content:center;height:112px}" +
      ".ac-fader{display:flex;flex-direction:column;align-items:center;gap:2px}" +
      ".ac-ftrack{position:relative;width:22px;height:100%;cursor:ns-resize;touch-action:none}" +
      ".ac-ftrack::before{content:'';position:absolute;left:9px;width:4px;top:0;bottom:0;background:var(--line);border-radius:2px}" +
      ".ac-ffill{position:absolute;left:9px;width:4px;bottom:0;background:var(--accent);border-radius:2px}" +
      ".ac-fzero{position:absolute;left:3px;right:3px;height:1px;background:var(--muted)}" +
      ".ac-fmod{position:absolute;left:8px;width:6px;border-radius:3px;background:var(--mod);opacity:.85}" +
      ".ac-fader.drop-ok{outline:1px solid var(--accent);border-radius:6px}" +
      ".ac-fader.drop-hover{outline:2px solid var(--mod);border-radius:6px}" +
      ".ac-amounts{display:flex;flex-direction:column;gap:2px;width:100%}" +
      ".ac-amount{display:flex;align-items:center;justify-content:center;gap:3px;max-width:100%;overflow:hidden;font-size:9px;background:var(--panel);border-radius:4px;padding:0 3px;" +
      "cursor:ns-resize;color:var(--mod);touch-action:none}" +
      ".ac-amount button{background:none;border:0;color:var(--muted);cursor:pointer;padding:0;font-size:11px}" +
      ".ac-fknob{position:absolute;left:1px;right:1px;height:10px;margin-bottom:-5px;border-radius:3px;background:var(--text);border:1px solid var(--line)}" +
      ".ac-meters{display:flex;gap:2px;position:relative;padding-top:8px}" +
      ".ac-meter{position:relative;width:9px;background:var(--panel-3);border:1px solid var(--line);border-radius:2px;overflow:hidden;align-self:stretch}" +
      ".ac-mlvl{position:absolute;left:0;right:0;bottom:0;background:var(--sig-gate)}" +
      ".ac-mlvl.warm{background:var(--mod)}.ac-mlvl.hot{background:var(--warn)}" +
      ".ac-mhold{position:absolute;left:0;right:0;height:2px;background:var(--text)}" +
      ".ac-mclip{position:absolute;top:0;width:9px;height:5px;border-radius:1px;background:var(--panel-3);cursor:pointer}" +
      ".ac-mclip.on{background:var(--warn)}" +
      ".ac-gr{font-size:9px;color:var(--muted);font-variant-numeric:tabular-nums;min-height:1.2em}" +
      ".ac-rec{background:var(--panel-2,var(--panel-3));border-radius:10px;padding:12px 16px;display:flex;flex-direction:column;gap:10px}" +
      ".ac-rt{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}" +
      ".ac-cols{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-start}" +
      ".ac-col{display:flex;flex-direction:column;gap:6px}.ac-col+.ac-col{border-left:1px solid var(--line);padding-left:20px}" +
      ".ac-gl{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}" +
      ".ac-row{display:flex;gap:6px}" +
      ".ac-recbtn{height:36px;padding:0 16px;font-size:13px;font-weight:600;border:1.5px solid var(--text);border-radius:6px;background:var(--panel-3);color:var(--text);cursor:pointer}" +
      ".ac-recbtn.live{border-color:#fca5a5;color:#fca5a5}.ac-recbtn.on{background:#ef4444;border-color:#ef4444;color:#fff}" +
      ".ac-time{font-size:20px;font-variant-numeric:tabular-nums}" +
      ".ac-small{font-size:11px;color:var(--muted)}.ac-warn{color:var(--warn)}" +
      ".ac-list{display:flex;flex-direction:column;gap:6px;margin-top:4px}" +
      ".ac-item{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text)}.ac-item .ac-btn{height:22px}" +
      ".ac-bar{height:5px;background:var(--line);border-radius:3px;overflow:hidden;width:150px}.ac-bar div{height:100%;background:var(--accent)}" +
      ".ac-chip{font-size:11px;font-weight:600;height:24px;padding:0 10px;border:1.5px solid var(--muted);border-radius:5px;background:var(--panel-3);color:var(--text);cursor:pointer}" +
      ".ac-chip.on{background:var(--accent);color:#000;border-color:var(--accent)}" +
      "</style>" +
      '<div class="ac"><div class="ac-strips"></div><div class="ac-rec"></div></div>',
    afterBuild(view, el0) {
      const root = el0.querySelector(".ac");
      const strips = root.querySelector(".ac-strips"), rec = root.querySelector(".ac-rec");
      const ac = (view.ac = { root, down: false, last: 0, ch: [], aux: [], st: {} });
      const nodeData = () => (view.node.data && typeof view.node.data === "object" ? view.node.data : {});
      const show = () => Object.assign({ eq: 1, flt: 1, snd: 1, btn: 1 }, nodeData().view || {});
      const saveData = (d) => { view.node.data = d; view.api.setData(d); };
      ac.rename = (k, v) => {
        const names = (nodeData().names || []).slice();
        while (names.length < NCH) names.push("");
        names[k] = v.trim().slice(0, 24);
        saveData(Object.assign({}, nodeData(), { names }));
      };

      for (let k = 0; k < NCH; k++) { const s = channelStrip(view, k); ac.ch.push(s); strips.appendChild(s.box); }
      for (let j = 0; j < NAUX; j++) { const s = auxStrip(view, j); ac.aux.push(s); strips.appendChild(s.box); }
      ac.master = masterStrip(view);
      strips.appendChild(ac.master.box);

      // ---- the Record panel -------------------------------------------------------------------------------------------
      rec.append(el("div", "ac-rt", "Record"));
      const cols = el("div", "ac-cols");
      const c1 = el("div", "ac-col"), c2 = el("div", "ac-col"), c3 = el("div", "ac-col");
      const recBtn = el("button", "ac-recbtn", "Record");
      recBtn.addEventListener("click", () => view.api.command("record", 1));
      const armRow = el("div", "ac-row");
      const armAll = el("button", "ac-btn", "Arm all"), unarm = el("button", "ac-btn", "Unarm all");
      armRow.append(armAll, unarm);
      const armed = el("div", "ac-small");
      c1.append(recBtn, armRow, armed);
      const left = el("div", "ac-time", "-"), leftLabel = el("div", "ac-gl", "Time left"), bar = el("div", "ac-bar"), barFill = el("div");
      bar.append(barFill);
      const where = el("div", "ac-small"), msg = el("div", "ac-small ac-warn");
      const list = el("div", "ac-list");  // recordings the browser holds, to download (Bleep Play)
      // Where this console records: empty uses the folder chosen in Settings (shown as the hint). Not in the browser, which keeps recordings in memory.
      const folder = el("input", "ac-folder");
      folder.type = "text";
      folder.spellcheck = false;
      folder.title = "The folder this console records to: a full path. Leave it empty to use the Recordings folder from Settings.";
      folder.addEventListener("change", () => {
        const d = Object.assign({}, nodeData());
        d.folder = folder.value.trim();
        saveData(d);
      });
      const folderRow = el("div", "ac-row");
      const choose = el("button", "ac-btn", "Choose…");
      choose.title = "Pick the folder this console records to";
      choose.addEventListener("click", async () => {
        const picked = await view.api.chooseFolder(nodeData().folder || folder.placeholder || "");
        if (picked) { folder.value = picked; folder.dispatchEvent(new Event("change")); }
      });
      choose.style.display = view.api.chooseFolder ? "" : "none";
      folderRow.append(folder, choose);
      c2.append(leftLabel, left, bar, folderRow, where, msg, list);
      const viewGroup = el("div", "ac-col");
      viewGroup.append(el("div", "ac-gl", "View"));
      const chips = el("div", "ac-row");
      const chipEls = {};
      for (const [key, label] of [["eq", "EQ"], ["flt", "Filters"], ["snd", "Sends"], ["btn", "S / M / R"]]) {
        const c = el("button", "ac-chip", label);
        c.addEventListener("click", () => {
          const v = show();
          v[key] = v[key] ? 0 : 1;
          saveData(Object.assign({}, nodeData(), { view: v }));
          ac.layout();
        });
        chipEls[key] = c;
        chips.append(c);
      }
      viewGroup.append(chips);
      cols.append(c1, c2, c3, viewGroup);
      rec.append(cols);
      ac.settingsHost = c3;  // the Setup and Record settings sections are moved in here once the controls exist
      const setups = el("div", "ac-cols");
      ac.setups = setups;
      rec.append(setups);

      const count = () => Math.round(units_(view, "channels")), auxCount = () => Math.round(units_(view, "aux"));
      const setAll = (on) => {
        view.api.beginGesture();
        for (let k = 0; k < count(); k++) setValue(view, "ch" + (k + 1) + "_arm", on);
        for (let j = 0; j < auxCount(); j++) setValue(view, "aux" + (j + 1) + "_arm", on);
        setValue(view, "master_arm", on);
        ac.draw();
      };
      armAll.addEventListener("click", () => setAll(1));
      unarm.addEventListener("click", () => setAll(0));

      ac.armed = () => {
        let tracks = 0, frames = 0;
        const add = (id, ch) => { if (get(view, id) >= 0.5) { tracks++; frames += ch; } };
        for (let k = 0; k < count(); k++) add("ch" + (k + 1) + "_arm", get(view, "ch" + (k + 1) + "_stereo") >= 0.5 ? 2 : 1);
        for (let j = 0; j < auxCount(); j++) add("aux" + (j + 1) + "_arm", 2);
        add("master_arm", 2);
        armed.textContent = tracks + (tracks === 1 ? " track armed" : " tracks armed");
        ac.tracks = tracks;
        ac.frames = frames;
      };
      ac.layout = () => {
        const n = count(), a = auxCount(), v = show();
        ac.ch.forEach((s, k) => { s.box.style.display = k < n ? "" : "none"; s.sends.forEach((d, j) => { d.box.style.display = j < a ? "" : "none"; }); });
        ac.aux.forEach((s, j) => { s.box.style.display = j < a ? "" : "none"; });
        for (const key of VIEW_KEYS) {
          root.classList.toggle("ac-hide-" + key, !v[key]);
          chipEls[key].classList.toggle("on", !!v[key]);
        }
        const names = nodeData().names || [];
        ac.ch.forEach((s, k) => { if (document.activeElement !== s.name) s.name.value = names[k] || ""; });
        ac.armed();
      };
      ac.draw = () => {
        for (const s of ac.ch) s.draw();
        for (const s of ac.aux) s.draw();
        ac.master.draw();
        ac.layout();
      };

      let shown = "";
      /// The recordings the browser keeps (view.api.recordings: only in Bleep Play), with their Download and Discard buttons.
      let dlError = "";
      const showList = (items) => {
        const key = JSON.stringify(items);
        if (key === shown) return;
        shown = key;
        list.textContent = "";
        for (const r of items) {
          const row = el("div", "ac-item");
          const when = new Date(r.startedAt);
          row.append(el("span", "", r.name + " " + when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " · " + clock(r.seconds) + " · " +
            r.tracks + (r.tracks === 1 ? " track" : " tracks") + (r.takes > 1 ? ", " + r.takes + " takes" : "") + " · " + bytesText(r.bytes)));
          const dl = el("button", "ac-btn", "Download .zip"), rm = el("button", "ac-btn", "Discard");
          dl.title = "One zip with a WAV file for every track of every take";
          dl.addEventListener("click", async () => {
            const res = await view.api.downloadRecording(r.id);
            dlError = res && res.error ? res.error : "";   // state() rewrites msg on every tick: keep this one until the next try
            msg.textContent = dlError;
            // Some browsers or extensions swallow a script-started download: leave a plain link, which they treat as a click
            const old = row.querySelector("a.ac-dl");
            if (old) old.remove();
            if (res && res.url) {
              const a = el("a", "ac-btn ac-dl", "Save " + res.name);
              a.href = res.url; a.download = res.name;
              row.append(a);
            }
          });
          rm.title = "Frees the memory it uses";
          rm.addEventListener("click", () => view.api.discardRecording(r.id));
          row.append(dl, rm);
          list.append(row);
        }
      };
      ac.state = (st) => {
        const free = st.recFree || 0, rate = st.recRate || 0, state = st.recState || 0;
        const held = view.api.recordings ? view.api.recordings() : null;   // an array in the browser, where recordings are kept in memory
        const web = held !== null && held !== undefined;
        if (web) showList(held);
        folderRow.style.display = web ? "none" : "";
        if (document.activeElement !== folder) folder.value = nodeData().folder || "";
        folder.placeholder = nodeData().folder ? "" : (st.recFolder || "Folder, or empty for the Settings folder");
        recBtn.textContent = state === 0 ? "Record" : "Stop";
        recBtn.classList.toggle("on", state === 2);
        recBtn.classList.toggle("live", state === 1);
        const follow = Math.round(units_(view, "recmode")) === 1;
        const total = rate > 0 ? free / rate : 0;
        leftLabel.textContent = state === 2 ? "Recording " + clock(st.recSeconds || 0) + (st.recTake > 1 ? ", take " + st.recTake : "")
          : state === 1 ? (follow ? "Waiting for the transport" : "Starting") : "Time left";
        left.textContent = !st.recAvailable ? (web ? "Memory is full" : "Not available here") : rate > 0 ? clock(total) : "No track armed";
        barFill.style.width = rate > 0 && state === 2 ? Math.min(100, ((st.recSeconds || 0) / ((st.recSeconds || 0) + total || 1)) * 100) + "%" : "0%";
        where.textContent = web ? "In memory: the recording is offered as a download when you stop" + (free ? "  ·  " + bytesText(free) + " left" : "")
          : st.recAvailable ? (state ? (st.recSession || st.recFolder || "") : (st.recFolder || "")) + (free ? "  ·  " + bytesText(free) + " free" : "") : "";
        msg.textContent = dlError || (st.recFailed && !st.recMessage ? (web ? "The memory budget is used up. The recording stopped: download it before you start another." : "Recording stopped.") : st.recMessage || "");
      };
      ac.draw();
    },
    onState(st, view) {
      const ac = view.ac;
      if (!ac || !st) return;
      // Hidden params are not synced by the generic view: take them from the state.
      if (st.params) {
        for (const f of view.faders) {  // the modulated position of each fader (a = a cable drives it, e = its effective value)
          const ps = st.params[f.id];
          f.eff = ps && ps.a ? ps.e : null;
        }
      }
      if (st.params && !ac.down) {
        for (const [id, ps] of Object.entries(st.params)) if (HIDDEN.test(id)) view.node.params[id] = ps.v;
        ac.draw();
      }
      const now = performance.now() / 1000, dt = ac.last ? Math.min(0.5, now - ac.last) : 0;
      ac.last = now;
      ac.ch.forEach((s, k) => s.fader.meter([st["peak" + (k + 1)]], dt, now));
      ac.aux.forEach((s, j) => s.fader.meter([st["auxPeak" + (j + 1)], st["auxPeak" + (j + 1)]], dt, now));
      ac.master.fader.meter([st.masterL, st.masterR], dt, now);
      const g = toDb(st.gr ?? 1);
      ac.master.gr.textContent = g < -0.1 ? "GR " + g.toFixed(1) + " dB" : "";
      ac.state(st);
      const generic = view.root.querySelector(".bv-buttons");  // the Record button is drawn in the Record panel
      if (generic && generic.style.display !== "none") generic.style.display = "none";
      if (!ac.moved) {  // the generic controls (Setup, Record settings) belong in the Record panel
        const secs = [...view.root.querySelectorAll(".bv-sec")].filter((s) => {
          const t = s.querySelector(".bv-sec-title");
          return t && (t.textContent === "Setup" || t.textContent === "Record settings");
        });
        if (secs.length) { for (const s of secs) ac.setups.appendChild(s); ac.moved = true; }
      }
    },
    onRefresh(view) {
      if (!view.ac) return;
      for (const f of view.faders) f.renderAmounts();
      view.ac.draw();
    },
  });
})();
