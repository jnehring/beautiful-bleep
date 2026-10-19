// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// graph.js — the board's graph runner for the browser: the JavaScript
// counterpart of engine/Program.cpp. It compiles a board document into
// processing order, sums cables into inputs, builds the effective knob values
//
//     effective = clamp(knob + Σ source × amount, 0, 1)      (spec §5.6)
//
// and runs every module (a ModuleInstance, one .wasm each) chunk by chunk.
// Feedback works as in the plugins: the cable that closes a loop reads its
// source's previous chunk (spec §7.5).
//
// No DOM and no Web Audio here: it runs in an AudioWorklet and under node.
// Voice Cells are expanded into one plain cell per voice before compiling (voices.js).
// Not ported yet: Link, Macros, host MIDI out. Media: the page sends the clips a board uses (addMedia).

import { CHUNK, ModuleInstance } from "./module-host.js";
import { expandVoiceCells, VoiceAllocNode } from "./voices.js";

/// A bypassed module with audio in and audio out: [input, output] pairs (the n-th audio in feeds the n-th audio out,
/// the last in feeds the rest), as the native engine does. null: the module runs.
function bypassRoute(n, s) {
  if (!n.bypassed) return null;
  const ins = [], outs = [];
  s.inputs.forEach((j, k) => { if (j.type === "audio") ins.push(k); });
  s.outputs.forEach((o, k) => { if (o.type === "audio") outs.push(k); });
  if (!ins.length || !outs.length) return null;
  return outs.map((o, k) => [ins[Math.min(k, ins.length - 1)], o]);
}

const STRUCTURAL = new Set(["cell", "cell-in", "cell-out", "voice-cell", "voice-in", "voice-out", "patchbay-in", "patchbay-out"]);

/// The board with every patch bay chain replaced by plain cables (Program.cpp flattenPatchbays): a source into a Patch Bay
/// In channel, a bundle cable (over cell outputs and inputs, other bays), out of the same channel of a Patch Bay Out.
export function flattenPatchbays(board) {
  const isBay = (n) => n && (n.type === "patchbay-in" || n.type === "patchbay-out");
  if (!board.nodes.some(isBay)) return board;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const bundleSource = (node, jack, depth = 0) => {
    if (depth > 64) return null;
    for (const c of board.cables) {
      if (c.to.node !== node || c.to.jack !== jack) continue;
      const from = byId.get(c.from.node);
      if (!from) continue;
      if (from.type === "patchbay-in") return from;
      if (from.type === "cell") {
        for (const o of board.nodes) {
          if (o.type !== "cell-out" || o.parent !== from.id) continue;
          const r = bundleSource(o.id, c.from.jack, depth + 1);
          if (r) return r;
        }
      } else if (from.type === "cell-in") {
        const r = bundleSource(from.parent, c.from.jack, depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  const channelSources = (bayOut, jack, scale, depth, out) => {
    if (depth > 16) return;
    const bayIn = bundleSource(bayOut, "bundle");
    if (!bayIn) return;
    for (const c of board.cables) {
      if (c.to.node !== bayIn.id || c.to.jack !== jack) continue;
      if (byId.get(c.from.node)?.type === "patchbay-out") channelSources(c.from.node, c.from.jack, scale * c.amount, depth + 1, out);
      else out.push({ from: c.from, amount: scale * c.amount });
    }
  };
  const cables = [];
  for (const c of board.cables) {
    if (isBay(byId.get(c.to.node))) continue;
    if (byId.get(c.from.node)?.type === "patchbay-out") {
      const sources = [];
      channelSources(c.from.node, c.from.jack, 1, 0, sources);
      sources.forEach((s, k) => cables.push({ id: `${c.id}~${k}`, from: s.from, to: c.to, amount: s.amount * c.amount }));
      continue;
    }
    const src = byId.get(c.from.node);
    if (src && isBay(src)) continue;   // a bundle out of a bay
    if (src && src.type === "cell" && (src.outputs || []).some((o) => o.id === c.from.jack && o.type === "patchbay")) continue;  // a bundle between cells
    if (src && src.type === "cell-in" && (byId.get(src.parent)?.inputs || []).some((o) => o.id === c.from.jack && o.type === "patchbay")) continue;
    cables.push(c);
  }
  return { ...board, nodes: board.nodes.filter((n) => !isBay(n)), cables };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/// A host-side node: the ports of the browser build (audio out, MIDI in, …).
/// Same shape as a module step so the runner treats both alike.
class PortNode {
  constructor(spec, engine) {
    this.spec = spec;
    this.engine = engine;
    const f = (n) => new Float32Array(Math.max(n, 1) * CHUNK);
    this.views = { params: f(spec.params.length), inputs: f(spec.inputs.length), outputs: f(spec.outputs.length) };
    this.notes = [];
    this.knobs = spec.params.map((p) => p.default);
    this.remote = null;       // [bridge] a RemoteBinding (bridge-worklet.js) while the node is bound to a web-link channel
    this.remoteMidi = null;   // [bridge] the MIDI state of that binding
  }
  /// [bridge] `node.remote` = the key of a web-link channel (doc/specs/bridges.md §10): the node then carries what
  /// the hub sends / sends its inputs to the hub, instead of the local speakers and keyboard.
  setRemote(key) {
    if (this.remote && this.remote.key === key) return;
    this.remote = key && this.engine.bridge ? this.engine.bridge.bind(this, key) : null;
    if (!this.remote) this.remoteMidi = null;
  }
  get memory() { return null; }
  setKnob(i, v) { this.knobs[i] = v; }
  setConnected() {}
  setTransport() {}
  setNotesIn(i, events) { if (this.remote) this.remote.notesIn(i, events); }  // [bridge] notes to the hub
  notesOut(jack) { return this.spec.outputs[jack].type === "notes" ? this.notes : []; }
  setData() {}
  perform() {}
  command() {}
  live() { return { values: {}, arrays: {} }; }
  takeData() { return null; }
  paramText() { return ""; }
  reset() { this.level = undefined; }
  destroy() {}

  process(n) {
    const kind = this.remote ? this.remote.kind : this.spec.type;  // [bridge] a bound node is not a local speaker/keyboard
    if (this.remote) this.remote.run(this, n);                       // [bridge]
    const v = this.views;
    if (kind === "audio-out" || kind === "instrument") {
      // Mono into both sides, as a track would.
      const l = v.inputs.subarray(0, CHUNK);
      const r = this.connectedIn[1] ? v.inputs.subarray(CHUNK, 2 * CHUNK) : l;
      // Audio Out's Volume knob (dB, skewed like a mixer fader; the bottom is silence), smoothed against clicks.
      const vol = this.spec.params.findIndex((q) => q.id === "volume");
      for (let s = 0; s < n; ++s) {
        const g = vol >= 0 ? this.#smooth(this.#gain(vol, v.params[vol * CHUNK + s])) : 1;
        this.engine.outL[this.engine.outPos + s] += l[s] * g;
        this.engine.outR[this.engine.outPos + s] += r[s] * g;
      }
    }
    if (this.spec.outputs.length && (kind === "midi-in" || kind === "midi-device" || kind === "instrument")) this.#midi(n);
    if (kind === "audio-in") this.#audioIn(n);
    // link, macros: silent outputs for now.
  }

  /// Audio In: what the page feeds the engine (the microphone, a file: Engine.render's input), times the Gain knob (dB).
  /// A mono input plays on both sides.
  #audioIn(n) {
    const o = this.views.outputs, e = this.engine;
    const k = (id) => this.spec.outputs.findIndex((q) => q.id === id);
    const gain = this.spec.params.findIndex((q) => q.id === "gain");
    const l = k("l"), r = k("r");
    for (let s = 0; s < n; ++s) {
      const g = gain >= 0 ? this.#smooth(this.#gain(gain, this.views.params[gain * CHUNK + s])) : 1;
      if (l >= 0) o[l * CHUNK + s] = e.inL[s] * g;
      if (r >= 0) o[r * CHUNK + s] = e.inR[s] * g;
    }
  }

  /// A level knob's linear gain from its normalised value (ParamSpec::fromNormalised, then dB → gain).
  #gain(i, x) {
    const p = this.spec.params[i];
    let db = p.min + (p.max - p.min) * x;
    if (p.map === "skew") db = x <= 0 ? p.min : p.min + (p.max - p.min) * Math.exp(Math.log(x) / (Math.log(0.5) / Math.log((p.centre - p.min) / (p.max - p.min))));
    if (Math.abs(db) < 0.005) db = 0;  // the default passes the signal unchanged
    return db <= -60 + 1e-3 ? 0 : Math.pow(10, db / 20);
  }

  #smooth(target) {
    this.level = this.level === undefined ? target : this.level + (target - this.level) * 0.002;
    return this.level;
  }

  #midi(n) {
    const midi = this.remoteMidi || this.engine.midi;  // [bridge] a bound node follows the hub's MIDI
    const idx = (id) => this.spec.outputs.findIndex((o) => o.id === id);
    const fill = (id, value) => { const k = idx(id); if (k >= 0) v_fill(this.views.outputs, k, value, n); };
    const held = midi.held;
    const last = held.length ? held[held.length - 1] : null;
    if (last) fill("pitch", (last.note - 60) / 12);
    fill("gate", held.length ? 1 : 0);
    if (last) fill("velocity", last.velocity);
    fill("trigger", 0);
    fill("pressure", midi.pressure);
    fill("bend", midi.bend);
    fill("mod", midi.cc[1] ?? 0);
    const triggerK = idx("trigger");
    this.notes = midi.chunkEvents.map((e) => ({ ...e }));
    if (triggerK >= 0 && this.notes.some((e) => e.type === 0)) this.views.outputs[triggerK * CHUNK] = 1;
    // cc1..cc8 follow the CC numbers set in the node's params (default 1…8 → modwheel first).
    for (let k = 1; k <= 8; ++k) {
      const j = idx("cc" + k);
      if (j < 0) continue;
      const p = this.spec.params.findIndex((q) => q.id === "cc" + k);
      const ccNumber = p >= 0 ? Math.round(this.spec.params[p].min + (this.knobs[p] ?? 0) * (this.spec.params[p].max - this.spec.params[p].min)) : k;
      v_fill(this.views.outputs, j, midi.cc[ccNumber] ?? 0, n);
    }
  }
}

function v_fill(buf, k, value, n) {
  buf.fill(value, k * CHUNK, k * CHUNK + n);
}

/// The notes the host plays (computer keyboard, Web MIDI), shared by all MIDI nodes.
class MidiState {
  constructor() {
    this.held = [];       // [{note, velocity}] in press order
    this.pending = [];    // events since the last chunk
    this.chunkEvents = [];
    this.pressure = 0;
    this.bend = 0.5;
    this.cc = {};
  }
  noteOn(note, velocity = 0.8, channel = 0) {
    this.held = this.held.filter((h) => h.note !== note);
    this.held.push({ note, velocity });
    this.pending.push({ type: 0, channel, offset: 0, note, pitch: (note - 60) / 12, value: velocity });
  }
  noteOff(note, channel = 0) {
    this.held = this.held.filter((h) => h.note !== note);
    this.pending.push({ type: 1, channel, offset: 0, note, pitch: (note - 60) / 12, value: 0 });
  }
  allOff() { for (const h of [...this.held]) this.noteOff(h.note); }
  /// Moves the events queued since the last chunk into the chunk being run.
  beginChunk() { this.chunkEvents = this.pending; this.pending = []; }
}

export class Engine {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.types = new Map();        // type id → spec (what the UI calls a node type)
    this.wasm = new Map();         // slug → WebAssembly.Module
    this.slugOfType = new Map();   // type id → slug
    this.instances = new Map();    // node id → {type, host}
    this.steps = [];
    this.feedback = [];
    this.midi = new MidiState();
    this.bpm = 120;
    this.bridge = null;   // [bridge] a BridgeEndpoint (bridge-worklet.js), set by worklet.js; null = no web link
    this.playing = true;
    this.samplePos = 0;
    this.outL = new Float32Array(CHUNK);
    this.outR = new Float32Array(CHUNK);
    this.outPos = 0;
    this.inL = new Float32Array(CHUNK);   // the audio the page feeds in (render's inL and inR), for the Audio In nodes
    this.inR = new Float32Array(CHUNK);
    this.board = null;
    this.watched = new Set();
    this.onError = null;  // (message) — set by the host
    this.generation = 0;
    this.media = new Map();        // media id → {rate, channels: [Float32Array]}: the audio files the page sent (web-media.js)
    this.pendingData = new Map();  // node id → sanitised data the UI's board does not have yet
    this.voiceLimit = 16;          // the most voices a Voice Cell runs: every voice costs CPU all the time here (voices.js)
    this.copies = new Map();       // a node inside a Voice Cell → the ids of its copies, one per voice
    this.alias = new Map();        // a copy's id → the id the UI knows it by (voice 0), or null: not shown
    this.voiceOf = new Map();      // a copy's id → {alloc, k}: it belongs to voice k of that Voice Cell's allocator
  }

  /// The UI's node types (demo-types.json / the manifest's specs).
  setTypes(list) { for (const t of list) this.types.set(t.type, t); }
  /// A module file is available: its node types run from it.
  addModule(slug, module, typeIds) {
    this.wasm.set(slug, module);
    for (const t of typeIds) this.slugOfType.set(t, slug);
  }
  /// A clip of the media folder arrived: a module whose node data names it loads it again (it was "not available" before).
  addMedia(id, rate, channels) {
    this.media.set(id, { rate, channels });
    for (const e of this.instances.values()) if (e.dataJson && e.dataJson.includes(id)) e.host.setData(e.dataJson);
  }
  /// Module files a board needs that are not loaded yet: [slug, …].
  missingSlugs(board, manifest) {
    const need = new Set();
    for (const n of board.nodes) {
      if (n.muted || STRUCTURAL.has(n.type) || this.types.get(n.type)?.port) continue;
      const slug = manifest.types[n.type];
      if (slug && !this.wasm.has(slug)) need.add(slug);
    }
    return [...need];
  }

  // ---- compiling ---------------------------------------------------------------

  setBoard(boardIn) {
    const voiced = expandVoiceCells(boardIn, this.types, this.voiceLimit);
    for (const { type, spec } of voiced.specs) this.types.set(type, spec);
    this.copies = voiced.copies;
    this.alias = voiced.alias;
    this.voiceOf = voiced.voiceOf;
    const board = flattenPatchbays(voiced.board);
    this.board = board;
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    const into = new Map();  // "node|jack" → cables
    for (const c of board.cables) {
      const key = c.to.node + "|" + c.to.jack;
      if (!into.has(key)) into.set(key, []);
      into.get(key).push(c);
    }
    const cellOutOf = new Map();
    for (const n of board.nodes) if (n.type === "cell-out") cellOutOf.set(n.parent, n);

    const spec = (n) => this.types.get(n.type);
    const isReal = (n) => !!spec(n) && !STRUCTURAL.has(n.type) && !n.muted && !!this.#make(n, true);

    // Follows cables back to real outputs, through cell jacks (spec §8.1).
    const resolveInto = (node, jack, scale, depth, out) => {
      if (depth > 64) return;
      for (const c of into.get(node + "|" + jack) || []) {
        const src = byId.get(c.from.node);
        if (!src) continue;
        const amount = scale * c.amount;
        if (src.type === "cell-in") resolveInto(src.parent, c.from.jack, amount, depth + 1, out);
        else if (src.type === "cell") {
          const co = cellOutOf.get(src.id);
          if (co) resolveInto(co.id, c.from.jack, amount, depth + 1, out);
        } else if (isReal(src)) out.push({ node: src.id, jack: c.from.jack, amount, cable: c.id, scale });
      }
    };
    // An unpatched input follows its `normal` jack (JackSpec::normal).
    const resolveInput = (n, s, j, out) => {
      let id = s.inputs[j].id;
      for (let hop = 0; hop < 8; ++hop) {
        const before = out.length;
        resolveInto(n.id, id, 1, 0, out);
        if (out.length !== before) return;
        const k = s.inputs.findIndex((i) => i.id === id);
        if (k < 0 || !s.inputs[k].normal) return;
        id = s.inputs[k].normal;
      }
    };

    // Real nodes and their dependencies.
    const real = board.nodes.filter(isReal);
    const deps = new Map();
    for (const n of real) {
      const s = spec(n), found = [];
      for (const p of s.params) if (p.modulatable) resolveInto(n.id, p.id, 1, 0, found);
      s.inputs.forEach((j, k) => { if (!j.late) resolveInput(n, s, k, found); });   // a `late` input reads the last chunk and orders nothing
      deps.set(n.id, [...new Set(found.map((f) => f.node))]);
    }
    // Harmony: every writer before every reader (Harmony Master is not ported yet, so none run).
    const order = [], mark = new Map(), feedback = [];
    const visit = (n) => {
      mark.set(n.id, 1);
      for (const d of deps.get(n.id)) {
        const m = mark.get(d) || 0;
        if (m === 1) { feedback.push(d + "→" + n.id); continue; }
        if (m === 0) visit(byId.get(d));
      }
      mark.set(n.id, 2);
      order.push(n);
    };
    for (const n of real) if (!mark.get(n.id)) visit(n);
    this.feedback = feedback;

    // Instances: reuse by node id and type, create the rest, drop the removed.
    const kept = new Map();
    for (const n of order) {
      let entry = this.instances.get(n.id);
      if (!entry || entry.type !== n.type) {
        entry?.host.destroy();
        entry = { type: n.type, host: this.#make(n, false) };
        if (!entry.host) continue;
      }
      const s = spec(n);
      s.params.forEach((p, i) => entry.host.setKnob(i, n.params?.[p.id] ?? p.default));
      if (entry.host.setRemote) entry.host.setRemote(n.remote || null);  // [bridge]
      if (entry.host.sanitiseData) {
        // Node data goes through the module's own sanitiser: valid JSON with the defaults for a new node.
        const clean = entry.host.sanitiseData(n.data === undefined ? "" : JSON.stringify(n.data));
        if (clean !== null) {
          if (entry.dataJson !== clean) { entry.dataJson = clean; entry.host.setData(clean); }
          if (JSON.stringify(JSON.parse(clean)) !== JSON.stringify(n.data) && this.alias.get(n.id) !== null) this.pendingData.set(this.alias.get(n.id) ?? n.id, clean);
        }
      }
      kept.set(n.id, entry);
    }
    for (const [id, e] of this.instances) if (!kept.has(id)) e.host.destroy();
    this.instances = kept;

    // Steps with their sources.
    const outRef = (node, jack) => {
      const step = stepsById.get(node);
      return step ? { step, k: step.spec.outputs.findIndex((o) => o.id === jack) } : null;
    };
    const stepsById = new Map();
    this.steps = order.filter((n) => kept.has(n.id)).map((n) => {
      const entry = kept.get(n.id), s = spec(n);
      const st = { id: n.id, spec: s, host: entry.host, paramSources: [], inputSources: [], noteSources: [],
                   connectedIn: new Uint8Array(s.inputs.length), connectedOut: new Uint8Array(s.outputs.length),
                   activity: new Float32Array(s.outputs.length), voice: this.voiceOf.get(n.id) || null, asleep: false };
      entry.host.connectedIn = st.connectedIn;
      st.bypass = bypassRoute(n, s);
      stepsById.set(n.id, st);
      return st;
    });
    for (const st of this.steps) {
      const n = byId.get(st.id), s = st.spec;
      s.params.forEach((p) => {
        const list = [];
        if (p.modulatable) {
          const found = [];
          resolveInto(n.id, p.id, 1, 0, found);
          for (const f of found) { const r = outRef(f.node, f.jack); if (r && r.k >= 0) list.push({ ...r, amount: f.amount, cable: f.cable, scale: f.scale }); }
        }
        st.paramSources.push(list);
      });
      s.inputs.forEach((j, k) => {
        let found = [];
        resolveInto(n.id, j.id, 1, 0, found);
        const patched = found.length > 0;
        if (!patched) resolveInput(n, s, k, found);
        const list = [];
        for (const f of found) { const r = outRef(f.node, f.jack); if (r && r.k >= 0) list.push({ ...r, amount: f.amount, cable: f.cable, scale: f.scale }); }
        st.inputSources.push(j.type === "notes" ? [] : list);
        st.noteSources.push(j.type === "notes" ? list : []);
        st.connectedIn[k] = patched && list.length > 0 ? 1 : 0;
      });
    }
    // Which outputs something reads.
    for (const st of this.steps) {
      for (const list of [...st.paramSources, ...st.inputSources, ...st.noteSources])
        for (const r of list) r.step.connectedOut[r.k] = 1;
    }
    for (const st of this.steps) st.host.setConnected(st.connectedIn, st.connectedOut);
    this.generation++;
  }

  /// A module for a node, or null when its file is not loaded. `probe`: only ask.
  #make(n, probe) {
    const s = this.types.get(n.type);
    if (!s) return null;
    if (s.voiceAlloc) return probe ? true : new VoiceAllocNode(s, this);
    if (s.port) return probe ? true : new PortNode(s, this);
    const slug = this.slugOfType.get(n.type);
    const mod = slug && this.wasm.get(slug);
    if (!mod) return null;
    if (probe) return true;
    try {
      const host = new ModuleInstance(mod, this.sampleRate, n.type, this.media);
      host.connectedIn = new Uint8Array(s.inputs.length);
      return host;
    } catch (e) {  // one broken module must not stop the board
      this.onError?.(`${n.type}: ${e.message}`);
      this.wasm.delete(slug);
      return null;
    }
  }

  // ---- live edits (no recompile) ----------------------------------------------------

  /// The instances of a node the UI knows: itself, or one copy per voice for a node inside a Voice Cell.
  #ids(nodeId) { return this.copies.get(nodeId) ?? [nodeId]; }

  setKnob(nodeId, paramId, normalised) {
    for (const id of this.#ids(nodeId)) {
      const e = this.instances.get(id);
      const s = e && this.types.get(e.type);
      const i = s ? s.params.findIndex((p) => p.id === paramId) : -1;
      if (i >= 0) e.host.setKnob(i, normalised);
    }
  }
  setAmount(cableId, amount) {
    for (const st of this.steps) {
      for (const lists of [st.paramSources, st.inputSources, st.noteSources])
        for (const list of lists) for (const r of list) if (r.cable === cableId || String(r.cable).startsWith(cableId + "~")) r.amount = r.scale * amount;
    }
  }
  perform(nodeId, action, args) { for (const id of this.#ids(nodeId)) this.instances.get(id)?.host.perform(action, args); }
  command(nodeId, id, value) { for (const copy of this.#ids(nodeId)) this.instances.get(copy)?.host.command(id, value); }
  setData(nodeId, data) {
    for (const id of this.#ids(nodeId)) {
      const e = this.instances.get(id);
      if (!e) continue;
      const json = JSON.stringify(data);
      const clean = e.host.sanitiseData ? e.host.sanitiseData(json) : json;
      e.dataJson = clean ?? json;
      e.host.setData(e.dataJson);
    }
  }

  // ---- running ----------------------------------------------------------------------

  /// Renders `frames` frames into left/right (added to nothing: overwritten). `inL` and `inR` (optional, `inR` defaults to `inL`) are
  /// the audio the Audio In nodes carry: the microphone or a file; without them they are silent.
  render(left, right, frames, inL, inR) {
    let done = 0;
    while (done < frames) {
      const n = Math.min(CHUNK, frames - done);
      this.outL.fill(0);
      this.outR.fill(0);
      this.outPos = 0;
      if (inL) {
        this.inL.set(inL.subarray(done, done + n));
        this.inR.set((inR || inL).subarray(done, done + n));
      } else {
        this.inL.fill(0);
        this.inR.fill(0);
      }
      this.#runChunk(n);
      left.set(this.outL.subarray(0, n), done);
      right.set(this.outR.subarray(0, n), done);
      done += n;
    }
  }

  #runChunk(n) {
    this.midi.beginChunk();
    const ppq = (this.samplePos / this.sampleRate) * (this.bpm / 60);
    for (const st of this.steps) {
      const host = st.host, v = host.views, s = st.spec;
      if (st.voice) {   // a voice that is neither held nor sounding does not run, and puts out silence
        if (!this.instances.get(st.voice.alloc)?.host.awake(st.voice.k)) {
          if (!st.asleep) { v.outputs.fill(0); st.asleep = true; }
          continue;
        }
        st.asleep = false;
      }
      s.params.forEach((p, i) => {
        const sources = st.paramSources[i];
        const buf = v.params;
        const knob = host.knobs[i] ?? p.default;
        if (!sources.length) { buf.fill(knob, i * CHUNK, i * CHUNK + n); return; }
        for (let k = 0; k < n; ++k) {
          let x = knob;
          for (const r of sources) x += r.step.host.views.outputs[r.k * CHUNK + k] * r.amount;
          buf[i * CHUNK + k] = clamp01(x);
        }
      });
      s.inputs.forEach((j, i) => {
        if (j.type === "notes") {
          const events = [];
          for (const r of st.noteSources[i]) events.push(...r.step.host.notesOut(r.k));
          events.sort((a, b) => a.offset - b.offset);
          host.setNotesIn(i, events);
          return;
        }
        const sources = st.inputSources[i], buf = v.inputs, at = i * CHUNK;
        buf.fill(0, at, at + n);
        for (const r of sources) {
          const out = r.step.host.views.outputs, from = r.k * CHUNK;
          for (let k = 0; k < n; ++k) buf[at + k] += out[from + k] * r.amount;
        }
      });
      host.connectedIn = st.connectedIn;
      host.setTransport(this.bpm, ppq, this.playing, this.samplePos);
      if (st.bypass) {   // bypassed: the module does not run, its n-th audio input feeds its n-th audio output, the rest is silent
        v.outputs.fill(0);
        for (const [i, o] of st.bypass) v.outputs.set(v.inputs.subarray(i * CHUNK, i * CHUNK + n), o * CHUNK);
      } else host.process(n);
      // Activity (the cables' pulse): how far each output moved.
      const out = host.views.outputs;
      s.outputs.forEach((o, k) => {
        let lo = Infinity, hi = -Infinity;
        for (let q = 0; q < n; ++q) { const x = out[k * CHUNK + q]; if (x < lo) lo = x; if (x > hi) hi = x; }
        st.activity[k] = Math.max(st.activity[k], hi > lo ? hi - lo : 0);
      });
    }
    this.samplePos += n;
  }

  // ---- what the UI shows --------------------------------------------------------------

  /// The `state` message of the bridge: outputs, activity and, for watched nodes,
  /// the knobs' effective values.
  snapshot() {
    const nodes = {};
    for (const st of this.steps) {
      const key = this.alias.has(st.id) ? this.alias.get(st.id) : st.id;   // a node inside a Voice Cell is shown by its first voice
      if (key === null) continue;
      const host = st.host, out = host.views.outputs, entry = { outputs: {} };
      st.spec.outputs.forEach((o, k) => { entry.outputs[o.id] = out[k * CHUNK + CHUNK - 1] ?? 0; });
      entry.activity = {};
      st.spec.outputs.forEach((o, k) => { if (st.activity[k] > 1e-4) entry.activity[o.id] = st.activity[k]; st.activity[k] = 0; });
      const live = host.live();
      Object.assign(entry, live.values);
      Object.assign(entry, live.arrays);
      entry.arrays = live.arrays;   // the native engine's shape, which the module views read (st.arrays.<key>)
      if (this.watched.has(key)) {
        entry.params = {};
        st.spec.params.forEach((p, i) => {
          const v = host.knobs[i] ?? p.default;
          const e = host.views.params[i * CHUNK + CHUNK - 1];
          entry.params[p.id] = { v, e, a: st.paramSources[i].length > 0, t: host.paramText(i, st.paramSources[i].length ? e : v) };
        });
      }
      const taken = host.takeData();
      if (taken !== null) entry.data = taken;
      else if (this.pendingData.has(key)) entry.data = this.pendingData.get(key);
      nodes[key] = entry;
    }
    this.pendingData.clear();
    return { nodes };
  }
}
