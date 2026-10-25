// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// module-host.js — runs one Bleep module that was compiled to its own
// standalone .wasm (web/src/WebShim.cpp). Works in an AudioWorklet, a worker,
// the main thread and node: only WebAssembly is used.

const CHUNK = 32;

// AudioWorkletGlobalScope has no TextEncoder / TextDecoder.
function utf8Decode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp = b;
    if (b >= 0xf0) { cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); }
    else if (b >= 0xe0) { cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); }
    else if (b >= 0xc0) { cp = ((b & 31) << 6) | (bytes[i++] & 63); }
    out += String.fromCodePoint(cp);
  }
  return out;
}
function utf8Encode(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}
const NOTE_SIZE = 16;  // sizeof(NoteEvent)
export const NOTE_ON = 0, NOTE_OFF = 1, NOTE_PRESSURE = 2, NOTE_CC = 3, NOTE_PROGRAM = 4, NOTE_BEND = 5,
  NOTE_CHANNEL_PRESSURE = 6, NOTE_SYSTEM = 7;

function writeNote(v, at, e) {
  v.setUint8(at, e.type ?? 0);
  v.setUint8(at + 1, e.channel ?? 0);
  v.setInt16(at + 2, e.offset ?? 0, true);
  v.setInt32(at + 4, e.note ?? 60, true);
  v.setFloat32(at + 8, e.pitch ?? 0, true);
  v.setFloat32(at + 12, e.value ?? 0, true);
}

/// The few WASI calls a standalone module may import. Output is dropped.
function wasiImports(getMemory) {
  const view = () => new DataView(getMemory().buffer);
  const zero = () => 0;
  return {
    wasi_snapshot_preview1: {
      fd_write: (fd, iovs, n, written) => {
        let total = 0;
        for (let i = 0; i < n; ++i) total += view().getUint32(iovs + i * 8 + 4, true);
        view().setUint32(written, total, true);
        return 0;
      },
      fd_close: zero, fd_seek: () => 70, fd_read: () => 8, fd_fdstat_get: () => 8,
      environ_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
      environ_get: zero,
      args_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
      args_get: zero,
      clock_time_get: (id, precision, out) => { view().setBigUint64(out, 0n, true); return 0; },
      proc_exit: (code) => { throw new Error(`module exited with ${code}`); },
    },
    env: {
      emscripten_notify_memory_growth: zero,
    },
  };
}

const C_STRING_MAX = 4096;  // a module's error text is short; an unterminated string must not be scanned to the end of the memory

function cString(memory, ptr) {
  const bytes = new Uint8Array(memory.buffer);
  if (!Number.isInteger(ptr) || ptr < 0 || ptr >= bytes.length) return "(invalid string pointer)";
  const limit = Math.min(bytes.length, ptr + C_STRING_MAX);
  let end = ptr;
  while (end < limit && bytes[end]) ++end;
  if (end === limit && end < bytes.length && bytes[end]) return utf8Decode(bytes.subarray(ptr, end)) + "… (unterminated)";
  return utf8Decode(bytes.subarray(ptr, end));
}

/// Compiles module bytes; the result can be shared and instantiated many times.
export async function compileModule(bytes) {
  return WebAssembly.compile(bytes);
}

/// The node types a file holds (what the board UI gets as `types`), without keeping an instance.
export function readSpecs(module) {
  return instantiate(module).specs;
}

/// bleep_media_info / bleep_media_read (module-abi.md §5a), answered from `media`: a Map of media id → {rate, channels: [Float32Array]}
/// that the engine fills as the page sends clips. A clip that is not there yet is "not available" (0); the engine sends the module's
/// node data again when it arrives.
function mediaImports(getMemory, media) {
  const idOf = (ptr, length) => {
    const bytes = new Uint8Array(getMemory().buffer);
    return ptr >= 0 && length > 0 && length <= 64 && ptr + length <= bytes.length ? utf8Decode(bytes.subarray(ptr, ptr + length)) : "";
  };
  return {
    bleep_media_info: (idPtr, idLength, ratePtr, channelsPtr) => {
      const clip = media && media.get(idOf(idPtr, idLength));
      if (!clip || !clip.channels.length) return 0n;
      const v = new DataView(getMemory().buffer);
      v.setFloat64(ratePtr, clip.rate, true);
      v.setInt32(channelsPtr, clip.channels.length, true);
      return BigInt(clip.channels[0].length);
    },
    bleep_media_read: (idPtr, idLength, channel, dst, frames) => {
      const clip = media && media.get(idOf(idPtr, idLength));
      const n = Number(frames);
      if (!clip || channel < 0 || channel >= clip.channels.length || n > clip.channels[channel].length) return 0;
      const memory = getMemory();
      if (dst < 0 || dst + n * 4 > memory.buffer.byteLength) return 0;
      new Float32Array(memory.buffer, dst, n).set(clip.channels[channel].subarray(0, n));
      return 1;
    },
  };
}

/// bleep_record_* (module-abi.md §5b). With a `bound` recorder (web-recorder.js: one per module instance) the module records into
/// memory; without one the host has no recorder and every module that asks is told so (open returns 0, the free space is 0). The
/// fallback below this must not be reached: an unknown import would answer 52, which reads as a handle.
function recordImports(getMemory, bound) {
  if (!bound) {
    return {
      bleep_record_open: () => 0, bleep_record_take: () => 0, bleep_record_write: () => 0, bleep_record_status: () => 0,
      bleep_record_text: () => 0, bleep_record_free: () => 0, bleep_record_room: () => 0, bleep_record_close: () => {},
    };
  }
  const MAX_FRAMES = 16384;
  return {
    bleep_record_open: (ptr, length, rate, format) => {
      const bytes = new Uint8Array(getMemory().buffer);
      if (!(ptr >= 0 && length > 0 && length <= 16384 && ptr + length <= bytes.length)) return -1;
      return bound.open(utf8Decode(bytes.subarray(ptr, ptr + length)), rate, format);
    },
    bleep_record_take: (handle, begin) => bound.take(handle, begin !== 0),
    bleep_record_write: (handle, track, left, right, frames) => {
      const buffer = getMemory().buffer;
      if (!(frames > 0 && frames <= MAX_FRAMES) || left < 0 || right < 0 || left % 4 || right % 4 ||
          left + frames * 4 > buffer.byteLength || right + frames * 4 > buffer.byteLength) return 0;
      return bound.write(handle, track, new Float32Array(buffer, left, frames), new Float32Array(buffer, right, frames), frames);
    },
    bleep_record_status: (handle, framesPtr, takePtr) => {
      const out = { frames: 0, take: 0 };
      const flags = bound.status(handle, out);
      const view = new DataView(getMemory().buffer);
      if (framesPtr >= 0 && framesPtr + 8 <= view.byteLength) view.setBigInt64(framesPtr, BigInt(out.frames), true);
      if (takePtr >= 0 && takePtr + 4 <= view.byteLength) view.setInt32(takePtr, out.take, true);
      return flags;
    },
    bleep_record_text: (handle, what, dst, capacity) => {
      const text = utf8Encode(bound.text(handle, what));
      const memory = new Uint8Array(getMemory().buffer);
      const n = Math.min(text.length, Math.min(Math.max(capacity, 0), 1024));
      if (dst >= 0 && dst + n <= memory.length) memory.set(text.subarray(0, n), dst);
      return n;
    },
    bleep_record_free: () => bound.free,
    bleep_record_room: () => bound.free,   // the browser has one memory budget, whatever folder a module names
    bleep_record_close: (handle) => bound.close(handle),
  };
}

function instantiate(module, media, recorder) {
  let memory = null;
  const imports = wasiImports(() => memory);
  const bound = recorder ? recorder.bind() : null;
  imports.env = { ...imports.env, ...mediaImports(() => memory, media), ...recordImports(() => memory, bound) };
  for (const { module: ns, name, kind } of WebAssembly.Module.imports(module)) {  // anything else: "not supported"
    imports[ns] = imports[ns] || {};
    if (kind === "function" && !imports[ns][name]) imports[ns][name] = () => 52;  // ENOSYS
  }
  const instance = new WebAssembly.Instance(module, imports);
  memory = instance.exports.memory;
  if (instance.exports._initialize) instance.exports._initialize();
  const x = instance.exports;
  const ptr = x.bleep_spec_json();
  const len = x.bleep_spec_json_length();
  const specs = JSON.parse(utf8Decode(new Uint8Array(memory.buffer, ptr, len)));
  return { instance, x, memory, specs, recorder: bound };
}

/// One running module instance: write inputs / params, process(), read outputs.
export class ModuleInstance {
  /// `type`: a node type id, when the file holds several (default: the first).
  /// `media`: the clips the engine has, a Map of media id → {rate, channels} (see mediaImports).
  /// `recorder`: a MemoryRecorder (web-recorder.js) for the bleep_record_* imports; none: this host has no recorder.
  constructor(module, sampleRate, type, media, recorder) {
    const { x, memory, specs, recorder: bound } = instantiate(module, media, recorder);
    this.recorder = bound;
    const typeIndex = Math.max(0, type ? specs.findIndex((s) => s.type === type) : 0);
    const spec = specs[typeIndex];
    this.typeIndex = typeIndex;
    if (x.bleep_chunk() !== CHUNK) throw new Error("module was built for another chunk size");
    this.x = x;
    this.memory = memory;
    this.spec = spec;
    this.handle = x.bleep_create(typeIndex, sampleRate);
    if (!this.handle) throw new Error(`cannot create module ${spec.type}: ${cString(memory, x.bleep_error())}`);
    this.knobs = spec.params.map((p) => p.default);  // normalised, as last set
  }

  /// Float32Array views of the parameter, input and output buffers
  /// (jack i at [i × CHUNK, (i + 1) × CHUNK)); re-made only when the module's memory grew.
  get views() {
    if (this.#viewsOf !== this.memory.buffer) {
      const f = (ptr, count) => new Float32Array(this.memory.buffer, ptr, Math.max(count, 1) * CHUNK);
      this.#views = {
        params: f(this.x.bleep_params_ptr(this.handle), this.spec.params.length),
        inputs: f(this.x.bleep_inputs_ptr(this.handle), this.spec.inputs.length),
        outputs: f(this.x.bleep_outputs_ptr(this.handle), this.spec.outputs.length),
      };
      this.#viewsOf = this.memory.buffer;
    }
    return this.#views;
  }
  #views = null;
  #viewsOf = null;
  get params() { return this.views.params; }
  get inputs() { return this.views.inputs; }
  get outputs() { return this.views.outputs; }
  paramText(index, normalised) { return this.#readText(this.x.bleep_param_text(this.handle, index, normalised)); }

  setKnob(index, normalised) { this.knobs[index] = normalised; this.x.bleep_set_knob(this.handle, index, normalised); }
  setConnected(inputs, outputs) {
    const a = new Uint8Array(this.memory.buffer, this.x.bleep_in_connected_ptr(this.handle), this.spec.inputs.length);
    const b = new Uint8Array(this.memory.buffer, this.x.bleep_out_connected_ptr(this.handle), this.spec.outputs.length);
    a.set(inputs);
    b.set(outputs);
  }
  setTransport(bpm, ppq, playing, samplePos) { this.x.bleep_set_transport(this.handle, bpm, ppq, playing ? 1 : 0, BigInt(samplePos)); }
  process(numSamples) { return this.x.bleep_process(this.handle, numSamples); }
  reset() { this.x.bleep_reset(this.handle); }

  // ---- strings, gestures and live values -------------------------------------
  #writeString(text, extraBytes = 0) {
    const bytes = utf8Encode(text);
    const ptr = this.x.bleep_scratch(this.handle, bytes.length + 1 + extraBytes);
    const mem = new Uint8Array(this.memory.buffer);
    mem.set(bytes, ptr);
    mem[ptr + bytes.length] = 0;
    return { ptr, length: bytes.length };
  }
  #readText(length) {
    return utf8Decode(new Uint8Array(this.memory.buffer, this.x.bleep_text(this.handle), length));
  }
  /// The module's node data made valid, defaults included (ModuleSpec::sanitiseData); null if it has none.
  sanitiseData(json) {
    const { length } = this.#writeString(json || "");
    const n = this.x.bleep_sanitise_data(this.handle, this.typeIndex, length);
    return n < 0 ? null : this.#readText(n);
  }
  setData(json) { const { length } = this.#writeString(json); this.x.bleep_set_data(this.handle, length); }
  /// A performance gesture from the module view (a key played, a button pressed).
  perform(action, args = []) {
    const { ptr, length } = this.#writeString(action, 8 + args.length * 8);
    const offset = (length + 1 + 7) & ~7;  // doubles are aligned
    new Float64Array(this.memory.buffer, ptr + offset, args.length).set(args);
    this.x.bleep_perform(this.handle, offset, args.length);
  }
  command(id, value) { this.#writeString(id); this.x.bleep_command(this.handle, value); }
  /// {values: {name: number}, arrays: {name: number[]}} for the module's view.
  live() { return JSON.parse(this.#readText(this.x.bleep_live(this.handle))); }
  /// Data the module changed itself (a captured loop): a JSON string or null.
  takeData() { const n = this.x.bleep_take_data(this.handle); return n < 0 ? null : this.#readText(n); }

  // ---- the `notes` signal ----------------------------------------------------
  /// Replaces the events of a notes input jack: [{type, channel, offset, note, pitch, value}].
  setNotesIn(jack, events) {
    const ptr = this.x.bleep_notes_in_ptr(this.handle, jack);
    const v = new DataView(this.memory.buffer);
    const n = Math.min(events.length, 64);
    for (let k = 0; k < n; ++k) writeNote(v, ptr + k * NOTE_SIZE, events[k]);
    v.setInt32(ptr + 64 * NOTE_SIZE, n, true);
  }
  notesOut(jack) {
    const ptr = this.x.bleep_notes_out_ptr(this.handle, jack);
    const v = new DataView(this.memory.buffer);
    const n = v.getInt32(ptr + 64 * NOTE_SIZE, true);
    const out = [];
    for (let k = 0; k < n; ++k) {
      const e = ptr + k * NOTE_SIZE;
      out.push({ type: v.getUint8(e), channel: v.getUint8(e + 1), offset: v.getInt16(e + 2, true),
                 note: v.getInt32(e + 4, true), pitch: v.getFloat32(e + 8, true), value: v.getFloat32(e + 12, true) });
    }
    return out;
  }
  destroy() {
    if (this.recorder) this.recorder.dispose();   // a session that is still open is finished, not lost
    if (this.handle) this.x.bleep_destroy(this.handle);
    this.handle = 0;
  }
}

export { CHUNK };
