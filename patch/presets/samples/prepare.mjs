#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Makes the factory samples: reads the original recordings listed in manifest.json from a folder, trims, fades and
// normalises them, and writes the mono 16-bit WAV files next to this script. The originals are not in the repository;
// they are fetched from the URLs in manifest.json (the Iowa files are huge, so only the start of a few of them).
//
//   node patch/presets/samples/prepare.mjs <folder with the originals>    (needs ffmpeg for decoding)
//   node patch/presets/samples/prepare.mjs --readme                       rewrite README.md from the manifest
//
// Everything is mono, 16-bit, 48 kHz unless an entry says otherwise. 48 kHz because a Sampler stores its slice markers in
// frames of the engine's rate, and the standalone app and Play run at 48 kHz: at that rate the file is not resampled and the
// markers sit exactly where the presets put them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = new URL("./", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", HERE), "utf8"));
const RATE = 48000;

function decode(file, rate = RATE) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice();
}

export function encode16(x, rate) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return b;
}

/// Trims, removes DC, fades (fade-in 3 ms, fade-out 40 ms) and normalises to −1 dBFS.
function finish(x, rate, { start = 0, length, peak = 0.891, fadeOut = 0.04 }) {
  let a = Math.round(start * rate), b = length ? Math.min(x.length, a + Math.round(length * rate)) : x.length;
  const y = x.slice(a, b);
  let mean = 0; for (const v of y) mean += v; mean /= y.length || 1;
  let max = 0; for (let i = 0; i < y.length; i++) { y[i] -= mean; max = Math.max(max, Math.abs(y[i])); }
  const g = max > 0 ? peak / max : 1;
  const fin = Math.round(0.003 * rate), fout = Math.round(fadeOut * rate);
  for (let i = 0; i < y.length; i++) {
    let f = g;
    if (i < fin) f *= i / fin;
    if (y.length - 1 - i < fout) f *= (y.length - 1 - i) / fout;
    y[i] *= f;
  }
  return y;
}

function main(dir) {
  const made = {};
  for (const s of manifest.samples) {
    const file = `${dir}/${s.local || basename(s.file)}`;
    if (!existsSync(file)) { console.error(`missing original ${file}`); process.exitCode = 1; continue; }
    const rate = s.rate || RATE;
    const y = finish(decode(file, rate), rate, s);
    made[s.name] = { y: rate === RATE ? y : null, rate };
    writeFileSync(fileURLToPath(new URL(`${s.name}.wav`, HERE)), encode16(y, rate));
    console.log(`${s.name}.wav  ${(y.length / rate).toFixed(2)} s`);
  }
  for (const l of manifest.loops || []) {
    const step = 60 / l.bpm / 4, len = Math.round(l.beats * 60 / l.bpm * RATE);
    const out = new Float32Array(len);
    for (const h of l.hits) {
      const src = made[h.sample];
      if (!src || !src.y) throw new Error(`loop ${l.name}: no sample ${h.sample}`);
      const at = Math.round(h.step * step * RATE);
      for (let i = 0; i < src.y.length && at + i < len; i++) out[at + i] += src.y[i] * (h.gain ?? 1);
    }
    const y = finish(out, RATE, { peak: 0.891, fadeOut: 0.002 });
    writeFileSync(fileURLToPath(new URL(`${l.name}.wav`, HERE)), encode16(y, RATE));
    console.log(`${l.name}.wav  ${(y.length / RATE).toFixed(2)} s (loop)`);
  }
}

export function readme() {
  const src = manifest.sources;
  const lines = [
    "# Factory samples", "",
    "The audio that the factory projects and cells for **Sampler** and **Grains** carry. Everything here is mono, 16-bit WAV, a few",
    "seconds at most, cut from recordings that are free to use. [`manifest.json`](manifest.json) lists each file, where it comes from",
    "and how it was cut; [`prepare.mjs`](prepare.mjs) makes the WAV files from the originals (`node patch/presets/samples/prepare.mjs <folder>`).",
    "The originals are not in the repository; fetch them from the addresses below.", "",
    "The factory build embeds the files a project or cell uses in the preset itself (`media`, see",
    "[`../../../doc/specs/preset-system-plan.md`](../../../doc/specs/preset-system-plan.md), \"Samples in presets\"), so a preset keeps working",
    "on any computer.", "", "## Sources and licences", ""];
  for (const [k, s] of Object.entries(src))
    lines.push(`- **${s.title}**, ${s.author}: <${s.url}>. ${s.licence}`);
  lines.push("", "## Files", "", "| File | Source | What it is | Original |", "|---|---|---|---|");
  for (const s of manifest.samples)
    lines.push(`| \`${s.name}.wav\` | ${src[s.source].title} | ${s.note}${s.root ? ` (root note ${s.root})` : ""} | \`${s.file}\` |`);
  for (const l of manifest.loops || [])
    lines.push(`| \`${l.name}.wav\` | made here | ${l.note} ${l.bpm} BPM, ${l.beats} beats. | from the files above |`);
  lines.push("", "## Credit and redistribution", "",
    "- The Iowa recordings carry no credit requirement, but we name the source here and in the module manuals. Their terms speak of",
    "  using the recordings in projects; they do not say whether the unmodified files may be handed on, so the files here are cut,",
    "  faded, normalised and reduced to mono, and each preset carries only a short piece of one recording.",
    "- Factory presets and projects are published under CC BY 4.0 like every shared preset; the CC0 recordings are free of any condition.",
    "- Adding a recording: only from a source whose terms allow redistribution inside a preset (CC0, CC BY, or an explicit permission);",
    "  add it to `manifest.json` with its address and licence, run `prepare.mjs --readme`, and keep each file small",
    "  (a shared preset may carry 8 files and 5 MB, counted as 32-bit float: 176 KB per second at 44.1 kHz mono).", "");
  return lines.join("\n");
}

const arg = process.argv[2];
if (arg === "--readme") writeFileSync(fileURLToPath(new URL("README.md", HERE)), readme());
else if (arg) { main(arg); writeFileSync(fileURLToPath(new URL("README.md", HERE)), readme()); }
else if (process.argv[1] === fileURLToPath(import.meta.url)) { console.error("usage: prepare.mjs <folder with the originals> | --readme"); process.exit(2); }
