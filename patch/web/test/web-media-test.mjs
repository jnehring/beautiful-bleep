// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// web-media.js and the media imports of module-host.js: a WAV is imported, stored and decoded, and the Sampler module (a real wasm file)
// loads it, shows its peaks and plays it. Needs the Sampler built for the browser:
//   node --experimental-wasm-exnref patch/web/test/web-media-test.mjs [path/to/sampler.wasm]
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileModule, ModuleInstance, NOTE_ON } from "../js/module-host.js";

const here = dirname(fileURLToPath(import.meta.url));
const W = createRequire(import.meta.url)(join(here, "..", "js", "web-media.js"));

/// A 16-bit PCM WAV: a 440 Hz sine of `seconds` at `rate`.
function sineWav(seconds, rate, channels = 1) {
  const frames = Math.round(seconds * rate), out = new Uint8Array(44 + frames * channels * 2), v = new DataView(out.buffer);
  out.set(Buffer.from("RIFF"), 0); v.setUint32(4, 36 + frames * channels * 2, true); out.set(Buffer.from("WAVEfmt "), 8);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  out.set(Buffer.from("data"), 36); v.setUint32(40, frames * channels * 2, true);
  for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) v.setInt16(44 + (f * channels + c) * 2, Math.round(Math.sin((2 * Math.PI * 440 * f) / rate) * 16000), true);
  return out;
}

// ---- decode, encode, id -------------------------------------------------------------------------------------------------------------
const wav = sineWav(0.5, 44100, 2);
const clip = W.decodeWav(wav);
assert.equal(clip.rate, 44100);
assert.equal(clip.channels.length, 2);
assert.equal(clip.channels[0].length, 22050);
assert.ok(Math.abs(clip.channels[1][10] - Math.sin((2 * Math.PI * 440 * 10) / 44100) * 16000 / 32768) < 2e-5);   // 16-bit rounding
assert.throws(() => W.decodeWav(new Uint8Array(20)), /not a WAV/);
const again = W.decodeWav(W.encodeWav(clip));   // the stored form decodes to the same samples
assert.deepEqual(Array.from(again.channels[0].slice(0, 50)), Array.from(clip.channels[0].slice(0, 50)));
assert.match(W.hashId(W.encodeWav(clip)), /^[0-9a-f]{16}\.wav$/);
assert.equal(W.hashId(new Uint8Array(0)), "cbf29ce484222325.wav");   // FNV-1a 64 of nothing is its offset basis
assert.equal(W.hashId(Buffer.from("a")), "af63dc4c8601ec8c.wav");     // the published FNV-1a 64 test vector for "a"
assert.deepEqual(W.idsIn({ a: ["0123456789abcdef.wav", { b: "0123456789abcdef.wav", c: "nope" }] }), ["0123456789abcdef.wav"]);

// ---- the store (no IndexedDB here: memory only) ---------------------------------------------------------------------------------------
const store = W.create({ idb: null });
assert.match((await store.importBytes("x.wav", new Uint8Array(30))).error, /not a WAV/);
const r = await store.importBytes("sine.wav", wav);
assert.match(r.id, /^[0-9a-f]{16}\.wav$/);
assert.equal(r.name, "sine.wav");
assert.equal(r.channels, 2);
assert.ok(Math.abs(r.seconds - 0.5) < 1e-9);
assert.equal((await store.importBase64("same.wav", W.toBase64(wav))).id, r.id);   // the id is a function of the audio
const read = await store.read(r.id);
assert.equal(W.decodeWav(W.fromBase64(read.data)).channels[0].length, 22050);
assert.equal((await store.read("0123456789abcdef.wav")).error, "not in the media folder");
assert.equal((await store.clip(r.id)).channels.length, 2);
assert.equal(await store.clip("0123456789abcdef.wav"), null);

// ---- the Sampler loads it ---------------------------------------------------------------------------------------------------------------
const file = process.argv[2] || join(here, "..", "..", "..", "build", "web", "site", "modules", "sampler.wasm");
if (!existsSync(file)) { console.log("web-media-test: ok (Sampler wasm not built: skipped the module part)"); process.exit(0); }
const mod = await compileModule(readFileSync(file));
const media = new Map();
const m = new ModuleInstance(mod, 48000, "sampler", media);
const peaks = () => Math.max(0, ...(m.live().arrays.peaks || []));   // the view draws these; all zero is an empty reel
const data = m.sanitiseData(JSON.stringify({ clip: r.id }));
m.setData(data);
assert.equal(peaks(), 0, "the clip is not there yet: nothing to draw");
media.set(r.id, await store.clip(r.id));   // what Engine.addMedia does, which then sets the data again
m.setData(data);
assert.ok(peaks() > 0, "the waveform has peaks");
m.setConnected(m.spec.inputs.map((i) => (i.id === "notes" ? 1 : 0)), m.spec.outputs.map(() => 1));   // the notes cable is patched
const l = m.spec.outputs.findIndex((o) => o.id === "l");
m.setNotesIn(m.spec.inputs.findIndex((i) => i.id === "notes"), [{ type: NOTE_ON, note: 60, value: 0.8 }]);
let peak = 0;
for (let c = 0; c < 200; c++) {
  m.spec.params.forEach((_, i) => m.params.fill(m.knobs[i], i * 32, (i + 1) * 32));   // the effective knob values, as graph.js writes them
  m.process(32);
  for (const x of m.outputs.slice(l * 32, l * 32 + 32)) peak = Math.max(peak, Math.abs(x));
  m.setNotesIn(m.spec.inputs.findIndex((i) => i.id === "notes"), []);
}
assert.ok(peak > 0.05, `the Sampler plays the clip (peak ${peak})`);
// the Audition button: a command, played with nothing patched
m.reset();
m.command("audition", 0);
peak = 0;
for (let c = 0; c < 200; c++) {
  m.spec.params.forEach((_, i) => m.params.fill(m.knobs[i], i * 32, (i + 1) * 32));
  m.process(32);
  for (const x of m.outputs.slice(l * 32, l * 32 + 32)) peak = Math.max(peak, Math.abs(x));
}
assert.ok(peak > 0.05, `Audition plays the clip (peak ${peak})`);
console.log("web-media-test: ok");
