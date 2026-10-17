// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// voices.js — Voice Cells in the browser (spec §8.3): the JavaScript counterpart of engine/VoiceCell.cpp.
//
// The user patches one voice inside a Voice Cell; the engine runs that voice once per voice and assigns the notes. The runner in graph.js
// knows only plain cells, so a Voice Cell is *expanded* before the board is compiled (the way flattenPatchbays does for the patch bays):
//
//   Voice Cell "V"                        V~0 … V~n-1: plain cells, each with its own copy of everything inside (ids "<id>~<k>")
//     Voice In  ──►                       V~alloc: the allocator (VoiceAllocNode): notes in, the Voice In signals of every voice out
//     Voice Out ──►                       the outside cables of V come from every copy, scaled by the voice's pan and gain
//
// The allocator listens to the voices' outputs through extra inputs (their level and Active). Those inputs are `late`: the runner does not
// order the graph by them, so the allocator runs before the voices and reads what they put out in the previous chunk; that is how it
// knows when a released voice has stopped sounding and can be reused. A voice that is neither held nor sounding is not run (graph.js
// asks `awake(k)`), as in the plugins; Engine has a `voiceLimit` for the worst case, every voice playing.
//
// No DOM and no Web Audio here: it runs in an AudioWorklet and under node.
import { CHUNK } from "./module-host.js";

export const MAX_VOICES = 16;
export const SIGNALS = ["pitch", "gate", "trigger", "velocity", "release", "pressure", "voice", "random"];
const SILENCE = 3.2e-5;   // −90 dB

/// A setting's value from its normalised knob (ParamSpec::fromNormalised): integers and choices round, floats map linearly or skewed.
function decode(p, n) {
  if (!p) return 0;
  if (p.kind === "int" || p.kind === "choice") return Math.round(p.min + n * (p.max - p.min));
  if (p.map === "skew" && n > 0) {
    const k = Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min));
    return p.min + (p.max - p.min) * Math.exp(Math.log(n) / k);
  }
  return p.map === "skew" ? p.min : p.min + n * (p.max - p.min);
}

/// The settings of a Voice Cell node, in units.
export function voiceSettings(node, spec) {
  const get = (id) => {
    const p = spec.params.find((q) => q.id === id);
    return decode(p, node.params?.[id] ?? p?.default ?? 0);
  };
  return {
    voices: get("voices"), allocation: get("allocation"), stealing: get("stealing"), mode: get("mode"),
    glide: get("glide"), glideMode: get("glidemode"), spread: get("spread"), output: get("output"),
  };
}

/// Replaces every Voice Cell of the board by the allocator and one plain cell per voice (see above).
/// `types`: the engine's node types (Map), `limit`: the most voices to run. Returns
///   {board, specs: [{type, spec}] (the allocators' types), copies: Map(original id → [copy ids]), alias: Map(copy id → original id or null),
///    voiceOf: Map(copy id → {alloc: allocator id, k: voice}) for the nodes of a voice, to skip them while the voice sleeps}.
export function expandVoiceCells(board, types, limit = MAX_VOICES) {
  const vspec = types.get("voice-cell"), inSpec = types.get("voice-in");
  const found = (board.nodes || []).filter((n) => n.type === "voice-cell" && !n.muted);
  const out = { board, specs: [], copies: new Map(), alias: new Map(), voiceOf: new Map() };
  if (!found.length || !vspec || !inSpec) return out;

  const kids = new Map();
  for (const n of board.nodes) { const p = n.parent || ""; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); }
  const below = (id, acc = []) => { for (const c of kids.get(id) || []) { acc.push(c); below(c.id, acc); } return acc; };
  const inside = new Set();   // nodes inside a Voice Cell that is expanded
  const removed = new Set();
  const nodes = [], cables = [];
  const allocs = [];

  for (const V of found) {
    if (inside.has(V.id)) continue;   // a Voice Cell cannot hold a Voice Cell (spec §8.3): the inner one stays as it is
    const s = voiceSettings(V, vspec);
    const voices = Math.max(1, Math.min(s.mode !== 0 ? 1 : s.voices, MAX_VOICES, limit));
    const direct = kids.get(V.id) || [];
    const structural = new Map();   // direct children that are the cell's boundary: id → "in" | "out" | "voice"
    for (const c of direct) {
      if (c.type === "voice-in") structural.set(c.id, "voice");
      else if (c.type === "voice-out" || c.type === "cell-out") structural.set(c.id, "out");
      else if (c.type === "cell-in") structural.set(c.id, "in");
    }
    const all = below(V.id);
    const inner = all.filter((n) => !structural.has(n.id));
    for (const n of all) inside.add(n.id);
    const innerIds = new Set(inner.map((n) => n.id));
    const voiceOuts = new Set(direct.filter((n) => n.type === "voice-out").map((n) => n.id));
    const hasR = board.cables.some((c) => voiceOuts.has(c.to.node) && c.to.jack === "r");
    const activeTapped = board.cables.some((c) => voiceOuts.has(c.to.node) && c.to.jack === "active");

    const allocId = V.id + "~alloc";
    const cellId = (k) => V.id + "~" + k;
    const mapId = (id, k) => id + "~" + k;
    const type = ["voice-alloc", V.id, voices, s.mode, s.allocation, s.stealing, s.glide.toFixed(3), s.glideMode, s.output, s.spread.toFixed(3), activeTapped ? 1 : 0].join("~");
    const spec = {
      type, name: "Voices", port: false, params: [],
      voiceAlloc: { ...s, voices, activeTapped, seed: [...V.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) },
      inputs: [{ id: "notes", name: "Notes", type: "notes" }],
      outputs: [],
    };
    for (let k = 0; k < voices; ++k) {
      spec.inputs.push({ id: "al" + k, name: "Out L " + k, type: "audio", late: true }, { id: "ar" + k, name: "Out R " + k, type: "audio", late: true },
                       { id: "act" + k, name: "Active " + k, type: "gate", late: true });
      for (const sig of inSpec.outputs) spec.outputs.push({ id: sig.id + k, name: sig.name + " " + k, type: sig.type, bipolar: !!sig.bipolar });
    }
    out.specs.push({ type, spec });
    allocs.push({ id: allocId, type, V });

    // One plain cell per voice, with its boundary nodes and a copy of what is inside.
    const jacksOut = [{ id: "l", name: "Out L", type: "audio" }, { id: "r", name: "Out R", type: "audio" }, ...(V.outputs || [])];
    for (let k = 0; k < voices; ++k) {
      nodes.push({ ...V, id: cellId(k), type: "cell", params: {}, inputs: V.inputs || [], outputs: jacksOut });
      nodes.push({ id: cellId(k) + "~in", type: "cell-in", name: "Cell In", x: 0, y: 0, parent: cellId(k), muted: false, params: {} });
      nodes.push({ id: cellId(k) + "~out", type: "cell-out", name: "Cell Out", x: 0, y: 0, parent: cellId(k), muted: false, params: {} });
      for (const n of inner) {
        nodes.push({ ...JSON.parse(JSON.stringify(n)), id: mapId(n.id, k), parent: n.parent === V.id ? cellId(k) : mapId(n.parent, k) });
        if (!out.copies.has(n.id)) out.copies.set(n.id, []);
        out.copies.get(n.id).push(mapId(n.id, k));
        out.alias.set(mapId(n.id, k), k === 0 ? n.id : null);
        out.voiceOf.set(mapId(n.id, k), { alloc: allocId, k });
      }
    }
    out.alias.set(allocId, null);

    // Where an end of a cable that lies inside the cell goes in voice k.
    const end = (e, k) => {
      const role = structural.get(e.node);
      if (role === "voice") return { node: allocId, jack: e.jack + k };
      if (role === "in") return { node: cellId(k) + "~in", jack: e.jack };
      if (role === "out") return { node: cellId(k) + "~out", jack: e.jack };
      if (innerIds.has(e.node)) return { node: mapId(e.node, k), jack: e.jack };
      return null;
    };
    const pan = (k) => (voices > 1 ? s.spread * ((2 * k) / (voices - 1) - 1) : 0);
    const gain = s.output >= 0.5 ? 1 / Math.sqrt(voices) : 1;
    const side = (k, right) => {
      const angle = (pan(k) + 1) * 0.25 * Math.PI;
      return gain * (right ? Math.sin(angle) : Math.cos(angle)) * Math.SQRT2;
    };

    for (const c of board.cables) {
      const fromIn = structural.has(c.from.node) || innerIds.has(c.from.node), toIn = structural.has(c.to.node) || innerIds.has(c.to.node);
      if (fromIn && toIn) {
        for (let k = 0; k < voices; ++k) {
          const a = end(c.from, k), b = end(c.to, k);
          if (!a || !b) continue;
          cables.push({ ...c, id: c.id + "~" + k, from: a, to: b });
          if (voiceOuts.has(c.to.node)) {   // the allocator watches what each voice puts out
            const watch = { l: "al", r: "ar", active: "act" }[c.to.jack];
            if (watch) cables.push({ ...c, id: c.id + "~w" + k, from: a, to: { node: allocId, jack: watch + k }, amount: c.amount });
          }
        }
      } else if (c.to.node === V.id && !fromIn) {   // into the cell from outside
        if (c.to.jack === "notes") cables.push({ ...c, id: c.id + "~n", to: { node: allocId, jack: "notes" } });
        else for (let k = 0; k < voices; ++k) cables.push({ ...c, id: c.id + "~" + k, to: { node: cellId(k), jack: c.to.jack } });
      } else if (c.from.node === V.id && !toIn) {   // out of the cell: every voice, by its pan and the output setting
        for (let k = 0; k < voices; ++k) {
          const right = c.from.jack === "r", audio = c.from.jack === "l" || right;
          const jack = right && !hasR ? "l" : c.from.jack;   // nothing patched into Out R: the left side plays on both
          cables.push({ ...c, id: c.id + "~" + k, from: { node: cellId(k), jack }, amount: audio ? c.amount * side(k, right) : c.amount });
        }
      }
    }
    for (const n of all) removed.add(n.id);
    removed.add(V.id);
  }

  const keep = board.nodes.filter((n) => !removed.has(n.id));
  const kept = new Set(keep.map((n) => n.id));
  const rest = board.cables.filter((c) => kept.has(c.from.node) && kept.has(c.to.node));
  const allocNodes = allocs.map((a) => ({ id: a.id, type: a.type, name: a.V.name + " voices", x: a.V.x || 0, y: a.V.y || 0, parent: a.V.parent || "", muted: false, params: {} }));
  // The allocators come last, so that the voices are visited before them (the runner treats the cable back as feedback).
  out.board = { ...board, nodes: [...keep, ...nodes, ...allocNodes], cables: [...rest, ...cables] };
  return out;
}

const mix = (a, b, c) => {   // a counter-based random number in [0, 1): the same voice and note give the same value every time
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(c + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/// The note allocator of one Voice Cell: a host node for the runner (the same shape as a module or a port). It takes the cell's notes and
/// writes the Voice In signals of every voice (spec §8.3.2: allocation, stealing, mono and legato, glide).
export class VoiceAllocNode {
  constructor(spec, engine) {
    this.spec = spec;
    this.engine = engine;
    this.cfg = spec.voiceAlloc;
    const f = (n) => new Float32Array(Math.max(n, 1) * CHUNK);
    this.views = { params: f(0), inputs: f(spec.inputs.length), outputs: f(spec.outputs.length) };
    this.knobs = [];
    this.connectedIn = new Uint8Array(spec.inputs.length);
    this.events = [];
    this.reset();
  }

  reset() {
    this.voices = Array.from({ length: this.cfg.voices }, () => ({
      note: -1, gate: false, sounding: false, retrigger: false, trigger: false, pitch: 0, target: 0,
      velocity: 0, release: 0, pressure: 0, random: 0, age: 0, peak: 0, silent: 0,
    }));
    this.held = [];
    this.nextVoice = 0;
    this.counter = 0;
  }

  setKnob() {}
  setConnected() {}
  setTransport() {}
  setNotesIn(i, events) { if (i === 0) this.events = events; }
  notesOut() { return []; }
  setData() {}
  perform() {}
  command() {}
  live() { return { values: {}, arrays: {} }; }
  takeData() { return null; }
  paramText() { return ""; }
  destroy() {}

  /// Does voice k need to run: is it held or still sounding?
  awake(k) { const v = this.voices[k]; return !!v && (v.gate || v.sounding); }

  /// Bit k set while voice k plays (for a view that shows it).
  get activeMask() { return this.voices.reduce((m, v, k) => (v.gate || v.sounding ? m | (1 << k) : m), 0); }

  #pick(note) {
    const vs = this.voices, n = vs.length, c = this.cfg;
    if (c.allocation === 2)
      for (let k = 0; k < n; ++k) if (vs[k].note === note && (vs[k].gate || vs[k].sounding)) return k;
    const free = (k) => !vs[k].gate && !vs[k].sounding;
    if (c.allocation === 1) {
      for (let k = 0; k < n; ++k) if (free(k)) return k;
    } else {
      for (let i = 0; i < n; ++i) {
        const k = (this.nextVoice + i) % n;
        if (free(k)) { this.nextVoice = (k + 1) % n; return k; }
      }
    }
    if (c.stealing === 4) return -1;   // none
    let best = 0;
    for (let k = 1; k < n; ++k) {
      const a = vs[k], b = vs[best];
      const better = c.stealing === 0 ? a.age < b.age : c.stealing === 1 ? a.peak < b.peak : c.stealing === 2 ? a.note < b.note : a.note > b.note;
      if (better) best = k;
    }
    return best;
  }

  #start(v, index, note, pitch, velocity, glide) {
    v.retrigger = v.gate;   // a held voice is stolen: its envelopes restart
    v.note = note;
    v.target = pitch;
    if (!glide || !(v.gate || v.sounding)) v.pitch = pitch;
    v.gate = true;
    v.sounding = true;
    v.trigger = true;
    v.velocity = velocity;
    v.release = 0;
    v.pressure = 0;
    v.age = ++this.counter;
    v.silent = 0;
    v.random = 2 * mix(this.cfg.seed, this.counter, index) - 1;
  }

  #noteOn(e) {
    const c = this.cfg, vs = this.voices;
    const glideOn = c.glide > 0, legatoOnly = c.glideMode >= 0.5;
    if (c.mode !== 0) {   // mono / legato: one voice and a note stack
      const wasHeld = this.held.length > 0;
      this.held.push(e.note);
      const v = vs[0];
      const glide = glideOn && (!legatoOnly || wasHeld);
      if (c.mode === 2 && wasHeld && v.gate) {   // legato: no new attack
        v.note = e.note;
        v.target = e.pitch;
        if (!glide) v.pitch = e.pitch;
        return;
      }
      this.#start(v, 0, e.note, e.pitch, e.value, glide);
      return;
    }
    const anyHeld = vs.some((v) => v.gate);
    const k = this.#pick(e.note);
    if (k < 0) return;
    this.#start(vs[k], k, e.note, e.pitch, e.value, glideOn && (!legatoOnly || anyHeld));
  }

  #noteOff(e) {
    const c = this.cfg, vs = this.voices;
    if (c.mode !== 0) {
      this.held = this.held.filter((x) => x !== e.note);
      const v = vs[0];
      if (!this.held.length) { v.gate = false; v.release = e.value; }
      else if (v.note === e.note) {   // back to the previous held note, no new attack
        v.note = this.held[this.held.length - 1];
        v.target = (v.note - 60) / 12;
        if (c.glide <= 0) v.pitch = v.target;
      }
      return;
    }
    for (const v of vs) if (v.gate && v.note === e.note) { v.gate = false; v.release = e.value; }
  }

  process(n) {
    const c = this.cfg, vs = this.voices, rate = this.engine.sampleRate;
    const inputs = this.views.inputs, out = this.views.outputs;
    const glideCoef = c.glide > 0 ? 1 - Math.exp(-1 / (c.glide * rate)) : 1;
    const nSig = SIGNALS.length;

    // What the voices did in the last chunk: is a released voice still sounding?
    vs.forEach((v, k) => {
      let peak = 0;
      const l = inputs.subarray((3 * k) * CHUNK + CHUNK, (3 * k + 1) * CHUNK + CHUNK), r = inputs.subarray((3 * k + 1) * CHUNK + CHUNK, (3 * k + 2) * CHUNK + CHUNK);
      for (let i = 0; i < n; ++i) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      v.peak = Math.max(peak, v.peak * 0.9);
      if (!v.gate && v.sounding) {   // only a voice that was playing can stop (an idle voice stays free)
        if (c.activeTapped) v.sounding = inputs[(3 * k + 2) * CHUNK + CHUNK + n - 1] >= 0.5;
        else { v.silent = peak < SILENCE ? v.silent + n : 0; v.sounding = v.silent < Math.floor(0.05 * rate); }
      }
    });

    let e = 0;
    const events = this.events;
    for (let i = 0; i < n; ++i) {
      while (e < events.length && events[e].offset <= i) {
        const ev = events[e++];
        if (ev.type === 0) this.#noteOn(ev);
        else if (ev.type === 1) this.#noteOff(ev);
        else for (const v of vs) if (v.note === ev.note) v.pressure = ev.value;
      }
      vs.forEach((v, k) => {
        v.pitch += (v.target - v.pitch) * glideCoef;
        const at = k * nSig * CHUNK + i;
        out[at] = v.pitch;
        out[at + CHUNK] = v.gate && !v.retrigger ? 1 : 0;
        out[at + 2 * CHUNK] = v.trigger ? 1 : 0;
        out[at + 3 * CHUNK] = v.velocity;
        out[at + 4 * CHUNK] = v.release;
        out[at + 5 * CHUNK] = v.pressure;
        out[at + 6 * CHUNK] = k;
        out[at + 7 * CHUNK] = v.random;
        v.trigger = false;
        v.retrigger = false;
      });
    }
    this.events = [];
  }
}
