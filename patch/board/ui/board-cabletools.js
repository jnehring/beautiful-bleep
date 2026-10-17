// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-cabletools.js — what you do to the cables already on the board: the activity meter, removing cables, the cable menu and Create patch bay.
//
// P.BoardCableTools.create(s)   s: the board and page helpers it needs (see the destructuring below); `board`, `types`, `live` are getters.
//   returns { meterShown, meterNode, showMeter, hideMeter, feedMeter, removeCable, removeCables, showCableMenu }
(function () {
  "use strict";
  const { priv: P } = window.BleepSeal;

  P.BoardCableTools = {
    create(s) {
      const { $, canvas, clearCableSel, clone, edit, el, jackPos, level, nodeById, outType, sel, selectedCableIds, showMenu, signalColour, toCanvas, uid } = s;
      // While the pointer rests on a cable, a small meter at its input end shows what travels through it: a level meter
      // for audio, a graph for control and pitch, a step trace for gates, ticks for triggers and notes.
      const kMeterW = 120, kMeterN = 60;   // px wide; samples kept (60 at 30 Hz: two seconds)
      const meterKind = (t) => t === "audio" ? "audio" : t === "control" || t === "pitch" ? "graph" : t === "gate" ? "gate"
                             : t === "trigger" || t === "notes" ? "event" : "bar";
      const meterShown = () => !!meter, meterNode = () => meter.node;
      let meter = null;   // {id, node, jack, kind, el, cv, label, colour, hist, head, level, peak, hold, v}

      function showMeter(c) {
        if (meter && meter.id === c.id) return positionMeter();
        hideMeter();
        const src = nodeById(c.from.node);
        if (!src) return;
        const type = outType(src, c.from.jack) || "control", kind = meterKind(type);
        const e = el("div", "cable-meter");
        e.style.setProperty("--c", signalColour(type));
        const cv = el("canvas");
        const h = kind === "graph" ? 40 : kind === "audio" || kind === "bar" ? 10 : 22;
        cv.style.width = kMeterW + "px";
        cv.style.height = h + "px";
        const label = el("span", "cm-val");
        e.append(cv, label);
        canvas.append(e);
        const ns = s.live && s.live.nodes && s.live.nodes[c.from.node];
        const v0 = (ns && ns.outputs && ns.outputs[c.from.jack]) || 0;
        meter = { id: c.id, node: c.from.node, jack: c.from.jack, kind, el: e, cv, label, colour: getComputedStyle(e).getPropertyValue("--c") || "#888",
                  hist: new Float32Array(kMeterN).fill(kind === "graph" || kind === "gate" ? v0 : 0), head: 0, level: 0, peak: 0, hold: 0, v: v0 };
        positionMeter();
        drawMeter();
      }
      function hideMeter() {
        if (!meter) return;
        meter.el.remove();
        meter = null;
      }
      /// Sits above-left of the cable's input end: the cable arrives horizontally from the left, so that corner is free.
      function positionMeter() {
        if (!meter) return;
        const c = s.board && s.board.cables.find((x) => x.id === meter.id);
        const b = c && jackPos(c.to.node, c.to.jack, "in");
        if (!b) return hideMeter();
        const p = toCanvas(b.x, b.y), e = meter.el;
        const top = p.y - e.offsetHeight - 10;
        e.style.left = Math.max(4, p.x - e.offsetWidth - 10) + "px";
        e.style.top = (top < 4 ? p.y + 12 : top) + "px";
      }

      /// One state tick (30 Hz) for the hovered cable's source output.
      function feedMeter(ns) {
        const m = meter;
        if (!m || !ns) return;
        const v = ns.outputs && m.jack in ns.outputs ? ns.outputs[m.jack] : 0;
        const act = (ns.activity && ns.activity[m.jack]) || 0;   // how far the signal swung since the last tick
        m.v = v;
        if (m.kind === "audio") {
          const amp = act / 2;   // peak amplitude of a signal swinging around zero
          const f = amp > 1e-5 ? Math.min(1, Math.max(0, (20 * Math.log10(amp) + 60) / 60)) : 0;   // −60 … 0 dB
          m.level = f > m.level ? f : m.level * 0.88;
          if (m.level >= m.peak) { m.peak = m.level; m.hold = 20; } else if (m.hold-- <= 0) m.peak = Math.max(m.level, m.peak - 0.02);
          m.amp = amp;
        } else if (m.kind === "bar") {
          const f = Math.min(1, Math.sqrt(act / 0.5));
          m.level = f > m.level ? f : m.level * 0.9;
        } else {
          m.hist[m.head] = m.kind === "graph" ? v : m.kind === "gate" ? (v > 0.5 ? 1 : 0) : act > 1e-4 ? 1 : 0;
          m.head = (m.head + 1) % kMeterN;
        }
        drawMeter();
      }

      function drawMeter() {
        const m = meter;
        if (!m) return;
        const c = m.cv, w = kMeterW, h = parseFloat(c.style.height);
        const dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const g = c.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.fillStyle = "rgba(255,255,255,.08)";
        const col = m.colour.trim();
        let text = "";
        if (m.kind === "audio" || m.kind === "bar") {
          g.fillRect(0, 0, w, h);
          const x = m.level * w;
          if (m.kind === "audio") {   // quiet in the signal colour, hot above −12 dB amber, above −3 dB red
            const amber = 48 / 60 * w, red = 57 / 60 * w;
            g.fillStyle = col; g.fillRect(0, 0, Math.min(x, amber), h);
            if (x > amber) { g.fillStyle = "#f6c35b"; g.fillRect(amber, 0, Math.min(x, red) - amber, h); }
            if (x > red) { g.fillStyle = "#ff4d4d"; g.fillRect(red, 0, x - red, h); }
            g.fillStyle = "#fff"; g.fillRect(Math.min(w - 2, m.peak * w), 0, 2, h);
            const db = m.amp > 1e-5 ? 20 * Math.log10(m.amp) : -Infinity;
            text = db === -Infinity || db < -59 ? "−∞ dB" : (db > 0 ? "+" : "") + db.toFixed(0).replace("-", "−") + " dB";
          } else {
            g.fillStyle = col; g.fillRect(0, 0, x, h);
            text = m.level > 0.02 ? "active" : "idle";
          }
        } else if (m.kind === "graph") {
          let lo = Infinity, hi = -Infinity;
          for (const x of m.hist) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
          if (hi - lo < 1e-3) { lo -= 0.5; hi += 0.5; }
          const y = (x) => h - 2 - (x - lo) / (hi - lo) * (h - 4);
          if (lo < 0 && hi > 0) {   // the zero line
            g.fillRect(0, y(0), w, 1);
          }
          g.strokeStyle = col; g.lineWidth = 1.5; g.lineJoin = "round";
          g.beginPath();
          for (let i = 0; i < kMeterN; i++) {
            const px = i / (kMeterN - 1) * w, py = y(m.hist[(m.head + i) % kMeterN]);
            i ? g.lineTo(px, py) : g.moveTo(px, py);
          }
          g.stroke();
          text = m.v.toFixed(2);
        } else if (m.kind === "gate") {   // high stretches as blocks
          g.fillRect(0, h - 1, w, 1);
          g.fillStyle = col;
          const step = w / kMeterN;
          for (let i = 0; i < kMeterN; i++) if (m.hist[(m.head + i) % kMeterN]) g.fillRect(i * step, 3, Math.ceil(step), h - 6);
          text = m.v > 0.5 ? "high" : "low";
        } else {   // trigger and notes: a tick for every tick of the clock that carried an event
          g.fillRect(0, h - 1, w, 1);
          g.fillStyle = col;
          const step = w / kMeterN;
          let n = 0;
          for (let i = 0; i < kMeterN; i++) if (m.hist[(m.head + i) % kMeterN]) { n++; g.fillRect(i * step, 2, Math.max(2, step - 1), h - 4); }
          text = n ? n + "×" : "idle";
        }
        m.label.textContent = text;
      }

      function removeCable(id) { removeCables([id]); }
      function removeCables(ids) {
        clearCableSel();
        $("cable-pop").hidden = true;
        edit(ids.length > 1 ? "delete cables" : "delete cable", (b) => { b.cables = b.cables.filter((c) => !ids.includes(c.id)); });
      }

      // ---- create patch bay: the selected cables become the channels of one bundle (doc/specs/modules/patchbay.md) -------
      /// The selected cables a bay can carry: any signal but notes, and not a bundle already.
      function bayableCables() {
        const ids = selectedCableIds();
        return s.board.cables.filter((c) => {
          if (!ids.includes(c.id)) return false;
          const src = nodeById(c.from.node);
          const t = src && outType(src, c.from.jack);
          return t && t !== "notes" && t !== "patchbay";
        });
      }
      function showCableMenu(ev) {
        const n = selectedCableIds().length, ok = bayableCables().length;
        showMenu(ev, [
          { label: "Create patch bay", run: createPatchBay, disabled: !ok },
          "-",
          { label: n > 1 ? "Delete " + n + " cables" : "Delete cable", key: "⌫", run: () => removeCables(selectedCableIds()) },
        ]);
      }
      /// Every distinct source output becomes a channel of a new Patch Bay In (left of the destinations), the bundle goes
      /// to a new Patch Bay Out, and each destination is wired from that channel with its old amount.
      function createPatchBay() {
        const picked = bayableCables().map((c) => c.id);
        if (!picked.length) return;
        clearCableSel();
        $("cable-pop").hidden = true;
        edit("create patch bay", (b) => {
          const cables = b.cables.filter((c) => picked.includes(c.id));
          const mean = (ids, k) => ids.reduce((a, id) => a + nodeById(id, b)[k], 0) / ids.length;
          const srcIds = [...new Set(cables.map((c) => c.from.node))], dstIds = [...new Set(cables.map((c) => c.to.node))];
          const lvl = level();
          // In just right of the sources, Out just left of the destinations, never on top of each other.
          const inX = Math.round(Math.max(...srcIds.map((id) => nodeById(id, b).x)) + 200);
          const outX = Math.round(Math.max(inX + 200, Math.min(...dstIds.map((id) => nodeById(id, b).x)) - 200));
          const bin = { id: uid("n"), type: "patchbay-in", name: s.types["patchbay-in"].name, x: inX, y: Math.round(mean(srcIds, "y")), parent: lvl, params: {} };
          const bout = { id: uid("n"), type: "patchbay-out", name: s.types["patchbay-out"].name, x: outX, y: Math.round(mean(dstIds, "y")), parent: lvl, params: {} };
          b.nodes.push(bin, bout);
          const chan = new Map();
          b.cables = b.cables.filter((c) => !picked.includes(c.id));
          for (const c of cables) {
            const key = c.from.node + "|" + c.from.jack;
            if (!chan.has(key)) {
              chan.set(key, "c" + (chan.size + 1));
              b.cables.push({ id: uid("k"), from: clone(c.from), to: { node: bin.id, jack: chan.get(key) }, amount: 1 });
            }
            b.cables.push({ id: uid("k"), from: { node: bout.id, jack: chan.get(key) }, to: clone(c.to), amount: c.amount });
          }
          b.cables.push({ id: uid("k"), from: { node: bin.id, jack: "bundle" }, to: { node: bout.id, jack: "bundle" }, amount: 1 });
          sel.clear();
          sel.add(bin.id);
          sel.add(bout.id);
        });
      }

      return {
        meterShown, showMeter, hideMeter, feedMeter, removeCable, removeCables, showCableMenu, meterNode,
      };
    },
  };
})();
