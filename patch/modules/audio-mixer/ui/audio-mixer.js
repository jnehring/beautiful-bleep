// SPDX-License-Identifier: GPL-3.0-only
// Audio Mixer view (doc/specs/modules/audio-mixer.md): a horizontal row of channel
// strips, each with Pan (dial), Send (dial), Mute / Solo and a Level fader with
// its own level meter, then a master strip (fader, stereo meter, Limiter, Mono).
(function () {
  "use strict";
  const N = 8;  // the most channels; the Channels setting picks how many show
  const STRIP_W = 100;
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

  // A param's normalised value <-> its units (ParamSpec::fromNormalised / toNormalised).
  function units(p, x) {
    if (p.map !== "skew") return p.min + (p.max - p.min) * x;
    const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
    return x <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(x) / skew);
  }
  function norm(p, v) {
    if (p.map !== "skew") return clamp01((v - p.min) / (p.max - p.min));
    const skew = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
    const q = (v - p.min) / (p.max - p.min);
    return q <= 0 ? 0 : clamp01(Math.pow(q, skew));
  }
  const dbText = (p, x) => {
    const v = units(p, x);
    return v <= p.min + 0.05 ? "−∞" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  };

  // Engine state arrives 30 times a second and can predate an edit: for this long after one, the view keeps its own value.
  const HOLD_MS = 500;

  function setValue(view, id, v) {
    v = clamp01(v);
    view.mixer.edited.set(id, performance.now());  // param id -> time of the last local edit
    view.node.params[id] = v;
    view.api.setParam(id, v);
  }
  const param = (view, id) => view.type.params.find((p) => p.id === id);
  /// Channels in use (an integer param, stored normalised).
  const channels = (view) => Math.min(N, Math.max(1, Math.round(units(param(view, "channels"), get(view, "channels")))));
  const get = (view, id) => view.node.params[id] ?? param(view, id).default;

  /// Drag helper: `set(event)` while the pointer is down, after one undo gesture.
  function drag(target, view, set) {
    let on = false;
    target.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      target.setPointerCapture(e.pointerId);
      on = true;
      if (view.mixer) view.mixer.down = true;
      view.api.beginGesture();
      set(e, true);
    });
    target.addEventListener("pointermove", (e) => { if (on) set(e, false); });
    const end = () => { on = false; if (view.mixer) view.mixer.down = false; };
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    return () => on;
  }

  function dial(view, id, name) {
    const p = param(view, id);
    const box = el("div", "am-dial");
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 40 40");
    const track = document.createElementNS(NS, "path");
    const arc = document.createElementNS(NS, "path");
    const ptr = document.createElementNS(NS, "line");
    track.setAttribute("class", "am-track");
    arc.setAttribute("class", "am-arc");
    ptr.setAttribute("class", "am-ptr");
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
    const text = el("div", "am-val");
    box.append(s, el("div", "am-cap", name), text);
    const def = p.default;
    const dialObj = { box, id, dragging: null };
    dialObj.draw = () => {
      const v = get(view, id), a = -135 + 270 * v;
      // Pan is bipolar: the arc starts at the centre; Send fills from the left.
      arc.setAttribute("d", path(id.startsWith("pan") ? 0 : -135, a));
      const [x1, y1] = pt(6, a), [x2, y2] = pt(13, a);
      ptr.setAttribute("x1", x1); ptr.setAttribute("y1", y1);
      ptr.setAttribute("x2", x2); ptr.setAttribute("y2", y2);
      const u = units(p, v);
      text.textContent = id.startsWith("pan")
        ? (Math.abs(u) < 0.01 ? "C" : (u < 0 ? "L" : "R") + Math.round(Math.abs(u) * 100))
        : dbText(p, v);
    };
    let startY = 0, startV = 0;
    dialObj.dragging = drag(s, view, (e, first) => {
      if (first) { startY = e.clientY; startV = get(view, id); }
      setValue(view, id, startV + (startY - e.clientY) / (e.shiftKey ? 1000 : 200));
      dialObj.draw();
    });
    s.addEventListener("dblclick", () => { view.api.beginGesture(); setValue(view, id, def); dialObj.draw(); });
    s.addEventListener("wheel", (e) => {
      e.preventDefault();
      setValue(view, id, get(view, id) - e.deltaY / (e.shiftKey ? 3000 : 600));
      dialObj.draw();
    }, { passive: false });
    dialObj.draw();
    return dialObj;
  }

  function button(view, id, label, title) {
    const b = el("button", "am-btn", label);
    b.title = title;
    b.addEventListener("click", () => {
      view.api.beginGesture();
      setValue(view, id, get(view, id) >= 0.5 ? 0 : 1);
      b.classList.toggle("on", get(view, id) >= 0.5);
      view.mixer.root.classList.toggle("mono", get(view, "mono") >= 0.5);
    });
    return { box: b, draw: () => b.classList.toggle("on", get(view, id) >= 0.5) };
  }

  /// A vertical fader with `bars` meters beside it; the meters share the fader's
  /// dB taper, so 0 dB lines up on both.
  function fader(view, id, bars) {
    const p = param(view, id);
    const box = el("div", "am-fader");
    const track = el("div", "am-ftrack");
    const fill = el("div", "am-ffill");
    const knob = el("div", "am-fknob");
    const zero = el("div", "am-fzero");
    zero.style.bottom = norm(p, 0) * 100 + "%";
    const meters = el("div", "am-meters");
    const bar = [];
    for (let i = 0; i < bars; i++) {
      const m = el("div", "am-meter");
      const lvl = el("div", "am-mlvl"), hold = el("div", "am-mhold"), clip = el("div", "am-mclip");
      clip.title = "Clip: over 0 dBFS. Click to reset.";
      clip.addEventListener("click", () => { for (const b of bar) { b.clipped = false; b.hold = -200; } });
      m.append(lvl, hold);
      meters.append(m, clip);
      bar.push({ lvl, holdEl: hold, clip, db: -200, hold: -200, holdAt: 0, clipped: false });
    }
    // A cable dropped on the fader modulates it (the board finds .bv-target); the bar shows the modulated value.
    box.classList.add("bv-target");
    box.dataset.param = id;
    const mod = el("div", "am-fmod");
    mod.hidden = true;
    const amounts = el("div", "am-amounts");
    track.append(fill, mod, zero, knob);
    const text = el("div", "am-val");
    box.append(el("div", "am-frow"), text, amounts);
    box.firstChild.append(track, meters);
    const f = { box, id, text, bar, eff: null };
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
        const chip = el("div", "am-amount");
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
    /// Feeds one peak per bar (linear), `dt` seconds since the last call.
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

  BleepViews.register("audio-mixer", {
    width: 610,
    partNames: ["Mixer strips"],
    partSizes: [[35, 10]],
    layout: [{ title: "Send bus", params: ["return"] }],
    hideParams: [].concat(
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => ["level" + k, "pan" + k, "send" + k, "mute" + k, "solo" + k, "sendpoint" + k, "stereo" + k]),
      ["master", "limiter", "mono", "channels"]),
    template:
      "<style>" +
      ".am{display:flex;gap:6px;align-items:stretch;flex:1 1 100%}" +
      ".bleep-view.bv-part .bv-path.am{flex-direction:row;gap:6px}" +   // as a panel part the strips stay side by side
      ".am-strip{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 4px;" +
      "background:var(--panel-2,var(--panel-3));border:1px solid var(--line);border-radius:6px;min-width:0}" +
      ".am-master{flex:1 1 0;border-color:var(--accent)}" +
      ".am-name{font-size:11px;font-weight:600;color:var(--muted)}" +
      ".am-dial{display:flex;flex-direction:column;align-items:center;gap:1px}" +
      ".am-dial svg{width:40px;height:40px;cursor:ns-resize;touch-action:none}" +
      ".am-track{fill:none;stroke:var(--panel-3);stroke-width:3;stroke-linecap:round}" +
      ".am-arc{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round}" +
      ".am-ptr{stroke:var(--text);stroke-width:2;stroke-linecap:round}" +
      ".am-cap{font-size:9px;color:var(--muted);text-transform:uppercase}" +
      ".am-val{font-size:10px;font-variant-numeric:tabular-nums;color:var(--text);text-align:center;min-height:1.2em}" +
      ".am.mono .am-pan{opacity:.3;pointer-events:none}" +
      ".am-row{display:flex;gap:4px}" +
      ".am-btn{font-size:10px;padding:2px 7px;border:1px solid var(--line);border-radius:4px;background:var(--panel-3);" +
      "color:var(--text);cursor:pointer}" +
      ".am-btn.on{background:var(--accent);color:#000;border-color:var(--accent)}" +
      ".am-btn.mute.on{background:var(--warn);border-color:var(--warn)}" +
      ".am-frow{display:flex;gap:6px;justify-content:center;height:128px}" +
      ".am-body{display:flex;gap:10px;align-items:center;justify-content:center}" +
      ".am-col{display:flex;flex-direction:column;align-items:center;gap:6px}" +
      ".am-fader{display:flex;flex-direction:column;align-items:center;gap:2px}" +
      ".am-ftrack{position:relative;width:22px;height:100%;cursor:ns-resize;touch-action:none}" +
      ".am-ftrack::before{content:'';position:absolute;left:9px;width:4px;top:0;bottom:0;background:var(--panel-3);border-radius:2px}" +
      ".am-ffill{position:absolute;left:9px;width:4px;bottom:0;background:var(--accent);opacity:.7;border-radius:2px;box-shadow:0 0 8px var(--accent)}" +
      ".am-fzero{position:absolute;left:3px;right:3px;height:1px;background:var(--muted)}" +
      ".am-fmod{position:absolute;left:8px;width:6px;border-radius:3px;background:var(--mod);opacity:.85}" +
      ".am-fader.drop-ok{outline:1px solid var(--accent);border-radius:6px}" +
      ".am-fader.drop-hover{outline:2px solid var(--mod);border-radius:6px}" +
      ".am-amounts{display:flex;flex-direction:column;gap:2px;width:100%}" +
      ".am-amount{display:flex;align-items:center;justify-content:center;gap:3px;max-width:100%;overflow:hidden;font-size:9px;background:var(--panel);border-radius:4px;padding:0 3px;" +
      "cursor:ns-resize;color:var(--mod);touch-action:none}" +
      ".am-amount button{background:none;border:0;color:var(--muted);cursor:pointer;padding:0;font-size:11px}" +
      ".am-fknob{position:absolute;left:1px;right:1px;height:10px;margin-bottom:-5px;border-radius:3px;" +
      "background:var(--text);border:1px solid var(--line)}" +
      ".am-meters{display:flex;gap:2px;position:relative;padding-top:8px}" +
      ".am-meter{position:relative;width:9px;background:var(--panel-3);border-radius:2px;overflow:hidden;align-self:stretch}" +
      ".am-mlvl{position:absolute;left:0;right:0;bottom:0;background:var(--sig-gate);box-shadow:0 0 8px var(--sig-gate)}" +
      ".am-mlvl.warm{background:var(--mod);box-shadow:0 0 8px var(--mod)}.am-mlvl.hot{background:var(--warn);box-shadow:0 0 8px var(--warn)}" +
      ".am-mhold{position:absolute;left:0;right:0;height:2px;background:var(--text)}" +
      ".am-mclip{position:absolute;top:0;width:9px;height:5px;border-radius:1px;background:var(--panel-3);cursor:pointer}" +
      ".am-mclip.on{background:var(--warn)}" +
      ".am-gr{font-size:9px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      "</style>" +
      '<div class="am"></div>',
    afterBuild(view, el0) {
      const root = el0.querySelector(".am");
      const m = (view.mixer = { root, strips: [], last: 0, edited: new Map() });
      const bus = view.root.querySelector(".bv-controls .bv-sec");
      if (bus) {  // the send bus: its four points and the return in one row
        bus.style.flex = "1 1 100%";
        const body = bus.querySelector(".bv-sec-body");
        body.style.cssText = "flex-direction:row;align-items:center;gap:24px";
      }
      for (let k = 1; k <= N; k++) {
        const strip = el("div", "am-strip");
        const pan = dial(view, "pan" + k, "Pan");
        pan.box.classList.add("am-pan");
        const send = dial(view, "send" + k, "Send");
        const mute = button(view, "mute" + k, "M", "Mute");
        mute.box.classList.add("mute");
        const solo = button(view, "solo" + k, "S", "Solo");
        const pre = button(view, "sendpoint" + k, "Pre", "Send taken before the fader (Pre) or after it (Post)");
        const stereo = button(view, "stereo" + k, "Stereo", "Stereo: In L and In R. Off: mono, the In R jack goes away");
        const row = el("div", "am-row");
        row.append(mute.box, solo.box);
        const fad = fader(view, "level" + k, 1);
        const col = el("div", "am-col");
        col.append(stereo.box, pan.box, send.box, pre.box, row);
        const body = el("div", "am-body");
        body.append(fad.box, col);
        strip.append(el("div", "am-name", "" + k), body);
        root.appendChild(strip);
        m.strips.push({ box: strip, dials: [pan, send], buttons: [mute, solo, pre, stereo], fader: fad });
      }
      const ms = el("div", "am-strip am-master");
      const lim = button(view, "limiter", "Limiter", "Peak limiter at −0.3 dBFS");
      const mono = button(view, "mono", "Mono", "Sum everything to mono: no pan, Out L = Out R");
      const gr = el("div", "am-gr", "");
      const mf = fader(view, "master", 2);
      const opts = el("div", "am-row");
      opts.style.flexDirection = "column";
      opts.append(lim.box, mono.box);
      const chs = el("div", "am-row");
      const dec = el("button", "am-btn", "−"), inc = el("button", "am-btn", "+");
      const count = el("div", "am-val");
      dec.title = "Fewer channels";
      inc.title = "More channels";
      const step = (d) => {
        view.api.beginGesture();
        setValue(view, "channels", (channels(view) + d - 1) / (N - 1));
        m.draw();
      };
      dec.addEventListener("click", () => step(-1));
      inc.addEventListener("click", () => step(1));
      chs.append(dec, count, inc);
      const mcol = el("div", "am-col");
      const chBox = el("div", "am-dial");  // the channel count sits with the send bus
      chBox.append(el("div", "am-cap", "Channels"), chs);
      const busBody = bus && bus.querySelector(".bv-sec-body");
      if (busBody) busBody.appendChild(chBox);
      else mcol.append(chBox);
      mcol.append(opts, gr);
      const mbody = el("div", "am-body");
      mbody.append(mf.box, mcol);
      ms.append(el("div", "am-name", "Master"), mbody);
      root.appendChild(ms);
      m.master = { fader: mf, buttons: [lim, mono], gr };
      m.count = count;
      m.draw = () => {
        const n = channels(view);
        m.strips.forEach((s, k) => { s.box.hidden = k >= n; });
        m.count.textContent = n;
        if (view.win) view.win.style.width = Math.max(610, STRIP_W * (n + 1) + 20) + "px";
        for (const s of m.strips) {
          for (const d of s.dials) d.draw();
          for (const b of s.buttons) b.draw();
          s.fader.draw();
        }
        for (const b of m.master.buttons) b.draw();
        m.master.fader.draw();
        root.classList.toggle("mono", get(view, "mono") >= 0.5);
      };
      m.draw();
    },
    onState(st, view) {
      const m = view.mixer;
      if (!m || !st) return;
      // Hidden params are not synced by the generic view: take them from the state.
      if (st.params) {
        for (const f of view.faders) {  // the modulated position of each fader (a = a cable drives it, e = its effective value)
          const ps = st.params[f.id];
          f.eff = ps && ps.a ? ps.e : null;
        }
      }
      if (st.params && !m.down) {
        for (const [id, ps] of Object.entries(st.params))
          if (/^(level|pan|send|mute|solo|sendpoint|stereo)\d$|^(master|limiter|mono|channels)$/.test(id) &&
              performance.now() - (m.edited.get(id) ?? -Infinity) > HOLD_MS) view.node.params[id] = ps.v;
        m.draw();
      }
      const now = performance.now() / 1000, dt = m.last ? Math.min(0.5, now - m.last) : 0;
      m.last = now;
      m.strips.forEach((s, k) => k < channels(view) && s.fader.meter([st["peak" + (k + 1)]], dt, now));
      m.master.fader.meter([st.masterL, st.masterR], dt, now);
      const g = toDb(st.gr ?? 1);
      m.master.gr.textContent = g < -0.1 ? "GR " + g.toFixed(1) + " dB" : "";
    },
    onRefresh(view) {
      if (!view.mixer) return;
      for (const f of view.faders) f.renderAmounts();
      view.mixer.draw();
    },
  });
})();
