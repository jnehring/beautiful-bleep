// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep-media.js: finding the audio a preset uses, attaching it, importing it, the limits for sharing.
//
//   node patch/web/test/media-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(here, "..", "..", "common", "ui", "bleep-media.js"), "utf8"), ctx);
const M = ctx.window.BleepMedia;
const plain = (v) => JSON.parse(JSON.stringify(v));   // the vm's arrays and objects have another prototype

const A = "0123456789abcdef.wav", B = "fedcba9876543210.wav";
const b64 = (n) => Buffer.alloc(n, 1).toString("base64");

// ids: any string in a node's data that is a media id; once each, in order; nothing else
const nodes = [
  { id: "s", type: "sampler", data: { clip: A, slices: [1, 2] } },
  { id: "g", type: "grains", data: { frozen: B, nested: { deep: [{ also: A }] } } },
  { id: "f", type: "filter" },
  { id: "x", type: "wavetable-osc", data: { sample: "../../etc/passwd", other: "0123456789abcdef.WAV", short: "abc.wav", n: 5 } },
  null,
];
assert.deepEqual(plain(M.ids(nodes)), [A, B]);
assert.deepEqual(plain(M.ids(undefined)), []);
assert.deepEqual(plain(M.ids([{ data: { id: A + "x" } }])), []);

// decodedBytes
assert.equal(M.decodedBytes(b64(10)), 10);
assert.equal(M.decodedBytes(b64(11)), 11);
assert.equal(M.decodedBytes(b64(12)), 12);
assert.equal(M.decodedBytes(""), 0);

// clean: valid ids, names, base64 only; capped
const c = M.clean({ [A]: { name: "  kick.wav ", data: b64(4) }, "bad.wav": { name: "x", data: b64(4) }, [B]: { data: "not base64!" }, "1111111111111111.wav": { name: "", data: b64(4) } });
assert.deepEqual(plain(c), { [A]: { name: "kick.wav", data: b64(4) }, "1111111111111111.wav": { name: "1111111111111111.wav", data: b64(4) } });
assert.deepEqual(plain(M.clean(null)), {});
assert.deepEqual(plain(M.clean([1])), {});
const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i.toString(16).padStart(16, "0") + ".wav", { name: "f", data: b64(3) }]));
assert.equal(Object.keys(M.clean(many)).length, M.LIMITS.files);

// tooBig
assert.equal(M.tooBig({ [A]: { name: "k", data: b64(1000) } }), null);
assert.match(M.tooBig({ [A]: { name: "k", data: b64(M.LIMITS.bytes + 3) } }), /up to 5 MB/);
assert.match(M.tooBig(many), /at most 8 audio files/);

// attach: reads each id, leaves out what it cannot read, no field without audio
const reads = [];
const read = async (id) => { reads.push(id); return id === A ? { data: b64(6), name: "kick.wav" } : id === B ? { error: "not in the media folder" } : null; };
const preset = { nodes };
const missing = await M.attach(preset, nodes, read);
assert.deepEqual(plain(missing), [B]);
assert.deepEqual(plain(preset.media), { [A]: { name: "kick.wav", data: b64(6) } });
assert.deepEqual(reads, [A, B]);
const none = { nodes: [{ id: "f", type: "filter" }], media: { stale: 1 } };
await M.attach(none, none.nodes, read);
assert.equal("media" in none, false);
const throwing = { nodes };
assert.deepEqual(plain(await M.attach(throwing, nodes, async () => { throw new Error("x"); })), [A, B]);

// importAll: reports a failure, a missing id, an id that does not match; imports the rest
const put = async (name, data) => name === "bad.wav" ? { error: "could not read the file" } : name === "other.wav" ? { id: "9999999999999999.wav" } : { id: name === "kick.wav" ? A : B };
const problems = await M.importAll({ [A]: { name: "kick.wav", data: b64(3) }, [B]: { name: "bad.wav", data: b64(3) }, "2222222222222222.wav": { name: "other.wav", data: b64(3) } }, put);
assert.equal(problems.length, 2);
assert.match(problems[0], /bad\.wav: could not read the file/);
assert.match(problems[1], /other\.wav: is stored under another id/);
assert.deepEqual(plain(await M.importAll(undefined, put)), []);

console.log("media-test: ok");
