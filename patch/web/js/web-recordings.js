// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// web-recordings.js — the page's side of recording in the browser build (doc/specs/recorder-service.md, section 5). The worklet
// records into memory (web-recorder.js) and hands each finished session over; this keeps them until the visitor downloads or discards
// them, and builds the download: every track of every take as a WAV file, in one zip (stored, not compressed), one file after the
// other, from the recorded chunks themselves, so the memory is not copied.
//
// No audio and no DOM here except download(); the environment is passed in so the tests run it under node.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BleepWebRecordings = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CHUNK_FRAMES = 16384;                  // as web-recorder.js
  const BYTES = [2, 3, 4];
  const MB = 1024 * 1024;
  const MAX_WAV_DATA = 0xf0000000;             // a classic WAV file ends at 4 GiB
  const MAX_ZIP = 0xf0000000;                  // no ZIP64: the budget keeps a download far below this

  /// How much memory recordings may use. A browser cannot say how much is free, so: a quarter of navigator.deviceMemory (GB, rounded
  /// and capped at 8 by browsers) where it exists, between 256 MB and 1 GB; 256 MB where it does not (Safari, Firefox, phones).
  function budgetFor(nav) {
    const gb = nav && Number(nav.deviceMemory);
    if (!(gb > 0)) return 256 * MB;
    return Math.round(Math.min(1024 * MB, Math.max(256 * MB, gb * 1024 * MB * 0.25)));
  }

  /// A file name that is safe everywhere (the disk service's rule: Recording.cpp safeName).
  function safeName(text) {
    let s = String(text).replace(/[\u0000-\u001f/\\:*?"<>|]/g, "-").replace(/^[ .]+/, "").replace(/[ .]+$/, "").slice(0, 60);
    return s || "Track";
  }

  const pad = (n, w = 2) => String(n).padStart(w, "0");
  /// "2026-10-24 14.32.07", local time, as the disk service names a session's folder.
  function stamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  }

  function wavHeader(channels, rate, format, dataBytes) {
    const bps = BYTES[format], h = new DataView(new ArrayBuffer(44));
    const tag = (at, s) => { for (let i = 0; i < 4; i++) h.setUint8(at + i, s.charCodeAt(i)); };
    tag(0, "RIFF"); h.setUint32(4, 36 + dataBytes, true); tag(8, "WAVE"); tag(12, "fmt ");
    h.setUint32(16, 16, true); h.setUint16(20, format === 2 ? 3 : 1, true); h.setUint16(22, channels, true);
    h.setUint32(24, Math.round(rate), true); h.setUint32(28, Math.round(rate) * channels * bps, true);
    h.setUint16(32, channels * bps, true); h.setUint16(34, bps * 8, true);
    tag(36, "data"); h.setUint32(40, dataBytes, true);
    return new Uint8Array(h.buffer);
  }

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  /// CRC-32 of a list of byte arrays.
  function crc32(parts) {
    let c = 0xffffffff;
    for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /// The bytes of one take of one track: the WAV header and the chunks, the last one cut to what was recorded. Little-endian: every
  /// platform a browser runs on.
  function wavParts(track, take, rate, format) {
    const bps = BYTES[format], per = track.channels * bps;
    const dataBytes = take.frames * per;
    if (dataBytes > MAX_WAV_DATA) throw new Error("a take is larger than a WAV file can be (4 GB)");
    const parts = [wavHeader(track.channels, rate, format, dataBytes)];
    let left = take.frames;
    for (const buffer of take.chunks) {
      const n = Math.min(left, CHUNK_FRAMES);
      parts.push(new Uint8Array(buffer, 0, n * per));
      left -= n;
    }
    return parts;
  }

  const u16 = (v, at, x) => v.setUint16(at, x, true);
  const u32 = (v, at, x) => v.setUint32(at, x >>> 0, true);
  const dosTime = (d) => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = (d) => ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const utf8 = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)));

  /// A zip of `files` ([{name, parts}]) as a list of byte arrays (a Blob's parts), stored without compression.
  function zipParts(files, when) {
    const date = new Date(when), out = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = utf8(f.name), size = f.parts.reduce((n, p) => n + p.length, 0), crc = crc32(f.parts);
      const local = new DataView(new ArrayBuffer(30));
      u32(local, 0, 0x04034b50); u16(local, 4, 20); u16(local, 6, 0x0800); u16(local, 8, 0);
      u16(local, 10, dosTime(date)); u16(local, 12, dosDate(date)); u32(local, 14, crc); u32(local, 18, size); u32(local, 22, size);
      u16(local, 26, name.length); u16(local, 28, 0);
      out.push(new Uint8Array(local.buffer), name, ...f.parts);
      const c = new DataView(new ArrayBuffer(46));
      u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x0800); u16(c, 10, 0);
      u16(c, 12, dosTime(date)); u16(c, 14, dosDate(date)); u32(c, 16, crc); u32(c, 20, size); u32(c, 24, size);
      u16(c, 28, name.length); u16(c, 30, 0); u16(c, 32, 0); u16(c, 34, 0); u16(c, 36, 0); u32(c, 38, 0); u32(c, 42, offset);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + size;
      if (offset > MAX_ZIP) throw new Error("the recording is too large for one zip");
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    u32(end, 0, 0x06054b50); u16(end, 4, 0); u16(end, 6, 0); u16(end, 8, files.length); u16(end, 10, files.length);
    u32(end, 12, centralSize); u32(end, 16, offset); u16(end, 20, 0);
    return [...out, ...central, new Uint8Array(end.buffer)];
  }

  /// The files of a recording: "<track>.wav", "<track> (take 2).wav", inside "<time> <name>/", names made unique as the disk service does.
  function filesOf(rec) {
    const folder = `${stamp(rec.startedAt)} ${safeName(rec.name)}/`;
    const names = [];
    const files = [];
    for (const t of rec.tracks) {
      const base = safeName(t.name);
      let unique = base;
      for (let k = 2; names.includes(unique); ++k) unique = `${base} ${k}`;
      names.push(unique);
    }
    // take numbers are the session's: a take that came out empty on every track leaves a gap in the numbers, like on disk
    rec.tracks.forEach((t, i) => t.takes.forEach((take, n) => {
      files.push({ name: `${folder}${names[i]}${n ? ` (take ${n + 1})` : ""}.wav`, parts: wavParts(t, take, rec.rate, rec.format) });
    }));
    return { folder, files };
  }

  /// `onRelease(bytes)`: a recording's memory was dropped (tell the worklet's recorder).
  function create({ onRelease } = {}) {
    const recordings = new Map();
    const api = {
      /// A finished session from the worklet: {id, name, rate, format, startedAt, bytes, tracks: [{name, channels, takes: [{frames, chunks}]}]}.
      add(rec) { recordings.set(rec.id, rec); if (api.onChange) api.onChange(); return rec.id; },
      list() {
        return [...recordings.values()].map((r) => {
          const frames = r.tracks.length ? r.tracks[0].takes.reduce((n, t) => n + t.frames, 0) : 0;
          return { id: r.id, name: r.name, startedAt: r.startedAt, seconds: r.rate ? frames / r.rate : 0, bytes: r.bytes,
                   tracks: r.tracks.length, takes: r.tracks.length ? r.tracks[0].takes.length : 0 };
        });
      },
      get(id) { return recordings.get(id) || null; },
      /// The zip of a recording: {name, blob}. Throws an Error with a message for the visitor if it cannot be made.
      zip(id) {
        const rec = recordings.get(id);
        if (!rec) throw new Error("that recording is gone");
        const { folder, files } = filesOf(rec);
        return { name: folder.slice(0, -1) + ".zip", blob: new Blob(zipParts(files, rec.startedAt), { type: "application/zip" }) };
      },
      /// Offers the zip to the visitor. Resolves to {name, bytes} or {error}.
      download(id) {
        try {
          const { name, blob } = api.zip(id);
          const url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return { name, bytes: blob.size };
        } catch (e) {
          return { error: e.message };
        }
      },
      discard(id) {
        const rec = recordings.get(id);
        if (!rec) return;
        recordings.delete(id);
        if (onRelease) onRelease(rec.bytes);
        if (api.onChange) api.onChange();
      },
      onChange: null,
    };
    return api;
  }

  return { create, budgetFor, safeName, stamp, wavHeader, wavParts, zipParts, filesOf, crc32 };
});
