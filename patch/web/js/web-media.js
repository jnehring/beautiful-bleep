// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// web-media.js — the media folder of the browser build (engine/Media.h has the native one). The audio files that modules use (the
// Sampler's reel, a wavetable, a grain buffer) are kept in IndexedDB under the same ids as the native folder: "<16 hex digits>.wav",
// the FNV-1a hash of the file as Media.cpp encodes it (32-bit float WAV). So a board or preset made in the app finds its audio here,
// and the other way round.
//
// This file decodes and stores; it knows nothing of the audio engine. bleep-web.js sends the decoded clips a board uses to the
// worklet, where graph.js answers the modules' bleep_media_info / bleep_media_read calls from them.
//
// The environment is passed in so the tests can run it under node:
//   idb   an IDBFactory (indexedDB), or null / something that throws: the audio then lasts for the visit only
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BleepWebMedia = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ID = /^[0-9a-f]{16}\.wav$/;
  const MAX_FILE_BYTES = 128 * 1024 * 1024;   // a larger file is refused before it is decoded
  const DB_NAME = "bleep.web.media", STORE = "media";

  const u16 = (b, p) => b[p] | (b[p + 1] << 8);
  const u32 = (b, p) => (u16(b, p) | (u16(b, p + 2) << 16)) >>> 0;
  const tag = (b, p, s) => { for (let i = 0; i < 4; i++) if (b[p + i] !== s.charCodeAt(i)) return false; return true; };

  /// A WAV file's bytes as {rate, channels: [Float32Array]}: PCM 8/16/24/32 bit and float 32/64 bit, any channel count
  /// (Media.cpp decodeWav). Throws an Error with a message for the visitor on anything it cannot read.
  function decodeWav(bytes) {
    const size = bytes.length;
    if (size < 12 || !tag(bytes, 0, "RIFF") || !tag(bytes, 8, "WAVE")) throw new Error("not a WAV file");
    let format = 0, nch = 0, rate = 0, bits = 0, pcm = -1, pcmSize = 0;
    for (let pos = 12; pos + 8 <= size;) {
      const len = u32(bytes, pos + 4), body = pos + 8, avail = Math.min(len, size - body);
      if (tag(bytes, pos, "fmt ") && avail >= 16) {
        format = u16(bytes, body); nch = u16(bytes, body + 2); rate = u32(bytes, body + 4); bits = u16(bytes, body + 14);
        if (format === 0xfffe && avail >= 26) format = u16(bytes, body + 24);   // WAVE_FORMAT_EXTENSIBLE: the sub-format
      } else if (tag(bytes, pos, "data")) {
        pcm = body; pcmSize = avail;
      }
      pos += 8 + len + (len & 1);
    }
    if (pcm < 0 || nch === 0 || nch > 64 || rate === 0) throw new Error("WAV file without audio");
    const isFloat = format === 3;
    if (!(format === 1 || isFloat)) throw new Error("compressed WAV files are not supported");
    if (!(isFloat ? bits === 32 || bits === 64 : bits === 8 || bits === 16 || bits === 24 || bits === 32)) throw new Error("unsupported sample format");
    const step = bits / 8, frameBytes = nch * step, frames = Math.floor(pcmSize / frameBytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channels = [];
    for (let c = 0; c < nch; c++) {
      const out = new Float32Array(frames);
      for (let f = 0, p = pcm + c * step; f < frames; f++, p += frameBytes) {
        let v;
        if (isFloat) v = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
        else if (bits === 8) v = (bytes[p] - 128) / 128;
        else if (bits === 16) v = view.getInt16(p, true) / 32768;
        else if (bits === 24) v = ((bytes[p] << 8) | (bytes[p + 1] << 16) | (bytes[p + 2] << 24)) / 2147483648;   // the top 24 bits of an int32
        else v = view.getInt32(p, true) / 2147483648;
        out[f] = Number.isFinite(v) ? v : 0;
      }
      channels.push(out);
    }
    return { rate, channels };
  }

  /// The clip as the media folder stores it: a 32-bit float WAV (Media.cpp encodeWav).
  function encodeWav(clip) {
    const nch = Math.max(1, clip.channels.length), frames = clip.channels.length ? clip.channels[0].length : 0;
    const dataBytes = frames * nch * 4, out = new Uint8Array(44 + dataBytes), v = new DataView(out.buffer);
    out.set([0x52, 0x49, 0x46, 0x46], 0); v.setUint32(4, 36 + dataBytes, true);
    out.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
    v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, nch, true);
    v.setUint32(24, clip.rate, true); v.setUint32(28, clip.rate * nch * 4, true); v.setUint16(32, nch * 4, true); v.setUint16(34, 32, true);
    out.set([0x64, 0x61, 0x74, 0x61], 36); v.setUint32(40, dataBytes, true);
    for (let c = 0; c < nch; c++) {
      const src = clip.channels[c];
      if (src) for (let f = 0, p = 44 + c * 4; f < frames; f++, p += nch * 4) v.setFloat32(p, src[f], true);
    }
    return out;
  }

  /// "<16 hex>.wav": FNV-1a 64 over the stored bytes, as Media.cpp hashId.
  function hashId(bytes) {
    let lo = 0x84222325, hi = 0xcbf29ce4;   // the offset basis 0xcbf29ce484222325
    for (let i = 0; i < bytes.length; i++) {
      lo = (lo ^ bytes[i]) >>> 0;
      // × 0x100000001b3 (2^40 + 0x1b3) modulo 2^64, in doubles: nothing here exceeds 2^53
      const t = lo * 0x1b3;
      const carry = Math.floor(t / 4294967296);
      hi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) % 4294967296;
      lo = t % 4294967296;
    }
    return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0") + ".wav";
  }

  function toBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromBase64(text) {
    const bin = atob(text), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /// The media ids in some node data (or a list of nodes' data): every string that is one, once each, in order.
  function idsIn(value) {
    const seen = new Set();
    const walk = (v, depth) => {
      if (depth > 12 || v === null || v === undefined) return;
      if (typeof v === "string") { if (ID.test(v)) seen.add(v); return; }
      if (typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
    };
    walk(value, 0);
    return [...seen];
  }

  function create(env = {}) {
    const entries = new Map();   // id → {name, bytes, clip?}: what this visit has seen
    let dbPromise = null;

    const open = () => {
      if (!dbPromise) {
        dbPromise = new Promise((resolve) => {
          try {
            const req = env.idb.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = req.onblocked = () => resolve(null);
          } catch (e) { resolve(null); }   // no IndexedDB (private window, blocked): memory only
        });
      }
      return dbPromise;
    };
    const request = async (mode, run) => {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    };

    async function entry(id) {
      if (!ID.test(id)) return null;
      if (entries.has(id)) return entries.get(id);
      const saved = await request("readonly", (s) => s.get(id));
      if (!saved || !(saved.bytes instanceof Uint8Array)) return null;
      const e = { name: saved.name || id, bytes: saved.bytes };
      entries.set(id, e);
      return e;
    }

    /// Imports a WAV file: decode, store, answer {id, name, seconds, channels} or {error} (the native importMedia).
    async function importBytes(name, bytes) {
      if (bytes.length > MAX_FILE_BYTES) return { error: `the file is larger than ${MAX_FILE_BYTES / 1048576} MB` };
      let clip;
      try { clip = decodeWav(bytes); } catch (e) { return { error: e.message }; }
      const frames = clip.channels[0].length;
      if (frames < 1) return { error: "WAV file without audio" };
      const stored = encodeWav(clip), id = hashId(stored), file = String(name || id);
      if (!entries.has(id)) entries.set(id, { name: file, bytes: stored, clip });
      await request("readwrite", (s) => s.put({ name: file, bytes: stored }, id));
      return { id, name: file, seconds: frames / clip.rate, channels: clip.channels.length };
    }
    async function importBase64(name, text) {
      let bytes;
      try { bytes = fromBase64(String(text || "")); } catch (e) { return { error: "could not read the file" }; }
      return importBytes(name, bytes);
    }
    /// {data: base64, name} of a stored file, or {error} (the native readMedia).
    async function read(id) {
      if (!ID.test(String(id))) return { error: "not a media id" };
      const e = await entry(id);
      return e ? { data: toBase64(e.bytes), name: e.name } : { error: "not in the media folder" };
    }
    /// The decoded audio, {rate, channels: [Float32Array]}, or null when this browser does not have the file.
    async function clip(id) {
      const e = await entry(id);
      if (!e) return null;
      if (!e.clip) { try { e.clip = decodeWav(e.bytes); } catch (err) { return null; } }
      return e.clip;
    }

    return { importBytes, importBase64, read, clip };
  }

  return { create, decodeWav, encodeWav, hashId, idsIn, toBase64, fromBase64, ID };
});
