// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// board-model.js — what the board document means: node kinds, jacks, patch bays and cells (spec §8, §9).
//
//   P.BoardModel.create(s)   returns the helpers below, reading the page's state through `s`:
//                            { board, types, ports, standalone, path } (getters: board.js reassigns them)
//
// Nothing here draws or edits; board.js (and the files split from it) draw the board and edit a copy of the document.
(function () {
  "use strict";
  const { priv: P } = window.BleepSeal;

  P.BoardModel = {
    create(s) {
      const level = () => (s.path.length ? s.path[s.path.length - 1] : "");
      const nodeById = (id, b = s.board) => (b ? b.nodes.find((n) => n.id === id) : null);
      const nodesAt = (lvl, b = s.board) => (b ? b.nodes.filter((n) => (n.parent || "") === lvl) : []);
      const typeOf = (n) => (n.type === "code" && window.BleepCode && s.types.code ? window.BleepCode.uiSpec(n) : s.types[n.type]) || { type: n.type, name: n.type, params: [], inputs: [], outputs: [] };
      const isPort = (n) => !!typeOf(n).port;
      const isCellLike = (n) => n.type === "cell" || n.type === "voice-cell";
      const isBoundary = (n) => n.type === "cell-in" || n.type === "cell-out" || n.type === "voice-in" || n.type === "voice-out";
      /// A cell may have several Cell Ins and Cell Outs (to lay cables out as you like), but keeps at least one of each.
      const inVoiceCell = (n) => { const c = nodeById(n.parent); return !!c && c.type === "voice-cell"; };
      const isFixedBoundary = (n) => isBoundary(n) && !(n.type === "cell-in" && inVoiceCell(n)) &&  // a Voice Cell's inputs come in over Voice In
        !((n.type === "cell-in" || n.type === "cell-out") && s.board.nodes.some((m) => m.id !== n.id && m.parent === n.parent && m.type === n.type));
      const isBay = (n) => n.type === "patchbay-in" || n.type === "patchbay-out";
      const isStructural = (n) => n.type === "cell" || isBoundary(n) || isBay(n);  // a Voice Cell has a view: its settings
      /// Ports the user adds and deletes (MIDI Device); the others come from Live (spec §6).
      /// In the standalone app the app's own ports (audio, MIDI, Link) may be deleted and added again from the Add menu.
      const isFixedPort = (n) => isPort(n) && !typeOf(n).creatable && !(s.standalone && APP_PORTS.has(typeOf(n).port));
      const APP_PORTS = new Set(["audio-in", "audio-out", "midi-in", "midi-out", "link"]);
      const VOICE_IN = [{ id: "notes", name: "Notes", type: "notes" }];
      const VOICE_OUT = [{ id: "l", name: "Out L", type: "audio" }, { id: "r", name: "Out R", type: "audio" }];
      const compatible = (a, b) => (a === "notes") === (b === "notes") && (a === "patchbay") === (b === "patchbay");

      // ---- patch bays (doc/specs/modules/patchbay.md) ------------------------------------------------------------
      // A Patch Bay In has a channel (c1, c2 …) for every input that has a cable, and one free one: patching it adds the
      // next. A Patch Bay Out has the channels of the Patch Bay In its bundle comes from, with the same names.
      const isChannel = (jack) => /^c\d+$/.test(jack);
      /// The Patch Bay In that feeds the bundle arriving at (node, jack), over cell outputs and inputs.
      function bundleSource(node, jack, b = s.board, depth = 0) {
        if (depth > 64) return null;
        for (const c of b.cables.filter((k) => k.to.node === node && k.to.jack === jack)) {
          const from = nodeById(c.from.node, b);
          if (!from) continue;
          if (from.type === "patchbay-in") return from;
          if (from.type === "cell") {
            for (const o of b.nodes.filter((m) => m.type === "cell-out" && m.parent === from.id)) {
              const r = bundleSource(o.id, c.from.jack, b, depth + 1);
              if (r) return r;
            }
          } else if (from.type === "cell-in") {
            const r = bundleSource(from.parent, c.from.jack, b, depth + 1);
            if (r) return r;
          }
        }
        return null;
      }
      /// The channels of a Patch Bay In that are patched: [{id, name, type}] by number, named after what is patched in.
      function bayChannels(n, b = s.board) {
        const ids = [...new Set(b.cables.filter((c) => c.to.node === n.id && isChannel(c.to.jack)).map((c) => c.to.jack))]
          .sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
        return ids.map((id) => {
          const c = b.cables.find((k) => k.to.node === n.id && k.to.jack === id);
          const src = nodeById(c.from.node, b);
          if (!src) return { id, name: id, type: "control" };
          const out = outputsOf(src, b).find((o) => o.id === c.from.jack);
          return { id, name: `${src.name} - ${out ? out.name : c.from.jack}`, type: (out && out.type) || "control" };
        });
      }
      function bayInputs(n, b) {   // the channels and the free one
        const chans = bayChannels(n, b);
        const next = chans.length ? Number(chans[chans.length - 1].id.slice(1)) + 1 : 1;
        return chans.concat([{ id: "c" + next, name: "free", type: "control" }]).map((c) => ({ ...c, type: "any" }));
      }
      function bayOutputs(n, b) {
        const src = bundleSource(n.id, "bundle", b);
        return src ? bayChannels(src, b) : [];
      }

      function outputsOf(n, b = s.board) {
        if (n.type === "patchbay-out") return bayOutputs(n, b);
        if (n.type === "cell") return n.outputs || [];
        if (n.type === "voice-cell") return VOICE_OUT.concat(n.outputs || []);  // spec §8.3.1
        if (n.type === "cell-in") { const c = nodeById(n.parent, b); return c ? c.inputs || [] : []; }
        if (n.type === "voice-in") { const c = nodeById(n.parent, b); return typeOf(n).outputs.concat(c ? c.inputs || [] : []); }  // a Voice Cell has no Cell In
        return typeOf(n).outputs;
      }
      function inputsOf(n, b = s.board) {
        if (n.type === "patchbay-in") return bayInputs(n, b);
        if (n.type === "cell") return n.inputs || [];
        if (n.type === "voice-cell") return VOICE_IN.concat(n.inputs || []);
        if (n.type === "cell-out") { const c = nodeById(n.parent, b); return c ? c.outputs || [] : []; }
        return typeOf(n).inputs;
      }
      const modParams = (n) => typeOf(n).params.filter((p) => p.modulatable);  // knobs, incl. stepped ones
      function outType(n, jack) { const j = outputsOf(n).find((o) => o.id === jack); return j ? j.type : null; }
      function inType(n, jack) {
        const j = inputsOf(n).find((o) => o.id === jack);
        if (j) return j.type;
        return modParams(n).some((p) => p.id === jack) ? "control" : null;
      }
      function jackName(n, jack, out) {
        const list = out ? outputsOf(n) : inputsOf(n);
        const j = list.find((o) => o.id === jack);
        if (j) return shownName(n, j);
        const p = typeOf(n).params.find((q) => q.id === jack);
        return p ? p.name : jack;
      }
      const cablesInto = (node, jack, b = s.board) => b.cables.filter((c) => c.to.node === node && c.to.jack === jack);
      /// The module whose state tells what travels on a cable leaving (node, jack): a cell or voice cell has none of its own,
      /// so this follows the jack inwards to the real output feeding it. Falls back to (node, jack) when nothing feeds it.
      const kInner = { cell: "cell-out", "voice-cell": "voice-out" };
      function liveSource(node, jack, b = s.board, depth = 0) {
        const n = nodeById(node, b);
        if (!n || depth > 64) return { node, jack };
        const inner = kInner[n.type] && b.nodes.find((x) => x.type === kInner[n.type] && x.parent === n.id);
        if (!inner) return { node, jack };
        for (const c of cablesInto(inner.id, jack, b)) {
          const src = nodeById(c.from.node, b);
          if (!src) continue;
          if (src.type === "cell-in" || src.type === "voice-in") {   // passes straight through: look at what feeds the cell
            for (const o of cablesInto(src.parent, c.from.jack, b)) return liveSource(o.from.node, o.from.jack, b, depth + 1);
            continue;
          }
          return liveSource(c.from.node, c.from.jack, b, depth + 1);
        }
        return { node, jack };
      }
      function portInfo(n) { return n.port ? s.ports[n.port] : null; }
      /// A param's value in its own units (for integer settings like Voices).
      function paramValue(n, id) {
        const p = typeOf(n).params.find((q) => q.id === id);
        if (!p) return 0;
        const v = n.params && id in n.params ? n.params[id] : p.default;
        return Math.round(p.min + v * (p.max - p.min));
      }
      /// Optional type metadata: a jack or param shown only while a setting is in
      /// range ("show"), and names that follow a setting ("names").
      function isShown(n, item) {
        if (!item.show) return true;
        const v = paramValue(n, item.show.param);
        return v >= item.show.min && v <= item.show.max;
      }
      function shownName(n, item) {
        return (item.names && item.names.list[paramValue(n, item.names.by)]) || item.name;
      }
      /// Does changing this param change how the node's jacks look?
      function drivesJacks(n, pid) {
        const t = typeOf(n);
        return [...(t.inputs || []), ...(t.outputs || [])].some((j) =>
          (j.show && j.show.param === pid) || (j.names && j.names.by === pid));
      }
      function insideVoiceCell(id, b = s.board) {
        for (let n = nodeById(id, b); n; n = nodeById(n.parent, b)) if (n.type === "voice-cell") return true;
        return false;
      }
      function isGhost(n) {
        if (!isPort(n)) return false;
        const p = portInfo(n);
        return !p || !p.live;
      }
      function descendants(cellId, b = s.board) {
        const out = [];
        const walk = (id) => {
          for (const n of b.nodes)
            if ((n.parent || "") === id) { out.push(n); if (isCellLike(n)) walk(n.id); }
        };
        walk(cellId);
        return out;
      }
      return {
        level, nodeById, nodesAt, typeOf, isPort, isCellLike,
        isBoundary, inVoiceCell, isFixedBoundary, isBay, isStructural, isFixedPort,
        APP_PORTS, VOICE_IN, VOICE_OUT, compatible, isChannel, bundleSource,
        bayChannels, bayInputs, bayOutputs, outputsOf, inputsOf, modParams,
        outType, inType, jackName, cablesInto, liveSource, portInfo, paramValue,
        isShown, shownName, drivesJacks, insideVoiceCell, isGhost, descendants,
      };
    },
  };
})();
