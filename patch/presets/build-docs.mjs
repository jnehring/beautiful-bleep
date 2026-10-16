// SPDX-License-Identifier: MIT
//
// Module documentation: keeps the manual of every module (patch/modules/<type>/doc/<type>.md) in step with its demo patches and its
// presets, and checks that every manual has the same outline. See doc/specs/preset-system-plan.md, "Module documentation".
//
//   node patch/presets/build-docs.mjs            rewrite the generated sections
//   node patch/presets/build-docs.mjs --check    fail if one is out of date or a manual breaks the outline (CI)
//
// Two sections of a manual are generated, so they cannot drift from the presets (which get recreated): *Demo patches* from
// patch/board/ui/demo-patches.json (build.mjs) and *Presets* from patch/board/ui/module-presets.json (build-modules.mjs). Each sits
// between markers, with its heading inside:
//
//   <!-- generated:demos -->
//   ## Demo patches
//   …
//   <!-- /generated -->
//
// Never edit between the markers: edit the demo or preset files and run build.mjs, build-modules.mjs and this. A manual without the
// markers gets them: an existing hand-written "## Demo patches" section is replaced, a missing one is added before "## Reference".
// A module without demos or presets has no such section.
//
// The outline every manual follows (checked): ## Introduction, ## How does it work?, ## How to use it? in this order (other sections
// may sit between them), a screenshot <type>.png next to the manual (a warning only), an alt text on every image, and links to other manuals that
// point at a manual that exists.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODULES = join(ROOT, "patch", "modules");
const UI = join(ROOT, "patch", "board", "ui");

const OPEN = { demos: "<!-- generated:demos -->", presets: "<!-- generated:presets -->" };
const CLOSE = "<!-- /generated -->";
const REQUIRED = ["Introduction", "How does it work?", "How to use it?"];

const readJson = (file) => JSON.parse(readFileSync(join(UI, file), "utf8"));

/// A table cell: one line, no pipes.
const cell = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
const table = (head, rows) => [`| ${head[0]} | ${head[1]} |`, "|---|---|", ...rows.map(([a, b]) => `| **${cell(a)}** | ${cell(b)} |`)].join("\n");
const NUMBER = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function demoBlock(name, demos) {
  const n = demos.length;
  return [
    OPEN.demos,
    "## Demo patches",
    "",
    `${NUMBER[n] ?? n} whole patch${n === 1 ? "" : "es"} show${n === 1 ? "s" : ""} what ${name} does. In the standalone app open **File → Presets…** (⌘P) and pick *${name}* under *Demos by module*; ` +
      "on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.",
    "",
    table(["Patch", "What it shows"], demos.map((d) => [d.name, d.preset?.description ?? d.description ?? ""])),
    CLOSE,
  ].join("\n");
}

export function presetBlock(name, presets) {
  const n = presets.length;
  return [
    OPEN.presets,
    "## Presets",
    "",
    `The preset bar of the ${name} view has ${n} factory preset${n === 1 ? "" : "s"}. Pick one to set the knobs, then change them to taste; your own presets sit next to them.`,
    "",
    table(["Preset", "What it does"], presets.map((p) => [p.name, p.description ?? ""])),
    CLOSE,
  ].join("\n");
}

/// The text of a manual with one generated section set to `block` (or removed when `block` is null).
export function applySection(text, kind, heading, block, after) {
  const open = OPEN[kind];
  const a = text.indexOf(open);
  if (a >= 0) {
    const b = text.indexOf(CLOSE, a);
    if (b < 0) throw new Error(`${open} has no ${CLOSE}`);
    const end = b + CLOSE.length;
    if (block === null) return (text.slice(0, a).replace(/\n+$/, "\n\n") + text.slice(end).replace(/^\n+/, "")).replace(/\n{3,}/g, "\n\n");
    return text.slice(0, a) + block + text.slice(end);
  }
  if (block === null) return text;   // nothing to generate: a hand-written section without the markers stays as it is
  // A hand-written section with this heading: replaced up to the next level-2 heading.
  const re = new RegExp(`^## ${heading.replace(/[?.*+]/g, "\\$&")}[ \\t]*$`, "m");
  const h = re.exec(text);
  if (h) {
    const next = text.indexOf("\n## ", h.index + 1);
    const end = next < 0 ? text.length : next + 1;
    return text.slice(0, h.index) + block + "\n\n" + text.slice(end);
  }
  // New: after the section named by `after` (the demos, for the presets), else before Reference, else at the end.
  if (after && text.includes(CLOSE) && text.includes(OPEN[after])) {
    const e = text.indexOf(CLOSE, text.indexOf(OPEN[after])) + CLOSE.length;
    return text.slice(0, e) + "\n\n" + block + text.slice(e);
  }
  const ref = /^## Reference[ \t]*$/m.exec(text);
  if (ref) return text.slice(0, ref.index) + block + "\n\n" + text.slice(ref.index);
  return text.replace(/\n*$/, "\n\n") + block + "\n";
}

/// The manual with both generated sections as they should be.
export function sync(text, name, demos, presets) {
  let out = applySection(text, "demos", "Demo patches", demos.length ? demoBlock(name, demos) : null);
  out = applySection(out, "presets", "Presets", presets.length ? presetBlock(name, presets) : null, "demos");
  return out;
}

/// The problems of a manual's outline: [string].
export function checkOutline(text, { type, docDir, manuals }) {
  const errors = [];
  const heads = [...text.matchAll(/^## (.+?)[ \t]*$/gm)].map((m) => m[1]);
  let last = -1;
  for (const need of REQUIRED) {
    const at = heads.indexOf(need);
    if (at < 0) errors.push(`no "## ${need}" section`);
    else if (at < last) errors.push(`"## ${need}" is out of order (want ${REQUIRED.join(", ")})`);
    else last = at;
  }
  for (const kind of Object.keys(OPEN)) {
    const opens = text.split(OPEN[kind]).length - 1;
    if (opens > 1) errors.push(`${OPEN[kind]} appears ${opens} times`);
  }
  if (!existsSync(join(docDir, type + ".png"))) errors.push(`no screenshot ${type}.png (scripts/docs/module-screenshots.py)`);
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    if (!m[1].trim()) errors.push(`the image ${m[2]} has no alt text`);
    if (!/^(https?:|\/)/.test(m[2]) && !existsSync(join(docDir, m[2]))) errors.push(`the image ${m[2]} does not exist`);
  }
  for (const m of text.matchAll(/(?<!!)\[[^\]]+\]\(([\w-]+)\.md(?:#[^)]*)?\)/g))
    if (!manuals.has(m[1])) errors.push(`links to ${m[1]}.md, which is no module manual`);
  return errors;
}

function main() {
  const check = process.argv.includes("--check");
  const demoList = {};
  for (const d of readJson("demo-patches.json").patches) (demoList[d.module] ??= []).push(d);
  const presetList = readJson("module-presets.json").modules;

  const folders = readdirSync(MODULES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const meta = new Map();
  const manuals = new Set();
  for (const f of folders) {
    const mj = join(MODULES, f, "module.json");
    if (!existsSync(mj)) continue;
    const m = JSON.parse(readFileSync(mj, "utf8"));
    meta.set(f, m);
    for (const e of existsSync(join(MODULES, f, "doc")) ? readdirSync(join(MODULES, f, "doc")) : []) if (e.endsWith(".md")) manuals.add(e.slice(0, -3));
  }

  const stale = [], problems = [], warnings = [];   // a missing screenshot is only a warning: it needs the UI server (module-screenshots.py)
  for (const [f, m] of meta) {
    if (!m.doc) continue;
    const file = join(MODULES, f, m.doc);
    const rel = `patch/modules/${f}/${m.doc}`;
    if (!existsSync(file)) { problems.push(`${rel}: the manual in module.json is missing`); continue; }
    const text = readFileSync(file, "utf8");
    const type = m.doc.replace(/^.*\//, "").replace(/\.md$/, "");
    let next;
    try {
      next = sync(text, m.name, demoList[f] ?? [], presetList[f] ?? []);
    } catch (e) {
      problems.push(`${rel}: ${e.message}`);
      continue;
    }
    if (next !== text) {
      stale.push(rel);
      if (!check) writeFileSync(file, next);
    }
    for (const e of checkOutline(next, { type, docDir: dirname(file), manuals }))
      (e.startsWith("no screenshot") ? warnings : problems).push(`${rel}: ${e}`);
  }
  if (check) {
    for (const s of stale) console.error(`${s}: the generated sections are out of date (node patch/presets/build-docs.mjs)`);
  } else console.log(`${stale.length} manual${stale.length === 1 ? "" : "s"} rewritten`);
  for (const w of warnings) console.warn("warning: " + w);
  for (const p of problems) console.error(p);
  if ((check && stale.length) || problems.length) process.exit(1);
  if (check) console.log("manuals ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
