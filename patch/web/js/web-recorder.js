// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// web-recorder.js — the recorder service of the browser build (doc/specs/recorder-service.md, section 5). It answers a module's
// bleep_record_* imports (developers/modules/module-abi.md, section 5b) from memory: the samples are kept in chunks, and when a
// session ends the finished takes go to the page (web-recordings.js), which turns them into WAV files in one zip to download.
//
// Browsers cannot say how much memory is free, so there is a fixed budget (the page sets it, web-recordings.js budgetFor). Every
// chunk counts against it; when the next chunk does not fit, the session fails and keeps what it has, instead of taking the tab down.
// What the page still holds counts until it lets go of it (release).
//
// Runs in the AudioWorklet (no DOM, no TextEncoder) and under node (the tests). One MemoryRecorder per engine; bind() gives each
// module instance its own handle table, like the native WasmModule's recorder.

export const CHUNK_FRAMES = 16384;       // frames per allocation: about a third of a second per track
export const MAX_TRACKS = 40;
const MAX_SESSIONS = 4;                  // per module instance, as in the native host
const DEFAULT_BUDGET = 256 * 1024 * 1024;
const WARN_AT = 0.9;

const BYTES = [2, 3, 4];                 // per sample, by format: 0 = 16-bit, 1 = 24-bit, 2 = 32-bit float

export class MemoryRecorder {
  /// `post(message, transferList)` hands a finished recording to the page.
  constructor({ budget = DEFAULT_BUDGET, post = () => {} } = {}) {
    this.budget = budget;
    this.used = 0;
    this.post = post;
    this.nextId = 1;
  }
  setBudget(bytes) { if (Number.isFinite(bytes) && bytes > 0) this.budget = bytes; }
  /// The page dropped a finished recording (downloaded and discarded): its memory is free again.
  release(bytes) { this.used = Math.max(0, this.used - (Number(bytes) || 0)); }
  get free() { return Math.max(0, this.budget - this.used); }
  /// What a module instance talks to.
  bind() { return new Bound(this); }
}

class Bound {
  constructor(rec) {
    this.rec = rec;
    this.sessions = new Array(MAX_SESSIONS).fill(null);
    this.message = "";   // why the last open was refused
  }

  /// `spec`: {"name", "tracks": [{"name", "channels"}]}. A handle (>= 1), or -1 when it is refused (text(0, 1) says why).
  open(specJson, sampleRate, format) {
    this.message = "";
    let spec;
    try { spec = JSON.parse(specJson); } catch (e) { spec = null; }
    const tracks = spec && Array.isArray(spec.tracks) ? spec.tracks : [];
    if (!tracks.length) { this.message = "No track is armed."; return -1; }
    if (tracks.length > MAX_TRACKS) { this.message = "Too many tracks."; return -1; }
    for (const t of tracks) if (t.channels !== 1 && t.channels !== 2) { this.message = "A track has one or two channels."; return -1; }
    const slot = this.sessions.indexOf(null);
    if (slot < 0) { this.message = "Too many recordings are open."; return -1; }
    const fmt = format === 0 || format === 1 ? format : 2;
    this.sessions[slot] = {
      name: String(spec.name || "Recording"), rate: sampleRate, format: fmt, bps: BYTES[fmt], startedAt: Date.now(),
      tracks: tracks.map((t) => ({ name: String(t.name || "Track"), channels: t.channels, takes: [] })),
      takeOpen: false, takeNo: 0, failed: false, message: "",
    };
    return slot + 1;
  }

  #at(handle) { return handle >= 1 && handle <= MAX_SESSIONS ? this.sessions[handle - 1] : null; }

  take(handle, begin) {
    const s = this.#at(handle);
    if (!s || s.failed) return 0;
    if (!begin) { s.takeOpen = false; return 1; }
    for (const t of s.tracks) t.takes.push({ chunks: [], frames: 0 });
    s.takeOpen = true;
    s.takeNo++;
    return 1;
  }

  /// `left` and `right`: Float32Arrays of `frames` samples (right is ignored for a track of one channel).
  write(handle, track, left, right, frames) {
    const s = this.#at(handle);
    if (!s || s.failed || !s.takeOpen || track < 0 || track >= s.tracks.length) return 0;
    const tr = s.tracks[track], take = tr.takes[tr.takes.length - 1], ch = tr.channels;
    let done = 0;
    while (done < frames) {
      let chunk = take.chunks[take.chunks.length - 1];
      const filled = take.frames - (take.chunks.length - 1) * CHUNK_FRAMES;
      if (!chunk || filled >= CHUNK_FRAMES) {
        const bytes = CHUNK_FRAMES * ch * s.bps;
        if (this.rec.used + bytes > this.rec.budget) return this.#fail(s, "The memory budget is used up. The recording stopped; download it before you start another.");
        try {
          chunk = s.format === 0 ? new Int16Array(CHUNK_FRAMES * ch) : s.format === 1 ? new Uint8Array(CHUNK_FRAMES * ch * 3) : new Float32Array(CHUNK_FRAMES * ch);
        } catch (e) {  // the browser refused the memory: end the take, not the tab
          return this.#fail(s, "The browser could not give any more memory. The recording stopped.");
        }
        this.rec.used += bytes;
        take.chunks.push(chunk);
        if (this.rec.used > this.rec.budget * WARN_AT) s.message = "The memory budget is nearly used up.";
      }
      const at = take.frames - (take.chunks.length - 1) * CHUNK_FRAMES;
      const n = Math.min(frames - done, CHUNK_FRAMES - at);
      fill(chunk, at, ch, s.format, left, right, done, n);
      take.frames += n;
      done += n;
    }
    return 1;
  }

  #fail(s, why) {
    s.failed = true;
    s.takeOpen = false;
    s.message = why;
    return 0;
  }

  /// Bit 0: a take is open; bit 1: the session failed. `out` receives {frames, take}.
  status(handle, out) {
    const s = this.#at(handle);
    if (!s) return 0;
    const tr = s.tracks[0], take = tr.takes[tr.takes.length - 1];
    out.frames = take ? take.frames : 0;
    out.take = s.takeNo;
    return (s.takeOpen ? 1 : 0) | (s.failed ? 2 : 0);
  }

  /// 0 = where the files go, 1 = the last message, 2 = the session's folder.
  text(handle, what) {
    if (what === 0) return "Memory: the recording is offered as a download when it ends";
    const s = this.#at(handle);
    if (what === 1) return s ? s.message : this.message;
    return "";
  }

  get free() { return this.rec.free; }

  /// Ends the session. The finished takes go to the page, with their memory, which still counts until the page releases it.
  close(handle) {
    const s = this.#at(handle);
    if (!s) return;
    this.sessions[handle - 1] = null;
    const tracks = [], transfer = [];
    let bytes = 0, frames = 0;
    for (const t of s.tracks) {
      const takes = [];
      for (const take of t.takes) {
        const chunkBytes = take.chunks.length * CHUNK_FRAMES * t.channels * s.bps;
        if (take.frames === 0) { this.rec.used = Math.max(0, this.rec.used - chunkBytes); continue; }   // an empty take is not kept
        bytes += chunkBytes;
        frames += take.frames;
        const buffers = take.chunks.map((c) => c.buffer);
        transfer.push(...buffers);
        takes.push({ frames: take.frames, chunks: buffers });
      }
      tracks.push({ name: t.name, channels: t.channels, takes });
    }
    if (!frames) return;
    this.rec.post({ cmd: "recording", recording: { id: this.rec.nextId++, name: s.name, rate: s.rate, format: s.format, startedAt: s.startedAt, bytes, tracks } }, transfer);
  }

  /// The module instance is gone: whatever it recorded is not lost.
  dispose() { for (let h = 1; h <= MAX_SESSIONS; ++h) this.close(h); }
}

/// Converts `n` frames from `left` / `right` (starting at `from`) into the chunk, interleaved, at frame `at`.
function fill(chunk, at, channels, format, left, right, from, n) {
  for (let i = 0; i < n; ++i) {
    for (let c = 0; c < channels; ++c) {
      let x = (c === 0 ? left : right)[from + i];
      x = x > 1 ? 1 : x < -1 ? -1 : (x === x ? x : 0);
      const k = (at + i) * channels + c;
      if (format === 2) chunk[k] = x;
      else if (format === 0) chunk[k] = Math.round(x * 32767);
      else {
        const v = Math.round(x * 8388607);
        chunk[k * 3] = v & 255;
        chunk[k * 3 + 1] = (v >> 8) & 255;
        chunk[k * 3 + 2] = (v >> 16) & 255;
      }
    }
  }
}
