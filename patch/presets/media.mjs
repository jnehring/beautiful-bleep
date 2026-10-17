// SPDX-License-Identifier: MIT
//
// Factory samples in presets. A node refers to a WAV by its media id, "<16 hex>.wav", the FNV-1a hash of the file *as the engine
// stores it*: Media.cpp decodes whatever it is given to float and saves it as a 32-bit float WAV, and hashes that. The
// files here are 16-bit, so the id is computed from the 32-bit float encoding of the same samples (int16 / 32768, which is exact),
// and the engine, importing the 16-bit file, arrives at the same id. A preset carries the files it uses in its `media` map
// (common/ui/bleep-media.js); the board imports them when it places or loads the preset.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = new URL("./samples/", import.meta.url);
/// What a shared preset may carry (bleep-media.js LIMITS; the size counts the engine's 32-bit float form).
export const LIMITS = { files: 8, bytes: 5 * 1024 * 1024 };

const cache = new Map();

/// A factory sample (samples/<name>.wav): { id, name, frames, rate, seconds, bytes (as stored by the engine), entry: {name, data} }.
export function loadSample(name) {
  if (cache.has(name)) return cache.get(name);
  const file = fileURLToPath(new URL(`${name}.wav`, DIR));
  if (!existsSync(file)) throw new Error(`no factory sample '${name}' (patch/presets/samples/${name}.wav; see samples/README.md)`);
  const buf = readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.readUInt16LE(20) !== 1 || buf.readUInt16LE(22) !== 1 || buf.readUInt16LE(34) !== 16 || buf.toString("latin1", 36, 40) !== "data")
    throw new Error(`samples/${name}.wav: expected a mono 16-bit PCM WAV with a 44-byte header`);
  const rate = buf.readUInt32LE(24), frames = buf.readUInt32LE(40) / 2;
  // The engine's form: 44-byte header, then little-endian float32 samples.
  const enc = Buffer.alloc(44 + frames * 4);
  enc.write("RIFF", 0); enc.writeUInt32LE(36 + frames * 4, 4); enc.write("WAVEfmt ", 8); enc.writeUInt32LE(16, 16);
  enc.writeUInt16LE(3, 20); enc.writeUInt16LE(1, 22); enc.writeUInt32LE(rate, 24); enc.writeUInt32LE(rate * 4, 28);
  enc.writeUInt16LE(4, 32); enc.writeUInt16LE(32, 34); enc.write("data", 36); enc.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) enc.writeFloatLE(Math.fround(buf.readInt16LE(44 + i * 2) / 32768), 44 + i * 4);
  let h = 0xcbf29ce484222325n;
  const P = 0x100000001b3n, M = (1n << 64n) - 1n;
  for (const b of enc) h = ((h ^ BigInt(b)) * P) & M;
  const id = h.toString(16).padStart(16, "0") + ".wav";
  const s = { id, name, frames, rate, seconds: frames / rate, bytes: enc.length, entry: { name: `${name}.wav`, data: buf.toString("base64") } };
  cache.set(name, s);
  return s;
}

/// Sampler node data for a sample: `markers` are frame positions (at the sample's own rate, which is the engine's 48 kHz
/// for the sliced ones), `slicing` the settings the view shows.
export function samplerData(s, { markers = [], slices = {}, slicing } = {}) {
  return { clip: s.id, length: s.frames, markers, current: 0, slices,
           slicing: { kind: markers.length ? "manual" : "manual", threshold: 0.5, minGap: 30, beats: 16, bpm: 120, bars: 4, ...(slicing || {}) } };
}

/// Grains node data: the clip it plays instead of recording its input.
export const grainsData = (s) => ({ frozen: s.id });

/// Markers that cut `s` into `n` equal slices (frame positions).
export const equalMarkers = (s, n) => Array.from({ length: n - 1 }, (_, i) => Math.round(((i + 1) * s.frames) / n));

/// A media map is within what may be shared: the files, and the engine-form bytes.
export function checkMedia(name, media) {
  const ids = Object.keys(media);
  if (ids.length > LIMITS.files) throw new Error(`${name}: carries ${ids.length} audio files, at most ${LIMITS.files}`);
  let bytes = 0;
  for (const id of ids) for (const s of cache.values()) if (s.id === id) bytes += s.bytes;
  if (bytes > LIMITS.bytes) throw new Error(`${name}: its audio is ${(bytes / 1048576).toFixed(1)} MB (32-bit), at most ${LIMITS.bytes / 1048576}`);
}
