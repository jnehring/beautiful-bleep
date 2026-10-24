// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The browser's recorder (web-recorder.js, web-recordings.js): chunks and the memory budget, takes, the zip with its WAV files, and the
// Audio Console (a real wasm file) recording through the bleep_record_* imports of module-host.js. Needs the console built for the browser:
//   BLEEP_WEB_ONLY=audio-console scripts/build/build-web.sh --modules-only /tmp/acweb
//   node patch/web/test/web-recorder-test.mjs [path/to/audio-console.wasm]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileModule, ModuleInstance } from "../js/module-host.js";
import { CHUNK_FRAMES, MemoryRecorder } from "../js/web-recorder.js";

const here = dirname(fileURLToPath(import.meta.url));
const R = createRequire(import.meta.url)(join(here, "..", "js", "web-recordings.js"));

const spec = (tracks, name = "Test/Console") => JSON.stringify({ name, tracks });
const ramp = (n, from = 0) => Float32Array.from({ length: n }, (_, i) => ((from + i) % 1000) / 2000);

// ---- the budget ---------------------------------------------------------------------------------------------------------------------
assert.equal(R.budgetFor({}), 256 * 1024 * 1024, "unknown memory: 256 MB");
assert.equal(R.budgetFor({ deviceMemory: 2 }), 512 * 1024 * 1024, "a quarter of 2 GB");
assert.equal(R.budgetFor({ deviceMemory: 8 }), 1024 * 1024 * 1024, "capped at 1 GB");
assert.equal(R.budgetFor({ deviceMemory: 0.25 }), 256 * 1024 * 1024, "never below 256 MB");
assert.equal(R.safeName("Keys/Pad: 1"), "Keys-Pad- 1");

// ---- sessions, takes, chunks --------------------------------------------------------------------------------------------------------
{
  const posted = [];
  const rec = new MemoryRecorder({ budget: 64 * 1024 * 1024, post: (m, t) => posted.push({ m, t }) });
  const b = rec.bind();
  assert.equal(b.open("not json", 48000, 2), -1);
  assert.equal(b.open(spec([]), 48000, 2), -1);
  assert.equal(b.open(spec([{ name: "x", channels: 3 }]), 48000, 2), -1);
  assert.match(b.text(0, 1), /one or two channels/);
  const h = b.open(spec([{ name: "A", channels: 1 }, { name: "B", channels: 2 }]), 48000, 1);
  assert.equal(h, 1);
  assert.equal(b.write(h, 0, ramp(10), ramp(10), 10), 0, "nothing is recorded outside a take");
  assert.equal(b.take(h, true), 1);
  const n = CHUNK_FRAMES + 1000;   // crosses a chunk boundary
  assert.equal(b.write(h, 0, ramp(n), ramp(n), n), 1);
  assert.equal(b.write(h, 1, ramp(n), ramp(n, 5), n), 1);
  const out = {};
  assert.equal(b.status(h, out), 1);
  assert.deepEqual(out, { frames: n, take: 1 });
  assert.equal(b.take(h, false), 1);
  assert.equal(b.take(h, true), 1);
  assert.equal(b.write(h, 0, ramp(50), ramp(50), 50), 1);
  assert.equal(b.write(h, 1, ramp(50), ramp(50), 50), 1);
  assert.equal(b.take(h, false), 1);
  const used = rec.used;
  assert.equal(used, (2 * CHUNK_FRAMES * 1 * 3) + (2 * CHUNK_FRAMES * 2 * 3) + (CHUNK_FRAMES * 3) + (CHUNK_FRAMES * 2 * 3), "every chunk counts, 24-bit");
  b.close(h);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].m.cmd, "recording");
  assert.equal(posted[0].t.length, 6, "the chunks are transferred");
  assert.equal(rec.used, used, "what the page holds still counts");
  rec.release(posted[0].m.recording.bytes);
  assert.equal(rec.used, 0, "released memory is free again");

  // the page: a zip with a folder, a WAV for every track of every take
  const store = R.create({ onRelease: (bytes) => rec.release(bytes) });
  store.add(posted[0].m.recording);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].takes, 2);
  const { name, blob } = store.zip(posted[0].m.recording.id);
  assert.match(name, /^\d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d Test-Console\.zip$/);
  const dir = mkdtempSync(join(tmpdir(), "bleep-zip-"));
  const file = join(dir, "r.zip");
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const listing = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
  assert.equal(listing.length, 4);
  assert.ok(listing.every((f) => f.endsWith(".wav") && f.includes("Test-Console/")), listing.join(", "));
  assert.ok(listing.some((f) => f.endsWith("/A (take 2).wav")) && listing.some((f) => f.endsWith("/B.wav")));
  execFileSync("unzip", ["-tq", file]);   // every entry's CRC is right
  const wav = execFileSync("unzip", ["-p", file, listing.find((f) => f.endsWith("/B.wav"))], { maxBuffer: 1 << 26 });
  assert.equal(wav.toString("latin1", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt16LE(34), 24);
  assert.equal(wav.readUInt32LE(40), n * 2 * 3, "the last chunk is cut to what was recorded");
  const s24 = (frame, c) => { let v = wav[44 + (frame * 2 + c) * 3] | (wav[45 + (frame * 2 + c) * 3] << 8) | (wav[46 + (frame * 2 + c) * 3] << 16); return (v & 0x800000 ? v | ~0xffffff : v) / 8388607; };
  assert.ok(Math.abs(s24(100, 0) - 100 / 2000) < 1e-6 && Math.abs(s24(100, 1) - 105 / 2000) < 1e-6, "the samples are what was written");
  store.discard(posted[0].m.recording.id);
  assert.equal(rec.used, 0);
  assert.equal(store.list().length, 0);
}

// ---- the budget runs out: the session keeps what it has --------------------------------------------------------------------------------
{
  const posted = [];
  const chunkBytes = CHUNK_FRAMES * 4;   // one mono float chunk
  const rec = new MemoryRecorder({ budget: chunkBytes * 3, post: (m) => posted.push(m) });
  const b = rec.bind();
  const h = b.open(spec([{ name: "A", channels: 1 }]), 48000, 2);
  b.take(h, true);
  let accepted = 0, refused = false;
  for (let i = 0; i < 10 && !refused; ++i) { if (b.write(h, 0, ramp(CHUNK_FRAMES), ramp(CHUNK_FRAMES), CHUNK_FRAMES)) accepted++; else refused = true; }
  assert.equal(accepted, 3, "three chunks fit");
  assert.ok(refused);
  const out = {};
  assert.equal(b.status(h, out) & 2, 2, "the session failed");
  assert.match(b.text(h, 1), /memory budget/);
  assert.equal(rec.free, 0);
  assert.equal(b.write(h, 0, ramp(10), ramp(10), 10), 0, "nothing more is accepted");
  b.close(h);
  assert.equal(posted[0].recording.tracks[0].takes[0].frames, 3 * CHUNK_FRAMES, "what was recorded is kept");
}

// ---- an empty session leaves nothing; dispose finishes open sessions -------------------------------------------------------------------
{
  const posted = [];
  const rec = new MemoryRecorder({ post: (m) => posted.push(m) });
  const b = rec.bind();
  const h = b.open(spec([{ name: "A", channels: 1 }]), 48000, 0);
  b.take(h, true);
  b.take(h, false);
  b.close(h);
  assert.equal(posted.length, 0);
  assert.equal(rec.used, 0);
  const h2 = b.open(spec([{ name: "A", channels: 1 }]), 48000, 0);
  b.take(h2, true);
  b.write(h2, 0, ramp(100), ramp(100), 100);
  b.dispose();
  assert.equal(posted.length, 1, "a destroyed instance does not lose its recording");
}

// ---- the Audio Console itself ------------------------------------------------------------------------------------------------------------------
const file = process.argv[2] || "/tmp/acweb/modules/audio-console.wasm";
if (!existsSync(file)) { console.log("web-recorder-test: ok (Audio Console wasm not built: skipped the module part)"); process.exit(0); }
{
  const posted = [];
  const rec = new MemoryRecorder({ budget: 256 * 1024 * 1024, post: (m, t) => posted.push({ m, t }) });
  const module = await compileModule(readFileSync(file));
  const m = new ModuleInstance(module, 48000, "audio-console", new Map(), rec);
  const idx = (id) => m.spec.params.findIndex((p) => p.id === id);
  const norm = (id, v) => { const p = m.spec.params[idx(id)]; return p.kind === "int" || p.kind === "choice" ? (v - p.min) / (p.max - p.min) : v; };
  m.setKnob(idx("ch1_arm"), 1);
  m.setKnob(idx("ch2_arm"), 1);
  m.setKnob(idx("ch2_stereo"), 1);
  m.setKnob(idx("master_arm"), 1);
  m.setKnob(idx("recformat"), 0);   // 16-bit
  m.setConnected(Array.from({ length: m.spec.inputs.length }, (_, i) => (i === 0 ? 1 : 0)), new Array(m.spec.outputs.length).fill(1));
  m.setTransport(120, 0, true, 0);
  let pos = 0;
  const run = (chunks) => {
    for (let c = 0; c < chunks; c++) {
      for (let i = 0; i < 32; i++) m.inputs[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (pos + i)) / 48000);
      pos += 32;
      m.process(32);
    }
  };
  const live = () => m.live().values;
  run(70);
  assert.equal(live().recAvailable, 1, "the browser can record");
  assert.ok(live().recFree > 100 * 1024 * 1024, "the budget is reported as free space");
  m.command("record", 1);
  run(5);
  run(300);
  assert.equal(live().recState, 2, "recording");
  assert.equal(live().recRate, 5 * 48000 * 2, "five channels of 16-bit samples (1 mono + 1 stereo + the stereo master)");
  m.command("record", 1);
  for (let i = 0; i < 4; i++) { run(70); live(); m.takeData(); }
  assert.equal(live().recState, 0, "stopped");
  assert.equal(posted.length, 1, "the finished recording went to the page");
  const r = posted[0].m.recording;
  assert.equal(r.tracks.length, 3);
  assert.deepEqual(r.tracks.map((t) => [t.name, t.channels]), [["Ch 1", 1], ["Ch 2", 2], ["Master", 2]]);
  const frames = r.tracks[0].takes[0].frames;
  assert.ok(frames >= 9600 && r.tracks.every((t) => t.takes[0].frames === frames), "every track has the same length");
  const store = R.create({});
  store.add(r);
  const { blob } = store.zip(r.id);
  const dir = mkdtempSync(join(tmpdir(), "bleep-zip-"));
  const zip = join(dir, "console.zip");
  writeFileSync(zip, Buffer.from(await blob.arrayBuffer()));
  execFileSync("unzip", ["-tq", zip]);
  const names = execFileSync("unzip", ["-Z1", zip]).toString().trim().split("\n");
  const ch1 = execFileSync("unzip", ["-p", zip, names.find((f) => f.endsWith("/Ch 1.wav"))], { maxBuffer: 1 << 26 });
  assert.equal(ch1.readUInt16LE(34), 16);
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(ch1.readInt16LE(44 + i * 2)) / 32767);
  assert.ok(Math.abs(peak - 0.5) < 0.01, "channel 1 recorded the input: peak " + peak);
}

console.log("web-recorder-test: ok");
