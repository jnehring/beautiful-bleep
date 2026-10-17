// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep-media.js — the audio files a preset carries (doc/specs/preset-system-plan.md, "Samples in presets").
//
// A node stores only a media id (Media.h: "<16 hex digits>.wav", the hash of the file); the audio is a WAV in the media folder of the
// computer. A preset is copied, so it takes its audio along: an optional `media` map in the preset (a cell, a project, a shared file)
//
//   media: { "0123456789abcdef.wav": { name: "kick.wav", data: "<base64 of the file>" } }
//
// Saving a preset attaches the files its nodes use; placing or loading one imports the files it does not have yet (importing the same
// file again stores it once, as the id is a function of the audio). A file that cannot be read is left out and the node shows as missing,
// as for any board whose media folder lacks a file. The page does the reading and writing through the native functions readMedia and
// importMedia; nothing here touches the disk.
(function () {
  "use strict";

  const ID = /^[0-9a-f]{16}\.wav$/;
  /// What a shared preset may carry: the API refuses more (website/api/app/routers/presets.py).
  const LIMITS = { files: 8, bytes: 5 * 1024 * 1024 };

  /// The media ids the nodes use, in order, once each: every string in a node's `data` that is a media id.
  function ids(nodes) {
    const seen = new Set();
    const walk = (v, depth) => {
      if (depth > 12 || v === null || v === undefined) return;
      if (typeof v === "string") { if (ID.test(v)) seen.add(v); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
      if (typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
    };
    for (const n of nodes || []) if (n && n.data) walk(n.data, 0);
    return [...seen];
  }

  /// The size in bytes of a base64 string's content.
  function decodedBytes(b64) {
    const s = String(b64 || "");
    const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
  }

  /// A media map as it should be: only valid ids with a name and base64 data; at most LIMITS.files (anything else is dropped).
  function clean(media) {
    const out = {};
    if (!media || typeof media !== "object" || Array.isArray(media)) return out;
    for (const [id, f] of Object.entries(media)) {
      if (!ID.test(id) || !f || typeof f.data !== "string" || !f.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)) continue;
      out[id] = { name: typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 120) : id, data: f.data };
      if (Object.keys(out).length >= LIMITS.files) break;
    }
    return out;
  }

  /// The audio bytes of a media map.
  function size(media) {
    return Object.values(clean(media)).reduce((sum, f) => sum + decodedBytes(f.data), 0);
  }

  /// Does a media map fit what may be shared? null when it does, else what is wrong.
  function tooBig(media) {
    const n = Object.keys(media || {}).length, bytes = size(media);
    if (n > LIMITS.files) return `at most ${LIMITS.files} audio files can be shared (this has ${n})`;
    if (bytes > LIMITS.bytes) return `the audio can be up to ${LIMITS.bytes / 1048576} MB when shared (this has ${(bytes / 1048576).toFixed(1)} MB)`;
    return null;
  }

  /// Puts the audio the nodes use into `preset.media`. `read(id)` answers {data: base64, name?} or {error}. Returns the ids it could not read.
  async function attach(preset, nodes, read) {
    const missing = [];
    const media = {};
    for (const id of ids(nodes)) {
      let r = null;
      try { r = await read(id); } catch (e) { r = null; }
      if (r && typeof r.data === "string" && r.data) media[id] = { name: r.name || id, data: r.data };
      else missing.push(id);
    }
    const kept = clean(media);
    if (Object.keys(kept).length) preset.media = kept;
    else delete preset.media;
    return missing;
  }

  /// Imports a preset's audio into the media folder. `put(name, base64)` answers {id} or {error}. Returns what went wrong: [string].
  async function importAll(media, put) {
    const problems = [];
    for (const [id, f] of Object.entries(clean(media))) {
      let r = null;
      try { r = await put(f.name, f.data); } catch (e) { r = { error: e && e.message ? e.message : String(e) }; }
      if (!r || r.error) problems.push(`${f.name}: ${(r && r.error) || "could not be imported"}`);
      else if (r.id !== id) problems.push(`${f.name}: is stored under another id (${r.id}), so the preset cannot find it`);
    }
    return problems;
  }

  window.BleepMedia = { ID, LIMITS, ids, decodedBytes, clean, size, tooBig, attach, importAll };
})();
